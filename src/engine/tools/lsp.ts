import { spawn, type ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import * as logger from "../../logger.js";

export const name = "lsp";

export const description =
  "Query the language server for code intelligence: diagnostics (type errors/warnings), " +
  "go-to-definition, find-references, hover info, and workspace symbols. " +
  "Agents should prefer semantic reference tools (symbol_references) over grep when changing symbol usages. " +
  "Auto-detects and spawns the correct language server (TypeScript, Python, Go, Rust). " +
  "For TypeScript, auto-provisions via npx. Other languages require a globally installed server. " +
  "Use after editing files to check for type errors without running a full build.";

export const parameters = {
  type: "object" as const,
  properties: {
    action: {
      type: "string" as const,
      enum: ["diagnostics", "definition", "references", "hover", "symbols", "symbol_references"],
      description:
        "diagnostics: get errors/warnings for a file. " +
        "definition: go to definition of symbol at position. " +
        "references: find all references to symbol at position. " +
        "hover: get type info for symbol at position. " +
        "symbols: list all symbols in a file. " +
        "symbol_references: find all references to a symbol by name.",
    },
    file: {
      type: "string" as const,
      description: "Path to the file (relative or absolute)",
    },
    line: {
      type: "number" as const,
      description: "1-indexed line number (required for definition, references, hover)",
    },
    character: {
      type: "number" as const,
      description: "1-indexed column number (required for definition, references, hover)",
    },
    path: {
      type: "string" as const,
      description: "Path to file or directory (relative or absolute) - used for directory diagnostics aggregation",
    },
    severity: {
      type: "string" as const,
      enum: ["error", "warning", "hint", "all"],
      description: "Severity level to include in diagnostics (default: error)",
    },
    format: {
      type: "string" as const,
      enum: ["json", "text"],
      description: "Output format (default: json for programmatic reliability)",
    },
    symbol: {
      type: "string" as const,
      description: "Symbol name (required for symbol_references)",
    },
    include_declaration: {
      type: "boolean" as const,
      description: "Include declaration in references (default: false for symbol_references)",
    },
  },
  required: ["action"] as const,
};

// ---------------------------------------------------------------------------
// LSP JSON-RPC types
// ---------------------------------------------------------------------------

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

interface DiagnosticItem {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  message: string;
  severity?: number;
  source?: string;
  code?: string | number;
}

interface LocationResult {
  uri: string;
  range: { start: { line: number; character: number } };
}

interface SymbolResult {
  name: string;
  kind: number;
  range: { start: { line: number } };
  children?: SymbolResult[];
}

// ---------------------------------------------------------------------------
// Server state — encapsulated for crash recovery
// ---------------------------------------------------------------------------

interface ServerState {
  process: ChildProcess;
  language: string;
  requestId: number;
  responseBuffer: Buffer;
  pendingRequests: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
  openFiles: Map<string, number>; // uri -> version
  publishedDiagnostics: Map<string, DiagnosticItem[]>; // uri -> diagnostics from push notifications
  ready: boolean;
  capabilities: {
    pullDiagnostics: boolean;       // textDocument/diagnostic
    workspaceDiagnostics: boolean;  // workspace/diagnostic
  };
  maxResponseBytes: number;
  closed: boolean;
  closePromise?: Promise<void>;
  stdoutListener?: (data: Buffer) => void;
  stderrListener?: () => void;
  exitListener?: (code: number | null) => void;
  errorListener?: (error: Error) => void;
}

const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;
const DEFAULT_TERMINATION_GRACE_MS = 500;

interface LanguageServerOverride {
  language: string;
  command: string;
  args?: string[];
}

export interface LSPRunResourcesOptions {
  runId: string;
  workspace: string;
  signal: AbortSignal;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  terminationGraceMs?: number;
  /** Test-only/custom embedding override. Ordinary calls retain auto-detection. */
  server?: LanguageServerOverride;
}

export interface LSPRunResources {
  readonly runId: string;
  readonly workspace: string;
  execute(params: LspParams): Promise<LspResult>;
  close(): Promise<void>;
  isRunning(): boolean;
  getServerLanguage(): string | null;
}

interface ResourceCollection {
  readonly runId: string;
  readonly workspace: string;
  readonly signal: AbortSignal;
  readonly controller: AbortController;
  readonly parentSignal: AbortSignal;
  readonly parentAbortListener: () => void;
  runAbortListener?: () => void;
  readonly startupTimeoutMs: number;
  readonly requestTimeoutMs: number;
  readonly maxResponseBytes: number;
  readonly terminationGraceMs: number;
  readonly override?: LanguageServerOverride;
  server?: ServerState;
  starting?: Promise<ServerState>;
  ownedServers: Set<ServerState>;
  closed: boolean;
  closePromise?: Promise<void>;
}

const legacyCollections = new Map<string, ResourceCollection>();
const runCollections = new Set<ResourceCollection>();

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

interface LanguageServerConfig {
  language: string;
  command: string;
  args: string[];
  installHint: string;
}

const INSTALL_HINTS: Record<string, string> = {
  typescript: "npm i -g typescript-language-server typescript",
  python: "pip install pyright (or pip install python-lsp-server for pylsp)",
  go: "go install golang.org/x/tools/gopls@latest",
  rust: "rustup component add rust-analyzer",
};

function commandExists(cmd: string): boolean {
  const extensions = process.platform === "win32"
    ? ["", ...(process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")]
    : [""];
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const extension of extensions) {
      try {
        const candidate = path.join(directory, cmd + extension);
        fs.accessSync(candidate, fs.constants.X_OK);
        if (fs.statSync(candidate).isFile()) return true;
      } catch { /* try the next executable search path */ }
    }
  }
  return false;
}

function detectLanguage(workingDir: string): LanguageServerConfig | null {
  // TypeScript / JavaScript
  if (
    fs.existsSync(path.join(workingDir, "tsconfig.json")) ||
    fs.existsSync(path.join(workingDir, "package.json"))
  ) {
    if (commandExists("typescript-language-server")) {
      return {
        language: "typescript",
        command: "typescript-language-server",
        args: ["--stdio"],
        installHint: INSTALL_HINTS.typescript,
      };
    }
    // Auto-provision via npx — typescript-language-server is small and fast to install
    return {
      language: "typescript",
      command: "npx",
      args: ["--yes", "typescript-language-server", "--stdio"],
      installHint: INSTALL_HINTS.typescript,
    };
  }

  // Python
  if (
    fs.existsSync(path.join(workingDir, "pyproject.toml")) ||
    fs.existsSync(path.join(workingDir, "setup.py")) ||
    fs.existsSync(path.join(workingDir, "requirements.txt"))
  ) {
    if (commandExists("pyright-langserver")) {
      return { language: "python", command: "pyright-langserver", args: ["--stdio"], installHint: INSTALL_HINTS.python };
    }
    if (commandExists("pylsp")) {
      return { language: "python", command: "pylsp", args: [], installHint: INSTALL_HINTS.python };
    }
    return null;
  }

  // Go
  if (fs.existsSync(path.join(workingDir, "go.mod"))) {
    if (commandExists("gopls")) {
      return { language: "go", command: "gopls", args: ["serve"], installHint: INSTALL_HINTS.go };
    }
    return null;
  }

  // Rust
  if (fs.existsSync(path.join(workingDir, "Cargo.toml"))) {
    if (commandExists("rust-analyzer")) {
      return { language: "rust", command: "rust-analyzer", args: [], installHint: INSTALL_HINTS.rust };
    }
    return null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// JSON-RPC transport
// ---------------------------------------------------------------------------

function sendMessage(s: ServerState, msg: JsonRpcMessage): void {
  if (s.closed) return;
  if (!s.process.stdin?.writable) return;
  const body = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
  s.process.stdin.write(header + body);
}

function sendRequest(
  s: ServerState,
  method: string,
  params: unknown,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  if (s.closed) return Promise.reject(new Error("LSP server shut down"));
  const id = s.requestId++;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => {
      s.pendingRequests.delete(id);
      settle(() => reject(abortError(signal!, `LSP request ${method}`)));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    timeout = setTimeout(() => {
      s.pendingRequests.delete(id);
      settle(() => reject(new Error(`LSP request timed out after ${timeoutMs}ms: ${method}`)));
    }, timeoutMs);

    s.pendingRequests.set(id, {
      resolve: (v) => {
        settle(() => resolve(v));
      },
      reject: (e) => {
        settle(() => reject(e));
      },
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      if (!s.process.stdin?.writable) throw new Error("LSP server stdin is closed");
      sendMessage(s, { jsonrpc: "2.0", id, method, params });
    } catch (error) {
      s.pendingRequests.delete(id);
      settle(() => reject(error instanceof Error ? error : new Error(String(error))));
    }
  });
}

function sendNotification(s: ServerState, method: string, params: unknown): void {
  sendMessage(s, { jsonrpc: "2.0", method, params });
}

function handleData(s: ServerState, data: Buffer): void {
  if (s.closed) return;
  s.responseBuffer = Buffer.concat([s.responseBuffer, data]);
  if (s.responseBuffer.length > s.maxResponseBytes) {
    s.responseBuffer = Buffer.alloc(0);
    rejectPending(s, new Error(`LSP response buffer exceeded ${s.maxResponseBytes} bytes`));
    return;
  }

  while (true) {
    const headerEnd = s.responseBuffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;

    const header = s.responseBuffer.subarray(0, headerEnd).toString("ascii");
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      s.responseBuffer = s.responseBuffer.slice(headerEnd + 4);
      continue;
    }

    const contentLength = parseInt(match[1], 10);
    if (!Number.isSafeInteger(contentLength) || contentLength > s.maxResponseBytes) {
      s.responseBuffer = Buffer.alloc(0);
      rejectPending(s, new Error(`LSP response buffer exceeded ${s.maxResponseBytes} bytes`));
      return;
    }
    const bodyStart = headerEnd + 4;
    if (s.responseBuffer.length < bodyStart + contentLength) break;

    // LSP Content-Length counts UTF-8 bytes, not JavaScript characters.
    const body = s.responseBuffer.subarray(bodyStart, bodyStart + contentLength).toString("utf8");
    s.responseBuffer = s.responseBuffer.slice(bodyStart + contentLength);

    try {
      const msg = JSON.parse(body) as JsonRpcMessage;

      // Handle push diagnostics (textDocument/publishDiagnostics)
      if (msg.method === "textDocument/publishDiagnostics" && msg.params) {
        const params = msg.params as { uri: string; diagnostics: DiagnosticItem[] };
        s.publishedDiagnostics.set(params.uri, params.diagnostics);
        continue;
      }

      // Handle responses to our requests
      if (msg.id !== undefined && s.pendingRequests.has(msg.id)) {
        const pending = s.pendingRequests.get(msg.id)!;
        s.pendingRequests.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message));
        } else {
          pending.resolve(msg.result);
        }
      }
    } catch {
      // Malformed JSON — skip
    }
  }
}

// ---------------------------------------------------------------------------
// Server lifecycle. A collection is owned by a run; legacy callers are held
// separately only until the remaining adapters migrate to run resources.
// ---------------------------------------------------------------------------

function canonicalWorkspace(workingDir: string): string {
  try {
    return fs.realpathSync(workingDir);
  } catch {
    return path.resolve(workingDir);
  }
}

function validateLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new Error(`${name} must be a finite non-negative integer no greater than 2147483647`);
  }
  return value;
}

function abortError(signal: AbortSignal, label: string): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(`${label} cancelled`);
}

function sleepWithSignal(milliseconds: number, signal: AbortSignal, label: string): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError(signal, label));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(abortError(signal, label));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function rejectPending(s: ServerState, error: Error): void {
  for (const pending of s.pendingRequests.values()) pending.reject(error);
  s.pendingRequests.clear();
}

function signalProcessGroup(proc: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (proc.pid && process.platform !== "win32") process.kill(-proc.pid, signal);
    else proc.kill(signal);
  } catch {
    try { proc.kill(signal); } catch { /* Already stopped. */ }
  }
}

function processGroupExists(pid: number | undefined): boolean {
  if (!pid || process.platform === "win32") return false;
  try { process.kill(-pid, 0); return true; } catch { return false; }
}

function stopProcessGroup(proc: ChildProcess, graceMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled || processGroupExists(proc.pid)) return;
      settled = true;
      clearTimeout(killTimer);
      clearTimeout(failTimer);
      clearInterval(pollTimer);
      proc.removeListener("close", finish);
      proc.removeListener("exit", finish);
      resolve();
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      clearInterval(pollTimer);
      proc.removeListener("close", finish);
      proc.removeListener("exit", finish);
      reject(new Error(`LSP subprocess ${proc.pid ?? "unknown"} did not stop after SIGTERM/SIGKILL`));
    };
    const killTimer = setTimeout(() => signalProcessGroup(proc, "SIGKILL"), graceMs);
    const failTimer = setTimeout(fail, Math.max(1_000, graceMs * 4));
    const pollTimer = setInterval(finish, 20);
    proc.once("close", finish);
    proc.once("exit", finish);
    signalProcessGroup(proc, "SIGTERM");
    finish();
  });
}

function detachListeners(s: ServerState): void {
  if (s.stdoutListener) s.process.stdout?.removeListener("data", s.stdoutListener);
  if (s.stderrListener) s.process.stderr?.removeListener("data", s.stderrListener);
  if (s.exitListener) s.process.removeListener("exit", s.exitListener);
  if (s.errorListener) s.process.removeListener("error", s.errorListener);
}

async function closeServer(collection: ResourceCollection, s: ServerState): Promise<void> {
  if (s.closePromise) return s.closePromise;
  s.closePromise = (async () => {
    s.closed = true;
    rejectPending(s, new Error("LSP server shut down"));
    try {
      if (s.process.stdin?.writable) {
        sendNotification(s, "exit", {});
      }
    } catch { /* Process teardown below is authoritative. */ }
    await stopProcessGroup(s.process, collection.terminationGraceMs);
    detachListeners(s);
    if (collection.server === s) collection.server = undefined;
    collection.ownedServers.delete(s);
  })();
  try {
    await s.closePromise;
  } catch (error) {
    // Retain this owned instance for a later close/shutdown attempt. A failed
    // parent process can still have living descendants in its process group.
    s.closePromise = undefined;
    throw error;
  }
}

async function ensureServer(collection: ResourceCollection): Promise<ServerState> {
  if (collection.closed || collection.signal.aborted) throw abortError(collection.signal, `LSP run ${collection.runId}`);
  if (collection.server?.ready && !collection.server.closed && collection.server.process.exitCode === null) {
    return collection.server;
  }
  if (collection.starting) return collection.starting;

  const start = async (): Promise<ServerState> => {
    const workingDir = collection.workspace;
    const detected = collection.override ?? detectLanguage(workingDir);
    if (!detected) {
      const projectFiles = [
        "tsconfig.json", "package.json", "pyproject.toml",
        "setup.py", "requirements.txt", "go.mod", "Cargo.toml",
      ];
      const found = projectFiles.filter((f) => fs.existsSync(path.join(workingDir, f)));
      throw new Error(
        `No language server found.${found.length > 0 ? ` Detected project files: ${found.join(", ")}.` : ""}\n` +
        `Install one:\n` +
        Object.entries(INSTALL_HINTS)
          .map(([lang, hint]) => `  ${lang}: ${hint}`)
          .join("\n")
      );
    }

    if (collection.signal.aborted || collection.closed) throw abortError(collection.signal, `LSP run ${collection.runId}`);
    const s: ServerState = {
      process: spawn(detected.command, detected.args, {
        cwd: workingDir,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
      }),
      language: detected.language,
      requestId: 1,
      responseBuffer: Buffer.alloc(0),
      pendingRequests: new Map(),
      openFiles: new Map(),
      publishedDiagnostics: new Map(),
      ready: false,
      capabilities: { pullDiagnostics: false, workspaceDiagnostics: false },
      maxResponseBytes: collection.maxResponseBytes,
      closed: false,
    };
    collection.ownedServers.add(s);

    s.stdoutListener = (data: Buffer) => handleData(s, data);
    s.stderrListener = () => {
      // Absorb stderr — language servers are noisy
    };
    s.process.stdout!.on("data", s.stdoutListener);
    s.process.stderr!.on("data", s.stderrListener);

    s.exitListener = () => {
      rejectPending(s, new Error("LSP server exited"));
      // The parent can exit while a descendant still owns its process group.
      // Keep this instance owned until closeServer verifies that cleanup.
      void closeServer(collection, s).catch((error) => logger.error(`LSP teardown failed: ${error instanceof Error ? error.message : String(error)}`));
    };
    s.errorListener = (error) => {
      rejectPending(s, new Error(`LSP server failed to start: ${error.message}`));
    };
    s.process.on("exit", s.exitListener);
    s.process.on("error", s.errorListener);

    // LSP initialize handshake
    const initResult = await sendRequest(s, "initialize", {
      processId: process.pid,
      rootUri: `file://${workingDir}`,
      capabilities: {
        textDocument: {
          publishDiagnostics: { relatedInformation: true },
          diagnostic: { dynamicRegistration: false },  // pull diagnostics (3.17+)
          definition: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
          hover: { contentFormat: ["plaintext", "markdown"] },
          documentSymbol: { dynamicRegistration: false },
          synchronization: {
            didSave: true,
            willSave: false,
            willSaveWaitUntil: false,
          },
        },
        workspace: {
          diagnostics: { refreshSupport: true },  // workspace/diagnostic (3.17+)
        },
      },
    }, collection.signal, collection.startupTimeoutMs) as { capabilities?: {
      diagnosticProvider?: { workspaceDiagnostics?: boolean } | boolean;
    } } | null;

    // Detect server diagnostic capabilities from the initialize response
    const diagProvider = initResult?.capabilities?.diagnosticProvider;
    if (typeof diagProvider === "object" && diagProvider !== null) {
      s.capabilities.pullDiagnostics = true;
      s.capabilities.workspaceDiagnostics = diagProvider.workspaceDiagnostics === true;
    }
    logger.debug("LSP server capabilities", {
      language: s.language,
      pullDiagnostics: s.capabilities.pullDiagnostics,
      workspaceDiagnostics: s.capabilities.workspaceDiagnostics,
    });

    sendNotification(s, "initialized", {});
    if (collection.signal.aborted || collection.closed) throw abortError(collection.signal, `LSP run ${collection.runId}`);
    s.ready = true;
    collection.server = s;
    return s;
  };

  collection.starting = start();
  try {
    return await collection.starting;
  } catch (error) {
    const partial = [...collection.ownedServers].find((candidate) => candidate !== collection.server);
    if (partial) await closeServer(collection, partial);
    throw error;
  } finally {
    collection.starting = undefined;
  }
}

// ---------------------------------------------------------------------------
// File management — tracks versions, sends didOpen/didChange
// ---------------------------------------------------------------------------

function fileUri(filePath: string): string {
  return `file://${path.resolve(filePath)}`;
}

function languageId(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "typescript", ".tsx": "typescriptreact",
    ".js": "javascript", ".jsx": "javascriptreact",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".json": "json",
    ".md": "markdown",
    ".css": "css",
    ".html": "html",
  };
  return map[ext] || "plaintext";
}

function syncFile(s: ServerState, filePath: string): void {
  const resolvedPath = path.resolve(filePath);
  const uri = fileUri(resolvedPath);
  const content = fs.readFileSync(resolvedPath, "utf-8");
  const currentVersion = s.openFiles.get(uri);

  if (currentVersion === undefined) {
    // First time — didOpen
    sendNotification(s, "textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: languageId(resolvedPath),
        version: 1,
        text: content,
      },
    });
    s.openFiles.set(uri, 1);
  } else {
    // Already open — didChange with full content (incremental sync not worth the complexity)
    const newVersion = currentVersion + 1;
    sendNotification(s, "textDocument/didChange", {
      textDocument: { uri, version: newVersion },
      contentChanges: [{ text: content }],
    });
    s.openFiles.set(uri, newVersion);
  }
}

// ---------------------------------------------------------------------------
// Directory diagnostics aggregation
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "__pycache__", ".venv", "venv", "target"]);

/**
 * Parse the project's tsconfig.json to get exclude patterns.
 * Files matching these patterns should not be opened in the LSP — they're
 * outside the project program and will produce false-positive diagnostics
 * (e.g., test files missing vitest types when only @types/node is in tsconfig).
 */
export function loadTsconfigExcludes(workingDir: string): RegExp[] {
  const tsconfigPath = path.join(workingDir, "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) return [];
  try {
    // Strip comments for JSON.parse — tsconfig allows // and /* */ comments
    const raw = fs.readFileSync(tsconfigPath, "utf-8")
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const config = JSON.parse(raw) as { exclude?: string[] };
    if (!Array.isArray(config.exclude)) return [];
    return config.exclude
      .map((pattern) => {
        // Convert glob patterns to regex: ** = any path, * = any segment
        const escaped = pattern
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*\*/g, "⬡⬡")
          .replace(/\*/g, "[^/]*")
          .replace(/⬡⬡/g, ".*");
        return new RegExp(`(^|/)${escaped}(/|$)`);
      });
  } catch {
    return [];
  }
}

function collectFiles(dirPath: string, workingDir?: string): string[] {
  const excludes = workingDir ? loadTsconfigExcludes(workingDir) : [];
  const files: string[] = [];
  const walk = (currentDir: string) => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          walk(path.join(currentDir, entry.name));
        }
      } else if (entry.isFile() && languageId(entry.name) !== "plaintext") {
        const fullPath = path.join(currentDir, entry.name);
        // Check against tsconfig exclude patterns using the relative path
        if (excludes.length > 0 && workingDir) {
          const relPath = path.relative(workingDir, fullPath);
          if (excludes.some((re) => re.test(relPath))) continue;
        }
        files.push(fullPath);
      }
    }
  };
  walk(dirPath);
  return files;
}

async function getDirectoryDiagnostics(dirPath: string, workingDir: string, severity: "error" | "warning" | "hint" | "all", format: "json" | "text", collection: ResourceCollection): Promise<LspResult> {
  if (format === "json") {
    return await getDirectoryDiagnosticsJson(dirPath, workingDir, severity, collection);
  } else {
    // For text format, fall back to legacy behavior for each file
    return await getDirectoryDiagnosticsText(dirPath, workingDir, severity, collection);
  }
}

interface DiagnosticEntry {
  file: string;
  line: number;
  col: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  source?: string;
  code?: string | number;
}

function collectDiagnosticEntries(
  items: DiagnosticItem[],
  resolvedPath: string,
  workingDir: string,
  severity: "error" | "warning" | "hint" | "all",
): { entries: DiagnosticEntry[]; errors: number; warnings: number; hints: number } {
  const filtered = filterDiagnosticsBySeverity(items, severity);
  let errors = 0, warnings = 0, hints = 0;
  const entries: DiagnosticEntry[] = [];
  for (const d of filtered) {
    entries.push({
      file: path.relative(workingDir, resolvedPath),
      line: d.range.start.line + 1,
      col: d.range.start.character + 1,
      severity: getSeverityString(d.severity),
      message: d.message,
      source: d.source,
      code: d.code,
    });
    if (d.severity === 1) errors++;
    else if (d.severity === 2) warnings++;
    else hints++;
  }
  return { entries, errors, warnings, hints };
}

/**
 * Try workspace/diagnostic (LSP 3.17+) — single request for all workspace diagnostics.
 * Returns null if the server doesn't support it.
 */
async function tryWorkspaceDiagnostics(
  s: ServerState,
  workingDir: string,
  severity: "error" | "warning" | "hint" | "all",
  collection: ResourceCollection,
): Promise<{ diagnostics: DiagnosticEntry[]; summary: { errors: number; warnings: number; hints: number } } | null> {
  if (!s.capabilities.workspaceDiagnostics) return null;
  try {
    const result = await sendRequest(s, "workspace/diagnostic", {
      previousResultIds: [],
    }, collection.signal, collection.requestTimeoutMs) as { items?: Array<{
      uri: string;
      kind: "full" | "unchanged";
      items?: DiagnosticItem[];
    }> } | null;

    const items = result?.items;
    if (!items) return null;

    const diagnostics: DiagnosticEntry[] = [];
    const summary = { errors: 0, warnings: 0, hints: 0 };
    for (const doc of items) {
      if (doc.kind !== "full" || !doc.items?.length) continue;
      const filePath = doc.uri.startsWith("file://") ? doc.uri.slice(7) : doc.uri;
      const collected = collectDiagnosticEntries(doc.items, filePath, workingDir, severity);
      diagnostics.push(...collected.entries);
      summary.errors += collected.errors;
      summary.warnings += collected.warnings;
      summary.hints += collected.hints;
    }
    return { diagnostics, summary };
  } catch {
    // Server advertised capability but failed — fall through to file-by-file
    logger.debug("workspace/diagnostic failed, falling back to file-by-file");
    return null;
  }
}

/**
 * Process files in parallel batches using pull diagnostics.
 * Sends didOpen for a batch, fires all diagnostic requests concurrently,
 * then collects results — much faster than sequential processing.
 */
async function batchPullDiagnostics(
  s: ServerState,
  files: string[],
  workingDir: string,
  severity: "error" | "warning" | "hint" | "all",
  collection: ResourceCollection,
): Promise<{ diagnostics: DiagnosticEntry[]; summary: { errors: number; warnings: number; hints: number } }> {
  const diagnostics: DiagnosticEntry[] = [];
  const summary = { errors: 0, warnings: 0, hints: 0 };
  const BATCH_SIZE = 20;

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);

    // Sync all files in this batch (didOpen/didChange notifications — no response to wait for)
    for (const filePath of batch) {
      syncFile(s, filePath);
    }

    // Fire all diagnostic requests concurrently
    const results = await Promise.allSettled(
      batch.map(async (filePath) => {
        const resolvedPath = path.resolve(filePath);
        const uri = fileUri(resolvedPath);
        s.publishedDiagnostics.delete(uri);

        if (s.capabilities.pullDiagnostics) {
          const result = await sendRequest(s, "textDocument/diagnostic", {
            textDocument: { uri },
          }, collection.signal, collection.requestTimeoutMs) as { items?: DiagnosticItem[] } | null;
          return { resolvedPath, items: result?.items || [] };
        }
        // Push diagnostics — wait briefly for the server to process
        await sleepWithSignal(2000, collection.signal, "LSP diagnostics");
        return { resolvedPath, items: s.publishedDiagnostics.get(uri) || [] };
      }),
    );

    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      const { resolvedPath, items } = r.value;
      const collected = collectDiagnosticEntries(items, resolvedPath, workingDir, severity);
      diagnostics.push(...collected.entries);
      summary.errors += collected.errors;
      summary.warnings += collected.warnings;
      summary.hints += collected.hints;
    }
  }
  return { diagnostics, summary };
}

async function getDirectoryDiagnosticsJson(dirPath: string, workingDir: string, severity: "error" | "warning" | "hint" | "all", collection: ResourceCollection): Promise<LspResult> {
  try {
    const s = await ensureServer(collection);

    // 1. Try workspace/diagnostic — single request, no file walking needed
    const wsResult = await tryWorkspaceDiagnostics(s, workingDir, severity, collection);
    if (wsResult) {
      return { success: true, content: JSON.stringify({ lsp_available: true, ...wsResult }) };
    }

    // 2. Fall back to file-by-file with parallel batching
    const files = collectFiles(dirPath, workingDir);
    logger.debug("LSP directory diagnostics", { fileCount: files.length, dirPath });
    const result = await batchPullDiagnostics(s, files, workingDir, severity, collection);

    // Deduplicate — the same diagnostic can appear via both pull and push
    const seen = new Set<string>();
    const deduped = result.diagnostics.filter((d) => {
      const key = `${d.file}:${d.line}:${d.col}:${d.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      success: true,
      content: JSON.stringify({
        lsp_available: true,
        summary: result.summary,
        diagnostics: deduped,
      }),
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes("No language server found")) {
      return { success: true, content: JSON.stringify({ lsp_available: false, summary: { errors: 0, warnings: 0, hints: 0 }, diagnostics: [] }) };
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.debug("Directory diagnostics fallback", { error: message });
    return { success: true, content: JSON.stringify({ lsp_available: false, error: message, summary: { errors: 0, warnings: 0, hints: 0 }, diagnostics: [] }) };
  }
}

async function getDirectoryDiagnosticsText(dirPath: string, workingDir: string, severity: "error" | "warning" | "hint" | "all", collection: ResourceCollection): Promise<LspResult> {
  // Use the JSON path and convert to text — same parallel batching, one code path
  const jsonResult = await getDirectoryDiagnosticsJson(dirPath, workingDir, severity, collection);
  if (!jsonResult.success || !jsonResult.content) return jsonResult;

  try {
    const parsed = JSON.parse(jsonResult.content) as {
      lsp_available: boolean;
      summary: { errors: number; warnings: number; hints: number };
      diagnostics: DiagnosticEntry[];
    };
    if (!parsed.lsp_available) {
      return { success: true, content: "No language server available." };
    }
    const lines = [`Directory diagnostics for: ${dirPath}`, `Total errors: ${parsed.summary.errors}, warnings: ${parsed.summary.warnings}`];
    // Group by file
    const byFile = new Map<string, DiagnosticEntry[]>();
    for (const d of parsed.diagnostics) {
      if (!byFile.has(d.file)) byFile.set(d.file, []);
      byFile.get(d.file)!.push(d);
    }
    for (const [file, entries] of byFile) {
      lines.push(`\n${file}:`);
      for (const d of entries) {
        lines.push(`  ${d.line}:${d.col} ${d.severity}: ${d.message}`);
      }
    }
    return { success: true, content: lines.join("\n") };
  } catch {
    return jsonResult; // fallback to raw JSON
  }
}

function filterDiagnosticsBySeverity(diagnostics: DiagnosticItem[], severity: "error" | "warning" | "hint" | "all"): DiagnosticItem[] {
  if (severity === "all") return diagnostics;
  
  const severityMap: Record<string, number> = {
    "error": 1,
    "warning": 2,
    "hint": 3
  };
  
  const targetSeverity = severityMap[severity];
  
  if (targetSeverity === undefined) return diagnostics;
  
  return diagnostics.filter(d => {
    if (severity === "error") return d.severity === 1;
    if (severity === "warning") return d.severity === 2;
    if (severity === "hint") return d.severity === 3 || d.severity === 4;
    return true;
  });
}

function getSeverityString(severity: number | undefined): "error" | "warning" | "info" | "hint" {
  switch (severity) {
    case 1: return "error";
    case 2: return "warning";
    case 3: return "info";
    case 4: return "hint";
    default: return "error";
  }
}

// ---------------------------------------------------------------------------
// Tool actions
// ---------------------------------------------------------------------------

async function getDiagnostics(filePath: string, workingDir: string, format: "json" | "text" = "json", collection: ResourceCollection): Promise<string> {
  try {
    const s = await ensureServer(collection);
    const uri = fileUri(path.resolve(filePath));

    // Clear any stale push diagnostics for this file
    s.publishedDiagnostics.delete(uri);

    // Sync file content to server
    syncFile(s, filePath);

    // Try pull diagnostics first (LSP 3.17+)
    try {
      const result = await sendRequest(s, "textDocument/diagnostic", {
        textDocument: { uri },
      }, collection.signal, collection.requestTimeoutMs) as { items?: DiagnosticItem[] } | null;

      const items = result?.items || [];
      if (items.length === 0) {
        if (format === "json") {
          return JSON.stringify({ lsp_available: true, diagnostics: [] });
        }
        return "No diagnostics (errors or warnings) found.";
      }
      
      if (format === "json") {
        const diagnostics = items.map(d => {
          const loc = d.range.start;
          return {
            file: path.basename(filePath),
            line: loc.line + 1,
            col: loc.character + 1,
            severity: getSeverityString(d.severity),
            message: d.message,
            source: d.source,
            code: d.code
          };
        });
        return JSON.stringify({ lsp_available: true, diagnostics });
      }
      
      return formatDiagnostics(items, filePath);
    } catch {
      // Server doesn't support pull diagnostics — wait for push diagnostics
      // Give the server a moment to publish diagnostics after our didOpen/didChange
      await sleepWithSignal(1500, collection.signal, "LSP diagnostics");

      const pushed = s.publishedDiagnostics.get(uri);
      if (pushed && pushed.length > 0) {
        if (format === "json") {
          const diagnostics = pushed.map(d => {
            const loc = d.range.start;
            return {
              file: path.basename(filePath),
              line: loc.line + 1,
              col: loc.character + 1,
              severity: getSeverityString(d.severity),
              message: d.message,
              source: d.source,
              code: d.code
            };
          });
          return JSON.stringify({ lsp_available: true, diagnostics });
        }
        return formatDiagnostics(pushed, filePath);
      }

      // No push diagnostics arrived either — might just be clean
      // Check if the server has published empty diagnostics (meaning it processed the file)
      if (pushed !== undefined) {
        if (format === "json") {
          return JSON.stringify({ lsp_available: true, diagnostics: [] });
        }
        return "No diagnostics (errors or warnings) found.";
      }

      // Server hasn't responded at all — wait a bit more for large projects
      await sleepWithSignal(2000, collection.signal, "LSP diagnostics");
      const delayedPushed = s.publishedDiagnostics.get(uri);
      if (delayedPushed && delayedPushed.length > 0) {
        if (format === "json") {
          const diagnostics = delayedPushed.map(d => {
            const loc = d.range.start;
            return {
              file: path.basename(filePath),
              line: loc.line + 1,
              col: loc.character + 1,
              severity: getSeverityString(d.severity),
              message: d.message,
              source: d.source,
              code: d.code
            };
          });
          return JSON.stringify({ lsp_available: true, diagnostics });
        }
        return formatDiagnostics(delayedPushed, filePath);
      }
      if (delayedPushed !== undefined) {
        if (format === "json") {
          return JSON.stringify({ lsp_available: true, diagnostics: [] });
        }
        return "No diagnostics (errors or warnings) found.";
      }

      if (format === "json") {
        return JSON.stringify({ lsp_available: true, diagnostics: [] });
      }
      return "Diagnostics not available — the language server may still be indexing. Try again in a few seconds, or use `bash tsc --noEmit` for TypeScript.";
    }
  } catch (err) {
    // Handle LSP server unavailability gracefully
    if (format === "json") {
      const error = err instanceof Error ? err.message : String(err);
      return JSON.stringify({ lsp_available: false, error: error });
    }
    throw err;
  }
}

function formatDiagnostics(items: DiagnosticItem[], filePath: string): string {
  const severityMap: Record<number, string> = { 1: "ERROR", 2: "WARNING", 3: "INFO", 4: "HINT" };

  // Sort: errors first, then warnings, then info/hint
  const sorted = [...items].sort((a, b) => (a.severity || 1) - (b.severity || 1));

  const errorCount = sorted.filter((d) => (d.severity || 1) === 1).length;
  const warnCount = sorted.filter((d) => (d.severity || 1) === 2).length;
  const otherCount = sorted.length - errorCount - warnCount;

  const header = `${sorted.length} diagnostic(s) in ${path.basename(filePath)}: ${errorCount} error(s), ${warnCount} warning(s)${otherCount > 0 ? `, ${otherCount} info/hint` : ""}`;
  const lines: string[] = [header, ""];

  for (const d of sorted) {
    const sev = severityMap[d.severity || 1] || "UNKNOWN";
    const loc = `${d.range.start.line + 1}:${d.range.start.character + 1}`;
    const code = d.code ? ` (${d.code})` : "";
    lines.push(`  ${sev} ${loc} — ${d.message}${code}${d.source ? ` [${d.source}]` : ""}`);
  }
  return lines.join("\n");
}

async function getDefinition(filePath: string, line: number, character: number, workingDir: string, collection: ResourceCollection): Promise<string> {
  const s = await ensureServer(collection);
  syncFile(s, filePath);

  const result = (await sendRequest(s, "textDocument/definition", {
    textDocument: { uri: fileUri(filePath) },
    position: { line: line - 1, character: character - 1 },
  }, collection.signal, collection.requestTimeoutMs)) as LocationResult[] | LocationResult | null;

  if (!result) return "No definition found.";

  const locations = Array.isArray(result) ? result : [result];
  if (locations.length === 0) return "No definition found.";

  const lines: string[] = [];
  for (const loc of locations) {
    const defPath = loc.uri.replace("file://", "");
    const relPath = path.relative(workingDir, defPath);
    lines.push(`${relPath}:${loc.range.start.line + 1}:${loc.range.start.character + 1}`);
  }
  return `Definition(s):\n${lines.join("\n")}`;
}

async function getReferences(filePath: string, line: number, character: number, workingDir: string, collection: ResourceCollection): Promise<string> {
  const s = await ensureServer(collection);
  syncFile(s, filePath);

  const result = (await sendRequest(s, "textDocument/references", {
    textDocument: { uri: fileUri(filePath) },
    position: { line: line - 1, character: character - 1 },
    context: { includeDeclaration: true },
  }, collection.signal, collection.requestTimeoutMs)) as LocationResult[] | null;

  if (!result || result.length === 0) return "No references found.";

  const lines: string[] = [`${result.length} reference(s):`];
  for (const ref of result) {
    const refPath = ref.uri.replace("file://", "");
    const relPath = path.relative(workingDir, refPath);
    lines.push(`  ${relPath}:${ref.range.start.line + 1}:${ref.range.start.character + 1}`);
  }
  return lines.join("\n");
}

async function getHover(filePath: string, line: number, character: number, workingDir: string, collection: ResourceCollection): Promise<string> {
  const s = await ensureServer(collection);
  syncFile(s, filePath);

  const result = (await sendRequest(s, "textDocument/hover", {
    textDocument: { uri: fileUri(filePath) },
    position: { line: line - 1, character: character - 1 },
  }, collection.signal, collection.requestTimeoutMs)) as { contents: string | { value: string; kind?: string } | Array<string | { value: string }> } | null;

  if (!result) return "No hover info available.";

  const contents = result.contents;
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) {
    return contents.map((c) => (typeof c === "string" ? c : c.value)).join("\n\n");
  }
  return contents.value || "No hover info available.";
}

async function getSymbols(filePath: string, workingDir: string, collection: ResourceCollection): Promise<string> {
  const s = await ensureServer(collection);
  syncFile(s, filePath);

  const result = (await sendRequest(s, "textDocument/documentSymbol", {
    textDocument: { uri: fileUri(filePath) },
  }, collection.signal, collection.requestTimeoutMs)) as Array<Record<string, unknown>> | null;

  if (!result || result.length === 0) return "No symbols found.";

  const kindMap: Record<number, string> = {
    1: "File", 2: "Module", 3: "Namespace", 4: "Package", 5: "Class",
    6: "Method", 7: "Property", 8: "Field", 9: "Constructor", 10: "Enum",
    11: "Interface", 12: "Function", 13: "Variable", 14: "Constant",
    15: "String", 16: "Number", 17: "Boolean", 18: "Array", 19: "Object",
    20: "Key", 21: "Null", 22: "EnumMember", 23: "Struct", 24: "Event",
    25: "Operator", 26: "TypeParameter",
  };

  // LSP servers return either DocumentSymbol[] (has range, children)
  // or SymbolInformation[] (has location.range, no children)
  function getLine(sym: Record<string, unknown>): number {
    // DocumentSymbol format: { range: { start: { line } } }
    const range = sym.range as { start?: { line?: number } } | undefined;
    if (range?.start?.line !== undefined) return range.start.line;

    // SymbolInformation format: { location: { range: { start: { line } } } }
    const location = sym.location as { range?: { start?: { line?: number } } } | undefined;
    if (location?.range?.start?.line !== undefined) return location.range.start.line;

    return 0;
  }

  const lines: string[] = [`${result.length} symbol(s) in ${path.basename(filePath)}:`, ""];
  function formatSymbol(sym: Record<string, unknown>, indent: number): void {
    const kind = kindMap[sym.kind as number] || `Kind(${sym.kind})`;
    lines.push(`${"  ".repeat(indent)}${kind} ${sym.name} (line ${getLine(sym) + 1})`);
    if (Array.isArray(sym.children)) {
      for (const child of sym.children as Array<Record<string, unknown>>) {
        formatSymbol(child, indent + 1);
      }
    }
  }
  for (const sym of result) {
    formatSymbol(sym, 0);
  }
  return lines.join("\n");
}

async function getSymbolReferences(symbol: string, targetPath: string | undefined, includeDeclaration: boolean, workingDir: string, collection: ResourceCollection): Promise<string> {
  const s = await ensureServer(collection);

  try {
    // Send workspace/symbol request to find the symbol
    const symbolResult = (await sendRequest(s, "workspace/symbol", {
      query: symbol,
    }, collection.signal, collection.requestTimeoutMs)) as Array<Record<string, unknown>> | null;

    if (!symbolResult || symbolResult.length === 0) {
      // No matching symbol found
      return JSON.stringify({
        lsp_available: true,
        symbol,
        references: []
      });
    }

    // Filter for exact name matches
    const exactMatches = symbolResult.filter((sym) => sym.name === symbol);

    if (exactMatches.length === 0) {
      return JSON.stringify({
        lsp_available: true,
        symbol,
        references: []
      });
    }

    // For now, take the first exact match. In a real implementation, we might want to handle multiple declarations.
    const declarationSymbol = exactMatches[0];

    // Extract the location using the same resilient checking as getSymbols
    function getLocation(sym: Record<string, unknown>): { uri: string; range: { start: { line: number; character: number } } } | null {
      // DocumentSymbol format: { range: { start: { line, character } }, uri? }
      const range = sym.range as { start?: { line?: number; character?: number } } | undefined;
      if (range?.start?.line !== undefined && range?.start?.character !== undefined) {
        const uri = (sym as any).uri as string || (sym.location as any)?.uri as string;
        if (uri) {
          return { uri, range: { start: { line: range.start.line, character: range.start.character } } };
        }
      }

      // SymbolInformation format: { location: { uri, range: { start: { line, character } } } }
      const location = sym.location as { uri?: string; range?: { start?: { line?: number; character?: number } } } | undefined;
      if (location?.uri && location?.range?.start?.line !== undefined && location?.range?.start?.character !== undefined) {
        return { uri: location.uri, range: { start: { line: location.range.start.line, character: location.range.start.character } } };
      }

      return null;
    }

    const location = getLocation(declarationSymbol);
    if (!location) {
      return JSON.stringify({
        lsp_available: true,
        symbol,
        references: []
      });
    }

    // Get references using textDocument/references
    // Always set includeDeclaration: false since declaration is handled separately
    const referencesResult = (await sendRequest(s, "textDocument/references", {
      textDocument: { uri: location.uri },
      position: { line: location.range.start.line, character: location.range.start.character },
      context: { includeDeclaration: false },
    }, collection.signal, collection.requestTimeoutMs)) as LocationResult[] | null;

    // Build the response
    const response: {
      lsp_available: boolean;
      symbol: string;
      declaration: { file: string; line: number; col: number };
      references: Array<{ file: string; line: number; col: number; preview: string }>;
    } = {
      lsp_available: true,
      symbol,
      declaration: {
        file: path.relative(workingDir, location.uri.replace("file://", "")),
        line: location.range.start.line + 1,
        col: location.range.start.character + 1,
      },
      references: []
    };

    // Process each reference, optionally filter by path
    const resolvedTargetPath = targetPath ? (path.isAbsolute(targetPath) ? targetPath : path.resolve(workingDir, targetPath)) : null;
    if (referencesResult && referencesResult.length > 0) {
      for (const ref of referencesResult) {
        const refFile = ref.uri.replace("file://", "");
        if (resolvedTargetPath && !refFile.startsWith(resolvedTargetPath)) {
          continue; // Skip references outside the scope
        }
        const relFile = path.relative(workingDir, refFile);

        // Read the file to get the preview
        try {
          const content = fs.readFileSync(refFile, "utf-8");
          const lines = content.split("\n");
          const lineIndex = ref.range.start.line;
          const preview = lines[lineIndex]?.trim() || "";
          response.references.push({
            file: relFile,
            line: ref.range.start.line + 1,
            col: ref.range.start.character + 1,
            preview
          });
        } catch {
          // If we can't read the file, just add without preview
          response.references.push({
            file: relFile,
            line: ref.range.start.line + 1,
            col: ref.range.start.character + 1,
            preview: ""
          });
        }
      }
    }

    return JSON.stringify(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({
      lsp_available: false,
      error: message
    });
  }
}

// ---------------------------------------------------------------------------
// Main execute
// ---------------------------------------------------------------------------

interface LspParams {
  action: "diagnostics" | "definition" | "references" | "hover" | "symbols" | "symbol_references";
  file?: string;
  line?: number;
  character?: number;
  path?: string;
  severity?: "error" | "warning" | "hint" | "all";
  format?: "json" | "text";
  symbol?: string;
  include_declaration?: boolean;
}

interface LspResult {
  success: boolean;
  content?: string;
  error?: string;
}

async function executeWithCollection(params: LspParams, collection: ResourceCollection): Promise<LspResult> {
  const workingDir = collection.workspace;
  if (collection.signal.aborted || collection.closed) {
    return { success: false, error: `LSP ${params.action} failed: ${abortError(collection.signal, `LSP run ${collection.runId}`).message}` };
  }
  const { action, file, line, character, path: targetPath, severity = "error", format = "json", symbol, include_declaration = false } = params;

  // If path is provided, we're handling directory diagnostics
  if (targetPath) {
    const resolvedPath = path.isAbsolute(targetPath) ? targetPath : path.resolve(workingDir, targetPath);
    
    // Check if it's a directory
    try {
      const stat = fs.statSync(resolvedPath);
      if (stat.isDirectory()) {
        // Handle directory diagnostics aggregation
        return await getDirectoryDiagnostics(resolvedPath, workingDir, severity, format, collection);
      }
    } catch {
      // If path doesn't exist, continue with file processing
    }
  }

  // For file diagnostics, if file is provided, process it
  if (file) {
    const resolvedFile = path.isAbsolute(file) ? file : path.resolve(workingDir, file);
    if (!fs.existsSync(resolvedFile)) {
      return { success: false, error: `File not found: ${file}` };
    }

    if (["definition", "references", "hover"].includes(action) && (line === undefined || character === undefined)) {
      return { success: false, error: `${action} requires line and character parameters.` };
    }

    if (action === "symbol_references" && !symbol) {
      return { success: false, error: `symbol_references requires symbol parameter.` };
    }

    try {
      let content: string;
      switch (action) {
        case "diagnostics":
          content = await getDiagnostics(resolvedFile, workingDir, format, collection);
          break;
        case "definition":
          content = await getDefinition(resolvedFile, line!, character!, workingDir, collection);
          break;
        case "references":
          content = await getReferences(resolvedFile, line!, character!, workingDir, collection);
          break;
        case "hover":
          content = await getHover(resolvedFile, line!, character!, workingDir, collection);
          break;
        case "symbols":
          content = await getSymbols(resolvedFile, workingDir, collection);
          break;
        case "symbol_references":
          if (!symbol) {
            throw new Error("symbol_references requires symbol parameter.");
          }
          content = await getSymbolReferences(symbol, targetPath, include_declaration, workingDir, collection);
          break;
      }
      return { success: true, content };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      return { success: false, error: `LSP ${action} failed: ${message}` };
    }
  } else {
    // If no file is provided, handle actions that don't require a file
    if (action === "symbol_references") {
      if (!symbol) {
        return { success: false, error: `symbol_references requires symbol parameter.` };
      }
      try {
        const content = await getSymbolReferences(symbol, targetPath, include_declaration, workingDir, collection);
        return { success: true, content };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: `LSP ${action} failed: ${message}` };
      }
    } else if (action === "diagnostics") {
      // Handle directory diagnostics without a specific file
      if (targetPath) {
        const resolvedPath = path.isAbsolute(targetPath) ? targetPath : path.resolve(workingDir, targetPath);
        try {
          const stat = fs.statSync(resolvedPath);
          if (stat.isDirectory()) {
            return await getDirectoryDiagnostics(resolvedPath, workingDir, severity, format, collection);
          }
        } catch {
          return { success: false, error: `Path not found or not a directory: ${targetPath}` };
        }
      }

      return { success: false, error: "No file or directory path provided." };
    } else {
      return { success: false, error: `Action ${action} requires a file parameter.` };
    }
  }
}

function makeCollection(options: LSPRunResourcesOptions): ResourceCollection {
  const startupTimeoutMs = validateLimit("LSP startupTimeoutMs", options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS);
  const requestTimeoutMs = validateLimit("LSP requestTimeoutMs", options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
  const maxResponseBytes = validateLimit("LSP maxResponseBytes", options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES);
  const terminationGraceMs = validateLimit("LSP terminationGraceMs", options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS);
  const workspace = canonicalWorkspace(options.workspace);
  const controller = new AbortController();
  const parentAbortListener = () => controller.abort(options.signal.reason);
  if (options.signal.aborted) parentAbortListener();
  else options.signal.addEventListener("abort", parentAbortListener, { once: true });
  return {
    runId: options.runId,
    workspace,
    signal: controller.signal,
    controller,
    parentSignal: options.signal,
    parentAbortListener,
    startupTimeoutMs,
    requestTimeoutMs,
    maxResponseBytes,
    terminationGraceMs,
    override: options.server,
    ownedServers: new Set(),
    closed: false,
  };
}

function closeCollection(collection: ResourceCollection): Promise<void> {
  if (collection.closePromise) return collection.closePromise;
  collection.closed = true;
  collection.controller.abort(new Error(`LSP run ${collection.runId} closed`));
  collection.closePromise = (async () => {
    const servers = [...collection.ownedServers];
    const results = await Promise.allSettled(servers.map((server) => closeServer(collection, server)));
    await Promise.allSettled(collection.starting ? [collection.starting] : []);
    collection.parentSignal.removeEventListener("abort", collection.parentAbortListener);
    if (collection.runAbortListener) collection.parentSignal.removeEventListener("abort", collection.runAbortListener);
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (errors.length > 0) throw new AggregateError(errors, `LSP run ${collection.runId} cleanup failed`);
    runCollections.delete(collection);
    for (const [workspace, candidate] of legacyCollections) {
      if (candidate === collection) legacyCollections.delete(workspace);
    }
  })();
  return collection.closePromise.catch((error: unknown) => {
    // Keep failed ownership visible and make a subsequent awaited close retry.
    collection.closePromise = undefined;
    throw error;
  });
}

/** Create a cancellable, run-owned LSP lifetime. Call close() during run teardown. */
export function createLSPRunResources(options: LSPRunResourcesOptions): LSPRunResources {
  const collection = makeCollection(options);
  runCollections.add(collection);
  const onAbort = () => {
    void closeCollection(collection).catch((error) => {
      logger.error(`LSP run ${options.runId} cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  };
  collection.runAbortListener = onAbort;
  if (options.signal.aborted) onAbort();
  else options.signal.addEventListener("abort", onAbort, { once: true });

  return {
    runId: collection.runId,
    workspace: collection.workspace,
    execute: (params) => executeWithCollection(params, collection),
    close: () => closeCollection(collection),
    isRunning: () => Boolean(collection.server?.ready && !collection.server.closed && collection.server.process.exitCode === null),
    getServerLanguage: () => collection.server?.language ?? null,
  };
}

function legacyCollection(workingDir: string): ResourceCollection {
  const workspace = canonicalWorkspace(workingDir);
  const existing = legacyCollections.get(workspace);
  if (existing && !existing.closed) return existing;
  const signal = new AbortController();
  const collection = makeCollection({ runId: `legacy:${workspace}`, workspace, signal: signal.signal });
  legacyCollections.set(workspace, collection);
  return collection;
}

/** Compatibility entry point for callers not yet migrated to a run resource. */
export async function execute(params: LspParams, workingDir: string): Promise<LspResult> {
  return executeWithCollection(params, legacyCollection(workingDir));
}

/** Await teardown for every resource owned by a run, including lazy registry resources. */
export async function shutdownLSPRun(runId: string): Promise<void> {
  const collections = [...runCollections].filter((collection) => collection.runId === runId);
  const results = await Promise.allSettled(collections.map((collection) => closeCollection(collection)));
  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  if (errors.length > 0) throw new AggregateError(errors, `LSP run ${runId} cleanup failed`);
}

/**
 * Shut down the language server process. Call on CLI exit.
 */
export function shutdown(): void {
  for (const collection of [...legacyCollections.values(), ...runCollections]) {
    for (const server of collection.ownedServers) signalProcessGroup(server.process, "SIGKILL");
    void closeCollection(collection).catch((error) => {
      logger.error(`LSP emergency shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
  legacyCollections.clear();
}

/**
 * Check if a language server is currently running.
 */
export function isRunning(): boolean {
  return [...legacyCollections.values()].some((collection) =>
    Boolean(collection.server?.ready && !collection.server.closed && collection.server.process.exitCode === null),
  );
}

/**
 * Get the current server's language, or null if no server is running.
 */
export function getServerLanguage(): string | null {
  return [...legacyCollections.values()].find((collection) => collection.server?.ready)?.server?.language ?? null;
}

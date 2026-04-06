import { spawn, type ChildProcess } from "child_process";
import path from "path";
import fs from "fs";

export const name = "lsp";

export const description =
  "Query the language server for code intelligence: diagnostics (type errors/warnings), " +
  "go-to-definition, find-references, hover info, and workspace symbols. " +
  "Auto-detects and spawns the correct language server (TypeScript, Python, Go, Rust). " +
  "For TypeScript, auto-provisions via npx. Other languages require a globally installed server. " +
  "Use after editing files to check for type errors without running a full build.";

export const parameters = {
  type: "object" as const,
  properties: {
    action: {
      type: "string" as const,
      enum: ["diagnostics", "definition", "references", "hover", "symbols"],
      description:
        "diagnostics: get errors/warnings for a file. " +
        "definition: go to definition of symbol at position. " +
        "references: find all references to symbol at position. " +
        "hover: get type info for symbol at position. " +
        "symbols: list all symbols in a file.",
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
  },
  required: ["action", "file"] as const,
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
  responseBuffer: string;
  pendingRequests: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
  openFiles: Map<string, number>; // uri -> version
  publishedDiagnostics: Map<string, DiagnosticItem[]>; // uri -> diagnostics from push notifications
  ready: boolean;
}

let server: ServerState | null = null;
let initPromise: Promise<void> | null = null;

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
  try {
    const { execSync } = require("child_process");
    execSync(`which ${cmd}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
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
  if (!s.process.stdin?.writable) return;
  const body = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
  s.process.stdin.write(header + body);
}

function sendRequest(s: ServerState, method: string, params: unknown): Promise<unknown> {
  const id = s.requestId++;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      s.pendingRequests.delete(id);
      reject(new Error(`LSP request timed out after 30s: ${method}`));
    }, 30000);

    s.pendingRequests.set(id, {
      resolve: (v) => {
        clearTimeout(timeout);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timeout);
        reject(e);
      },
    });
    sendMessage(s, { jsonrpc: "2.0", id, method, params });
  });
}

function sendNotification(s: ServerState, method: string, params: unknown): void {
  sendMessage(s, { jsonrpc: "2.0", method, params });
}

function handleData(s: ServerState, data: Buffer): void {
  s.responseBuffer += data.toString();

  while (true) {
    const headerEnd = s.responseBuffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;

    const header = s.responseBuffer.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      s.responseBuffer = s.responseBuffer.slice(headerEnd + 4);
      continue;
    }

    const contentLength = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    if (s.responseBuffer.length < bodyStart + contentLength) break;

    const body = s.responseBuffer.slice(bodyStart, bodyStart + contentLength);
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
// Server lifecycle
// ---------------------------------------------------------------------------

function destroyServer(): void {
  // Always clear initPromise — even if server never started (e.g. failed detection)
  initPromise = null;

  if (!server) return;
  const s = server;
  server = null;

  // Reject all pending requests
  for (const [, pending] of s.pendingRequests) {
    pending.reject(new Error("LSP server shut down"));
  }
  s.pendingRequests.clear();

  // Best-effort graceful shutdown
  try {
    sendRequest(s, "shutdown", null).catch(() => {});
    sendNotification(s, "exit", null);
  } catch {
    // ignore
  }
  setTimeout(() => {
    try {
      s.process.kill();
    } catch {
      // already dead
    }
  }, 2000);
}

async function ensureServer(workingDir: string): Promise<ServerState> {
  // If server exists and is still alive, reuse it
  if (server?.ready && server.process.exitCode === null) {
    return server;
  }

  // Server died — clean up stale state
  if (server) {
    destroyServer();
  }

  if (initPromise) {
    await initPromise;
    if (!server) throw new Error("LSP server initialization failed");
    return server;
  }

  const doInit = async () => {
    const detected = detectLanguage(workingDir);
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

    const s: ServerState = {
      process: spawn(detected.command, detected.args, {
        cwd: workingDir,
        stdio: ["pipe", "pipe", "pipe"],
      }),
      language: detected.language,
      requestId: 1,
      responseBuffer: "",
      pendingRequests: new Map(),
      openFiles: new Map(),
      publishedDiagnostics: new Map(),
      ready: false,
    };

    s.process.stdout!.on("data", (data: Buffer) => handleData(s, data));
    s.process.stderr!.on("data", () => {
      // Absorb stderr — language servers are noisy
    });

    // Crash recovery: clean up state when server exits unexpectedly
    s.process.on("exit", (code) => {
      if (server === s) {
        server = null;
        initPromise = null;
      }
    });

    s.process.on("error", (err) => {
      // Spawn failure — reject all pending and clean up
      for (const [, pending] of s.pendingRequests) {
        pending.reject(new Error(`LSP server failed to start: ${err.message}`));
      }
      s.pendingRequests.clear();
      if (server === s) {
        server = null;
        initPromise = null;
      }
    });

    // LSP initialize handshake
    await sendRequest(s, "initialize", {
      processId: process.pid,
      rootUri: `file://${workingDir}`,
      capabilities: {
        textDocument: {
          publishDiagnostics: { relatedInformation: true },
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
      },
    });

    sendNotification(s, "initialized", {});
    s.ready = true;
    server = s;
  };

  initPromise = doInit().catch((err) => {
    // Clear initPromise on failure so the next call can retry
    initPromise = null;
    throw err;
  });

  await initPromise;
  if (!server) throw new Error("LSP server initialization failed");
  return server;
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
// Tool actions
// ---------------------------------------------------------------------------

async function getDiagnostics(filePath: string, workingDir: string): Promise<string> {
  const s = await ensureServer(workingDir);
  const uri = fileUri(path.resolve(filePath));

  // Clear any stale push diagnostics for this file
  s.publishedDiagnostics.delete(uri);

  // Sync file content to server
  syncFile(s, filePath);

  // Try pull diagnostics first (LSP 3.17+)
  try {
    const result = await sendRequest(s, "textDocument/diagnostic", {
      textDocument: { uri },
    }) as { items?: DiagnosticItem[] } | null;

    const items = result?.items || [];
    if (items.length === 0) return "No diagnostics (errors or warnings) found.";
    return formatDiagnostics(items, filePath);
  } catch {
    // Server doesn't support pull diagnostics — wait for push diagnostics
    // Give the server a moment to publish diagnostics after our didOpen/didChange
    await new Promise((r) => setTimeout(r, 1500));

    const pushed = s.publishedDiagnostics.get(uri);
    if (pushed && pushed.length > 0) {
      return formatDiagnostics(pushed, filePath);
    }

    // No push diagnostics arrived either — might just be clean
    // Check if the server has published empty diagnostics (meaning it processed the file)
    if (pushed !== undefined) {
      return "No diagnostics (errors or warnings) found.";
    }

    // Server hasn't responded at all — wait a bit more for large projects
    await new Promise((r) => setTimeout(r, 2000));
    const delayedPushed = s.publishedDiagnostics.get(uri);
    if (delayedPushed && delayedPushed.length > 0) {
      return formatDiagnostics(delayedPushed, filePath);
    }
    if (delayedPushed !== undefined) {
      return "No diagnostics (errors or warnings) found.";
    }

    return "Diagnostics not available — the language server may still be indexing. Try again in a few seconds, or use `bash tsc --noEmit` for TypeScript.";
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

async function getDefinition(filePath: string, line: number, character: number, workingDir: string): Promise<string> {
  const s = await ensureServer(workingDir);
  syncFile(s, filePath);

  const result = (await sendRequest(s, "textDocument/definition", {
    textDocument: { uri: fileUri(filePath) },
    position: { line: line - 1, character: character - 1 },
  })) as LocationResult[] | LocationResult | null;

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

async function getReferences(filePath: string, line: number, character: number, workingDir: string): Promise<string> {
  const s = await ensureServer(workingDir);
  syncFile(s, filePath);

  const result = (await sendRequest(s, "textDocument/references", {
    textDocument: { uri: fileUri(filePath) },
    position: { line: line - 1, character: character - 1 },
    context: { includeDeclaration: true },
  })) as LocationResult[] | null;

  if (!result || result.length === 0) return "No references found.";

  const lines: string[] = [`${result.length} reference(s):`];
  for (const ref of result) {
    const refPath = ref.uri.replace("file://", "");
    const relPath = path.relative(workingDir, refPath);
    lines.push(`  ${relPath}:${ref.range.start.line + 1}:${ref.range.start.character + 1}`);
  }
  return lines.join("\n");
}

async function getHover(filePath: string, line: number, character: number, workingDir: string): Promise<string> {
  const s = await ensureServer(workingDir);
  syncFile(s, filePath);

  const result = (await sendRequest(s, "textDocument/hover", {
    textDocument: { uri: fileUri(filePath) },
    position: { line: line - 1, character: character - 1 },
  })) as { contents: string | { value: string; kind?: string } | Array<string | { value: string }> } | null;

  if (!result) return "No hover info available.";

  const contents = result.contents;
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) {
    return contents.map((c) => (typeof c === "string" ? c : c.value)).join("\n\n");
  }
  return contents.value || "No hover info available.";
}

async function getSymbols(filePath: string, workingDir: string): Promise<string> {
  const s = await ensureServer(workingDir);
  syncFile(s, filePath);

  const result = (await sendRequest(s, "textDocument/documentSymbol", {
    textDocument: { uri: fileUri(filePath) },
  })) as Array<Record<string, unknown>> | null;

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

// ---------------------------------------------------------------------------
// Main execute
// ---------------------------------------------------------------------------

interface LspParams {
  action: "diagnostics" | "definition" | "references" | "hover" | "symbols";
  file: string;
  line?: number;
  character?: number;
}

interface LspResult {
  success: boolean;
  content?: string;
  error?: string;
}

export async function execute(params: LspParams, workingDir: string): Promise<LspResult> {
  const { action, file, line, character } = params;

  const resolvedFile = path.isAbsolute(file) ? file : path.resolve(workingDir, file);
  if (!fs.existsSync(resolvedFile)) {
    return { success: false, error: `File not found: ${file}` };
  }

  if (["definition", "references", "hover"].includes(action) && (line === undefined || character === undefined)) {
    return { success: false, error: `${action} requires line and character parameters.` };
  }

  try {
    let content: string;
    switch (action) {
      case "diagnostics":
        content = await getDiagnostics(resolvedFile, workingDir);
        break;
      case "definition":
        content = await getDefinition(resolvedFile, line!, character!, workingDir);
        break;
      case "references":
        content = await getReferences(resolvedFile, line!, character!, workingDir);
        break;
      case "hover":
        content = await getHover(resolvedFile, line!, character!, workingDir);
        break;
      case "symbols":
        content = await getSymbols(resolvedFile, workingDir);
        break;
    }
    return { success: true, content };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // If the server crashed, clean up so next call will try to restart
    if (server && server.process.exitCode !== null) {
      server = null;
      initPromise = null;
    }

    return { success: false, error: `LSP ${action} failed: ${message}` };
  }
}

/**
 * Shut down the language server process. Call on CLI exit.
 */
export function shutdown(): void {
  destroyServer();
}

/**
 * Check if a language server is currently running.
 */
export function isRunning(): boolean {
  return server !== null && server.ready && server.process.exitCode === null;
}

/**
 * Get the current server's language, or null if no server is running.
 */
export function getServerLanguage(): string | null {
  return server?.language ?? null;
}

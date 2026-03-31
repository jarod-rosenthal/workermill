import { execSync, spawn, type ChildProcess } from "child_process";
import path from "path";
import fs from "fs";

export const name = "lsp";

export const description =
  "(Experimental) Query the language server for code intelligence: diagnostics (type errors/warnings), " +
  "go-to-definition, find-references, hover info, and workspace symbols. " +
  "Auto-detects and spawns the correct language server (TypeScript, Python, Go, Rust). " +
  "Requires a language server installed on the machine — falls back gracefully if unavailable. " +
  "For TypeScript, tries npx automatically. If this tool fails, use bash (e.g. npx tsc --noEmit) or grep instead.";

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
// LSP JSON-RPC helpers
// ---------------------------------------------------------------------------

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

let serverProcess: ChildProcess | null = null;
let serverLanguage: string | null = null;
let requestId = 1;
let initPromise: Promise<void> | null = null;
let responseBuffer = "";
let pendingRequests: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }> = new Map();

function detectLanguage(workingDir: string): { language: string; command: string; args: string[] } | null {
  // TypeScript / JavaScript
  if (fs.existsSync(path.join(workingDir, "tsconfig.json")) ||
      fs.existsSync(path.join(workingDir, "package.json"))) {
    // Check if typescript-language-server is available
    try {
      execSync("which typescript-language-server", { stdio: "pipe" });
      return { language: "typescript", command: "typescript-language-server", args: ["--stdio"] };
    } catch {
      // Try npx
      try {
        execSync("npx --yes typescript-language-server --version", { stdio: "pipe", timeout: 15000 });
        return { language: "typescript", command: "npx", args: ["--yes", "typescript-language-server", "--stdio"] };
      } catch {
        return null;
      }
    }
  }

  // Python
  if (fs.existsSync(path.join(workingDir, "pyproject.toml")) ||
      fs.existsSync(path.join(workingDir, "setup.py")) ||
      fs.existsSync(path.join(workingDir, "requirements.txt"))) {
    try {
      execSync("which pyright-langserver", { stdio: "pipe" });
      return { language: "python", command: "pyright-langserver", args: ["--stdio"] };
    } catch {
      try {
        execSync("which pylsp", { stdio: "pipe" });
        return { language: "python", command: "pylsp", args: [] };
      } catch {
        return null;
      }
    }
  }

  // Go
  if (fs.existsSync(path.join(workingDir, "go.mod"))) {
    try {
      execSync("which gopls", { stdio: "pipe" });
      return { language: "go", command: "gopls", args: ["serve"] };
    } catch {
      return null;
    }
  }

  // Rust
  if (fs.existsSync(path.join(workingDir, "Cargo.toml"))) {
    try {
      execSync("which rust-analyzer", { stdio: "pipe" });
      return { language: "rust", command: "rust-analyzer", args: [] };
    } catch {
      return null;
    }
  }

  return null;
}

function sendMessage(msg: JsonRpcMessage): void {
  if (!serverProcess?.stdin?.writable) return;
  const body = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
  serverProcess.stdin.write(header + body);
}

function sendRequest(method: string, params: unknown): Promise<unknown> {
  const id = requestId++;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`LSP request timed out: ${method}`));
    }, 30000);

    pendingRequests.set(id, {
      resolve: (v) => { clearTimeout(timeout); resolve(v); },
      reject: (e) => { clearTimeout(timeout); reject(e); },
    });
    sendMessage({ jsonrpc: "2.0", id, method, params });
  });
}

function sendNotification(method: string, params: unknown): void {
  sendMessage({ jsonrpc: "2.0", method, params });
}

function handleData(data: Buffer): void {
  responseBuffer += data.toString();

  while (true) {
    const headerEnd = responseBuffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;

    const header = responseBuffer.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      responseBuffer = responseBuffer.slice(headerEnd + 4);
      continue;
    }

    const contentLength = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    if (responseBuffer.length < bodyStart + contentLength) break;

    const body = responseBuffer.slice(bodyStart, bodyStart + contentLength);
    responseBuffer = responseBuffer.slice(bodyStart + contentLength);

    try {
      const msg = JSON.parse(body) as JsonRpcMessage;
      if (msg.id !== undefined && pendingRequests.has(msg.id)) {
        const pending = pendingRequests.get(msg.id)!;
        pendingRequests.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message));
        } else {
          pending.resolve(msg.result);
        }
      }
      // Notifications (diagnostics published, etc.) are ignored for now
    } catch {
      // Malformed JSON — skip
    }
  }
}

async function ensureServer(workingDir: string): Promise<void> {
  if (serverProcess && serverLanguage) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const detected = detectLanguage(workingDir);
    if (!detected) {
      throw new Error(
        "No language server found. Install one: npm i -g typescript-language-server typescript (TS/JS), " +
        "pip install pyright (Python), go install golang.org/x/tools/gopls@latest (Go), " +
        "or rustup component add rust-analyzer (Rust)."
      );
    }

    serverLanguage = detected.language;
    serverProcess = spawn(detected.command, detected.args, {
      cwd: workingDir,
      stdio: ["pipe", "pipe", "pipe"],
    });

    serverProcess.stdout!.on("data", handleData);
    serverProcess.stderr!.on("data", () => {});
    serverProcess.on("exit", () => {
      serverProcess = null;
      serverLanguage = null;
      initPromise = null;
    });

    // LSP initialize handshake
    const initResult = await sendRequest("initialize", {
      processId: process.pid,
      rootUri: `file://${workingDir}`,
      capabilities: {
        textDocument: {
          publishDiagnostics: { relatedInformation: true },
          definition: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
          hover: { contentFormat: ["plaintext", "markdown"] },
          documentSymbol: { dynamicRegistration: false },
        },
      },
    });

    sendNotification("initialized", {});

    // Small delay for server to finish indexing
    await new Promise((r) => setTimeout(r, 1000));
  })();

  return initPromise;
}

function fileUri(filePath: string): string {
  return `file://${path.resolve(filePath)}`;
}

// Notify the server about a file's current content
function didOpen(filePath: string): void {
  const resolvedPath = path.resolve(filePath);
  const content = fs.readFileSync(resolvedPath, "utf-8");
  const langId = resolvedPath.endsWith(".ts") || resolvedPath.endsWith(".tsx") ? "typescript"
    : resolvedPath.endsWith(".js") || resolvedPath.endsWith(".jsx") ? "javascript"
    : resolvedPath.endsWith(".py") ? "python"
    : resolvedPath.endsWith(".go") ? "go"
    : resolvedPath.endsWith(".rs") ? "rust"
    : "plaintext";

  sendNotification("textDocument/didOpen", {
    textDocument: {
      uri: fileUri(resolvedPath),
      languageId: langId,
      version: 1,
      text: content,
    },
  });
}

// ---------------------------------------------------------------------------
// Tool actions
// ---------------------------------------------------------------------------

interface DiagnosticItem {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  message: string;
  severity?: number;
  source?: string;
}

async function getDiagnostics(filePath: string, workingDir: string): Promise<string> {
  await ensureServer(workingDir);
  didOpen(filePath);

  // Request diagnostics via textDocument/diagnostic (LSP 3.17+) or pull model
  // Many servers publish diagnostics via notification instead — use a pull request with fallback
  try {
    const result = await sendRequest("textDocument/diagnostic", {
      textDocument: { uri: fileUri(filePath) },
    }) as { items?: DiagnosticItem[] } | null;

    const items = result?.items || [];
    if (items.length === 0) return "No diagnostics (errors or warnings) found.";

    return formatDiagnostics(items, filePath);
  } catch {
    // Server doesn't support pull diagnostics — wait briefly for push diagnostics
    // Fall back to a typecheck-style approach: just return what we got
    return "Diagnostics not available via pull model. Use `bash tsc --noEmit` for TypeScript or equivalent.";
  }
}

function formatDiagnostics(items: DiagnosticItem[], filePath: string): string {
  const severityMap: Record<number, string> = { 1: "ERROR", 2: "WARNING", 3: "INFO", 4: "HINT" };
  const lines: string[] = [`${items.length} diagnostic(s) in ${path.basename(filePath)}:`, ""];
  for (const d of items) {
    const sev = severityMap[d.severity || 1] || "UNKNOWN";
    const loc = `${d.range.start.line + 1}:${d.range.start.character + 1}`;
    lines.push(`  ${sev} ${loc} — ${d.message}${d.source ? ` [${d.source}]` : ""}`);
  }
  return lines.join("\n");
}

async function getDefinition(filePath: string, line: number, character: number, workingDir: string): Promise<string> {
  await ensureServer(workingDir);
  didOpen(filePath);

  const result = await sendRequest("textDocument/definition", {
    textDocument: { uri: fileUri(filePath) },
    position: { line: line - 1, character: character - 1 },
  }) as { uri: string; range: { start: { line: number; character: number } } }[] | { uri: string; range: { start: { line: number; character: number } } } | null;

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
  await ensureServer(workingDir);
  didOpen(filePath);

  const result = await sendRequest("textDocument/references", {
    textDocument: { uri: fileUri(filePath) },
    position: { line: line - 1, character: character - 1 },
    context: { includeDeclaration: true },
  }) as { uri: string; range: { start: { line: number; character: number } } }[] | null;

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
  await ensureServer(workingDir);
  didOpen(filePath);

  const result = await sendRequest("textDocument/hover", {
    textDocument: { uri: fileUri(filePath) },
    position: { line: line - 1, character: character - 1 },
  }) as { contents: string | { value: string; kind?: string } | Array<string | { value: string }> } | null;

  if (!result) return "No hover info available.";

  const contents = result.contents;
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) {
    return contents.map((c) => (typeof c === "string" ? c : c.value)).join("\n\n");
  }
  return contents.value || "No hover info available.";
}

async function getSymbols(filePath: string, workingDir: string): Promise<string> {
  await ensureServer(workingDir);
  didOpen(filePath);

  const result = await sendRequest("textDocument/documentSymbol", {
    textDocument: { uri: fileUri(filePath) },
  }) as Array<{ name: string; kind: number; range: { start: { line: number } }; children?: unknown[] }> | null;

  if (!result || result.length === 0) return "No symbols found.";

  const kindMap: Record<number, string> = {
    1: "File", 2: "Module", 3: "Namespace", 4: "Package", 5: "Class",
    6: "Method", 7: "Property", 8: "Field", 9: "Constructor", 10: "Enum",
    11: "Interface", 12: "Function", 13: "Variable", 14: "Constant",
    15: "String", 16: "Number", 17: "Boolean", 18: "Array", 19: "Object",
    20: "Key", 21: "Null", 22: "EnumMember", 23: "Struct", 24: "Event",
    25: "Operator", 26: "TypeParameter",
  };

  const lines: string[] = [`${result.length} symbol(s) in ${path.basename(filePath)}:`, ""];
  function formatSymbol(sym: { name: string; kind: number; range: { start: { line: number } }; children?: unknown[] }, indent: number): void {
    const kind = kindMap[sym.kind] || `Kind(${sym.kind})`;
    lines.push(`${"  ".repeat(indent)}${kind} ${sym.name} (line ${sym.range.start.line + 1})`);
    if (sym.children) {
      for (const child of sym.children as Array<{ name: string; kind: number; range: { start: { line: number } }; children?: unknown[] }>) {
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
    return { success: false, error: `LSP ${action} failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Shut down the language server process. Call on CLI exit.
 */
export function shutdown(): void {
  if (serverProcess) {
    try {
      sendRequest("shutdown", null).catch(() => {});
      sendNotification("exit", null);
    } catch {
      // Best effort
    }
    setTimeout(() => {
      serverProcess?.kill();
      serverProcess = null;
      serverLanguage = null;
      initPromise = null;
    }, 2000);
  }
}

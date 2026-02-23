/**
 * Ollama Manager — lifecycle management for local Ollama server.
 *
 * Finds the ollama binary, starts/stops `ollama serve`, pulls models,
 * and generates embeddings via the Ollama HTTP API.
 */

import { existsSync } from "fs";
import { execFileSync, spawn, type ChildProcess } from "child_process";
import { homedir } from "os";
import { join } from "path";
import * as http from "http";

// ── Types ────────────────────────────────────────────

export interface OllamaStatus {
  installed: boolean;
  running: boolean;
  version: string | null;
  models: string[];
  port: number;
  managedByAgent: boolean;
}

// ── Module state ─────────────────────────────────────

let managedByAgent = false;
let ollamaPid: number | null = null;

// ── HTTP helper (node:http, no axios) ────────────────

function httpRequest(
  url: string,
  options?: { method?: string; body?: unknown; timeout?: number },
): Promise<{ status: number; data: unknown }> {
  const method = options?.method ?? "GET";
  const timeout = options?.timeout ?? 30_000;
  const bodyStr = options?.body != null ? JSON.stringify(options.body) : null;

  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method,
        headers: {
          ...(bodyStr != null
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(bodyStr) }
            : {}),
        },
        timeout,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          let data: unknown;
          try {
            data = JSON.parse(raw);
          } catch {
            data = raw;
          }
          resolve({ status: res.statusCode ?? 0, data });
        });
      },
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`HTTP request timed out after ${timeout}ms: ${method} ${url}`));
    });

    if (bodyStr != null) req.write(bodyStr);
    req.end();
  });
}

// ── Windows fresh PATH helper (mirrors config.ts) ───

function findOnFreshWindowsPath(name: string): string | null {
  if (process.platform !== "win32") return null;

  const allDirs: string[] = [];

  try {
    const sysOut = execFileSync(
      "reg",
      ["query", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment", "/v", "Path"],
      { encoding: "utf-8", timeout: 5000, windowsHide: true },
    );
    const match = sysOut.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.+)/i);
    if (match) allDirs.push(...match[1].trim().split(";").filter(Boolean));
  } catch {
    /* registry read failed */
  }

  try {
    const userOut = execFileSync("reg", ["query", "HKCU\\Environment", "/v", "Path"], {
      encoding: "utf-8",
      timeout: 5000,
      windowsHide: true,
    });
    const match = userOut.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.+)/i);
    if (match) allDirs.push(...match[1].trim().split(";").filter(Boolean));
  } catch {
    /* registry read failed */
  }

  for (const dir of allDirs) {
    const expanded = dir.replace(/%([^%]+)%/g, (_, v: string) => process.env[v] || "");
    const candidate = join(expanded, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// ── Binary discovery ─────────────────────────────────

/**
 * Find the ollama binary. Checks OLLAMA_PATH env, then PATH, then
 * Windows registry PATH, then known install locations.
 */
export function findOllamaPath(): string | null {
  // 1. Explicit env var
  const envPath = process.env.OLLAMA_PATH;
  if (envPath && existsSync(envPath)) return envPath;

  const isWin = process.platform === "win32";
  const name = isWin ? "ollama.exe" : "ollama";

  // 2. Check PATH via which/where.exe (execFileSync, no shell)
  try {
    const cmd = isWin ? "where.exe" : "which";
    const resolved = execFileSync(cmd, [name], {
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
      .trim()
      .split("\n")[0];
    if (resolved && existsSync(resolved)) return resolved;
  } catch {
    /* not on PATH */
  }

  // 3. Windows: re-read PATH from registry (detects post-startup installs)
  if (isWin) {
    const freshResult = findOnFreshWindowsPath(name);
    if (freshResult) return freshResult;
  }

  // 4. Known install locations
  const candidates: string[] = [];

  if (isWin) {
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    candidates.push(
      join(localAppData, "Programs", "Ollama", "ollama.exe"),
      join(process.env.ProgramFiles || "C:\\Program Files", "Ollama", "ollama.exe"),
    );
  } else {
    candidates.push("/usr/local/bin/ollama", "/opt/homebrew/bin/ollama", join(homedir(), ".local", "bin", "ollama"));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

// ── Status ───────────────────────────────────────────

/**
 * Get current Ollama status — installed, running, version, loaded models.
 */
export async function getOllamaStatus(port: number = 11434): Promise<OllamaStatus> {
  const base: OllamaStatus = {
    installed: findOllamaPath() !== null,
    running: false,
    version: null,
    models: [],
    port,
    managedByAgent,
  };

  try {
    // Check models list (also confirms server is up)
    const tagsResp = await httpRequest(`http://localhost:${port}/api/tags`, { timeout: 5_000 });
    if (tagsResp.status === 200 && tagsResp.data && typeof tagsResp.data === "object") {
      base.running = true;
      const body = tagsResp.data as { models?: Array<{ name?: string }> };
      if (Array.isArray(body.models)) {
        base.models = body.models.map((m) => m.name ?? "").filter(Boolean);
      }
    }

    // Get version
    const versionResp = await httpRequest(`http://localhost:${port}/api/version`, { timeout: 5_000 });
    if (versionResp.status === 200 && versionResp.data && typeof versionResp.data === "object") {
      const vBody = versionResp.data as { version?: string };
      base.version = vBody.version ?? null;
    }
  } catch {
    // Connection refused or timeout → server not running
  }

  return base;
}

// ── Lifecycle ────────────────────────────────────────

/**
 * Ensure Ollama is running. Starts the server if needed.
 * Returns true if Ollama is running after this call.
 */
export async function ensureOllamaRunning(port: number = 11434): Promise<boolean> {
  // Already running?
  const status = await getOllamaStatus(port);
  if (status.running) return true;

  // Find binary
  const ollamaPath = findOllamaPath();
  if (!ollamaPath) return false;

  // Spawn `ollama serve` detached
  const child: ChildProcess = spawn(ollamaPath, ["serve"], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, OLLAMA_HOST: `0.0.0.0:${port}` },
  });
  child.unref();

  const childPid = child.pid ?? null;

  // Poll for readiness (1s intervals, 15s max)
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1_000));
    try {
      const check = await httpRequest(`http://localhost:${port}/api/tags`, { timeout: 2_000 });
      if (check.status === 200) {
        managedByAgent = true;
        ollamaPid = childPid;
        return true;
      }
    } catch {
      // Not ready yet
    }
  }

  // Failed to start — clean up
  if (childPid) {
    try {
      process.kill(childPid);
    } catch {
      /* already dead */
    }
  }
  return false;
}

// ── Model management ─────────────────────────────────

/**
 * Pull (download) a model. Returns true on success.
 */
export async function pullModel(model: string, port: number = 11434): Promise<boolean> {
  try {
    const resp = await httpRequest(`http://localhost:${port}/api/pull`, {
      method: "POST",
      body: { name: model },
      timeout: 300_000, // 5 minutes — models can be large
    });
    return resp.status === 200;
  } catch {
    return false;
  }
}

// ── Embeddings ───────────────────────────────────────

/**
 * Generate embeddings for an array of texts.
 * Returns number[][] where each inner array is a 768-dim vector.
 */
export async function generateEmbeddings(
  texts: string[],
  model: string = "nomic-embed-text",
  port: number = 11434,
): Promise<number[][]> {
  const resp = await httpRequest(`http://localhost:${port}/api/embed`, {
    method: "POST",
    body: { model, input: texts },
    timeout: 120_000,
  });

  if (resp.status !== 200) {
    throw new Error(`Ollama embed failed with status ${resp.status}`);
  }

  const body = resp.data as { embeddings?: number[][] };
  if (!Array.isArray(body.embeddings)) {
    throw new Error("Ollama embed response missing 'embeddings' array");
  }

  // Validate dimensions
  for (let i = 0; i < body.embeddings.length; i++) {
    if (body.embeddings[i].length !== 768) {
      throw new Error(
        `Embedding ${i} has ${body.embeddings[i].length} dimensions, expected 768`,
      );
    }
  }

  return body.embeddings;
}

// ── Shutdown ─────────────────────────────────────────

/**
 * Stop the Ollama server — only if it was started by this agent.
 */
export async function stopOllama(): Promise<void> {
  if (!managedByAgent || ollamaPid === null) return;

  try {
    process.kill(ollamaPid);
  } catch {
    /* already dead */
  }

  managedByAgent = false;
  ollamaPid = null;
}

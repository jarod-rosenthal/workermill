import { beforeAll, describe, expect, it } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import pty from "node-pty";
import { detectOllamaHost } from "../helpers/ollama-host.js";

const MODEL = "qwen3-coder:30b";
const CONTEXT_LENGTH = 65536;
const MODEL_COMMAND = "/model ollama/qwen3-coder:30b 64k";
const DISPATCH_BUDGET_MS = 5000;
const EXECUTION_BUDGET_MS = 5000;

let OLLAMA_HOST = "";
let ollamaAvailable = false;

beforeAll(async () => {
  const host = await detectOllamaHost();
  if (!host) return;
  OLLAMA_HOST = host;
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (!res.ok) return;
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const models = data.models ?? [];
    ollamaAvailable = models.some((m) => m.name.startsWith("qwen3-coder:30b"));
  } catch {
    // Ollama unavailable
  }
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readLog(logFile: string): string {
  if (!fs.existsSync(logFile)) return "";
  return fs.readFileSync(logFile, "utf-8");
}

function tailLog(text: string, lineCount = 40): string {
  return text.split("\n").slice(-lineCount).join("\n");
}

async function waitForLog(
  logFile: string,
  predicate: (text: string) => boolean,
  timeoutMs: number,
  errMessage: string,
): Promise<string> {
  const start = Date.now();
  while (true) {
    const text = readLog(logFile);
    if (predicate(text)) return text;
    if (Date.now() - start > timeoutMs) {
      throw new Error(errMessage + `\n\nLast log tail:\n${tailLog(text)}`);
    }
    await sleep(250);
  }
}

function initGitRepo(repoDir: string): void {
  execSync("git init -b main", { cwd: repoDir, stdio: "pipe" });
  execSync("git config user.name 'WM E2E'", { cwd: repoDir, stdio: "pipe" });
  execSync("git config user.email 'wm-e2e@example.com'", { cwd: repoDir, stdio: "pipe" });
  fs.writeFileSync(path.join(repoDir, "README.md"), "# E2E\n", "utf-8");
  execSync("git add README.md", { cwd: repoDir, stdio: "pipe" });
  execSync("git commit -m 'init'", { cwd: repoDir, stdio: "pipe" });
  execSync("git checkout -b GH-1/add-product-export", { cwd: repoDir, stdio: "pipe" });
  execSync("git checkout main", { cwd: repoDir, stdio: "pipe" });
}

function writeCliConfig(homeDir: string): void {
  const wmDir = path.join(homeDir, ".workermill");
  fs.mkdirSync(wmDir, { recursive: true });
  const cfg = {
    providers: {
      ollama: {
        model: MODEL,
        host: OLLAMA_HOST,
        contextLength: CONTEXT_LENGTH,
      },
    },
    default: "ollama",
    review: {
      enabled: false,
    },
    mcp: {},
  };
  fs.writeFileSync(path.join(wmDir, "cli.json"), JSON.stringify(cfg, null, 2) + "\n", "utf-8");
}

function parseBashExecuteDurations(logText: string): number[] {
  const durations: number[] = [];
  const re = /wrapper:after_execute \{"tool":"bash","executeDurationMs":(\d+),"sinceWrapperEnterMs":(\d+)\}/g;
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(logText)) !== null) {
    durations.push(Number(m[1]));
  }
  return durations;
}

function parseBashDispatchDurations(logText: string): number[] {
  const durations: number[] = [];
  const re = /wrapper:before_execute \{"tool":"bash","sinceWrapperEnterMs":(\d+)\}/g;
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(logText)) !== null) {
    durations.push(Number(m[1]));
  }
  return durations;
}

function parseNativeToolUseCounts(logText: string): number[] {
  const counts: number[] = [];
  const re = /onStepFinish:enter \{[^}]*"callCount":(\d+)/g;
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(logText)) !== null) {
    const count = Number(m[1]);
    if (count > 0) counts.push(count);
  }
  return counts;
}

async function typeLine(proc: pty.IPty, text: string): Promise<void> {
  for (const ch of text) {
    proc.write(ch);
    await sleep(8);
  }
  proc.write("\r");
}

describe("CLI bash dispatch latency", () => {
  it("uses native tool calling in PTY chat and keeps bash dispatch fast", async () => {
    if (!ollamaAvailable) {
      console.log("Skipping: Ollama qwen3-coder:30b not available");
      return;
    }

    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-cli-e2e-repo-"));
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-cli-e2e-home-"));
    let proc: pty.IPty | null = null;

    try {
      initGitRepo(repoDir);
      writeCliConfig(homeDir);

      const projectHash = crypto
        .createHash("md5")
        .update(repoDir)
        .digest("hex")
        .slice(0, 8);
      const logFile = path.join(homeDir, ".workermill", "logs", projectHash, "cli.log");

      const cliRoot = path.resolve(process.cwd());
      const distEntry = path.join(cliRoot, "dist", "index.js");
      if (!fs.existsSync(distEntry)) {
        execSync("npm run build", { cwd: cliRoot, stdio: "pipe" });
      }
      if (!fs.existsSync(distEntry)) {
        throw new Error(`CLI entry not found at ${distEntry} after build`);
      }

      let output = "";
      proc = pty.spawn(process.execPath, [distEntry, "--trust"], {
        name: "xterm-256color",
        cols: 120,
        rows: 40,
        cwd: repoDir,
        env: {
          ...process.env,
          HOME: homeDir,
          TERM: "xterm-256color",
          WM_TRACE_DISPATCH: "1",
        },
      });
      proc.onData((data) => {
        output += data;
      });

      const bootStart = Date.now();
      while (!output.includes("bypassPermissions") && !output.includes("no tool calls")) {
        if (Date.now() - bootStart > 30000) {
          throw new Error(`CLI did not reach ready state.\n\nOutput tail:\n${output.slice(-2000)}`);
        }
        await sleep(100);
      }

      await typeLine(proc!, MODEL_COMMAND);
      await sleep(1500);

      await typeLine(proc!, "hello");
      await waitForLog(
        logFile,
        (text) => text.includes("User message") && text.includes("Response complete"),
        120000,
        "First turn did not complete",
      );

      const beforeSecondPrompt = readLog(logFile);
      const beforeExecuteCount = parseBashExecuteDurations(beforeSecondPrompt).length;
      const beforeDispatchCount = parseBashDispatchDurations(beforeSecondPrompt).length;
      const beforeToolUseCount = parseNativeToolUseCounts(beforeSecondPrompt).length;
      const attemptPrompts = [
        "Use the bash tool to run `git branch --show-current` and answer with only the branch name.",
        "Do not answer from memory. Call bash now with command `git branch --show-current` and return only the result.",
        "Native tool call required: execute bash `git branch --show-current` and print only the branch name.",
      ];

      let logWithBash = "";
      for (const prompt of attemptPrompts) {
        await typeLine(proc!, prompt);
        try {
          logWithBash = await waitForLog(
            logFile,
            (text) =>
              parseNativeToolUseCounts(text).length > beforeToolUseCount
              && parseBashDispatchDurations(text).length > beforeDispatchCount
              && parseBashExecuteDurations(text).length > beforeExecuteCount,
            20000,
            "native bash tool call not yet completed",
          );
          break;
        } catch {
          // try next prompt variant
        }
      }

      if (!logWithBash) {
        throw new Error("No native bash execution logged after retries\n\n" + tailLog(readLog(logFile)));
      }

      const newToolUseCounts = parseNativeToolUseCounts(logWithBash).slice(beforeToolUseCount);
      const newDispatchDurations = parseBashDispatchDurations(logWithBash).slice(beforeDispatchCount);
      const newExecuteDurations = parseBashExecuteDurations(logWithBash).slice(beforeExecuteCount);

      expect(newToolUseCounts.length).toBeGreaterThan(0);
      expect(newDispatchDurations.length).toBeGreaterThan(0);
      expect(newExecuteDurations.length).toBeGreaterThan(0);

      for (const count of newToolUseCounts) {
        expect(count).toBeGreaterThan(0);
      }

      for (const duration of newDispatchDurations) {
        expect(duration).toBeLessThan(DISPATCH_BUDGET_MS);
      }

      for (const duration of newExecuteDurations) {
        expect(duration).toBeLessThan(EXECUTION_BUDGET_MS);
      }

      expect(logWithBash).toContain('"tool":"bash"');
      expect(readLog(logFile)).toContain("main");
      expect(output).not.toContain("<function=bash>");
      expect(output).not.toContain("</tool_call>");
    } finally {
      if (proc) {
        try {
          proc.kill();
        } catch {
          // best effort
        }
      }
      fs.rmSync(repoDir, { recursive: true, force: true });
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });
});

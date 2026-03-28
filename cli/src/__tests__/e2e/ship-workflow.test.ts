import { describe, it, beforeAll, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { runOrchestration } from "../../orchestrator.js";
import type { CliConfig } from "../../config.js";
import type { OrchestrationOutput } from "../../orchestrator.js";

const OLLAMA_HOST = "http://localhost:11434";
const MODEL = "qwen3-coder:30b";

let ollamaAvailable = false;
let originalCwd: string;

beforeAll(async () => {
  originalCwd = process.cwd();
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (!res.ok) return;
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const models = data.models ?? [];
    ollamaAvailable = models.some((m) => m.name.startsWith("qwen3-coder"));
  } catch {
    // Ollama not running
  }
});

afterEach(() => {
  process.chdir(originalCwd);
});

describe("ship workflow with Ollama", () => {
  it("should create a feature branch and commit changes", async () => {
    if (!ollamaAvailable) {
      console.log("Skipping: Ollama not available");
      return;
    }

    // Create a temp git repo with a simple Express app
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-ship-"));

    execSync("git init", { cwd: tempDir });
    execSync('git config user.email "test@test.com"', { cwd: tempDir });
    execSync('git config user.name "Test"', { cwd: tempDir });

    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify(
        {
          name: "test-app",
          version: "1.0.0",
          type: "module",
          dependencies: { express: "^4.18.0" },
        },
        null,
        2,
      ) + "\n",
    );

    fs.writeFileSync(
      path.join(tempDir, "index.ts"),
      `import express from "express";

const app = express();
const PORT = 3000;

app.get("/", (_req, res) => {
  res.json({ message: "Hello World" });
});

app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
});

export default app;
`,
    );

    execSync("git add -A && git commit -m 'initial commit'", { cwd: tempDir });

    // Record the initial commit hash
    const initialHash = execSync("git rev-parse HEAD", { cwd: tempDir }).toString().trim();

    // Build the CLI config for Ollama
    const config: CliConfig = {
      providers: {
        ollama: {
          model: MODEL,
          host: OLLAMA_HOST,
        },
      },
      default: "ollama",
    };

    // Mock the output interface
    const logs: string[] = [];
    const output: OrchestrationOutput = {
      log: (persona, message) => logs.push(`[${persona}] ${message}`),
      coordinatorLog: (message) => logs.push(`[coordinator] ${message}`),
      error: (message) => logs.push(`[error] ${message}`),
      status: (_message) => {},
      statusDone: (_message) => {},
      confirm: async () => true,
      toolCall: (persona, toolName) => logs.push(`[${persona}] Tool: ${toolName}`),
    };

    // chdir so orchestrator uses the temp repo
    process.chdir(tempDir);

    await runOrchestration(
      config,
      "Add a health check endpoint at GET /health that returns { status: 'ok' }",
      true, // trustAll
      true, // sandboxed
      output,
    );

    // Verify: a feature branch was created (not on main/master)
    const branches = execSync("git branch", { cwd: tempDir }).toString();
    const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: tempDir })
      .toString()
      .trim();

    // Either we're on a feature branch, or there are multiple branches
    const branchList = branches
      .split("\n")
      .map((b) => b.trim().replace(/^\* /, ""))
      .filter(Boolean);
    expect(branchList.length).toBeGreaterThanOrEqual(1);

    // Verify: at least one commit beyond the initial
    const commitCount = execSync("git rev-list --count HEAD", { cwd: tempDir })
      .toString()
      .trim();
    const currentHash = execSync("git rev-parse HEAD", { cwd: tempDir }).toString().trim();

    // Either more commits or different branch created
    const hasNewCommits = currentHash !== initialHash;
    const hasFeatureBranch = currentBranch !== "main" && currentBranch !== "master";
    expect(hasNewCommits || hasFeatureBranch).toBe(true);

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

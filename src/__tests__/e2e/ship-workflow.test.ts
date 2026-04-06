import { describe, it, beforeAll, afterEach, expect } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { runOrchestration } from "../../orchestrator.js";
import type { CliConfig } from "../../config.js";
import type { OrchestrationOutput } from "../../orchestrator.js";
import { detectOllamaHost } from "../helpers/ollama-host.js";

let OLLAMA_HOST = "";
const MODEL = "qwen3-coder:30b";

let ollamaAvailable = false;
let originalCwd: string;

beforeAll(async () => {
  originalCwd = process.cwd();
  const host = await detectOllamaHost();
  if (!host) return;
  OLLAMA_HOST = host;
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

function makeConfig(): CliConfig {
  return {
    providers: {
      ollama: {
        model: MODEL,
        host: OLLAMA_HOST,
        contextLength: 65536,
      },
    },
    default: "ollama",
  };
}

function makeOutput(logs: string[]): OrchestrationOutput {
  return {
    log: (persona, message) => logs.push(`[${persona}] ${message}`),
    coordinatorLog: (message) => logs.push(`[coordinator] ${message}`),
    error: (message) => logs.push(`[error] ${message}`),
    status: (_message) => {},
    statusDone: (_message) => {},
    confirm: async () => true,
    toolCall: (persona, toolName) => logs.push(`[${persona}] Tool: ${toolName}`),
  };
}

function initGitRepo(dir: string): void {
  execSync("git init", { cwd: dir });
  execSync('git config user.email "test@test.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
}

/** Recursively collect all files matching an extension under a directory. */
function collectFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
      results.push(...collectFiles(full, ext));
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

describe("ship workflow with Ollama", () => {
  it("/ship creates correct code changes", async () => {
    if (!ollamaAvailable) {
      console.log("Skipping: Ollama not available");
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-ship-health-"));
    try {
      initGitRepo(tempDir);

      // Simple Express app
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify(
          { name: "test-app", version: "1.0.0", type: "module", dependencies: { express: "^4.18.0" } },
          null,
          2,
        ) + "\n",
      );

      fs.writeFileSync(
        path.join(tempDir, "index.js"),
        `import express from "express";

const app = express();
const PORT = 3000;

app.get("/", (_req, res) => {
  res.json({ message: "hello" });
});

app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
});

export default app;
`,
      );

      execSync("git add -A && git commit -m 'initial commit'", { cwd: tempDir });
      const initialHash = execSync("git rev-parse HEAD", { cwd: tempDir }).toString().trim();

      const logs: string[] = [];
      const output = makeOutput(logs);
      const config = makeConfig();

      process.chdir(tempDir);

      const result = await runOrchestration(
        config,
        "Add a health check endpoint at GET /health that returns { status: 'ok', uptime: process.uptime() }",
        true,
        true,
        output,
      );

      // Stories were planned and completed
      expect(result.stories.length).toBeGreaterThan(0);
      expect(result.completedStoryIds.length).toBeGreaterThan(0);

      // Feature branch created (not main/master)
      const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: tempDir }).toString().trim();
      expect(currentBranch).not.toBe("main");
      expect(currentBranch).not.toBe("master");

      // New commits exist
      const currentHash = execSync("git rev-parse HEAD", { cwd: tempDir }).toString().trim();
      expect(currentHash).not.toBe(initialHash);

      // Ground truth: at least one .js/.ts file in the repo contains "health"
      const jsFiles = [...collectFiles(tempDir, ".js"), ...collectFiles(tempDir, ".ts")];
      const anyContainsHealth = jsFiles.some((f) => {
        const content = fs.readFileSync(f, "utf-8");
        return /health/i.test(content);
      });
      expect(anyContainsHealth).toBe(true);

      // Logs contain planner activity
      const hasPlanner = logs.some((l) => l.toLowerCase().includes("planner"));
      expect(hasPlanner).toBe(true);

      // Logs contain at least one worker persona (not planner/coordinator/error)
      const workerPersonas = logs.filter(
        (l) =>
          l.startsWith("[") &&
          !l.startsWith("[planner]") &&
          !l.startsWith("[coordinator]") &&
          !l.startsWith("[error]"),
      );
      expect(workerPersonas.length).toBeGreaterThan(0);

      // Logs contain tech_lead (review happened)
      const hasTechLead = logs.some((l) => l.toLowerCase().includes("tech_lead"));
      expect(hasTechLead).toBe(true);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("/ship decomposes into multiple stories for cross-cutting work", async () => {
    if (!ollamaAvailable) {
      console.log("Skipping: Ollama not available");
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-ship-multi-"));
    try {
      initGitRepo(tempDir);

      // Create backend + frontend structure
      fs.mkdirSync(path.join(tempDir, "backend"));
      fs.mkdirSync(path.join(tempDir, "frontend"));

      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify(
          {
            name: "fullstack-app",
            version: "1.0.0",
            type: "module",
            dependencies: { express: "^4.18.0", react: "^19.0.0" },
          },
          null,
          2,
        ) + "\n",
      );

      fs.writeFileSync(
        path.join(tempDir, "backend", "server.js"),
        `import express from "express";

const app = express();
const PORT = 3001;

app.get("/", (_req, res) => {
  res.json({ message: "API running" });
});

app.listen(PORT, () => {
  console.log(\`Backend on port \${PORT}\`);
});

export default app;
`,
      );

      fs.writeFileSync(
        path.join(tempDir, "frontend", "App.jsx"),
        `import React from "react";

export default function App() {
  return (
    <div>
      <h1>My App</h1>
      <p>Welcome to the application.</p>
    </div>
  );
}
`,
      );

      execSync("git add -A && git commit -m 'initial commit'", { cwd: tempDir });

      const logs: string[] = [];
      const output = makeOutput(logs);
      const config = makeConfig();

      process.chdir(tempDir);

      const result = await runOrchestration(
        config,
        "Add a /version endpoint to the backend that returns the package.json version, and add a VersionBadge component to the frontend that displays it",
        true,
        true,
        output,
      );

      // Planner should decompose into at least 2 stories (backend + frontend)
      expect(result.stories.length).toBeGreaterThanOrEqual(2);

      // Ground truth: at least one file in backend/ was modified or created
      const backendFiles = collectFiles(path.join(tempDir, "backend"), ".js");
      const backendModified = backendFiles.some((f) => {
        const content = fs.readFileSync(f, "utf-8");
        return /version/i.test(content);
      });
      // Also check if any new files were created in backend/
      const backendHasChanges =
        backendModified ||
        backendFiles.length > 1 ||
        collectFiles(path.join(tempDir, "backend"), ".ts").length > 0;
      expect(backendHasChanges).toBe(true);

      // Ground truth: at least one file in frontend/ was modified or created
      const frontendJsx = collectFiles(path.join(tempDir, "frontend"), ".jsx");
      const frontendJs = collectFiles(path.join(tempDir, "frontend"), ".js");
      const frontendTsx = collectFiles(path.join(tempDir, "frontend"), ".tsx");
      const frontendTs = collectFiles(path.join(tempDir, "frontend"), ".ts");
      const allFrontendFiles = [...frontendJsx, ...frontendJs, ...frontendTsx, ...frontendTs];
      const frontendHasChanges =
        allFrontendFiles.length > 1 ||
        allFrontendFiles.some((f) => {
          const content = fs.readFileSync(f, "utf-8");
          return /version/i.test(content) || /VersionBadge/i.test(content);
        });
      expect(frontendHasChanges).toBe(true);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("/ship captures orchestration output", async () => {
    if (!ollamaAvailable) {
      console.log("Skipping: Ollama not available");
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-ship-output-"));
    try {
      initGitRepo(tempDir);

      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify(
          { name: "test-app", version: "1.0.0", type: "module", dependencies: { express: "^4.18.0" } },
          null,
          2,
        ) + "\n",
      );

      fs.writeFileSync(
        path.join(tempDir, "index.js"),
        `import express from "express";

const app = express();
const PORT = 3000;

app.get("/", (_req, res) => {
  res.json({ message: "hello" });
});

app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
});

export default app;
`,
      );

      execSync("git add -A && git commit -m 'initial commit'", { cwd: tempDir });

      const logs: string[] = [];
      const output = makeOutput(logs);
      const config = makeConfig();

      process.chdir(tempDir);

      await runOrchestration(
        config,
        "Add a health check endpoint at GET /health that returns { status: 'ok' }",
        true,
        true,
        output,
      );

      // Planning happened
      const hasPlanner = logs.some((l) => l.toLowerCase().includes("planner"));
      expect(hasPlanner).toBe(true);

      // Tools were used
      const hasToolCall = logs.some((l) => l.includes("Tool:"));
      expect(hasToolCall).toBe(true);

      // Coordination happened
      const hasCoordinator = logs.some((l) => l.toLowerCase().includes("coordinator"));
      expect(hasCoordinator).toBe(true);

      // No errors
      const hasError = logs.some((l) => l.startsWith("[error]"));
      expect(hasError).toBe(false);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

import { describe, it, beforeAll, afterEach, expect } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { runStandaloneReview } from "../../orchestrator.js";
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

function makeOutput(): { output: OrchestrationOutput; logs: string[] } {
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
  return { output, logs };
}

function initGitRepo(dir: string): void {
  execSync("git init", { cwd: dir });
  execSync('git config user.email "test@test.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
}

describe("review workflow with Ollama", () => {
  it("should catch security issues in a feature branch", async () => {
    if (!ollamaAvailable) {
      console.log("Skipping: Ollama not available");
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-review-sec-"));

    try {
      initGitRepo(tempDir);

      // Main branch: clean Express setup
      fs.writeFileSync(
        path.join(tempDir, "server.js"),
        `const express = require('express');
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'Hello World' });
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});

module.exports = app;
`,
      );

      execSync("git add -A && git commit -m 'initial: basic server'", { cwd: tempDir });

      // Feature branch with security issues
      execSync("git checkout -b feature/auth", { cwd: tempDir });

      fs.writeFileSync(
        path.join(tempDir, "auth.js"),
        `const express = require('express');
const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  // Hardcoded admin password
  if (username === 'admin' && password === 'password123') {
    res.json({ token: 'fake-jwt-token-' + Date.now() });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

router.get('/profile', (req, res) => {
  // No authentication check
  res.json({ user: 'admin', role: 'superadmin' });
});

module.exports = router;
`,
      );

      execSync("git add -A && git commit -m 'add auth module'", { cwd: tempDir });

      process.chdir(tempDir);

      const config = makeConfig();
      const { output } = makeOutput();

      const result = await runStandaloneReview(config, output, "branch");

      expect(result).not.toBeNull();
      expect(result!.score).toBeLessThanOrEqual(7);
      expect(result!.decision).not.toBe("approved");

      const feedbackLower = result!.feedback.toLowerCase();
      const caughtSecurity = ["password", "hardcoded", "authentication", "auth"].some((term) =>
        feedbackLower.includes(term),
      );
      expect(caughtSecurity).toBe(true);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should approve well-written code", async () => {
    if (!ollamaAvailable) {
      console.log("Skipping: Ollama not available");
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-review-clean-"));

    try {
      initGitRepo(tempDir);

      // Main branch: basic package.json
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify(
          {
            name: "test-utils",
            version: "1.0.0",
            description: "String utility library",
          },
          null,
          2,
        ) + "\n",
      );

      execSync("git add -A && git commit -m 'initial: package.json'", { cwd: tempDir });

      // Feature branch with clean utility code
      execSync("git checkout -b feature/utils", { cwd: tempDir });

      fs.writeFileSync(
        path.join(tempDir, "utils.js"),
        `/**
 * String utilities with input validation
 */

function capitalize(str) {
  if (typeof str !== 'string') throw new TypeError('Expected a string');
  if (str.length === 0) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function truncate(str, maxLength = 100) {
  if (typeof str !== 'string') throw new TypeError('Expected a string');
  if (typeof maxLength !== 'number' || maxLength < 0) throw new RangeError('maxLength must be non-negative');
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '...';
}

module.exports = { capitalize, truncate };
`,
      );

      execSync("git add -A && git commit -m 'add string utilities'", { cwd: tempDir });

      process.chdir(tempDir);

      const config = makeConfig();
      const { output } = makeOutput();

      const result = await runStandaloneReview(config, output, "branch");

      expect(result).not.toBeNull();
      expect(result!.score).toBeGreaterThanOrEqual(6);
      expect(result!.feedback.length).toBeGreaterThan(0);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should handle uncommitted changes in diff mode", async () => {
    if (!ollamaAvailable) {
      console.log("Skipping: Ollama not available");
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-review-diff-"));

    try {
      initGitRepo(tempDir);

      // Initial commit so the repo is valid
      fs.writeFileSync(
        path.join(tempDir, "README.md"),
        "# Test Project\n",
      );

      execSync("git add -A && git commit -m 'initial commit'", { cwd: tempDir });

      // Write a new file and stage it (but don't commit)
      fs.writeFileSync(
        path.join(tempDir, "helpers.js"),
        `/**
 * Helper functions for data processing.
 */

function sum(arr) {
  if (!Array.isArray(arr)) throw new TypeError('Expected an array');
  return arr.reduce((acc, val) => acc + val, 0);
}

function average(arr) {
  if (!Array.isArray(arr)) throw new TypeError('Expected an array');
  if (arr.length === 0) throw new RangeError('Cannot compute average of empty array');
  return sum(arr) / arr.length;
}

module.exports = { sum, average };
`,
      );

      // Stage the file so `git diff HEAD` picks it up
      execSync("git add helpers.js", { cwd: tempDir });

      process.chdir(tempDir);

      const config = makeConfig();
      const { output } = makeOutput();

      const result = await runStandaloneReview(config, output, "diff");

      expect(result).not.toBeNull();
      expect(typeof result!.score).toBe("number");
      expect(result!.feedback.length).toBeGreaterThan(0);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

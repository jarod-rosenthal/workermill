import { describe, it, beforeAll, expect } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { EngineAIClient } from "../../../../packages/engine/src/ai-client.js";
import type { StreamMessage } from "../../../../packages/engine/src/types.js";
import { detectOllamaHost } from "../helpers/ollama-host.js";

let OLLAMA_HOST = "";
const MODEL = "qwen3-coder:30b";

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
    ollamaAvailable = models.some((m) => m.name.startsWith("qwen3-coder"));
  } catch {
    // Ollama not running
  }
});

function makeClient(): EngineAIClient {
  return new EngineAIClient({
    provider: "ollama",
    apiKeys: { ollamaHost: OLLAMA_HOST },
  });
}

/**
 * Check whether a tool was invoked via native function calling (tool_use).
 * XML text fallback is treated as a test failure path.
 */
function toolWasCalled(messages: StreamMessage[], toolName: string): boolean {
  return messages.some(
    (m) => m.type === "tool_use" && m.toolName === toolName,
  );
}

describe("tool execution with Ollama", () => {
  it("glob finds files and agent reports correct count", async () => {
    if (!ollamaAvailable) {
      console.log("Skipping: Ollama not available");
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-glob-"));

    try {
      // Create 3 .ts files and 2 .md files
      fs.writeFileSync(path.join(tempDir, "index.ts"), "export const main = true;\n");
      fs.writeFileSync(path.join(tempDir, "utils.ts"), "export const util = true;\n");
      fs.writeFileSync(path.join(tempDir, "config.ts"), "export const config = {};\n");
      fs.writeFileSync(path.join(tempDir, "readme.md"), "# Project\n");
      fs.writeFileSync(path.join(tempDir, "changelog.md"), "# Changelog\n");

      const messages: StreamMessage[] = [];

      const result = await makeClient().execute({
        systemPrompt:
          "You are a file system assistant. You have these tools: glob, read_file, write_file, grep, bash. " +
          "When asked to find files by pattern, you MUST call the `glob` tool. Do NOT use bash or ls for file discovery.",
        prompt:
          "Use glob to find all TypeScript files (pattern '**/*.ts') and tell me exactly how many there are.",
        persona: "backend_developer",
        model: MODEL,
        workingDir: tempDir,
        maxTurns: 15,
        contextLength: 65536,
        onMessage: (msg) => messages.push(msg),
      });

      expect(result.success).toBe(true);
      expect(toolWasCalled(messages, "glob")).toBe(true);

      const toolResults = messages.filter((m) => m.type === "tool_result");
      const allToolResultText = toolResults.map((m) => m.content ?? "").join("\n");
      const combinedOutput = allToolResultText + "\n" + result.text;
      expect(combinedOutput).toContain("index.ts");
      expect(combinedOutput).toContain("utils.ts");
      expect(combinedOutput).toContain("config.ts");
      expect(result.text).toContain("3");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("read_file returns correct content and agent extracts specific values", async () => {
    if (!ollamaAvailable) {
      console.log("Skipping: Ollama not available");
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-read-"));

    try {
      fs.writeFileSync(
        path.join(tempDir, "config.json"),
        JSON.stringify({ port: 8080, host: "api.example.com", maxConnections: 50 }, null, 2),
      );

      const messages: StreamMessage[] = [];

      const result = await makeClient().execute({
        systemPrompt:
          "You are a file system assistant. You have these tools: glob, read_file, write_file, grep, bash. " +
          "When asked to read a file, you MUST call the `read_file` tool. Do NOT use bash cat for reading files.",
        prompt: "Read config.json and tell me the host and maxConnections values.",
        persona: "backend_developer",
        model: MODEL,
        workingDir: tempDir,
        maxTurns: 15,
        contextLength: 65536,
        onMessage: (msg) => messages.push(msg),
      });

      expect(result.success).toBe(true);

      // Verify read_file tool was called
      expect(toolWasCalled(messages, "read_file")).toBe(true);
      expect(result.text).toContain("api.example.com");
      expect(result.text).toContain("50");
      expect(result.text).not.toContain("3000");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("grep finds matches across multiple files", async () => {
    if (!ollamaAvailable) {
      console.log("Skipping: Ollama not available");
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-grep-"));

    try {
      fs.writeFileSync(path.join(tempDir, "auth.ts"), "// TODO: fix auth\nexport function login() {}\n");
      fs.writeFileSync(path.join(tempDir, "tests.ts"), "// TODO: add tests\nexport function runTests() {}\n");
      fs.writeFileSync(path.join(tempDir, "utils.ts"), "// Helper utilities\nexport function helper() {}\n");

      const messages: StreamMessage[] = [];

      const result = await makeClient().execute({
        systemPrompt:
          "You are a deterministic tool-calling assistant. For this task, you MUST call the grep tool exactly once with explicit args. Do not use bash.",
        prompt:
          "Call grep with pattern=TODO, path=., filePattern=*.ts. Then report which files contain matches.",
        persona: "backend_developer",
        model: MODEL,
        workingDir: tempDir,
        maxTurns: 15,
        contextLength: 65536,
        onMessage: (msg) => messages.push(msg),
      });

      expect(result.success).toBe(true);
      expect(messages.some((m) => m.type === "tool_use")).toBe(true);
      expect(result.text).toContain("auth.ts");
      expect(result.text).toContain("tests.ts");
      expect(result.text).not.toContain("utils.ts");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("write_file creates a new file with correct content", async () => {
    if (!ollamaAvailable) {
      console.log("Skipping: Ollama not available");
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-write-"));

    try {
      const messages: StreamMessage[] = [];

      const result = await makeClient().execute({
        systemPrompt:
          "You are a deterministic tool-calling assistant. For this task, you MUST call write_file exactly once and must not use bash.",
        prompt:
          "Use write_file to create hello.ts with this content: a function called greet that takes a name parameter and returns 'Hello, {name}!'. Export the function.",
        persona: "backend_developer",
        model: MODEL,
        workingDir: tempDir,
        maxTurns: 15,
        contextLength: 65536,
        onMessage: (msg) => messages.push(msg),
      });

      expect(result.success).toBe(true);
      expect(messages.some((m) => m.type === "tool_use")).toBe(true);

      const filePath = path.join(tempDir, "hello.ts");
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("export");
      expect(content).toContain("greet");
      expect(content).toContain("name");
      expect(content).toContain("Hello");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("bash executes commands and agent reads output", async () => {
    if (!ollamaAvailable) {
      console.log("Skipping: Ollama not available");
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-bash-"));

    try {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "test-pkg", version: "2.5.0" }, null, 2),
      );

      const messages: StreamMessage[] = [];

      const result = await makeClient().execute({
        systemPrompt:
          "You are a file system assistant. You have these tools: glob, read_file, write_file, grep, bash. " +
          "When asked to run a shell command, use the bash tool.",
        prompt: "Run `cat package.json` using bash and tell me the version number.",
        persona: "backend_developer",
        model: MODEL,
        workingDir: tempDir,
        maxTurns: 15,
        contextLength: 65536,
        onMessage: (msg) => messages.push(msg),
      });

      expect(result.success).toBe(true);
      expect(toolWasCalled(messages, "bash")).toBe(true);
      expect(result.text).toContain("2.5.0");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

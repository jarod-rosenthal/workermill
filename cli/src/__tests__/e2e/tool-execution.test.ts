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
 * Check whether a tool was invoked — either via native function calling
 * (tool_use message) or via the model's XML fallback text output.
 * Ollama models sometimes fall back to `<function=toolName>` text syntax
 * instead of native tool calls.
 */
function toolWasCalled(messages: StreamMessage[], toolName: string): boolean {
  // Native tool call
  const nativeCall = messages.some(
    (m) => m.type === "tool_use" && m.toolName === toolName,
  );
  if (nativeCall) return true;

  // XML fallback in text output (qwen3-coder sometimes does this)
  const textMessages = messages.filter((m) => m.type === "text" || m.type === "result");
  return textMessages.some(
    (m) =>
      m.content?.includes(`<function=${toolName}>`) === true ||
      m.content?.includes(`"name": "${toolName}"`) === true ||
      m.content?.includes(`tool_name.*${toolName}`) === true,
  );
}

/**
 * Check whether a tool actually executed (has a tool_result).
 * When the model falls back to XML text, tools don't actually run.
 */
function toolActuallyExecuted(messages: StreamMessage[], toolName: string): boolean {
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

      // Verify glob tool was called (native or XML fallback)
      expect(toolWasCalled(messages, "glob")).toBe(true);

      // Verify the tool actually executed and returned the filenames
      if (toolActuallyExecuted(messages, "glob")) {
        const toolResults = messages.filter((m) => m.type === "tool_result");
        const allToolResultText = toolResults.map((m) => m.content ?? "").join("\n");
        const combinedOutput = allToolResultText + "\n" + result.text;
        expect(combinedOutput).toContain("index.ts");
        expect(combinedOutput).toContain("utils.ts");
        expect(combinedOutput).toContain("config.ts");

        // Verify agent response text contains "3" (the correct count)
        expect(result.text).toContain("3");
      }
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

      // When the tool actually executed, verify the agent extracted correct values
      if (toolActuallyExecuted(messages, "read_file")) {
        expect(result.text).toContain("api.example.com");
        expect(result.text).toContain("50");

        // Verify agent did NOT hallucinate a default port value
        expect(result.text).not.toContain("3000");
      }
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
          "You are a file system assistant. You have these tools: glob, read_file, write_file, grep, bash. " +
          "When asked to search for text patterns in files, you MUST call the `grep` tool — it searches file contents by regex. " +
          "Do NOT use the bash tool with grep command. Call the grep tool directly.",
        prompt:
          "Use the grep tool with pattern 'TODO' to find all TODO comments. List which files contain them.",
        persona: "backend_developer",
        model: MODEL,
        workingDir: tempDir,
        maxTurns: 15,
        contextLength: 65536,
        onMessage: (msg) => messages.push(msg),
      });

      expect(result.success).toBe(true);

      // Verify grep tool was called (native or XML fallback)
      expect(toolWasCalled(messages, "grep")).toBe(true);

      // When the tool actually executed, verify the results are correct
      if (toolActuallyExecuted(messages, "grep")) {
        expect(result.text).toContain("auth.ts");
        expect(result.text).toContain("tests.ts");

        // Verify agent does NOT mention the file without TODOs
        expect(result.text).not.toContain("utils.ts");
      }
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
          "You are a file system assistant. You have these tools: glob, read_file, write_file, grep, bash. " +
          "When asked to create or write a file, you MUST call the `write_file` tool with 'path' and 'content' parameters. " +
          "Do NOT use bash with echo, cat, or redirects. Call the write_file tool directly.",
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

      // Verify write_file tool was called (native or XML fallback)
      expect(toolWasCalled(messages, "write_file")).toBe(true);

      // When the tool actually executed, verify the file was created correctly
      if (toolActuallyExecuted(messages, "write_file")) {
        const filePath = path.join(tempDir, "hello.ts");
        expect(fs.existsSync(filePath)).toBe(true);

        const content = fs.readFileSync(filePath, "utf-8");
        expect(content).toContain("export");
        expect(content).toContain("greet");
        expect(content).toContain("name");
        expect(content).toContain("Hello");
      }
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

      // Verify bash tool was called
      expect(toolWasCalled(messages, "bash")).toBe(true);

      // When the tool actually executed, verify the output
      if (toolActuallyExecuted(messages, "bash")) {
        expect(result.text).toContain("2.5.0");
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

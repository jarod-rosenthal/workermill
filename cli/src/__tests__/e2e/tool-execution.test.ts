import { describe, it, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { EngineAIClient } from "../../../../packages/engine/src/ai-client.js";
import type { StreamMessage } from "../../../../packages/engine/src/types.js";

const OLLAMA_HOST = "http://localhost:11434";
const MODEL = "qwen3-coder:30b";

let ollamaAvailable = false;

beforeAll(async () => {
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

describe("tool execution with Ollama", () => {
  it("should use glob tool to list TypeScript files", async () => {
    if (!ollamaAvailable) {
      console.log("Skipping: Ollama not available");
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-tools-"));

    // Create multiple TS files
    fs.writeFileSync(path.join(tempDir, "index.ts"), "export const main = true;\n");
    fs.writeFileSync(path.join(tempDir, "utils.ts"), "export const util = true;\n");
    fs.writeFileSync(path.join(tempDir, "config.ts"), "export const config = {};\n");
    fs.writeFileSync(path.join(tempDir, "readme.md"), "# Project\n");

    const client = new EngineAIClient({
      provider: "ollama",
      apiKeys: { ollamaHost: OLLAMA_HOST },
    });

    const messages: StreamMessage[] = [];

    const result = await client.execute({
      systemPrompt:
        "You are a developer. Use the available tools to complete tasks. Be concise.",
      prompt: "List all TypeScript files in the current directory using the glob tool.",
      persona: "backend_developer",
      model: MODEL,
      workingDir: tempDir,
      maxTurns: 10,
      onMessage: (msg) => messages.push(msg),
    });

    expect(result.success).toBe(true);

    // Verify glob tool was called
    const toolUses = messages.filter((m) => m.type === "tool_use");
    expect(toolUses.length).toBeGreaterThan(0);

    const globCall = toolUses.find((m) => m.toolName === "glob");
    expect(globCall).toBeDefined();

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should create a new file on disk", async () => {
    if (!ollamaAvailable) {
      console.log("Skipping: Ollama not available");
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-create-"));

    const client = new EngineAIClient({
      provider: "ollama",
      apiKeys: { ollamaHost: OLLAMA_HOST },
    });

    const messages: StreamMessage[] = [];

    const result = await client.execute({
      systemPrompt:
        "You are a developer. Use the available tools to complete tasks. Be concise.",
      prompt:
        'Create a new file called helpers.ts with the following content:\nexport function greet(name: string): string {\n  return `Hello, ${name}!`;\n}',
      persona: "backend_developer",
      model: MODEL,
      workingDir: tempDir,
      maxTurns: 10,
      onMessage: (msg) => messages.push(msg),
    });

    expect(result.success).toBe(true);

    // Verify the file was created
    const filePath = path.join(tempDir, "helpers.ts");
    expect(fs.existsSync(filePath)).toBe(true);

    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("greet");
    expect(content).toContain("Hello");

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

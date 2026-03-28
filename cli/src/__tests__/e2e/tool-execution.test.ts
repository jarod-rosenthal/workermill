import { describe, it, beforeAll } from "vitest";
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
        "You are a developer. You MUST use tools to interact with the filesystem. Never guess file contents — always use the tools provided.",
      prompt: "Use the glob tool with pattern '**/*.ts' to find all TypeScript files in the project.",
      persona: "backend_developer",
      model: MODEL,
      workingDir: tempDir,
      maxTurns: 10,
      contextLength: 65536,
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

  it("should use read_file tool to read a file", async () => {
    if (!ollamaAvailable) {
      console.log("Skipping: Ollama not available");
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-read-"));
    fs.writeFileSync(path.join(tempDir, "config.json"), JSON.stringify({ port: 3000, debug: true }, null, 2));

    const client = new EngineAIClient({
      provider: "ollama",
      apiKeys: { ollamaHost: OLLAMA_HOST },
    });

    const messages: StreamMessage[] = [];

    const result = await client.execute({
      systemPrompt:
        "You are a developer. You MUST use the read_file tool to read files. Never guess file contents.",
      prompt: "Use the read_file tool to read config.json and tell me what port is configured.",
      persona: "backend_developer",
      model: MODEL,
      workingDir: tempDir,
      maxTurns: 10,
      contextLength: 65536,
      onMessage: (msg) => messages.push(msg),
    });

    expect(result.success).toBe(true);

    // Verify read_file tool was called
    const toolUses = messages.filter((m) => m.type === "tool_use");
    const readCall = toolUses.find((m) => m.toolName === "read_file");
    expect(readCall).toBeDefined();

    // Verify the model mentioned the port from the file
    expect(result.text).toContain("3000");

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

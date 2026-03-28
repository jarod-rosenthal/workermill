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

describe("single-agent with Ollama", () => {
  it("should fix a bug in app.ts using tool calls", async () => {
    if (!ollamaAvailable) {
      console.log("Skipping: Ollama not available");
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-single-"));

    // Write a file with a deliberate bug
    fs.writeFileSync(
      path.join(tempDir, "app.ts"),
      `// Simple math utilities
export function add(a: number, b: number): number {
  return a - b; // BUG: should be a + b
}

export function multiply(a: number, b: number): number {
  return a * b;
}
`,
    );

    const client = new EngineAIClient({
      provider: "ollama",
      apiKeys: { ollamaHost: OLLAMA_HOST },
    });

    const messages: StreamMessage[] = [];

    const result = await client.execute({
      systemPrompt:
        "You are a developer. Fix bugs in code files. Use the available tools to read and edit files. Do not explain, just fix.",
      prompt:
        "Read app.ts and fix the bug in the add function. The function should add the two numbers, not subtract them.",
      persona: "backend_developer",
      model: MODEL,
      workingDir: tempDir,
      maxTurns: 20,
      onMessage: (msg) => messages.push(msg),
    });

    expect(result.success).toBe(true);

    // Verify tool calls happened
    const toolUses = messages.filter((m) => m.type === "tool_use");
    expect(toolUses.length).toBeGreaterThan(0);

    // Verify the file was modified to fix the bug
    const content = fs.readFileSync(path.join(tempDir, "app.ts"), "utf-8");
    expect(content).toContain("a + b");
    expect(content).not.toContain("a - b");

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

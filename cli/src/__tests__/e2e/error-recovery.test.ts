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

describe("error recovery with Ollama", () => {
  it("should attempt to read a missing file, recover, then edit a valid file", async () => {
    if (!ollamaAvailable) {
      console.log("Skipping: Ollama not available");
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-recover-read-edit-"));

    try {
      // missing-file.json does NOT exist; constants.ts does
      fs.writeFileSync(
        path.join(tempDir, "constants.ts"),
        `export const MAINTENANCE_MODE = true;\nexport const API_VERSION = "v2";\n`,
      );

      const client = new EngineAIClient({
        provider: "ollama",
        apiKeys: { ollamaHost: OLLAMA_HOST },
      });

      const messages: StreamMessage[] = [];

      const result = await client.execute({
        systemPrompt:
          "You are a developer. You MUST use tools to interact with the filesystem. " +
          "Never guess file contents — always use the tools provided.",
        prompt:
          "First, use read_file to read 'missing-file.json'. That file does not exist, so you will get an error. " +
          "After that error, use read_file to read 'constants.ts'. " +
          "Then use edit_file to change 'MAINTENANCE_MODE = true' to 'MAINTENANCE_MODE = false' in constants.ts.",
        persona: "backend_developer",
        model: MODEL,
        workingDir: tempDir,
        maxTurns: 20,
        contextLength: 65536,
        onMessage: (msg) => messages.push(msg),
      });

      expect(result.success).toBe(true);

      const toolUses = messages.filter((m) => m.type === "tool_use");
      expect(toolUses.length).toBeGreaterThan(0);

      // edit_file must have been called to apply the fix
      const editCall = toolUses.find((m) => m.toolName === "edit_file");
      expect(editCall).toBeDefined();

      // Verify the change was applied to disk — this is the definitive proof of recovery
      const content = fs.readFileSync(path.join(tempDir, "constants.ts"), "utf-8");
      expect(content).toContain("MAINTENANCE_MODE = false");
      expect(content).not.toContain("MAINTENANCE_MODE = true");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should handle glob finding no JSON files then edit the TypeScript file it finds instead", async () => {
    if (!ollamaAvailable) {
      console.log("Skipping: Ollama not available");
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-recover-glob-edit-"));

    try {
      // No .json files — only .ts files
      fs.writeFileSync(
        path.join(tempDir, "settings.ts"),
        `export const FEATURE_FLAG = false;\nexport const RETRY_COUNT = 3;\n`,
      );

      const client = new EngineAIClient({
        provider: "ollama",
        apiKeys: { ollamaHost: OLLAMA_HOST },
      });

      const messages: StreamMessage[] = [];

      const result = await client.execute({
        systemPrompt:
          "You are a developer. You MUST use tools to interact with the filesystem. " +
          "Never guess file contents — always use the tools provided.",
        prompt:
          "First, use the glob tool with pattern '*.json' to search for JSON config files. " +
          "That glob will find nothing. After seeing the empty result, " +
          "use read_file to read 'settings.ts'. " +
          "Then use edit_file to change 'FEATURE_FLAG = false' to 'FEATURE_FLAG = true' in settings.ts.",
        persona: "backend_developer",
        model: MODEL,
        workingDir: tempDir,
        maxTurns: 20,
        contextLength: 65536,
        onMessage: (msg) => messages.push(msg),
      });

      expect(result.success).toBe(true);

      const toolUses = messages.filter((m) => m.type === "tool_use");
      expect(toolUses.length).toBeGreaterThan(0);

      // glob must have been called first
      const globCall = toolUses.find((m) => m.toolName === "glob");
      expect(globCall).toBeDefined();

      // edit_file must have been called to make the change
      const editCall = toolUses.find((m) => m.toolName === "edit_file");
      expect(editCall).toBeDefined();

      // Verify the change was applied to disk — definitive proof the whole chain worked
      const content = fs.readFileSync(path.join(tempDir, "settings.ts"), "utf-8");
      expect(content).toContain("FEATURE_FLAG = true");
      expect(content).not.toContain("FEATURE_FLAG = false");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

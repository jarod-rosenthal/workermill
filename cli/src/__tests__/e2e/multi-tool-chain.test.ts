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

describe("multi-tool chain with Ollama", () => {
  it("should use glob to find files then read and edit one", async () => {
    if (!ollamaAvailable) {
      console.log("Skipping: Ollama not available");
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-chain-glob-"));

    try {
      fs.writeFileSync(
        path.join(tempDir, "config.ts"),
        `export const APP_ENV = "development";\nexport const DEBUG_MODE = true;\n`,
      );
      fs.writeFileSync(path.join(tempDir, "server.ts"), 'export const PORT = 4000;\n');

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
          "Use the glob tool with pattern '*.ts' to list all TypeScript files. " +
          "Then use read_file to read 'config.ts'. " +
          "Then use edit_file to change 'DEBUG_MODE = true' to 'DEBUG_MODE = false' in config.ts.",
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

      // glob must have been called
      const globCall = toolUses.find((m) => m.toolName === "glob");
      expect(globCall).toBeDefined();

      // edit_file must have been called to apply the change
      const editCall = toolUses.find((m) => m.toolName === "edit_file");
      expect(editCall).toBeDefined();

      // Verify the change was applied to disk
      const content = fs.readFileSync(path.join(tempDir, "config.ts"), "utf-8");
      expect(content).toContain("DEBUG_MODE = false");
      expect(content).not.toContain("DEBUG_MODE = true");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should read a file then edit it to change a specific value", async () => {
    if (!ollamaAvailable) {
      console.log("Skipping: Ollama not available");
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-chain-read-edit-"));

    try {
      fs.writeFileSync(
        path.join(tempDir, "app.ts"),
        `export const APP_VERSION = "3.0.0";
export const DEBUG_MODE = true;
export const LOG_LEVEL = "info";
`,
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
          "Use read_file to read 'app.ts', then use edit_file to change 'DEBUG_MODE = true' to 'DEBUG_MODE = false'.",
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

      // read_file must have been called
      const readCall = toolUses.find((m) => m.toolName === "read_file");
      expect(readCall).toBeDefined();

      // edit_file must have been called
      const editCall = toolUses.find((m) => m.toolName === "edit_file");
      expect(editCall).toBeDefined();

      // Verify the change was applied to disk
      const content = fs.readFileSync(path.join(tempDir, "app.ts"), "utf-8");
      expect(content).toContain("DEBUG_MODE = false");
      expect(content).not.toContain("DEBUG_MODE = true");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should use ls to list files then read and edit one", async () => {
    if (!ollamaAvailable) {
      console.log("Skipping: Ollama not available");
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-chain-ls-edit-"));

    try {
      fs.writeFileSync(
        path.join(tempDir, "version.ts"),
        `export const VERSION = "1.0.0";\nexport const RELEASED = false;\n`,
      );
      fs.writeFileSync(path.join(tempDir, "index.ts"), 'export const ENTRY = true;\n');

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
          "Use the ls tool with path '.' to list the project files. " +
          "Then use read_file to read 'version.ts'. " +
          "Then use edit_file to change 'RELEASED = false' to 'RELEASED = true' in version.ts.",
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

      // ls must have been called
      const lsCall = toolUses.find((m) => m.toolName === "ls");
      expect(lsCall).toBeDefined();

      // edit_file must have been called
      const editCall = toolUses.find((m) => m.toolName === "edit_file");
      expect(editCall).toBeDefined();

      // Verify the change was applied to disk
      const content = fs.readFileSync(path.join(tempDir, "version.ts"), "utf-8");
      expect(content).toContain("RELEASED = true");
      expect(content).not.toContain("RELEASED = false");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { EngineAIClient } from "../../engine/ai-client.js";
import type { StreamMessage } from "../../engine/types.js";
import { detectOllamaHost } from "../helpers/ollama-host.js";

let OLLAMA_HOST = "";
const MODEL = "qwen3-coder:30b";
let ollamaAvailable = false;

const SYSTEM_PROMPT =
  "You are a developer assistant. You MUST use tools to interact with the filesystem. " +
  "NEVER guess file contents — ALWAYS call the tools provided. " +
  "Do NOT explain what you plan to do — just call the tools immediately.";

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
  it("recovers from file-not-found and reports the error before succeeding", { retry: 2 }, async () => {
    if (!ollamaAvailable) {
      console.log("Skipping: Ollama not available");
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-recover-read-"));

    try {
      fs.writeFileSync(
        path.join(tempDir, "constants.ts"),
        `export const MAINTENANCE_MODE = true;\n`,
      );

      const client = new EngineAIClient({
        provider: "ollama",
        apiKeys: { ollamaHost: OLLAMA_HOST },
      });

      const messages: StreamMessage[] = [];

      const result = await client.execute({
        systemPrompt: SYSTEM_PROMPT,
        prompt:
          "Read missing-file.json. You will get an error because it doesn't exist. " +
          "After that error, read constants.ts and change MAINTENANCE_MODE to false.",
        persona: "backend_developer",
        model: MODEL,
        workingDir: tempDir,
        maxTurns: 20,
        contextLength: 65536,
        onMessage: (msg) => messages.push(msg),
      });

      expect(result.success).toBe(true);

      const toolUses = messages.filter((m) => m.type === "tool_use");

      // read_file must have been called at least twice (missing file + constants.ts)
      const readCalls = toolUses.filter((m) => m.toolName === "read_file");
      expect(readCalls.length).toBeGreaterThanOrEqual(2);

      // One read_file must target the missing file
      const missingRead = readCalls.find(
        (m) => m.toolInput && String(m.toolInput.path).includes("missing-file"),
      );
      expect(missingRead).toBeDefined();

      // The model must acknowledge the error in its text output
      const allText = messages
        .filter((m) => m.type === "text")
        .map((m) => m.content ?? "")
        .join(" ");
      const acknowledgesError =
        /error/i.test(allText) ||
        /not found/i.test(allText) ||
        /doesn't exist/i.test(allText) ||
        /does not exist/i.test(allText);
      expect(acknowledgesError).toBe(true);

      // edit_file must have been called
      const editCalls = toolUses.filter((m) => m.toolName === "edit_file");
      expect(editCalls.length).toBeGreaterThanOrEqual(1);

      // File on disk must reflect the recovery
      const content = fs.readFileSync(path.join(tempDir, "constants.ts"), "utf-8");
      expect(content).toContain("MAINTENANCE_MODE = false");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("recovers from failed bash command and retries with correct command", { retry: 2 }, async () => {
    if (!ollamaAvailable) {
      console.log("Skipping: Ollama not available");
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-recover-bash-"));

    try {
      fs.writeFileSync(
        path.join(tempDir, "app.ts"),
        `export function greet(name: string): string {\n  return \`Hello, \${name}!\`;\n}\n`,
      );

      const client = new EngineAIClient({
        provider: "ollama",
        apiKeys: { ollamaHost: OLLAMA_HOST },
      });

      const messages: StreamMessage[] = [];

      const result = await client.execute({
        systemPrompt: SYSTEM_PROMPT,
        prompt:
          "Step 1: You MUST use the bash tool to run the command `npm test`. It will fail — that's expected.\n" +
          "Step 2: After bash fails, use read_file to read app.ts and tell me what functions it exports.",
        persona: "backend_developer",
        model: MODEL,
        workingDir: tempDir,
        maxTurns: 20,
        contextLength: 65536,
        onMessage: (msg) => messages.push(msg),
      });

      expect(result.success).toBe(true);

      const toolUses = messages.filter((m) => m.type === "tool_use");

      // bash tool must have been called
      const bashCalls = toolUses.filter((m) => m.toolName === "bash");
      expect(bashCalls.length).toBeGreaterThanOrEqual(1);

      // The model must acknowledge the bash failure in its text
      const allText = messages
        .filter((m) => m.type === "text")
        .map((m) => m.content ?? "")
        .join(" ");
      const acknowledgesFailure =
        /fail/i.test(allText) ||
        /error/i.test(allText) ||
        /no package/i.test(allText) ||
        /not found/i.test(allText) ||
        /npm/i.test(allText);
      expect(acknowledgesFailure).toBe(true);

      // read_file must have been called after the bash failure
      const readCalls = toolUses.filter((m) => m.toolName === "read_file");
      expect(readCalls.length).toBeGreaterThanOrEqual(1);

      // Agent response must reference actual content from app.ts
      const referencesContent =
        /greet/i.test(allText) || /Hello/i.test(allText) || /name/i.test(allText);
      expect(referencesContent).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("handles edit_file with wrong old_string gracefully", { retry: 2 }, async () => {
    if (!ollamaAvailable) {
      console.log("Skipping: Ollama not available");
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-recover-edit-"));

    try {
      fs.writeFileSync(
        path.join(tempDir, "config.ts"),
        `export const MODE = "production";\n`,
      );

      const client = new EngineAIClient({
        provider: "ollama",
        apiKeys: { ollamaHost: OLLAMA_HOST },
      });

      const messages: StreamMessage[] = [];

      const result = await client.execute({
        systemPrompt: SYSTEM_PROMPT,
        prompt:
          "Without reading the file first, use edit_file on config.ts to replace " +
          '`export const MODE = "development";` with `export const MODE = "staging";`. ' +
          "Do NOT read the file before this first edit — just call edit_file directly. " +
          "The edit will fail because the file actually contains 'production', not 'development'. " +
          "After the failure, read the file, then make the correct edit to change the value to 'staging'.",
        persona: "backend_developer",
        model: MODEL,
        workingDir: tempDir,
        maxTurns: 20,
        contextLength: 65536,
        onMessage: (msg) => messages.push(msg),
      });

      expect(result.success).toBe(true);

      const toolUses = messages.filter((m) => m.type === "tool_use");

      // edit_file or write_file must have been called at least twice
      // (first edit fails, then a read + correct edit/write)
      const editCalls = toolUses.filter(
        (m) => m.toolName === "edit_file" || m.toolName === "write_file",
      );
      expect(editCalls.length).toBeGreaterThanOrEqual(2);

      // At least one edit must target the wrong value "development"
      const wrongEdit = editCalls.find((m) => {
        const input = m.toolInput ?? {};
        const oldStr = String(input.old_string ?? input.content ?? "");
        return /development/i.test(oldStr);
      });
      expect(wrongEdit).toBeDefined();

      // The model must acknowledge the failure in its text
      const allText = messages
        .filter((m) => m.type === "text")
        .map((m) => m.content ?? "")
        .join(" ");
      const acknowledgesFailure =
        /error/i.test(allText) ||
        /not found/i.test(allText) ||
        /fail/i.test(allText) ||
        /doesn't match/i.test(allText) ||
        /actual/i.test(allText) ||
        /production/i.test(allText);
      expect(acknowledgesFailure).toBe(true);

      // File on disk must have the corrected value
      const content = fs.readFileSync(path.join(tempDir, "config.ts"), "utf-8");
      expect(content).toContain('MODE = "staging"');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { EngineAIClient } from "../../../../packages/engine/src/ai-client.js";
import type { StreamMessage } from "../../../../packages/engine/src/types.js";
import { detectOllamaHost } from "../helpers/ollama-host.js";
import { loadCustomCommands } from "../../custom-commands.js";
import { isDangerous, isDangerousFile } from "../../safety.js";
import { microCompact, shouldCompact } from "../../compaction.js";
import { handleSlashCommand } from "../../ui/slash-commands.js";
import type { SlashCommandContext } from "../../ui/slash-commands.js";

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMockContext(
  overrides: Partial<SlashCommandContext> & { workingDir: string },
): SlashCommandContext & {
  systemMessages: string[];
  userMessages: string[];
  submittedInputs: Array<{ input: string; displayText?: string }>;
} {
  const systemMessages: string[] = [];
  const userMessages: string[] = [];
  const submittedInputs: Array<{ input: string; displayText?: string }> = [];

  const ctx: SlashCommandContext & {
    systemMessages: string[];
    userMessages: string[];
    submittedInputs: Array<{ input: string; displayText?: string }>;
  } = {
    addSystemMessage: (content: string) => systemMessages.push(content),
    addUserMessage: (content: string) => userMessages.push(content),
    submit: (input: string, displayText?: string) =>
      submittedInputs.push({ input, displayText }),
    provider: "ollama",
    model: MODEL,
    workingDir: overrides.workingDir,
    session: {
      id: "test-session-" + Date.now(),
      messages: [],
      totalTokens: 0,
      startedAt: new Date().toISOString(),
    },
    cost: 0,
    tokens: 0,
    permissionMode: "bypassPermissions",
    trustAll: true,
    isTrustAll: () => true,
    planMode: false,
    setPlanMode: () => {},
    setTrustAll: () => {},
    allowTool: () => {},
    denyTool: () => {},
    orchestratorRunning: false,
    startOrchestrator: () => {},
    startReview: () => {},
    retryOrchestrator: () => false,
    lastBuildTask: null,
    setLastBuildTask: () => {},
    sandboxed: true,
    switchModel: undefined,
    forceCompact: undefined,
    // Expose captured calls for assertions
    systemMessages,
    userMessages,
    submittedInputs,
    // Apply overrides last so they win
    ...overrides,
  };

  return ctx;
}

// ---------------------------------------------------------------------------
// Section 1: Custom Skills Loading
// ---------------------------------------------------------------------------

describe("custom skills loading", () => {
  it("loads skills from .workermill/skills/ with frontmatter", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-skills-"));
    try {
      const skillsDir = path.join(tempDir, ".workermill", "skills");
      fs.mkdirSync(skillsDir, { recursive: true });

      fs.writeFileSync(
        path.join(skillsDir, "deploy.md"),
        `---
name: deploy
description: Deploy the application
allowedTools: [bash, read_file]
whenToUse: When the user asks to deploy
---
You are a deployment specialist. Follow the CI/CD pipeline.
`,
      );

      // Mock process.cwd() to point to temp dir
      process.chdir(tempDir);

      const commands = loadCustomCommands();

      // Find the deploy command (there may be user-level skills too)
      const deploy = commands.find((c) => c.name === "deploy");
      expect(deploy).toBeDefined();
      expect(deploy!.description).toBe("Deploy the application");
      expect(deploy!.allowedTools).toEqual(["bash", "read_file"]);
      expect(deploy!.whenToUse).toBe("When the user asks to deploy");
      expect(deploy!.source).toBe("project-skills");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Section 2: Dangerous Command/File Detection
// ---------------------------------------------------------------------------

describe("dangerous command detection", () => {
  it("blocks dangerous bash commands", () => {
    expect(isDangerous("rm -rf /")).not.toBeNull();
    expect(isDangerous("git push --force")).not.toBeNull();
    expect(isDangerous("npm test")).toBeNull();
    expect(isDangerous("git status")).toBeNull();
  });

  it("blocks dangerous file writes", () => {
    expect(isDangerousFile(".env")).not.toBeNull();
    expect(isDangerousFile(".ssh/id_rsa")).not.toBeNull();
    expect(isDangerousFile("src/app.ts")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Section 3: Compaction
// ---------------------------------------------------------------------------

describe("compaction", () => {
  it("microCompact trims old messages without API call", () => {
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

    // Create 10 messages: some short, some long
    for (let i = 0; i < 10; i++) {
      const isLong = i % 2 === 0 && i < 6; // messages 0, 2, 4 are long (and in the "old" range)
      messages.push({
        role: i % 2 === 0 ? "user" : "assistant",
        content: isLong ? "x".repeat(5500) : `Short message ${i}`,
      });
    }

    const result = microCompact(messages, 4, 2000);

    // Last 4 messages (indices 6-9) are unchanged
    for (let i = 6; i < 10; i++) {
      expect(result.messages[i].content).toBe(messages[i].content);
    }

    // Older long messages (indices 0, 2, 4) should be truncated
    expect(result.messages[0].content).toContain("[... truncated");
    expect(result.messages[2].content).toContain("[... truncated");
    expect(result.messages[4].content).toContain("[... truncated");

    // Older short messages (indices 1, 3, 5) should be unchanged
    expect(result.messages[1].content).toBe(messages[1].content);
    expect(result.messages[3].content).toBe(messages[3].content);
    expect(result.messages[5].content).toBe(messages[5].content);

    // charsSaved > 0
    expect(result.charsSaved).toBeGreaterThan(0);
  });

  it("shouldCompact returns correct levels", () => {
    // Under 60% of 65536 = under 39321 -> "none"
    expect(shouldCompact(35000, "qwen3-coder:30b").level).toBe("none");

    // Over 60% (39321) but under 80% (52428) -> "micro"
    expect(shouldCompact(42000, "qwen3-coder:30b").level).toBe("micro");

    // Over 80% (52428) but under 95% (62259) -> "soft"
    expect(shouldCompact(55000, "qwen3-coder:30b").level).toBe("soft");

    // Over 95% (62259) -> "hard"
    expect(shouldCompact(63000, "qwen3-coder:30b").level).toBe("hard");
  });
});

// ---------------------------------------------------------------------------
// Section 4: Multi-file edit with Ollama
// ---------------------------------------------------------------------------

describe("multi-file edit with Ollama", () => {
  it("agent modifies multiple files in a single task", async () => {
    if (!ollamaAvailable) {
      console.log("Skipping: Ollama not available");
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-multifile-"));

    try {
      // Create mini project
      const srcDir = path.join(tempDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(
        path.join(srcDir, "auth.ts"),
        `export function login(user: string, pass: string) { return user === "admin" && pass === "admin"; }\n`,
      );

      fs.writeFileSync(
        path.join(srcDir, "config.ts"),
        `export const SECRET = "hardcoded-secret-123";\n`,
      );

      fs.writeFileSync(
        path.join(srcDir, "index.ts"),
        `import { login } from "./auth"; import { SECRET } from "./config"; console.log(login("admin", SECRET));\n`,
      );

      const client = new EngineAIClient({
        provider: "ollama",
        apiKeys: { ollamaHost: OLLAMA_HOST },
      });

      const messages: StreamMessage[] = [];

      const result = await client.execute({
        systemPrompt:
          "You are a security-focused developer. Fix security issues in code files. Use the available tools to read and edit files. Do not explain, just fix the issues specified.",
        prompt:
          "This codebase has two security issues: 1) hardcoded credentials in src/auth.ts (admin/admin), 2) hardcoded secret in src/config.ts. Fix auth.ts to use proper password comparison (accept any non-empty password) and fix config.ts to read SECRET from process.env.SECRET with a fallback.",
        persona: "backend_developer",
        model: MODEL,
        workingDir: tempDir,
        maxTurns: 20,
        contextLength: 65536,
        onMessage: (msg) => messages.push(msg),
      });

      expect(result.success).toBe(true);

      // Verify both files were modified
      const authContent = fs.readFileSync(path.join(srcDir, "auth.ts"), "utf-8");
      const configContent = fs.readFileSync(path.join(srcDir, "config.ts"), "utf-8");
      const indexContent = fs.readFileSync(path.join(srcDir, "index.ts"), "utf-8");

      // auth.ts should no longer have "admin" as a password check
      expect(authContent).not.toContain('pass === "admin"');

      // config.ts should reference process.env
      expect(configContent).toContain("process.env");

      // index.ts should NOT have been modified
      expect(indexContent).toContain('import { login } from "./auth"');
      expect(indexContent).toContain('import { SECRET } from "./config"');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Section 5: Slash command - /compact
// ---------------------------------------------------------------------------

describe("slash command /compact", () => {
  it("handleSlashCommand /compact triggers compaction", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-compact-"));

    try {
      let compactCalled = false;
      let compactFocus: string | undefined;

      const ctx = buildMockContext({
        workingDir: tempDir,
        tokens: 50000,
        forceCompact: async (focus?: string) => {
          compactCalled = true;
          compactFocus = focus;
          return { before: 100, after: 20 };
        },
      });
      ctx.session.messages = new Array(10).fill({ role: "user", content: "test" });

      const handled = handleSlashCommand("/compact focus on auth changes", ctx);
      expect(handled).toBe(true);

      // forceCompact is async -- wait for it
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(compactCalled).toBe(true);
      expect(compactFocus).toBe("focus on auth changes");

      // System message about compacting
      expect(ctx.systemMessages.some((m) => m.includes("Compacting"))).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

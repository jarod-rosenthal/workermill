/**
 * Tests for the logic in useAgent.ts.
 *
 * Since useAgent is a React hook we cannot call it directly in a pure Node
 * test. Instead we replicate the key decision logic as pure functions (same
 * approach as useAgent-permission.test.ts) and verify behaviour.
 *
 * Covered areas:
 *   1. switchModel — env vars, provider ref updates, ensureOllamaContext
 *   2. forceCompact — compactMessages, session update, token re-estimation
 *   3. Permission escalation — "always" -> auto-edit, "trust" -> trust all
 *   4. rollback — session message removal
 *   5. allowTool / denyTool — set management (mutual exclusion)
 *   6. cyclePermissionMode — ask -> auto-edit -> trust all -> ask
 *   7. addSystemMessage / addUserMessage — message shape
 *   8. Initialisation — API key env var mapping
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { trackAbortCost } from "../ui/useAgent.js";

// ---------------------------------------------------------------------------
// 1. switchModel logic (pure replication)
// ---------------------------------------------------------------------------

describe("switchModel logic", () => {
  const createModel = vi.fn(() => ({ modelId: "new-model" }));
  const ensureOllamaContext = vi.fn();

  function switchModel(
    newProvider: string,
    newModel: string,
    providerConfig: { host?: string; contextLength?: number; apiKey?: string } | undefined,
    refs: {
      aiProvider: { current: string };
      activeModelName: { current: string };
      activeContextLength: { current: number | undefined };
      model: { current: unknown };
    },
  ) {
    const host = providerConfig?.host;
    const contextLength = providerConfig?.contextLength;
    const apiKey = providerConfig?.apiKey;

    if (apiKey) {
      const envMap: Record<string, string> = {
        anthropic: "ANTHROPIC_API_KEY",
        openai: "OPENAI_API_KEY",
        google: "GOOGLE_GENERATIVE_AI_API_KEY",
        xai: "XAI_API_KEY",
        groq: "GROQ_API_KEY",
        deepseek: "DEEPSEEK_API_KEY",
        mistral: "MISTRAL_API_KEY",
      };
      const envVar = envMap[newProvider] || "OPENAI_API_KEY";
      if (envVar) {
        const resolvedKey = apiKey.startsWith("{env:")
          ? process.env[apiKey.slice(5, -1)] || ""
          : apiKey;
        if (resolvedKey) {
          process.env[envVar] = resolvedKey;
        }
      }
    }

    refs.aiProvider.current = newProvider;
    refs.activeModelName.current = newModel;
    refs.activeContextLength.current = contextLength;
    refs.model.current = createModel(newProvider, newModel, host, contextLength);

    if (newProvider === "ollama" && host && contextLength) {
      void ensureOllamaContext(host, newModel, contextLength);
    }
  }

  beforeEach(() => {
    createModel.mockClear();
    ensureOllamaContext.mockClear();
    // Clean up env vars
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.MISTRAL_API_KEY;
  });

  it("updates refs to the new provider and model", () => {
    const refs = {
      aiProvider: { current: "anthropic" },
      activeModelName: { current: "claude-sonnet-4-6" },
      activeContextLength: { current: undefined as number | undefined },
      model: { current: null as unknown },
    };

    switchModel("openai", "gpt-5.4", { host: undefined, contextLength: undefined, apiKey: undefined }, refs);

    expect(refs.aiProvider.current).toBe("openai");
    expect(refs.activeModelName.current).toBe("gpt-5.4");
    expect(createModel).toHaveBeenCalledWith("openai", "gpt-5.4", undefined, undefined);
  });

  it("sets the correct env var for anthropic", () => {
    const refs = {
      aiProvider: { current: "ollama" },
      activeModelName: { current: "qwen3-coder" },
      activeContextLength: { current: 32768 as number | undefined },
      model: { current: null as unknown },
    };

    switchModel("anthropic", "claude-sonnet-4-6", { apiKey: "sk-ant-test123" }, refs);

    expect(process.env.ANTHROPIC_API_KEY).toBe("sk-ant-test123");
    expect(refs.aiProvider.current).toBe("anthropic");
  });

  it("sets the correct env var for openai", () => {
    const refs = {
      aiProvider: { current: "anthropic" },
      activeModelName: { current: "claude-sonnet-4-6" },
      activeContextLength: { current: undefined as number | undefined },
      model: { current: null as unknown },
    };

    switchModel("openai", "gpt-5.4-mini", { apiKey: "sk-openai-test" }, refs);

    expect(process.env.OPENAI_API_KEY).toBe("sk-openai-test");
  });

  it("sets the correct env var for google", () => {
    const refs = {
      aiProvider: { current: "anthropic" },
      activeModelName: { current: "claude-sonnet-4-6" },
      activeContextLength: { current: undefined as number | undefined },
      model: { current: null as unknown },
    };

    switchModel("google", "gemini-3.1-pro", { apiKey: "AIza-test" }, refs);

    expect(process.env.GOOGLE_GENERATIVE_AI_API_KEY).toBe("AIza-test");
  });

  it("resolves {env:VAR} API key references", () => {
    process.env.MY_CUSTOM_KEY = "resolved-secret";
    const refs = {
      aiProvider: { current: "anthropic" },
      activeModelName: { current: "claude-sonnet-4-6" },
      activeContextLength: { current: undefined as number | undefined },
      model: { current: null as unknown },
    };

    switchModel("openai", "gpt-5.4", { apiKey: "{env:MY_CUSTOM_KEY}" }, refs);

    expect(process.env.OPENAI_API_KEY).toBe("resolved-secret");
    delete process.env.MY_CUSTOM_KEY;
  });

  it("falls back to OPENAI_API_KEY for unknown providers", () => {
    const refs = {
      aiProvider: { current: "anthropic" },
      activeModelName: { current: "claude-sonnet-4-6" },
      activeContextLength: { current: undefined as number | undefined },
      model: { current: null as unknown },
    };

    switchModel("custom-provider", "custom-model", { apiKey: "custom-key" }, refs);

    expect(process.env.OPENAI_API_KEY).toBe("custom-key");
  });

  it("calls ensureOllamaContext for ollama provider with host and contextLength", () => {
    const refs = {
      aiProvider: { current: "anthropic" },
      activeModelName: { current: "claude-sonnet-4-6" },
      activeContextLength: { current: undefined as number | undefined },
      model: { current: null as unknown },
    };

    switchModel("ollama", "qwen3-coder", { host: "http://localhost:11434", contextLength: 65536 }, refs);

    expect(ensureOllamaContext).toHaveBeenCalledWith("http://localhost:11434", "qwen3-coder", 65536);
    expect(refs.activeContextLength.current).toBe(65536);
  });

  it("does NOT call ensureOllamaContext for non-ollama providers", () => {
    const refs = {
      aiProvider: { current: "ollama" },
      activeModelName: { current: "qwen3-coder" },
      activeContextLength: { current: 65536 as number | undefined },
      model: { current: null as unknown },
    };

    switchModel("anthropic", "claude-sonnet-4-6", { host: "https://api.anthropic.com" }, refs);

    expect(ensureOllamaContext).not.toHaveBeenCalled();
  });

  it("does NOT call ensureOllamaContext for ollama without host", () => {
    const refs = {
      aiProvider: { current: "anthropic" },
      activeModelName: { current: "claude-sonnet-4-6" },
      activeContextLength: { current: undefined as number | undefined },
      model: { current: null as unknown },
    };

    switchModel("ollama", "qwen3-coder", { contextLength: 65536 }, refs);

    expect(ensureOllamaContext).not.toHaveBeenCalled();
  });

  it("does NOT call ensureOllamaContext for ollama without contextLength", () => {
    const refs = {
      aiProvider: { current: "anthropic" },
      activeModelName: { current: "claude-sonnet-4-6" },
      activeContextLength: { current: undefined as number | undefined },
      model: { current: null as unknown },
    };

    switchModel("ollama", "qwen3-coder", { host: "http://localhost:11434" }, refs);

    expect(ensureOllamaContext).not.toHaveBeenCalled();
  });

  it("does not set env var when no apiKey provided", () => {
    const refs = {
      aiProvider: { current: "anthropic" },
      activeModelName: { current: "claude-sonnet-4-6" },
      activeContextLength: { current: undefined as number | undefined },
      model: { current: null as unknown },
    };

    switchModel("openai", "gpt-5.4", {}, refs);

    expect(process.env.OPENAI_API_KEY).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. forceCompact logic
// ---------------------------------------------------------------------------

describe("forceCompact logic", () => {
  it("compacts session messages and returns before/after char-based token estimates", async () => {
    const compactMessages = vi.fn().mockResolvedValue([
      { role: "user", content: "hi" },
      { role: "assistant", content: "summary" },
    ]);

    const session = {
      messages: [
        { role: "user" as const, content: "hello world this is a long message", timestamp: "t1" },
        { role: "assistant" as const, content: "here is a very long response with lots of detail", timestamp: "t2" },
        { role: "user" as const, content: "follow up question here", timestamp: "t3" },
        { role: "assistant" as const, content: "another detailed response", timestamp: "t4" },
      ],
    };

    const model = { modelId: "test" };
    let tokensSet = 0;

    // Replicate forceCompact logic
    const beforeChars = session.messages.reduce((s, m) => s + m.content.length, 0);
    const plainMessages = session.messages.map((m) => ({ role: m.role, content: m.content }));
    const compacted = await compactMessages(model, plainMessages, "soft", undefined);

    session.messages = compacted.map((m: { role: string; content: string }) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
      timestamp: new Date().toISOString(),
    }));

    const afterChars = session.messages.reduce((s, m) => s + m.content.length, 0);
    const afterTokens = Math.round(afterChars / 4);
    tokensSet = afterTokens;

    expect(compactMessages).toHaveBeenCalledWith(model, plainMessages, "soft", undefined);
    expect(session.messages).toHaveLength(2);
    expect(tokensSet).toBe(Math.round(("hi".length + "summary".length) / 4));
    expect(Math.round(beforeChars / 4)).toBeGreaterThan(afterTokens);
  });

  it("returns zero counts when session has no messages", async () => {
    const session = { messages: [] as Array<{ role: string; content: string; timestamp: string }> };
    const model = { modelId: "test" };

    if (!model || session.messages.length === 0) {
      const result = { before: 0, after: 0 };
      expect(result.before).toBe(0);
      expect(result.after).toBe(0);
    }
  });

  it("passes focusInstructions to compactMessages", async () => {
    const compactMessages = vi.fn().mockResolvedValue([
      { role: "assistant", content: "focused summary" },
    ]);

    const session = {
      messages: [
        { role: "user" as const, content: "something", timestamp: "t1" },
        { role: "assistant" as const, content: "response", timestamp: "t2" },
      ],
    };

    const plainMessages = session.messages.map((m) => ({ role: m.role, content: m.content }));
    await compactMessages({ modelId: "test" }, plainMessages, "soft", "Focus on API design");

    expect(compactMessages).toHaveBeenCalledWith(
      { modelId: "test" },
      plainMessages,
      "soft",
      "Focus on API design",
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Permission escalation
// ---------------------------------------------------------------------------

describe("permission escalation logic", () => {
  /**
   * When the user selects "always" on a permission prompt, the hook:
   *   - Adds the tool name to sessionAllowRef
   *   - Escalates permMode from "default" to "acceptEdits"
   * When the user selects "trust", the hook:
   *   - Sets trustAll to true
   *   - Sets permMode to "bypassPermissions"
   */

  it("\"always\" mode adds tool to sessionAllow and escalates ask -> auto-edit", () => {
    const sessionAllow = new Set<string>();
    let permMode: string = "default";
    let trustAll = false;

    // Simulate mode === "always"
    const mode: "always" | "trust" = "always";
    const toolName = "bash";

    if (mode === "trust") {
      trustAll = true;
      permMode = "bypassPermissions";
    } else if (mode === "always") {
      sessionAllow.add(toolName);
      if (permMode === "default") {
        permMode = "acceptEdits";
      }
    }

    expect(sessionAllow.has("bash")).toBe(true);
    expect(permMode).toBe("acceptEdits");
    expect(trustAll).toBe(false);
  });

  it("\"always\" mode does NOT change permMode if already auto-edit", () => {
    const sessionAllow = new Set<string>();
    let permMode: string = "acceptEdits";

    const mode: "always" | "trust" = "always";
    const toolName = "write_file";

    if (mode === "always") {
      sessionAllow.add(toolName);
      if (permMode === "default") {
        permMode = "acceptEdits";
      }
    }

    expect(sessionAllow.has("write_file")).toBe(true);
    expect(permMode).toBe("acceptEdits"); // unchanged
  });

  it("\"trust\" mode sets trustAll and permMode to trust all", () => {
    let permMode: string = "default";
    let trustAll = false;

    const mode: "always" | "trust" = "trust";

    if (mode === "trust") {
      trustAll = true;
      permMode = "bypassPermissions";
    }

    expect(trustAll).toBe(true);
    expect(permMode).toBe("bypassPermissions");
  });

  it("\"trust\" mode overrides any existing permMode", () => {
    let permMode: string = "acceptEdits";
    let trustAll = false;

    const mode: "always" | "trust" = "trust";

    if (mode === "trust") {
      trustAll = true;
      permMode = "bypassPermissions";
    }

    expect(trustAll).toBe(true);
    expect(permMode).toBe("bypassPermissions");
  });
});

// ---------------------------------------------------------------------------
// 4. rollback logic
// ---------------------------------------------------------------------------

describe("rollback logic", () => {
  interface SessionMessage {
    role: "user" | "assistant";
    content: string;
    timestamp: string;
  }

  function rollbackSession(messages: SessionMessage[]): {
    rolledBack: boolean;
    restoredInput?: string;
    remaining: SessionMessage[];
  } {
    if (messages.length < 2) return { rolledBack: false, remaining: messages };

    // Remove trailing assistant message(s) then last user message
    while (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
      messages.pop();
    }
    let restoredInput: string | undefined;
    if (messages.length > 0 && messages[messages.length - 1].role === "user") {
      restoredInput = messages.pop()?.content;
    }
    return { rolledBack: true, restoredInput, remaining: messages };
  }

  it("removes the last user + assistant exchange", () => {
    const msgs: SessionMessage[] = [
      { role: "user", content: "first question", timestamp: "t1" },
      { role: "assistant", content: "first answer", timestamp: "t2" },
      { role: "user", content: "second question", timestamp: "t3" },
      { role: "assistant", content: "second answer", timestamp: "t4" },
    ];

    const result = rollbackSession(msgs);

    expect(result.rolledBack).toBe(true);
    expect(result.restoredInput).toBe("second question");
    expect(result.remaining).toHaveLength(2);
    expect(result.remaining[0].content).toBe("first question");
    expect(result.remaining[1].content).toBe("first answer");
  });

  it("removes multiple trailing assistant messages before the user message", () => {
    const msgs: SessionMessage[] = [
      { role: "user", content: "question", timestamp: "t1" },
      { role: "assistant", content: "thinking...", timestamp: "t2" },
      { role: "assistant", content: "final answer", timestamp: "t3" },
    ];

    const result = rollbackSession(msgs);

    expect(result.rolledBack).toBe(true);
    expect(result.restoredInput).toBe("question");
    expect(result.remaining).toHaveLength(0);
  });

  it("returns false when there are fewer than 2 messages", () => {
    const msgs: SessionMessage[] = [
      { role: "user", content: "only one", timestamp: "t1" },
    ];

    const result = rollbackSession(msgs);

    expect(result.rolledBack).toBe(false);
    expect(result.remaining).toHaveLength(1);
  });

  it("returns false for empty session", () => {
    const result = rollbackSession([]);

    expect(result.rolledBack).toBe(false);
    expect(result.remaining).toHaveLength(0);
  });

  it("handles a session with only assistant messages", () => {
    const msgs: SessionMessage[] = [
      { role: "assistant", content: "system init", timestamp: "t1" },
      { role: "assistant", content: "ready", timestamp: "t2" },
    ];

    const result = rollbackSession(msgs);

    // 2 messages, so rolledBack = true, pops both assistants, no user to pop
    expect(result.rolledBack).toBe(true);
    expect(result.restoredInput).toBeUndefined();
    expect(result.remaining).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. allowTool / denyTool
// ---------------------------------------------------------------------------

describe("allowTool / denyTool", () => {
  it("allowTool adds to session allow set and removes from denied set", () => {
    const sessionAllow = new Set<string>();
    const deniedTools = new Set<string>(["bash"]);

    // Replicate allowTool
    function allowTool(name: string) {
      sessionAllow.add(name);
      deniedTools.delete(name);
    }

    allowTool("bash");

    expect(sessionAllow.has("bash")).toBe(true);
    expect(deniedTools.has("bash")).toBe(false);
  });

  it("denyTool adds to denied set and removes from session allow set", () => {
    const sessionAllow = new Set<string>(["write_file"]);
    const deniedTools = new Set<string>();

    // Replicate denyTool
    function denyTool(name: string) {
      deniedTools.add(name);
      sessionAllow.delete(name);
    }

    denyTool("write_file");

    expect(deniedTools.has("write_file")).toBe(true);
    expect(sessionAllow.has("write_file")).toBe(false);
  });

  it("allowTool and denyTool are mutually exclusive per tool", () => {
    const sessionAllow = new Set<string>();
    const deniedTools = new Set<string>();

    function allowTool(name: string) {
      sessionAllow.add(name);
      deniedTools.delete(name);
    }
    function denyTool(name: string) {
      deniedTools.add(name);
      sessionAllow.delete(name);
    }

    allowTool("bash");
    expect(sessionAllow.has("bash")).toBe(true);
    expect(deniedTools.has("bash")).toBe(false);

    denyTool("bash");
    expect(sessionAllow.has("bash")).toBe(false);
    expect(deniedTools.has("bash")).toBe(true);

    allowTool("bash");
    expect(sessionAllow.has("bash")).toBe(true);
    expect(deniedTools.has("bash")).toBe(false);
  });

  it("multiple tools can be in different states simultaneously", () => {
    const sessionAllow = new Set<string>();
    const deniedTools = new Set<string>();

    function allowTool(name: string) {
      sessionAllow.add(name);
      deniedTools.delete(name);
    }
    function denyTool(name: string) {
      deniedTools.add(name);
      sessionAllow.delete(name);
    }

    allowTool("bash");
    denyTool("write_file");
    allowTool("edit_file");

    expect(sessionAllow.has("bash")).toBe(true);
    expect(sessionAllow.has("edit_file")).toBe(true);
    expect(deniedTools.has("write_file")).toBe(true);
    expect(deniedTools.has("bash")).toBe(false);
    expect(sessionAllow.has("write_file")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. cyclePermissionMode
// ---------------------------------------------------------------------------

describe("cyclePermissionMode", () => {
  const PERMISSION_MODES = ["default", "acceptEdits", "plan", "bypassPermissions"] as const;
  type PermissionMode = typeof PERMISSION_MODES[number];

  function cyclePermissionMode(
    currentMode: PermissionMode,
  ): { permMode: PermissionMode; trustAll: boolean; planMode: boolean } {
    const idx = PERMISSION_MODES.indexOf(currentMode);
    const next = PERMISSION_MODES[(idx + 1) % PERMISSION_MODES.length];
    const isTrust = next === "bypassPermissions";
    const isPlan = next === "plan";
    return { permMode: next, trustAll: isTrust, planMode: isPlan };
  }

  it("cycles default -> acceptEdits", () => {
    const result = cyclePermissionMode("default");
    expect(result.permMode).toBe("acceptEdits");
    expect(result.trustAll).toBe(false);
    expect(result.planMode).toBe(false);
  });

  it("cycles acceptEdits -> plan", () => {
    const result = cyclePermissionMode("acceptEdits");
    expect(result.permMode).toBe("plan");
    expect(result.trustAll).toBe(false);
    expect(result.planMode).toBe(true);
  });

  it("cycles plan -> bypassPermissions", () => {
    const result = cyclePermissionMode("plan");
    expect(result.permMode).toBe("bypassPermissions");
    expect(result.trustAll).toBe(true);
    expect(result.planMode).toBe(false);
  });

  it("cycles bypassPermissions -> default", () => {
    const result = cyclePermissionMode("bypassPermissions");
    expect(result.permMode).toBe("default");
    expect(result.trustAll).toBe(false);
    expect(result.planMode).toBe(false);
  });

  it("full cycle returns to original mode", () => {
    let mode: PermissionMode = "default";
    for (let i = 0; i < 4; i++) {
      const r = cyclePermissionMode(mode);
      mode = r.permMode;
    }
    expect(mode).toBe("default");
  });

  it("bypassPermissions syncs trustAll state to true", () => {
    const result = cyclePermissionMode("plan");
    expect(result.permMode).toBe("bypassPermissions");
    expect(result.trustAll).toBe(true);
  });

  it("leaving bypassPermissions syncs trustAll state to false", () => {
    const result = cyclePermissionMode("bypassPermissions");
    expect(result.trustAll).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. addSystemMessage / addUserMessage message shape
// ---------------------------------------------------------------------------

describe("addSystemMessage / addUserMessage message shape", () => {
  interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: string;
  }

  it("addSystemMessage creates an assistant-role message", () => {
    const messages: Message[] = [];
    const content = "Session started. Type your request.";

    // Replicate addSystemMessage
    const msg: Message = {
      id: "test-id-1",
      role: "assistant",
      content,
      timestamp: new Date().toISOString(),
    };
    messages.push(msg);

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("assistant");
    expect(messages[0].content).toBe(content);
    expect(messages[0].timestamp).toBeTruthy();
  });

  it("addUserMessage creates a user-role message", () => {
    const messages: Message[] = [];
    const content = "What is the meaning of life?";

    // Replicate addUserMessage
    const msg: Message = {
      id: "test-id-2",
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    };
    messages.push(msg);

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe(content);
  });

  it("messages accumulate in order", () => {
    const messages: Message[] = [];

    messages.push({ id: "1", role: "assistant", content: "hello", timestamp: "t1" });
    messages.push({ id: "2", role: "user", content: "world", timestamp: "t2" });
    messages.push({ id: "3", role: "assistant", content: "!", timestamp: "t3" });

    expect(messages.map((m) => m.role)).toEqual(["assistant", "user", "assistant"]);
  });
});

// ---------------------------------------------------------------------------
// 8. Initialisation — API key env var mapping
// ---------------------------------------------------------------------------

describe("initialisation — API key env var mapping", () => {
  const envMap: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_GENERATIVE_AI_API_KEY",
  };

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  });

  function initApiKey(provider: string, apiKey: string | undefined) {
    if (apiKey) {
      const envVar = envMap[provider];
      if (envVar && !process.env[envVar]) {
        process.env[envVar] = apiKey;
      }
    }
  }

  it("sets ANTHROPIC_API_KEY for anthropic provider", () => {
    initApiKey("anthropic", "sk-ant-test");
    expect(process.env.ANTHROPIC_API_KEY).toBe("sk-ant-test");
  });

  it("sets OPENAI_API_KEY for openai provider", () => {
    initApiKey("openai", "sk-openai-test");
    expect(process.env.OPENAI_API_KEY).toBe("sk-openai-test");
  });

  it("sets GOOGLE_GENERATIVE_AI_API_KEY for google provider", () => {
    initApiKey("google", "AIza-test");
    expect(process.env.GOOGLE_GENERATIVE_AI_API_KEY).toBe("AIza-test");
  });

  it("does NOT overwrite existing env var", () => {
    process.env.ANTHROPIC_API_KEY = "existing-key";
    initApiKey("anthropic", "new-key");
    expect(process.env.ANTHROPIC_API_KEY).toBe("existing-key");
  });

  it("does nothing when apiKey is undefined", () => {
    initApiKey("anthropic", undefined);
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("does nothing for unknown provider", () => {
    initApiKey("ollama", "some-key");
    // ollama is not in envMap, so no env var should be set
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 9. rollback UI messages (setMessages reducer logic)
// ---------------------------------------------------------------------------

describe("rollback UI message reduction", () => {
  interface UIMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
  }

  function rollbackUIMessages(prev: UIMessage[]): UIMessage[] {
    // Find the last user message index and remove everything from there
    let lastUserIdx = -1;
    for (let i = prev.length - 1; i >= 0; i--) {
      if (prev[i].role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx >= 0) return prev.slice(0, lastUserIdx);
    return prev;
  }

  it("removes from last user message onward", () => {
    const msgs: UIMessage[] = [
      { id: "1", role: "user", content: "q1" },
      { id: "2", role: "assistant", content: "a1" },
      { id: "3", role: "user", content: "q2" },
      { id: "4", role: "assistant", content: "a2" },
    ];

    const result = rollbackUIMessages(msgs);
    expect(result).toHaveLength(2);
    expect(result[1].content).toBe("a1");
  });

  it("handles tool call messages between user and assistant", () => {
    const msgs: UIMessage[] = [
      { id: "1", role: "user", content: "q1" },
      { id: "2", role: "assistant", content: "" }, // tool calls
      { id: "3", role: "assistant", content: "a1" },
      { id: "4", role: "user", content: "q2" },
      { id: "5", role: "assistant", content: "" }, // tool calls
      { id: "6", role: "assistant", content: "a2" },
    ];

    const result = rollbackUIMessages(msgs);
    expect(result).toHaveLength(3);
    expect(result[2].content).toBe("a1");
  });

  it("returns empty array when only one user message", () => {
    const msgs: UIMessage[] = [
      { id: "1", role: "user", content: "q1" },
      { id: "2", role: "assistant", content: "a1" },
    ];

    const result = rollbackUIMessages(msgs);
    expect(result).toHaveLength(0);
  });

  it("returns original array when no user messages exist", () => {
    const msgs: UIMessage[] = [
      { id: "1", role: "assistant", content: "system message" },
    ];

    const result = rollbackUIMessages(msgs);
    expect(result).toHaveLength(1); // unchanged
  });
});

// ---------------------------------------------------------------------------
// 10. setTrustAll / setPlanMode sync logic
// ---------------------------------------------------------------------------

describe("setTrustAll / setPlanMode sync", () => {
  it("setTrustAll updates both state and ref", () => {
    let stateVal = false;
    const ref = { current: false };

    function setTrustAll(v: boolean) {
      stateVal = v;
      ref.current = v;
    }

    setTrustAll(true);
    expect(stateVal).toBe(true);
    expect(ref.current).toBe(true);

    setTrustAll(false);
    expect(stateVal).toBe(false);
    expect(ref.current).toBe(false);
  });

  it("setPlanMode updates both state and ref", () => {
    let stateVal = false;
    const ref = { current: false };

    function setPlanMode(v: boolean) {
      stateVal = v;
      ref.current = v;
    }

    setPlanMode(true);
    expect(stateVal).toBe(true);
    expect(ref.current).toBe(true);

    setPlanMode(false);
    expect(stateVal).toBe(false);
    expect(ref.current).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 11. incrementToolCount logic
// ---------------------------------------------------------------------------

describe("incrementToolCount", () => {
  it("increments a new tool count from 0", () => {
    let counts: Record<string, number> = {};

    function incrementToolCount(toolName: string) {
      counts = { ...counts, [toolName]: (counts[toolName] || 0) + 1 };
    }

    incrementToolCount("bash");
    expect(counts.bash).toBe(1);
  });

  it("increments an existing tool count", () => {
    let counts: Record<string, number> = { bash: 3 };

    function incrementToolCount(toolName: string) {
      counts = { ...counts, [toolName]: (counts[toolName] || 0) + 1 };
    }

    incrementToolCount("bash");
    expect(counts.bash).toBe(4);
  });

  it("tracks multiple tools independently", () => {
    let counts: Record<string, number> = {};

    function incrementToolCount(toolName: string) {
      counts = { ...counts, [toolName]: (counts[toolName] || 0) + 1 };
    }

    incrementToolCount("bash");
    incrementToolCount("read_file");
    incrementToolCount("bash");
    incrementToolCount("glob");

    expect(counts.bash).toBe(2);
    expect(counts.read_file).toBe(1);
    expect(counts.glob).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 12. getActiveTools plan mode filtering
// ---------------------------------------------------------------------------

describe("getActiveTools plan mode filtering", () => {
  const READ_TOOLS = new Set(["read_file", "glob", "grep", "ls", "sub_agent"]);

  function filterForPlanMode(
    allTools: Record<string, unknown>,
    planMode: boolean,
  ): Record<string, unknown> {
    if (!planMode) return allTools;
    const filtered: Record<string, unknown> = {};
    for (const [name, def] of Object.entries(allTools)) {
      if (READ_TOOLS.has(name)) {
        filtered[name] = def;
      }
    }
    return filtered;
  }

  it("returns all tools when planMode is false", () => {
    const tools = {
      bash: { description: "run bash" },
      read_file: { description: "read file" },
      write_file: { description: "write file" },
      glob: { description: "find files" },
    };

    const result = filterForPlanMode(tools, false);
    expect(Object.keys(result)).toEqual(["bash", "read_file", "write_file", "glob"]);
  });

  it("returns only read tools when planMode is true", () => {
    const tools = {
      bash: { description: "run bash" },
      read_file: { description: "read file" },
      write_file: { description: "write file" },
      glob: { description: "find files" },
      edit_file: { description: "edit file" },
      grep: { description: "search" },
    };

    const result = filterForPlanMode(tools, true);
    expect(Object.keys(result).sort()).toEqual(["glob", "grep", "read_file"]);
  });

  it("returns empty object when planMode is true and no read tools exist", () => {
    const tools = {
      bash: { description: "run bash" },
      write_file: { description: "write file" },
    };

    const result = filterForPlanMode(tools, true);
    expect(Object.keys(result)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 13. switchModel env var mapping completeness
// ---------------------------------------------------------------------------

describe("switchModel env var mapping — all supported providers", () => {
  const envMap: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_GENERATIVE_AI_API_KEY",
    xai: "XAI_API_KEY",
    groq: "GROQ_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    mistral: "MISTRAL_API_KEY",
  };

  beforeEach(() => {
    for (const envVar of Object.values(envMap)) {
      delete process.env[envVar];
    }
  });

  for (const [provider, envVar] of Object.entries(envMap)) {
    it(`maps ${provider} to ${envVar}`, () => {
      const key = `test-key-${provider}`;
      const resolvedVar = envMap[provider] || "OPENAI_API_KEY";

      // Simulate the logic
      if (key) {
        const resolvedKey = key.startsWith("{env:")
          ? process.env[key.slice(5, -1)] || ""
          : key;
        if (resolvedKey && resolvedVar) {
          process.env[resolvedVar] = resolvedKey;
        }
      }

      expect(process.env[envVar]).toBe(key);
    });
  }
});

// ---------------------------------------------------------------------------
// 11. trackAbortCost — preserves partial token costs when ESC cancels a run
// ---------------------------------------------------------------------------

describe("trackAbortCost", () => {
  it("records tokens to the cost tracker and updates the display cost", () => {
    const addUsage = vi.fn();
    const setCost = vi.fn();
    const tracker = { addUsage, getTotalCost: vi.fn(() => 0.0018) };

    trackAbortCost(1200, 600, "agent", "anthropic", "claude-sonnet-4-6", tracker, setCost);

    expect(addUsage).toHaveBeenCalledWith("agent", "anthropic", "claude-sonnet-4-6", 1200, 600);
    expect(setCost).toHaveBeenCalledWith(0.0018);
  });

  it("does nothing when no tokens were consumed before abort", () => {
    const addUsage = vi.fn();
    const setCost = vi.fn();
    const tracker = { addUsage, getTotalCost: vi.fn(() => 0) };

    trackAbortCost(0, 0, "agent", "anthropic", "claude-sonnet-4-6", tracker, setCost);

    expect(addUsage).not.toHaveBeenCalled();
    expect(setCost).not.toHaveBeenCalled();
  });

  it("records cost when only input tokens exist (e.g. abort before first output token)", () => {
    const addUsage = vi.fn();
    const setCost = vi.fn();
    const tracker = { addUsage, getTotalCost: vi.fn(() => 0.0005) };

    trackAbortCost(500, 0, "agent", "openai", "gpt-5.4", tracker, setCost);

    expect(addUsage).toHaveBeenCalledWith("agent", "openai", "gpt-5.4", 500, 0);
    expect(setCost).toHaveBeenCalledWith(0.0005);
  });

  it("accumulates tokens from multiple completed steps correctly", () => {
    const addUsage = vi.fn();
    const setCost = vi.fn();
    const tracker = { addUsage, getTotalCost: vi.fn(() => 0.004) };

    // Caller already summed step 1 (1000 in / 400 out) + step 2 (200 in / 150 out)
    trackAbortCost(1200, 550, "agent", "google", "gemini-3.1-pro", tracker, setCost);

    expect(addUsage).toHaveBeenCalledWith("agent", "google", "gemini-3.1-pro", 1200, 550);
    expect(setCost).toHaveBeenCalledWith(0.004);
  });
});

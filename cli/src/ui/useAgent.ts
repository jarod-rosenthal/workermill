import { useState, useCallback, useRef, useEffect } from "react";
import { streamText, stepCountIs, type ToolSet } from "ai";
import type { LanguageModel } from "ai";
import crypto from "crypto";
import {
  createModel,
  buildOllamaOptions,
} from "../../../packages/engine/src/model-factory.js";
import { createToolDefinitions } from "../../../packages/engine/src/tools/index.js";
import type { AIProvider } from "../../../packages/engine/src/types.js";
import {
  createSession,
  saveSession,
  addMessage,
  loadLatestSession,
  type Session,
} from "../session.js";
import { shouldCompact, compactMessages } from "../compaction.js";
import { CostTracker } from "../cost-tracker.js";
import { killActiveProcess } from "../../../packages/engine/src/tools/bash.js";
import type {
  Message,
  ToolCallInfo,
  PermissionRequest,
  AgentStatus,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Command patterns that require explicit confirmation even under trust-all. */
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern: /rm\s+(-[a-z]*f|-[a-z]*r|--force|--recursive)/i,
    label: "recursive/forced delete",
  },
  { pattern: /git\s+reset\s+--hard/i, label: "hard reset" },
  { pattern: /git\s+push\s+.*--force/i, label: "force push" },
  { pattern: /git\s+clean\s+-[a-z]*f/i, label: "git clean" },
  { pattern: /drop\s+table/i, label: "drop table" },
  { pattern: /truncate\s+/i, label: "truncate" },
  { pattern: /chmod\s+777/i, label: "chmod 777" },
];

/** Tools that are read-only and always allowed without prompting. */
const READ_TOOLS = new Set<string>([
  "read_file",
  "glob",
  "grep",
  "ls",
  "sub_agent",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyToolDef = any;

// ---------------------------------------------------------------------------
// Options & Return types
// ---------------------------------------------------------------------------

export interface UseAgentOptions {
  provider: string;
  model: string;
  apiKey?: string;
  host?: string;
  contextLength?: number;
  trustAll: boolean;
  planMode: boolean;
  sandboxed: boolean;
  resume: boolean;
}

export interface UseAgentReturn {
  /** Committed (finished) messages for rendering. */
  messages: Message[];
  /** Text currently being streamed by the model. */
  streamingText: string;
  /** Tool calls in progress during the current turn. */
  streamingToolCalls: ToolCallInfo[];
  /** High-level status of the agent loop. */
  status: AgentStatus;
  /** Non-null when the agent is waiting for a permission decision. */
  permissionRequest: PermissionRequest | null;
  /** Last observed input-token context usage. */
  tokens: number;
  /** Cumulative session cost in USD. */
  cost: number;
  /** The underlying session object (for status display). */
  session: Session;
  /** Send a user message and start the agent loop. */
  submit: (input: string) => void;
  /** Cancel the running stream / tool execution. */
  cancel: () => void;
  /** Toggle trust-all mode at runtime. */
  setTrustAll: (v: boolean) => void;
  /** Toggle plan (read-only) mode at runtime. */
  setPlanMode: (v: boolean) => void;
  /** Push a local-only assistant message into the conversation (no LLM call). */
  addSystemMessage: (content: string) => void;
  /** Push a local-only user message into the conversation (no LLM call). */
  addUserMessage: (content: string) => void;
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(workingDir: string): string {
  return `You are WorkerMill, an AI coding agent running in the user's terminal.

Working directory: ${workingDir}

## How to behave

- Be concise. Short replies unless the task demands detail.
- If the user says hello or asks a casual question, respond briefly. Do NOT explore the codebase, read files, or use tools unless the user asks you to do something specific.
- Only use tools when you have a concrete task. "Hello" is not a task.
- When you DO have a task, read relevant files first, make changes, and verify they work.
- Prefer editing existing files over creating new ones.
- Run tests after changes when test infrastructure exists.

## Communication style

Direct. No filler. No "Perfect!", "Great!", "Sure!". Lead with substance.
Do NOT repeat yourself across steps. Each response adds new information only.
Do NOT list your capabilities unless asked. Do NOT offer menus of options unprompted.

## Rules

- NEVER start long-running processes (dev servers, watch modes, etc.)
- NEVER run interactive commands that wait for user input
- Only run commands that complete and exit
- If the task specifies a dependency version, use that version. Trust the spec.

## Learnings

When you discover something non-obvious about this codebase, emit:
::learning::The test suite requires DATABASE_URL or tests silently skip`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAgent(options: UseAgentOptions): UseAgentReturn {
  // ------- Model & tools (created once) -------- //
  const modelRef = useRef<LanguageModel | null>(null);
  const toolsRef = useRef<Record<string, AnyToolDef> | null>(null);
  const aiProviderRef = useRef<AIProvider>(options.provider as AIProvider);

  // ------- React state -------- //
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [streamingToolCalls, setStreamingToolCalls] = useState<ToolCallInfo[]>(
    [],
  );
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [permissionRequest, setPermissionRequest] =
    useState<PermissionRequest | null>(null);
  const [tokens, setTokens] = useState(0);
  const [cost, setCost] = useState(0);
  const [trustAll, setTrustAllState] = useState(options.trustAll);
  const [planMode, setPlanModeState] = useState(options.planMode);

  // ------- Refs for mutable state -------- //
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<Session>(null as unknown as Session);
  const costTrackerRef = useRef(new CostTracker());
  const sessionAllowRef = useRef(new Set<string>());
  const trustAllRef = useRef(options.trustAll);
  const planModeRef = useRef(options.planMode);
  const workingDirRef = useRef(process.cwd());
  const initDoneRef = useRef(false);

  // Keep refs in sync with state so callbacks see fresh values.
  trustAllRef.current = trustAll;
  planModeRef.current = planMode;

  // ------- One-time initialisation -------- //
  if (!initDoneRef.current) {
    initDoneRef.current = true;

    // Set API keys in process.env when provided via options.
    if (options.apiKey) {
      const envMap: Record<string, string> = {
        anthropic: "ANTHROPIC_API_KEY",
        openai: "OPENAI_API_KEY",
        google: "GOOGLE_API_KEY",
      };
      const envVar = envMap[options.provider];
      if (envVar && !process.env[envVar]) {
        process.env[envVar] = options.apiKey;
      }
    }

    aiProviderRef.current = options.provider as AIProvider;
    modelRef.current = createModel(
      aiProviderRef.current,
      options.model,
      options.host,
      options.contextLength,
    );
    toolsRef.current = createToolDefinitions(
      workingDirRef.current,
      modelRef.current,
      options.sandboxed,
    );

    // Session: resume or create fresh.
    if (options.resume) {
      const loaded = loadLatestSession();
      if (loaded) {
        sessionRef.current = loaded;
        // Hydrate committed messages from the restored session.
        const restored: Message[] = loaded.messages.map((m) => ({
          id: crypto.randomUUID(),
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        }));
        // We cannot call setMessages during render initialisation, so we use
        // useEffect below to push the restored messages into state.
        (sessionRef as { current: Session & { _restored?: Message[] } }).current._restored =
          restored as never;
      } else {
        sessionRef.current = createSession(options.provider, options.model);
      }
    } else {
      sessionRef.current = createSession(options.provider, options.model);
    }
  }

  // Push restored messages into React state after first render.
  useEffect(() => {
    const s = sessionRef.current as Session & { _restored?: Message[] };
    if (s._restored) {
      setMessages(s._restored);
      delete s._restored;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------- Helpers -------- //

  /**
   * Detect dangerous bash patterns. Returns the label of the first match, or
   * null when the command is safe.
   */
  function detectDanger(
    toolName: string,
    toolInput: Record<string, unknown>,
  ): string | null {
    if (toolName !== "bash") return null;
    const command = String(toolInput.command ?? "");
    for (const { pattern, label } of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) return label;
    }
    return null;
  }

  // ------- Permission system -------- //

  /**
   * Resolve whether a tool call is allowed. For read-only tools or when
   * trust-all is enabled the promise resolves immediately. Otherwise we
   * surface a `PermissionRequest` and the UI component (PermissionPrompt)
   * will call `request.resolve()`.
   */
  const checkPermission = useCallback(
    (
      toolName: string,
      toolInput: Record<string, unknown>,
    ): Promise<{ allowed: boolean; mode?: "always" | "trust" }> => {
      const dangerLabel = detectDanger(toolName, toolInput);

      // Dangerous commands always require explicit confirmation.
      if (dangerLabel) {
        return new Promise((resolve) => {
          setPermissionRequest({
            toolName,
            toolInput,
            isDangerous: true,
            dangerLabel,
            resolve: (allowed: boolean, mode?: "always" | "trust") => {
              setPermissionRequest(null);
              resolve({ allowed, mode });
            },
          });
        });
      }

      // Trust-all bypasses all prompts for non-dangerous tools.
      if (trustAllRef.current) {
        return Promise.resolve({ allowed: true });
      }

      // Read-only tools never require permission.
      if (READ_TOOLS.has(toolName)) {
        return Promise.resolve({ allowed: true });
      }

      // Session-level "always allow" for this tool.
      if (sessionAllowRef.current.has(toolName)) {
        return Promise.resolve({ allowed: true });
      }

      // Interactive permission prompt via React state.
      return new Promise((resolve) => {
        setPermissionRequest({
          toolName,
          toolInput,
          isDangerous: false,
          resolve: (allowed: boolean, mode?: "always" | "trust") => {
            setPermissionRequest(null);
            resolve({ allowed, mode });
          },
        });
      });
    },
    [], // trustAllRef and sessionAllowRef are refs -- stable across renders.
  );

  // ------- Wrap tools with permission & state tracking -------- //

  /**
   * Build a permissioned tool map. Each tool's `execute` is wrapped so that:
   * 1. Permission is checked (may suspend on a Promise).
   * 2. The tool call is tracked in `streamingToolCalls` with live status.
   * 3. The original execute runs.
   * 4. Status is updated to "done" (or "denied").
   */
  const buildPermissionedTools = useCallback((): Record<string, AnyToolDef> => {
    const raw = toolsRef.current;
    if (!raw) return {};

    const wrapped: Record<string, AnyToolDef> = {};
    for (const [name, toolDef] of Object.entries(raw)) {
      const td = toolDef as AnyToolDef;
      wrapped[name] = {
        ...td,
        execute: async (input: Record<string, unknown>) => {
          const callId = crypto.randomUUID();

          // Register the call — push directly to committed messages (Static)
          // so it scrolls up naturally and never causes dynamic area jumping.
          const info: ToolCallInfo = {
            id: callId,
            name,
            input,
            status: "pending",
          };
          setStreamingToolCalls((prev) => [...prev, info]);

          // Push tool call to Static immediately
          setMessages((prev) => [
            ...prev,
            {
              id: `tc-${callId}`,
              role: "assistant" as const,
              content: "",
              toolCalls: [{ ...info, status: "running" as const }],
              timestamp: new Date().toISOString(),
            },
          ]);
          setStatus("permission");

          const { allowed, mode } = await checkPermission(name, input);

          // Handle mode escalation from the permission prompt.
          if (mode === "trust") {
            setTrustAllState(true);
          } else if (mode === "always") {
            sessionAllowRef.current.add(name);
          }

          if (!allowed) {
            setStreamingToolCalls((prev) =>
              prev.map((tc) =>
                tc.id === callId ? { ...tc, status: "denied" as const } : tc,
              ),
            );
            setStatus("streaming");
            return "Tool execution denied by user.";
          }

          // Mark as running.
          setStreamingToolCalls((prev) =>
            prev.map((tc) =>
              tc.id === callId ? { ...tc, status: "running" as const } : tc,
            ),
          );
          setStatus("tool_running");

          try {
            const result = await td.execute(input);
            const resultStr =
              typeof result === "string" ? result : JSON.stringify(result);

            // Mark as done with result.
            setStreamingToolCalls((prev) =>
              prev.map((tc) =>
                tc.id === callId
                  ? { ...tc, status: "done" as const, result: resultStr }
                  : tc,
              ),
            );
            setStatus("streaming");
            return result;
          } catch (err) {
            const errMsg =
              err instanceof Error ? err.message : String(err);
            setStreamingToolCalls((prev) =>
              prev.map((tc) =>
                tc.id === callId
                  ? {
                      ...tc,
                      status: "done" as const,
                      result: `Error: ${errMsg}`,
                    }
                  : tc,
              ),
            );
            setStatus("streaming");
            throw err;
          }
        },
      };
    }
    return wrapped;
  }, [checkPermission]);

  /**
   * Return the tool set that should be active for this turn, respecting plan
   * mode which restricts to read-only tools.
   */
  const getActiveTools = useCallback((): Record<string, AnyToolDef> => {
    const all = buildPermissionedTools();
    if (!planModeRef.current) return all;
    const filtered: Record<string, AnyToolDef> = {};
    for (const [name, def] of Object.entries(all)) {
      if (READ_TOOLS.has(name)) {
        filtered[name] = def;
      }
    }
    return filtered;
  }, [buildPermissionedTools]);

  // ------- submit() -------- //

  const submit = useCallback(
    (input: string) => {
      // Fire-and-forget async work; errors are caught internally.
      void (async () => {
        const session = sessionRef.current;

        // Add user message to session and committed messages.
        addMessage(session, "user", input);
        if (!session.name) {
          session.name = input.slice(0, 50).replace(/\n/g, " ");
        }

        const userMsg: Message = {
          id: crypto.randomUUID(),
          role: "user",
          content: input,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, userMsg]);

        // Reset streaming state for the new turn.
        setStreamingText("");
        setStreamingToolCalls([]);
        setStatus("thinking");

        const controller = new AbortController();
        abortRef.current = controller;

        // 10-minute safety timeout.
        const timeoutId = setTimeout(() => controller.abort(), 10 * 60 * 1000);

        try {
          const model = modelRef.current!;
          const systemPrompt = buildSystemPrompt(workingDirRef.current);

          const stream = streamText({
            model,
            system: systemPrompt,
            messages: session.messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            tools: getActiveTools() as ToolSet,
            stopWhen: stepCountIs(100),
            abortSignal: controller.signal,
            ...buildOllamaOptions(
              aiProviderRef.current,
              options.contextLength,
            ),
            onStepFinish({ text }) {
              if (text) {
                // Push step text directly to Static (committed messages)
                // so it scrolls up naturally — no dynamic area jumping.
                setMessages((prev) => [
                  ...prev,
                  {
                    id: crypto.randomUUID(),
                    role: "assistant" as const,
                    content: text,
                    timestamp: new Date().toISOString(),
                  },
                ]);
                setStreamingText(text);
                setStatus("streaming");
              }
            },
          });

          // Drive the stream to completion.
          for await (const _chunk of stream.textStream) {
            // Each chunk is handled by onStepFinish for text. We consume
            // the async iterator so the SDK processes all steps.
          }

          clearTimeout(timeoutId);

          // ---- Finalise ---- //
          const finalText = await stream.text;
          const usage = await stream.totalUsage;
          const inputTokens = usage?.inputTokens ?? 0;
          const outputTokens = usage?.outputTokens ?? 0;

          // Clear streaming state — text was already pushed to Static
          // via onStepFinish, so no need to add another message.
          setStreamingToolCalls([]);
          setStreamingText("");

          // Persist assistant text in the session.
          addMessage(session, "assistant", finalText);
          session.totalTokens += inputTokens + outputTokens;

          // Cost tracking.
          costTrackerRef.current.addUsage(
            "agent",
            options.provider,
            options.model,
            inputTokens,
            outputTokens,
          );
          setTokens(inputTokens);
          setCost(costTrackerRef.current.getTotalCost());

          // Save session to disk.
          saveSession(session);

          // ---- Auto-compaction ---- //
          const compactionLevel = shouldCompact(
            inputTokens,
            options.model,
            options.contextLength,
          );
          if (compactionLevel !== "none") {
            setStatus("thinking");
            const plainMessages = session.messages.map((m) => ({
              role: m.role,
              content: m.content,
            }));
            const compacted = await compactMessages(
              model,
              plainMessages,
              compactionLevel,
            );
            session.messages = compacted.map((m) => ({
              role: m.role,
              content: m.content,
              timestamp: new Date().toISOString(),
            }));
            saveSession(session);
          }

          setStatus("idle");
          abortRef.current = null;
        } catch (err) {
          clearTimeout(timeoutId);
          abortRef.current = null;

          if (err instanceof Error && err.name === "AbortError") {
            // Cancellation -- already handled by cancel().
            setStatus("idle");
            return;
          }

          // Surface the error as an assistant message so the user sees it.
          const errText =
            err instanceof Error ? err.message : String(err);
          const errorMsg: Message = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `Error: ${errText}`,
            timestamp: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, errorMsg]);
          setStreamingText("");
          setStreamingToolCalls([]);
          setStatus("idle");
        }
      })();
    },
    [getActiveTools, options.provider, options.model, options.contextLength],
  );

  // ------- cancel() -------- //

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      killActiveProcess();
    }
    setStatus("idle");
    setStreamingText("");
    setStreamingToolCalls([]);
    setPermissionRequest(null);
  }, []);

  // ------- Setters exposed to the UI -------- //

  const setTrustAll = useCallback((v: boolean) => {
    setTrustAllState(v);
    trustAllRef.current = v;
  }, []);

  const setPlanMode = useCallback((v: boolean) => {
    setPlanModeState(v);
    planModeRef.current = v;
  }, []);

  // ------- Local message helpers (for slash commands) -------- //

  const addSystemMessage = useCallback((content: string) => {
    const msg: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, msg]);
  }, []);

  const addUserMessage = useCallback((content: string) => {
    const msg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, msg]);
  }, []);

  // ------- Return -------- //

  return {
    messages,
    streamingText,
    streamingToolCalls,
    status,
    permissionRequest,
    tokens,
    cost,
    session: sessionRef.current,
    submit,
    cancel,
    setTrustAll,
    setPlanMode,
    addSystemMessage,
    addUserMessage,
  };
}

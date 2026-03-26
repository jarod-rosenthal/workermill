import { useState, useCallback, useRef, useEffect } from "react";
import { streamText, stepCountIs, type ToolSet } from "ai";
import type { LanguageModel } from "ai";
import crypto from "crypto";
import {
  createModel,
  buildOllamaOptions,
  ensureOllamaContext,
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
import { loadLearnings } from "../learnings.js";
import { formatProjectInstructions } from "../instructions.js";
import { parseImageReferences, toMessageContent, resolveFileReferences, resolveFolderReferences, resolveUrlReferences } from "../image-support.js";
import * as logger from "../logger.js";
import { startAllMCPServers, getMCPToolDefinitions, stopAllMCPServers } from "../mcp-client.js";
import { resolveConfig, type HooksConfig } from "../config.js";
import { runHooks } from "../hooks.js";
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

/** Tools auto-approved in "auto-edit" mode (everything except bash and destructive ops). */
const AUTO_EDIT_TOOLS = new Set<string>([
  "read_file", "write_file", "edit_file", "patch",
  "glob", "grep", "ls", "fetch", "git", "web_search", "todo", "sub_agent",
]);

const PERMISSION_MODES = ["ask", "auto-edit", "trust all"] as const;
type PermissionMode = typeof PERMISSION_MODES[number];

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
  maxTokens?: number;
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
  /** Human-readable detail for the current status (e.g. "Reading codebase..."). */
  statusDetail: string;
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
  /** Roll back the last user+assistant exchange from the conversation. */
  rollback: () => boolean;
  /** Toggle trust-all mode at runtime. */
  setTrustAll: (v: boolean) => void;
  /** Toggle plan (read-only) mode at runtime. */
  setPlanMode: (v: boolean) => void;
  /** Push a local-only assistant message into the conversation (no LLM call). */
  addSystemMessage: (content: string) => void;
  /** Push a local-only user message into the conversation (no LLM call). */
  addUserMessage: (content: string) => void;
  /** Update the displayed cost (used by orchestrator for live updates). */
  setCost: (cost: number) => void;
  /** Tool usage counts for status bar. */
  toolCounts: Record<string, number>;
  /** Session start time (ms). */
  sessionStart: number;
  /** Add a tool to the session allow set. */
  allowTool: (name: string) => void;
  /** Add a tool to the denied set (blocked for this session). */
  denyTool: (name: string) => void;
  /** Current permission mode label. */
  permissionMode: string;
  /** Cycle to the next permission mode (ask → auto-edit → trust all → ask). */
  cyclePermissionMode: () => void;
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(workingDir: string): string {
  const base = `You are WorkerMill, an open-source AI coding agent created by Jarod Rosenthal. Website: workermill.com

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

  const projectInstructions = formatProjectInstructions(workingDir);
  let prompt = base + projectInstructions;

  const learnings = loadLearnings();
  if (learnings.length > 0) {
    prompt += `\n\n## Project Learnings (from previous builds)\n\n${learnings.map(l => `- ${l}`).join("\n")}`;
  }
  return prompt;
}

// ---------------------------------------------------------------------------
// Tool status labels
// ---------------------------------------------------------------------------

function toolStatusLabel(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "read_file":
      return `Reading ${input.file_path || "file"}...`;
    case "write_file":
      return `Writing ${input.file_path || "file"}...`;
    case "edit_file":
      return `Editing ${input.file_path || "file"}...`;
    case "glob":
      return `Searching files${input.pattern ? ` (${input.pattern})` : ""}...`;
    case "grep":
      return `Searching code${input.pattern ? ` for "${String(input.pattern).slice(0, 30)}"` : ""}...`;
    case "ls":
      return `Listing ${input.path || "directory"}...`;
    case "bash": {
      const cmd = String(input.command || "").slice(0, 40);
      return `Running ${cmd}${String(input.command || "").length > 40 ? "..." : ""}`;
    }
    case "git":
      return `Git ${input.action || ""}...`;
    case "sub_agent":
      return "Running sub-agent...";
    case "browser_open":
      return "Opening browser...";
    case "browser_navigate":
      return `Navigating to ${input.url || "page"}...`;
    case "browser_screenshot":
      return "Taking screenshot...";
    case "browser_click":
      return `Clicking ${input.selector || "element"}...`;
    case "browser_fill":
      return `Filling ${input.selector || "field"}...`;
    case "browser_evaluate":
      return "Running JavaScript...";
    case "browser_console":
      return "Reading console...";
    case "browser_close":
      return "Closing browser...";
    default:
      return `Running ${toolName}...`;
  }
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
  const [streamingToolCalls, _setStreamingToolCalls] = useState<ToolCallInfo[]>(
    [],
  );
  const streamingToolCallsRef = useRef<ToolCallInfo[]>([]);
  // Wrapper that keeps ref in sync with state for finalization.
  const setStreamingToolCalls: typeof _setStreamingToolCalls = (action) => {
    _setStreamingToolCalls((prev) => {
      const next = typeof action === "function" ? action(prev) : action;
      streamingToolCallsRef.current = next;
      return next;
    });
  };
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [statusDetail, setStatusDetail] = useState("");
  const [permissionRequest, setPermissionRequest] =
    useState<PermissionRequest | null>(null);
  const [tokens, setTokens] = useState(0);
  const [cost, setCost] = useState(0);
  const [toolCounts, setToolCounts] = useState<Record<string, number>>({});
  const sessionStartRef = useRef(Date.now());
  const [trustAll, setTrustAllState] = useState(options.trustAll);
  const [planMode, setPlanModeState] = useState(options.planMode);
  const [permMode, setPermMode] = useState<PermissionMode>(options.trustAll ? "trust all" : "ask");

  // ------- Refs for mutable state -------- //
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<Session>(null as unknown as Session);
  const costTrackerRef = useRef(new CostTracker());
  const sessionAllowRef = useRef(new Set<string>());
  const deniedToolsRef = useRef(new Set<string>());
  const trustAllRef = useRef(options.trustAll);
  const planModeRef = useRef(options.planMode);
  const permModeRef = useRef<PermissionMode>(options.trustAll ? "trust all" : "ask");
  const workingDirRef = useRef(process.cwd());
  const hooksConfigRef = useRef<HooksConfig | undefined>(undefined);
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
        google: "GOOGLE_GENERATIVE_AI_API_KEY",
      };
      const envVar = envMap[options.provider];
      if (envVar && !process.env[envVar]) {
        process.env[envVar] = options.apiKey;
      }
    }

    aiProviderRef.current = options.provider as AIProvider;

    // Ensure Ollama context length matches config (fire-and-forget —
    // unload completes before the first user prompt in practice)
    if (aiProviderRef.current === "ollama" && options.host && options.contextLength) {
      void ensureOllamaContext(options.host, options.model, options.contextLength);
    }

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

    // Start MCP servers if configured (fire-and-forget — tools available
    // by the time the user sends their first prompt in practice).
    try {
      const cliConfig = resolveConfig();
      if (cliConfig?.mcp && Object.keys(cliConfig.mcp).length > 0) {
        void startAllMCPServers(cliConfig.mcp);
      }
      hooksConfigRef.current = cliConfig?.hooks;
    } catch (err) {
      logger.debug("Config/MCP init skipped", { error: err instanceof Error ? err.message : String(err) });
    }

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
      // Denied tools are always blocked.
      if (deniedToolsRef.current.has(toolName)) {
        return Promise.resolve({ allowed: false });
      }

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

      // Auto-edit mode: auto-approve everything except bash.
      if (permModeRef.current === "auto-edit" && AUTO_EDIT_TOOLS.has(toolName)) {
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

    // Merge MCP tools (dynamically resolved each call so tools from
    // servers that finish starting after init are picked up).
    const allRawTools: Record<string, AnyToolDef> = { ...raw, ...getMCPToolDefinitions() };

    // Browser tools — added only when Chrome is available or user explicitly opens
    // These are NOT added to allRawTools to avoid breaking tool serialization.
    // Users access browser via /chrome command which manages the lifecycle.

    const wrapped: Record<string, AnyToolDef> = {};
    for (const [name, toolDef] of Object.entries(allRawTools)) {
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
          setStatusDetail(toolStatusLabel(name, input));

          try {
            logger.info("Tool call", { tool: name, input: JSON.stringify(input).slice(0, 200) });
            setToolCounts(prev => ({ ...prev, [name]: (prev[name] || 0) + 1 }));
            runHooks("pre", name, hooksConfigRef.current, workingDirRef.current);
            const result = await td.execute(input);
            runHooks("post", name, hooksConfigRef.current, workingDirRef.current);
            const resultStr =
              typeof result === "string" ? result : JSON.stringify(result);
            logger.debug("Tool result", { tool: name, result: resultStr.slice(0, 200) });

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

        // Resolve @file, @folder/, and @url references
        let resolvedInput = resolveFileReferences(input, workingDirRef.current);
        resolvedInput = resolveFolderReferences(resolvedInput, workingDirRef.current);
        resolvedInput = await resolveUrlReferences(resolvedInput);

        const turnStartTime = Date.now();

        // Add user message to session and committed messages.
        addMessage(session, "user", resolvedInput);
        logger.info("User message", { length: resolvedInput.length, preview: input.slice(0, 100) });
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
        setStatusDetail("");

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
            messages: session.messages.map((m) => {
              if (m.role === "user") {
                const { parts, hasImages } = parseImageReferences(m.content, workingDirRef.current);
                if (hasImages) {
                  return { role: "user" as const, content: toMessageContent(parts) as any };
                }
              }
              return { role: m.role as "user" | "assistant", content: m.content };
            }),
            tools: getActiveTools() as ToolSet,
            maxOutputTokens: options.maxTokens,
            stopWhen: stepCountIs(100),
            abortSignal: controller.signal,
            ...buildOllamaOptions(
              aiProviderRef.current,
              options.contextLength,
            ),
            onStepFinish({ text }) {
              if (text) {
                // Keep step text in the dynamic area via streamingText.
                // It will be committed to Static when the full response completes.
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

          // Commit the full response to Static as one message.
          // Tool calls and text were kept in the dynamic area until now.
          setMessages((prev) => {
            const newMessages: Message[] = [];

            // Commit accumulated tool calls
            const currentToolCalls = streamingToolCallsRef.current;
            if (currentToolCalls.length > 0) {
              newMessages.push({
                id: crypto.randomUUID(),
                role: "assistant" as const,
                content: "",
                toolCalls: currentToolCalls,
                timestamp: new Date().toISOString(),
              });
            }

            // Commit final text
            if (finalText) {
              newMessages.push({
                id: crypto.randomUUID(),
                role: "assistant" as const,
                content: finalText,
                timestamp: new Date().toISOString(),
              });
            }

            return [...prev, ...newMessages];
          });

          // Clear streaming state
          setStreamingToolCalls([]);
          setStreamingText("");

          // Persist assistant text in the session.
          addMessage(session, "assistant", finalText);
          session.totalTokens += inputTokens + outputTokens;
          logger.info("Response complete", { inputTokens, outputTokens, textLength: finalText.length });

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
        setStatusDetail("");
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

          // Ring terminal bell for long operations (>10s)
          if (Date.now() - turnStartTime > 10_000) {
            process.stdout.write("\x07");
          }
        } catch (err) {
          clearTimeout(timeoutId);
          abortRef.current = null;

          if (err instanceof Error && err.name === "AbortError") {
            // Cancellation -- already handled by cancel().
            setStatus("idle");
            return;
          }

          // Commit any tool calls to Static before showing error.
          const errToolCalls = streamingToolCallsRef.current;
          const errText =
            err instanceof Error ? err.message : String(err);
          logger.error("Agent error", { error: errText });

          setMessages((prev) => {
            const newMsgs: Message[] = [];
            if (errToolCalls.length > 0) {
              newMsgs.push({
                id: crypto.randomUUID(),
                role: "assistant" as const,
                content: "",
                toolCalls: errToolCalls,
                timestamp: new Date().toISOString(),
              });
            }
            newMsgs.push({
              id: crypto.randomUUID(),
              role: "assistant" as const,
              content: `Error: ${errText}`,
              timestamp: new Date().toISOString(),
            });
            return [...prev, ...newMsgs];
          });
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
    // Commit any completed tool calls to Static before clearing.
    const currentToolCalls = streamingToolCallsRef.current;
    if (currentToolCalls.length > 0) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant" as const,
          content: "",
          toolCalls: currentToolCalls,
          timestamp: new Date().toISOString(),
        },
      ]);
    }
    setStatus("idle");
    setStreamingText("");
    setStreamingToolCalls([]);
    setPermissionRequest(null);
  }, []);

  /** Remove the last user+assistant exchange from the session. Returns true if rolled back. */
  const rollback = useCallback((): boolean => {
    const session = sessionRef.current;
    if (session.messages.length < 2) return false;

    // Remove trailing assistant message(s) and the last user message
    while (session.messages.length > 0 && session.messages[session.messages.length - 1].role === "assistant") {
      session.messages.pop();
    }
    if (session.messages.length > 0 && session.messages[session.messages.length - 1].role === "user") {
      session.messages.pop();
    }
    saveSession(session);

    // Also remove from the committed messages UI list
    setMessages((prev) => {
      // Find the last user message index and remove everything from there
      let lastUserIdx = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === "user") { lastUserIdx = i; break; }
      }
      if (lastUserIdx >= 0) return prev.slice(0, lastUserIdx);
      return prev;
    });

    return true;
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

  const cyclePermissionMode = useCallback(() => {
    const idx = PERMISSION_MODES.indexOf(permModeRef.current);
    const next = PERMISSION_MODES[(idx + 1) % PERMISSION_MODES.length];
    setPermMode(next);
    permModeRef.current = next;
    // Sync trustAll state
    const isTrust = next === "trust all";
    setTrustAllState(isTrust);
    trustAllRef.current = isTrust;
  }, []);

  // ------- Per-tool permission helpers -------- //

  const allowTool = useCallback((name: string) => {
    sessionAllowRef.current.add(name);
    deniedToolsRef.current.delete(name);
  }, []);

  const denyTool = useCallback((name: string) => {
    deniedToolsRef.current.add(name);
    sessionAllowRef.current.delete(name);
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
    statusDetail,
    permissionRequest,
    tokens,
    cost,
    session: sessionRef.current,
    submit,
    cancel,
    rollback,
    setTrustAll,
    setPlanMode,
    addSystemMessage,
    addUserMessage,
    setCost,
    allowTool,
    denyTool,
    permissionMode: permMode,
    cyclePermissionMode,
    toolCounts,
    sessionStart: sessionStartRef.current,
  };
}

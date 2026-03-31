import { useState, useCallback, useRef, useEffect } from "react";
import { streamText, stepCountIs, type ToolSet } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
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
  forkSession,
  type Session,
} from "../session.js";
import { shouldCompact, compactMessages } from "../compaction.js";
import { CostTracker } from "../cost-tracker.js";
import { killActiveProcess } from "../../../packages/engine/src/tools/bash.js";
import { extractMemoryMarkers, addMemory } from "../memory.js";
import { parseImageReferences, toMessageContent, resolveFileReferences, resolveFolderReferences, resolveUrlReferences } from "../image-support.js";
import * as logger from "../logger.js";
import { getMCPToolDefinitions, stopAllMCPServers, autoDetectMCPServers, registerMCPServers, hasMCPRegistered } from "../mcp-client.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { resolveConfig, type HooksConfig, type PermissionRuleConfig } from "../config.js";
import { toolStatusLabel } from "./tool-status.js";
import { runHooks } from "../hooks.js";
import { browserOpen, browserNavigate, browserScreenshot, browserClick, browserFill, browserEvaluate, browserConsole, browserClose } from "../browser.js";
import path from "path";
import { isDangerous, READ_TOOLS, AUTO_EDIT_TOOLS, checkPermissionRules } from "../safety.js";
import { checkpoint } from "../checkpoints.js";
import type {
  Message,
  ToolCallInfo,
  PermissionRequest,
  AgentStatus,
} from "./types.js";

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
  fork: boolean;
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
  /** Send a user message and start the agent loop. Optional displayText controls what the user sees (full input still sent to model). */
  submit: (input: string, displayText?: string) => void;
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
  /** Increment tool count for the status bar (used by orchestrator). */
  incrementToolCount: (toolName: string) => void;
  /** Tokens-per-second map keyed by provider/model. */
  tokPerSec: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAgent(options: UseAgentOptions): UseAgentReturn {
  // ------- Model & tools (created once) -------- //
  const modelRef = useRef<LanguageModel | null>(null);
  const toolsRef = useRef<Record<string, AnyToolDef> | null>(null);
  const aiProviderRef = useRef<AIProvider>(options.provider as AIProvider);
  const activeModelNameRef = useRef(options.model);
  const activeContextLengthRef = useRef(options.contextLength);

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
  const [tokPerSec, setTokPerSecMap] = useState<Record<string, number>>({});
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
  const permissionRulesRef = useRef<PermissionRuleConfig | undefined>(undefined);
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

    // Register MCP servers for lazy start — they won't spawn until first tool use
    try {
      const cliConfig = resolveConfig();
      const mcpConfig = autoDetectMCPServers(cliConfig?.mcp || {});
      registerMCPServers(mcpConfig);
      hooksConfigRef.current = cliConfig?.hooks;
      permissionRulesRef.current = cliConfig?.permissions;
    } catch (err) {
      logger.warn("Config/MCP init failed", { error: err instanceof Error ? err.message : String(err) });
    }

    // Session: resume or create fresh.
    if (options.resume) {
      const loaded = loadLatestSession();
      if (loaded) {
        // Fork: copy session with new ID, leaving original untouched
        const session = options.fork ? forkSession(loaded) : loaded;
        if (options.fork) {
          saveSession(session);
          logger.info("Forked session", { originalId: loaded.id, forkId: session.id });
        } else {
          logger.info("Resumed session", { sessionId: loaded.id, messageCount: loaded.messages.length });
        }
        sessionRef.current = session;
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
    return isDangerous(String(toolInput.command ?? ""));
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

      // Granular permission rules — deny always wins, allow skips prompt.
      const ruleResult = checkPermissionRules(toolName, toolInput, permissionRulesRef.current);
      if (ruleResult === "deny") {
        return Promise.resolve({ allowed: false });
      }
      if (ruleResult === "allow") {
        return Promise.resolve({ allowed: true });
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

    // Browser tools — use Zod inputSchema for cross-provider compatibility.
    allRawTools.browser_open = {
      description: "Open a headless Chrome browser for navigating websites, taking screenshots, and verifying UI.",
      inputSchema: z.object({}),
      execute: async () => browserOpen(),
    };
    allRawTools.browser_navigate = {
      description: "Navigate the browser to a URL. Returns the page title.",
      inputSchema: z.object({ url: z.string().describe("URL to navigate to") }),
      execute: async ({ url }: { url: string }) => browserNavigate(url),
    };
    allRawTools.browser_screenshot = {
      description: "Take a screenshot of the current browser page. Returns the image for visual inspection.",
      inputSchema: z.object({}),
      execute: async () => {
        const { base64, description } = await browserScreenshot();
        if (base64) {
          return `${description}\n[Screenshot captured — image data available for analysis]`;
        }
        return description;
      },
    };
    allRawTools.browser_click = {
      description: "Click an element on the page by CSS selector.",
      inputSchema: z.object({ selector: z.string().describe("CSS selector (e.g., 'button.submit', '#login')") }),
      execute: async ({ selector }: { selector: string }) => browserClick(selector),
    };
    allRawTools.browser_fill = {
      description: "Fill a form field by CSS selector with a value.",
      inputSchema: z.object({ selector: z.string().describe("CSS selector for the input field"), value: z.string().describe("Value to fill") }),
      execute: async ({ selector, value }: { selector: string; value: string }) => browserFill(selector, value),
    };
    allRawTools.browser_evaluate = {
      description: "Execute JavaScript in the browser and return the result.",
      inputSchema: z.object({ expression: z.string().describe("JavaScript expression to evaluate") }),
      execute: async ({ expression }: { expression: string }) => browserEvaluate(expression),
    };
    allRawTools.browser_console = {
      description: "Get console messages (log, error, warn) from the browser.",
      inputSchema: z.object({}),
      execute: async () => browserConsole(),
    };
    allRawTools.browser_close = {
      description: "Close the headless Chrome browser.",
      inputSchema: z.object({}),
      execute: async () => browserClose(),
    };

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
          // Both update refs for behavior, and update displayed mode for consistency.
          if (mode === "trust") {
            trustAllRef.current = true;
            setTrustAllState(true);
            permModeRef.current = "trust all";
            setPermMode("trust all");
          } else if (mode === "always") {
            sessionAllowRef.current.add(name);
            // Reflect in status bar — show auto-edit since user is granting standing permissions
            if (permModeRef.current === "ask") {
              permModeRef.current = "auto-edit";
              setPermMode("auto-edit");
            }
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
            // Checkpoint file before write/edit operations
            if ((name === "write_file" || name === "edit_file") && input.path) {
              const filePath = String(input.path);
              const resolved = filePath.startsWith("/") ? filePath : path.resolve(workingDirRef.current, filePath);
              checkpoint(resolved);
            }
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
   * Async: triggers lazy MCP server start on first call.
   */
  const getActiveTools = useCallback(async (): Promise<Record<string, AnyToolDef>> => {
    // Lazy-start MCP servers on first prompt submission (not on CLI launch)
    const { ensureMCPStarted } = await import("../mcp-client.js");
    await ensureMCPStarted();

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
    (input: string, displayText?: string) => {
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
          content: displayText ?? input,
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

        // No artificial timeout — the user controls cancellation via ESC/Ctrl+C.

        try {
          const model = modelRef.current!;
          // Await tools first — triggers lazy MCP start so system prompt sees MCP tools
          const activeTools = (await getActiveTools()) as ToolSet;
          const systemPrompt = buildSystemPrompt(workingDirRef.current);
          logger.info("Starting streamText", {
            provider: aiProviderRef.current,
            model: options.model,
            toolCount: Object.keys(activeTools).length,
            tools: Object.keys(activeTools).join(", "),
            messageCount: session.messages.length,
          });

          const agentStreamStartMs = Date.now();
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
            tools: activeTools,
            maxOutputTokens: options.maxTokens,
            stopWhen: stepCountIs(100),
            abortSignal: controller.signal,
            ...buildOllamaOptions(
              aiProviderRef.current,
              activeContextLengthRef.current,
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


          // ---- Finalise ---- //
          const finalText = await stream.text;
          const usage = await stream.totalUsage;
          const inputTokens = usage?.inputTokens ?? 0;
          const outputTokens = usage?.outputTokens ?? 0;

          // Extract and save memories from model output
          const newMemories = extractMemoryMarkers(finalText);
          for (const m of newMemories) {
            addMemory(m.type, m.content);
          }

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

          // Track tok/s for this model — use active refs, not startup options
          const agentElapsed = (Date.now() - agentStreamStartMs) / 1000;
          if (outputTokens > 0 && agentElapsed > 0) {
            const providerModel = `${aiProviderRef.current}/${activeModelNameRef.current}`;
            const tps = Math.round(outputTokens / agentElapsed);
            setTokPerSecMap(prev => ({ ...prev, [providerModel]: tps }));
          }

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

        } catch (err) {
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

  // ------- switchModel() — hot-swap provider/model mid-session -------- //

  const switchModel = useCallback((newProvider: string, newModel: string) => {
    const config = resolveConfig();
    const providerConfig = config?.providers?.[newProvider];
    const host = providerConfig?.host;
    const contextLength = providerConfig?.contextLength;

    // Ensure API key is in process.env for cloud providers
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
      // OpenAI-compatible providers use OPENAI_API_KEY as fallback
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

    aiProviderRef.current = newProvider as AIProvider;
    activeModelNameRef.current = newModel;
    activeContextLengthRef.current = contextLength;
    modelRef.current = createModel(newProvider as AIProvider, newModel, host, contextLength);

    // Ollama needs context length ensured before first use
    if (newProvider === "ollama" && host && contextLength) {
      void ensureOllamaContext(host, newModel, contextLength);
    }
  }, []);

  // ------- forceCompact() — user-triggered compaction -------- //

  const forceCompact = useCallback(async (focusInstructions?: string): Promise<{ before: number; after: number }> => {
    const session = sessionRef.current;
    const model = modelRef.current;
    if (!model || !session || session.messages.length === 0) {
      return { before: 0, after: 0 };
    }

    const beforeChars = session.messages.reduce((s, m) => s + m.content.length, 0);
    const plainMessages = session.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const compacted = await compactMessages(model, plainMessages, "soft", focusInstructions);
    session.messages = compacted.map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: new Date().toISOString(),
    }));
    saveSession(session);

    const afterChars = session.messages.reduce((s, m) => s + m.content.length, 0);
    const afterTokens = Math.round(afterChars / 4);
    // Update the displayed token count so the status bar reflects compaction
    setTokens(afterTokens);
    return { before: Math.round(beforeChars / 4), after: afterTokens };
  }, []);

  // ------- Tool count helper (for orchestrator) -------- //

  const incrementToolCount = useCallback((toolName: string) => {
    setToolCounts(prev => ({ ...prev, [toolName]: (prev[toolName] || 0) + 1 }));
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
    incrementToolCount,
    tokPerSec,
    switchModel,
    forceCompact,
  };
}

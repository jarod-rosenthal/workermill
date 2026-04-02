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
import { shouldCompact, compactMessages, microCompact, extractMemoriesBeforeCompact, estimateContextTokens } from "../compaction.js";
import { CostTracker } from "../cost-tracker.js";
import { killActiveProcess } from "../../../packages/engine/src/tools/bash.js";
import { extractMemoryMarkers, addMemory } from "../memory.js";
import { parseImageReferences, toMessageContent, resolveFileReferences, resolveFolderReferences, resolveUrlReferences } from "../image-support.js";
import * as logger from "../logger.js";
import { getMCPToolDefinitions, stopAllMCPServers, autoDetectMCPServers, registerMCPServers, hasMCPRegistered } from "../mcp-client.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { partitionTools, formatDeferredToolsForPrompt, type DeferredToolEntry } from "../deferred-tools.js";
import { resolveConfig, type HooksConfig, type PermissionRuleConfig } from "../config.js";
import { toolStatusLabel } from "./tool-status.js";
import { runHooks, runPreHooksWithBlocking } from "../hooks.js";
import { browserOpen, browserNavigate, browserScreenshot, browserClick, browserFill, browserEvaluate, browserConsole, browserClose } from "../browser.js";
import path from "path";
import { isDangerous, isDangerousFile, READ_TOOLS, ACCEPT_EDITS_TOOLS, checkPermissionRules, splitCompoundCommand, commandToRule } from "../safety.js";
import { notifyIfEnabled } from "../notify.js";
import { checkpoint } from "../checkpoints.js";
import { withConcurrencyControl } from "../tool-concurrency.js";
import type {
  Message,
  ToolCallInfo,
  PermissionRequest,
  AgentStatus,
} from "./types.js";

// Tool call loop detection — matches orchestrator pattern
const LOOP_WINDOW = 6;
const LOOP_THRESHOLD = 4;

// Rate limit retry config
const MAX_RATE_LIMIT_RETRIES = 3;

/** Check if an error indicates a rate limit (HTTP 429) and extract the wait duration. */
function isRateLimitError(err: unknown): { retryAfterMs: number } | null {
  if (!err || typeof err !== "object") return null;
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  // Quick exit — not a rate limit
  const RATE_LIMIT_SIGNALS = ["429", "rate limit", "too many requests", "quota exceeded"];
  if (!RATE_LIMIT_SIGNALS.some(signal => lower.includes(signal))) return null;

  // 1. Parse "retry after N" from the error message body
  const inlineSeconds = lower.match(/retry[\s\-_.]?after[:\s]+(\d+)/)?.[1];
  if (inlineSeconds) return { retryAfterMs: Number(inlineSeconds) * 1000 };

  // 2. Read the Retry-After HTTP header if the error exposes it
  const headers = (err as Record<string, unknown>).headers ?? (err as Record<string, unknown>).responseHeaders;
  if (headers && typeof headers === "object") {
    const raw = (headers as Record<string, string>)["retry-after"];
    const parsed = raw ? Number(raw) : NaN;
    if (!Number.isNaN(parsed) && parsed > 0) return { retryAfterMs: parsed * 1000 };
  }

  // 3. Fallback — wait 30 seconds
  return { retryAfterMs: 30_000 };
}

/** Modes in the shift+tab cycle. */
const PERMISSION_MODES = ["default", "acceptEdits", "plan", "bypassPermissions"] as const;
/** All valid permission modes including CLI-only modes not in the cycle. */
type PermissionMode = typeof PERMISSION_MODES[number] | "dontAsk";

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
  /** Synchronous ref-based check for bypass mode (not subject to React state delay). */
  isBypassMode: () => boolean;
  /** Cycle to the next permission mode (ask → auto-edit → trust all → ask). */
  cyclePermissionMode: () => void;
  /** Increment tool count for the status bar (used by orchestrator). */
  incrementToolCount: (toolName: string) => void;
  /** Tokens-per-second map keyed by provider/model. */
  tokPerSec: Record<string, number>;
  /** Switch the active model at runtime. */
  switchModel: (provider: string, model: string) => void;
  /** Force a compaction of the conversation. */
  forceCompact: (focusInstructions?: string) => Promise<{ before: number; after: number }>;
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
  const [permMode, setPermMode] = useState<PermissionMode>(options.trustAll ? "bypassPermissions" : options.planMode ? "plan" : "default");

  // ------- Refs for mutable state -------- //
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<Session>(null as unknown as Session);
  const costTrackerRef = useRef(new CostTracker());
  const sessionAllowRef = useRef(new Set<string>());
  const deniedToolsRef = useRef(new Set<string>());
  const trustAllRef = useRef(options.trustAll);
  const planModeRef = useRef(options.planMode);
  const permModeRef = useRef<PermissionMode>(options.trustAll ? "bypassPermissions" : options.planMode ? "plan" : "default");
  const workingDirRef = useRef(process.cwd());
  const hooksConfigRef = useRef<HooksConfig | undefined>(undefined);
  const bellEnabledRef = useRef<boolean | undefined>(undefined);
  const permissionRulesRef = useRef<PermissionRuleConfig | undefined>(undefined);
  const recentToolSignaturesRef = useRef<string[]>([]);
  const initDoneRef = useRef(false);

  // Deferred tool loading — MCP tools start deferred, promoted on tool_search
  const deferredToolsRef = useRef<DeferredToolEntry[]>([]);
  const promotedToolsRef = useRef<Set<string>>(new Set());

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
      bellEnabledRef.current = cliConfig?.bell;
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
    // Dangerous bash commands
    if (toolName === "bash") {
      return isDangerous(String(toolInput.command ?? ""));
    }
    // Dangerous file paths for write operations
    if (toolName === "write_file" || toolName === "edit_file" || toolName === "patch") {
      const filePath = String(toolInput.path || toolInput.file_path || "");
      if (filePath) return isDangerousFile(filePath);
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

      // Granular permission rules — deny > ask > allow.
      const ruleResult = checkPermissionRules(toolName, toolInput, permissionRulesRef.current);
      if (ruleResult === "deny") {
        return Promise.resolve({ allowed: false });
      }
      if (ruleResult === "ask") {
        // Force prompt even in acceptEdits/bypassPermissions mode
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
      }
      if (ruleResult === "allow") {
        return Promise.resolve({ allowed: true });
      }

      // bypassPermissions mode — auto-approve everything.
      if (trustAllRef.current || permModeRef.current === "bypassPermissions") {
        return Promise.resolve({ allowed: true });
      }

      // dontAsk mode — deny everything not explicitly allowed.
      if (permModeRef.current === "dontAsk") {
        return Promise.resolve({ allowed: false });
      }

      // acceptEdits mode: auto-approve everything except bash.
      if (permModeRef.current === "acceptEdits" && ACCEPT_EDITS_TOOLS.has(toolName)) {
        return Promise.resolve({ allowed: true });
      }

      // Read-only tools never require permission.
      if (READ_TOOLS.has(toolName)) {
        return Promise.resolve({ allowed: true });
      }

      // Session-level allow for this tool.
      if (sessionAllowRef.current.has(toolName) || sessionAllowRef.current.has("*")) {
        return Promise.resolve({ allowed: true });
      }

      // plan mode — deny write tools (they shouldn't be in the schema, but safety net).
      if (permModeRef.current === "plan" && !READ_TOOLS.has(toolName)) {
        return Promise.resolve({ allowed: false });
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
    const allMcpTools = getMCPToolDefinitions();
    const allRawTools: Record<string, AnyToolDef> = { ...raw, ...allMcpTools };

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

    // Wrap tool execute functions with concurrency control —
    // concurrency-safe tools (read_file, glob, grep, etc.) can run in
    // parallel while non-safe tools (bash, write_file, etc.) serialize.
    for (const [name, td] of Object.entries(allRawTools)) {
      if (td && typeof td.execute === "function") {
        const original = td.execute;
        (td as any).execute = withConcurrencyControl(name, original as any);
      }
    }

    // Partition tools: core tools get full schemas, MCP tools are deferred
    // to save context window space. Promoted tools (via tool_search) are
    // treated as eager on subsequent calls.
    const { eager: eagerTools, deferred } = partitionTools(allRawTools);

    // Re-promote any tools the model previously loaded via tool_search
    for (const name of promotedToolsRef.current) {
      if (allRawTools[name] && !eagerTools[name]) {
        eagerTools[name] = allRawTools[name];
      }
    }

    // Store deferred list for tool_search and system prompt
    deferredToolsRef.current = deferred.filter(
      (t) => !promotedToolsRef.current.has(t.name),
    );

    // Add tool_search — lets the model load deferred tool schemas on demand
    eagerTools.tool_search = {
      description:
        "Search for and load additional tools by name or keyword. Returns full tool schemas so you can call them. Use this when you need a tool from the 'Additional Tools' list.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("Tool name or keyword to search for"),
      }),
      execute: async ({ query }: { query: string }) => {
        const q = query.toLowerCase();
        const currentDeferred = deferredToolsRef.current;
        const matches = currentDeferred.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q),
        );
        if (matches.length === 0) {
          return `No deferred tools found matching "${query}". Available deferred tools: ${currentDeferred.map((t) => t.name).join(", ") || "none"}`;
        }

        // Promote matched tools so they appear in the active tool set
        // on the next streamText step
        for (const m of matches) {
          promotedToolsRef.current.add(m.name);
        }

        const results = matches.map(
          (t) =>
            `- ${t.name}: ${t.description}`,
        );
        return `Loaded ${matches.length} tool(s):\n${results.join("\n")}\n\nThese tools are now available. Call them directly in your next step.`;
      },
    };

    const wrapped: Record<string, AnyToolDef> = {};
    for (const [name, toolDef] of Object.entries(eagerTools)) {
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

          // Handle "Trust all" — switch to bypassPermissions mode for this session.
          if (mode === "trust" && allowed) {
            permModeRef.current = "bypassPermissions";
            setPermMode("bypassPermissions");
            trustAllRef.current = true;
            setTrustAllState(true);
          }

          // Handle "Yes, don't ask again" — save permanent rule for bash, session-only for edits.
          if (mode === "always" && allowed) {
            if (name === "bash" && input.command) {
              // Save permanent rules for each subcommand
              const cmd = String(input.command);
              const subcommands = splitCompoundCommand(cmd);
              const rules = subcommands.map(commandToRule);
              // Persist to config
              try {
                const cfg = (await import("../config.js")).loadConfig();
                if (cfg) {
                  cfg.permissions = cfg.permissions || {};
                  cfg.permissions.allow = cfg.permissions.allow || [];
                  for (const rule of rules) {
                    if (!cfg.permissions.allow.includes(rule)) {
                      cfg.permissions.allow.push(rule);
                    }
                  }
                  (await import("../config.js")).saveConfig(cfg);
                  // Update the live rules ref
                  permissionRulesRef.current = cfg.permissions;
                }
              } catch {
                // If config save fails, fall back to session-only
                sessionAllowRef.current.add(name);
              }
            } else {
              // File edits: session-only (matches Claude Code behavior)
              sessionAllowRef.current.add(name);
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
            const hookResult = runPreHooksWithBlocking(name, hooksConfigRef.current, workingDirRef.current, { input: JSON.stringify(input).substring(0, 10000) });
            if (hookResult.blocked) {
              return `Tool blocked by pre-hook: ${hookResult.reason}`;
            }
            const result = await td.execute(input);
            runHooks("post", name, hooksConfigRef.current, workingDirRef.current, { output: (typeof result === "string" ? result : JSON.stringify(result)).substring(0, 10000), success: true });
            const resultStr =
              typeof result === "string" ? result : JSON.stringify(result);
            logger.debug("Tool result", { tool: name, result: resultStr.slice(0, 200) });

            // Track for loop detection
            const sig = `${name}:${JSON.stringify(input).substring(0, 200)}`;
            recentToolSignaturesRef.current.push(sig);
            if (recentToolSignaturesRef.current.length > LOOP_WINDOW) recentToolSignaturesRef.current.shift();
            if (recentToolSignaturesRef.current.length >= LOOP_THRESHOLD) {
              const counts: Record<string, number> = {};
              for (const s of recentToolSignaturesRef.current) counts[s] = (counts[s] || 0) + 1;
              const maxCount = Math.max(...Object.values(counts));
              if (maxCount >= LOOP_THRESHOLD) {
                logger.error("Tool call loop detected in single-agent", { tool: name, maxCount });
                setStreamingToolCalls((prev) =>
                  prev.map((tc) =>
                    tc.id === callId
                      ? { ...tc, status: "done" as const, result: "ABORTED: loop detected" }
                      : tc,
                  ),
                );
                setStatus("streaming");
                return "ABORTED: Tool call loop detected — the same tool call was repeated " + maxCount + " times. Stop and summarize what you've accomplished.";
              }
            }

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
      // tool_search is read-only — always available even in plan mode
      if (READ_TOOLS.has(name) || name === "tool_search") {
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
        recentToolSignaturesRef.current = [];

        const controller = new AbortController();
        abortRef.current = controller;

        // No artificial timeout — the user controls cancellation via ESC/Ctrl+C.

        let rateLimitRetries = 0;

        while (true) {
        try {
          const model = modelRef.current!;
          // Await tools first — triggers lazy MCP start so system prompt sees MCP tools
          const activeTools = (await getActiveTools()) as ToolSet;
          // Build system prompt with deferred tool listings appended
          const systemPrompt = buildSystemPrompt(workingDirRef.current)
            + formatDeferredToolsForPrompt(deferredToolsRef.current);
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
          // Use content-based estimation, not SDK's inputTokens which sums
          // across all multi-step tool calls and inflates the real context size.
          const estimatedContextTokens = estimateContextTokens(
            session.messages,
            systemPrompt.length,
          );
          // Show the grounded estimate in the status bar, not the inflated SDK sum
          setTokens(estimatedContextTokens);
          const compactionResult = shouldCompact(
            estimatedContextTokens,
            options.model,
            options.contextLength,
          );
          if (compactionResult.level === "micro") {
            // Free pre-pass: trim verbose tool output, no LLM call
            const plainMessages = session.messages.map((m) => ({
              role: m.role,
              content: m.content,
            }));
            const { messages: trimmed, charsSaved } = microCompact(plainMessages);
            if (charsSaved > 0) {
              session.messages = trimmed.map((m) => ({
                role: m.role,
                content: m.content,
                timestamp: new Date().toISOString(),
              }));
              saveSession(session);
            }
          } else if (compactionResult.level === "soft" || compactionResult.level === "hard") {
            setStatus("thinking");
        setStatusDetail("");
            const plainMessages = session.messages.map((m) => ({
              role: m.role,
              content: m.content,
            }));
            // Extract memories before they're compacted away
            const extractedMemories = extractMemoriesBeforeCompact(plainMessages);
            for (const mem of extractedMemories) {
              addMemory("learning", mem);
            }
            const compacted = await compactMessages(
              model,
              plainMessages,
              compactionResult.level,
            );
            session.messages = compacted.map((m) => ({
              role: m.role,
              content: m.content,
              timestamp: new Date().toISOString(),
            }));
            saveSession(session);
            notifyIfEnabled(bellEnabledRef.current, "WorkerMill", "Auto-compaction complete");
          }

          setStatus("idle");
          abortRef.current = null;
          break; // success — exit retry loop

        } catch (err) {
          // --- Rate limit retry ---
          const rateLimit = isRateLimitError(err);
          if (rateLimit && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
            rateLimitRetries++;
            const waitSec = Math.ceil(rateLimit.retryAfterMs / 1000);
            logger.info("Rate limited, retrying", { attempt: rateLimitRetries, waitSec });
            setStatusDetail(`Rate limited — retrying in ${waitSec}s (${rateLimitRetries}/${MAX_RATE_LIMIT_RETRIES})`);
            setStreamingText("");
            setStreamingToolCalls([]);
            await new Promise(resolve => setTimeout(resolve, rateLimit.retryAfterMs));
            continue; // retry the streamText call
          }

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
          break; // error handled — exit retry loop
        }
        } // end while
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
    // Sync permission mode display
    if (v) {
      permModeRef.current = "bypassPermissions";
      setPermMode("bypassPermissions");
    } else if (permModeRef.current === "bypassPermissions") {
      permModeRef.current = "default";
      setPermMode("default");
    }
  }, []);

  const setPlanMode = useCallback((v: boolean) => {
    setPlanModeState(v);
    planModeRef.current = v;
  }, []);

  const isBypassMode = useCallback(() => permModeRef.current === "bypassPermissions", []);

  const cyclePermissionMode = useCallback(() => {
    // dontAsk is not in the cycle — skip it
    const cycleModes = PERMISSION_MODES;
    const idx = cycleModes.indexOf(permModeRef.current as typeof cycleModes[number]);
    const next = cycleModes[(idx + 1) % cycleModes.length];
    setPermMode(next);
    permModeRef.current = next;
    // Sync trustAll state
    const isTrust = next === "bypassPermissions";
    setTrustAllState(isTrust);
    trustAllRef.current = isTrust;
    // Sync planMode state
    const isPlan = next === "plan";
    setPlanModeState(isPlan);
    planModeRef.current = isPlan;
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
    isBypassMode,
    cyclePermissionMode,
    toolCounts,
    sessionStart: sessionStartRef.current,
    incrementToolCount,
    tokPerSec,
    switchModel,
    forceCompact,
  };
}

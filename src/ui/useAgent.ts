import { useState, useCallback, useRef, useEffect } from "react";
import { streamText, stepCountIs, type ToolSet } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import crypto from "crypto";
import {
  createModel,
  buildOllamaOptions,
  ensureOllamaContext,
  ensureLmStudioContext,
} from "../engine/model-factory.js";
import { createToolDefinitions } from "../engine/tools/index.js";
import type { AIProvider } from "../engine/types.js";
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
import { killActiveProcess } from "../engine/tools/bash.js";
import { cleanupAllBackgroundProcesses } from "../engine/tools/bash-background.js";
import { extractMemoryMarkers, addMemory } from "../memory.js";
import { parseImageReferences, toMessageContent, resolveFileReferences, resolveFolderReferences, resolveUrlReferences } from "../image-support.js";
import * as logger from "../logger.js";
import { getMCPToolDefinitions, stopAllMCPServers, autoDetectMCPServers, registerMCPServers, hasMCPRegistered } from "../mcp-client.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { partitionTools, formatDeferredToolsForPrompt, type DeferredToolEntry } from "../deferred-tools.js";
import { resolveConfig, type HooksConfig, type PermissionRuleConfig } from "../config.js";
import { normalizeToolName, toolStatusLabel } from "./tool-status.js";
import { runHooks, runPreHooksWithBlocking } from "../hooks.js";
import { browserOpen, browserNavigate, browserScreenshot, browserClick, browserFill, browserEvaluate, browserConsole, browserClose } from "../browser.js";
import path from "path";
import { isDangerous, isDangerousFile, READ_TOOLS, ACCEPT_EDITS_TOOLS, checkPermissionRules, splitCompoundCommand, commandToRule } from "../safety.js";
import { notifyIfEnabled } from "../notify.js";
import { checkpoint } from "../checkpoints.js";
import { withConcurrencyControl } from "../tool-concurrency.js";
import { createLiveViewServer, type LiveViewServer } from "../live-view-server.js";
import { formatLiveViewUrlMessage, getLiveViewUrls } from "../live-view-url.js";
import type {
  Message,
  ToolCallInfo,
  PermissionRequest,
  AgentStatus,
  RollbackResult,
} from "./types.js";

const TRACE_DISPATCH = process.env.WM_TRACE_DISPATCH === "1";
const ENABLE_STEP_STREAMING_TEXT = process.env.WM_ENABLE_STEP_STREAMING_TEXT === "1";

function traceDispatch(message: string, data?: Record<string, unknown>): void {
  if (!TRACE_DISPATCH) return;
  logger.info(`[dispatch] ${message}`, data);
}

// Tool call loop detection — matches orchestrator pattern
const LOOP_WINDOW = 6;
const LOOP_THRESHOLD = 4;

// Rate limit retry config
const MAX_RATE_LIMIT_RETRIES = 3;
const LONG_RESPONSE_RECEIPT_MIN_CHARS = 600;
const TOOL_COUNT_FLUSH_MS = 750;

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

type ParsedPseudoToolCall = {
  name: string;
  input: Record<string, unknown>;
};

function parsePseudoToolCalls(text: string): ParsedPseudoToolCall[] {
  if (!text.includes("<function=")) return [];

  const calls: ParsedPseudoToolCall[] = [];
  const fnRe = /<function=([a-zA-Z0-9_:-]+)>\s*([\s\S]*?)\s*<\/function>/g;
  let fnMatch: RegExpExecArray | null;
  while ((fnMatch = fnRe.exec(text)) !== null) {
    const name = fnMatch[1]?.trim();
    const body = fnMatch[2] || "";
    if (!name) continue;

    const input: Record<string, unknown> = {};
    const paramRe = /<parameter=([a-zA-Z0-9_:-]+)>\s*([\s\S]*?)\s*<\/parameter>/g;
    let paramMatch: RegExpExecArray | null;
    while ((paramMatch = paramRe.exec(body)) !== null) {
      const key = paramMatch[1]?.trim();
      const rawValue = (paramMatch[2] || "").trim();
      if (!key) continue;
      if (!rawValue) {
        input[key] = "";
        continue;
      }
      if ((rawValue.startsWith("{") && rawValue.endsWith("}")) || (rawValue.startsWith("[") && rawValue.endsWith("]"))) {
        try {
          input[key] = JSON.parse(rawValue);
          continue;
        } catch {
          // fall through to string
        }
      }
      input[key] = rawValue;
    }

    if (Object.keys(input).length > 0) calls.push({ name, input });
  }

  return calls;
}

function stripPseudoToolCallMarkup(text: string): string {
  return text
    .replace(/<function=[a-zA-Z0-9_:-]+>[\s\S]*?<\/function>\s*(?:<\/tool_call>)?/g, "")
    .replace(/<\/tool_call>/g, "")
    .trim();
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
  sandboxed: boolean | "os";
  resume: boolean;
  fork: boolean;
  maxTokens?: number;
  /** Called after every bash tool execution (e.g. to refresh git branch). */
  onBashComplete?: () => void;
  /** Startup live view override from CLI flags/settings merge. */
  liveView?: boolean | "auto";
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
  /** Roll back the last user+assistant exchange and restore prior user input. */
  rollback: () => RollbackResult;
  /** Toggle trust-all mode at runtime. */
  setTrustAll: (v: boolean) => void;
  /** Toggle plan (read-only) mode at runtime. */
  setPlanMode: (v: boolean) => void;
  /** Push a local-only assistant message into the conversation (no LLM call). */
  addSystemMessage: (content: string, toolCalls?: ToolCallInfo[]) => void;
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
  /** Enable or disable interactive live view for this session. Returns active URL when enabled. */
  setLiveViewEnabled: (enabled: boolean) => string | null;
  /** Current live view URL (if running). */
  getLiveViewUrl: () => string | null;
}

// ---------------------------------------------------------------------------
// Cost helpers
// ---------------------------------------------------------------------------

/**
 * Records partial token usage to the cost tracker when a run is aborted mid-stream.
 * Called in the AbortError catch path so tokens consumed before ESC are not lost.
 * No-op when both counts are zero (i.e. abort happened before any tokens were billed).
 */
export function trackAbortCost(
  partialInputTokens: number,
  partialOutputTokens: number,
  persona: string,
  provider: string,
  model: string,
  costTracker: { addUsage: (p: string, pr: string, m: string, i: number, o: number) => void; getTotalCost: () => number },
  setCost: (cost: number) => void,
): void {
  if (partialInputTokens > 0 || partialOutputTokens > 0) {
    costTracker.addUsage(persona, provider, model, partialInputTokens, partialOutputTokens);
    setCost(costTracker.getTotalCost());
  }
}

function normalizeLiveViewPath(filePath: string, workingDir: string): string | null {
  const trimmed = filePath.trim();
  if (!trimmed || trimmed === "/dev/null") return null;
  const withoutPrefix = trimmed.replace(/^[ab]\//, "");
  if (!withoutPrefix) return null;
  const unixPath = withoutPrefix.replaceAll("\\", "/");
  if (!path.isAbsolute(unixPath)) return unixPath;
  const rel = path.relative(workingDir, unixPath).replaceAll("\\", "/");
  if (!rel || rel.startsWith("../") || rel === "..") return null;
  return rel;
}

function parsePatchTargets(patchText: string, workingDir: string): Array<{ filePath: string; tool: "created" | "edited" }> {
  const rows = patchText.replace(/\r\n/g, "\n").split("\n");
  const targets: Array<{ filePath: string; tool: "created" | "edited" }> = [];
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].startsWith("--- ")) continue;
    const oldRaw = rows[i].replace(/^---\s+/, "").trim().replace(/^[ab]\//, "");
    const plus = rows[i + 1];
    if (!plus || !plus.startsWith("+++ ")) continue;
    const newRaw = plus.replace(/^\+\+\+\s+/, "").trim().replace(/^[ab]\//, "");

    const isCreated = oldRaw === "/dev/null" && newRaw !== "/dev/null";
    const candidate = isCreated ? newRaw : (newRaw === "/dev/null" ? oldRaw : newRaw);
    const normalized = normalizeLiveViewPath(candidate, workingDir);
    if (!normalized) continue;
    targets.push({ filePath: normalized, tool: isCreated ? "created" : "edited" });
  }
  return targets;
}

/**
 * Derive per-file live-view events from a tool call payload.
 * This is especially important for `patch`, which often edits multiple files
 * while not providing `path` in the tool input.
 */
export function getLiveViewChangeTargets(
  toolName: string,
  input: Record<string, unknown>,
  result: unknown,
  workingDir: string,
): Array<{ filePath: string; tool: "created" | "edited" }> {
  const byPath = new Map<string, "created" | "edited">();
  const add = (rawPath: unknown, tool: "created" | "edited") => {
    if (typeof rawPath !== "string") return;
    const normalized = normalizeLiveViewPath(rawPath, workingDir);
    if (!normalized) return;
    const existing = byPath.get(normalized);
    byPath.set(normalized, existing === "created" ? "created" : tool);
  };

  if (toolName === "write_file") {
    add(input.path ?? input.file_path, "created");
  } else if (toolName === "edit_file") {
    add(input.path ?? input.file_path, "edited");
  } else if (toolName === "multi_edit_file") {
    add(input.file_path, "edited");
  } else if (toolName === "patch") {
    const obj = result && typeof result === "object" ? (result as Record<string, unknown>) : null;
    const addArray = (arr: unknown, tool: "created" | "edited") => {
      if (!Array.isArray(arr)) return;
      for (const p of arr) add(p, tool);
    };
    addArray(obj?.filesCreated, "created");
    addArray(obj?.filesModified, "edited");
    addArray(obj?.filesDeleted, "edited");

    const patchText = typeof input.patch_text === "string" ? input.patch_text : "";
    for (const target of parsePatchTargets(patchText, workingDir)) {
      add(target.filePath, target.tool);
    }

    // Safety fallback for atypical patch wrappers.
    add(input.path ?? input.file_path, "edited");
  }

  return [...byPath.entries()].map(([filePath, tool]) => ({ filePath, tool }));
}

/**
 * Safety guard against image hallucinations:
 * block visual claims when no image input/tool evidence exists for the turn.
 */
export function shouldBlockUnverifiedImageAnswer(
  userInput: string,
  assistantOutput: string,
  opts: { turnHadInlineImages: boolean; toolCalls: ToolCallInfo[] },
): boolean {
  if (!assistantOutput.trim()) return false;

  const userLooksImageRelated =
    /\b(image|screenshot|picture|photo|png|jpe?g|gif|webp|bmp)\b/i.test(userInput) ||
    /\/mnt\/[^\s]+\.(png|jpe?g|gif|webp|bmp)\b/i.test(userInput) ||
    /[A-Za-z]:\\[^\n]+\.(png|jpe?g|gif|webp|bmp)\b/i.test(userInput);

  if (!userLooksImageRelated) return false;

  const hasImageEvidence =
    opts.turnHadInlineImages ||
    opts.toolCalls.some((c) => c.name === "view_image" || c.name === "browser_screenshot");

  if (hasImageEvidence) return false;

  const explicitlyCannotSee =
    /\b(i can(?:not|'t)\s+(?:see|view|inspect)|no vision|without vision|text[- ]based|can't access image)\b/i.test(
      assistantOutput,
    );
  if (explicitlyCannotSee) return false;

  const makesVisualClaims =
    /\b(i can see|the image|the screenshot|looks like|appears to|visible|shown in|depicts)\b/i.test(
      assistantOutput,
    );

  return makesVisualClaims;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAgent(options: UseAgentOptions): UseAgentReturn {
  // ------- Callbacks -------- //
  const onBashCompleteRef = useRef(options.onBashComplete);
  onBashCompleteRef.current = options.onBashComplete;

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
  const pendingToolCountsRef = useRef<Record<string, number>>({});
  const toolCountFlushTimerRef = useRef<NodeJS.Timeout | null>(null);
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
  const systemPromptRef = useRef<string | null>(null);
  const hooksConfigRef = useRef<HooksConfig | undefined>(undefined);
  const bellEnabledRef = useRef<boolean | undefined>(undefined);
  const permissionRulesRef = useRef<PermissionRuleConfig | undefined>(undefined);
  const recentToolSignaturesRef = useRef<string[]>([]);
  const initDoneRef = useRef(false);
  const liveViewEnabledRef = useRef(false);
  const liveViewServerRef = useRef<LiveViewServer | null>(null);
  const liveViewUrlRef = useRef<string | null>(null);
  const pendingSystemMessagesRef = useRef<string[]>([]);

  // Deferred tool loading — MCP tools start deferred, promoted on tool_search
  const deferredToolsRef = useRef<DeferredToolEntry[]>([]);
  const promotedToolsRef = useRef<Set<string>>(new Set());

  // Keep refs in sync with state so callbacks see fresh values.
  trustAllRef.current = trustAll;
  planModeRef.current = planMode;

  const startLiveView = useCallback((): string => {
    if (liveViewServerRef.current && liveViewUrlRef.current) {
      return liveViewUrlRef.current;
    }
    const server = createLiveViewServer(workingDirRef.current, "main");
    liveViewServerRef.current = server;
    const urls = getLiveViewUrls(server.port);
    liveViewUrlRef.current = urls.preferredUrl;
    return urls.preferredUrl;
  }, []);

  const stopLiveView = useCallback((): void => {
    const server = liveViewServerRef.current;
    if (!server) return;
    server.stop();
    liveViewServerRef.current = null;
    liveViewUrlRef.current = null;
  }, []);

  const flushToolCounts = useCallback(() => {
    if (toolCountFlushTimerRef.current) {
      clearTimeout(toolCountFlushTimerRef.current);
      toolCountFlushTimerRef.current = null;
    }
    const pending = pendingToolCountsRef.current;
    const names = Object.keys(pending);
    if (names.length === 0) return;
    pendingToolCountsRef.current = {};

    setToolCounts((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const name of names) {
        const inc = pending[name] || 0;
        if (inc <= 0) continue;
        const updated = (next[name] || 0) + inc;
        if (updated !== next[name]) {
          next[name] = updated;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const queueToolCountIncrement = useCallback((toolName: string) => {
    const canonicalName = normalizeToolName(toolName);
    pendingToolCountsRef.current[canonicalName] = (pendingToolCountsRef.current[canonicalName] || 0) + 1;
    if (toolCountFlushTimerRef.current) return;
    toolCountFlushTimerRef.current = setTimeout(() => {
      flushToolCounts();
    }, TOOL_COUNT_FLUSH_MS);
  }, [flushToolCounts]);

  useEffect(() => () => {
    if (toolCountFlushTimerRef.current) {
      clearTimeout(toolCountFlushTimerRef.current);
      toolCountFlushTimerRef.current = null;
    }
  }, []);

  // Ensure queued counts are committed when activity stops.
  useEffect(() => {
    if (status === "idle") flushToolCounts();
  }, [status, flushToolCounts]);

  // ------- One-time initialisation -------- //
  if (!initDoneRef.current) {
    initDoneRef.current = true;

    // Set API keys in process.env when provided via options.
    if (options.apiKey) {
      const envMap: Record<string, string> = {
        anthropic: "ANTHROPIC_API_KEY",
        openai: "OPENAI_API_KEY",
        google: "GOOGLE_GENERATIVE_AI_API_KEY",
        xai: "XAI_API_KEY",
        groq: "GROQ_API_KEY",
        deepseek: "DEEPSEEK_API_KEY",
        mistral: "MISTRAL_API_KEY",
      };
      const envVar = envMap[options.provider];
      if (envVar && !process.env[envVar]) {
        process.env[envVar] = options.apiKey;
      }
    }

    aiProviderRef.current = options.provider as AIProvider;

    // Ensure local model context length matches config (fire-and-forget —
    // unload completes before the first user prompt in practice)
    if (aiProviderRef.current === "ollama" && options.host && options.contextLength) {
      void ensureOllamaContext(options.host, options.model, options.contextLength);
    } else if (aiProviderRef.current === "lmstudio" && options.host && options.contextLength) {
      void ensureLmStudioContext(options.host, options.model, options.contextLength);
    }

    modelRef.current = createModel(
      aiProviderRef.current,
      options.model,
      options.host,
      options.contextLength,
      options.apiKey,
    );
    toolsRef.current = createToolDefinitions(
      workingDirRef.current,
      modelRef.current,
      options.sandboxed,
    );

    // Register MCP servers for lazy start — they won't spawn until first tool use
    try {
      const cliConfig = resolveConfig();
      // Skip Docker MCP auto-detection for local models (Ollama/LM Studio) —
      // 50+ MCP tools overwhelm small models, causing XML text fallback instead
      // of structured tool calls. Users can still configure MCP explicitly.
      const skipAutoDetect = aiProviderRef.current === "ollama" || aiProviderRef.current === "lmstudio";
      const mcpConfig = skipAutoDetect
        ? (cliConfig?.mcp || {})
        : autoDetectMCPServers(cliConfig?.mcp || {});
      registerMCPServers(mcpConfig);
      hooksConfigRef.current = cliConfig?.hooks;
      bellEnabledRef.current = cliConfig?.bell;
      permissionRulesRef.current = cliConfig?.permissions;
      const effectiveLiveView = options.liveView ?? cliConfig?.liveView;
      liveViewEnabledRef.current = effectiveLiveView === true || effectiveLiveView === "auto";
      if (liveViewEnabledRef.current) {
        startLiveView();
      }
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
        // Run micro-compaction on resumed sessions to trim stale tool output
        // before it hits the model on the first prompt.
        const plainMessages = session.messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));
        const { messages: trimmed, charsSaved } = microCompact(plainMessages);
        if (charsSaved > 0) {
          session.messages = trimmed.map((m, i) => ({
            role: m.role,
            content: m.content,
            timestamp: session.messages[i]?.timestamp ?? new Date().toISOString(),
          }));
          saveSession(session);
          logger.info("Micro-compacted resumed session", { charsSaved });
        }

        sessionRef.current = session;
        // Hydrate committed messages from the restored session.
        const restored: Message[] = session.messages.map((m) => ({
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
    const pending = pendingSystemMessagesRef.current.splice(0);
    if (s._restored) {
      const restored = s._restored;
      delete s._restored;
      if (pending.length > 0) {
        const pendingMessages: Message[] = pending.map((content) => ({
          id: crypto.randomUUID(),
          role: "assistant",
          content,
          compact: true,
          timestamp: new Date().toISOString(),
        }));
        setMessages([...restored, ...pendingMessages]);
      } else {
        setMessages(restored);
      }
    } else if (pending.length > 0) {
      const pendingMessages: Message[] = pending.map((content) => ({
        id: crypto.randomUUID(),
        role: "assistant",
        content,
        compact: true,
        timestamp: new Date().toISOString(),
      }));
      setMessages((prev) => [...prev, ...pendingMessages]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      stopLiveView();
    };
  }, [stopLiveView]);

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
    if (toolName === "write_file" || toolName === "edit_file" || toolName === "patch" || toolName === "multi_edit_file") {
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
        logger.info("Dangerous prompt shown", { tool: toolName, danger: dangerLabel });
        return new Promise((resolve) => {
          setPermissionRequest({
            toolName,
            toolInput,
            isDangerous: true,
            dangerLabel,
            resolve: (allowed: boolean, mode?: "always" | "trust") => {
              logger.info("Dangerous prompt resolved", { tool: toolName, allowed, mode });
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
          return {
            content: [
              { type: "text", text: description },
              { type: "image", image: base64, mimeType: "image/png" },
            ],
          };
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

    // Wrap tool execute functions with concurrency control without mutating
    // shared tool definitions (toolsRef/current MCP objects). Mutating in place
    // re-wraps every turn and can self-deadlock on the non-reentrant mutex.
    const concurrencyWrappedTools: Record<string, AnyToolDef> = {};
    for (const [name, td] of Object.entries(allRawTools)) {
      if (td && typeof td.execute === "function") {
        const original = td.execute;
        concurrencyWrappedTools[name] = {
          ...td,
          execute: withConcurrencyControl(name, original as any),
        };
      } else {
        concurrencyWrappedTools[name] = td;
      }
    }

    // Partition tools: core tools get full schemas, MCP tools are deferred
    // to save context window space. Promoted tools (via tool_search) are
    // treated as eager on subsequent calls.
    const { eager: eagerTools, deferred } = partitionTools(concurrencyWrappedTools, workingDirRef.current);

    // Re-promote any tools the model previously loaded via tool_search
    for (const name of promotedToolsRef.current) {
      if (concurrencyWrappedTools[name] && !eagerTools[name]) {
        eagerTools[name] = concurrencyWrappedTools[name];
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

          const info: ToolCallInfo = {
            id: callId,
            name,
            input,
            status: "pending",
          };

          // ── ZERO setState before execute ──
          // Ink Legacy mode calls flushSyncWork() on every setState, which
          // blocks the entire Node.js event loop synchronously.  This
          // prevents worker thread message callbacks from firing.
          // ALL visual updates are batched AFTER the tool completes.

          const wrapperEnterMs = Date.now();
          traceDispatch("wrapper:enter", { tool: name });

          const permissionStartMs = Date.now();
          const { allowed, mode } = await checkPermission(name, input);
          traceDispatch("wrapper:permission_done", {
            tool: name,
            allowed,
            mode,
            durationMs: Date.now() - permissionStartMs,
          });

          if (mode === "trust" && allowed) {
            permModeRef.current = "bypassPermissions";
            // Defer UI update
            setTimeout(() => { setPermMode("bypassPermissions"); setTrustAllState(true); }, 0);
            trustAllRef.current = true;
          }

          if (mode === "always" && allowed) {
            try {
              const { loadLocalSettings, saveLocalSettings } = await import("../config.js");
              const { toolInputToRule, splitCompoundCommand } = await import("../safety.js");
              const lSettings = loadLocalSettings() || {};
              lSettings.allow = lSettings.allow || [];
              const rules = name === "bash" && input.command
                ? splitCompoundCommand(String(input.command)).map((cmd) => toolInputToRule(name, { command: cmd }))
                : [toolInputToRule(name, input)];
              for (const rule of rules) {
                if (rule && !lSettings.allow.includes(rule)) {
                  lSettings.allow.push(rule);
                }
              }
              saveLocalSettings(lSettings);
              // Update the merged permissions
              const config = resolveConfig();
              permissionRulesRef.current = config.permissions;
            } catch {
              sessionAllowRef.current.add(name);
            }
            sessionAllowRef.current.add(name);
          }

          if (!allowed) {
            traceDispatch("wrapper:denied", {
              tool: name,
              sinceWrapperEnterMs: Date.now() - wrapperEnterMs,
            });
            setStreamingToolCalls((prev) => [...prev, { ...info, status: "denied" as const }]);
            setStatus("streaming");
            return "Tool execution denied by user.";
          }

          try {
            traceDispatch("wrapper:before_tool_call_log", {
              tool: name,
              sinceWrapperEnterMs: Date.now() - wrapperEnterMs,
            });
            logger.info("Tool call", { tool: name, input: JSON.stringify(input).slice(0, 200) });
            if ((name === "write_file" || name === "edit_file" || name === "multi_edit_file") && (input.path || input.file_path)) {
              const filePath = String(input.path || input.file_path);
              const resolved = filePath.startsWith("/") ? filePath : path.resolve(workingDirRef.current, filePath);
              checkpoint(resolved);
            }
            const preHookStartMs = Date.now();
            const hookResult = runPreHooksWithBlocking(name, hooksConfigRef.current, workingDirRef.current, { input: JSON.stringify(input).substring(0, 10000) });
            traceDispatch("wrapper:prehook_done", {
              tool: name,
              blocked: hookResult.blocked,
              durationMs: Date.now() - preHookStartMs,
              sinceWrapperEnterMs: Date.now() - wrapperEnterMs,
            });
            if (hookResult.blocked) {
              return `Tool blocked by pre-hook: ${hookResult.reason}`;
            }

            // ── Execute with ZERO renders blocking the event loop ──
            const executeStartMs = Date.now();
            traceDispatch("wrapper:before_execute", {
              tool: name,
              sinceWrapperEnterMs: executeStartMs - wrapperEnterMs,
            });
            const result = await td.execute(input);
            traceDispatch("wrapper:after_execute", {
              tool: name,
              executeDurationMs: Date.now() - executeStartMs,
              sinceWrapperEnterMs: Date.now() - wrapperEnterMs,
            });

            if (name === "bash" && onBashCompleteRef.current) {
              onBashCompleteRef.current();
            }
            runHooks("post", name, hooksConfigRef.current, workingDirRef.current, { output: (typeof result === "string" ? result : JSON.stringify(result)).substring(0, 10000), success: true });
            const resultStr =
              typeof result === "string" ? result : JSON.stringify(result);
            logger.info("Tool result", { tool: name, result: resultStr.slice(0, 200) });

            const liveViewServer = liveViewServerRef.current;
            if (liveViewServer && (name === "write_file" || name === "edit_file" || name === "patch" || name === "multi_edit_file")) {
              const targets = getLiveViewChangeTargets(name, input, result, workingDirRef.current);
              for (const target of targets) {
                liveViewServer.emitFileChange("worker", 1, "Interactive chat", target.filePath, target.tool);
              }
            }

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
                setStreamingToolCalls((prev) => [
                  ...prev,
                  { ...info, status: "done" as const, result: "ABORTED: loop detected" },
                ]);
                setStatus("streaming");
                return "ABORTED: Tool call loop detected — the same tool call was repeated " + maxCount + " times. Stop and summarize what you've accomplished.";
              }
            }

            // ── NOW batch all visual updates after tool is done ──
            setStreamingToolCalls((prev) => [
              ...prev,
              { ...info, status: "done" as const, result: resultStr },
            ]);
            queueToolCountIncrement(name);
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
        const inlineImageParse = parseImageReferences(resolvedInput, workingDirRef.current);
        const turnHadInlineImages = inlineImageParse.hasImages;

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
        if (liveViewServerRef.current) {
          liveViewServerRef.current.setAbortController(controller);
        }
        if (liveViewServerRef.current) {
          const storyTitle = (displayText ?? input).split("\n")[0]?.slice(0, 120) || "Interactive chat";
          liveViewServerRef.current.emitStoryStart(1, storyTitle, "worker", 1);
        }

        // No artificial timeout — the user controls cancellation via ESC/Ctrl+C.

        let rateLimitRetries = 0;
        while (true) {
        let partialInputTokens = 0;
        let partialOutputTokens = 0;
        try {
          const model = modelRef.current!;
          // Await tools first — triggers lazy MCP start so system prompt sees MCP tools
          const activeTools = (await getActiveTools()) as ToolSet;
          // Cache the system prompt — rebuilding it every turn changes the
          // text (memories, disk files), which invalidates Ollama's KV cache
          // and forces a full prompt reprocessing (~30s for 30B models).
          // Build once on first submit; only rebuild on explicit request.
          if (!systemPromptRef.current) {
            systemPromptRef.current = buildSystemPrompt(workingDirRef.current)
              + formatDeferredToolsForPrompt(deferredToolsRef.current);
          }
          const systemPrompt = systemPromptRef.current;
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
            ...(["openai"].includes(aiProviderRef.current)
              ? { providerOptions: { openai: { reasoningSummary: "detailed" } } }
              : {}),
            onStepFinish({ text, toolCalls: calls, usage: stepUsage, reasoningText }) {
              partialInputTokens += stepUsage?.inputTokens ?? 0;
              partialOutputTokens += stepUsage?.outputTokens ?? 0;
              const stepStartMs = Date.now();
              const callCount = calls?.length ?? 0;
              traceDispatch("onStepFinish:enter", {
                textLength: text?.length ?? 0,
                callCount,
              });

              // Skip render when step has tool calls — the setStreamingText
              // triggers Ink's synchronous flushSyncWork() which blocks the
              // event loop for the full render duration (~30s with message
              // history), preventing the SDK from dispatching the tool execute.
              if (ENABLE_STEP_STREAMING_TEXT && text && callCount === 0) {
                const setStreamingStartMs = Date.now();
                setStreamingText(text);
                const setStreamingDurationMs = Date.now() - setStreamingStartMs;
                setStatus("streaming");
                traceDispatch("onStepFinish:text_rendered", {
                  textLength: text.length,
                  setStreamingDurationMs,
                  totalDurationMs: Date.now() - stepStartMs,
                });
              } else if (ENABLE_STEP_STREAMING_TEXT && reasoningText && callCount === 0 && !text) {
                const setStreamingStartMs = Date.now();
                setStreamingText(`(thinking)\n${reasoningText}`);
                const setStreamingDurationMs = Date.now() - setStreamingStartMs;
                setStatus("thinking");
                traceDispatch("onStepFinish:reasoning_rendered", {
                  reasoningLength: reasoningText.length,
                  setStreamingDurationMs,
                  totalDurationMs: Date.now() - stepStartMs,
                });
              } else {
                traceDispatch("onStepFinish:skip_text_render", {
                  hasText: Boolean(text),
                  hasReasoning: Boolean(reasoningText),
                  callCount,
                  streamingEnabled: ENABLE_STEP_STREAMING_TEXT,
                  totalDurationMs: Date.now() - stepStartMs,
                });
              }
            },
          });

          // Drive the stream to completion.
          for await (const _chunk of stream.textStream) {
            // Each chunk is handled by onStepFinish for text. We consume
            // the async iterator so the SDK processes all steps.
          }


          // ---- Finalise ---- //
          let finalText = await stream.text;
          const usage = await stream.totalUsage;
          const inputTokens = usage?.inputTokens ?? 0;
          const outputTokens = usage?.outputTokens ?? 0;
          const turnElapsedMs = Date.now() - turnStartTime;
          const currentToolCalls = streamingToolCallsRef.current;
          let toolCallCount = currentToolCalls.length;

          // Some local models emit XML-like pseudo tool calls instead of native
          // structured calls. When that happens, parse and execute them through
          // the same wrapped tool definitions so permission checks still apply.
          if (toolCallCount === 0 && finalText.includes("<function=")) {
            const pseudoCalls = parsePseudoToolCalls(finalText);
            if (pseudoCalls.length > 0) {
              logger.info("Pseudo tool call fallback triggered", {
                callCount: pseudoCalls.length,
                names: pseudoCalls.map((c) => c.name).join(","),
              });
              const toolsByName = activeTools as Record<string, AnyToolDef>;
              const fallbackLines: string[] = [];
              for (const call of pseudoCalls) {
                const toolDef = toolsByName[call.name];
                if (!toolDef || typeof toolDef.execute !== "function") {
                  fallbackLines.push(`- ${call.name}: unavailable`);
                  continue;
                }
                try {
                  const result = await toolDef.execute(call.input);
                  const resultText = typeof result === "string" ? result : JSON.stringify(result);
                  fallbackLines.push(`- ${call.name}: ${resultText}`);
                } catch (err) {
                  const errMsg = err instanceof Error ? err.message : String(err);
                  fallbackLines.push(`- ${call.name}: Error: ${errMsg}`);
                }
              }

              const cleaned = stripPseudoToolCallMarkup(finalText);
              finalText =
                `${cleaned ? `${cleaned}\n\n` : ""}` +
                `Executed tool calls parsed from model output:\n` +
                `${fallbackLines.join("\n")}`;
              toolCallCount = streamingToolCallsRef.current.length;
            }
          }

          if (
            shouldBlockUnverifiedImageAnswer(resolvedInput, finalText, {
              turnHadInlineImages,
              toolCalls: currentToolCalls,
            })
          ) {
            finalText =
              "I can’t verify image contents in this turn because no image was actually provided to a vision input/tool. " +
              "Attach it with `@/path/to/file.png` or ask me to run `view_image` on the file path.";
          }

          // Extract and save memories from model output
          const newMemories = extractMemoryMarkers(finalText);
          for (const m of newMemories) {
            addMemory(m.type, m.content);
          }

          // Cost tracking — use active refs, not startup options (user may have switched via /model).
          const totalCostBefore = costTrackerRef.current.getTotalCost();
          costTrackerRef.current.addUsage(
            "agent",
            aiProviderRef.current,
            activeModelNameRef.current,
            inputTokens,
            outputTokens,
          );
          const totalCostAfter = costTrackerRef.current.getTotalCost();
          const turnCost = Math.max(0, totalCostAfter - totalCostBefore);
          setCost(totalCostAfter);

          // Commit the full response to Static as one message.
          // Tool calls and text were kept in the dynamic area until now.
          setMessages((prev) => {
            const newMessages: Message[] = [];

            // Commit accumulated tool calls
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
                turnReceipt:
                  finalText.length >= LONG_RESPONSE_RECEIPT_MIN_CHARS
                    ? {
                        inputTokens,
                        outputTokens,
                        elapsedMs: turnElapsedMs,
                        toolCalls: toolCallCount,
                        turnCost,
                      }
                    : undefined,
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

          if (liveViewServerRef.current) {
            liveViewServerRef.current.emitStoryComplete(1, Date.now() - turnStartTime);
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
            // Preserve any tokens consumed in completed steps before the abort.
            trackAbortCost(
              partialInputTokens,
              partialOutputTokens,
              "agent",
              aiProviderRef.current,
              activeModelNameRef.current,
              costTrackerRef.current,
              setCost,
            );
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
          if (liveViewServerRef.current) {
            liveViewServerRef.current.emitStoryComplete(1, Date.now() - turnStartTime);
          }
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
      cleanupAllBackgroundProcesses();
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

  /** Remove the last user+assistant exchange from the session and return restored user input. */
  const rollback = useCallback((): RollbackResult => {
    const session = sessionRef.current;
    if (session.messages.length < 2) return { rolledBack: false };

    // Remove trailing assistant message(s) and the last user message
    while (session.messages.length > 0 && session.messages[session.messages.length - 1].role === "assistant") {
      session.messages.pop();
    }
    let restoredInput: string | undefined;
    if (session.messages.length > 0 && session.messages[session.messages.length - 1].role === "user") {
      const popped = session.messages.pop();
      restoredInput = popped?.content ?? undefined;
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

    return { rolledBack: true, restoredInput };
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

  const addSystemMessage = useCallback((content: string, toolCalls?: ToolCallInfo[]) => {
    const msg: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content,
      compact: content.trim().length > 0,
      ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
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

  const setLiveViewEnabled = useCallback((enabled: boolean): string | null => {
    liveViewEnabledRef.current = enabled;
    if (enabled) {
      const url = startLiveView();
      return url;
    }
    stopLiveView();
    return null;
  }, [startLiveView, stopLiveView]);

  const getLiveViewUrl = useCallback((): string | null => {
    return liveViewUrlRef.current;
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
    const resolvedApiKey = apiKey?.startsWith("{env:")
      ? process.env[apiKey.slice(5, -1)] || undefined
      : apiKey;
    modelRef.current = createModel(newProvider as AIProvider, newModel, host, contextLength, resolvedApiKey);

    // Local providers need context length ensured before first use
    if (newProvider === "ollama" && host && contextLength) {
      void ensureOllamaContext(host, newModel, contextLength);
    } else if (newProvider === "lmstudio" && host && contextLength) {
      void ensureLmStudioContext(host, newModel, contextLength);
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
    queueToolCountIncrement(toolName);
  }, [queueToolCountIncrement]);

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
    setLiveViewEnabled,
    getLiveViewUrl,
  };
}

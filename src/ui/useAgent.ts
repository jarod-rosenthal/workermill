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
import { canonicalizePath, createPathScope, resolvePath } from "../engine/path-policy.js";
import { executeToolCall, ToolExecutionError, type ToolExecutionContext } from "../engine/tool-executor.js";
import type { PermissionState } from "../engine/tool-policy.js";
import { getToolMeta } from "../engine/tools/tool-metadata.js";
import type { AIProvider } from "../engine/types.js";
import {
  createSession,
  saveSession,
  addMessage,
  loadLatestSession,
  forkSession,
  type Session,
} from "../session.js";
import { loadProjectMeta } from "../project-data.js";
import { shouldCompact, compactMessages, microCompact, extractMemoriesBeforeCompact, estimateContextTokens } from "../compaction.js";
import { CostTracker } from "../cost-tracker.js";
import { cancelAndWaitForRunProcesses } from "../engine/process-runner.js";
import { cleanupScopedBackgroundProcesses } from "../engine/tools/bash-background.js";
import { extractMemoryMarkers, addMemory } from "../memory.js";
import { parseImageReferences, toMessageContent, resolveFileReferences, resolveFolderReferences, resolveUrlReferences } from "../image-support.js";
import * as logger from "../logger.js";
import { createMCPRunResources, autoDetectMCPServersForRun, type MCPRunResources } from "../mcp-client.js";
import { shutdownLSPRun } from "../engine/tools/lsp.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { partitionTools, formatDeferredToolsForPrompt, type DeferredToolEntry } from "../deferred-tools.js";
import { resolveConfig, type HooksConfig, type PermissionRuleConfig } from "../config.js";
import { normalizeToolName, toolStatusLabel } from "./tool-status.js";
import { runHooks, runPreHooksWithBlocking, runLifecycleHooks } from "../hooks.js";
import { browserOpen, browserNavigate, browserScreenshot, browserClick, browserFill, browserEvaluate, browserConsole, browserClose } from "../browser.js";
import fs from "fs";
import path from "path";
import { notifyIfEnabled } from "../notify.js";
import { checkpoint } from "../checkpoints.js";
import { isLocalProvider } from "../provider-capabilities.js";
import { createLiveViewServer, type LiveViewServer } from "../live-view-server.js";
import { formatLiveViewUrlMessage, getLiveViewUrls } from "../live-view-url.js";
import type {
  Message,
  ToolCallInfo,
  PermissionRequest,
  AgentStatus,
  RollbackResult,
} from "./types.js";
import {
  TRACE_DISPATCH,
  ENABLE_STEP_STREAMING_TEXT,
  traceDispatch,
  LOOP_WINDOW,
  LOOP_THRESHOLD,
  MAX_RATE_LIMIT_RETRIES,
  LONG_RESPONSE_RECEIPT_MIN_CHARS,
  TOOL_COUNT_FLUSH_MS,
  isRateLimitError,
  parsePseudoToolCalls,
  stripPseudoToolCallMarkup,
  PERMISSION_MODES,
  resolveApiKey,
  setProviderApiKeyEnv,
  getLiveViewChangeTargets,
  shouldBlockUnverifiedImageAnswer,
  trackAbortCost,
  parsePatchTargets,
  durablePermissionRules,
  type PermissionMode,
} from "./agent/utils.js";
import type { UseAgentOptions, UseAgentReturn, TurnModelOverride } from "./agent/types.js";
export type { UseAgentOptions, UseAgentReturn, TurnModelOverride } from "./agent/types.js";
export { trackAbortCost, getLiveViewChangeTargets, shouldBlockUnverifiedImageAnswer } from "./agent/utils.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyToolDef = any;

function waitForRetry(signal: AbortSignal, milliseconds: number): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Retry cancelled"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    function done(): void {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }
    function onAbort(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason ?? new Error("Retry cancelled"));
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
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
  // Rules chosen with "don't ask again" stay narrow even if settings cannot
  // be saved. Do not turn a command-family approval into a tool-wide grant.
  const sessionAllowRulesRef = useRef<string[]>([]);
  const deniedToolsRef = useRef(new Set<string>());
  const pendingPermissionResolveRef = useRef<(() => void) | null>(null);
  const permissionQueueRef = useRef<Promise<void>>(Promise.resolve());
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
  const pendingToolsByRunRef = useRef(new Map<string, Set<Promise<void>>>());

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
    setProviderApiKeyEnv(options.provider, options.apiKey);

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

    // Snapshot non-resource UI settings. MCP servers are intentionally not
    // registered here: each submitted turn owns its own cancellable resources.
    try {
      const cliConfig = resolveConfig();
      // Skip Docker MCP auto-detection for local models (Ollama/LM Studio) —
      // 50+ MCP tools overwhelm small models, causing XML text fallback instead
      // of structured tool calls. Users can still configure MCP explicitly.
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
        sessionRef.current = createSession(options.provider, options.model, workingDirRef.current);
      }
    } else {
      sessionRef.current = createSession(options.provider, options.model, workingDirRef.current);
    }

    // Ensure project metadata is loaded/created for tracking
    loadProjectMeta(workingDirRef.current);

    runLifecycleHooks("session_start", hooksConfigRef.current, workingDirRef.current, {
      WORKERMILL_SESSION_ID: sessionRef.current?.id || "",
      WORKERMILL_PROVIDER: options.provider,
      WORKERMILL_MODEL: options.model,
      WORKERMILL_RESUMED: options.resume ? "true" : "false",
    });

    // Set finishedAt on clean exit
    process.on('exit', () => {
      const session = sessionRef.current;
      if (session && !session.finishedAt) {
        session.finishedAt = new Date().toISOString();
        saveSession(session);
      }
    });
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

  // ------- Shared permission/execution adapter -------- //

  const permissionState = useCallback((context: ToolExecutionContext): PermissionState => {
    const configured = permissionRulesRef.current;
    return {
      mode: planModeRef.current ? "plan" : permModeRef.current,
      trustAll: trustAllRef.current,
      sessionAllow: sessionAllowRef.current,
      rules: {
        allow: [...(configured?.allow ?? []), ...sessionAllowRulesRef.current],
        ask: configured?.ask,
        // A local deny is explicit and must remain stronger than trust.
        deny: [...(configured?.deny ?? []), ...deniedToolsRef.current],
      },
      readOnlyRole: false,
      workspace: context.workspace,
    };
  }, []);

  const persistAlwaysChoice = useCallback(async (toolName: string, input: Record<string, unknown>): Promise<void> => {
    const rules = durablePermissionRules(toolName, input);
    for (const rule of rules) {
      if (!sessionAllowRulesRef.current.includes(rule)) sessionAllowRulesRef.current.push(rule);
    }
    try {
      const { loadLocalSettings, saveLocalSettings } = await import("../config.js");
      const settings = loadLocalSettings() || {};
      settings.allow = settings.allow || [];
      for (const rule of rules) {
        if (!settings.allow.includes(rule)) settings.allow.push(rule);
      }
      saveLocalSettings(settings);
      permissionRulesRef.current = resolveConfig().permissions;
    } catch {
      // The in-memory narrow rules above are still valid for this session.
    }
  }, []);

  const promptForPermission = useCallback(async (
    toolName: string,
    input: Record<string, unknown>,
    reason: string,
    context: ToolExecutionContext,
  ): Promise<boolean> => {
    const prior = permissionQueueRef.current;
    let release!: () => void;
    permissionQueueRef.current = new Promise<void>((resolve) => { release = resolve; });
    await prior;
    try {
      if (context.signal.aborted) return false;
      return await new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (allowed: boolean): void => {
          if (settled) return;
          settled = true;
          context.signal.removeEventListener("abort", onAbort);
          if (pendingPermissionResolveRef.current === cancelPending) pendingPermissionResolveRef.current = null;
          setPermissionRequest(null);
          resolve(allowed);
        };
        const cancelPending = (): void => finish(false);
        const onAbort = (): void => finish(false);
        pendingPermissionResolveRef.current = cancelPending;
        context.signal.addEventListener("abort", onAbort, { once: true });
        setPermissionRequest({
          toolName,
          toolInput: input,
          isDangerous: reason.startsWith("dangerous command:") || reason.startsWith("sensitive file:"),
          dangerLabel: reason,
          resolve: (allowed, mode) => {
            if (settled || context.signal.aborted) return;
            void (async () => {
              if (allowed && mode === "trust") {
                trustAllRef.current = true;
                permModeRef.current = "bypassPermissions";
                setTimeout(() => { setPermMode("bypassPermissions"); setTrustAllState(true); }, 0);
              }
              if (allowed && mode === "always") await persistAlwaysChoice(toolName, input);
              finish(allowed);
            })();
          },
        });
      });
    } finally {
      release();
    }
  }, [persistAlwaysChoice]);

  const createExecutionContext = useCallback((runId: string, signal: AbortSignal): ToolExecutionContext => {
    const capabilities = resolveConfig().sandboxCapabilities;
    const scope = createPathScope(workingDirRef.current, capabilities?.extraPathGrants ?? []);
    const context: ToolExecutionContext = {
      runId,
      workspace: scope.workspace,
      scope,
      effectiveSandbox: options.sandboxed === "os" ? "os" : options.sandboxed ? "path" : "none",
      signal,
      allowedNetworkDomains: capabilities?.allowedNetworkDomains,
      allowLocalBinding: capabilities?.allowLocalBinding,
      allowDockerSocket: capabilities?.allowDockerSocket,
      getPermissionState: () => permissionState(context),
      prompt: promptForPermission,
      preHook: (name, input, executingContext) => {
        const started = Date.now();
        const result = runPreHooksWithBlocking(name, hooksConfigRef.current, executingContext.workspace, {
          input: JSON.stringify(input).substring(0, 10000),
        });
        traceDispatch("wrapper:prehook_done", {
          tool: name,
          blocked: result.blocked,
          durationMs: Date.now() - started,
        });
        return result.blocked ? { blocked: true, reason: result.reason } : undefined;
      },
      checkpoint: (name, input, executingContext) => {
        const checkpointPath = (target: string): string => executingContext.effectiveSandbox === "none"
          ? canonicalizePath(path.resolve(executingContext.workspace, target))
          : resolvePath(executingContext.scope, target, "read_write");
        if (name === "patch") {
          for (const target of parsePatchTargets(String(input.patch_text || ""), executingContext.workspace)) {
            checkpoint(checkpointPath(target.filePath), "patch");
          }
        } else if (["write_file", "edit_file", "multi_edit_file"].includes(name) && (input.path || input.file_path)) {
          checkpoint(checkpointPath(String(input.path || input.file_path)), name);
        }
      },
      postHook: (name, _input, output, error, executingContext) => {
        if (name === "bash" && !error) onBashCompleteRef.current?.();
        if (!error) {
          const outputText = typeof output === "string" ? output : JSON.stringify(output) ?? "";
          runHooks("post", name, hooksConfigRef.current, executingContext.workspace, {
            output: outputText.substring(0, 10000),
            success: true,
          });
        }
      },
      event: (event, executingContext) => {
        if (event.phase === "complete" && event.error) {
          const message = event.error instanceof Error ? event.error.message : String(event.error);
          runLifecycleHooks("tool_error", hooksConfigRef.current, executingContext.workspace, {
            WORKERMILL_TOOL: event.toolName,
            WORKERMILL_TOOL_INPUT: JSON.stringify(event.input).substring(0, 10000),
            WORKERMILL_TOOL_ERROR: message.substring(0, 10000),
          });
        }
      },
    };
    return context;
  }, [options.sandboxed, permissionState, promptForPermission]);

  // ------- Wrap tools with permission & state tracking -------- //

  /**
   * Build a permissioned tool map. Each tool's `execute` is wrapped so that:
   * 1. Permission is checked (may suspend on a Promise).
   * 2. The tool call is tracked in `streamingToolCalls` with live status.
   * 3. The original execute runs.
   * 4. Status is updated to "done" (or "denied").
   */
  const buildPermissionedTools = useCallback((context: ToolExecutionContext, model: LanguageModel, mcpTools: Record<string, AnyToolDef>): Record<string, AnyToolDef> => {
    // Factory tools are rebuilt for every run context. In particular, bash and
    // child tools must receive this turn's signal and run ID, not a closure
    // created during hook initialization.
    const raw = createToolDefinitions(workingDirRef.current, model, options.sandboxed, {
      executionContext: context,
      runId: context.runId,
      signal: context.signal,
      scope: context.scope,
      sandboxCapabilities: {
        allowedNetworkDomains: context.allowedNetworkDomains,
        allowLocalBinding: context.allowLocalBinding,
        allowDockerSocket: context.allowDockerSocket,
      },
    }) as Record<string, AnyToolDef>;

    // Merge MCP tools (dynamically resolved each call so tools from
    // servers that finish starting after init are picked up).
    const allRawTools: Record<string, AnyToolDef> = { ...raw, ...mcpTools };

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

    // Partition tools: core tools get full schemas, MCP tools are deferred
    // to save context window space. Promoted tools (via tool_search) are
    // treated as eager on subsequent calls.
    const { eager: eagerTools, deferred } = partitionTools(allRawTools, workingDirRef.current);

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
          const pendingTools = pendingToolsByRunRef.current.get(context.runId);
          let releasePending!: () => void;
          const pending = new Promise<void>((resolve) => { releasePending = resolve; });
          pendingTools?.add(pending);
          traceDispatch("wrapper:enter", { tool: name });

          try {
            traceDispatch("wrapper:before_tool_call_log", {
              tool: name,
              sinceWrapperEnterMs: Date.now() - wrapperEnterMs,
            });
            logger.info("Tool call", { tool: name, input: JSON.stringify(input).slice(0, 200) });
            const executeStartMs = Date.now();
            traceDispatch("wrapper:before_execute", {
              tool: name,
              sinceWrapperEnterMs: executeStartMs - wrapperEnterMs,
            });
            // Policy, prompt, hooks, checkpoints, lifecycle event, and the
            // workspace mutation mutex live in executeToolCall. This wrapper
            // only adapts UI state after the real execution has settled.
            const result = await executeToolCall(name, input, () => td.execute(input), context);
            traceDispatch("wrapper:after_execute", {
              tool: name,
              executeDurationMs: Date.now() - executeStartMs,
              sinceWrapperEnterMs: Date.now() - wrapperEnterMs,
            });

            const resultStr =
              typeof result === "string" ? result : JSON.stringify(result) ?? "";
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
            if (err instanceof ToolExecutionError && err.code === "denied") {
              traceDispatch("wrapper:denied", { tool: name, sinceWrapperEnterMs: Date.now() - wrapperEnterMs });
              runLifecycleHooks("permission_denied", hooksConfigRef.current, context.workspace, {
                WORKERMILL_TOOL: name,
                WORKERMILL_TOOL_INPUT: JSON.stringify(input).substring(0, 10000),
              });
              setStreamingToolCalls((prev) => [...prev, { ...info, status: "denied" as const }]);
              setStatus("streaming");
              return "Tool execution denied by user.";
            }
            const errMsg =
              err instanceof Error ? err.message : String(err);
            setStreamingToolCalls((prev) => [...prev, { ...info, status: "done" as const, result: `Error: ${errMsg}` }]);
            setStatus("streaming");
            throw err;
          } finally {
            releasePending();
            pendingTools?.delete(pending);
          }
        },
      };
    }
    return wrapped;
  }, [options.sandboxed]);

  /**
   * Return the tool set that should be active for this turn, respecting plan
   * mode which restricts to read-only tools.
   * Async: triggers lazy MCP server start on first call.
   */
  const getActiveTools = useCallback(async (context: ToolExecutionContext, model: LanguageModel, mcpResources: MCPRunResources): Promise<Record<string, AnyToolDef>> => {
    // Lazy-start only resources owned by this turn; another chat/headless run
    // must never supply, start, or close this tool map.
    await mcpResources.ensureStarted();
    const all = buildPermissionedTools(context, model, mcpResources.getToolDefinitions() as Record<string, AnyToolDef>);
    if (!planModeRef.current) return all;
    const filtered: Record<string, AnyToolDef> = {};
    for (const [name, def] of Object.entries(all)) {
      // Unknown/browser/MCP tools are mutation-capable until their own policy
      // metadata says otherwise. A plan must never promote sub-agents either.
      if (name !== "sub_agent" && getToolMeta(name).isReadOnly) {
        filtered[name] = def;
      }
    }
    return filtered;
  }, [buildPermissionedTools]);

  // ------- submit() -------- //

  const submit = useCallback(
    (input: string, displayText?: string, submitOptions?: { modelOverride?: TurnModelOverride }) => {
      // Fire-and-forget async work; errors are caught internally.
      void (async () => {
        if (abortRef.current) {
          addSystemMessage("A response is still running. Cancel it before starting another prompt.");
          return;
        }
        // A turn owns its cancellation boundary before *any* async work. This
        // includes URL expansion and MCP startup, which previously escaped
        // ESC because they ran before the controller existed.
        const controller = new AbortController();
        const runId = crypto.randomUUID();
        pendingToolsByRunRef.current.set(runId, new Set());
        abortRef.current = controller;
        const isCurrentTurn = (): boolean => abortRef.current === controller;
        let turnStarted = false;
        let liveViewCompleted = false;
        let mcpResources: MCPRunResources | undefined;
        setStatus("thinking");
        setStatusDetail("");
        try {
        const turnConfig = resolveConfig();
        mcpResources = createMCPRunResources({ runId, workspace: workingDirRef.current, signal: controller.signal });
        const skipAutoDetect = isLocalProvider((submitOptions?.modelOverride?.provider ?? aiProviderRef.current) as AIProvider);
        const mcpConfig = skipAutoDetect
          ? (turnConfig?.mcp || {})
          : await autoDetectMCPServersForRun(turnConfig?.mcp || {}, {
            runId, workspace: workingDirRef.current, signal: controller.signal,
          });
        mcpResources.register(mcpConfig);
        const session = sessionRef.current;
        const turnOverride = submitOptions?.modelOverride;
        const turnProvider = (turnOverride?.provider ?? aiProviderRef.current) as AIProvider;
        const turnModelName = turnOverride?.model ?? activeModelNameRef.current;
        const turnHost = turnOverride?.host;
        const turnContextLength = turnOverride?.contextLength ?? activeContextLengthRef.current;
        const turnApiKey = setProviderApiKeyEnv(turnProvider, turnOverride?.apiKey);
        const turnModel = turnOverride
          ? createModel(turnProvider, turnModelName, turnHost, turnContextLength, turnApiKey)
          : modelRef.current!;

        // Resolve @file, @folder/, and @url references
        let resolvedInput = resolveFileReferences(input, workingDirRef.current);
        resolvedInput = resolveFolderReferences(resolvedInput, workingDirRef.current);
        resolvedInput = await resolveUrlReferences(resolvedInput, controller.signal);
        if (controller.signal.aborted) throw controller.signal.reason ?? new DOMException("Cancelled", "AbortError");
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

        turnStarted = true;
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
          const executionContext = createExecutionContext(runId, controller.signal);
          // Await tools first — triggers lazy MCP start so system prompt sees MCP tools
          const activeTools = (await getActiveTools(executionContext, turnModel, mcpResources)) as ToolSet;
          // Cache the system prompt — rebuilding it every turn changes the
          // text (memories, disk files), which invalidates Ollama's KV cache
          // and forces a full prompt reprocessing (~30s for 30B models).
          // Build once on first submit; only rebuild on explicit request.
          if (!systemPromptRef.current) {
            systemPromptRef.current = buildSystemPrompt(workingDirRef.current, mcpResources.getTools())
              + formatDeferredToolsForPrompt(deferredToolsRef.current);
          }
          const systemPrompt = systemPromptRef.current;
          logger.info("Starting streamText", {
            provider: turnProvider,
            model: turnModelName,
            toolCount: Object.keys(activeTools).length,
            tools: Object.keys(activeTools).join(", "),
            messageCount: session.messages.length,
          });
          const agentStreamStartMs = Date.now();
          const stream = streamText({
            model: turnModel,
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
              turnProvider,
              turnContextLength,
            ),
            ...(["openai"].includes(turnProvider)
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
                setStreamingText(reasoningText);
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
            addMemory(m.type, m.content, workingDirRef.current, undefined, undefined, {
              source: "agent",
              confidence: "high",
            });
            runLifecycleHooks("memory_saved", hooksConfigRef.current, workingDirRef.current, {
              WORKERMILL_MEMORY_TYPE: m.type,
              WORKERMILL_MEMORY_CONTENT: m.content.substring(0, 10000),
              WORKERMILL_MEMORY_SOURCE: "agent",
            });
          }

          // Cost tracking — use active refs, not startup options (user may have switched via /model).
          const totalCostBefore = costTrackerRef.current.getTotalCost();
          costTrackerRef.current.addUsage(
            "agent",
            turnProvider,
            turnModelName,
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
            const providerModel = `${turnProvider}/${turnModelName}`;
            const tps = Math.round(outputTokens / agentElapsed);
            setTokPerSecMap(prev => ({ ...prev, [providerModel]: tps }));
          }

          // Enrich session with cost data before saving
          const usageSummary = costTrackerRef.current.getUsageSummary();
          session.totalCostUsd = Math.round(usageSummary.total.cost * 10000) / 10000;
          session.costByModel = usageSummary.byModel.map(m => ({
            key: m.key,
            provider: m.provider,
            model: m.model,
            inputTokens: m.inputTokens,
            outputTokens: m.outputTokens,
            costUsd: Math.round(m.cost * 10000) / 10000,
            roles: m.roles,
          }));
          session.costByRole = {
            worker: {
              inputTokens: usageSummary.byRole.worker.inputTokens,
              outputTokens: usageSummary.byRole.worker.outputTokens,
              costUsd: Math.round(usageSummary.byRole.worker.cost * 10000) / 10000,
            },
            planner: {
              inputTokens: usageSummary.byRole.planner.inputTokens,
              outputTokens: usageSummary.byRole.planner.outputTokens,
              costUsd: Math.round(usageSummary.byRole.planner.cost * 10000) / 10000,
            },
            reviewer: {
              inputTokens: usageSummary.byRole.reviewer.inputTokens,
              outputTokens: usageSummary.byRole.reviewer.outputTokens,
              costUsd: Math.round(usageSummary.byRole.reviewer.cost * 10000) / 10000,
            },
          };

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
            turnModelName,
            turnContextLength,
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
              addMemory("learning", mem, workingDirRef.current, undefined, undefined, {
                source: "auto-extracted",
                confidence: "medium",
              });
              runLifecycleHooks("memory_saved", hooksConfigRef.current, workingDirRef.current, {
                WORKERMILL_MEMORY_TYPE: "learning",
                WORKERMILL_MEMORY_CONTENT: mem.substring(0, 10000),
                WORKERMILL_MEMORY_SOURCE: "auto-extracted",
              });
            }
            // Also persist to file-based memory so the memory tool can find them
            if (extractedMemories.length > 0) {
              try {
                const { ensureMemoriesDir, getMemoriesDir, buildProvenanceHeader } = await import("../engine/tools/memory.js");
                ensureMemoriesDir(workingDirRef.current);
                const autoFile = path.join(getMemoriesDir(workingDirRef.current), "auto-learnings.md");
                const header = buildProvenanceHeader("auto-extracted", "medium") + "# Auto-extracted Learnings\n\nDiscoveries extracted during conversation compaction.\n\n";
                const timestamp = new Date().toISOString().slice(0, 16);
                const entries = extractedMemories.map(m => `- [${timestamp}] ${m}`).join("\n") + "\n";
                const fd = fs.openSync(autoFile, "a+", 0o600);
                try {
                  const stats = fs.fstatSync(fd);
                  fs.writeFileSync(fd, (stats.size === 0 ? header : "") + entries, "utf-8");
                } finally {
                  fs.closeSync(fd);
                }
              } catch { /* non-fatal */ }
            }
            const compacted = await compactMessages(
              turnModel,
              plainMessages,
              compactionResult.level,
            );
            session.messages = compacted.map((m) => ({
              role: m.role,
              content: m.content,
              timestamp: new Date().toISOString(),
            }));
            saveSession(session);
            runLifecycleHooks("compact", hooksConfigRef.current, workingDirRef.current, {
              WORKERMILL_COMPACTION_LEVEL: compactionResult.level,
              WORKERMILL_COMPACTION_TRIGGER: "auto",
              WORKERMILL_MESSAGES_BEFORE: String(plainMessages.length),
              WORKERMILL_MESSAGES_AFTER: String(compacted.length),
            });
            notifyIfEnabled(bellEnabledRef.current, "WorkerMill", "Auto-compaction complete");
          }

          if (liveViewServerRef.current) {
            liveViewServerRef.current.emitStoryComplete(1, Date.now() - turnStartTime);
            liveViewCompleted = true;
          }
          break; // success — exit retry loop

        } catch (err) {
          // --- Rate limit retry ---
          const rateLimit = isRateLimitError(err);
          if (!controller.signal.aborted && rateLimit && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
            rateLimitRetries++;
            const waitSec = Math.ceil(rateLimit.retryAfterMs / 1000);
            logger.info("Rate limited, retrying", { attempt: rateLimitRetries, waitSec });
            setStatusDetail(`Rate limited — retrying in ${waitSec}s (${rateLimitRetries}/${MAX_RATE_LIMIT_RETRIES})`);
            setStreamingText("");
            setStreamingToolCalls([]);
            await waitForRetry(controller.signal, rateLimit.retryAfterMs);
            continue; // retry the streamText call
          }

          if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
            // Cancellation -- already handled by cancel().
            // Preserve any tokens consumed in completed steps before the abort.
            trackAbortCost(
              partialInputTokens,
              partialOutputTokens,
              "agent",
              turnProvider,
              turnModelName,
              costTrackerRef.current,
              setCost,
            );
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
            liveViewCompleted = true;
          }
          break; // error handled — exit retry loop
        }
        } // end while
        } catch (err) {
          if (controller.signal.aborted) return;
          const errText = err instanceof Error ? err.message : String(err);
          logger.error("Agent startup error", { error: errText });
          if (isCurrentTurn()) {
            setMessages((prev) => [...prev, {
              id: crypto.randomUUID(), role: "assistant" as const, content: `Error: ${errText}`,
              timestamp: new Date().toISOString(),
            }]);
          }
        } finally {
          const cancelled = controller.signal.aborted;
          controller.abort(new Error("Interactive turn settled"));
          const pending = pendingToolsByRunRef.current.get(runId);
          const cleanup = await Promise.allSettled([
            ...(pending ? [...pending] : []),
            Promise.resolve().then(() => cancelAndWaitForRunProcesses(runId)),
            Promise.resolve().then(() => cleanupScopedBackgroundProcesses(runId)),
            Promise.resolve().then(() => mcpResources?.close()),
            Promise.resolve().then(() => shutdownLSPRun(runId)),
          ]);
          pendingToolsByRunRef.current.delete(runId);
          const cleanupFailures = cleanup.filter((result): result is PromiseRejectedResult => result.status === "rejected");
          if (isCurrentTurn()) {
            if (cleanupFailures.length > 0) {
              const detail = cleanupFailures.map((result) => String(result.reason)).join("; ");
              logger.error("Interactive turn cleanup failed", { error: detail });
              setMessages((prev) => [...prev, {
                id: crypto.randomUUID(), role: "assistant" as const,
                content: `Error: cleanup failed: ${detail}`, timestamp: new Date().toISOString(),
              }]);
            }
            if (turnStarted && cancelled && !liveViewCompleted && liveViewServerRef.current) liveViewServerRef.current.emitStoryComplete(1, 0);
            abortRef.current = null;
            setStatus("idle");
            setStatusDetail("");
          }
        }
      })();
    },
    [createExecutionContext, getActiveTools],
  );

  // ------- cancel() -------- //

  const cancel = useCallback(() => {
    pendingPermissionResolveRef.current?.();
    if (abortRef.current) {
      abortRef.current.abort();
    }
    // The turn finalizer publishes idle only after its model/tools/processes
    // have all settled. Clearing it here used to allow a new turn to race an
    // old process group and made cancellation look complete too early.
    setStatusDetail("Cancelling…");
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

  const switchModel = useCallback((
    newProvider: string,
    newModel: string,
    explicitProviderConfig?: { host?: string; contextLength?: number; apiKey?: string },
  ) => {
    const providerConfig = explicitProviderConfig ?? resolveConfig()?.providers?.[newProvider];
    const host = providerConfig?.host;
    const contextLength = providerConfig?.contextLength;

    // Ensure API key is in process.env for cloud providers
    const resolvedApiKey = setProviderApiKeyEnv(newProvider, providerConfig?.apiKey);

    aiProviderRef.current = newProvider as AIProvider;
    activeModelNameRef.current = newModel;
    activeContextLengthRef.current = contextLength;
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

    runLifecycleHooks("compact", hooksConfigRef.current, workingDirRef.current, {
      WORKERMILL_COMPACTION_LEVEL: "soft",
      WORKERMILL_COMPACTION_TRIGGER: "manual",
      WORKERMILL_MESSAGES_BEFORE: String(plainMessages.length),
      WORKERMILL_MESSAGES_AFTER: String(compacted.length),
    });

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

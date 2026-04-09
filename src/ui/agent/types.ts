/**
 * Interfaces for the useAgent hook's options and return type.
 */

import type { Session } from "../../session.js";
import type {
  Message,
  ToolCallInfo,
  PermissionRequest,
  AgentStatus,
  RollbackResult,
} from "../types.js";

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

export interface TurnModelOverride {
  provider: string;
  model: string;
  apiKey?: string;
  host?: string;
  contextLength?: number;
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
  submit: (input: string, displayText?: string, options?: { modelOverride?: TurnModelOverride }) => void;
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
  switchModel: (
    provider: string,
    model: string,
    providerConfig?: { host?: string; contextLength?: number; apiKey?: string },
  ) => void;
  /** Force a compaction of the conversation. */
  forceCompact: (focusInstructions?: string) => Promise<{ before: number; after: number }>;
  /** Enable or disable interactive live view for this session. Returns active URL when enabled. */
  setLiveViewEnabled: (enabled: boolean) => string | null;
  /** Current live view URL (if running). */
  getLiveViewUrl: () => string | null;
}

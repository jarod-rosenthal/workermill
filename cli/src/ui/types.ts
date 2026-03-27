/**
 * Shared types for the Ink-based terminal UI layer.
 */

/** Information about a single tool call within an assistant message. */
export interface ToolCallInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
  status: "pending" | "running" | "done" | "denied";
}

/** A single conversation message (user prompt or assistant response). */
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallInfo[];
  timestamp: string;
  /** When set, renders content inside a bordered box with this title. */
  boxTitle?: string;
}

/** A permission request that the UI must present to the user. */
export interface PermissionRequest {
  toolName: string;
  toolInput: Record<string, unknown>;
  isDangerous: boolean;
  dangerLabel?: string;
  resolve: (allowed: boolean, mode?: "always" | "trust") => void;
}

/** High-level status of the agent loop. */
export type AgentStatus =
  | "idle"
  | "thinking"
  | "streaming"
  | "tool_running"
  | "permission";

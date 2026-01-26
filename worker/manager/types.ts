/**
 * Virtual Manager Types
 *
 * Type definitions for the Agent SDK-based Virtual Manager.
 */

/**
 * Manager configuration from environment.
 */
export interface ManagerConfig {
  taskId: string;
  action: ManagerAction;
  apiBaseUrl: string;
  orgApiKey: string;
  anthropicApiKey: string;
  githubToken: string;
  githubRepo: string;
  model?: string;
  // PR review specific
  prNumber?: string;
  prUrl?: string;
  jiraIssueKey?: string;
  jiraSummary?: string;
  jiraDescription?: string;
  reviewFeedback?: string; // Previous feedback for revisions
}

/**
 * Manager action types.
 */
export type ManagerAction = "review_pr" | "analyze_logs";

/**
 * Review decision from manager.
 */
export type ReviewDecision = "approved" | "revision_needed" | "rejected";

/**
 * Result of a manager review.
 */
export interface ManagerResult {
  success: boolean;
  decision?: ReviewDecision;
  feedback?: string;
  codeQualityScore?: number;
  error?: string;
}

/**
 * Stream message from agent execution.
 */
export interface StreamMessage {
  type: "text" | "thinking" | "tool_use" | "tool_result" | "result" | "error";
  content?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
}

/**
 * Result of agent execution.
 */
export interface AgentResult {
  success: boolean;
  messages: StreamMessage[];
  error?: string;
}

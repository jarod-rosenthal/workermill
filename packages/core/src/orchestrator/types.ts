/**
 * Orchestrator Types
 */

export interface QueueMessage {
  taskId: string;
  action: "execute" | "retry" | "cancel" | "check_status" | "deploy" | "validate";
}

export interface TaskOutput {
  result?: string;
  prUrl?: string;
  prNumber?: number;
  branch?: string;
  inputTokens?: number;
  outputTokens?: number;
  aiCost?: number;
  model?: string;
  conflictFiles?: string[];
}

export interface OrchestratorConfig {
  queueUrl: string;
  region?: string;
  cluster?: string;
  pollIntervalMs?: number;
  taskTimeoutMs?: number;
  maxConcurrentTasks?: number;
}

export interface OrchestratorEvents {
  onTaskStarted?: (taskId: string) => void;
  onTaskCompleted?: (taskId: string, success: boolean) => void;
  onTaskFailed?: (taskId: string, error: Error) => void;
  onError?: (error: Error) => void;
}

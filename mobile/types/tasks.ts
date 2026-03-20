export type WorkerTaskStatus =
  | "queued"
  | "claimed"
  | "environment_setup"
  | "planning"
  | "pending_plan_approval"
  | "dispatching"
  | "executing"
  | "consolidating"
  | "deploying"
  | "running"
  | "integration_check"
  | "blocked"
  | "pr_created"
  | "review_requested"
  | "manager_review"
  | "revision_needed"
  | "pr_approved"
  | "review_approved"
  | "escalated"
  | "completed"
  | "deployed"
  | "failed"
  | "cancelled"
  | "review_rejected";

export interface WorkerTask {
  id: string;
  issueKey: string;
  summary: string;
  description?: string;
  status: WorkerTaskStatus;
  persona: string;
  personaEmoji?: string;
  priority: "urgent" | "high" | "medium" | "low";
  estimatedCost?: number;
  actualCost?: number;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  retryCount: number;
  workflowMode?: "auto" | "manual" | "review";
  orgId: string;
  userId: string;
  boardId?: string;
  cardId?: string;
}

export interface TaskLog {
  id: string;
  taskId: string;
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  source: "stdout" | "stderr" | "system";
  stepId?: string;
}

export interface TaskStep {
  id: string;
  taskId: string;
  name: string;
  description?: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: string;
  completedAt?: string;
  output?: string;
  exitCode?: number;
  duration?: number;
  order: number;
}
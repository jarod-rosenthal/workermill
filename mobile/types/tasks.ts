export type WorkerTaskStatus =
  | 'queued'
  | 'claimed'
  | 'environment_setup'
  | 'dispatching'
  | 'planning'
  | 'pending_plan_approval'
  | 'executing'
  | 'consolidating'
  | 'deploying'
  | 'running'
  | 'integration_check'
  | 'blocked'
  | 'pr_created'
  | 'review_requested'
  | 'manager_review'
  | 'revision_needed'
  | 'pr_approved'
  | 'review_approved'
  | 'escalated'
  | 'completed'
  | 'deployed'
  | 'failed'
  | 'cancelled'
  | 'review_rejected';

export interface WorkerTask {
  id: string;
  jiraIssueKey?: string;
  summary: string;
  description?: string;
  status: WorkerTaskStatus;
  workerPersona?: string;
  workerModel?: string;
  workerProvider?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt?: string;
  estimatedCostUsd?: number;
  costUsd?: number;
  durationMinutes?: number;
  retryCount?: number;
  revisionCount?: number;
  workflowMode?: string;
  workflowModeName?: string;
  githubPrUrl?: string;
  githubBranch?: string;
  errorMessage?: string;
  cardBoardId?: string;
  cardId?: string;
  parentTaskId?: string;
  ecsTaskId?: string;
}

export interface TaskStep {
  id: string;
  task_id: string;
  step_number: number;
  name: string;
  description?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  started_at?: string;
  completed_at?: string;
  error_message?: string;
  output?: string;
}

export interface TaskLog {
  id: string;
  task_id: string;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  source: 'agent' | 'system' | 'user';
  metadata?: {
    [key: string]: any;
  };
}

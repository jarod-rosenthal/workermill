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
  issue_key: string;
  summary: string;
  description?: string;
  status: WorkerTaskStatus;
  persona: string;
  persona_emoji?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  failed_at?: string;
  elapsed_time_ms?: number;
  cost_cents?: number;
  retry_count: number;
  workflow_mode: 'auto' | 'manual' | 'review';
  board_id?: string;
  card_id?: string;
  parent_task_id?: string;
  error_message?: string;
  environment?: {
    [key: string]: any;
  };
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
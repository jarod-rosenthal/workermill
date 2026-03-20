export type ContextMessageType =
  | 'decision'
  | 'question'
  | 'blocker'
  | 'completion'
  | 'progress'
  | 'error'
  | 'warning'
  | 'info';

export interface ContextMessage {
  id: string;
  parent_task_id: string;
  task_id: string;
  persona: string;
  persona_emoji?: string;
  message_type: ContextMessageType;
  content: string;
  metadata?: {
    [key: string]: any;
  };
  created_at: string;
  updated_at?: string;
}
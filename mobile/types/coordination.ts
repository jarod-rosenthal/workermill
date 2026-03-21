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
  parentTaskId: string;
  taskId: string;
  persona: string;
  messageType: ContextMessageType;
  content: string;
  metadata?: {
    [key: string]: any;
  };
  sessionId?: string;
  createdAt: string;
}
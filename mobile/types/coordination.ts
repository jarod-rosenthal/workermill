export type ContextMessageType =
  | "decision"
  | "question"
  | "blocker"
  | "completion"
  | "error"
  | "progress"
  | "info";

export interface ContextMessage {
  id: string;
  parentTaskId: string;
  taskId: string;
  persona: string;
  personaEmoji?: string;
  messageType: ContextMessageType;
  content: string;
  timestamp: string;
  metadata?: Record<string, any>;
}
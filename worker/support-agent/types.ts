/**
 * Support Agent Types
 */

export interface SupportAgentConfig {
  taskId: string;
  ticketId: string;
  ticketKey: string;
  apiBaseUrl: string;
  orgApiKey: string;
  anthropicApiKey: string;
  model: string;
  category: string;
  priority: string;
}

export interface SupportTicket {
  id: string;
  ticketKey: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  category: string;
  createdBy: { id: string; email: string; fullName: string } | null;
  assignedTo: { id: string; email: string; fullName: string } | null;
  messages: SupportTicketMessage[];
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
}

export interface SupportTicketMessage {
  id: string;
  content: string;
  isInternal: boolean;
  isFromSupport: boolean;
  author: { id: string; email: string; fullName: string } | null;
  authorEmail: string | null;
  attachments: unknown[] | null;
  createdAt: string;
}

export interface SupportAgentResult {
  success: boolean;
  action: "responded" | "escalated" | "failed";
  confidenceScore: number;
  escalationReason?: string;
  responsePosted?: boolean;
  error?: string;
}

export interface EscalationDecision {
  escalate: boolean;
  reason?: string;
  confidence?: number;
}

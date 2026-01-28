/**
 * Support Agent Module
 *
 * Automated AI support ticket responder for WorkerMill.
 */

export { SupportAgentExecutor, runSupportAgent } from "./executor.js";
export type {
  SupportAgentConfig,
  SupportAgentResult,
  SupportTicket,
  SupportTicketMessage,
  EscalationDecision,
} from "./types.js";

/**
 * Support Agent Executor Service
 *
 * Runs support agent tasks in-process (no ECS) for fast response times.
 * Fetches ticket details, generates AI response, and posts to ticket.
 *
 * Security & Quality:
 * - Auto-escalates on low confidence (<70%)
 * - Always escalates billing/urgent tickets
 * - Logs all responses for monitoring
 * - Respects customer escalation requests
 */

import Anthropic from "@anthropic-ai/sdk";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask, SupportTicket, User } from "../models/index.js";
import { WorkerTaskLog } from "../models/WorkerTaskLog.js";
import { SupportTicketMessage } from "../models/SupportTicketMessage.js";
import { logger } from "../utils/logger.js";
import { config, getProviderCredentials } from "../config/index.js";
import {
  recordSupportAgentResponse,
  recordSupportAgentEscalation,
} from "./support-agent.js";
import { sendSupportTicketEmail } from "./email/index.js";

// Minimum confidence to respond (below this = escalate)
const MIN_CONFIDENCE_THRESHOLD = 70;

// Categories that always escalate
const ESCALATE_CATEGORIES = ["billing", "security", "legal", "account_deletion"];

// Priorities that always escalate
const ESCALATE_PRIORITIES = ["urgent", "critical"];

// Keywords that trigger escalation
const HUMAN_REQUEST_KEYWORDS = [
  "speak to a human",
  "talk to a person",
  "real person",
  "human support",
  "escalate",
  "manager",
  "supervisor",
  "actual person",
  "not a bot",
  "real human",
];

interface SupportAgentResult {
  success: boolean;
  action: "responded" | "escalated" | "failed";
  confidenceScore: number;
  response?: string;
  escalationReason?: string;
  error?: string;
}

/**
 * Execute support agent task in-process
 */
export async function executeSupportAgentTask(
  task: WorkerTask
): Promise<SupportAgentResult> {
  const taskRepo = AppDataSource.getRepository(WorkerTask);
  const ticketRepo = AppDataSource.getRepository(SupportTicket);
  const logRepo = AppDataSource.getRepository(WorkerTaskLog);
  const userRepo = AppDataSource.getRepository(User);

  // Helper to log to both console and task logs
  const postLog = async (message: string, severity: "info" | "error" = "info") => {
    logger.info(`[SupportAgent] ${message}`, { taskId: task.id });

    try {
      const log = logRepo.create({
        taskId: task.id,
        type: "info" as const,
        message: `[support_agent] ${message}`,
        severity,
      });
      await logRepo.save(log);
    } catch (err) {
      console.error("[support-agent] task log save failed:", err instanceof Error ? err.message : err);
    }
  };

  try {
    await postLog(`Starting support agent for ${task.jiraIssueKey}`);

    // Atomic update to avoid clobbering concurrent changes
    await taskRepo.update({ id: task.id }, { status: "executing", startedAt: new Date() });

    // Get ticket details from jiraFields
    const jiraFields = task.jiraFields as Record<string, unknown> | null;
    const ticketId = jiraFields?.ticketId as string;
    const ticketKey = jiraFields?.ticketKey as string || task.jiraIssueKey;
    const category = jiraFields?.category as string || "general";
    const priority = jiraFields?.priority as string || "medium";

    if (!ticketId) {
      throw new Error("No ticketId found in task jiraFields");
    }

    // Fetch full ticket details
    await postLog("Fetching ticket details...");
    const ticket = await ticketRepo.findOne({
      where: { id: ticketId },
      relations: ["messages"],
    });

    if (!ticket) {
      throw new Error(`Ticket not found: ${ticketId}`);
    }

    // Get creator info for personalization
    let creatorName = "Customer";
    if (ticket.createdBy) {
      const creator = await userRepo.findOne({ where: { id: ticket.createdBy } });
      if (creator) {
        creatorName = creator.fullName || creator.email.split("@")[0];
      }
    }

    // Check auto-escalation rules BEFORE generating response
    const autoEscalation = checkAutoEscalation(ticket, category, priority);
    if (autoEscalation.escalate) {
      await postLog(`Auto-escalating: ${autoEscalation.reason}`);

      // Post internal note about escalation
      await postEscalationNote(ticket.id, autoEscalation.reason!, 0);

      // Record escalation
      await recordSupportAgentEscalation(
        ticketId,
        task.id,
        autoEscalation.reason!,
        0
      );

      // Atomic update to avoid clobbering concurrent changes
      await taskRepo.update({ id: task.id }, {
        status: "completed",
        completedAt: new Date(),
        planningNotes: `Escalated: ${autoEscalation.reason}`,
      });

      return {
        success: true,
        action: "escalated",
        confidenceScore: 0,
        escalationReason: autoEscalation.reason,
      };
    }

    // Get Anthropic API key from platform org
    await postLog("Loading AI credentials...");
    const credentialsOrgId = task.getCredentialsOrgId();
    const anthropicApiKey = await getProviderCredentials(credentialsOrgId, "anthropic");

    if (!anthropicApiKey) {
      throw new Error("Anthropic API key not configured for platform org");
    }

    // Build conversation context
    const conversationHistory = buildConversationHistory(ticket);

    // Generate AI response
    await postLog("Generating AI response...");
    const aiResult = await generateResponse(
      ticket,
      creatorName,
      conversationHistory,
      anthropicApiKey,
      task.workerModel || config.supportAgent.defaultModel
    );

    // Log the AI response for monitoring
    await postLog(`AI confidence: ${aiResult.confidenceScore}%`);
    if (aiResult.response) {
      await postLog(`Generated response (${aiResult.response.length} chars)`);
    }

    // Check if we should escalate based on confidence
    if (aiResult.shouldEscalate) {
      await postLog(`Escalating: ${aiResult.escalationReason}`);

      await postEscalationNote(ticket.id, aiResult.escalationReason!, aiResult.confidenceScore);

      await recordSupportAgentEscalation(
        ticketId,
        task.id,
        aiResult.escalationReason!,
        aiResult.confidenceScore
      );

      await taskRepo.update({ id: task.id }, {
        status: "completed",
        completedAt: new Date(),
        planningNotes: `Escalated: ${aiResult.escalationReason}`,
      });

      return {
        success: true,
        action: "escalated",
        confidenceScore: aiResult.confidenceScore,
        escalationReason: aiResult.escalationReason,
      };
    }

    // Post the response to the ticket
    await postLog("Posting response to ticket...");
    await postResponseToTicket(ticket.id, aiResult.response!);

    // Record successful response
    await recordSupportAgentResponse(
      ticketId,
      task.id,
      aiResult.confidenceScore,
      task.workerModel || config.supportAgent.defaultModel
    );

    await postLog(`Response posted successfully`);

    // Atomic update to avoid clobbering concurrent changes
    await taskRepo.update({ id: task.id }, {
      status: "completed",
      completedAt: new Date(),
      planningNotes: `Responded with ${aiResult.confidenceScore}% confidence`,
    });

    return {
      success: true,
      action: "responded",
      confidenceScore: aiResult.confidenceScore,
      response: aiResult.response,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await postLog(`Error: ${errorMessage}`, "error");

    await taskRepo.update({ id: task.id }, {
      status: "failed",
      completedAt: new Date(),
      planningNotes: `Error: ${errorMessage}`,
    });

    return {
      success: false,
      action: "failed",
      confidenceScore: 0,
      error: errorMessage,
    };
  }
}

/**
 * Check if ticket should be auto-escalated before AI processing
 */
function checkAutoEscalation(
  ticket: SupportTicket,
  category: string,
  priority: string
): { escalate: boolean; reason?: string } {
  // Category-based escalation
  if (ESCALATE_CATEGORIES.includes(category.toLowerCase())) {
    return { escalate: true, reason: `${category} category requires human support` };
  }

  // Priority-based escalation
  if (ESCALATE_PRIORITIES.includes(priority.toLowerCase())) {
    return { escalate: true, reason: `${priority} priority requires immediate human attention` };
  }

  // Check for human request keywords
  const content = `${ticket.subject} ${ticket.description}`.toLowerCase();
  for (const keyword of HUMAN_REQUEST_KEYWORDS) {
    if (content.includes(keyword)) {
      return { escalate: true, reason: `Customer requested human support: "${keyword}"` };
    }
  }

  // Check message count (extended back-and-forth without resolution)
  const customerMessages = ticket.messages?.filter(
    (m) => !m.isFromSupport && !m.isInternal
  ) || [];
  if (customerMessages.length > 5) {
    return { escalate: true, reason: "Extended conversation requires human review" };
  }

  return { escalate: false };
}

/**
 * Build conversation history for context
 */
function buildConversationHistory(ticket: SupportTicket): string {
  if (!ticket.messages || ticket.messages.length === 0) {
    return "No previous messages.";
  }

  return ticket.messages
    .filter((m) => !m.isInternal)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((m) => {
      const sender = m.isFromSupport ? "Support" : "Customer";
      return `[${sender}] ${m.content}`;
    })
    .join("\n\n");
}

/**
 * Generate AI response using Claude
 */
async function generateResponse(
  ticket: SupportTicket,
  customerName: string,
  conversationHistory: string,
  anthropicApiKey: string,
  model: string
): Promise<{
  response?: string;
  confidenceScore: number;
  shouldEscalate: boolean;
  escalationReason?: string;
}> {
  const anthropic = new Anthropic({ apiKey: anthropicApiKey });

  const systemPrompt = `You are a friendly, expert support agent for WorkerMill - a platform for orchestrating autonomous AI coding agents.

## Your Personality
- Warm, professional, and genuinely helpful
- Go above and beyond when possible
- Empathetic and patient
- Clear and concise, avoiding unnecessary jargon

## Your Knowledge Areas
- WorkerMill features: task orchestration, worker management, log streaming, real-time dashboards
- Common issues: task failures, worker timeouts, credential setup, webhook configuration
- Integration setup: Jira, GitHub, GitLab, Bitbucket, Linear
- Task lifecycle: queued → claimed → executing → completed/failed
- Settings: log retention (configurable, default 30 days), task retention (default 90 days), concurrent workers
- Billing and plans (but ALWAYS escalate billing changes/refunds)

## Response Guidelines
1. Address the customer by name: "${customerName}"
2. Acknowledge their situation first
3. Provide clear, actionable solutions
4. Include relevant documentation links when helpful (https://workermill.com/docs)
5. Offer to help with follow-up questions
6. Keep responses focused but thorough
7. Sign off with "Best regards, WorkerMill Support"

## Important Rules
- If you're not confident about the answer, output ::escalate:: with a reason
- NEVER make up features or capabilities
- NEVER promise timelines or specific outcomes
- ALWAYS be honest about limitations
- For billing/payment questions, ALWAYS escalate

## Response Format
Start with your confidence score:
::confidence::XX (where XX is 0-100)

Then write your response OR output ::escalate::REASON

## Current Ticket

**Subject:** ${ticket.subject}
**Category:** ${ticket.category}
**Priority:** ${ticket.priority}
**Customer:** ${customerName}

**Description:**
${ticket.description}

## Conversation History
${conversationHistory}

---
Now provide a helpful response. Remember to start with ::confidence::XX`;

  const message = await anthropic.messages.create({
    model: model || "",
    max_tokens: 2000,
    messages: [{ role: "user", content: systemPrompt }],
  });

  const responseText = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  // Parse confidence score
  const confidenceMatch = responseText.match(/::confidence::(\d+)/);
  const confidenceScore = confidenceMatch ? parseInt(confidenceMatch[1], 10) : 50;

  // Check for explicit escalation
  const escalateMatch = responseText.match(/::escalate::(.+?)(?:\n|$)/);
  if (escalateMatch) {
    return {
      confidenceScore,
      shouldEscalate: true,
      escalationReason: escalateMatch[1].trim(),
    };
  }

  // Low confidence triggers escalation
  if (confidenceScore < MIN_CONFIDENCE_THRESHOLD) {
    return {
      confidenceScore,
      shouldEscalate: true,
      escalationReason: `AI confidence too low: ${confidenceScore}%`,
    };
  }

  // Clean up the response
  const cleanResponse = responseText
    .replace(/::confidence::\d+\s*/g, "")
    .trim();

  return {
    response: cleanResponse,
    confidenceScore,
    shouldEscalate: false,
  };
}

/**
 * Post response to ticket as a message and send email notification
 */
async function postResponseToTicket(
  ticketId: string,
  response: string
): Promise<void> {
  const messageRepo = AppDataSource.getRepository(SupportTicketMessage);
  const ticketRepo = AppDataSource.getRepository(SupportTicket);
  const userRepo = AppDataSource.getRepository(User);

  const message = messageRepo.create({
    ticketId,
    content: response,
    isInternal: false,
    isFromSupport: true,
    // No authorId - this is from AI
  });

  await messageRepo.save(message);

  // Fetch ticket with creator info for email notification
  const ticket = await ticketRepo.findOne({ where: { id: ticketId } });
  if (!ticket) {
    return;
  }

  // Update ticket status to in_progress if it was open
  if (ticket.status === "open") {
    await ticketRepo.update(ticketId, { status: "in_progress" });
  }

  // Send email notification to ticket creator
  if (ticket.createdBy) {
    try {
      const creator = await userRepo.findOne({ where: { id: ticket.createdBy } });
      if (creator?.email) {
        await sendSupportTicketEmail(creator.email, "reply", ticket, response);
        logger.info("Support agent email sent", { ticketId, recipientEmail: creator.email });
      }
    } catch (emailError) {
      // Log but don't fail - the response was already saved
      logger.error("Failed to send support agent email", { ticketId, error: emailError });
    }
  }
}

/**
 * Post internal escalation note
 */
async function postEscalationNote(
  ticketId: string,
  reason: string,
  confidenceScore: number
): Promise<void> {
  const messageRepo = AppDataSource.getRepository(SupportTicketMessage);
  const ticketRepo = AppDataSource.getRepository(SupportTicket);

  const note = `## AI Support Agent Escalation

**Escalation Reason:** ${reason}

**AI Analysis:**
- Analyzed at: ${new Date().toISOString()}
- Confidence Score: ${confidenceScore}%

**Recommendation:** This ticket requires human attention.`;

  const message = messageRepo.create({
    ticketId,
    content: note,
    isInternal: true,
    isFromSupport: true,
  });

  await messageRepo.save(message);

  // Update ticket status to in_progress
  await ticketRepo.update(ticketId, { status: "in_progress" });
}

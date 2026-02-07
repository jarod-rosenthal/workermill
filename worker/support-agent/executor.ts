/**
 * Support Agent Executor
 *
 * Handles automated responses to support tickets using AI.
 * Fetches ticket details, analyzes the request, and either:
 * - Generates and posts a helpful response, OR
 * - Escalates to human support with context
 *
 * This executor does NOT require git operations or PR creation.
 */

import axios, { AxiosInstance } from "axios";
import * as fs from "fs/promises";
import * as path from "path";
import Anthropic from "@anthropic-ai/sdk";

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
  messages: Array<{
    id: string;
    content: string;
    isInternal: boolean;
    isFromSupport: boolean;
    createdAt: string;
  }>;
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

/**
 * Support Agent Executor
 */
export class SupportAgentExecutor {
  private config: SupportAgentConfig;
  private api: AxiosInstance;
  private anthropic: Anthropic;
  private directivesPath: string = "/workspace/directives/support_agent";

  constructor(config: SupportAgentConfig) {
    this.config = config;

    // Create axios instance for API calls
    this.api = axios.create({
      baseURL: config.apiBaseUrl,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.orgApiKey,
      },
      timeout: 30000,
    });

    // Create Anthropic client
    this.anthropic = new Anthropic({
      apiKey: config.anthropicApiKey,
    });
  }

  /**
   * Post a log message to the WorkerMill dashboard.
   */
  private async postLog(
    message: string,
    type: "system" | "output" | "error" = "output"
  ): Promise<void> {
    console.log(`[SupportAgent] ${message}`);

    try {
      await this.api.post("/api/control-center/logs", {
        taskId: this.config.taskId,
        type,
        message: `[support_agent] ${message}`,
        severity: type === "error" ? "error" : "info",
      });
    } catch {
      // Fire and forget
    }
  }

  /**
   * Update task status
   */
  private async updateTaskStatus(
    status: "running" | "completed" | "failed",
    result?: string
  ): Promise<void> {
    try {
      await this.api.patch(`/api/tasks/${this.config.taskId}`, {
        status,
        result,
      });
    } catch (error) {
      console.error("Failed to update task status:", error);
    }
  }

  /**
   * Fetch the support ticket details
   */
  private async fetchTicket(): Promise<SupportTicket> {
    const response = await this.api.get(`/api/support/tickets/${this.config.ticketId}`);
    return response.data.ticket;
  }

  /**
   * Load support agent directives from files
   */
  private async loadDirectives(): Promise<string> {
    const files = [
      "README.md",
      "knowledge-base.md",
      "escalation-rules.md",
      "response-templates.md",
      "quality-checks.md",
    ];

    let directives = "";

    for (const file of files) {
      try {
        const filePath = path.join(this.directivesPath, file);
        const content = await fs.readFile(filePath, "utf-8");
        directives += `\n\n***REMOVED******REMOVED*** ${file}\n\n${content}`;
      } catch {
        // File may not exist - continue
        console.warn(`Directive file not found: ${file}`);
      }
    }

    return directives;
  }

  /**
   * Build the conversation history for context
   */
  private buildConversationHistory(ticket: SupportTicket): string {
    if (!ticket.messages || ticket.messages.length === 0) {
      return "No previous messages.";
    }

    return ticket.messages
      .filter((m) => !m.isInternal) // Exclude internal notes from AI context
      .map((m) => {
        const sender = m.isFromSupport ? "Support" : "Customer";
        return `[${sender}] ${m.content}`;
      })
      .join("\n\n");
  }

  /**
   * Check if ticket should be escalated based on rules
   */
  private shouldAutoEscalate(ticket: SupportTicket): { escalate: boolean; reason?: string } {
    // Billing tickets always escalate
    if (ticket.category === "billing") {
      return { escalate: true, reason: "Billing category requires human support" };
    }

    // Urgent priority escalates
    if (ticket.priority === "urgent") {
      return { escalate: true, reason: "Urgent priority requires immediate human attention" };
    }

    // Check for explicit human request keywords
    const content = (ticket.description + " " + ticket.subject).toLowerCase();
    const humanRequestKeywords = [
      "speak to a human",
      "talk to a person",
      "real person",
      "human support",
      "escalate",
      "manager",
      "supervisor",
    ];

    for (const keyword of humanRequestKeywords) {
      if (content.includes(keyword)) {
        return { escalate: true, reason: `Customer requested human support: "${keyword}"` };
      }
    }

    // Check message count (>5 messages without resolution)
    const customerMessages = ticket.messages?.filter((m) => !m.isFromSupport && !m.isInternal) || [];
    if (customerMessages.length > 5) {
      return { escalate: true, reason: "Multiple customer messages without resolution" };
    }

    return { escalate: false };
  }

  /**
   * Generate AI response using Claude
   */
  private async generateResponse(
    ticket: SupportTicket,
    directives: string,
    conversationHistory: string
  ): Promise<{ response: string; confidenceScore: number; shouldEscalate: boolean; escalationReason?: string }> {
    const systemPrompt = `You are an AI support agent for WorkerMill, a platform for orchestrating autonomous AI coding agents.

${directives}

***REMOVED******REMOVED*** Your Task

Analyze the support ticket below and generate an appropriate response OR decide to escalate to human support.

IMPORTANT RULES:
1. If you're not confident (< 70%) about the answer, output ::escalate:: with a reason
2. If this is a billing question, output ::escalate:: immediately
3. Be helpful, professional, and concise
4. Provide actionable next steps
5. Include relevant documentation links when helpful

***REMOVED******REMOVED*** Response Format

Start your response with a confidence score:
::confidence::XX (where XX is 0-100)

Then either:
- Write your response directly (it will be posted to the customer), OR
- Output ::escalate::REASON to escalate to human support

***REMOVED******REMOVED*** Current Ticket

Subject: ${ticket.subject}
Category: ${ticket.category}
Priority: ${ticket.priority}
Customer: ${ticket.createdBy?.fullName || ticket.createdBy?.email || "Unknown"}

Description:
${ticket.description}

***REMOVED******REMOVED*** Conversation History:
${conversationHistory}`;

    const message = await this.anthropic.messages.create({
      model: this.config.model || "claude-haiku-4-5",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: systemPrompt,
        },
      ],
    });

    const responseText = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    // Parse confidence score
    const confidenceMatch = responseText.match(/::confidence::(\d+)/);
    const confidenceScore = confidenceMatch ? parseInt(confidenceMatch[1], 10) : 50;

    // Check for escalation
    const escalateMatch = responseText.match(/::escalate::(.+?)(?:\n|$)/);
    if (escalateMatch) {
      return {
        response: "",
        confidenceScore,
        shouldEscalate: true,
        escalationReason: escalateMatch[1].trim(),
      };
    }

    // Low confidence also triggers escalation
    if (confidenceScore < 70) {
      return {
        response: "",
        confidenceScore,
        shouldEscalate: true,
        escalationReason: `Low confidence score: ${confidenceScore}%`,
      };
    }

    // Clean up the response (remove confidence marker)
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
   * Post response to the support ticket
   */
  private async postResponse(ticketId: string, content: string): Promise<void> {
    await this.api.post(`/api/support/tickets/${ticketId}/messages`, {
      content,
      isInternal: false,
    });
  }

  /**
   * Post internal note for escalation
   */
  private async postEscalationNote(
    ticketId: string,
    reason: string,
    confidenceScore: number
  ): Promise<void> {
    const note = `***REMOVED******REMOVED*** AI Support Agent Escalation

**Escalation Reason:** ${reason}

**AI Analysis:**
- Ticket analyzed at: ${new Date().toISOString()}
- Confidence Score: ${confidenceScore}%
- Model Used: ${this.config.model}

**Recommendation:** This ticket requires human attention.`;

    await this.api.post(`/api/support/tickets/${ticketId}/messages`, {
      content: note,
      isInternal: true,
    });
  }

  /**
   * Update ticket with AI response metadata
   */
  private async updateTicketAiMetadata(
    ticketId: string,
    confidenceScore: number,
    escalated: boolean,
    escalationReason?: string
  ): Promise<void> {
    try {
      await this.api.post(`/api/support/tickets/${ticketId}/ai-response`, {
        taskId: this.config.taskId,
        confidenceScore,
        modelUsed: this.config.model,
        escalated,
        escalationReason,
      });
    } catch {
      // Non-critical - metadata update can fail
      console.warn("Failed to update ticket AI metadata");
    }
  }

  /**
   * Execute the support agent task
   */
  async execute(): Promise<SupportAgentResult> {
    await this.postLog(`Starting support agent for ticket ${this.config.ticketKey}`);
    await this.updateTaskStatus("running");

    try {
      // 1. Fetch ticket details
      await this.postLog("Fetching ticket details...");
      const ticket = await this.fetchTicket();

      // 2. Check auto-escalation rules
      const autoEscalation = this.shouldAutoEscalate(ticket);
      if (autoEscalation.escalate) {
        await this.postLog(`Auto-escalating: ${autoEscalation.reason}`);
        await this.postEscalationNote(ticket.id, autoEscalation.reason!, 0);
        await this.updateTicketAiMetadata(ticket.id, 0, true, autoEscalation.reason);
        await this.updateTaskStatus("completed", `::escalate::${autoEscalation.reason}`);
        return {
          success: true,
          action: "escalated",
          confidenceScore: 0,
          escalationReason: autoEscalation.reason,
        };
      }

      // 3. Load directives
      await this.postLog("Loading support agent directives...");
      const directives = await this.loadDirectives();

      // 4. Build conversation history
      const conversationHistory = this.buildConversationHistory(ticket);

      // 5. Generate AI response
      await this.postLog("Generating AI response...");
      const aiResult = await this.generateResponse(ticket, directives, conversationHistory);

      // 6. Handle escalation or post response
      if (aiResult.shouldEscalate) {
        await this.postLog(`Escalating: ${aiResult.escalationReason}`);
        await this.postEscalationNote(ticket.id, aiResult.escalationReason!, aiResult.confidenceScore);
        await this.updateTicketAiMetadata(ticket.id, aiResult.confidenceScore, true, aiResult.escalationReason);
        await this.updateTaskStatus("completed", `::escalate::${aiResult.escalationReason}`);
        return {
          success: true,
          action: "escalated",
          confidenceScore: aiResult.confidenceScore,
          escalationReason: aiResult.escalationReason,
        };
      }

      // Post the response
      await this.postLog(`Posting response (confidence: ${aiResult.confidenceScore}%)...`);
      await this.postResponse(ticket.id, aiResult.response);
      await this.updateTicketAiMetadata(ticket.id, aiResult.confidenceScore, false);

      await this.postLog(`Response posted successfully`);
      await this.updateTaskStatus("completed", "::response::posted");

      return {
        success: true,
        action: "responded",
        confidenceScore: aiResult.confidenceScore,
        responsePosted: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      await this.postLog(`Error: ${errorMessage}`, "error");
      await this.updateTaskStatus("failed", `Error: ${errorMessage}`);
      return {
        success: false,
        action: "failed",
        confidenceScore: 0,
        error: errorMessage,
      };
    }
  }
}

/**
 * Main entry point for the support agent
 */
export async function runSupportAgent(config: SupportAgentConfig): Promise<SupportAgentResult> {
  const executor = new SupportAgentExecutor(config);
  return executor.execute();
}

// CLI entry point
if (require.main === module) {
  const config: SupportAgentConfig = {
    taskId: process.env.TASK_ID || "",
    ticketId: process.env.TICKET_ID || "",
    ticketKey: process.env.TICKET_KEY || "",
    apiBaseUrl: process.env.API_BASE_URL || "https://workermill.com",
    orgApiKey: process.env.ORG_API_KEY || "",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
    model: process.env.MODEL || "claude-haiku-4-5",
    category: process.env.CATEGORY || "general",
    priority: process.env.PRIORITY || "medium",
  };

  runSupportAgent(config)
    .then((result) => {
      console.log("Support agent completed:", JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error("Support agent failed:", error);
      process.exit(1);
    });
}

import { Router, Request, Response } from "express";
import crypto from "crypto";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask, Organization } from "../models/index.js";
import { inferPersonaFromJiraIssue } from "../services/persona-inference.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";

const router = Router();

/**
 * Verify Jira webhook signature
 */
function verifyJiraSignature(
  payload: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature || !secret) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Extract text from Jira ADF (Atlassian Document Format)
 */
function extractTextFromADF(adf: unknown): string {
  if (!adf || typeof adf !== "object") return "";

  const node = adf as { type?: string; text?: string; content?: unknown[] };

  if (node.type === "text" && node.text) {
    return node.text;
  }

  if (Array.isArray(node.content)) {
    return node.content.map(extractTextFromADF).join(" ");
  }

  return "";
}

/**
 * POST /api/webhooks/jira
 * Handle Jira webhook events
 */
router.post("/jira", async (req: Request, res: Response) => {
  try {
    const signature = req.headers["x-atlassian-webhook-signature"] as string;
    const rawBody = JSON.stringify(req.body);

    // Get organization from API key header
    const apiKey = req.headers["x-api-key"] as string;
    if (!apiKey) {
      res.status(401).json({ error: "Missing API key" });
      return;
    }

    const orgRepo = AppDataSource.getRepository(Organization);
    const org = await orgRepo.findOne({ where: { apiKey } });

    if (!org) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }

    // Verify webhook signature if secret is configured
    if (org.jiraWebhookSecret) {
      if (!verifyJiraSignature(rawBody, signature, org.jiraWebhookSecret)) {
        logger.warn("Invalid Jira webhook signature", { orgId: org.id });
        res.status(401).json({ error: "Invalid signature" });
        return;
      }
    }

    const { webhookEvent, issue } = req.body;

    // Only process issue created/updated events with ai-worker label
    if (!webhookEvent?.startsWith("jira:issue_")) {
      res.json({ status: "ignored", reason: "Not an issue event" });
      return;
    }

    if (!issue) {
      res.json({ status: "ignored", reason: "No issue in payload" });
      return;
    }

    const labels = issue.fields?.labels || [];
    if (!labels.includes("workermill")) {
      res.json({ status: "ignored", reason: "Missing workermill label" });
      return;
    }

    const issueKey = issue.key;
    const summary = issue.fields?.summary || "";
    const description = extractTextFromADF(issue.fields?.description);

    // Check if task already exists for this issue
    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const existingTask = await taskRepo.findOne({
      where: { jiraIssueKey: issueKey, orgId: org.id },
    });

    if (existingTask && !existingTask.isTerminal()) {
      res.json({
        status: "ignored",
        reason: "Task already exists and is not complete",
        taskId: existingTask.id,
      });
      return;
    }

    // Infer persona from ticket content
    const persona = inferPersonaFromJiraIssue({
      summary,
      description,
      labels,
      fields: issue.fields,
    });

    // Determine model based on labels or default
    let model = "claude-sonnet-4-20250514";
    if (labels.includes("model:opus")) {
      model = "claude-opus-4-20250514";
    } else if (labels.includes("model:haiku")) {
      model = "claude-3-5-haiku-20241022";
    }

    // Create new task
    const task = taskRepo.create({
      orgId: org.id,
      jiraIssueKey: issueKey,
      summary,
      description,
      workerPersona: persona,
      workerModel: model,
      githubRepo: org.defaultGithubRepo || "",
      status: "queued",
      retryCount: 0,
      maxRetries: 3,
    });

    await taskRepo.save(task);

    logger.info("Created worker task from Jira webhook", {
      taskId: task.id,
      jiraIssueKey: issueKey,
      persona,
      model,
      orgId: org.id,
    });

    res.status(201).json({
      status: "created",
      taskId: task.id,
      persona,
      model,
    });
  } catch (error) {
    logger.error("Error processing Jira webhook", { error });
    res.status(500).json({ error: "Failed to process webhook" });
  }
});

/**
 * POST /api/webhooks/jira/test
 * Test endpoint for verifying webhook configuration
 */
router.post("/jira/test", async (req: Request, res: Response) => {
  const apiKey = req.headers["x-api-key"] as string;
  if (!apiKey) {
    res.status(401).json({ error: "Missing API key" });
    return;
  }

  const orgRepo = AppDataSource.getRepository(Organization);
  const org = await orgRepo.findOne({ where: { apiKey } });

  if (!org) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }

  res.json({
    status: "ok",
    message: "Webhook endpoint is configured correctly",
    organization: org.name,
    timestamp: new Date().toISOString(),
  });
});

export default router;

import { Router, Request, Response } from "express";
import crypto from "crypto";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask, Organization, User } from "../models/index.js";
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
    // Log webhook receipt
    logger.info("Jira webhook received");

    // Get the organization that has users (the active org)
    // This ensures tasks are created for the org that users authenticate with
    const orgRepo = AppDataSource.getRepository(Organization);
    const userRepo = AppDataSource.getRepository(User);

    // Find org with active users - that's the real org being used
    const activeUser = await userRepo.findOne({
      where: { status: "active" },
      relations: ["organization"],
    });
    let org = activeUser?.organization;

    // Fallback to first org if no active users found
    if (!org) {
      org = await orgRepo.findOne({ where: {} }) ?? undefined;
    }

    if (!org) {
      logger.error("No organization found for Jira webhook");
      res.status(500).json({ error: "No organization configured" });
      return;
    }

    logger.info("Jira webhook using org", { orgId: org.id, orgName: org.name });

    // Optional: Verify webhook signature if secret is configured
    const signature = req.headers["x-atlassian-webhook-signature"] as string;
    const rawBody = JSON.stringify(req.body);
    if (org.jiraWebhookSecret && signature) {
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

    // Determine model based on labels (default is Haiku 3.5 for cost efficiency)
    // Supported labels: haiku, sonnet, opus
    let model = "claude-3-5-haiku-20241022";
    if (labels.includes("opus")) {
      model = "claude-opus-4-20250514";
    } else if (labels.includes("sonnet")) {
      model = "claude-sonnet-4-20250514";
    } else if (labels.includes("haiku")) {
      model = "claude-3-5-haiku-20241022";
    }

    // Check for workflow labels
    const deploymentEnabled = labels.includes("deploy");
    const skipManagerReview = !labels.includes("review");
    const managerEnabled = labels.includes("manager");

    // Create new task
    const task = taskRepo.create({
      orgId: org.id,
      jiraIssueKey: issueKey,
      jiraIssueId: issue.id || issueKey,
      summary,
      description,
      jiraFields: issue.fields || {},
      workerPersona: persona,
      workerModel: model,
      githubRepo: org.defaultGithubRepo || "",
      status: "queued",
      deploymentEnabled,
      skipManagerReview,
      managerEnabled,
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

/**
 * Verify GitHub webhook signature
 */
function verifyGitHubSignature(
  payload: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature || !secret) {
    return false;
  }

  const expectedSignature =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(payload).digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * POST /api/webhooks/github
 * Handle GitHub webhook events (PR approvals)
 *
 * GitHub webhooks cannot send custom headers, so we find the task
 * by PR number directly (matching Jira webhook pattern).
 * Signature verification is done per-org if webhook secret is configured.
 */
router.post("/github", async (req: Request, res: Response) => {
  try {
    const signature = req.headers["x-hub-signature-256"] as string;
    const event = req.headers["x-github-event"] as string;
    const rawBody = JSON.stringify(req.body);

    logger.info("GitHub webhook received", { event, hasSignature: !!signature });

    // Only process pull_request_review events
    if (event !== "pull_request_review") {
      res.json({ status: "ignored", reason: "Not a PR review event" });
      return;
    }

    const { action, review, pull_request } = req.body;

    // Only process approved reviews
    if (action !== "submitted" || review?.state !== "approved") {
      res.json({ status: "ignored", reason: "Not an approval" });
      return;
    }

    const prNumber = pull_request?.number;
    const repoFullName = pull_request?.base?.repo?.full_name;
    const approvedBy = review?.user?.login;

    if (!prNumber) {
      res.json({ status: "ignored", reason: "No PR number" });
      return;
    }

    logger.info("GitHub PR approved", { prNumber, repoFullName, approvedBy });

    // Find task by PR number across all orgs (we'll verify signature per-org if secret exists)
    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const orgRepo = AppDataSource.getRepository(Organization);

    // Look for task in any status that could receive approval
    // pr_created: waiting for GitHub review
    // review_requested: waiting for review (legacy status)
    const task = await taskRepo
      .createQueryBuilder("task")
      .where("task.githubPrNumber = :prNumber", { prNumber })
      .andWhere("task.status IN (:...statuses)", { statuses: ["pr_created", "review_requested"] })
      .getOne();

    if (!task) {
      logger.info("No matching task for PR", { prNumber });
      res.json({ status: "ignored", reason: "No matching task for this PR" });
      return;
    }

    // Get the org to verify signature if secret is configured
    const org = await orgRepo.findOne({ where: { id: task.orgId } });

    if (!org) {
      logger.error("Organization not found for task", { taskId: task.id, orgId: task.orgId });
      res.status(500).json({ error: "Organization not found" });
      return;
    }

    // Verify webhook signature if secret is configured
    if (org.githubWebhookSecret) {
      if (!verifyGitHubSignature(rawBody, signature, org.githubWebhookSecret)) {
        logger.warn("Invalid GitHub webhook signature", { orgId: org.id, prNumber });
        res.status(401).json({ error: "Invalid signature" });
        return;
      }
    }

    // Check if task has deploy label - only re-queue if deployment is enabled
    if (!task.deploymentEnabled) {
      // No deploy label - just update status to show PR was approved
      task.status = "pr_approved";
      task.githubApprovedBy = approvedBy || null;
      await taskRepo.save(task);

      logger.info("PR approved but deployment not enabled", {
        taskId: task.id,
        prNumber,
        approvedBy,
        jiraIssueKey: task.jiraIssueKey,
      });

      res.json({
        status: "processed",
        taskId: task.id,
        newStatus: "pr_approved",
        message: "PR approved (deployment not enabled)",
      });
      return;
    }

    // Set up for deployment run and re-queue
    task.status = "queued";  // Re-queue for orchestrator to pick up
    task.githubApprovedBy = approvedBy || null;
    task.taskNotes = `DEPLOYMENT_RUN: PR #${prNumber} approved by ${approvedBy}. Deploy and merge.`;
    task.completedAt = null;  // Reset completion time
    task.ecsTaskArn = null;   // Clear previous ECS task info
    task.ecsTaskId = null;
    task.startedAt = null;

    await taskRepo.save(task);

    logger.info("PR approved, task re-queued for deployment run", {
      taskId: task.id,
      prNumber,
      approvedBy,
      jiraIssueKey: task.jiraIssueKey,
    });

    res.json({
      status: "processed",
      taskId: task.id,
      newStatus: "queued",
      message: "Task re-queued for deployment run",
    });
  } catch (error) {
    logger.error("Error processing GitHub webhook", { error });
    res.status(500).json({ error: "Failed to process webhook" });
  }
});

export default router;

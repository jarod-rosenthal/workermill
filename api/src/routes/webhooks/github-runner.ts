import { Router, Request, Response } from "express";
import crypto from "crypto";
import { getECSTaskRunner } from "../../services/ecs-task-runner.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../config/index.js";

const router = Router();

// =============================================================================
// GitHub Actions Runner Webhook
// =============================================================================
// Receives workflow_job events from GitHub and spawns ephemeral ECS runners.
// Configure in GitHub repo Settings > Webhooks:
//   URL: https://workermill.com/api/webhooks/github-runner
//   Events: Workflow jobs
// =============================================================================

router.post("/github-runner", async (req: Request, res: Response) => {
  try {
    // Verify GitHub webhook signature
    const signature = req.headers["x-hub-signature-256"] as string;
    const webhookSecret = process.env.GITHUB_RUNNER_WEBHOOK_SECRET;

    if (!webhookSecret) {
      logger.error("GITHUB_RUNNER_WEBHOOK_SECRET not configured — rejecting webhook");
      return res.status(500).json({ error: "Webhook secret not configured" });
    }

    if (!signature) {
      logger.warn("GitHub runner webhook missing signature");
      return res.status(401).json({ error: "Missing signature" });
    }

    const body = JSON.stringify(req.body);
    const expected =
      "sha256=" +
      crypto
        .createHmac("sha256", webhookSecret)
        .update(body)
        .digest("hex");

    if (
      !crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected)
      )
    ) {
      logger.warn("GitHub runner webhook invalid signature");
      return res
        .status(401)
        .json({ error: "Invalid signature" });
    }

    const event = req.headers["x-github-event"] as string;
    const payload = req.body;

    // Only handle workflow_job events
    if (event !== "workflow_job") {
      logger.debug("Ignoring non-workflow_job event", { event });
      return res
        .status(200)
        .json({ status: "ignored", reason: "not workflow_job" });
    }

    const action = payload.action;
    const job = payload.workflow_job;
    const labels = job?.labels || [];

    logger.info("GitHub runner webhook received", {
      action,
      labels,
      jobId: job?.id,
    });

    // Only start runner for queued jobs with self-hosted label
    if (action !== "queued") {
      return res
        .status(200)
        .json({ status: "ignored", reason: `action is ${action}` });
    }

    if (!labels.includes("self-hosted")) {
      return res
        .status(200)
        .json({ status: "ignored", reason: "not self-hosted" });
    }

    // Get registration token from GitHub API
    const githubToken = config.secrets.githubToken;
    if (!githubToken) {
      logger.error("GitHub token not configured");
      return res
        .status(500)
        .json({ error: "GitHub token not configured" });
    }

    const repo = payload.repository;
    const owner = repo?.owner?.login || "jarodtowner";
    const repoName = repo?.name || "workermill";

    const tokenResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/actions/runners/registration-token`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      logger.error("Failed to get runner registration token", {
        status: tokenResponse.status,
        error,
      });
      return res
        .status(500)
        .json({ error: "Failed to get registration token" });
    }

    const tokenData = (await tokenResponse.json()) as {
      token?: string;
    };
    const runnerToken = tokenData.token;

    if (!runnerToken) {
      logger.error("No token in GitHub response", { tokenData });
      return res
        .status(500)
        .json({ error: "No token in response" });
    }

    // Start ECS task
    const runner = getECSTaskRunner();
    const result = await runner.runGitHubRunnerTask(runnerToken);

    logger.info("GitHub runner started", {
      taskArn: result.taskArn,
      jobId: job?.id,
    });

    res.status(200).json({
      status: "started",
      taskId: result.taskId,
      taskArn: result.taskArn,
    });
  } catch (error) {
    logger.error("Error handling GitHub runner webhook", { error });
    res.status(500).json({ error: "Failed to start runner" });
  }
});

export default router;

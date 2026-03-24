/**
 * Shared helpers and constants for board routes.
 */

import crypto from "crypto";
import multer from "multer";
import { AppDataSource } from "../../db/connection.js";
import {
  KbBoard,
  KbCard,
  KbCardAttachment,
  KbActivity,
  Organization,
  User,
  WorkerTask,
  PLAN_FEATURES,
} from "../../models/index.js";
import type { OrganizationPlan } from "../../models/Organization.js";
import { RemoteAgent } from "../../models/RemoteAgent.js";
import type { WorkerPersona } from "../../models/WorkerTask.js";
import { syncKbCardColumn } from "../../services/task-monitor.js";
import type { PreComputedStory } from "../../services/prd-decomposer.js";
import { resetCancelledTask } from "../tasks/lifecycle.js";
import { canCreateTask } from "../../services/billing.js";
import { logger } from "../../utils/logger.js";

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB — matches Jira default
});

// =============================================================================
// Helper: Derive board prefix from name
// =============================================================================

/**
 * Derive a short prefix from a board name for issue keys.
 * "CalMill" → "CM", "TaskPulse Dashboard" → "TPD", "Bugs" → "BUG"
 */
export function derivePrefix(name: string): string {
  const words = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[\s\-\u2013\u2014_]+/)  // split on spaces, hyphens, en/em dashes, underscores
    .filter((w) => /[A-Za-z0-9]/.test(w));  // drop non-alphanumeric tokens

  if (words.length >= 2) {
    return words
      .slice(0, 5)
      .map((w) => w[0])
      .join("")
      .replace(/[^A-Z0-9]/gi, "")  // strip any remaining non-alphanumeric
      .toUpperCase();
  }

  const word = words[0] || "BD";
  if (word.length <= 3) return word.toUpperCase();
  return word.substring(0, 3).toUpperCase();
}

/**
 * Generate a unique prefix for a board within an org.
 * Appends incrementing digits on collision.
 */
export async function generateUniquePrefix(
  boardRepo: import("typeorm").Repository<KbBoard>,
  orgId: string,
  name: string,
  preferredPrefix?: string,
): Promise<string> {
  let prefix =
    preferredPrefix
      ?.toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 10) || derivePrefix(name);

  const existing = await boardRepo
    .createQueryBuilder("b")
    .where("b.orgId = :orgId", { orgId })
    .select("b.prefix")
    .getMany();
  const usedPrefixes = new Set(existing.map((b) => b.prefix));

  if (!usedPrefixes.has(prefix)) return prefix;

  let attempt = 2;
  const base = prefix;
  while (usedPrefixes.has(prefix)) {
    prefix = `${base}${attempt}`;
    attempt++;
  }
  return prefix;
}

// =============================================================================
// Helper: Log activity
// =============================================================================

export async function logActivity(
  boardId: string,
  userId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const repo = AppDataSource.getRepository(KbActivity);
    await repo.save(
      repo.create({ boardId, userId, action, entityType, entityId, metadata: metadata || null })
    );
  } catch {
    // Activity logging is best-effort
  }
}

// =============================================================================
// Helper: Extract pre-computed stories from card description
// =============================================================================

export function extractPreComputedStories(
  description: string | null,
): { preComputedStories: PreComputedStory[] } | Record<string, never> {
  if (!description) return {};
  const match = description.match(
    /<!-- PRECOMPUTED_STORIES_JSON\n([\s\S]*?)\nEND_PRECOMPUTED_STORIES -->/,
  );
  if (!match) return {};
  try {
    const stories = JSON.parse(match[1]) as PreComputedStory[];
    if (Array.isArray(stories) && stories.length > 0) {
      return { preComputedStories: stories };
    }
  } catch {
    // Malformed JSON — skip silently
  }
  return {};
}

// =============================================================================
// Helper: Run a card as a WorkerTask
// =============================================================================

export async function runCardAsWorkerTask(
  cardId: string,
  orgId: string,
  boardExecutionId?: string,
): Promise<WorkerTask> {
  const cardRepo = AppDataSource.getRepository(KbCard);
  const orgRepo = AppDataSource.getRepository(Organization);
  const workerTaskRepo = AppDataSource.getRepository(WorkerTask);

  const card = await cardRepo.findOne({
    where: { id: cardId },
    relations: ["cardLabels", "cardLabels.label", "board"],
  });
  if (!card) throw new Error("Card not found");

  // Check no active worker task already linked
  if (card.workerTaskId) {
    const existing = await workerTaskRepo.findOne({ where: { id: card.workerTaskId } });
    if (existing && existing.status === "cancelled") {
      await resetCancelledTask(existing);
      syncKbCardColumn(existing.id, (existing.status as string) === "planning" ? "planning" : "claimed").catch(() => {});
      return existing;
    }
    if (existing && !["completed", "deployed", "failed", "review_rejected"].includes(existing.status)) {
      throw new Error("Card already has an active worker task");
    }
  }

  const org = await orgRepo.findOne({ where: { id: orgId } });
  if (!org) throw new Error("Organization not found");

  // Check billing/trial status before creating task
  const billingCheck = await canCreateTask(org);
  if (!billingCheck.allowed) {
    throw new Error(billingCheck.reason || "Billing check failed");
  }

  // Parse card labels for workflow flags (same logic as projects.ts assign)
  const labelNames = (card.cardLabels || []).map((cl) => cl.label?.name?.toLowerCase() || "");

  const hasReviewLabel = labelNames.includes("review");
  const hasDeployLabel = labelNames.includes("deploy");
  const managerEnabled = labelNames.includes("manager");
  const skipManagerReview = !hasReviewLabel && !org.autoReviewEnabled;
  const deploymentEnabled = hasDeployLabel || (org.autoDeployEnabled ?? false);
  const hasImproveLabel = labelNames.includes("improve");
  const improvementEnabled = hasImproveLabel || (org.autoImproveEnabled ?? false);
  const qualityGateBypass = labelNames.includes("bypass-quality-gate") || labelNames.includes("force-merge");
  const hasSdkLabel = labelNames.includes("sdk");
  const standardSdkMode = hasSdkLabel;
  const hasCriticLabel = labelNames.includes("critic");

  // Pipeline / execution mode detection
  const hasStandardLabel = labelNames.includes("standard") || labelNames.includes("v1");
  const isMultiProvider = labelNames.includes("multi-provider");
  const isV2Pipeline = !hasStandardLabel;

  const hasRoutingOverrides = org.providerRouting &&
    Object.keys(org.providerRouting as Record<string, unknown>).length > 0;

  // Provider selection
  let workerProvider = org.primaryProvider || "anthropic";
  const providerLabels = ["anthropic", "openai", "google", "gemini", "ollama"];
  const providerLabel = labelNames.find((l) => providerLabels.includes(l));
  if (providerLabel) {
    workerProvider = providerLabel === "gemini" ? "google" : providerLabel;
  }

  const canUseEpicMode = workerProvider === "anthropic" && !hasRoutingOverrides;

  let executionMode: "single" | "sequential" | "parallel" | "multi-expert" = "single";
  let pipelineVersion: "v1" | "v2" | null = null;

  if (isV2Pipeline && canUseEpicMode) {
    executionMode = "parallel";
    pipelineVersion = "v2";
  } else if (isV2Pipeline || isMultiProvider) {
    executionMode = "multi-expert";
    pipelineVersion = "v2";
  }

  const needsPlanning = isV2Pipeline || isMultiProvider;
  const initialStatus = needsPlanning ? "planning" : "queued";

  // Model selection from labels
  let workerModel: string;
  if (labelNames.includes("opus")) {
    workerModel = "claude-opus-4-6";
  } else if (labelNames.includes("sonnet")) {
    workerModel = "claude-sonnet-4-6";
  } else if (labelNames.includes("haiku")) {
    workerModel = "claude-haiku-4-5-20251001";
  } else {
    workerModel = org.defaultWorkerModel || "";
  }

  // Persona
  const basePersona = (org.defaultWorkerPersona || "backend_developer") as WorkerPersona;
  const workerPersona = needsPlanning ? "project_manager" : basePersona;

  // Repo (card-level override takes precedence over org default)
  const githubRepo = card.githubRepo || org.getDefaultRepo();
  if (!githubRepo) {
    throw new Error("No repository configured for organization");
  }

  // Pre-flight: Verify the org has a way to execute tasks
  const planFeats = PLAN_FEATURES[(org.plan as OrganizationPlan)] ?? PLAN_FEATURES.pro;
  if (!planFeats.cloudExecution) {
    // Pro tier can only execute via remote agent — check if one is registered
    const agentRepo = AppDataSource.getRepository(RemoteAgent);
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const onlineAgent = await agentRepo
      .createQueryBuilder("agent")
      .where("agent.orgId = :orgId", { orgId: org.id })
      .andWhere("agent.lastHeartbeatAt > :cutoff", { cutoff: twoMinutesAgo })
      .getOne();
    if (!onlineAgent) {
      const anyAgent = await agentRepo.findOne({ where: { orgId: org.id } });
      if (!anyAgent) {
        throw new Error("No remote agent installed. Install the WorkerMill agent to run tasks: https://workermill.com/docs/remote-agent");
      } else {
        throw new Error("Remote agent is offline. Start the agent with 'workermill-agent start' to run tasks.");
      }
    }
  }

  // Fetch attachments for the card
  const attachmentRepo = AppDataSource.getRepository(KbCardAttachment);
  const attachments = await attachmentRepo.find({
    where: { cardId: card.id },
    order: { createdAt: "ASC" },
  });

  // Build card description for worker — include full PRD if available
  let description = [
    card.title,
    card.description || "",
    card.board?.prdContent
      ? `\n---\n\n## Full Build Specification\n\nThe following is the complete specification document. Your card description above defines your SCOPE — use this specification for exact technical details (API response shapes, field names, data structures, route parameters, UI component specs).\n\n${card.board.prdContent}`
      : "",
  ].filter(Boolean).join("\n\n");

  // Append attachments to description
  if (attachments.length > 0) {
    const attachmentLines: string[] = ["\n---\n\n## Attachments\n"];
    for (const att of attachments) {
      if (att.contentType.startsWith("image/")) {
        // Inline base64 for images — Claude CLI reads these natively
        const b64 = att.data.toString("base64");
        attachmentLines.push(`### ${att.filename}\n\n![${att.filename}](data:${att.contentType};base64,${b64})\n`);
      } else {
        // Non-images: include filename and size for context
        attachmentLines.push(`### ${att.filename}\n\nAttached file: ${att.filename} (${(att.sizeBytes / 1024).toFixed(1)} KB, ${att.contentType})\n`);
      }
    }
    description += attachmentLines.join("\n");
  }

  // Foundation card (position 0) creates the project from scratch — its stories
  // build incrementally and can't pass full-project quality gates (e.g. npm run build
  // fails on intermediate TypeScript errors). We still pass quality gate commands so
  // the Tech Lead reviewer can run them, but the integration fixer skips execution.
  const isFoundationCard = card.position === 0;

  // Use external ticket key if synced, otherwise internal board prefix
  const internalKey = card.board?.prefix && card.cardNumber
    ? `${card.board.prefix}-${card.cardNumber}`
    : `${card.board?.name?.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "BOARD"}-${card.id.slice(0, 8)}`;
  const issueKey = card.ticketKey || internalKey;

  // Resolve ticket system from org's issue tracker provider
  const trackerProvider = org.issueTrackerProvider || "internal";
  const ticketSystem = trackerProvider === "github-issues" ? "github" : trackerProvider;

  // Create WorkerTask
  const workerTask = workerTaskRepo.create({
    orgId: org.id,
    jiraIssueKey: issueKey,
    jiraIssueId: null,
    summary: card.title,
    description,
    workerPersona,
    workerModel,
    workerProvider,
    scmProvider: org.scmProvider || "github",
    githubRepo,
    status: initialStatus,
    priority: 3,
    maxRetries: org.defaultMaxRetries || 3,
    deploymentEnabled,
    skipManagerReview,
    improvementEnabled,
    qualityGateBypass,
    managerEnabled,
    standardSdkMode,
    pipelineVersion,
    executionMode,
    criticEnabled: hasCriticLabel,
    ticketSystem,
    boardExecutionId: boardExecutionId || null,
    jiraFields: {
      ...(card.board?.prdContent ? { buildPage: true } : {}),
      ...(card.board?.qualityGateCommands ? { qualityGates: card.board.qualityGateCommands } : {}),
      ...(isFoundationCard ? { isFoundationCard: true } : {}),
      ...(card.board?.ciWorkflowPath ? { ciWorkflowPath: card.board.ciWorkflowPath } : {}),
      ...extractPreComputedStories(card.description),
    },
  });

  await workerTaskRepo.save(workerTask);

  // Link card to worker task
  await cardRepo.update(card.id, { workerTaskId: workerTask.id });

  // Move card to "In Progress" column
  syncKbCardColumn(workerTask.id, initialStatus === "planning" ? "planning" : "claimed").catch(() => {});

  logger.info("Created WorkerTask from board card", {
    cardId: card.id,
    workerTaskId: workerTask.id,
    status: initialStatus,
  });

  return workerTask;
}

// Default columns for new boards (matches worker task lifecycle)
export const DEFAULT_BOARD_COLUMNS = [
  { name: "To Do", position: 0, color: "#6b7280" },
  { name: "In Progress", position: 1, color: "#f59e0b" },
  { name: "Review", position: 2, color: "#8b5cf6" },
  { name: "Approved", position: 3, color: "#3b82f6" },
  { name: "Deployed", position: 4, color: "#10b981" },
];

export const TEMPLATE_COLUMNS: Record<string, Array<{ name: string; position: number; color: string; wipLimit?: number }>> = {
  sprint: [
    { name: "To Do", position: 0, color: "#6b7280" },
    { name: "In Progress", position: 1, color: "#f59e0b", wipLimit: 3 },
    { name: "Review", position: 2, color: "#8b5cf6", wipLimit: 2 },
    { name: "Approved", position: 3, color: "#3b82f6", wipLimit: 2 },
    { name: "Deployed", position: 4, color: "#10b981" },
  ],
  bugs: [
    { name: "New", position: 0, color: "#ef4444" },
    { name: "Triaging", position: 1, color: "#f59e0b" },
    { name: "In Fix", position: 2, color: "#3b82f6" },
    { name: "Testing", position: 3, color: "#8b5cf6" },
    { name: "Resolved", position: 4, color: "#10b981" },
  ],
};

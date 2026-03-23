/**
 * Marketing Agent Executor Service
 *
 * Runs marketing agent missions in-process (no ECS) for autonomous marketing operations.
 * Builds context from active campaigns, recent content, and budget status, then uses
 * Claude to propose actions. Each action passes through guardrails before auto-execution
 * or escalation to pending_review.
 *
 * Security & Quality:
 * - Budget pause threshold prevents overspend (default 90% of monthly budget)
 * - Guardrails gate every action type (publish, bid_adjust, pause, resume, create_campaign)
 * - Articles and new campaigns always escalate for human review
 * - All actions logged to MarketingAction for audit trail
 * - Errors never crash the caller
 */

import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { MoreThanOrEqual } from "typeorm";
import { AppDataSource } from "../db/connection.js";
import {
  Organization,
  MarketingCampaign,
  MarketingContent,
  MarketingAction,
  Persona,
  PersonaDirective,
} from "../models/index.js";
import type { MarketingActionType } from "../models/MarketingAction.js";
import type { ContentType } from "../models/MarketingContent.js";
import type { MarketingChannel } from "./marketing-channels/base-channel.js";
import { GoogleAdsChannel } from "./marketing-channels/google-ads-channel.js";
import { logger } from "../utils/logger.js";
import { getProviderCredentials } from "../config/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MissionResult {
  success: boolean;
  missionRunId: string;
  actionsExecuted: number;
  actionsEscalated: number;
  error?: string;
}

interface MissionContext {
  activeCampaigns: MarketingCampaign[];
  recentContent: MarketingContent[];
  pendingReviews: MarketingContent[];
  budgetTotalSpentCents: number;
  monthlyBudgetCents: number;
}

interface ProposedAction {
  actionType: MarketingActionType;
  platform?: string;
  description: string;
  details: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Execute a marketing agent mission for an organization.
 *
 * Builds context, calls Claude for proposed actions, applies guardrails,
 * and auto-executes or escalates each action.
 */
export async function executeMarketingAgentMission(
  org: Organization,
): Promise<MissionResult> {
  const missionRunId = randomUUID();
  const actionRepo = AppDataSource.getRepository(MarketingAction);
  const campaignRepo = AppDataSource.getRepository(MarketingCampaign);
  const contentRepo = AppDataSource.getRepository(MarketingContent);

  let actionsExecuted = 0;
  let actionsEscalated = 0;

  const logAction = async (
    action: ProposedAction,
    autoExecuted: boolean,
  ): Promise<void> => {
    try {
      const record = actionRepo.create({
        orgId: org.id,
        missionRunId,
        actionType: action.actionType,
        platform: action.platform ?? null,
        description: action.description,
        details: action.details,
        autoExecuted,
      });
      await actionRepo.save(record);
    } catch (err) {
      logger.error("[MarketingAgent] Failed to log action", {
        missionRunId,
        error: err,
      });
    }
  };

  try {
    logger.info("[MarketingAgent] Starting mission", {
      missionRunId,
      orgId: org.id,
    });

    // 1. Build context
    const context = await buildMissionContext(org);

    // 2. Budget pause check — skip mission if spend exceeds threshold %
    const budgetPauseThresholdPct =
      (org.marketingAgentConfig as Record<string, unknown>)
        ?.budgetPauseThresholdPct ?? 90;
    if (
      context.monthlyBudgetCents > 0 &&
      context.budgetTotalSpentCents >=
        context.monthlyBudgetCents * (Number(budgetPauseThresholdPct) / 100)
    ) {
      logger.info("[MarketingAgent] Budget pause threshold exceeded, skipping", {
        missionRunId,
        spentCents: context.budgetTotalSpentCents,
        budgetCents: context.monthlyBudgetCents,
        thresholdPct: budgetPauseThresholdPct,
      });
      return {
        success: true,
        missionRunId,
        actionsExecuted: 0,
        actionsEscalated: 0,
      };
    }

    // 3. Resolve AI model
    const routing = org.providerRouting as Record<
      string,
      { provider: string; model?: string }
    >;
    const model =
      routing?.marketing_agent?.model || org.defaultWorkerModel;

    // 4. Get Anthropic API key
    const anthropicApiKey = await getProviderCredentials(org.id, "anthropic");
    if (!anthropicApiKey) {
      throw new Error("Anthropic API key not configured for org");
    }

    // 5. Build system prompt (includes persona directive)
    const systemPrompt = await buildSystemPrompt(org, context);

    // 6. Call Claude
    logger.info("[MarketingAgent] Calling Claude", { missionRunId, model });
    const anthropic = new Anthropic({ apiKey: anthropicApiKey });
    const message = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      messages: [{ role: "user", content: systemPrompt }],
    });

    const responseText = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    // 7. Parse proposed actions
    const proposedActions = parseProposedActions(responseText);
    logger.info("[MarketingAgent] Parsed actions", {
      missionRunId,
      count: proposedActions.length,
    });

    // 8. Build channel adapters
    const channelMap = buildChannelMap(org);

    // 9. Process each action through guardrails
    for (const action of proposedActions) {
      try {
        const autoExecute = checkGuardrails(action, org);
        if (autoExecute) {
          await executeAction(
            action,
            channelMap,
            contentRepo,
            campaignRepo,
            org,
          );
          await logAction(action, true);
          actionsExecuted++;
        } else {
          await escalateAction(action, contentRepo, campaignRepo, org);
          await logAction(action, false);
          actionsEscalated++;
        }
      } catch (actionErr) {
        logger.error("[MarketingAgent] Action failed", {
          missionRunId,
          action: action.actionType,
          error: actionErr,
        });
        // Log failed action as error — never crash the mission loop
        await logAction(
          {
            ...action,
            description: `FAILED: ${action.description} — ${actionErr instanceof Error ? actionErr.message : String(actionErr)}`,
          },
          false,
        );
      }
    }

    // 10. Refresh campaign metrics from channels
    await refreshCampaignMetrics(channelMap, campaignRepo, org.id);

    // 11. Log summary
    logger.info("[MarketingAgent] Mission complete", {
      missionRunId,
      orgId: org.id,
      actionsExecuted,
      actionsEscalated,
      totalProposed: proposedActions.length,
    });

    return { success: true, missionRunId, actionsExecuted, actionsEscalated };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    logger.error("[MarketingAgent] Mission failed", {
      missionRunId,
      orgId: org.id,
      error: errorMessage,
    });

    // Log the mission-level failure as an action for audit trail
    try {
      const record = actionRepo.create({
        orgId: org.id,
        missionRunId,
        actionType: "report",
        platform: null,
        description: `Mission failed: ${errorMessage}`,
        details: { error: errorMessage },
        autoExecuted: false,
      });
      await actionRepo.save(record);
    } catch (err) {
      console.error("[marketing-agent] action record save failed:", err instanceof Error ? err.message : err);
    }

    return {
      success: false,
      missionRunId,
      actionsExecuted,
      actionsEscalated,
      error: errorMessage,
    };
  }
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

/**
 * Fetch active campaigns, recent content, pending reviews, and budget totals.
 */
async function buildMissionContext(
  org: Organization,
): Promise<MissionContext> {
  const campaignRepo = AppDataSource.getRepository(MarketingCampaign);
  const contentRepo = AppDataSource.getRepository(MarketingContent);

  const activeCampaigns = await campaignRepo.find({
    where: { orgId: org.id, status: "active" },
    order: { updatedAt: "DESC" },
  });

  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const recentContent = await contentRepo.find({
    where: {
      orgId: org.id,
      createdAt: MoreThanOrEqual(fortyEightHoursAgo),
    },
    order: { createdAt: "DESC" },
  });

  const pendingReviews = await contentRepo.find({
    where: { orgId: org.id, status: "pending_review" },
    order: { createdAt: "ASC" },
  });

  // Sum total spent across all campaigns for this month
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const allCampaigns = await campaignRepo.find({
    where: {
      orgId: org.id,
      createdAt: MoreThanOrEqual(monthStart),
    },
  });
  // Also include active campaigns that pre-date this month but are still spending
  const allActive = await campaignRepo.find({
    where: { orgId: org.id, status: "active" },
  });
  const campaignSet = new Map<string, MarketingCampaign>();
  for (const c of [...allCampaigns, ...allActive]) {
    campaignSet.set(c.id, c);
  }
  const budgetTotalSpentCents = Array.from(campaignSet.values()).reduce(
    (sum, c) => sum + c.spentCents,
    0,
  );

  return {
    activeCampaigns,
    recentContent,
    pendingReviews,
    budgetTotalSpentCents,
    monthlyBudgetCents: org.marketingMonthlyBudgetCents,
  };
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the full system prompt combining persona directive, org config,
 * context data, and action instructions.
 */
async function buildSystemPrompt(
  org: Organization,
  context: MissionContext,
): Promise<string> {
  // Load persona directive from Persona Studio
  let personaDirectiveText = "";
  try {
    const personaRepo = AppDataSource.getRepository(Persona);
    const directiveRepo = AppDataSource.getRepository(PersonaDirective);

    // Try org-specific first, fall back to system persona
    let persona = await personaRepo.findOne({
      where: { slug: "marketing_agent", orgId: org.id },
    });
    if (!persona) {
      persona = await personaRepo.findOne({
        where: { slug: "marketing_agent", isSystem: true },
      });
    }

    if (persona) {
      const directive = await directiveRepo.findOne({
        where: {
          personaId: persona.id,
          type: "readme",
          isActive: true,
        },
      });
      if (directive) {
        personaDirectiveText = directive.content;
      }
    }
  } catch (err) {
    logger.warn("[MarketingAgent] Failed to load persona directive", {
      error: err,
    });
  }

  const agentConfig = org.marketingAgentConfig as Record<string, unknown>;
  const voiceTone = (agentConfig?.voiceTone as string) || "";
  const brandKeywords = (agentConfig?.brandKeywords as string[]) || [];

  // Budget summary
  const budgetPct =
    context.monthlyBudgetCents > 0
      ? Math.round(
          (context.budgetTotalSpentCents / context.monthlyBudgetCents) * 100,
        )
      : 0;
  const budgetSummary =
    context.monthlyBudgetCents > 0
      ? `$${(context.budgetTotalSpentCents / 100).toFixed(2)} / $${(context.monthlyBudgetCents / 100).toFixed(2)} (${budgetPct}% used)`
      : "No monthly budget set";

  // Campaign summaries
  const campaignSummaries = context.activeCampaigns
    .map((c) => {
      const ctr = c.impressions > 0 ? ((c.clicks / c.impressions) * 100).toFixed(2) : "0.00";
      return `- [${c.platform}] ${c.name}: ${c.impressions} impressions, ${c.clicks} clicks (${ctr}% CTR), ${c.conversions} conversions, $${(c.spentCents / 100).toFixed(2)} spent`;
    })
    .join("\n");

  // Recent content summaries
  const recentSummaries = context.recentContent
    .slice(0, 10)
    .map(
      (c) =>
        `- [${c.platform}/${c.contentType}] ${c.title || c.body.slice(0, 60)} — status: ${c.status}`,
    )
    .join("\n");

  // Pending review summaries
  const pendingSummaries = context.pendingReviews
    .map(
      (c) =>
        `- [${c.platform}/${c.contentType}] ${c.title || c.body.slice(0, 60)}`,
    )
    .join("\n");

  const sections: string[] = [];

  // Persona directive
  if (personaDirectiveText) {
    sections.push(`## Persona Directive\n${personaDirectiveText}`);
  }

  // Voice/tone
  if (voiceTone) {
    sections.push(`## Voice & Tone\n${voiceTone}`);
  }

  // Brand keywords
  if (brandKeywords.length > 0) {
    sections.push(`## Brand Keywords\n${brandKeywords.join(", ")}`);
  }

  // Budget
  sections.push(`## Budget Status\n${budgetSummary}`);

  // Campaigns
  sections.push(
    `## Active Campaigns (${context.activeCampaigns.length})\n${campaignSummaries || "No active campaigns."}`,
  );

  // Recent content
  sections.push(
    `## Recent Content (last 48h)\n${recentSummaries || "No recent content."}`,
  );

  // Pending reviews
  sections.push(
    `## Pending Reviews (${context.pendingReviews.length})\n${pendingSummaries || "No pending reviews."}`,
  );

  // Instructions
  sections.push(`## Instructions

You are a marketing agent for this organization. Analyze the current state of campaigns, content, and budget. Then propose a JSON array of actions to take.

Each action must be an object with these fields:
- "actionType": one of "publish", "bid_adjust", "pause", "resume", "create_campaign", "report"
- "platform": the target platform (e.g., "google_ads", "x", "reddit", "devto", "blog", "hackernews")
- "description": a short human-readable description of what the action does
- "details": an object with action-specific data:
  - For "publish": { "contentType": "tweet"|"post"|"article"|"ad_copy", "title"?: string, "body": string, "campaignId"?: string }
  - For "bid_adjust": { "campaignId": string, "currentBidCents": number, "newBidCents": number, "reason": string }
  - For "pause": { "campaignId": string, "reason": string }
  - For "resume": { "campaignId": string, "reason": string }
  - For "create_campaign": { "name": string, "platform": string, "budgetCents": number, "targetingConfig": object }
  - For "report": { "summary": string }

If no actions are needed, return an empty array.

Respond ONLY with the JSON array. Do not include any other text outside the JSON.`);

  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

/**
 * Parse proposed actions from the Claude response text.
 * Handles both fenced ```json blocks and raw JSON arrays.
 */
export function parseProposedActions(responseText: string): ProposedAction[] {
  // Try to extract from ```json block first
  const jsonBlockMatch = responseText.match(
    /```(?:json)?\s*\n?([\s\S]*?)```/,
  );
  const jsonStr = jsonBlockMatch ? jsonBlockMatch[1].trim() : responseText.trim();

  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) {
      logger.warn("[MarketingAgent] Parsed response is not an array");
      return [];
    }
    // Validate each action has the required fields
    return parsed.filter(
      (item: unknown): item is ProposedAction =>
        typeof item === "object" &&
        item !== null &&
        "actionType" in item &&
        "description" in item &&
        typeof (item as Record<string, unknown>).actionType === "string" &&
        typeof (item as Record<string, unknown>).description === "string",
    );
  } catch {
    logger.warn("[MarketingAgent] Failed to parse actions from response", {
      responseSnippet: responseText.slice(0, 200),
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Guardrails
// ---------------------------------------------------------------------------

/**
 * Check guardrails for a proposed action.
 * Returns true if the action can be auto-executed, false if it must be escalated.
 */
export function checkGuardrails(
  action: ProposedAction,
  org: Organization,
): boolean {
  const agentConfig = org.marketingAgentConfig as Record<string, unknown>;

  switch (action.actionType) {
    case "publish": {
      // Articles always require human review
      const contentType = (action.details?.contentType as ContentType) || "post";
      if (contentType === "article") {
        return false;
      }
      // Auto-publish routine content unless config disables it
      return agentConfig?.autoPublishRoutineContent !== false;
    }

    case "bid_adjust": {
      // Check if auto-adjust is disabled
      if (agentConfig?.autoAdjustBids === false) {
        return false;
      }
      // Check change percentage against threshold
      const currentBid = Number(action.details?.currentBidCents) || 0;
      const newBid = Number(action.details?.newBidCents) || 0;
      if (currentBid <= 0) {
        return false; // Cannot calculate %, escalate
      }
      const changePct = Math.abs((newBid - currentBid) / currentBid) * 100;
      const maxPct = Number(agentConfig?.maxBidAdjustmentPct) || 15;
      return changePct <= maxPct;
    }

    case "pause": {
      // Auto-pause underperformers unless config disables it
      return agentConfig?.autoPauseUnderperformers !== false;
    }

    case "resume": {
      // Always auto-execute — low risk
      return true;
    }

    case "create_campaign": {
      // Always escalate — requires human approval
      return false;
    }

    case "report": {
      // Reports are informational, always auto
      return true;
    }

    default: {
      // Unknown action types always escalate
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Action execution
// ---------------------------------------------------------------------------

/**
 * Execute an auto-approved action via the appropriate channel adapter.
 */
async function executeAction(
  action: ProposedAction,
  channelMap: Map<string, MarketingChannel>,
  contentRepo: ReturnType<typeof AppDataSource.getRepository<MarketingContent>>,
  campaignRepo: ReturnType<
    typeof AppDataSource.getRepository<MarketingCampaign>
  >,
  org: Organization,
): Promise<void> {
  switch (action.actionType) {
    case "publish": {
      const details = action.details || {};
      const platform = action.platform || "blog";

      // Create content record
      const content = contentRepo.create({
        orgId: org.id,
        campaignId: (details.campaignId as string) || null,
        platform: platform as MarketingContent["platform"],
        contentType: (details.contentType as ContentType) || "post",
        title: (details.title as string) || null,
        body: (details.body as string) || action.description,
        status: "published",
        publishedAt: new Date(),
      });
      await contentRepo.save(content);

      // Try to publish via channel adapter
      const channel = channelMap.get(platform);
      if (channel) {
        try {
          const result = await channel.publish(content);
          // Atomic update with externalId
          await contentRepo.update(
            { id: content.id },
            { externalId: result.externalId },
          );
        } catch (channelErr) {
          logger.warn(
            "[MarketingAgent] Channel publish failed, content saved as draft",
            { platform, error: channelErr },
          );
          // Revert to draft if channel publish fails
          await contentRepo.update({ id: content.id }, { status: "draft" });
        }
      }
      break;
    }

    case "bid_adjust": {
      const campaignId = action.details?.campaignId as string;
      const newBidCents = Number(action.details?.newBidCents) || 0;
      if (!campaignId) break;

      const campaign = await campaignRepo.findOne({
        where: { id: campaignId, orgId: org.id },
      });
      if (!campaign || !campaign.externalId) break;

      const channel = channelMap.get(campaign.platform);
      if (channel) {
        await channel.adjustBid(campaign.externalId, newBidCents);
      }
      break;
    }

    case "pause": {
      const campaignId = action.details?.campaignId as string;
      if (!campaignId) break;

      const campaign = await campaignRepo.findOne({
        where: { id: campaignId, orgId: org.id, status: "active" },
      });
      if (!campaign || !campaign.externalId) break;

      const channel = channelMap.get(campaign.platform);
      if (channel) {
        await channel.pauseCampaign(campaign.externalId);
      }
      // Atomic update — only pause if still active
      await campaignRepo.update(
        { id: campaignId, orgId: org.id, status: "active" },
        { status: "paused" },
      );
      break;
    }

    case "resume": {
      const campaignId = action.details?.campaignId as string;
      if (!campaignId) break;

      const campaign = await campaignRepo.findOne({
        where: { id: campaignId, orgId: org.id, status: "paused" },
      });
      if (!campaign || !campaign.externalId) break;

      const channel = channelMap.get(campaign.platform);
      if (channel) {
        await channel.resumeCampaign(campaign.externalId);
      }
      // Atomic update — only resume if still paused
      await campaignRepo.update(
        { id: campaignId, orgId: org.id, status: "paused" },
        { status: "active" },
      );
      break;
    }

    case "report": {
      // Reports are informational — already logged via logAction
      break;
    }

    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Escalation
// ---------------------------------------------------------------------------

/**
 * Escalate an action that failed guardrails by creating pending_review records.
 */
async function escalateAction(
  action: ProposedAction,
  contentRepo: ReturnType<typeof AppDataSource.getRepository<MarketingContent>>,
  campaignRepo: ReturnType<
    typeof AppDataSource.getRepository<MarketingCampaign>
  >,
  org: Organization,
): Promise<void> {
  switch (action.actionType) {
    case "publish": {
      const details = action.details || {};
      const platform = action.platform || "blog";

      const content = contentRepo.create({
        orgId: org.id,
        campaignId: (details.campaignId as string) || null,
        platform: platform as MarketingContent["platform"],
        contentType: (details.contentType as ContentType) || "post",
        title: (details.title as string) || null,
        body: (details.body as string) || action.description,
        status: "pending_review",
      });
      await contentRepo.save(content);
      break;
    }

    case "create_campaign": {
      const details = action.details || {};
      const platform =
        (details.platform as string) || action.platform || "google_ads";

      const campaign = campaignRepo.create({
        orgId: org.id,
        platform: platform as MarketingCampaign["platform"],
        name: (details.name as string) || action.description,
        status: "pending_review",
        budgetCents: Number(details.budgetCents) || 0,
        targetingConfig:
          (details.targetingConfig as Record<string, unknown>) || {},
      });
      await campaignRepo.save(campaign);
      break;
    }

    case "bid_adjust":
    case "pause": {
      // For bid adjustments and pauses that exceed guardrails,
      // log them as escalated actions (already handled by logAction).
      // The dashboard pending review UI surfaces MarketingAction records
      // with autoExecuted=false for operator review.
      break;
    }

    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Metrics refresh
// ---------------------------------------------------------------------------

/**
 * Pull latest metrics from channel adapters for all active campaigns.
 */
async function refreshCampaignMetrics(
  channelMap: Map<string, MarketingChannel>,
  campaignRepo: ReturnType<
    typeof AppDataSource.getRepository<MarketingCampaign>
  >,
  orgId: string,
): Promise<void> {
  const activeCampaigns = await campaignRepo.find({
    where: { orgId, status: "active" },
  });

  for (const campaign of activeCampaigns) {
    if (!campaign.externalId) continue;

    const channel = channelMap.get(campaign.platform);
    if (!channel) continue;

    try {
      const metrics = await channel.fetchMetrics(campaign.externalId);
      // Atomic update — avoid clobbering concurrent changes
      await campaignRepo.update(
        { id: campaign.id },
        {
          impressions: metrics.impressions,
          clicks: metrics.clicks,
          conversions: metrics.conversions,
          spentCents: metrics.spentCents,
        },
      );
    } catch (err) {
      logger.warn("[MarketingAgent] Failed to refresh metrics", {
        campaignId: campaign.id,
        platform: campaign.platform,
        error: err,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a map of platform -> MarketingChannel adapter from org credentials.
 */
function buildChannelMap(
  org: Organization,
): Map<string, MarketingChannel> {
  const channelMap = new Map<string, MarketingChannel>();
  const credentials = org.marketingChannelCredentials as Record<
    string,
    Record<string, unknown>
  >;

  if (!credentials || typeof credentials !== "object") {
    return channelMap;
  }

  // Register available channel adapters
  if (credentials.google_ads) {
    channelMap.set("google_ads", new GoogleAdsChannel(credentials.google_ads));
  }

  // Additional channel adapters would be registered here as they're implemented:
  // if (credentials.x) channelMap.set("x", new XChannel(credentials.x));
  // if (credentials.reddit) channelMap.set("reddit", new RedditChannel(credentials.reddit));
  // if (credentials.devto) channelMap.set("devto", new DevToChannel(credentials.devto));

  return channelMap;
}

# Marketing Agent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a marketing agent that runs on a cron schedule within the orchestrator, manages ad campaigns across developer-focused platforms, auto-publishes routine content, and surfaces everything on the platform management dashboard.

**Architecture:** New `marketing_agent` persona (platform org only, managed via Persona Studio) with an in-process executor following the `support-agent-executor.ts` pattern. Cron timer in the orchestrator poll loop triggers missions on a configurable interval. Three new DB models (Campaign, Content, Action), modular channel adapters per ad platform, and a new Marketing tab on the platform dashboard.

**Tech Stack:** TypeORM entities, Express routes, Anthropic SDK, React + TailwindCSS dashboard components.

**Design doc:** `docs/plans/2026-02-22-marketing-agent-design.md`

---

### Task 1: Migration — New Tables + Org Columns

**Files:**
- Create: `api/src/db/migrations/1740400000000-AddMarketingAgent.ts`
- Modify: `api/src/db/connection.ts:518` (add migration to array)

**Step 1: Create migration file**

```typescript
// api/src/db/migrations/1740400000000-AddMarketingAgent.ts
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMarketingAgent1740400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Marketing Campaigns
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS marketing_campaigns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        platform VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending_review',
        budget_cents INT NOT NULL DEFAULT 0,
        spent_cents INT NOT NULL DEFAULT 0,
        impressions INT NOT NULL DEFAULT 0,
        clicks INT NOT NULL DEFAULT 0,
        conversions INT NOT NULL DEFAULT 0,
        targeting_config JSONB NOT NULL DEFAULT '{}',
        external_id VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_org_id ON marketing_campaigns(org_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_status ON marketing_campaigns(status)`);

    // Marketing Content
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS marketing_content (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        campaign_id UUID REFERENCES marketing_campaigns(id) ON DELETE SET NULL,
        platform VARCHAR(50) NOT NULL,
        content_type VARCHAR(50) NOT NULL,
        title VARCHAR(500),
        body TEXT NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'draft',
        published_at TIMESTAMP WITH TIME ZONE,
        engagement_metrics JSONB NOT NULL DEFAULT '{}',
        external_id VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_marketing_content_org_id ON marketing_content(org_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_marketing_content_status ON marketing_content(status)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_marketing_content_campaign_id ON marketing_content(campaign_id)`);

    // Marketing Actions (audit log)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS marketing_actions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        mission_run_id VARCHAR(100) NOT NULL,
        action_type VARCHAR(50) NOT NULL,
        platform VARCHAR(50),
        description TEXT NOT NULL,
        details JSONB NOT NULL DEFAULT '{}',
        auto_executed BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_marketing_actions_org_id ON marketing_actions(org_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_marketing_actions_mission_run ON marketing_actions(mission_run_id)`);

    // Organization columns for marketing agent
    await queryRunner.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS marketing_agent_enabled BOOLEAN NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS marketing_agent_interval_minutes INT NOT NULL DEFAULT 120`);
    await queryRunner.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS marketing_agent_config JSONB NOT NULL DEFAULT '{}'`);
    await queryRunner.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS marketing_channel_credentials JSONB NOT NULL DEFAULT '{}'`);
    await queryRunner.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS marketing_monthly_budget_cents INT NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS marketing_escalation_threshold_cents INT NOT NULL DEFAULT 10000`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE organizations DROP COLUMN IF EXISTS marketing_escalation_threshold_cents`);
    await queryRunner.query(`ALTER TABLE organizations DROP COLUMN IF EXISTS marketing_monthly_budget_cents`);
    await queryRunner.query(`ALTER TABLE organizations DROP COLUMN IF EXISTS marketing_channel_credentials`);
    await queryRunner.query(`ALTER TABLE organizations DROP COLUMN IF EXISTS marketing_agent_config`);
    await queryRunner.query(`ALTER TABLE organizations DROP COLUMN IF EXISTS marketing_agent_interval_minutes`);
    await queryRunner.query(`ALTER TABLE organizations DROP COLUMN IF EXISTS marketing_agent_enabled`);
    await queryRunner.query(`DROP TABLE IF EXISTS marketing_actions`);
    await queryRunner.query(`DROP TABLE IF EXISTS marketing_content`);
    await queryRunner.query(`DROP TABLE IF EXISTS marketing_campaigns`);
  }
}
```

**Step 2: Register migration in connection.ts**

In `api/src/db/connection.ts`, add import at top with other migration imports:
```typescript
import { AddMarketingAgent1740400000000 } from "./migrations/1740400000000-AddMarketingAgent.js";
```

Add to migrations array after `AddBoardExecutionId1740300000000` (line 518):
```typescript
    AddBoardExecutionId1740300000000,
    AddMarketingAgent1740400000000,
  ],
```

**Step 3: Verify typecheck**

Run: `cd api && npm run typecheck`
Expected: PASS (no type errors)

**Step 4: Commit**

```bash
git add api/src/db/migrations/1740400000000-AddMarketingAgent.ts api/src/db/connection.ts
git commit -m "feat: add marketing agent migration — 3 tables + 6 org columns"
```

---

### Task 2: TypeORM Entities — MarketingCampaign, MarketingContent, MarketingAction

**Files:**
- Create: `api/src/models/MarketingCampaign.ts`
- Create: `api/src/models/MarketingContent.ts`
- Create: `api/src/models/MarketingAction.ts`
- Modify: `api/src/models/Organization.ts:660` (add 6 marketing columns before @CreateDateColumn)
- Modify: `api/src/models/index.ts` (export new models)
- Modify: `api/src/db/connection.ts:324` (register entities)

**Step 1: Create MarketingCampaign entity**

```typescript
// api/src/models/MarketingCampaign.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from "typeorm";
import { Organization } from "./Organization.js";

export type CampaignPlatform = "google_ads" | "reddit" | "x" | "github" | "devto" | "hackernews";
export type CampaignStatus = "active" | "paused" | "pending_review" | "completed" | "rejected";

@Entity("marketing_campaigns")
export class MarketingCampaign {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ type: "varchar", length: 50 })
  platform: CampaignPlatform;

  @Column({ type: "varchar", length: 255 })
  name: string;

  @Column({ type: "varchar", length: 50, default: "pending_review" })
  status: CampaignStatus;

  @Column({ name: "budget_cents", type: "int", default: 0 })
  budgetCents: number;

  @Column({ name: "spent_cents", type: "int", default: 0 })
  spentCents: number;

  @Column({ type: "int", default: 0 })
  impressions: number;

  @Column({ type: "int", default: 0 })
  clicks: number;

  @Column({ type: "int", default: 0 })
  conversions: number;

  @Column({ name: "targeting_config", type: "jsonb", default: {} })
  targetingConfig: Record<string, unknown>;

  @Column({ name: "external_id", type: "varchar", length: 255, nullable: true })
  externalId: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @ManyToOne(() => Organization)
  @JoinColumn({ name: "org_id" })
  organization: Organization;
}
```

**Step 2: Create MarketingContent entity**

```typescript
// api/src/models/MarketingContent.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Organization } from "./Organization.js";
import { MarketingCampaign } from "./MarketingCampaign.js";

export type ContentPlatform = "x" | "reddit" | "devto" | "blog" | "hackernews";
export type ContentType = "tweet" | "post" | "article" | "ad_copy";
export type ContentStatus = "draft" | "pending_review" | "approved" | "published" | "rejected";

@Entity("marketing_content")
export class MarketingContent {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ name: "campaign_id", type: "uuid", nullable: true })
  campaignId: string | null;

  @Column({ type: "varchar", length: 50 })
  platform: ContentPlatform;

  @Column({ name: "content_type", type: "varchar", length: 50 })
  contentType: ContentType;

  @Column({ type: "varchar", length: 500, nullable: true })
  title: string | null;

  @Column({ type: "text" })
  body: string;

  @Column({ type: "varchar", length: 50, default: "draft" })
  status: ContentStatus;

  @Column({ name: "published_at", type: "timestamptz", nullable: true })
  publishedAt: Date | null;

  @Column({ name: "engagement_metrics", type: "jsonb", default: {} })
  engagementMetrics: Record<string, unknown>;

  @Column({ name: "external_id", type: "varchar", length: 255, nullable: true })
  externalId: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @ManyToOne(() => Organization)
  @JoinColumn({ name: "org_id" })
  organization: Organization;

  @ManyToOne(() => MarketingCampaign)
  @JoinColumn({ name: "campaign_id" })
  campaign: MarketingCampaign | null;
}
```

**Step 3: Create MarketingAction entity**

```typescript
// api/src/models/MarketingAction.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Organization } from "./Organization.js";

export type MarketingActionType = "publish" | "bid_adjust" | "pause" | "resume" | "create_campaign" | "report";

@Entity("marketing_actions")
export class MarketingAction {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ name: "mission_run_id", type: "varchar", length: 100 })
  missionRunId: string;

  @Column({ name: "action_type", type: "varchar", length: 50 })
  actionType: MarketingActionType;

  @Column({ type: "varchar", length: 50, nullable: true })
  platform: string | null;

  @Column({ type: "text" })
  description: string;

  @Column({ type: "jsonb", default: {} })
  details: Record<string, unknown>;

  @Column({ name: "auto_executed", type: "boolean", default: true })
  autoExecuted: boolean;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @ManyToOne(() => Organization)
  @JoinColumn({ name: "org_id" })
  organization: Organization;
}
```

**Step 4: Add marketing columns to Organization model**

In `api/src/models/Organization.ts`, add after `repositories` column (line 660) and before `@CreateDateColumn` (line 662):

```typescript
  // Marketing Agent Settings
  @Column({ name: "marketing_agent_enabled", type: "boolean", default: false })
  marketingAgentEnabled: boolean;

  @Column({ name: "marketing_agent_interval_minutes", type: "int", default: 120 })
  marketingAgentIntervalMinutes: number;

  @Column({ name: "marketing_agent_config", type: "jsonb", default: {} })
  marketingAgentConfig: Record<string, unknown>;

  @Column({ name: "marketing_channel_credentials", type: "jsonb", default: {} })
  marketingChannelCredentials: Record<string, unknown>;

  @Column({ name: "marketing_monthly_budget_cents", type: "int", default: 0 })
  marketingMonthlyBudgetCents: number;

  @Column({ name: "marketing_escalation_threshold_cents", type: "int", default: 10000 })
  marketingEscalationThresholdCents: number;
```

**Step 5: Export models from index.ts**

In `api/src/models/index.ts`, add exports:
```typescript
export { MarketingCampaign } from "./MarketingCampaign.js";
export { MarketingContent } from "./MarketingContent.js";
export { MarketingAction } from "./MarketingAction.js";
```

**Step 6: Register entities in connection.ts**

In `api/src/db/connection.ts`, add imports at top:
```typescript
import { MarketingCampaign } from "../models/MarketingCampaign.js";
import { MarketingContent } from "../models/MarketingContent.js";
import { MarketingAction } from "../models/MarketingAction.js";
```

Add to entities array (after `KbStarredBoard` on line 324):
```typescript
    KbStarredBoard,
    MarketingCampaign,
    MarketingContent,
    MarketingAction,
  ],
```

**Step 7: Verify typecheck**

Run: `cd api && npm run typecheck`
Expected: PASS

**Step 8: Commit**

```bash
git add api/src/models/MarketingCampaign.ts api/src/models/MarketingContent.ts api/src/models/MarketingAction.ts api/src/models/Organization.ts api/src/models/index.ts api/src/db/connection.ts
git commit -m "feat: add MarketingCampaign, MarketingContent, MarketingAction entities + org columns"
```

---

### Task 3: Channel Adapter Interface + Stub Implementations

**Files:**
- Create: `api/src/services/marketing-channels/base-channel.ts`
- Create: `api/src/services/marketing-channels/google-ads-channel.ts`
- Create: `api/src/services/marketing-channels/reddit-channel.ts`
- Create: `api/src/services/marketing-channels/x-channel.ts`
- Create: `api/src/services/marketing-channels/devto-channel.ts`
- Create: `api/src/services/marketing-channels/hackernews-channel.ts`
- Create: `api/src/services/marketing-channels/index.ts`

**Step 1: Create base channel interface**

```typescript
// api/src/services/marketing-channels/base-channel.ts
import { MarketingContent } from "../../models/MarketingContent.js";

export interface CampaignMetrics {
  impressions: number;
  clicks: number;
  conversions: number;
  spentCents: number;
  ctr: number;   // click-through rate
  cpa: number;   // cost per acquisition in cents
}

export interface CampaignConfig {
  name: string;
  budgetCents: number;
  targetingConfig: Record<string, unknown>;
  bidStrategyCpc?: number;
  bidStrategyCpm?: number;
}

export interface PublishResult {
  externalId: string;
  url?: string;
}

export interface MarketingChannel {
  readonly platform: string;

  /** Pull latest metrics for a campaign from the platform API */
  fetchMetrics(externalCampaignId: string): Promise<CampaignMetrics>;

  /** Publish content (tweet, post, article, ad) to the platform */
  publish(content: MarketingContent): Promise<PublishResult>;

  /** Adjust CPC/CPM bid for a campaign */
  adjustBid(externalCampaignId: string, newBidCents: number): Promise<void>;

  /** Pause a running campaign */
  pauseCampaign(externalCampaignId: string): Promise<void>;

  /** Resume a paused campaign */
  resumeCampaign(externalCampaignId: string): Promise<void>;

  /** Create a new campaign on the platform */
  createCampaign(config: CampaignConfig): Promise<{ externalId: string }>;

  /** Test that credentials are valid */
  validateCredentials(): Promise<boolean>;
}
```

**Step 2: Create stub implementations for each platform**

Each channel follows the same stub pattern — real API integration comes later when accounts are set up. Create all 5 files following this pattern (shown for Google Ads, replicate for reddit, x, devto, hackernews):

```typescript
// api/src/services/marketing-channels/google-ads-channel.ts
import { logger } from "../../utils/logger.js";
import { MarketingContent } from "../../models/MarketingContent.js";
import type { MarketingChannel, CampaignMetrics, CampaignConfig, PublishResult } from "./base-channel.js";

export class GoogleAdsChannel implements MarketingChannel {
  readonly platform = "google_ads";
  private apiKey: string;

  constructor(credentials: Record<string, unknown>) {
    this.apiKey = credentials.apiKey as string;
  }

  async fetchMetrics(externalCampaignId: string): Promise<CampaignMetrics> {
    logger.info(`[GoogleAds] Fetching metrics for campaign ${externalCampaignId}`);
    // TODO: Integrate with Google Ads API
    throw new Error("Google Ads API integration not yet configured");
  }

  async publish(content: MarketingContent): Promise<PublishResult> {
    logger.info(`[GoogleAds] Publishing ad copy: ${content.title}`);
    // TODO: Integrate with Google Ads API
    throw new Error("Google Ads API integration not yet configured");
  }

  async adjustBid(externalCampaignId: string, newBidCents: number): Promise<void> {
    logger.info(`[GoogleAds] Adjusting bid for ${externalCampaignId} to ${newBidCents}c`);
    throw new Error("Google Ads API integration not yet configured");
  }

  async pauseCampaign(externalCampaignId: string): Promise<void> {
    logger.info(`[GoogleAds] Pausing campaign ${externalCampaignId}`);
    throw new Error("Google Ads API integration not yet configured");
  }

  async resumeCampaign(externalCampaignId: string): Promise<void> {
    logger.info(`[GoogleAds] Resuming campaign ${externalCampaignId}`);
    throw new Error("Google Ads API integration not yet configured");
  }

  async createCampaign(config: CampaignConfig): Promise<{ externalId: string }> {
    logger.info(`[GoogleAds] Creating campaign: ${config.name}`);
    throw new Error("Google Ads API integration not yet configured");
  }

  async validateCredentials(): Promise<boolean> {
    return !!this.apiKey;
  }
}
```

Replicate for:
- `reddit-channel.ts` — class `RedditChannel`, platform `"reddit"`, uses Reddit Ads API
- `x-channel.ts` — class `XChannel`, platform `"x"`, uses X/Twitter API v2
- `devto-channel.ts` — class `DevtoChannel`, platform `"devto"`, uses Dev.to API (publish articles)
- `hackernews-channel.ts` — class `HackerNewsChannel`, platform `"hackernews"`, uses HN API (submit stories)

**Step 3: Create channel index with factory**

```typescript
// api/src/services/marketing-channels/index.ts
import type { MarketingChannel } from "./base-channel.js";
import { GoogleAdsChannel } from "./google-ads-channel.js";
import { RedditChannel } from "./reddit-channel.js";
import { XChannel } from "./x-channel.js";
import { DevtoChannel } from "./devto-channel.js";
import { HackerNewsChannel } from "./hackernews-channel.js";

export type { MarketingChannel, CampaignMetrics, CampaignConfig, PublishResult } from "./base-channel.js";

const CHANNEL_MAP: Record<string, new (credentials: Record<string, unknown>) => MarketingChannel> = {
  google_ads: GoogleAdsChannel,
  reddit: RedditChannel,
  x: XChannel,
  devto: DevtoChannel,
  hackernews: HackerNewsChannel,
};

/**
 * Create channel adapter instances for all enabled platforms.
 * Reads from org.marketingChannelCredentials — only instantiates channels
 * that have credentials configured and enabled: true.
 */
export function getEnabledChannels(
  channelCredentials: Record<string, Record<string, unknown>>
): MarketingChannel[] {
  const channels: MarketingChannel[] = [];
  for (const [platform, creds] of Object.entries(channelCredentials)) {
    if (!creds.enabled) continue;
    const ChannelClass = CHANNEL_MAP[platform];
    if (ChannelClass) {
      channels.push(new ChannelClass(creds));
    }
  }
  return channels;
}
```

**Step 4: Verify typecheck**

Run: `cd api && npm run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add api/src/services/marketing-channels/
git commit -m "feat: add marketing channel adapter interface + 5 platform stubs"
```

---

### Task 4: Marketing Agent Executor

**Files:**
- Create: `api/src/services/marketing-agent-executor.ts`
- Reference: `api/src/services/support-agent-executor.ts` (pattern to follow)

**Step 1: Create the executor**

```typescript
// api/src/services/marketing-agent-executor.ts
import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { AppDataSource } from "../db/connection.js";
import { Organization, MarketingCampaign, MarketingContent, MarketingAction } from "../models/index.js";
import { logger } from "../utils/logger.js";
import { getProviderCredentials } from "../config/index.js";
import { getEnabledChannels } from "./marketing-channels/index.js";
import type { MarketingChannel } from "./marketing-channels/index.js";

interface MissionContext {
  campaigns: MarketingCampaign[];
  recentContent: MarketingContent[];
  pendingReview: MarketingContent[];
  budgetSpentCents: number;
  budgetCapCents: number;
  lastMissionSummary: string | null;
}

interface ProposedAction {
  actionType: "publish" | "bid_adjust" | "pause" | "resume" | "create_campaign";
  platform: string;
  description: string;
  details: Record<string, unknown>;
  content?: { title?: string; body: string; contentType: string; platform: string };
  campaign?: { name: string; budgetCents: number; targetingConfig: Record<string, unknown> };
  bidAdjust?: { campaignId: string; newBidCents: number; oldBidCents: number };
}

export interface MissionResult {
  missionRunId: string;
  actionsExecuted: number;
  actionsEscalated: number;
  errors: string[];
}

/**
 * Execute a marketing agent mission — called by the orchestrator cron.
 *
 * Flow:
 * 1. Build context (campaigns, content, budget status)
 * 2. Fetch persona directive from Persona Studio
 * 3. Call Claude with context + directive → get proposed actions
 * 4. Execute actions within guardrails, escalate the rest
 * 5. Pull latest metrics from channels
 * 6. Log mission summary
 */
export async function executeMarketingAgentMission(
  org: Organization
): Promise<MissionResult> {
  const missionRunId = randomUUID();
  const campaignRepo = AppDataSource.getRepository(MarketingCampaign);
  const contentRepo = AppDataSource.getRepository(MarketingContent);
  const actionRepo = AppDataSource.getRepository(MarketingAction);

  const result: MissionResult = {
    missionRunId,
    actionsExecuted: 0,
    actionsEscalated: 0,
    errors: [],
  };

  const logAction = async (
    actionType: string,
    platform: string | null,
    description: string,
    details: Record<string, unknown>,
    autoExecuted: boolean
  ) => {
    await actionRepo.save(
      actionRepo.create({
        orgId: org.id,
        missionRunId,
        actionType: actionType as MarketingAction["actionType"],
        platform,
        description,
        details,
        autoExecuted,
      })
    );
  };

  try {
    logger.info("[MarketingAgent] Starting mission", { missionRunId, orgId: org.id });

    // 1. Build context
    const context = await buildMissionContext(org);

    // 2. Check budget — if we've hit the pause threshold, skip execution
    const config = org.marketingAgentConfig as Record<string, unknown>;
    const pauseThresholdPct = (config.pauseAtBudgetPct as number) || 90;
    if (context.budgetCapCents > 0) {
      const spentPct = (context.budgetSpentCents / context.budgetCapCents) * 100;
      if (spentPct >= pauseThresholdPct) {
        await logAction("report", null, `Mission skipped — budget ${spentPct.toFixed(1)}% spent (threshold: ${pauseThresholdPct}%)`, { spentPct }, true);
        logger.info("[MarketingAgent] Mission skipped — budget threshold reached", { spentPct, pauseThresholdPct });
        return result;
      }
    }

    // 3. Get AI model from provider routing or default
    const providerRouting = org.providerRouting as Record<string, Record<string, string>>;
    const marketingRouting = providerRouting?.marketing_agent;
    const model = marketingRouting?.model || org.defaultWorkerModel || "claude-sonnet-4-6";

    // 4. Get API key
    const anthropicApiKey = await getProviderCredentials(org.id, "anthropic");
    if (!anthropicApiKey) {
      throw new Error("No Anthropic API key configured for platform org");
    }

    // 5. Fetch persona directive from Persona Studio
    const systemPrompt = await buildSystemPrompt(org, context);

    // 6. Call Claude
    const anthropic = new Anthropic({ apiKey: anthropicApiKey });
    const message = await anthropic.messages.create({
      model,
      max_tokens: 4000,
      messages: [{ role: "user", content: systemPrompt }],
    });

    // 7. Parse proposed actions from response
    const responseText = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const proposedActions = parseProposedActions(responseText);
    logger.info("[MarketingAgent] Got proposed actions", { count: proposedActions.length, missionRunId });

    // 8. Execute or escalate each action
    const channels = getEnabledChannels(org.marketingChannelCredentials as Record<string, Record<string, unknown>>);
    const channelMap = new Map(channels.map((c) => [c.platform, c]));

    for (const action of proposedActions) {
      try {
        const shouldAutoExecute = checkGuardrails(action, org);

        if (shouldAutoExecute) {
          await executeAction(action, channelMap, contentRepo, campaignRepo, org);
          await logAction(action.actionType, action.platform, action.description, action.details, true);
          result.actionsExecuted++;
        } else {
          // Escalate — create pending_review records
          await escalateAction(action, contentRepo, campaignRepo, org);
          await logAction(action.actionType, action.platform, `[ESCALATED] ${action.description}`, action.details, false);
          result.actionsEscalated++;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        result.errors.push(`${action.actionType}/${action.platform}: ${errMsg}`);
        await logAction(action.actionType, action.platform, `[ERROR] ${action.description}: ${errMsg}`, { ...action.details, error: errMsg }, true);
      }
    }

    // 9. Pull latest metrics from all channels
    await refreshCampaignMetrics(channels, campaignRepo, org.id);

    // 10. Log mission summary
    await logAction("report", null, `Mission complete: ${result.actionsExecuted} executed, ${result.actionsEscalated} escalated, ${result.errors.length} errors`, {
      actionsExecuted: result.actionsExecuted,
      actionsEscalated: result.actionsEscalated,
      errorCount: result.errors.length,
    }, true);

    logger.info("[MarketingAgent] Mission complete", { missionRunId, ...result });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    result.errors.push(errMsg);
    logger.error("[MarketingAgent] Mission failed", { missionRunId, error: errMsg });
    await logAction("report", null, `Mission failed: ${errMsg}`, { error: errMsg }, true).catch(() => {});
  }

  return result;
}

async function buildMissionContext(org: Organization): Promise<MissionContext> {
  const campaignRepo = AppDataSource.getRepository(MarketingCampaign);
  const contentRepo = AppDataSource.getRepository(MarketingContent);
  const actionRepo = AppDataSource.getRepository(MarketingAction);

  const campaigns = await campaignRepo.find({ where: { orgId: org.id }, order: { updatedAt: "DESC" } });

  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const recentContent = await contentRepo
    .createQueryBuilder("c")
    .where("c.org_id = :orgId", { orgId: org.id })
    .andWhere("c.created_at > :since", { since: twoDaysAgo })
    .orderBy("c.created_at", "DESC")
    .getMany();

  const pendingReview = await contentRepo.find({
    where: { orgId: org.id, status: "pending_review" as const },
    order: { createdAt: "DESC" },
  });

  const budgetSpentCents = campaigns.reduce((sum, c) => sum + c.spentCents, 0);

  // Last mission summary
  const lastReport = await actionRepo
    .createQueryBuilder("a")
    .where("a.org_id = :orgId", { orgId: org.id })
    .andWhere("a.action_type = :type", { type: "report" })
    .orderBy("a.created_at", "DESC")
    .getOne();

  return {
    campaigns,
    recentContent,
    pendingReview,
    budgetSpentCents,
    budgetCapCents: org.marketingMonthlyBudgetCents,
    lastMissionSummary: lastReport?.description || null,
  };
}

async function buildSystemPrompt(org: Organization, context: MissionContext): Promise<string> {
  // Fetch persona directive from Persona Studio
  let personaDirective = "";
  try {
    const { Persona } = await import("../models/Persona.js");
    const { PersonaDirective } = await import("../models/PersonaDirective.js");
    const personaRepo = AppDataSource.getRepository(Persona);
    const directiveRepo = AppDataSource.getRepository(PersonaDirective);

    const persona = await personaRepo.findOne({ where: { slug: "marketing_agent", orgId: org.id } });
    if (persona) {
      const directive = await directiveRepo.findOne({
        where: { personaId: persona.id, type: "readme", isActive: true },
        order: { version: "DESC" },
      });
      if (directive) {
        personaDirective = directive.content;
      }
    }
  } catch {
    logger.warn("[MarketingAgent] Could not load persona directive, using default");
  }

  const config = org.marketingAgentConfig as Record<string, unknown>;
  const voiceTone = (config.voiceTone as string) || "Professional, technical, developer-focused";
  const brandKeywords = (config.brandKeywords as string[]) || ["WorkerMill", "AI coding agents", "autonomous development"];

  const campaignSummary = context.campaigns.map((c) =>
    `- ${c.name} (${c.platform}, ${c.status}): $${(c.spentCents / 100).toFixed(2)} spent, ${c.impressions} impressions, ${c.clicks} clicks, ${c.conversions} conversions`
  ).join("\n") || "No active campaigns yet.";

  const recentContentSummary = context.recentContent.slice(0, 10).map((c) =>
    `- [${c.status}] ${c.platform}/${c.contentType}: ${c.title || c.body.slice(0, 80)}...`
  ).join("\n") || "No recent content.";

  const pendingSummary = context.pendingReview.map((c) =>
    `- ${c.platform}/${c.contentType}: ${c.title || c.body.slice(0, 80)}...`
  ).join("\n") || "No items pending review.";

  return `${personaDirective}

You are the WorkerMill Marketing Agent. Your mission is to grow brand awareness for WorkerMill — an AI-powered coding agent orchestration platform for development teams.

## Voice & Tone
${voiceTone}

## Brand Keywords
${brandKeywords.join(", ")}

## Current State

### Budget
- Monthly cap: $${(context.budgetCapCents / 100).toFixed(2)}
- Spent this month: $${(context.budgetSpentCents / 100).toFixed(2)}
- Remaining: $${((context.budgetCapCents - context.budgetSpentCents) / 100).toFixed(2)}

### Active Campaigns
${campaignSummary}

### Recent Content (last 48h)
${recentContentSummary}

### Pending Review
${pendingSummary}

### Last Mission Summary
${context.lastMissionSummary || "First mission run."}

## Your Task

Analyze the current state and propose actions. Respond with a JSON array of actions:

\`\`\`json
[
  {
    "actionType": "publish|bid_adjust|pause|resume|create_campaign",
    "platform": "x|reddit|devto|google_ads|hackernews",
    "description": "Human-readable description of what you're doing and why",
    "details": {},
    "content": { "title": "...", "body": "...", "contentType": "tweet|post|article|ad_copy", "platform": "..." },
    "campaign": { "name": "...", "budgetCents": 0, "targetingConfig": {} },
    "bidAdjust": { "campaignId": "...", "newBidCents": 0, "oldBidCents": 0 }
  }
]
\`\`\`

Include only the fields relevant to each action type. Prioritize:
1. Routine content that builds brand awareness (tweets, dev community posts)
2. Monitoring and adjusting existing campaigns
3. Proposing new campaigns only when current ones are performing well
4. Pausing anything with CPA above $20

Be specific and actionable. Every action should have a clear "why".`;
}

function parseProposedActions(responseText: string): ProposedAction[] {
  try {
    // Extract JSON from markdown code blocks or raw JSON
    const jsonMatch = responseText.match(/```(?:json)?\s*\n?([\s\S]*?)```/) || responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logger.warn("[MarketingAgent] No JSON actions found in response");
      return [];
    }
    const jsonStr = jsonMatch[1] || jsonMatch[0];
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];
    return parsed as ProposedAction[];
  } catch {
    logger.warn("[MarketingAgent] Failed to parse proposed actions from AI response");
    return [];
  }
}

function checkGuardrails(action: ProposedAction, org: Organization): boolean {
  const config = org.marketingAgentConfig as Record<string, unknown>;

  switch (action.actionType) {
    case "publish": {
      // Auto-publish routine content if enabled
      const autoPublish = config.autoPublishRoutineContent !== false;
      // Blog posts always require review
      if (action.content?.contentType === "article") return false;
      return autoPublish;
    }
    case "bid_adjust": {
      const autoBid = config.autoAdjustBids !== false;
      if (!autoBid) return false;
      const maxPct = (config.maxBidAdjustmentPct as number) || 15;
      const adjust = action.bidAdjust;
      if (!adjust || adjust.oldBidCents === 0) return false;
      const changePct = Math.abs((adjust.newBidCents - adjust.oldBidCents) / adjust.oldBidCents) * 100;
      return changePct <= maxPct;
    }
    case "pause": {
      return config.autoPauseUnderperformers !== false;
    }
    case "resume": {
      // Resuming a paused campaign is low-risk
      return true;
    }
    case "create_campaign": {
      // New campaigns always require review
      return false;
    }
    default:
      return false;
  }
}

async function executeAction(
  action: ProposedAction,
  channelMap: Map<string, MarketingChannel>,
  contentRepo: ReturnType<typeof AppDataSource.getRepository<MarketingContent>>,
  campaignRepo: ReturnType<typeof AppDataSource.getRepository<MarketingCampaign>>,
  org: Organization
): Promise<void> {
  const channel = channelMap.get(action.platform);

  switch (action.actionType) {
    case "publish": {
      if (!action.content) throw new Error("publish action missing content");
      const contentRecord = contentRepo.create({
        orgId: org.id,
        platform: action.content.platform as MarketingContent["platform"],
        contentType: action.content.contentType as MarketingContent["contentType"],
        title: action.content.title || null,
        body: action.content.body,
        status: "published",
        publishedAt: new Date(),
      });

      if (channel) {
        const result = await channel.publish(contentRecord);
        contentRecord.externalId = result.externalId;
      }
      await contentRepo.save(contentRecord);
      break;
    }
    case "bid_adjust": {
      if (!action.bidAdjust || !channel) throw new Error("bid_adjust requires campaignId and channel");
      await channel.adjustBid(action.bidAdjust.campaignId, action.bidAdjust.newBidCents);
      break;
    }
    case "pause": {
      if (!channel) throw new Error("pause requires channel");
      const campaign = await campaignRepo.findOne({
        where: { orgId: org.id, platform: action.platform as MarketingCampaign["platform"] },
      });
      if (campaign?.externalId) {
        await channel.pauseCampaign(campaign.externalId);
        await campaignRepo.update({ id: campaign.id }, { status: "paused" });
      }
      break;
    }
    case "resume": {
      if (!channel) throw new Error("resume requires channel");
      const campaign = await campaignRepo.findOne({
        where: { orgId: org.id, platform: action.platform as MarketingCampaign["platform"], status: "paused" },
      });
      if (campaign?.externalId) {
        await channel.resumeCampaign(campaign.externalId);
        await campaignRepo.update({ id: campaign.id }, { status: "active" });
      }
      break;
    }
  }
}

async function escalateAction(
  action: ProposedAction,
  contentRepo: ReturnType<typeof AppDataSource.getRepository<MarketingContent>>,
  campaignRepo: ReturnType<typeof AppDataSource.getRepository<MarketingCampaign>>,
  org: Organization
): Promise<void> {
  if (action.actionType === "publish" && action.content) {
    await contentRepo.save(
      contentRepo.create({
        orgId: org.id,
        platform: action.content.platform as MarketingContent["platform"],
        contentType: action.content.contentType as MarketingContent["contentType"],
        title: action.content.title || null,
        body: action.content.body,
        status: "pending_review",
      })
    );
  } else if (action.actionType === "create_campaign" && action.campaign) {
    await campaignRepo.save(
      campaignRepo.create({
        orgId: org.id,
        platform: action.platform as MarketingCampaign["platform"],
        name: action.campaign.name,
        status: "pending_review",
        budgetCents: action.campaign.budgetCents,
        targetingConfig: action.campaign.targetingConfig,
      })
    );
  }
}

async function refreshCampaignMetrics(
  channels: MarketingChannel[],
  campaignRepo: ReturnType<typeof AppDataSource.getRepository<MarketingCampaign>>,
  orgId: string
): Promise<void> {
  for (const channel of channels) {
    const campaigns = await campaignRepo.find({
      where: { orgId, platform: channel.platform as MarketingCampaign["platform"], status: "active" },
    });
    for (const campaign of campaigns) {
      if (!campaign.externalId) continue;
      try {
        const metrics = await channel.fetchMetrics(campaign.externalId);
        await campaignRepo.update(
          { id: campaign.id },
          {
            spentCents: metrics.spentCents,
            impressions: metrics.impressions,
            clicks: metrics.clicks,
            conversions: metrics.conversions,
          }
        );
      } catch (err) {
        logger.warn(`[MarketingAgent] Failed to refresh metrics for ${campaign.name}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
```

**Step 2: Verify typecheck**

Run: `cd api && npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add api/src/services/marketing-agent-executor.ts
git commit -m "feat: add marketing agent executor — in-process mission runner with guardrails"
```

---

### Task 5: Orchestrator Cron Integration

**Files:**
- Modify: `api/src/services/orchestrator.ts:38` (add timer variable)
- Modify: `api/src/services/orchestrator.ts:273` (add cron check after trial reminders)

**Step 1: Add import and timer variable**

At the top of `api/src/services/orchestrator.ts`, add import:
```typescript
import { executeMarketingAgentMission } from "./marketing-agent-executor.js";
```

After `let lastTrialReminderCheck = 0;` (line 38), add:
```typescript
let lastMarketingAgentRun = 0;
```

**Step 2: Add cron check in poll loop**

After the trial reminder check block (after line 273), add:

```typescript
      // Check marketing agent — configurable interval (default 2 hours)
      try {
        const platformOrg = await Organization.getPlatformOrg();
        if (
          platformOrg?.marketingAgentEnabled &&
          now - lastMarketingAgentRun > platformOrg.marketingAgentIntervalMinutes * 60 * 1000
        ) {
          const config = platformOrg.marketingAgentConfig as Record<string, unknown>;
          const timeWindow = (config.missionTimeWindow as string) || "06:00-22:00";
          const [startStr, endStr] = timeWindow.split("-");
          const startHour = parseInt(startStr.split(":")[0], 10);
          const endHour = parseInt(endStr.split(":")[0], 10);
          const currentHour = new Date().getUTCHours();

          if (currentHour >= startHour && currentHour < endHour) {
            lastMarketingAgentRun = now;
            executeMarketingAgentMission(platformOrg).catch((err) =>
              logger.error("Marketing agent mission failed", {
                error: err instanceof Error ? err.message : String(err),
              }),
            );
          }
        }
      } catch (err) {
        logger.error("Marketing agent cron check failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
```

Note: Import `Organization` if not already imported. Check existing imports in the file.

**Step 3: Verify typecheck**

Run: `cd api && npm run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add api/src/services/orchestrator.ts
git commit -m "feat: add marketing agent cron to orchestrator poll loop"
```

---

### Task 6: Marketing API Routes

**Files:**
- Create: `api/src/routes/marketing.ts`
- Modify: `api/src/routes/index.ts:39` (add export)

**Step 1: Create marketing routes**

Reference `api/src/routes/management.ts` for the `isPlatformAdmin` middleware pattern. The marketing routes need:
- Auth middleware (JWT)
- Platform admin check (user must be `isPlatformAdmin` or belong to platform org with appropriate role)

```typescript
// api/src/routes/marketing.ts
import { Router, type Request, type Response } from "express";
import { AppDataSource } from "../db/connection.js";
import { MarketingCampaign, MarketingContent, MarketingAction, Organization } from "../models/index.js";
import { authenticate } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";
import { executeMarketingAgentMission } from "../services/marketing-agent-executor.js";

const router = Router();

// All routes require platform admin auth
router.use(authenticate);

// Middleware: check platform admin
router.use(async (req: Request, res: Response, next) => {
  const user = (req as any).user;
  if (!user?.isPlatformAdmin) {
    return res.status(403).json({ error: "Platform admin access required" });
  }
  next();
});

// GET /api/marketing/stats
router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const platformOrg = await Organization.getPlatformOrg();
    if (!platformOrg) return res.status(404).json({ error: "Platform org not found" });

    const campaignRepo = AppDataSource.getRepository(MarketingCampaign);
    const contentRepo = AppDataSource.getRepository(MarketingContent);
    const actionRepo = AppDataSource.getRepository(MarketingAction);

    const campaigns = await campaignRepo.find({ where: { orgId: platformOrg.id } });

    const totalSpentCents = campaigns.reduce((sum, c) => sum + c.spentCents, 0);
    const totalImpressions = campaigns.reduce((sum, c) => sum + c.impressions, 0);
    const totalClicks = campaigns.reduce((sum, c) => sum + c.clicks, 0);
    const totalConversions = campaigns.reduce((sum, c) => sum + c.conversions, 0);

    const pendingCount = await contentRepo.count({ where: { orgId: platformOrg.id, status: "pending_review" as const } });
    const publishedCount = await contentRepo.count({ where: { orgId: platformOrg.id, status: "published" as const } });

    const lastAction = await actionRepo.findOne({
      where: { orgId: platformOrg.id, actionType: "report" },
      order: { createdAt: "DESC" },
    });

    res.json({
      budgetCapCents: platformOrg.marketingMonthlyBudgetCents,
      totalSpentCents,
      totalImpressions,
      totalClicks,
      totalConversions,
      ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
      avgCpaCents: totalConversions > 0 ? Math.round(totalSpentCents / totalConversions) : 0,
      activeCampaigns: campaigns.filter((c) => c.status === "active").length,
      pendingReviewCount: pendingCount,
      publishedContentCount: publishedCount,
      lastMissionAt: lastAction?.createdAt || null,
      agentEnabled: platformOrg.marketingAgentEnabled,
      intervalMinutes: platformOrg.marketingAgentIntervalMinutes,
    });
  } catch (err) {
    logger.error("Failed to fetch marketing stats", { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// GET /api/marketing/campaigns
router.get("/campaigns", async (_req: Request, res: Response) => {
  try {
    const platformOrg = await Organization.getPlatformOrg();
    if (!platformOrg) return res.status(404).json({ error: "Platform org not found" });

    const repo = AppDataSource.getRepository(MarketingCampaign);
    const campaigns = await repo.find({ where: { orgId: platformOrg.id }, order: { updatedAt: "DESC" } });
    res.json({ campaigns });
  } catch (err) {
    logger.error("Failed to fetch campaigns", { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: "Failed to fetch campaigns" });
  }
});

// GET /api/marketing/campaigns/:id
router.get("/campaigns/:id", async (req: Request, res: Response) => {
  try {
    const repo = AppDataSource.getRepository(MarketingCampaign);
    const campaign = await repo.findOne({ where: { id: req.params.id } });
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    res.json(campaign);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch campaign" });
  }
});

// GET /api/marketing/content
router.get("/content", async (req: Request, res: Response) => {
  try {
    const platformOrg = await Organization.getPlatformOrg();
    if (!platformOrg) return res.status(404).json({ error: "Platform org not found" });

    const repo = AppDataSource.getRepository(MarketingContent);
    const qb = repo.createQueryBuilder("c")
      .where("c.org_id = :orgId", { orgId: platformOrg.id })
      .orderBy("c.created_at", "DESC")
      .limit(100);

    const status = req.query.status as string;
    if (status) {
      qb.andWhere("c.status = :status", { status });
    }

    const content = await qb.getMany();
    res.json({ content });
  } catch (err) {
    logger.error("Failed to fetch content", { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: "Failed to fetch content" });
  }
});

// POST /api/marketing/content/:id/approve
router.post("/content/:id/approve", async (req: Request, res: Response) => {
  try {
    const repo = AppDataSource.getRepository(MarketingContent);
    const result = await repo.update(
      { id: req.params.id, status: "pending_review" as const },
      { status: "approved" }
    );
    if (result.affected === 0) return res.status(404).json({ error: "Content not found or not pending" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to approve content" });
  }
});

// POST /api/marketing/content/:id/reject
router.post("/content/:id/reject", async (req: Request, res: Response) => {
  try {
    const repo = AppDataSource.getRepository(MarketingContent);
    const result = await repo.update(
      { id: req.params.id, status: "pending_review" as const },
      { status: "rejected" }
    );
    if (result.affected === 0) return res.status(404).json({ error: "Content not found or not pending" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to reject content" });
  }
});

// GET /api/marketing/actions
router.get("/actions", async (req: Request, res: Response) => {
  try {
    const platformOrg = await Organization.getPlatformOrg();
    if (!platformOrg) return res.status(404).json({ error: "Platform org not found" });

    const repo = AppDataSource.getRepository(MarketingAction);
    const qb = repo.createQueryBuilder("a")
      .where("a.org_id = :orgId", { orgId: platformOrg.id })
      .orderBy("a.created_at", "DESC")
      .limit(200);

    const missionRunId = req.query.missionRunId as string;
    if (missionRunId) {
      qb.andWhere("a.mission_run_id = :missionRunId", { missionRunId });
    }

    const actionType = req.query.actionType as string;
    if (actionType) {
      qb.andWhere("a.action_type = :actionType", { actionType });
    }

    const actions = await qb.getMany();
    res.json({ actions });
  } catch (err) {
    logger.error("Failed to fetch actions", { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: "Failed to fetch actions" });
  }
});

// GET /api/marketing/config
router.get("/config", async (_req: Request, res: Response) => {
  try {
    const platformOrg = await Organization.getPlatformOrg();
    if (!platformOrg) return res.status(404).json({ error: "Platform org not found" });

    res.json({
      enabled: platformOrg.marketingAgentEnabled,
      intervalMinutes: platformOrg.marketingAgentIntervalMinutes,
      monthlyBudgetCents: platformOrg.marketingMonthlyBudgetCents,
      escalationThresholdCents: platformOrg.marketingEscalationThresholdCents,
      config: platformOrg.marketingAgentConfig,
      // Omit actual credential values, just show which channels are enabled
      channels: Object.fromEntries(
        Object.entries(platformOrg.marketingChannelCredentials as Record<string, Record<string, unknown>>).map(
          ([platform, creds]) => [platform, { enabled: !!creds.enabled }]
        )
      ),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch config" });
  }
});

// PUT /api/marketing/config
router.put("/config", async (req: Request, res: Response) => {
  try {
    const platformOrg = await Organization.getPlatformOrg();
    if (!platformOrg) return res.status(404).json({ error: "Platform org not found" });

    const repo = AppDataSource.getRepository(Organization);
    const updates: Partial<Organization> = {};

    if (req.body.enabled !== undefined) updates.marketingAgentEnabled = req.body.enabled;
    if (req.body.intervalMinutes !== undefined) updates.marketingAgentIntervalMinutes = req.body.intervalMinutes;
    if (req.body.monthlyBudgetCents !== undefined) updates.marketingMonthlyBudgetCents = req.body.monthlyBudgetCents;
    if (req.body.escalationThresholdCents !== undefined) updates.marketingEscalationThresholdCents = req.body.escalationThresholdCents;
    if (req.body.config !== undefined) updates.marketingAgentConfig = req.body.config;
    if (req.body.channelCredentials !== undefined) updates.marketingChannelCredentials = req.body.channelCredentials;

    await repo.update({ id: platformOrg.id }, updates);
    res.json({ success: true });
  } catch (err) {
    logger.error("Failed to update marketing config", { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: "Failed to update config" });
  }
});

// POST /api/marketing/run-now
router.post("/run-now", async (_req: Request, res: Response) => {
  try {
    const platformOrg = await Organization.getPlatformOrg();
    if (!platformOrg) return res.status(404).json({ error: "Platform org not found" });

    if (!platformOrg.marketingAgentEnabled) {
      return res.status(400).json({ error: "Marketing agent is not enabled" });
    }

    // Run async — don't block the request
    executeMarketingAgentMission(platformOrg).catch((err) =>
      logger.error("Manual marketing mission failed", { error: err instanceof Error ? err.message : String(err) })
    );

    res.json({ success: true, message: "Mission triggered" });
  } catch (err) {
    res.status(500).json({ error: "Failed to trigger mission" });
  }
});

export default router;
```

**Step 2: Register route in index.ts**

In `api/src/routes/index.ts`, add after the last export (line 39):
```typescript
export { default as marketingRouter } from "./marketing.js";
```

**Step 3: Mount in app**

Find where routes are mounted in the main Express app (likely `api/src/app.ts` or `api/src/index.ts`). Add:
```typescript
app.use("/api/marketing", marketingRouter);
```

**Step 4: Verify typecheck**

Run: `cd api && npm run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add api/src/routes/marketing.ts api/src/routes/index.ts
git commit -m "feat: add marketing API routes — campaigns, content, actions, config, run-now"
```

---

### Task 7: Seed Marketing Agent Persona

**Files:**
- Modify: `api/src/db/seeds/seed-personas.ts` (add marketing_agent as platform-org persona)

**Step 1: Add marketing_agent persona definition**

In `seed-personas.ts`, add the marketing_agent to the persona config object (this is NOT a system persona — it's platform org specific). Add a separate section after the main system persona seeding that creates the platform-org-scoped persona:

```typescript
// After main system persona seeding loop, add:

// Seed platform-org-only personas
const platformOrg = await Organization.getPlatformOrg();
if (platformOrg) {
  const marketingAgentSlug = "marketing_agent";
  let marketingPersona = await personaRepo.findOne({
    where: { slug: marketingAgentSlug, orgId: platformOrg.id },
  });

  if (!marketingPersona) {
    marketingPersona = personaRepo.create({
      orgId: platformOrg.id,
      slug: marketingAgentSlug,
      name: "Marketing Agent",
      emoji: "📣",
      color: "#F59E0B",
      shortLabel: "Marketing",
      description: "Autonomous marketing agent — manages ad campaigns, publishes content, tracks brand awareness across developer-focused platforms.",
      enabled: true,
      isSystem: false,
      priority: 16,
      skills: ["content-marketing", "paid-ads", "analytics", "social-media", "seo", "copywriting"],
      riskLevel: "medium",
      keywordPattern: null,
      labelShortcuts: null,
    });
    await personaRepo.save(marketingPersona);
    logger.info(`Seeded marketing_agent persona for platform org`);
  }

  // Seed default directive for marketing agent
  const directiveRepo = AppDataSource.getRepository(PersonaDirective);
  const existingDirective = await directiveRepo.findOne({
    where: { personaId: marketingPersona.id, type: "readme" },
  });

  if (!existingDirective) {
    await directiveRepo.save(
      directiveRepo.create({
        personaId: marketingPersona.id,
        orgId: platformOrg.id,
        type: "readme",
        filename: null,
        content: `# Marketing Agent

You are WorkerMill's autonomous marketing agent. Your mission is to grow brand awareness among developers and engineering teams.

## Core Responsibilities
- Publish engaging content about WorkerMill's capabilities on developer platforms
- Manage paid advertising campaigns with strict budget discipline
- Monitor campaign performance and optimize spend allocation
- Communicate build progress, solved challenges, and product updates

## Content Guidelines
- Write for developers — technical, honest, no marketing fluff
- Highlight real problems WorkerMill solves (AI agent orchestration, real-time monitoring, autonomous coding)
- Share genuine build progress and engineering challenges
- Use data and specifics, not vague claims

## Budget Discipline
- Never exceed the monthly budget cap
- Pause campaigns that exceed CPA ceilings
- Prioritize high-ROI channels based on data
- Report all spend decisions with clear reasoning

## Platform-Specific Rules
- **X/Twitter**: Short, punchy, technical. Link to blog posts or demos. 2-3 tweets/day max.
- **Reddit**: Genuine engagement in r/programming, r/devops, r/ExperiencedDevs. No spam. Value-first.
- **Dev.to**: Technical articles about AI coding agents, development workflows, engineering challenges.
- **Hacker News**: Only submit genuinely interesting technical content. No marketing fluff.
- **Google Ads**: Target developer-related search terms. Tight keyword groups.`,
        version: 1,
        isActive: true,
      })
    );
    logger.info(`Seeded marketing_agent default directive`);
  }
}
```

**Step 2: Verify typecheck**

Run: `cd api && npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add api/src/db/seeds/seed-personas.ts
git commit -m "feat: seed marketing_agent persona + directive for platform org"
```

---

### Task 8: Frontend — Marketing Tab on Platform Dashboard

**Files:**
- Create: `frontend/src/components/management/MarketingTab.tsx`
- Modify: `frontend/src/pages/ManagementDashboard.tsx` (add tab navigation + render MarketingTab)

**Step 1: Create MarketingTab component**

This is a large component with three sub-views (Campaigns, Content, Action Log) + config panel. Create it as a single file first, split later if it grows too large.

```tsx
// frontend/src/components/management/MarketingTab.tsx
import { useState, useEffect, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface MarketingStats {
  budgetCapCents: number;
  totalSpentCents: number;
  totalImpressions: number;
  totalClicks: number;
  totalConversions: number;
  ctr: number;
  avgCpaCents: number;
  activeCampaigns: number;
  pendingReviewCount: number;
  publishedContentCount: number;
  lastMissionAt: string | null;
  agentEnabled: boolean;
  intervalMinutes: number;
}

interface Campaign {
  id: string;
  platform: string;
  name: string;
  status: string;
  budgetCents: number;
  spentCents: number;
  impressions: number;
  clicks: number;
  conversions: number;
  createdAt: string;
  updatedAt: string;
}

interface ContentItem {
  id: string;
  platform: string;
  contentType: string;
  title: string | null;
  body: string;
  status: string;
  publishedAt: string | null;
  engagementMetrics: Record<string, unknown>;
  createdAt: string;
}

interface ActionItem {
  id: string;
  missionRunId: string;
  actionType: string;
  platform: string | null;
  description: string;
  details: Record<string, unknown>;
  autoExecuted: boolean;
  createdAt: string;
}

interface MarketingTabProps {
  accessToken: string;
}

const statusColors: Record<string, string> = {
  active: "bg-green-500/10 text-green-500",
  paused: "bg-yellow-500/10 text-yellow-500",
  pending_review: "bg-blue-500/10 text-blue-500",
  completed: "bg-gray-500/10 text-gray-400",
  rejected: "bg-red-500/10 text-red-500",
  published: "bg-green-500/10 text-green-500",
  draft: "bg-gray-500/10 text-gray-400",
  approved: "bg-blue-500/10 text-blue-500",
};

const platformIcons: Record<string, string> = {
  google_ads: "Google",
  reddit: "Reddit",
  x: "X",
  devto: "Dev.to",
  hackernews: "HN",
  blog: "Blog",
};

export function MarketingTab({ accessToken }: MarketingTabProps) {
  const [subTab, setSubTab] = useState<"campaigns" | "content" | "actions" | "config">("campaigns");
  const [stats, setStats] = useState<MarketingStats | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);

  const headers = { Authorization: `Bearer ${accessToken}` };

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [statsRes, campaignsRes, contentRes, actionsRes] = await Promise.all([
        fetch(`${API_BASE}/api/marketing/stats`, { headers }),
        fetch(`${API_BASE}/api/marketing/campaigns`, { headers }),
        fetch(`${API_BASE}/api/marketing/content`, { headers }),
        fetch(`${API_BASE}/api/marketing/actions`, { headers }),
      ]);

      if (statsRes.ok) setStats(await statsRes.json());
      if (campaignsRes.ok) {
        const data = await campaignsRes.json();
        setCampaigns(data.campaigns);
      }
      if (contentRes.ok) {
        const data = await contentRes.json();
        setContent(data.content);
      }
      if (actionsRes.ok) {
        const data = await actionsRes.json();
        setActions(data.actions);
      }
    } catch (err) {
      console.error("Failed to fetch marketing data", err);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleApprove = async (contentId: string) => {
    await fetch(`${API_BASE}/api/marketing/content/${contentId}/approve`, { method: "POST", headers });
    fetchData();
  };

  const handleReject = async (contentId: string) => {
    await fetch(`${API_BASE}/api/marketing/content/${contentId}/reject`, { method: "POST", headers });
    fetchData();
  };

  const handleRunNow = async () => {
    await fetch(`${API_BASE}/api/marketing/run-now`, { method: "POST", headers });
    // Refresh after a short delay to show new actions
    setTimeout(fetchData, 3000);
  };

  const cents = (c: number) => `$${(c / 100).toFixed(2)}`;

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400">Loading marketing data...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Budget Summary Bar */}
      {stats && (
        <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-semibold text-white">Marketing Agent</h3>
              <span className={`px-2 py-0.5 text-xs rounded-full ${stats.agentEnabled ? "bg-green-500/10 text-green-500" : "bg-gray-500/10 text-gray-400"}`}>
                {stats.agentEnabled ? "Active" : "Disabled"}
              </span>
              {stats.agentEnabled && (
                <span className="text-xs text-gray-500">Every {stats.intervalMinutes}min</span>
              )}
            </div>
            <button
              onClick={handleRunNow}
              disabled={!stats.agentEnabled}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-md transition-colors"
            >
              Run Now
            </button>
          </div>

          <div className="grid grid-cols-6 gap-4">
            <div>
              <p className="text-xs text-gray-500">Monthly Budget</p>
              <p className="text-lg font-semibold text-white">{cents(stats.budgetCapCents)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Spent</p>
              <p className="text-lg font-semibold text-white">{cents(stats.totalSpentCents)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Impressions</p>
              <p className="text-lg font-semibold text-white">{stats.totalImpressions.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Clicks</p>
              <p className="text-lg font-semibold text-white">{stats.totalClicks.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Conversions</p>
              <p className="text-lg font-semibold text-white">{stats.totalConversions.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Avg CPA</p>
              <p className="text-lg font-semibold text-white">{cents(stats.avgCpaCents)}</p>
            </div>
          </div>

          {stats.budgetCapCents > 0 && (
            <div className="mt-3">
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${
                    (stats.totalSpentCents / stats.budgetCapCents) * 100 > 90
                      ? "bg-red-500"
                      : (stats.totalSpentCents / stats.budgetCapCents) * 100 > 75
                        ? "bg-yellow-500"
                        : "bg-green-500"
                  }`}
                  style={{ width: `${Math.min((stats.totalSpentCents / stats.budgetCapCents) * 100, 100)}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {((stats.totalSpentCents / stats.budgetCapCents) * 100).toFixed(1)}% of monthly budget used
              </p>
            </div>
          )}
        </div>
      )}

      {/* Sub-tab Navigation */}
      <div className="flex gap-1 border-b border-gray-700">
        {(["campaigns", "content", "actions", "config"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setSubTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              subTab === tab
                ? "border-blue-500 text-blue-500"
                : "border-transparent text-gray-400 hover:text-gray-300"
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {tab === "content" && stats?.pendingReviewCount ? (
              <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded-full">
                {stats.pendingReviewCount}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Campaigns View */}
      {subTab === "campaigns" && (
        <div className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-800">
              <tr>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Campaign</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Platform</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Status</th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">Spend</th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">Impressions</th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">Clicks</th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">Conv</th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">CPA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {campaigns.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No campaigns yet</td></tr>
              ) : campaigns.map((c) => (
                <tr key={c.id} className="hover:bg-gray-800/30">
                  <td className="px-4 py-3 text-white font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-gray-300">{platformIcons[c.platform] || c.platform}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 text-xs rounded-full ${statusColors[c.status] || ""}`}>{c.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">{cents(c.spentCents)}</td>
                  <td className="px-4 py-3 text-right text-gray-300">{c.impressions.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-gray-300">{c.clicks.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-gray-300">{c.conversions}</td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    {c.conversions > 0 ? cents(Math.round(c.spentCents / c.conversions)) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Content View */}
      {subTab === "content" && (
        <div className="space-y-4">
          {/* Pending Review */}
          {content.filter((c) => c.status === "pending_review").length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-yellow-500 mb-2">Pending Review</h4>
              <div className="space-y-2">
                {content.filter((c) => c.status === "pending_review").map((c) => (
                  <div key={c.id} className="bg-gray-800/50 rounded-lg border border-yellow-500/20 p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs text-gray-500">{platformIcons[c.platform] || c.platform}</span>
                          <span className="text-xs text-gray-500">{c.contentType}</span>
                        </div>
                        {c.title && <p className="text-sm font-medium text-white mb-1">{c.title}</p>}
                        <p className="text-sm text-gray-300 whitespace-pre-wrap">{c.body}</p>
                      </div>
                      <div className="flex gap-2 ml-4">
                        <button onClick={() => handleApprove(c.id)} className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded">Approve</button>
                        <button onClick={() => handleReject(c.id)} className="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded">Reject</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Published / Other */}
          <div>
            <h4 className="text-sm font-medium text-gray-400 mb-2">All Content</h4>
            <div className="space-y-2">
              {content.filter((c) => c.status !== "pending_review").map((c) => (
                <div key={c.id} className="bg-gray-800/50 rounded-lg border border-gray-700 p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-2 py-0.5 text-xs rounded-full ${statusColors[c.status] || ""}`}>{c.status}</span>
                    <span className="text-xs text-gray-500">{platformIcons[c.platform] || c.platform}</span>
                    <span className="text-xs text-gray-500">{c.contentType}</span>
                    <span className="text-xs text-gray-600 ml-auto">{new Date(c.createdAt).toLocaleDateString()}</span>
                  </div>
                  {c.title && <p className="text-sm font-medium text-white mb-1">{c.title}</p>}
                  <p className="text-sm text-gray-300 line-clamp-2">{c.body}</p>
                </div>
              ))}
              {content.filter((c) => c.status !== "pending_review").length === 0 && (
                <p className="text-center text-gray-500 py-8">No content published yet</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Actions View */}
      {subTab === "actions" && (
        <div className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-800">
              <tr>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Time</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Type</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Platform</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Description</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Auto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {actions.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No actions recorded yet</td></tr>
              ) : actions.map((a) => (
                <tr key={a.id} className="hover:bg-gray-800/30">
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{new Date(a.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 text-xs bg-gray-700 text-gray-300 rounded">{a.actionType}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{a.platform ? platformIcons[a.platform] || a.platform : "—"}</td>
                  <td className="px-4 py-3 text-gray-300 max-w-md truncate">{a.description}</td>
                  <td className="px-4 py-3">
                    {a.autoExecuted ? (
                      <span className="text-green-500 text-xs">auto</span>
                    ) : (
                      <span className="text-yellow-500 text-xs">escalated</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Config View — placeholder for full settings form */}
      {subTab === "config" && (
        <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-6">
          <p className="text-gray-400">Marketing agent configuration panel — coming in next iteration.</p>
          <p className="text-gray-500 text-sm mt-2">
            Use <code className="text-gray-400">PUT /api/marketing/config</code> to configure settings via API for now.
          </p>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Add Marketing tab to ManagementDashboard**

In `frontend/src/pages/ManagementDashboard.tsx`:

1. Add import at top:
```typescript
import { MarketingTab } from "../components/management/MarketingTab";
```

2. Add state for active tab (near other useState declarations):
```typescript
const [activeTab, setActiveTab] = useState<"overview" | "marketing">("overview");
```

3. Add tab navigation in the header area (after the title, before the main content grid). Find the header section and add tab buttons:
```tsx
<div className="flex gap-1 mb-6 border-b border-gray-700">
  <button
    onClick={() => setActiveTab("overview")}
    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      activeTab === "overview" ? "border-blue-500 text-blue-500" : "border-transparent text-gray-400 hover:text-gray-300"
    }`}
  >
    Overview
  </button>
  <button
    onClick={() => setActiveTab("marketing")}
    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      activeTab === "marketing" ? "border-blue-500 text-blue-500" : "border-transparent text-gray-400 hover:text-gray-300"
    }`}
  >
    Marketing
  </button>
</div>
```

4. Wrap the existing content in a conditional render and add Marketing tab:
```tsx
{activeTab === "overview" && (
  /* existing dashboard content */
)}
{activeTab === "marketing" && tokens?.accessToken && (
  <MarketingTab accessToken={tokens.accessToken} />
)}
```

**Step 3: Verify frontend typecheck**

Run: `cd frontend && npx tsc -b`
Expected: PASS

**Step 4: Commit**

```bash
git add frontend/src/components/management/MarketingTab.tsx frontend/src/pages/ManagementDashboard.tsx
git commit -m "feat: add Marketing tab to platform management dashboard"
```

---

### Task 9: Wire Up Route Mounting in Express App

**Files:**
- Modify: The main Express app file where routes are mounted (likely `api/src/app.ts` or `api/src/index.ts`)

**Step 1: Find where routes are mounted**

Search for where `managementRouter` is mounted — the marketing router should be mounted the same way, right next to it.

Pattern to add:
```typescript
import { marketingRouter } from "./routes/index.js";
// ...
app.use("/api/marketing", marketingRouter);
```

**Step 2: Verify typecheck**

Run: `cd api && npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add api/src/app.ts  # or wherever the mount lives
git commit -m "feat: mount /api/marketing routes in Express app"
```

---

### Task 10: Integration Verification

**Step 1: Verify full API typecheck**

Run: `cd api && npm run typecheck`
Expected: PASS — no type errors

**Step 2: Verify full frontend typecheck**

Run: `cd frontend && npx tsc -b`
Expected: PASS — no type errors

**Step 3: Verify lint passes**

Run: `cd api && npm run lint`
Run: `cd frontend && npm run lint`
Expected: PASS (or only pre-existing warnings)

**Step 4: Run API tests**

Run: `cd api && npm run test`
Expected: Existing tests still pass (new code has no tests yet — add in follow-up)

**Step 5: Final commit if any lint fixes needed**

```bash
git add -A
git commit -m "fix: lint fixes for marketing agent feature"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Migration (3 tables + 6 org columns) | 1 new, 1 modified |
| 2 | TypeORM entities + org model columns | 3 new, 3 modified |
| 3 | Channel adapter interface + 5 stubs | 7 new |
| 4 | Marketing agent executor | 1 new |
| 5 | Orchestrator cron integration | 1 modified |
| 6 | API routes (11 endpoints) | 1 new, 1 modified |
| 7 | Seed persona via Persona Studio | 1 modified |
| 8 | Frontend Marketing tab | 1 new, 1 modified |
| 9 | Wire route mounting | 1 modified |
| 10 | Integration verification | 0 files |

**Total: 14 new files, 8 modified files, 10 commits**

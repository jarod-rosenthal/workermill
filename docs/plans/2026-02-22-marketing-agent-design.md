# Marketing Agent Design

**Date:** 2026-02-22
**Status:** Approved
**Approach:** Cron Persona with Specialized In-Process Executor (Approach A)

---

## Overview

A new `marketing_agent` persona that runs on a configurable cron schedule (default: every 2 hours) within the existing orchestrator poll loop. It monitors ad campaigns, publishes routine content autonomously, adjusts bids, and escalates big decisions (new campaigns, blog posts, budget changes) for human review on the platform management dashboard.

**Key constraints:**

- **Persona Studio is source of truth** — persona, directives, and scripts managed through Persona Studio
- **Platform org only** — persona scoped to platform org ID (not system-wide `null`), cron checks `isPlatformOrg`, routes check `isPlatformAdmin`, dashboard tab gated by `isPlatformOrg`
- **In-process executor** — follows `support-agent-executor.ts` pattern, no ECS/Docker overhead
- **Developer-focused ad platforms** — Google Ads, Reddit, X/Twitter, GitHub Sponsors, Dev.to, Hacker News
- **$1,000–3,000/mo budget** — moderate spend across 3-4 platforms with A/B testing and retargeting
- **Auto-publish with guardrails** — routine content auto-publishes, big decisions queue for review

---

## Persona Definition

| Field | Value |
|-------|-------|
| slug | `marketing_agent` |
| name | Marketing Agent |
| emoji | 📣 |
| orgId | Platform org ID (NOT null) |
| priority | 16 |
| riskLevel | `medium` |
| isSystem | `false` (org-specific to platform) |
| skills | `["content-marketing", "paid-ads", "analytics", "social-media", "seo", "copywriting"]` |
| keywordPattern | — (not triggered by labels) |

Directives and scripts created through Persona Studio. The executor fetches the persona bundle at runtime via `getPersonaBundle()`.

---

## Mission Loop

Every mission run (default: every 2 hours), the agent executes this cycle:

1. **Monitor** — Pull campaign metrics from all connected ad platforms, check blog post performance, review social engagement
2. **Analyze** — Compare spend vs. conversions, identify underperforming campaigns, spot opportunities
3. **Act** — Auto-publish routine content, adjust bids on underperforming ads, pause campaigns hitting spend limits
4. **Escalate** — Queue new campaign proposals, blog post drafts, and budget reallocations above threshold for review
5. **Report** — Write summary of actions taken + metrics to DB

### Guardrail Tiers

| Action | Auto-execute? | Escalation threshold |
|--------|--------------|---------------------|
| Publish tweet/social post | Yes | — |
| Adjust ad bid (<configurable % change) | Yes | Default 15% |
| Pause underperforming ad (CPA > ceiling) | Yes | Default $20 CPA |
| New blog post draft | No — queue for review | Always |
| New campaign proposal | No — queue for review | Always |
| Budget reallocation (> threshold) | No — queue for review | Default $100 |
| Increase daily spend cap | No — queue for review | Always |

---

## Data Model

### MarketingCampaign

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| orgId | UUID FK → organizations | |
| platform | varchar | `google_ads`, `reddit`, `x`, `github`, `devto`, `hackernews` |
| name | varchar | |
| status | varchar | `active`, `paused`, `pending_review`, `completed`, `rejected` |
| budgetCents | int | Allocated budget for this campaign |
| spentCents | int | Running total pulled from platform APIs |
| impressions | int | |
| clicks | int | |
| conversions | int | |
| targetingConfig | jsonb | Platform-specific targeting params |
| createdAt | timestamp | |
| updatedAt | timestamp | |

### MarketingContent

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| orgId | UUID FK → organizations | |
| campaignId | UUID FK → marketing_campaigns | Nullable |
| platform | varchar | `x`, `reddit`, `devto`, `blog`, `hackernews` |
| contentType | varchar | `tweet`, `post`, `article`, `ad_copy` |
| title | varchar | Nullable |
| body | text | |
| status | varchar | `draft`, `pending_review`, `approved`, `published`, `rejected` |
| publishedAt | timestamp | Nullable |
| engagementMetrics | jsonb | Likes, shares, comments, etc. |
| externalId | varchar | ID on the external platform, nullable |
| createdAt | timestamp | |
| updatedAt | timestamp | |

### MarketingAction

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| orgId | UUID FK → organizations | |
| missionRunId | varchar | Groups actions from same cron run |
| actionType | varchar | `publish`, `bid_adjust`, `pause`, `resume`, `create_campaign`, `report` |
| platform | varchar | |
| description | text | Human-readable summary |
| details | jsonb | Structured data (old bid, new bid, etc.) |
| autoExecuted | boolean | True if within guardrails |
| createdAt | timestamp | |

### Organization Model Additions

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `marketing_agent_enabled` | boolean | `false` | Master toggle |
| `marketing_agent_interval_minutes` | int | `120` | Cron interval |
| `marketing_agent_config` | jsonb | `{}` | All other settings (see Settings section) |
| `marketing_channel_credentials` | jsonb | `{}` | Encrypted API keys per platform |
| `marketing_monthly_budget_cents` | int | `0` | Hard monthly ceiling |
| `marketing_escalation_threshold_cents` | int | `10000` | Auto-approve spend threshold ($100) |

---

## Complete Settings Surface

All exposed in the Marketing Agent Config section of the platform management dashboard.

### Agent Behavior

| Setting | Type | Default | Storage |
|---------|------|---------|---------|
| Enabled | toggle | `false` | org column |
| Mission interval (minutes) | number input | `120` | org column |
| Mission time window | time range | `06:00-22:00 UTC` | config jsonb |
| Max missions per day | number | `12` | config jsonb |
| AI model | dropdown | inherited from `providerRouting` | org `providerRouting` |
| Content voice/tone guidelines | textarea | `""` | config jsonb |
| Brand keywords (always include) | tag list | `[]` | config jsonb |
| Competitor keywords (monitor) | tag list | `[]` | config jsonb |

### Budget & Spend Controls

| Setting | Type | Default | Storage |
|---------|------|---------|---------|
| Monthly budget cap | currency input | `$0` | org column |
| Daily spend limit | currency input | `$0` (= monthly/30) | config jsonb |
| Per-campaign max spend | currency input | `$0` (no cap) | config jsonb |
| Auto-approve spend threshold | currency input | `$100` | org column |
| Pause all campaigns at % of monthly | slider | `90%` | config jsonb |
| Budget alert email threshold | slider | `75%` | config jsonb |

### Guardrails & Escalation

| Setting | Type | Default | Storage |
|---------|------|---------|---------|
| Auto-publish routine content | toggle | `true` | config jsonb |
| Auto-adjust bids | toggle | `true` | config jsonb |
| Max bid adjustment % (auto) | slider | `15%` | config jsonb |
| Auto-pause underperformers | toggle | `true` | config jsonb |
| CPA ceiling (auto-pause trigger) | currency input | `$20` | config jsonb |
| New campaigns require approval | toggle | `true` (locked on) | config jsonb |
| Blog posts require approval | toggle | `true` (locked on) | config jsonb |
| Budget increases require approval | toggle | `true` (locked on) | config jsonb |

### Per-Channel Settings

Each enabled channel gets its own section:

| Setting | Type | Default | Storage |
|---------|------|---------|---------|
| Enabled | toggle | `false` | channel credentials jsonb |
| API key / token | password input | — | channel credentials jsonb |
| Daily post limit | number | varies by platform | config jsonb |
| Targeting config | platform-specific form | `{}` | config jsonb |
| Default bid strategy | dropdown (CPC/CPM/CPA) | `CPC` | config jsonb |
| Max CPC / CPM | currency input | — | config jsonb |

### Notification Settings

| Setting | Type | Default | Storage |
|---------|------|---------|---------|
| Email on pending review items | toggle | `true` | config jsonb |
| Email on budget alert | toggle | `true` | config jsonb |
| Email on campaign auto-paused | toggle | `true` | config jsonb |
| Daily summary email | toggle | `true` | config jsonb |
| Daily summary time | time picker | `09:00 UTC` | config jsonb |

Top-level settings live as org columns (orchestrator reads them directly). Everything else in `marketing_agent_config` JSONB — new settings can be added without migrations.

---

## Executor

**File:** `api/src/services/marketing-agent-executor.ts`

Follows the `support-agent-executor.ts` in-process pattern:

```
executeMarketingAgentMission(org: Organization)
├── Generate missionRunId (UUID)
├── Fetch persona bundle from Persona Studio (slug: "marketing_agent", orgId: org.id)
├── Build context:
│   ├── Active campaigns with latest metrics
│   ├── Recent content (last 48h)
│   ├── Last mission run summary
│   ├── Pending review items
│   ├── Current budget status (spent vs. cap)
│   └── Platform-specific metrics from channel adapters
├── Call Claude with persona directive + current state + mission instructions
│   └── Response: structured JSON array of proposed actions
├── For each proposed action:
│   ├── Check guardrails (auto-execute threshold)
│   ├── If within guardrails → execute immediately via channel adapter
│   ├── If exceeds guardrails → create record with status "pending_review"
│   └── Log to MarketingAction (autoExecuted: true/false)
├── Pull latest metrics from all connected platforms
├── Update MarketingCampaign counters (spend, impressions, clicks, conversions)
└── Log mission summary to MarketingAction (actionType: "report")
```

Error handling: full error logged to MarketingAction, agent does not crash orchestrator.

---

## Cron Integration

Timer check in the existing orchestrator poll loop (`api/src/services/orchestrator.ts`):

```typescript
let lastMarketingAgentRun = 0;

// Inside pollLoop():
const now = Date.now();
const platformOrg = await Organization.getPlatformOrg();
if (
  platformOrg?.marketingAgentEnabled &&
  now - lastMarketingAgentRun > platformOrg.marketingAgentIntervalMinutes * 60 * 1000
) {
  // Check time window
  const hour = new Date().getUTCHours();
  const [start, end] = parseTimeWindow(platformOrg.marketingAgentConfig.missionTimeWindow);
  if (hour >= start && hour < end) {
    lastMarketingAgentRun = now;
    executeMarketingAgentMission(platformOrg).catch(err =>
      logger.error("Marketing agent mission failed", { error: err.message })
    );
  }
}
```

Non-blocking — runs async, does not block poll loop. Errors logged but never crash the orchestrator.

---

## Channel Adapters

**Directory:** `api/src/services/marketing-channels/`

```
marketing-channels/
├── base-channel.ts          — interface definition
├── google-ads-channel.ts
├── reddit-channel.ts
├── x-channel.ts
├── devto-channel.ts
└── hackernews-channel.ts
```

**Interface:**

```typescript
interface MarketingChannel {
  platform: string;
  fetchMetrics(campaignId: string): Promise<CampaignMetrics>;
  publish(content: MarketingContent): Promise<{ externalId: string }>;
  adjustBid(campaignId: string, newBidCents: number): Promise<void>;
  pauseCampaign(campaignId: string): Promise<void>;
  resumeCampaign(campaignId: string): Promise<void>;
  createCampaign(config: CampaignConfig): Promise<{ externalId: string }>;
}
```

The executor iterates over enabled channels from `marketingChannelCredentials` and instantiates the appropriate adapter.

---

## API Routes

**File:** `api/src/routes/marketing.ts`

All routes gated by `isPlatformAdmin` middleware — invisible to regular orgs.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/marketing/campaigns` | List campaigns (filterable by platform, status) |
| GET | `/api/marketing/campaigns/:id` | Campaign detail with daily metrics |
| GET | `/api/marketing/content` | List content (filterable by status, platform) |
| GET | `/api/marketing/content/:id` | Content detail |
| POST | `/api/marketing/content/:id/approve` | Approve pending content → publish |
| POST | `/api/marketing/content/:id/reject` | Reject pending content |
| GET | `/api/marketing/actions` | Action log (filterable by mission run, type) |
| GET | `/api/marketing/stats` | Aggregate: spend, conversions, ROI, by platform |
| GET | `/api/marketing/config` | Current marketing agent config |
| PUT | `/api/marketing/config` | Update marketing agent config |
| POST | `/api/marketing/run-now` | Trigger immediate mission run |

---

## Platform Dashboard UI

New **"Marketing" tab** on the platform management dashboard (`ManagementDashboard.tsx`), gated by `isPlatformOrg`.

### Three Sub-Views

**1. Campaign Overview (default)**
- Active campaigns: status, platform, spend-to-date, impressions, clicks, conversions, CPA
- Sparkline charts for daily spend and conversion trends
- Color-coded health: green (on track), yellow (underperforming), red (paused/over budget)
- Budget summary bar at top: Monthly cap / Spent / Remaining / %

**2. Content Feed**
- Pending review items at top with inline Approve/Reject buttons
- Timeline of published content with engagement metrics
- Status badges: `published`, `pending_review`, `rejected`, `scheduled`
- Click to preview full content

**3. Action Log**
- Every action from each mission run
- Collapsible sections per mission run with summary header
- Filterable by action type, platform, date range

### Settings Section

Accessible from Marketing tab or platform Settings. Full form for all settings listed in the Settings Surface section above. Organized into collapsible groups: Agent Behavior, Budget & Spend, Guardrails, Channel Config (per platform), Notifications.

---

## Migration Plan

Single migration file: `AddMarketingAgent`

1. Create `marketing_campaigns` table
2. Create `marketing_content` table
3. Create `marketing_actions` table
4. Add org columns: `marketing_agent_enabled`, `marketing_agent_interval_minutes`, `marketing_agent_config`, `marketing_channel_credentials`, `marketing_monthly_budget_cents`, `marketing_escalation_threshold_cents`
5. Seed `marketing_agent` persona via Persona Studio (scoped to platform org)

All tables use `IF NOT EXISTS` for idempotency. All org columns use `IF NOT EXISTS` guard.

---

## File Inventory

### New Files

| File | Purpose |
|------|---------|
| `api/src/models/MarketingCampaign.ts` | Campaign entity |
| `api/src/models/MarketingContent.ts` | Content entity |
| `api/src/models/MarketingAction.ts` | Action log entity |
| `api/src/services/marketing-agent-executor.ts` | In-process executor |
| `api/src/services/marketing-channels/base-channel.ts` | Channel adapter interface |
| `api/src/services/marketing-channels/google-ads-channel.ts` | Google Ads adapter |
| `api/src/services/marketing-channels/reddit-channel.ts` | Reddit adapter |
| `api/src/services/marketing-channels/x-channel.ts` | X/Twitter adapter |
| `api/src/services/marketing-channels/devto-channel.ts` | Dev.to adapter |
| `api/src/services/marketing-channels/hackernews-channel.ts` | Hacker News adapter |
| `api/src/routes/marketing.ts` | Marketing API routes |
| `api/src/db/migrations/XXXX-AddMarketingAgent.ts` | Migration |
| `frontend/src/components/management/MarketingTab.tsx` | Dashboard Marketing tab |
| `frontend/src/components/management/MarketingConfig.tsx` | Settings form |
| `frontend/src/components/management/CampaignOverview.tsx` | Campaign view |
| `frontend/src/components/management/ContentFeed.tsx` | Content feed view |
| `frontend/src/components/management/ActionLog.tsx` | Action log view |

### Modified Files

| File | Change |
|------|--------|
| `api/src/models/Organization.ts` | Add 6 marketing columns |
| `api/src/services/orchestrator.ts` | Add marketing agent cron timer |
| `api/src/db/connection.ts` | Register migration + new entities |
| `api/src/routes/index.ts` | Mount `/api/marketing` routes |
| `api/src/db/seeds/seed-personas.ts` | Add marketing_agent persona seed (platform org scoped) |
| `frontend/src/pages/ManagementDashboard.tsx` | Add Marketing tab |

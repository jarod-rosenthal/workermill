# Pricing Tiers Design — Free / Pro / Enterprise

**Date:** 2026-02-15
**Status:** Approved
**Goal:** Launch-ready pricing with generous free tier for community-led growth

---

## Strategy

### Growth Model: Community-Led

WorkerMill's free tier runs entirely on user hardware (Claude Max/Pro subscription or BYOK API keys). The marginal cost per free user is **near zero**. This structural advantage means we can be far more generous than typical SaaS free tiers.

**Core principle:** Make the solo developer experience as unrestricted as possible. Monetize team collaboration, scale (parallelism), and cloud execution convenience.

**Industry precedent:** Slack (free forever, pay for history/SSO), Linear (generous free, pay for team features), GitHub (unlimited repos free, pay for Actions/teams).

### Upgrade Triggers

The free tier creates natural upgrade pressure through:

1. **Parallelism** — 1 concurrent worker, 3 experts. Power users hit this fast when juggling multiple tickets.
2. **Team** — 1 user. The moment a second developer needs access, they upgrade.
3. **Cloud execution** — Free = local only. Pro = cloud ECS containers for hands-off execution.
4. **Retention** — 14-day logs are enough to use the product, not enough for compliance/debugging history.

### Launch Discount

- Standard Pro price: **$29/month**
- Launch price: **$14.50/month** (50% off)
- Implemented as a Stripe coupon applied at checkout during launch period

---

## Tier Definitions

### Free — $0/forever

For solo developers exploring AI-powered development. Full product experience with soft scale caps.

| Feature | Limit |
|---------|-------|
| Tasks | **Unlimited** |
| Users | 1 |
| Concurrent worker containers | 1 |
| Expert personas per task | 3 |
| AI providers | **Anthropic Claude only** |
| Execution modes | Local + BYOK |
| Cloud execution (ECS) | No |
| Warm container pool | No |
| All integrations (Jira, GitHub, GitLab, Bitbucket, Linear) | Yes |
| All 14+ personas | Yes |
| Codebase RAG | Yes |
| MCP servers | Yes |
| Tech lead review | Every PR |
| Analytics | Basic |
| Memory & skills persistence | No |
| Role-based access | No |
| Log retention | 14 days |
| Support | Community |

### Pro — ~~$29~~ $14.50/month (launch price)

Up to 5 seats included. For developers and small teams who want speed and collaboration.

| Feature | Limit |
|---------|-------|
| Tasks | **Unlimited** |
| Users | Up to 5 |
| Concurrent worker containers | 5 |
| Expert personas per task | **Unlimited** |
| AI providers | **All (OpenAI, Google, Ollama + Anthropic)** |
| Execution modes | Local + BYOK + **Cloud** |
| Cloud execution (ECS) | Yes |
| Warm container pool | Yes |
| All integrations | Yes |
| All 14+ personas | Yes |
| Codebase RAG | Yes |
| MCP servers | Yes |
| Tech lead review | Configurable (on/off) |
| Analytics | **Advanced** |
| Memory & skills persistence | **Yes** |
| Role-based access | **Yes** |
| Log retention | **90 days** |
| Support | **Priority (< 4hr)** |

### Enterprise — Custom pricing

For organizations with compliance, security, and scale requirements.

| Feature | Details |
|---------|---------|
| Everything in Pro | Yes |
| Users | **Unlimited** |
| Concurrent worker containers | **Unlimited** |
| Self-hosted option | Yes |
| SSO / SAML | Yes |
| Dedicated worker pool | Yes |
| IP allowlisting | Yes |
| Data residency controls | Yes |
| AWS Bedrock / Azure AI Foundry | Yes |
| Compliance Center | Yes |
| SOC 2 Report | Available |
| SLA | 99.9% |
| Log retention | **Unlimited** |
| Support | Dedicated CSM |

---

## Implementation Changes Required

### 1. Backend — Simplify plan types

**File:** `api/src/models/Organization.ts`

- Change `OrganizationPlan` type from `"free" | "starter" | "team" | "business" | "pro" | "enterprise"` to `"free" | "pro" | "enterprise"`
- Deprecate `starter`, `team`, `business` plans — migrate existing orgs or map them to `pro`
- Remove `PLAN_HOURS` and `PLAN_QUOTAS` constants (no longer hour/task-based billing)
- Update `PLAN_USER_LIMITS`: `{ free: 1, pro: 5, enterprise: -1 }`
- Update `PLAN_PRICES`: `{ free: 0, pro: 29, enterprise: 0 }`
- Remove `PLAN_OVERAGE_RATES` (no overage model in new pricing)

Add new plan-enforced constants:

```typescript
export const PLAN_MAX_CONCURRENT_WORKERS: Record<OrganizationPlan, number> = {
  free: 1,
  pro: 5,
  enterprise: -1,  // Unlimited
};

export const PLAN_MAX_PARALLEL_EXPERTS: Record<OrganizationPlan, number> = {
  free: 3,
  pro: -1,   // Unlimited
  enterprise: -1,
};

export const PLAN_LOG_RETENTION_DAYS: Record<OrganizationPlan, number> = {
  free: 14,
  pro: 90,
  enterprise: -1,  // Unlimited
};

export const PLAN_CLOUD_EXECUTION: Record<OrganizationPlan, boolean> = {
  free: false,
  pro: true,
  enterprise: true,
};

export const PLAN_WARM_POOL: Record<OrganizationPlan, boolean> = {
  free: false,
  pro: true,
  enterprise: true,
};

export const PLAN_FEATURES: Record<OrganizationPlan, {
  advancedAnalytics: boolean;
  memoryPersistence: boolean;
  roleBasedAccess: boolean;
  ssoSaml: boolean;
  configurableTechLead: boolean;
}> = {
  free: {
    advancedAnalytics: false,
    memoryPersistence: false,
    roleBasedAccess: false,
    ssoSaml: false,
    configurableTechLead: false,
  },
  pro: {
    advancedAnalytics: true,
    memoryPersistence: true,
    roleBasedAccess: true,
    ssoSaml: false,
    configurableTechLead: true,
  },
  enterprise: {
    advancedAnalytics: true,
    memoryPersistence: true,
    roleBasedAccess: true,
    ssoSaml: true,
    configurableTechLead: true,
  },
};
```

### 2. Backend — Enforce plan gates

**File:** `api/src/services/billing.ts`

- Replace `canCreateTask()` hour/quota logic with feature-gate checks:
  - Check `maxConcurrentWorkers` against `PLAN_MAX_CONCURRENT_WORKERS[org.plan]`
  - Block cloud execution for free plan
- Remove hour-based usage tracking and overage calculation

**File:** `api/src/services/task-claimer.ts`

- Enforce `PLAN_MAX_CONCURRENT_WORKERS` when claiming tasks
- Enforce `PLAN_MAX_PARALLEL_EXPERTS` when spawning experts

**File:** `api/src/services/local-epic-spawner.ts` and `worker-spawner.ts`

- Pass plan-based `maxParallelExperts` to worker containers
- Block cloud spawning for free-plan orgs

### 3. Backend — Stripe changes

**File:** `api/src/routes/billing.ts`

- Remove `starter`, `team`, `business` price IDs
- Single `STRIPE_PRICE_PRO` price ID
- Create a Stripe coupon for 50% off launch discount
- Apply coupon automatically during launch period at checkout

**File:** `api/src/routes/auth.ts` (Stripe webhooks)

- Simplify webhook handlers for 3-plan model
- Map any legacy `starter`/`team`/`business` subscriptions to `pro`

### 4. Backend — Migration

- Database migration to update existing orgs:
  - `starter` → `pro`
  - `team` → `pro`
  - `business` → `pro` (or `enterprise` if they were paying $199+)
  - `pro` → `pro` (no change)
- Set `logRetentionDays` based on new plan defaults
- Set `maxConcurrentWorkers` and `maxParallelExperts` based on new plan limits

### 5. Frontend — Pricing page

**File:** `frontend/src/pages/Home/Pricing.tsx`

- Reduce to 3 tiers: Free / Pro / Enterprise
- Pro shows ~~$29~~ $14.50/mo with "Launch Price" badge and strikethrough
- Pro CTA: enabled (links to signup/checkout, no longer "Coming Soon")
- Enterprise CTA: "Contact Sales"
- Update feature lists to match tier definitions above

### 6. Frontend — Billing page

**File:** `frontend/src/pages/Billing.tsx`

- Simplify plan display for 3 tiers
- Remove hours-based usage display
- Show concurrent workers used / limit instead
- Show experts per task limit
- Remove overage rate display

### 7. Frontend — Settings

- Gate "Warm Pool" settings behind pro+ plan
- Gate "Role-based access" settings behind pro+ plan
- Show upgrade prompts for gated features on free plan

### 8. API routes — Plan gates endpoint

**File:** `api/src/routes/billing.ts`

- New `GET /api/billing/plan-features` endpoint that returns the full feature set for the org's current plan
- Frontend uses this to show/hide features and upgrade prompts

---

## What Does NOT Change

- Task orchestration (database polling, atomic claim)
- Log streaming (PostgreSQL + SSE)
- Worker entrypoint and execution
- LLM model selection (stays as org setting, not plan-gated)
- All 14+ personas available on all plans
- All SCM integrations available on all plans
- Codebase RAG available on all plans
- MCP servers available on all plans
- Referral program (adjust to new tier names)
- Credit billing system (remains as alternative payment method for Pro)

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Existing paid users on deprecated plans | Migration maps them to Pro (equal or better value) |
| Free users abusing unlimited tasks | Cost is near-zero (runs on their hardware). Monitor for API abuse only. |
| Launch discount creates revenue pressure | 50% off is temporary. Early adopters become advocates. |
| 3 experts feels limiting on free | It's enough to complete real tasks. The constraint is speed, not capability. |
| Enterprise has no self-serve path | "Contact Sales" CTA + intake form. Standard for enterprise SaaS. |

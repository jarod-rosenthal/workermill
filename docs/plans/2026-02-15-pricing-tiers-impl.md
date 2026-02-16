# Pricing Tiers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate 6 legacy plan types into 3 clean tiers (Free/Pro/Enterprise) with consistent feature gating across backend, frontend, docs, and database.

**Architecture:** Replace hour-based billing constants with feature-gate constants. Simplify `OrganizationPlan` type. Update all UI surfaces (pricing page, billing page, docs, settings, landing page) to reflect 3-tier model. Migrate existing orgs via DB migration.

**Tech Stack:** TypeScript, Express, React, TypeORM, PostgreSQL, Stripe, TailwindCSS

---

### Task 1: Update Organization model — plan types and constants

**Files:**
- Modify: `api/src/models/Organization.ts` (lines 12-73)

**Step 1: Replace OrganizationPlan type**

Change line 12 from:
```typescript
export type OrganizationPlan = "free" | "starter" | "team" | "business" | "pro" | "enterprise";
```
to:
```typescript
export type OrganizationPlan = "free" | "pro" | "enterprise";
```

**Step 2: Replace all PLAN_* constants**

Remove `PLAN_HOURS`, `PLAN_QUOTAS`, `PLAN_PRICES`, `PLAN_OVERAGE_RATES`. Replace with new feature-gate constants:

```typescript
// Plan user limits
export const PLAN_USER_LIMITS: Record<OrganizationPlan, number> = {
  free: 1,
  pro: 5,
  enterprise: -1,  // Unlimited
};

// Plan prices (monthly, in dollars)
export const PLAN_PRICES: Record<OrganizationPlan, number> = {
  free: 0,
  pro: 29,
  enterprise: 0,  // Custom pricing
};

// Max concurrent worker containers
export const PLAN_MAX_WORKERS: Record<OrganizationPlan, number> = {
  free: 1,
  pro: 5,
  enterprise: -1,  // Unlimited
};

// Max parallel expert personas per task
export const PLAN_MAX_EXPERTS: Record<OrganizationPlan, number> = {
  free: 3,
  pro: -1,   // Unlimited
  enterprise: -1,
};

// Log retention in days (-1 = unlimited)
export const PLAN_LOG_RETENTION: Record<OrganizationPlan, number> = {
  free: 14,
  pro: 90,
  enterprise: -1,
};

// Feature flags per plan
export const PLAN_FEATURES: Record<OrganizationPlan, {
  cloudExecution: boolean;
  warmPool: boolean;
  advancedAnalytics: boolean;
  memoryPersistence: boolean;
  roleBasedAccess: boolean;
  ssoSaml: boolean;
  configurableTechLead: boolean;
  complianceCenter: boolean;
  dedicatedWorkerPool: boolean;
  dataResidency: boolean;
}> = {
  free: {
    cloudExecution: false,
    warmPool: false,
    advancedAnalytics: false,
    memoryPersistence: false,
    roleBasedAccess: false,
    ssoSaml: false,
    configurableTechLead: false,
    complianceCenter: false,
    dedicatedWorkerPool: false,
    dataResidency: false,
  },
  pro: {
    cloudExecution: true,
    warmPool: true,
    advancedAnalytics: true,
    memoryPersistence: true,
    roleBasedAccess: true,
    ssoSaml: false,
    configurableTechLead: true,
    complianceCenter: false,
    dedicatedWorkerPool: false,
    dataResidency: false,
  },
  enterprise: {
    cloudExecution: true,
    warmPool: true,
    advancedAnalytics: true,
    memoryPersistence: true,
    roleBasedAccess: true,
    ssoSaml: true,
    configurableTechLead: true,
    complianceCenter: true,
    dedicatedWorkerPool: true,
    dataResidency: true,
  },
};
```

**Step 3: Run typecheck**

Run: `cd api && npm run typecheck`
Expected: Type errors in files that reference removed constants or old plan names. This is expected — we fix them in subsequent tasks.

**Step 4: Commit**

```bash
git add api/src/models/Organization.ts
git commit -m "feat: consolidate plan types to free/pro/enterprise with feature gates"
```

---

### Task 2: Fix all TypeScript references to old plan types

**Files:**
- Modify: `api/src/models/index.ts` — update exports
- Modify: `api/src/services/billing.ts` — PRICE_IDS, canCreateTask, imports
- Modify: `api/src/routes/billing.ts` — /plans endpoint, /subscription, /checkout, imports
- Modify: `api/src/routes/auth.ts` — Stripe webhook handler plan mapping
- Modify: `api/src/config/index.ts` — Stripe price config
- Modify: `api/src/services/audit.ts` — if it references plan constants
- Modify: `api/src/routes/compliance.ts` — if it references plan names
- Modify: `api/src/routes/personas.ts` — if it references plan names
- Modify: `api/src/config/swagger.ts` — if it references plan names

**Step 1: Update `api/src/models/index.ts`**

Update exports to include new constants (`PLAN_MAX_WORKERS`, `PLAN_MAX_EXPERTS`, `PLAN_LOG_RETENTION`, `PLAN_FEATURES`) and remove old ones (`PLAN_HOURS`, `PLAN_QUOTAS`, `PLAN_OVERAGE_RATES`). Keep `PLAN_USER_LIMITS` and `PLAN_PRICES`.

**Step 2: Update `api/src/config/index.ts`**

Simplify Stripe prices config (lines 142-149) to only have `pro` and `enterprise`:
```typescript
prices: {
  pro: process.env.STRIPE_PRICE_PRO || "price_pro",
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE || "price_enterprise",
},
```

**Step 3: Update `api/src/services/billing.ts`**

Replace `PRICE_IDS` (lines 35-42) with:
```typescript
const PRICE_IDS: Record<OrganizationPlan, string | null> = {
  free: null,
  pro: config.stripe?.prices?.pro || "",
  enterprise: config.stripe?.prices?.enterprise || null,
};
```

Remove import of `PLAN_QUOTAS`. Update `canCreateTask()` to remove hour-based logic — free plan always allowed (unlimited tasks), just enforce concurrent worker limits in task-claimer instead.

**Step 4: Update `api/src/routes/billing.ts`**

Remove imports of `PLAN_HOURS`, `PLAN_QUOTAS`, `PLAN_OVERAGE_RATES`. Add imports of `PLAN_MAX_WORKERS`, `PLAN_MAX_EXPERTS`, `PLAN_LOG_RETENTION`, `PLAN_FEATURES`.

Update `/subscription` endpoint (lines 87-184): Remove hour-based usage calculation. Return plan features, worker limits, expert limits instead.

Replace `/plans` endpoint (lines 186-262) with 3-tier response:
```typescript
const plans = [
  {
    id: "free",
    name: "Free",
    price: 0,
    userLimit: 1,
    maxWorkers: 1,
    maxExperts: 3,
    logRetention: 14,
    features: [
      "Unlimited tasks",
      "1 concurrent worker",
      "3 expert personas per task",
      "All integrations (Jira, GitHub, GitLab, Bitbucket, Linear)",
      "All 14+ personas",
      "Local + BYOK execution",
      "Codebase RAG",
      "MCP servers",
      "Basic analytics",
      "14-day log retention",
      "Community support",
    ],
    planFeatures: PLAN_FEATURES.free,
  },
  {
    id: "pro",
    name: "Pro",
    price: 29,
    launchPrice: 14.50,
    userLimit: 5,
    maxWorkers: 5,
    maxExperts: -1,
    logRetention: 90,
    highlighted: true,
    badge: "Launch Price",
    features: [
      "Everything in Free, plus:",
      "5 concurrent workers",
      "Unlimited expert personas",
      "Cloud execution (ECS)",
      "Warm container pool",
      "Advanced analytics",
      "Memory & skills persistence",
      "Role-based access",
      "Configurable tech lead review",
      "90-day log retention",
      "Priority support (< 4hr)",
    ],
    planFeatures: PLAN_FEATURES.pro,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: null,
    userLimit: -1,
    maxWorkers: -1,
    maxExperts: -1,
    logRetention: -1,
    features: [
      "Everything in Pro, plus:",
      "Unlimited users",
      "Unlimited concurrent workers",
      "Self-hosted option",
      "SSO / SAML",
      "Dedicated worker pool",
      "IP allowlisting",
      "Data residency controls",
      "AWS Bedrock / Azure AI Foundry",
      "Compliance Center",
      "SOC 2 Report",
      "99.9% SLA",
      "Unlimited log retention",
      "Dedicated CSM",
    ],
    planFeatures: PLAN_FEATURES.enterprise,
  },
];
```

Update `/checkout` validation (line 339): Change `.isIn(["starter", "pro", "enterprise"])` to `.isIn(["pro"])` (enterprise is contact-sales, free needs no checkout).

**Step 5: Update `api/src/routes/auth.ts`**

In Stripe webhook handlers, map any legacy plan names to new ones:
- `starter` → `pro`
- `team` → `pro`
- `business` → `pro`
- `pro` → `pro`

**Step 6: Run typecheck**

Run: `cd api && npm run typecheck`
Expected: PASS (all type errors resolved)

**Step 7: Commit**

```bash
git add api/src/
git commit -m "feat: update all API references to 3-tier plan model"
```

---

### Task 3: Database migration — consolidate existing orgs

**Files:**
- Create: `api/src/db/migrations/XXXX-ConsolidatePlansToThreeTiers.ts`
- Modify: `api/src/db/connection.ts` — register migration

**Step 1: Create migration**

Run: `cd api && npm run migrate:create ConsolidatePlansToThreeTiers`

**Step 2: Write migration**

```typescript
import { MigrationInterface, QueryRunner } from "typeorm";

export class ConsolidatePlansToThreeTiers1739XXXXXX implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Map legacy plans to new tiers
    // starter, team, business, pro → pro (equal or better value)
    await queryRunner.query(`
      UPDATE organizations
      SET plan = 'pro'
      WHERE plan IN ('starter', 'team', 'business', 'pro')
    `);

    // Update plan-based defaults for free orgs
    await queryRunner.query(`
      UPDATE organizations
      SET "logRetentionDays" = 14,
          "maxConcurrentWorkers" = 1,
          "maxParallelExperts" = 3
      WHERE plan = 'free'
    `);

    // Update plan-based defaults for pro orgs
    await queryRunner.query(`
      UPDATE organizations
      SET "logRetentionDays" = GREATEST("logRetentionDays", 90),
          "maxConcurrentWorkers" = GREATEST("maxConcurrentWorkers", 5),
          "maxParallelExperts" = GREATEST("maxParallelExperts", 8)
      WHERE plan = 'pro'
    `);

    // Enterprise orgs keep their existing (likely higher) limits
    await queryRunner.query(`
      UPDATE organizations
      SET "logRetentionDays" = -1
      WHERE plan = 'enterprise'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Cannot reverse plan consolidation — would need manual mapping
    // Just log a warning
    console.warn("Cannot reverse plan consolidation — manual intervention required");
  }
}
```

**Step 3: Register migration in `api/src/db/connection.ts`**

Import the migration and add to the `migrations` array.

**Step 4: Commit**

```bash
git add api/src/db/migrations/ api/src/db/connection.ts
git commit -m "feat: add migration to consolidate plans to free/pro/enterprise"
```

---

### Task 4: Update frontend Pricing page

**Files:**
- Modify: `frontend/src/pages/Home/Pricing.tsx` (complete rewrite of tiers array and "How Pricing Works" section)

**Step 1: Replace tiers array (lines 17-101)**

3 tiers: Free, Pro (with launch discount + strikethrough), Enterprise. Feature lists must match design doc exactly. Pro gets `highlighted: true` and `badge: "Launch Price"`. Pro and Enterprise CTAs are enabled (not "Coming Soon").

Free features:
- Unlimited tasks
- 1 user
- 1 concurrent worker
- 3 expert personas per task
- Local + BYOK execution
- All integrations
- All 14+ personas
- Codebase RAG
- MCP servers
- Basic analytics
- 14-day log retention
- Community support

Pro features (~~$29~~ $14.50/mo, "Launch Price" badge):
- Everything in Free, plus:
- Up to 5 users
- 5 concurrent workers
- Unlimited expert personas
- Cloud execution
- Warm container pool
- Advanced analytics
- Memory & skills persistence
- Role-based access
- 90-day log retention
- Priority support (< 4hr)

Enterprise features (Custom, Contact Sales):
- Everything in Pro, plus:
- Unlimited users & workers
- Self-hosted option
- SSO / SAML
- Dedicated worker pool
- IP allowlisting
- Data residency controls
- AWS Bedrock / Azure AI Foundry
- Compliance Center & SOC 2
- 99.9% SLA
- Unlimited log retention
- Dedicated CSM

**Step 2: Update pricing display**

Pro tier price should show strikethrough original price: `<span className="line-through text-muted-foreground text-2xl">$29</span>` followed by `<span className="text-4xl font-bold text-primary">$14.50</span>`.

**Step 3: Update "How Pricing Works" section (lines 218-242)**

Replace 3 columns with:
1. "Free = Full Product" — All features, your hardware, our orchestration. Unlimited tasks.
2. "Pro = Speed + Team" — 5x parallel workers, cloud execution, 5 seats, memory persistence.
3. "BYOK Always Included" — Bring your own API keys on any plan. Zero markup on AI provider costs.

**Step 4: Update referral program text (lines 244-270)**

Change "on any paid plan" to "on Pro plan" since there are only 2 purchasable tiers.

**Step 5: Run frontend typecheck**

Run: `cd frontend && npx tsc -b`
Expected: PASS

**Step 6: Commit**

```bash
git add frontend/src/pages/Home/Pricing.tsx
git commit -m "feat: update pricing page to 3-tier model with launch discount"
```

---

### Task 5: Update frontend Billing page

**Files:**
- Modify: `frontend/src/pages/Billing.tsx`

**Step 1: Remove hours-based usage display**

The billing page currently shows "Hours Used", "Hours Remaining", overage hours, and overage cost. Replace with:
- Current Plan card (name, price, user limit)
- Workers card: "X / Y concurrent workers active" (from API)
- Experts card: "Up to N experts per task" (from API)
- Log Retention card: "N days" (from API)
- Plan Features list (from `/api/billing/plans` response)

**Step 2: Update plan upgrade flow**

Remove `planOrder` array that references `["starter", "team", "business", "enterprise"]` (line 343). Replace with `["pro"]` (only one paid tier for self-serve checkout).

**Step 3: Remove overage display**

No more overage rates in the new model. Remove overage-related UI elements.

**Step 4: Commit**

```bash
git add frontend/src/pages/Billing.tsx
git commit -m "feat: update billing page for 3-tier feature-based model"
```

---

### Task 6: Update frontend Settings page

**Files:**
- Modify: `frontend/src/pages/settings/index.tsx`
- Modify: `frontend/src/pages/settings/types.ts`
- Modify: `frontend/src/pages/settings/BillingSection.tsx`

**Step 1: Update `types.ts`**

If `OrganizationPlan` or plan-related types are defined here, update to match `"free" | "pro" | "enterprise"`.

**Step 2: Update `BillingSection.tsx`**

Update the plan display card. Ensure it shows current plan name correctly (free/pro/enterprise). Add upgrade prompts for free-tier users showing the value of Pro.

**Step 3: Update `index.tsx`**

Check for any plan-gated settings sections. If warm pool or role-based access settings are shown, add plan gates: show them for pro+ orgs, show upgrade prompt for free orgs.

**Step 4: Commit**

```bash
git add frontend/src/pages/settings/
git commit -m "feat: update settings for 3-tier plan model with upgrade prompts"
```

---

### Task 7: Update HowItWorks and Landing page references

**Files:**
- Modify: `frontend/src/pages/Home/HowItWorks.tsx` (lines 12, 31-35)
- Modify: `frontend/src/pages/LandingV0.tsx` — if it has plan references

**Step 1: Update HowItWorks.tsx**

Line 12: Change `"Free plan preview before you build"` to `"Free preview before you build"`.
Lines 31-35 ("Choose How" section): Update details to:
```typescript
details: [
  "Free: Your machine + Claude Max ($0)",
  "Pro: 5 concurrent workers + cloud",
  "BYOK or cloud — zero AI markup",
],
```

**Step 2: Check LandingV0.tsx**

Verify the landing page doesn't reference old plan names. It imports `Pricing` component which will already be updated.

**Step 3: Commit**

```bash
git add frontend/src/pages/Home/HowItWorks.tsx frontend/src/pages/LandingV0.tsx
git commit -m "feat: update landing page sections for 3-tier pricing"
```

---

### Task 8: Update Docs pages

**Files:**
- Modify: `frontend/src/pages/Docs/DocsCompliance.tsx` (lines 106, 113, 290, 441)
- Modify: `frontend/src/pages/Docs/Analytics.tsx` (line 342-346)
- Modify: `frontend/src/pages/Docs/AdvancedFeatures.tsx` (line 1096-1099)

**Step 1: Update DocsCompliance.tsx**

Line 106: Change `"Enterprise plan"` — keep as is (Enterprise plan reference is correct).
Line 113: Change Task Logs retention from `"30 days"` to `"14-90 days (plan-dependent)"`.
Line 290: Change `"Extended retention available on Enterprise plans."` to `"Log retention: 14 days (Free), 90 days (Pro), unlimited (Enterprise)."`
Line 441: Keep "Additional compliance features available on Enterprise plans" — correct.

**Step 2: Update Analytics.tsx**

Lines 342-346: Change `"Hours Remaining"` billing reference to match new model. Remove hour-based billing language. Replace with feature-based language (concurrent workers, expert limit, log retention).

**Step 3: Update AdvancedFeatures.tsx**

Lines 1096-1099: Change `"Available on All Plans"` and `"included in all WorkerMill plans at no additional cost"` — keep as is if AI Support Agent is truly on all plans. Verify this is still accurate.

**Step 4: Commit**

```bash
git add frontend/src/pages/Docs/
git commit -m "feat: update docs pages for 3-tier pricing model"
```

---

### Task 9: Update markdown documentation

**Files:**
- Modify: `docs/PRICING_AND_POSITIONING.md`
- Modify: `docs/COST_MODEL.md`
- Modify: `CLAUDE.md` — plan references in architecture section

**Step 1: Rewrite `docs/PRICING_AND_POSITIONING.md`**

Replace the entire pricing tiers section with the 3-tier model from the design doc. Remove all references to task-based billing, starter/team/business plans, per-task overage rates.

**Step 2: Update `docs/COST_MODEL.md`**

Update cost model to reflect feature-based gating instead of hour-based billing. Document that free tier has zero marginal cost (runs on user hardware).

**Step 3: Update `CLAUDE.md`**

Search for all references to `starter`, `team`, `business` plans and update to `free`/`pro`/`enterprise`. Update the plan constants documentation. Update the Quick Reference if it mentions plan-specific commands.

Key sections to update:
- Organization model documentation
- Billing routes documentation
- Plan constants section
- Any mention of overage rates or hour-based billing

**Step 4: Commit**

```bash
git add docs/PRICING_AND_POSITIONING.md docs/COST_MODEL.md CLAUDE.md
git commit -m "docs: update all documentation for 3-tier pricing model"
```

---

### Task 10: Update BuildTerminal and Build page

**Files:**
- Modify: `frontend/src/components/BuildTerminal.tsx` — check for plan references
- Modify: `frontend/src/pages/Build.tsx` — check for plan references
- Modify: `frontend/src/pages/ManagementDashboard.tsx` — check for plan references

**Step 1: Check each file for plan references**

Search for `starter`, `team`, `business`, `plan`, `tier`, `upgrade`, `free` in each file. Update any references to match the 3-tier model.

**Step 2: Commit**

```bash
git add frontend/src/components/BuildTerminal.tsx frontend/src/pages/Build.tsx frontend/src/pages/ManagementDashboard.tsx
git commit -m "feat: update build and dashboard pages for 3-tier pricing"
```

---

### Task 11: Run full typecheck and verify

**Step 1: API typecheck**

Run: `cd api && npm run typecheck`
Expected: PASS

**Step 2: Frontend typecheck**

Run: `cd frontend && npx tsc -b`
Expected: PASS

**Step 3: API lint**

Run: `cd api && npm run lint`
Expected: PASS (or only pre-existing warnings)

**Step 4: Frontend lint**

Run: `cd frontend && npm run lint`
Expected: PASS (or only pre-existing warnings)

**Step 5: Run API tests**

Run: `cd api && npm run test`
Expected: PASS. If billing tests exist, they may need updating for new plan types.

**Step 6: Visual check of pricing page**

Start frontend dev server and verify:
- Pricing page shows 3 tiers correctly
- Pro shows strikethrough $29, launch price $14.50
- Free CTA links to /signup
- Pro CTA links to /signup (or checkout)
- Enterprise CTA links to mailto:sales@workermill.com
- "How Pricing Works" section is updated

**Step 7: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: resolve typecheck and lint issues from pricing consolidation"
```

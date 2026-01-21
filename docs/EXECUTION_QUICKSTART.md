# WorkerMill Execution Quick Start

**Purpose:** Bootstrap fresh Claude Code sessions to continue strategic execution
**Last Updated:** 2026-01-19
**Current Phase:** Week 1 - Foundation

---

## Context (Read This First)

WorkerMill is an AI development platform with PRD orchestration capabilities. We're executing a 12-week plan to reach fundability. Full strategic analysis is in `docs/STRATEGIC_EXPANSION_2026.md`.

**Goal:** 10 paying customers + PRD success metrics + zero critical security issues

**Current blockers:**
1. ~~Critical security vulnerabilities~~ RESOLVED - All security fixes complete (Track 1: 5/5 done)
2. ~~No billing infrastructure~~ RESOLVED - Stripe integration complete (Track 2: 9/9 done)
3. ~~No PRD workflow success metrics~~ RESOLVED - Metrics + failure analysis done (Track 3: 6/7 done, need 50+ workflows)
4. No paying customers yet - **THIS IS NOW THE PRIORITY**

---

## Four Parallel Tracks

### Track 1: Security Fixes
**Status:** COMPLETE
**Priority:** CRITICAL - ~~Blocks customer onboarding~~ UNBLOCKED
**Completed:** 2026-01-19

| # | Issue | File | Status |
|---|-------|------|--------|
| 1 | Webhook auth is optional | `api/src/routes/webhooks.ts:85-95` | [x] DONE |
| 2 | Cross-org data leakage | `api/src/routes/tasks.ts` + `control-center.ts` | [x] DONE |
| 3 | Jira signature format wrong | `api/src/routes/webhooks.ts:31-34` | [x] DONE |
| 4 | No webhook idempotency | `api/src/routes/webhooks.ts` | [x] DONE |
| 5 | Missing DB indexes | `1705344000017-*` + `1705344000018-*` migrations | [x] DONE |

**To start this track, tell Claude:**
> "Read docs/EXECUTION_QUICKSTART.md then start on Track 1: Security Fixes. Begin with issue #1 (webhook auth)."

**Detailed fixes:**

**Issue 1 - Webhook auth optional:**
```typescript
// BEFORE (vulnerable) - webhooks.ts:85-95
if (org.jiraWebhookSecret) {
  if (!verifyJiraSignature(...)) { return 401; }
}

// AFTER (secure)
if (!org.jiraWebhookSecret) {
  logger.error("Webhook secret not configured", { orgId: org.id });
  return res.status(500).json({ error: "Webhook not configured" });
}
if (!verifyJiraSignature(...)) {
  return res.status(401).json({ error: "Invalid signature" });
}
```

**Issue 2 - Cross-org data leakage:**
Add `orgId: req.organization!.id` filter to ALL task queries in:
- `api/src/routes/tasks.ts` (multiple endpoints)
- `api/src/routes/control-center.ts` (SSE streaming)

**Issue 3 - Jira signature format:**
```typescript
// BEFORE - webhooks.ts:31-34
const expectedSignature = crypto.createHmac("sha256", secret).update(payload).digest("hex");

// AFTER
const expectedSignature = "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
```

**Issue 4 - Webhook idempotency:**
1. Create migration for `webhook_deliveries` table
2. Check `x-atlassian-webhook-id` / `x-github-delivery` headers
3. Return early if already processed

**Issue 5 - Missing indexes:**
```sql
CREATE INDEX idx_worker_task_status ON worker_tasks(status);
CREATE INDEX idx_worker_task_org_created ON worker_tasks(org_id, created_at DESC);
CREATE INDEX idx_worker_task_log_task_created ON worker_task_logs(task_id, created_at DESC);
CREATE INDEX idx_worker_task_github_pr ON worker_tasks(github_pr_url);
```

---

### Track 2: Billing Infrastructure
**Status:** COMPLETE
**Priority:** HIGH - Blocks revenue
**Estimated Time:** 4-6 days
**Depends On:** None (can run parallel)

| # | Task | Status |
|---|------|--------|
| 1 | Design pricing tiers and quotas | [x] DONE |
| 2 | Stripe account setup and API integration | [x] DONE |
| 3 | Checkout session endpoint | [x] DONE |
| 4 | Webhook handler for payment events | [x] DONE |
| 5 | Plan/quota fields on Organization model | [x] DONE |
| 6 | Quota enforcement middleware | [x] DONE |
| 7 | Usage tracking (tasks/month) | [x] DONE |
| 8 | Self-serve signup flow (frontend) | [x] DONE |
| 9 | Billing portal endpoint | [x] DONE |

**To start this track, tell Claude:**
> "Read docs/EXECUTION_QUICKSTART.md then start on Track 2: Billing Infrastructure. Begin with task #1 (design pricing tiers)."

**Pricing structure (proposed):**

| Tier | Price | Tasks/mo | Members | Features |
|------|-------|----------|---------|----------|
| Starter | $99/mo | 100 | 3 | Basic PRD workflows |
| Pro | $299/mo | 500 | 10 | Priority execution, Virtual Manager |
| Scale | $999/mo | 2000 | Unlimited | Custom personas, API access |

**Key files to create/modify:**
- `api/src/routes/billing.ts` - Stripe endpoints
- `api/src/services/billing.ts` - Billing logic
- `api/src/models/Organization.ts` - Add plan fields
- `api/src/middleware/quota.ts` - Enforcement
- `frontend/src/pages/Billing/` - UI components

---

### Track 3: PRD Workflow Metrics
**Status:** In Progress (6/7 Complete - Need 50+ workflows)
**Priority:** HIGH - Need data for fundraising
**Estimated Time:** Ongoing (2-4 weeks of data collection)
**Depends On:** None (can run parallel)

| # | Task | Status |
|---|------|--------|
| 1 | Add success/failure tracking fields to WorkerTask | [x] DONE |
| 2 | Track plan accuracy (estimated vs actual stories) | [x] DONE |
| 3 | Track cost variance (estimated vs actual) | [x] DONE |
| 4 | Track time to completion by complexity | [x] DONE |
| 5 | Create analytics dashboard/report | [x] DONE |
| 6 | Run 50+ PRD workflows | [ ] TODO |
| 7 | Document failure modes and patterns | [x] DONE |

**To start this track, tell Claude:**
> "Read docs/EXECUTION_QUICKSTART.md then start on Track 3: PRD Workflow Metrics. Begin with task #1 (tracking fields)."

**Metrics to collect:**

| Metric | How to Measure |
|--------|----------------|
| Success rate | `completed` or `deployed` / total PRD tasks |
| Plan accuracy | Actual stories created vs planned |
| Cost variance | Actual cost / estimated cost |
| Time to completion | `completedAt - createdAt` by complexity score |
| Human intervention rate | Tasks with manual status changes |
| Failure modes | Categorize `failed` and `escalated` reasons |

**Target:** 50+ PRD workflows with metrics before fundraising

---

### Track 4: Design Partner Outreach
**Status:** In Progress (4/8 Complete)
**Priority:** HIGH - Need customers
**Estimated Time:** Ongoing
**Depends On:** Track 1 (security) for onboarding

| # | Task | Status |
|---|------|--------|
| 1 | Create target company list (20 companies) | [x] DONE |
| 2 | Draft outreach templates (email, LinkedIn) | [x] DONE |
| 3 | Create pilot program structure | [x] DONE |
| 4 | Build simple onboarding documentation | [x] DONE |
| 5 | Set up demo environment | [ ] TODO |
| 6 | Begin outreach | [ ] TODO |
| 7 | Onboard first 3 design partners | [ ] TODO |
| 8 | Collect feedback and testimonials | [ ] TODO |

**To start this track, tell Claude:**
> "Read docs/EXECUTION_QUICKSTART.md then start on Track 4: Design Partner Outreach. Begin with task #1 (target company list)."

**Target company criteria:**
- 20-200 engineers
- SaaS product
- Active job postings for engineers (capacity constrained)
- Uses Jira or Linear
- Technical leadership accessible

**Pilot program structure:**
- 30 days free
- 5 PRD workflows included
- Weekly check-in call
- Requirement: Case study participation if successful
- Conversion target: 50% to paid

**Outreach message template:**
```
Subject: Clear your engineering backlog 10x faster

Hi [Name],

I noticed [Company] is hiring engineers - sounds like you have more work than capacity.

We built WorkerMill to solve this. Give us a PRD, get working software. Our AI orchestration decomposes requirements into parallel tasks across specialized personas (backend, frontend, QA) and delivers deployable code.

The kicker: it runs in YOUR AWS account. Code never leaves your network.

Would you be open to a 30-day pilot? We're looking for 5 design partners to validate the workflow.

[Your name]
```

---

## Session Start Checklist

When starting a new session, tell Claude:

1. **For general context:**
   > "Read docs/EXECUTION_QUICKSTART.md to understand current state and priorities."

2. **To continue a specific track:**
   > "Read docs/EXECUTION_QUICKSTART.md then continue Track [N]. Last completed: [task]. Next up: [task]."

3. **To check overall progress:**
   > "Read docs/EXECUTION_QUICKSTART.md and summarize progress across all 4 tracks."

4. **After completing work:**
   > "Update docs/EXECUTION_QUICKSTART.md to mark [tasks] as complete."

---

## Key File Locations

| Purpose | Location |
|---------|----------|
| Strategic analysis | `docs/STRATEGIC_EXPANSION_2026.md` |
| This quickstart | `docs/EXECUTION_QUICKSTART.md` |
| Design partner onboarding | `docs/DESIGN_PARTNER_ONBOARDING.md` |
| Per-org credential isolation plan | `docs/PER_ORG_CREDENTIALS_PLAN.md` |
| Critical analysis (all issues) | `docs/CRITICAL_ANALYSIS.md` |
| PRD workflow analysis | `docs/PRD_WORKFLOW_ANALYSIS.md` |
| Cost model | `docs/COST_MODEL.md` |
| ROI comparison | `docs/demo-roi-comparison.md` |
| Webhook routes | `api/src/routes/webhooks.ts` |
| Task routes | `api/src/routes/tasks.ts` |
| Orchestrator | `api/src/services/orchestrator.ts` |
| Planning agent | `api/src/services/planning-agent.ts` |
| Organization model | `api/src/models/Organization.ts` |
| Billing routes | `api/src/routes/billing.ts` |
| Analytics routes | `api/src/routes/analytics.ts` |

---

## Progress Log

Update this section after each session:

| Date | Session | Track | Completed | Notes |
|------|---------|-------|-----------|-------|
| 2026-01-19 | Initial | - | Strategic analysis, created this doc | Ready to execute |
| 2026-01-19 | Security | 1 | Issue #1: Webhook auth required | All 4 webhook handlers (Jira, GitHub PR, Linear, GitHub Issues) now require secret configuration. Returns 500 if secret missing, 401 if signature invalid. |
| 2026-01-19 | Billing | 2 | ALL TASKS COMPLETE | Backend: billing.ts service, Organization model with plan/quota fields, /api/billing/* routes, /api/webhooks/stripe handler, quota enforcement in orchestrator. Frontend: Billing.tsx page with usage, cost breakdown, plan cards, upgrade/portal buttons. |
| 2026-01-19 | PRD Metrics | 3 | Tasks #1-5 DONE | API: GET /api/analytics/prd-metrics endpoint with cost variance, time by complexity, plan accuracy. Frontend: Analytics.tsx PRD Metrics section. Remaining: run 50+ workflows and document failure patterns. |
| 2026-01-19 | Security | 1 | Issues #2-5 ALL DONE | **Track 1 COMPLETE.** #2: Added orgId filter to tasks.ts duplicate route + control-center.ts log endpoint. #3: Fixed Jira signature to use sha256= prefix with backward compat. #4: Added webhook_deliveries table + idempotency checks to all 4 webhook handlers. #5: Added 7 new indexes via migration. Customer onboarding unblocked. |
| 2026-01-20 | PRD Metrics | 3 | Task #7 DONE | Added failure mode analysis: GET /api/analytics/failures endpoint categorizes failures (infrastructure, git, build, AI errors). Frontend: Analytics.tsx shows failure categories with examples, breakdown by persona/model, weekly trend. |
| 2026-01-20 | Outreach | 4 | Task #4 DONE | Created onboarding docs: docs/DESIGN_PARTNER_ONBOARDING.md (30-min setup guide), frontend/src/pages/Docs/QuickStart.tsx (in-app quick start). Added to docs navigation. |

---

## Definition of Done (12-Week Goal)

- [x] Zero critical security issues (Track 1: 5/5 COMPLETE)
- [x] Stripe billing live (code complete - needs Stripe account configuration)
- [x] Self-serve signup working (Billing.tsx page complete)
- [ ] 50+ PRD workflows executed (Track 3: need data collection)
- [x] Success metrics documented (GET /api/analytics/prd-metrics + Analytics.tsx)
- [ ] 10 paying customers (Track 4: not started)
- [ ] 3 case studies written
- [ ] Ready to fundraise

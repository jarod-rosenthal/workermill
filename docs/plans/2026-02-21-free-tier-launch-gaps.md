# Free Tier Launch — Gap Analysis & Implementation Plan

**Date:** 2026-02-21
**Status:** Draft — Pricing Under Discussion

---

## Pricing Model (Draft)

### Pricing Philosophy

Two separate value dimensions:
1. **Subscription** = unlocks scale, team features, integrations, and AI providers. Runs on user's machines — near-zero cost to WorkerMill.
2. **Cloud execution** = usage-based compute, billed separately. User pays for actual ECS task-hours when they want WorkerMill to run tasks on our infrastructure.

### Tier Breakdown

#### Pro — $19/month (90-day free trial)

For developers and small teams getting started with autonomous AI coding.

| Feature | Included |
|---------|----------|
| Concurrent workloads | **1** |
| Experts per task | Up to **3** |
| Users | Up to **5** |
| Planning | **Simplified planning** (single-pass, no critic review loop) |
| Automated PR reviews | Yes |
| Integrations | WorkerMill Hands-off Kanban, GitHub Issues |
| AI providers | **Anthropic Claude models** |
| Execution | **Local + BYOK** |
| Cloud execution | No |
| MCP Server | Yes |
| Codebase RAG | No |
| CI/CD deployments | No |
| Analytics | Basic |
| Memory & skills persistence | No |
| Role-based access | No |
| Log retention | **14 days** |
| Support | Email (< 24hrs) |

**Cost to WorkerMill per Pro user:** ~$0. API metadata traffic only. Planning and worker execution run on user hardware. 10,000 Pro users barely moves our infrastructure cost.

**Promotional offer:** Every new account gets a **90-day free Pro trial**. No credit card required. Users sign up, get the full Pro experience for 90 days. By then they've built workflows, history, and habits — $19/mo feels like a bargain. Staggered expirations mean gradual revenue ramp, not a cliff. If adoption is slow, trial length can be quietly extended without a public policy change.

#### Max — $39/month (coming soon)

For professional teams who need full power, multi-provider support, and cloud execution.

| Feature | Included |
|---------|----------|
| Concurrent workloads | **3** |
| Experts per task | Up to **7** |
| Users | Up to **25** |
| Planning | **Advanced planning** (planner + critic review loop, up to 3 iterations, 85/100 threshold) |
| Automated PR reviews | Yes |
| Integrations | **All** — Jira, Linear, GitHub, GitLab, Bitbucket |
| AI providers | **All** — OpenAI, Google, Anthropic |
| Execution | **Local or Cloud** (cloud credits billed separately) |
| Cloud credits | **Trial credit included** to get started |
| Additional cloud credits | Purchase on-demand, billed separately |
| CI/CD deployments | **Yes** — auto-merge + deploy workflows |
| MCP Servers | Yes |
| Codebase RAG | **Yes** |
| Analytics | **Advanced** |
| Memory & skills persistence | **Yes** |
| Role-based access | **Yes** |
| Configurable tech lead review | **Yes** |
| Warm container pool | **Yes** |
| Log retention | **90 days** |
| Support | Priority (< 4hrs) |

**Upgrade triggers from Pro → Max:**
1. "I need Jira/Linear integration" — Pro only has GitHub Issues
2. "I want to use OpenAI or Google models" — Pro is Anthropic-only
3. "I need more than 1 concurrent workload" — Pro limit
4. "I want tasks to run in the cloud while my laptop is closed" — cloud execution
5. "I need CI/CD auto-deploy" — Max only
6. "I need codebase RAG for better code context" — Max only
7. "I need more than 3 experts working in parallel" — Pro limit
8. "My team has more than 5 people" — Pro limit

#### Enterprise — Custom pricing

For organizations with compliance, security, and scale requirements.

| Feature | Included |
|---------|----------|
| Everything in Max | Yes |
| Concurrent workloads | **Unlimited** |
| Experts per task | **Unlimited** |
| Users | **Unlimited** |
| Cloud credits | **Custom allocation** |
| Self-hosted deployment | Yes (agent + API + PostgreSQL, zero egress) |
| SSO / SAML | Yes |
| Dedicated worker pool | Yes |
| IP allowlisting | Yes |
| Data residency controls | Yes |
| AWS Bedrock / Azure AI Foundry | Yes |
| Compliance Center | Yes |
| SOC 2 Report | Available |
| SLA | **99.9%** |
| Log retention | **Unlimited** |
| Support | **Dedicated CSM** |

### Planning: Simplified vs Advanced

| | Pro (Simplified) | Max (Advanced) |
|--|-----------------|----------------|
| Story decomposition | Yes | Yes |
| File targeting | Yes | Yes |
| Dependency ordering | Yes | Yes |
| Critic review loop | **No** — single-pass plan, accepted as-is | **Yes** — up to 3 planner-critic iterations |
| Critic threshold | N/A | 85/100 score required |
| Dynamic file caps | Default (5 files/story) | Dynamic (5/6/8 based on description length) |

Simplified planning still decomposes tasks into stories with file targets and dependencies — it just skips the critic validation loop. This is sufficient for most tasks and runs faster. Advanced planning adds the quality gate that catches over-scoped or under-specified plans before execution begins.

### Cloud Credit System

Already built in `api/src/services/credit-billing.ts`:
- `getBalance()` — current balance (free + paid credits)
- `deductUsage()` — atomic deduction with markup
- `addCredits()` — deposit or bonus credits
- `processAutoRecharge()` — auto-recharge when balance drops below threshold
- Stripe integration for credit purchases

Cloud execution is available on Max and Enterprise plans. Credits are billed separately from the subscription — the subscription unlocks cloud capability, credits pay for actual compute.

**What needs to be built:**
- Max plan includes a one-time trial credit on signup
- `canCreateTask()` checks: local task → always allowed (subject to concurrent workload limit); cloud task → requires Max+ plan AND credit balance ≥ estimated cost
- Dashboard shows cloud credit balance, usage history, and top-up options

---

## Gap Analysis

WorkerMill's core platform (task orchestration, worker execution, multi-provider support, VS Code extension) is solid. The gaps blocking a public free tier launch are concentrated in three areas:

1. **Billing enforcement is broken** — free tier has no actual limits
2. **Security gaps** for a publicly accessible API
3. **Onboarding drops users** after signup with no guidance

This document catalogs every gap found and proposes a prioritized implementation plan.

---

## 1. BILLING & FREE TIER ENFORCEMENT (Showstopper)

### 1.1 Enforce Execution Mode by Plan (Local vs Cloud)

**Current state:** `canCreateTask()` in `billing.ts` checks task quotas, but the finalized pricing model has **unlimited local tasks** on all plans. The enforcement point is now **cloud execution** — free users cannot run tasks on ECS, only locally.

**What needs to change:**
- `canCreateTask()` must distinguish local vs cloud execution requests
- Free plan: allow unlimited local tasks, reject cloud execution with clear upgrade prompt
- Pro plan: allow unlimited local tasks + cloud tasks if credit balance is sufficient
- Remove `taskQuota` enforcement entirely (all plans get unlimited local tasks)
- Set `taskQuota: -1` (unlimited) on org creation instead of `0`
- Update pricing page to reflect unlimited tasks + local-only for free

**Files:** `api/src/routes/auth.ts`, `api/src/services/billing.ts`, `api/src/services/task-claimer.ts`, `frontend/src/pages/Home/Pricing.tsx`

### 1.2 Wrong Rate Limiter on Task Creation

**Current state:** Task creation routes use `workerLogLimiter` (1000 req/min) instead of `taskCreationLimiter` (20 req/hr). The stricter limiter exists but is never applied.

**Fix:** Apply `taskCreationLimiter` to `POST /api/tasks` and `POST /api/boards/:boardId/cards/:cardId/run`.

**Files:** `api/src/index.ts` (line ~313), `api/src/routes/boards.ts`

### 1.3 No Credit Balance Pre-Check for Cloud Tasks

**Current state:** Tasks queue even with $0 balance, then fail at billing deduction time. User sees a mysterious failure instead of being told they need credits.

**Fix:** Before claiming a **cloud** task, verify org has credit balance ≥ estimated task cost (minimum $0.50). Local tasks skip this check entirely (no credits consumed). Return clear error: "Insufficient cloud credits — add credits or run locally."

**Files:** `api/src/services/task-claimer.ts`, `api/src/services/credit-billing.ts`

### 1.4 No Per-Card Execution Throttle

**Current state:** A user can trigger the same board card to run 200 times in 60 seconds via the `authenticatedLimiter`.

**Fix:** Add per-card cooldown (e.g., 1 run per card per 5 minutes) or deduplicate in-flight runs for the same card.

**Files:** `api/src/routes/boards.ts`

---

## 2. SECURITY

### 2.1 API Keys Never Expire

**Current state:** Organization API keys have no expiration, no scoping. A leaked key grants permanent full org access.

**Fix:** Add 90-day default expiration. Add key scoping (read-only vs full access). Prompt rotation in dashboard.

**Files:** `api/src/models/Organization.ts`, `api/src/middleware/auth.ts`, `api/src/routes/settings/`

### 2.2 GitHub Webhook Queries Cross-Org

**Current state:** GitHub webhook PR lookup doesn't filter by `organizationId`. If two orgs have tasks with the same PR URL, the wrong org's task could be updated.

**Fix:** Add `organizationId` filter to webhook task lookup queries.

**Files:** `api/src/routes/webhooks/github.ts` (lines 75-90)

### 2.3 Planning API Keys Leaked in Settings Response

**Current state:** Non-Anthropic provider planning API keys are returned unmasked via `GET /settings`.

**Fix:** Mask `planningApiKey` the same way other secrets are masked (`"***"`).

**Files:** `api/src/routes/settings/general.ts` (lines 143-149)

### 2.4 Webhook Replay Possible

**Current state:** If webhook delivery ID is missing/null, `isDuplicateWebhook()` returns false, allowing replay attacks to create duplicate tasks.

**Fix:** Reject webhooks with missing delivery IDs, or generate a deterministic ID from payload hash.

**Files:** `api/src/routes/webhooks/` (all handlers)

### 2.5 No Account Enumeration Protection

**Current state:** Auth endpoints rate-limited by IP only. Attacker can probe valid email addresses via repeated login attempts from different IPs.

**Fix:** Add per-email rate limiting on auth endpoints (e.g., 5 attempts per email per hour).

**Files:** `api/src/routes/auth.ts`, `api/src/middleware/rate-limit.ts`

---

## 3. ONBOARDING & UX

### 3.1 Pricing Page Shows "Coming Soon"

**Current state:** All pricing tiers have disabled CTAs with "Coming Soon" — visitors think the platform isn't available.

**Fix:** Enable free tier CTA immediately. Show real pricing or remove the pricing section until ready.

**Files:** `frontend/src/pages/Pricing.tsx`

### 3.2 No First-Run Wizard

**Current state:** After org creation, user sees empty dashboard with "Run Task" button but no guidance on what to fill in, what integrations are needed, or what happens next.

**Fix:** Add a "Getting Started" checklist that appears on first login:
1. Connect SCM (GitHub/GitLab/Bitbucket)
2. Choose AI provider (or use default)
3. Create first task (with pre-filled example)
4. View result

**Files:** `frontend/src/pages/Dashboard.tsx`, new component

### 3.3 SetupBanner Links to Raw Settings

**Current state:** "Continue Setup" links to `/settings` with no context. User lands in settings unsure what to configure.

**Fix:** Link directly to the relevant settings tab (Integrations), or embed inline setup within the banner.

**Files:** `frontend/src/components/SetupBanner.tsx`

### 3.4 Error Messages Not Shown on Dashboard

**Current state:** `WorkerTask.errorMessage` is populated on failure but not returned to the frontend. Users see "failed" with no reason.

**Fix:** Include `errorMessage` in task GET responses. Display it prominently on the task detail view.

**Files:** `api/src/routes/tasks/crud.ts`, `frontend/src/` (task detail component)

### 3.5 No Retry Button

**Current state:** `canRetry()` exists on the WorkerTask model but no UI or route exposes it.

**Fix:** Add "Retry" button on failed tasks showing attempts remaining. Wire to retry endpoint.

**Files:** `api/src/routes/tasks/`, frontend task detail component

---

## 4. RELIABILITY

### 4.1 Planning Tasks Have No Timeout

**Current state:** If the remote agent crashes mid-planning, the task stays in "planning" status forever. The cloud orchestrator won't claim it (skips orgs with active remote agents).

**Fix:** Add 30-minute timeout on planning tasks. If exceeded, fail with clear message and allow retry.

**Files:** `api/src/services/task-monitor.ts`, `agent/src/poller.ts`

### 4.2 Database Connection Pool Too Small

**Current state:** Max pool size = 10. With 5 concurrent workers + orchestrator + API requests, the pool exhausts and requests silently timeout after 10 seconds.

**Fix:** Increase pool max to 15-20. Add connection pool monitoring/alerting.

**Files:** `api/src/db/connection.ts`

### 4.3 Health Check Too Permissive

**Current state:** `/health/ready` only checks DB connectivity. Orchestrator could be dead and health check still passes.

**Fix:** Add orchestrator status and claim loop health to the readiness check.

**Files:** `api/src/routes/` (health endpoint)

### 4.4 Graceful Shutdown Incomplete

**Current state:** SIGTERM handler closes DB immediately without draining in-flight HTTP requests. Workers posting final results during deploy lose data.

**Fix:** Implement HTTP connection drain with timeout before closing DB.

**Files:** `api/src/index.ts` (lines 379-391)

### 4.5 Orphaned Task Detection Lag (2-5 Minutes)

**Current state:** `failOrphanedTasks()` runs every ~5 minutes (every 60 poll cycles). ECS Spot interruptions take minutes to surface to the user.

**Fix:** Reduce check interval or subscribe to ECS task stop events via SNS for immediate detection.

**Files:** `api/src/services/task-cleanup.ts`

---

## 5. TESTING

### 5.1 Billing Has Zero Test Coverage

**Current state:** No unit, integration, or E2E tests for `canCreateTask()`, quota enforcement, Stripe flows, or free-to-pro upgrade. 3.5% overall service test coverage (3 of 86 services).

**Fix:** Write integration tests for:
- `canCreateTask()` blocks at quota
- Free tier feature flags enforced (no cloud execution)
- `incrementTaskUsage()` increments correctly
- Stripe checkout creates subscription

**Files:** `api/src/__tests__/`

### 5.2 CI/CD Tests Are Optional

**Current state:** Integration and E2E tests are manual checkbox options in the workflow, not merge gates. Deployments don't require tests to pass.

**Fix:** Make integration tests a required CI gate. Run E2E tests on frontend changes.

**Files:** `.github/workflows/ci-cd.yml`

### 5.3 No Staging Environment

**Current state:** Deployments go straight from local dev to production. No staging to test billing in a production-like environment.

**Fix:** Stand up a staging environment with Stripe test mode for billing validation.

### 5.4 No Automated Rollback

**Current state:** If a deploy breaks production, rollback is manual — redeploy previous image, restore RDS from snapshot (~15 min).

**Fix:** Add `--rollback` flag to `deploy.sh` that reverts to previous ECS task definition. Add feature flags for emergency disables.

**Files:** `deploy.sh`

---

## 6. COMPETITIVE PRICING COMPARISON — Why Our Free Tier Humiliates Devin

### The Landscape (February 2026)

| Tool | Free Tier | Cheapest Paid | What You Actually Get for Free |
|------|-----------|---------------|-------------------------------|
| **WorkerMill** | **90-day Pro trial** | $19/mo (Pro) / $39/mo (Max) | Unlimited tasks, planning, up to 3 parallel experts, GitHub Issues, MCP server. Runs on your machine — zero AI markup. Max adds all integrations, all providers, cloud, CI/CD, Codebase RAG. |
| **Devin** | **None** | $20/mo (Core) | Nothing. $0 gets you nothing. $20 gets you pay-as-you-go at $2.25/ACU (~15 min of work each). A 1-hour task costs ~$9. |
| **Cursor** | 2-week trial only | $20/mo (Pro) | One-week Pro trial, then crippled. Pro gives credit-based access — heavy users burn through credits fast. Pro+ is $60/mo, Ultra is $200/mo. |
| **GitHub Copilot** | 2,000 completions + 50 chats | $10/mo (Pro) | Autocomplete only. No autonomous execution. No task orchestration. No multi-file changes. |
| **Windsurf** | 25 credits/mo | $15/mo (Pro) | 25 prompts. That's it. Pro gives 500 credits. Teams is $30/user/mo. |
| **Augment Code** | **None** (was free, killed it) | $20/mo (Indie) | Nothing free. $20 gets 40k credits. Complex tasks eat 4,300 credits each — ~9 complex tasks/month. |
| **Claude Code** (raw) | Included with Pro sub | $20/mo (Claude Pro) | Requires Claude Pro/Max subscription. No orchestration, no planning, no multi-expert, no Jira integration. Just a CLI. |

### The Embarrassing Math

**Devin: 1 hour of autonomous work = ~$9**
- Core plan: $2.25/ACU, 1 ACU ≈ 15 minutes
- 4 ACUs/hour × $2.25 = $9/hour
- Team plan ($500/mo) gets 250 ACUs = ~62.5 hours. That's $8/hour.
- A 10-story epic taking 5 hours = **$45 on Devin**

**WorkerMill Free: Same 10-story epic = $0 (orchestration) + your Claude Max sub**
- Claude Max at $100/mo gives ~40-80 hours/week of Claude Code
- WorkerMill adds: planning, critic review, parallel multi-expert execution, consolidated PRs, real-time logs, Jira/GitHub/GitLab/Bitbucket integration
- All of that is $0 on WorkerMill Free
- The user's existing Claude subscription covers the LLM cost

**What $20/month buys you:**

| $20/mo on Devin | $0 for 90 days on WorkerMill (then $19/mo) |
|-----------------|---------------------------------------------|
| ~9 ACUs (2.25 hours of work) | **Unlimited tasks** |
| 1 autonomous agent | Simplified planning + up to 3 experts |
| Cloud-only execution | Local-first (your code stays on your machine) |
| No multi-expert parallel | Up to 3 parallel expert personas |
| No VS Code extension | Full VS Code extension with sidebar, logs, live diffs |
| Your code on their servers | Your code never leaves your machine |

### The Privacy Angle

| Tool | Where Your Code Goes |
|------|---------------------|
| Devin | Cognition's cloud VMs — they see everything |
| Cursor | Cursor's servers — they see your codebase |
| GitHub Copilot | Microsoft/Azure — they see your code context |
| **WorkerMill** | **Your machine → LLM provider directly. We never see your code.** |

Devin runs your code on their infrastructure. Cursor processes your codebase on their servers. WorkerMill workers run as local processes on your machine — source code goes directly from your machine to the LLM provider you chose. WorkerMill's cloud API only sees task metadata (summaries, status, logs). Zero code egress.

### The Headline

> **Devin charges $9/hour for autonomous coding. WorkerMill Pro gives you unlimited autonomous coding — free for 90 days, then $19/mo.**
>
> Same capability. Better orchestration. Your code never leaves your machine.
> Devin's $500/mo Team plan gets you 62 hours. WorkerMill Pro gets you unlimited.

### Positioning by Competitor

**vs Devin:** "Devin charges $2.25 per 15 minutes of work. WorkerMill Pro is free for 90 days, then $19/mo for unlimited tasks. Bring your Claude subscription, get unlimited autonomous task execution with planning, multi-expert parallel, and consolidated PRs."

**vs Cursor:** "Cursor is an IDE that suggests code. WorkerMill executes entire tickets autonomously — planning, implementation, review, PR creation. Cursor Pro is $20/mo for credit-limited completions. WorkerMill Pro is $19/mo for unlimited autonomous execution."

**vs Copilot:** "Copilot autocompletes lines. WorkerMill completes tickets. Different category entirely. Our $19/mo Pro does more autonomous work than Copilot Enterprise ($39/user/mo)."

**vs Windsurf:** "25 free prompts vs unlimited tasks on a 90-day trial. Windsurf gives you a chatbot. WorkerMill gives you an autonomous engineering team."

---

## Implementation Priority

### P0 — Before Launch (Blockers)

| # | Item | Section | Effort |
|---|------|---------|--------|
| 1 | Enforce local-only execution for free plan (block cloud tasks) | 1.1 | Small |
| 2 | Apply correct rate limiter to task creation | 1.2 | Tiny |
| 3 | Add credit balance pre-check for cloud tasks | 1.3 | Small |
| 4 | Update pricing page to finalized 3-tier model | 3.1 | Medium |
| 5 | Show error messages on dashboard | 3.4 | Small |
| 6 | Add planning task timeout (30 min) | 4.1 | Small |
| 7 | Auto-deposit $10 cloud credits on Pro subscription start/renewal | — | Small |

### P1 — Week 1

| # | Item | Section | Effort |
|---|------|---------|--------|
| 7 | Add API key expiration (90-day default) | 2.1 | Medium |
| 8 | Build first-run wizard / getting started checklist | 3.2 | Medium |
| 9 | Add retry button on failed tasks | 3.5 | Small |
| 10 | Write billing integration tests | 5.1 | Medium |
| 11 | Mask planning API keys in settings response | 2.3 | Tiny |
| 12 | Increase DB connection pool to 15-20 | 4.2 | Tiny |
| 13 | Per-card execution throttle | 1.4 | Small |

### P2 — Month 1

| # | Item | Section | Effort |
|---|------|---------|--------|
| 14 | Scope webhook queries by organizationId | 2.2 | Small |
| 15 | Reject webhooks with missing delivery ID | 2.4 | Small |
| 16 | Per-email rate limiting on auth | 2.5 | Small |
| 17 | Fix SetupBanner to link to correct settings tab | 3.3 | Tiny |
| 18 | Improve health check (include orchestrator) | 4.3 | Small |
| 19 | Implement graceful shutdown with HTTP drain | 4.4 | Medium |
| 20 | Make integration tests a CI merge gate | 5.2 | Small |
| 21 | Add automated rollback to deploy.sh | 5.4 | Medium |
| 22 | Reduce orphan detection lag | 4.5 | Medium |
| 23 | Stand up staging environment | 5.3 | Large |

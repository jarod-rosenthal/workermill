# WorkerMill Technical Debt Analysis

**Date:** 2026-02-11 (updated)
**Codebase:** 380 TypeScript files, ~135K LOC, 141 DB migrations

## Executive Summary

Significant progress on technical debt reduction. The three biggest categories of work — mega-file decomposition, `.save()` race condition fixes, and orchestrator refactoring — are substantially complete. Remaining debt is concentrated in test coverage, god models, and lower-priority `.save()` patterns in non-critical paths.

**Progress snapshot:**

| Category | Before | After | Status |
|----------|--------|-------|--------|
| Mega-files (>2,000 lines) | 14 files | 6 files | ~60% resolved |
| `.save()` clobber risk (critical paths) | ~50+ patterns | 0 | Done |
| `.save()` total (all files) | ~375+ across 65 files | 346 across 75 files* | ~50 fixed in critical paths |
| API route decompositions | 0 done | 7 monoliths split | Done |
| Frontend decompositions | 0 done | 2 mega-components split | Done |
| Orchestrator monolith | 6,446 lines | 336 lines (hub) | Done |
| Test coverage (API routes) | ~16% | ~16% | Not started |

\* File count increased because decomposed modules still use `.save()` for entity creation (safe pattern).

---

## Completed Work

### Orchestrator Decomposition (`1ec5130`)

The 6,446-line orchestrator monolith was split into 8 focused modules:

| Module | Purpose | Lines |
|--------|---------|-------|
| `orchestrator.ts` | Hub: lifecycle, polling, exports | 336 |
| `pipeline-executor.ts` | Active task spawning (was orchestrator-v2.ts) | ~3,200 |
| `task-dispatch.ts` | Story decomposition and child task creation | ~900 |
| `task-monitor.ts` | Parent/child completion, cost recovery | ~1,900 |
| `task-cleanup.ts` | Stale task detection and cleanup | ~650 |
| `planning-workflow.ts` | Plan generation, approval, critic loops | ~1,050 |
| `orchestrator-utils.ts` | Shared utilities, file dependency enforcement | ~400 |
| `org-credentials.ts` | Extracted credential fetching (shared module) | ~100 |

### API Route Decompositions

7 monolithic route files split into focused modules:

| Original File | Lines | Modules Created | Commit |
|---------------|-------|-----------------|--------|
| `settings.ts` (4,684) | 4,905 total | 7: general, integrations, models, org, webhooks, helpers, index | `16c88bc` |
| `webhooks.ts` (3,814) | 4,603 total | 11: jira, github, github-issues, gitlab, bitbucket, linear, email, support, github-runner, helpers, index | `1286f1c` |
| `control-center.ts` (2,946) | 3,111 total | 7: actions, dashboard, logs, search, stream, helpers, index | `1286f1c` |
| `analytics.ts` (4,487) | — | 6: tasks, quality, efficiency, costs, complexity, index | `1286f1c` |
| `tasks.ts` (3,106) | 3,227 total | 8: crud, lifecycle, plans, subtasks, usage, worker-api, helpers, index | `9c118ae` |
| `planning-agent.ts` (3,340) | 3,698 total | 11: planner-v1/v2/v3, replan, complexity, config, cost-estimation, helpers, queries, types, index | `9c118ae` |
| `email.ts` (2,993) | 3,114 total | 10: billing-emails, invite-emails, support-emails, task-emails, test-emails, welcome-emails, helpers, rate-limit, unsubscribe, index | `9c118ae` |

### Frontend Decompositions (`871cd92`)

| Original File | Lines | Modules Created |
|---------------|-------|-----------------|
| `Settings.tsx` (8,315) | 9,067 total | 11: GeneralSection, IntegrationsSection, AIWorkersSection, QualitySection, NotificationsSection, TeamSection, BillingSection, DataSection, RemoteAgentSection, types, index |
| `Dashboard.tsx` (5,290) | 10,775 total | 17: MainDashboard, role-specific views (CTO, DevOps, Engineer, Finance, HR, Manager, Marketing, PM, QA, Sales, Security, TechLead), EmbeddedCommunicationsFeed, helpers, types, index |

### `.save()` → Atomic Update Conversions

6 commits converting ~50 critical `.save()` patterns to atomic `createQueryBuilder().update().set().where().execute()`:

| Commit | Files Fixed | Patterns Converted |
|--------|------------|-------------------|
| `da3c994` | control-center routes | SSE status updates |
| `86c8c37` | worker-api, actions, lifecycle | Worker result parsing, task actions |
| `39f63d7` | webhooks (github, gitlab, bitbucket), cost-tracker | Webhook handlers, cost accumulation |
| `74a30e1` | task-dispatch, planning-workflow, task-cleanup, task-monitor | Parent dispatching, plan approval, stuck task reset, parent completion, cascade cancellation, cost recovery |
| `5b24234` | billing.ts | 7 Stripe webhook handlers |
| `22dd9d9` | plans.ts, planner-v1/v2/v3, replan | Plan approve/reject, planning token tracking |

**Key patterns applied:**
- Status guard WHERE clauses (`WHERE id = :id AND status = :expected`) to prevent double-processing
- COALESCE increments for concurrent counters (`SET "tokens" = COALESCE("tokens", 0) + $1`)
- Cast `.set()` argument as `Record<string, unknown>` for nullable JSON fields

---

## Remaining Work

### Tier 1: Critical

#### 1.1 Near-Zero Test Coverage (unchanged)

- **API**: 6 test files covering ~16% of route files. Zero tests for settings, analytics, webhooks, control-center, billing, organizations, coordination.
- **Frontend**: 0 unit/component test files. E2E exists but no Vitest/RTL tests.
- **Critical untested paths**: task status machine, webhook idempotency, plan approval workflow, SSE streaming, billing.

#### 1.2 Remaining Mega-Files (>2,000 lines)

| File | Lines | Domain | Notes |
|------|-------|--------|-------|
| `frontend/src/pages/Dashboard/MainDashboard.tsx` | **4,189** | Core dashboard panel | Extracted from Dashboard.tsx but still large |
| `worker/epic/coordinator.ts` | **3,234** | God object: orchestration + status + git | Worker-side, not API |
| `worker/multi-expert/index.ts` | **2,964** | Story execution + provider routing | Worker-side |
| `frontend/src/pages/Analytics.tsx` | **2,554** | Charts + data transforms + UI | |
| `api/src/routes/memory.ts` | **2,405** | 3 memory types in one file | |
| `worker/epic/git-ops.ts` | **2,393** | Worktree + branch + commit + cleanup | Worker-side |

Previously 14 files over 2,000 lines; now 6 remain (orchestrator, settings, webhooks, control-center, tasks, planning-agent, email, Dashboard, Settings all resolved).

#### 1.3 SSL Certificate Validation Disabled (unchanged)

`api/src/db/connection.ts:468` — `rejectUnauthorized: false` on RDS SSL. Should use AWS RDS CA bundle.

#### 1.4 Missing Transactions on Critical Paths (partially addressed)

- Plan approval now uses atomic updates with status guards (fixed in `22dd9d9`)
- **Still needed**: Task completion multi-step (status + archival + child cleanup), webhook idempotency race window

### Tier 2: High

#### 2.1 Remaining `.save()` Patterns

346 occurrences across 75 files. Top offenders by count:

| File | Count | Risk Level | Notes |
|------|-------|------------|-------|
| `pipeline-executor.ts` | 32 | **High** | Active task spawning — concurrent orchestrator access |
| `auth.ts` | 21 | Medium | User creation/update — less concurrent |
| `projects.ts` | 22 | Medium | Project CRUD — lower concurrency |
| `boards.ts` | 17 | Medium | Board operations |
| `credit-billing.ts` | 14 | **High** | Credit/billing mutations — financial data |
| `referral.ts` | 12 | Low | Referral tracking |
| `organizations.ts` | 12 | Medium | Org settings updates |
| `codebase-indexer.ts` | 9 | Low | Background indexing |
| `coordination.ts` | 7 | Medium | Multi-worker coordination |
| `persona.ts` | 8 | Low | Persona CRUD |
| `manager-workflow.ts` | 8 | Medium | Manager review flow |
| `support-agent-executor.ts` | 8 | Low | Support agent |
| `worker-api.ts` | 7 | Medium | Worker result processing |
| `support.ts` | 7 | Low | Support routes |
| `memory.ts` | 6 | Low | Memory CRUD |

**Priority**: `pipeline-executor.ts` (32) and `credit-billing.ts` (14) are highest risk due to concurrency and financial data respectively.

#### 2.2 God Models (unchanged)

- **WorkerTask**: 104 columns, 67 nullable
- **Organization**: 136 columns

#### 2.3 Inconsistent Error Handling (unchanged)

4 service files still use `console.error()` instead of structured logger.

#### 2.4 SCM Provider Duplication (unchanged)

3 provider files with ~70% duplicated code (~2,500 lines total).

#### 2.5 Type Safety Gaps (unchanged)

17 `as any` casts in API, 10+ `catch (err: any)` in frontend.

### Tier 3: Medium (unchanged)

- Frontend: 0 error boundaries, 16 useState hooks in MainDashboard polling loop
- 141 migrations including duplicates and user-specific diagnostics
- N+1 query patterns in orchestrator and control-center
- 202 `process.env.*` instances with no centralized validation
- Build debt: unpinned Dockerfile deps, manual agent publish

### Tier 4: Low (unchanged)

- Hardcoded AZ list in Terraform
- Worker container no ECS health check
- Infrastructure `dev` naming in production
- Deprecated files kept for "rollback safety"

---

## Recommended Next Steps

### Immediate (next session)

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 1 | Fix `.save()` in `pipeline-executor.ts` (32 patterns) | 2-3 hours | Concurrency safety |
| 2 | Fix `.save()` in `credit-billing.ts` (14 patterns) | 1-2 hours | Financial data integrity |
| 3 | Fix SSL `rejectUnauthorized: true` in connection.ts | 5 min | Security |

### Short-term (1-2 weeks)

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 4 | Fix `.save()` in `auth.ts` (21), `organizations.ts` (12) | 1 day | Data integrity |
| 5 | Add transactions to task completion and webhook idempotency | 2 days | Data integrity |
| 6 | Decompose `MainDashboard.tsx` (4,189 lines) | 1 day | Maintainability |
| 7 | Delete 5 dead packages | 30 min | Cleanliness |
| 8 | Replace `console.error` with `logger` in 4 files | 30 min | Observability |

### Medium-term (1-2 months)

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 9 | Set up Vitest for frontend components | 1 day | Foundation |
| 10 | Add tests for decomposed route modules | 1-2 weeks | Coverage |
| 11 | Consolidate SCM providers to use base class | 3 days | DRY |
| 12 | Centralize config validation with Zod | 3 days | Reliability |

### Strategic (long-term)

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 13 | Split WorkerTask model (104 → 3-4 tables) | 1 week | Schema clarity |
| 14 | Split Organization model (136 → 4-5 tables) | 1 week | Schema clarity |
| 15 | Add missing database indexes on hot paths | 1 day | Performance |
| 16 | Squash historical migrations | 2 days | Cleanliness |

---

## Completed Items Log

| Item | Status | Commit(s) |
|------|--------|-----------|
| Orchestrator monolith (6,446 lines → 8 modules) | **DONE** | `1ec5130` |
| orchestrator-v2.ts → pipeline-executor.ts | **DONE** | `1ec5130` |
| Credential dedup (getOrgCredentials shared) | **DONE** | `1ec5130` |
| settings.ts (4,684 lines → 7 modules) | **DONE** | `16c88bc` |
| webhooks.ts (3,814 lines → 11 modules) | **DONE** | `1286f1c` |
| control-center.ts (2,946 lines → 7 modules) | **DONE** | `1286f1c` |
| analytics.ts (4,487 lines → 6 modules) | **DONE** | `1286f1c` |
| tasks.ts (3,106 lines → 8 modules) | **DONE** | `9c118ae` |
| planning-agent.ts (3,340 lines → 11 modules) | **DONE** | `9c118ae` |
| email.ts (2,993 lines → 10 modules) | **DONE** | `9c118ae` |
| Settings.tsx (8,315 lines → 11 modules) | **DONE** | `871cd92` |
| Dashboard.tsx (5,290 lines → 17 modules) | **DONE** | `871cd92` |
| `.save()` in control-center routes | **DONE** | `da3c994` |
| `.save()` in worker-api, actions, lifecycle | **DONE** | `86c8c37` |
| `.save()` in webhooks + cost-tracker | **DONE** | `39f63d7` |
| `.save()` in task-dispatch, planning-workflow, task-cleanup, task-monitor | **DONE** | `74a30e1` |
| `.save()` in billing (7 Stripe handlers) | **DONE** | `5b24234` |
| `.save()` in plans, planner-v1/v2/v3, replan | **DONE** | `22dd9d9` |

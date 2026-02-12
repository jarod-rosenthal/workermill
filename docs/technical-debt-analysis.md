# WorkerMill Technical Debt Analysis

**Date:** 2026-02-11
**Codebase:** 380 TypeScript files, ~135K LOC, 141 DB migrations

## Executive Summary

The codebase has grown rapidly with feature accumulation creating concentrated complexity in a handful of mega-files. The orchestrator decomposition (completed 2026-02-11, commit `1ec5130`) addressed one of the worst offenders (6,446 → 336 lines), but significant debt remains across all layers.

**Key metrics:**
- 6 test files covering ~16% of 38 route files
- 0 frontend unit/component tests
- 14 files over 2,000 lines
- 65 files using TypeORM `.save()` with clobber risk
- 141 database migrations (5 with user-specific diagnostics)
- 5 dead packages from abandoned modular architecture

---

## Tier 1: Critical

### 1.1 Near-Zero Test Coverage

- **API**: 6 test files covering ~16% of route files. Zero tests for:
  - `settings.ts` (60 endpoints, 4,684 lines)
  - `analytics.ts` (4,487 lines)
  - `webhooks.ts` (GitHub/GitLab/Bitbucket handlers)
  - `control-center.ts` (2,946 lines)
  - `billing.ts` (883 lines)
  - `organizations.ts` (962 lines)
  - `coordination.ts` (1,362 lines)
- **Frontend**: 0 unit/component test files in `frontend/src/`. E2E exists at `frontend/e2e/` but no Vitest/RTL tests.
- **Critical untested paths**: task status machine, webhook idempotency, plan approval workflow, SSE streaming, billing.

### 1.2 Mega-Files (>2,000 lines)

| File | Lines | Domain |
|------|-------|--------|
| `frontend/src/pages/Settings.tsx` | **8,315** | 9 nav categories, 27+ useState hooks, 173 inline interfaces |
| `frontend/src/pages/Dashboard.tsx` | **5,290** | 20+ refs, 16+ useState hooks, SSE, polling, 9+ panels inlined |
| `api/src/routes/settings.ts` | **4,684** | 60 router endpoints, validation, credential management |
| `api/src/routes/analytics.ts` | **4,487** | Complex aggregations mixed with HTTP handlers |
| `api/src/routes/webhooks.ts` | **3,814** | 5 SCM providers with duplicated parsing logic |
| `api/src/services/planning-agent.ts` | **3,340** | V1/V2/V3 planning in one file, 26 exports |
| `worker/epic/coordinator.ts` | **3,234** | God object: orchestration + status + git + coordination |
| `api/src/routes/tasks.ts` | **3,106** | Creation, retry, cancellation, logging all mixed |
| `api/src/routes/control-center.ts` | **2,946** | SSE streaming + task coordination + blocker handling |
| `api/src/services/email.ts` | **2,993** | 8+ email templates hardcoded inline |
| `worker/multi-expert/index.ts` | **2,964** | Story execution + provider routing + coordination + quality gates |
| `frontend/src/pages/Analytics.tsx` | **2,554** | Charts + data transforms + UI states |
| `api/src/routes/memory.ts` | **2,405** | 3 memory types (episodic, semantic, procedural) in one file |
| `worker/epic/git-ops.ts` | **2,393** | Worktree + branch + commit + cleanup |

### 1.3 SSL Certificate Validation Disabled

`api/src/db/connection.ts:468` — `rejectUnauthorized: false` on RDS SSL connection. Allows MITM attacks on database connection. Should use `rejectUnauthorized: true` with AWS RDS CA bundle.

### 1.4 Missing Transactions on Critical Paths

- **Task completion** (`task-monitor.ts`): Status update, context archival, and child cleanup are 3 separate queries — partial failure leaves orphaned state.
- **Webhook idempotency** (`webhooks.ts`): Race condition between duplicate check and insert.
- **Plan approval**: Plan status + task status updated without atomicity.

### 1.5 Dead Packages Cluttering Monorepo

5 abandoned packages from original modular architecture — never imported, never published:

| Package | Files | Status |
|---------|-------|--------|
| `packages/api/` | 3 | Dead |
| `packages/cli/` | 7 | Dead |
| `packages/core/` | 18 | Dead |
| `packages/dashboard/` | 7 | Dead (real frontend is at `/frontend/`) |
| `packages/integrations/` | 4 | Dead |

---

## Tier 2: High (next 2-4 weeks)

### 2.1 TypeORM `.save()` Clobber Risk

65 files use `.save()` — reads entity, does async work, writes ALL columns back. Any concurrent modification between read and write is silently overwritten. Key offenders:

- `task-dispatch.ts:298-300` — modifies `workerPersona` then `.save(task)` while orchestrator may update status
- `tasks.ts` — status transitions via `.save()` instead of atomic `UPDATE...WHERE`
- Pattern appears across routes for task cancellation, completion, and status changes

### 2.2 God Models

**WorkerTask** (`api/src/models/WorkerTask.ts`, 1,022 lines):
- 104 columns, 67 nullable
- Mixes core state + workflow modes + execution tracking + cost tracking + pipeline config + quality gates
- Candidates for extraction: `TaskExecution`, `TaskPipeline`, `PlanApproval` tables

**Organization** (`api/src/models/Organization.ts`, 684 lines):
- 136 columns covering billing, worker config, planning config, provider routing, email preferences, quality gates, budget tracking
- Should split into: `OrganizationBilling`, `OrganizationWorkerSettings`, `OrganizationPlanningSettings`, `OrganizationProviderConfig`

### 2.3 Inconsistent Error Handling

- Routes mix `res.status(400).json({ error })`, `throw new BadRequestError()`, and silent `logger.warn()` + continue
- 4 service files use `console.error()` instead of structured logger:
  - `critic-agent.ts`
  - `llm-backend.ts`
  - `local-epic-spawner.ts`
  - `planning-workflow.ts`
- Orchestrator fire-and-forget pattern (6 instances): `spawnWorker(task).catch(log)` — worker spawn fails, task stays "claimed" forever with no recovery

### 2.4 SCM Provider Duplication

Three provider files with ~70% duplicated code:
- `bitbucket-provider.ts` (895 lines)
- `github-provider.ts` (864 lines)
- `gitlab-provider.ts` (813 lines)

Duplicated: webhook parsing, auth patterns, PR creation logic. Base provider exists (269 lines) but isn't used effectively.

### 2.5 Type Safety Gaps

- **API**: 17 `as any` casts, 7 `: any` annotations. Notably `enforceFileDependencies(plan: any): any` in orchestrator-utils.
- **Frontend**: 10+ `catch (err: any)` patterns across auth pages, `(task: any)` maps in Dashboard.
- **Worker**: Implicit `any` in coordinator loops, unvalidated `JSON.parse()` calls.

### 2.6 Incomplete TODO/FIXMEs (blocking features)

| Location | Issue |
|----------|-------|
| `routes/worker-api.ts:72` | `TODO: Call assembleFullPlanningPrompt()` — placeholder prompt |
| `routes/worker-api.ts:113` | `TODO: Call validateAndBuildPlan()` — stores raw output |
| `services/ecs-task-runner.ts:419,738` | `TODO: Restore Spot with fallback after demo` — still On-Demand only (cost impact) |
| `worker/manager/index.ts:212` | `TODO: implement with Agent SDK` — log analysis not implemented |
| `worker/multi-expert/index.ts:2295` | `TODO: Extract from executor output` — filesModified hardcoded empty |

---

## Tier 3: Medium (next 1-2 months)

### 3.1 Frontend Architecture

- **0 error boundaries** around Dashboard panels, Settings sections — one error crashes entire page
- **16 useState hooks** in Dashboard polling loop — causes full re-render on each poll. Needs useReducer or Zustand
- **Direct API calls** in components bypassing stores (`Profile.tsx`, `Settings.tsx`, `CardDetail.tsx`)
- **Persona config duplication**: PERSONA_CONFIGS defined in both `CoordinationFeed.tsx` and `DependencyGraph.tsx`
- **Accessibility**: 10+ `<div onClick>` elements missing keyboard support, missing aria-labels on modals/inputs, `dangerouslySetInnerHTML` in `LogSearch.tsx`

### 3.2 Migration Bloat

141 migrations including:
- Duplicate timestamps (`1704067200017` used twice, requires aliasing)
- Data migrations mixed with schema (persona directive seeding across 5 migrations)
- User-specific diagnostic migrations checked into repo (`DiagnoseBradUser`, `CleanupJarod120User`, `DeleteJarodTestUsers`, `DeleteJarodTestUsersAgain`)

### 3.3 N+1 Query Patterns

- Orchestrator claims tasks individually in a loop (10 tasks = 10 UPDATE statements)
- Control-center loads parent task, then fetches children, then fetches logs — 3 separate queries without joins
- Missing compound indexes on hot query paths:
  - `WorkerTaskLog(taskId, createdAt)`
  - `RemoteAgent(orgId, lastHeartbeatAt)`
  - `Organization(id, systemEnabled)`
  - `TaskRelationship(sourceTaskId, relationshipType)`

### 3.4 Configuration Scatter

- 202 instances of `process.env.*` across codebase with no centralized validation
- No startup config validation — API starts even with empty `DATABASE_URL`
- Business logic constants (plan pricing, quotas, overage rates) hardcoded in `Organization.ts` model — requires redeployment to change prices

### 3.5 Build & Deployment Debt

- Worker Dockerfile doesn't pin `node:20-bookworm` to specific version
- `npm install -g @anthropic-ai/claude-code` unpinned in Dockerfile — could break on CLI update
- `deploy.sh` hardcodes AWS account ID (`AWS_ACCOUNT_ID`)
- Agent npm publish is fully manual with no CI/CD
- Inconsistent axios versions across 6 packages (`^1.6.0` to `^1.13.3`)

### 3.6 Infrastructure Naming

All production resources named with `dev` suffix due to historical naming:
- ECS cluster: `workermill-dev`
- ECR repos: `workermill-dev/api`, `workermill-dev/worker`
- RDS instance: `workermill-dev`
- S3 bucket: `workermill-dev-frontend-AWS_ACCOUNT_ID`

Confusing for operators but renaming requires significant migration effort.

---

## Tier 4: Low (strategic/long-term)

- Hardcoded AZ list in Terraform (should use `data.aws_availability_zones`)
- Worker container has no health check in ECS task definition
- Overly broad sudo for `/usr/bin/env` in worker Dockerfile
- 141 migration files — consider squashing historical migrations
- Email templates inline in `email.ts` (2,993 lines) — extract to template files
- Deprecated files (`critic-agent-local.ts`, `planning-agent-local.ts`) kept for "rollback safety"
- `bin/bastion` hardcodes Lambda function name `workermill-dev-bastion-control`
- Terraform TODO: `Sync db-credentials secret with actual RDS password`

---

## Recommended Action Plan

### Phase 1: Quick Wins (1-2 days)

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 1 | Fix SSL `rejectUnauthorized: true` in connection.ts | 5 min | Security |
| 2 | Delete 5 dead packages (`packages/api,cli,core,dashboard,integrations`) | 30 min | Cleanliness |
| 3 | Pin Dockerfile dependencies (node version, claude-code, aider) | 1 hour | Reliability |
| 4 | Replace `console.error` with `logger` in 4 service files | 30 min | Observability |

### Phase 2: Safety (1 week)

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 5 | Add transactions to task completion, webhook idempotency, plan approval | 2 days | Data integrity |
| 6 | Replace `.save()` with atomic `.update()` for status transitions | 3 days | Concurrency safety |
| 7 | Fix type safety: replace `as any` casts with proper types | 2 days | Correctness |

### Phase 3: Decomposition (2-3 weeks)

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 8 | Decompose `Settings.tsx` (8,315 lines) into 9 tab modules | 3 days | Maintainability |
| 9 | Decompose `Dashboard.tsx` (5,290 lines) into sub-components | 3 days | Maintainability |
| 10 | Split `settings.ts` route (4,684 lines) into 4 focused modules | 2 days | Maintainability |
| 11 | Split `webhooks.ts` (3,814 lines) by provider | 2 days | Maintainability |
| 12 | Split `planning-agent.ts` (3,340 lines) V1/V2/V3 | 2 days | Maintainability |
| 13 | Consolidate SCM providers to use base class | 3 days | DRY |

### Phase 4: Testing (ongoing)

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 14 | Set up Vitest for frontend components | 1 day | Foundation |
| 15 | Add tests for `settings.ts` (60 endpoints) | 3 days | Coverage |
| 16 | Add tests for webhook handlers (all 5 providers) | 3 days | Coverage |
| 17 | Add tests for task status machine | 2 days | Coverage |

### Phase 5: Architecture (strategic)

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 18 | Split WorkerTask model (104 columns → 3-4 tables) | 1 week | Schema clarity |
| 19 | Split Organization model (136 columns → 4-5 tables) | 1 week | Schema clarity |
| 20 | Centralize config validation with Zod | 3 days | Reliability |
| 21 | Add missing database indexes on hot paths | 1 day | Performance |
| 22 | Squash historical migrations | 2 days | Cleanliness |

---

## Previously Addressed

| Item | Status | Commit |
|------|--------|--------|
| Orchestrator monolith (6,446 lines) | **DONE** — decomposed into 8 modules (336 lines remaining) | `1ec5130` |
| orchestrator-v2.ts rename to pipeline-executor.ts | **DONE** | `1ec5130` |
| Credential dedup (getOrgCredentials shared) | **DONE** | `1ec5130` |

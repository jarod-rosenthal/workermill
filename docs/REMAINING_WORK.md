# WorkerMill - Remaining Implementation Work

**Last Updated:** 2026-02-04
**Review Source:** Comprehensive codebase verification against all improvement docs

This document consolidates all outstanding implementation work from various planning documents. Completed plans have been moved to `docs/archive/`.

---

## Priority Legend

| Priority | Description |
|----------|-------------|
| 🔴 **Critical** | Security risk or blocking functionality |
| 🟠 **High** | Significant functionality gap |
| 🟡 **Medium** | Quality of life improvement |
| 🟢 **Low** | Polish or optimization |

---

## 🔴 Critical Priority

### 1. MFA Backup/Recovery Codes
**Source:** `docs/MFA_IMPLEMENTATION_PLAN.md` (Phase 3)

Users can get permanently locked out if they lose their authenticator device.

**What's Missing:**
- `user_backup_codes` database table
- Backup code generation during MFA setup
- Backup code display UI
- `POST /api/auth/mfa/backup` endpoint for recovery
- Admin MFA reset capability

**Files to Create/Modify:**
- New migration for `user_backup_codes` table
- `api/src/routes/profile.ts` - Add backup code endpoints
- `frontend/src/components/MfaSetupModal.tsx` - Show backup codes after setup

---

### 2. Story Execution Timeout
**Source:** `docs/plans/multi-expert-fixes.md` (Fix 5)

If an executor process hangs indefinitely, the story never completes and dependent stories wait forever.

**What's Missing:**
- `STORY_TIMEOUT_MS` constant (suggested: 15 minutes)
- `setTimeout()` on spawned child process
- SIGTERM → SIGKILL escalation pattern

**Files to Modify:**
- `worker/multi-expert/index.ts` - Add timeout in `executeStory()` method (~line 2293)

---

### 3. Billing Reset Ignores Individual Cycles
**Source:** `docs/TECH_DEBT.md` (P1 Issue #2)

`resetMonthlyUsage()` resets ALL organizations simultaneously, ignoring each org's individual `billingCycleStart` date.

**Files to Modify:**
- `api/src/services/billing.ts:568-580` - Filter by `billingCycleStart` cutoff

---

## 🟠 High Priority

### 4. Circular Dependency Detection
**Source:** `docs/plans/multi-expert-fixes.md` (Fix 3)

If Story A depends on Story B, and Story B depends on Story A, both stay blocked forever with no explicit error.

**Current State:** Logs "No progress" message but no DFS cycle detection

**What's Missing:**
- `detectCircularDependencies()` function with DFS algorithm
- Fail-fast at startup if cycles detected
- Clear error message identifying the cycle

**Files to Modify:**
- `worker/multi-expert/index.ts` - Add cycle detection in `start()` method

---

### 5. API Errors vs Empty Results
**Source:** `docs/plans/multi-expert-fixes.md` (Fix 7)

`fetchStories()` returns empty array on API error, causing coordinator to exit early thinking all work is done.

**What's Missing:**
- Return type change: `{ stories: Story[]; error?: string }`
- Caller retry logic on transient errors

**Files to Modify:**
- `worker/multi-expert/index.ts:1531-1534`

---

### 6. Decision Log / ADR Persistence
**Source:** `docs/TEAM_COLLABORATION_GAPS.md` (Gap 5)

Architectural decisions posted to coordination feed are lost after `logRetentionDays` (30 days). No durable record in repository.

**What's Missing:**
- Post-task hook to generate `architecture/DECISIONS.md`
- Format decisions as Architecture Decision Records (ADRs)
- Commit ADR file to repository

**Files to Create/Modify:**
- `api/src/services/orchestrator.ts` - Add completion hook
- New utility: ADR formatting function

---

### 7. Expert Spawning Mid-Task
**Source:** `docs/TEAM_COLLABORATION_GAPS.md` (Gap 3)

Workers cannot dynamically spawn a specialist (e.g., security engineer) to answer a question.

**What's Missing:**
- `request_expert()` shell function in entrypoint.sh
- API endpoint to spawn single-task expert worker
- Parent blocking mechanism until expert completes

**Files to Create/Modify:**
- `worker/entrypoint.sh` - Add `request_expert()` function
- `api/src/routes/coordination.ts` - Add expert spawn endpoint
- Orchestrator logic to spawn bounded expert workers

---

### 8. Organization-Level MFA Enforcement
**Source:** `docs/MFA_IMPLEMENTATION_PLAN.md` (Phase 2)

Admins cannot require MFA for all organization members.

**What's Missing:**
- `Organization.mfaRequired` column
- `Organization.mfaGracePeriodDays` column
- Settings UI toggle for "Require MFA"
- Middleware to block non-MFA users when required
- Member list showing MFA status

**Files to Modify:**
- `api/src/models/Organization.ts`
- New migration for columns
- `api/src/routes/settings.ts`
- `frontend/src/pages/Settings.tsx`

---

## 🟡 Medium Priority

### 9. Auto-Collapse Epic Execution Plan
**Source:** `frontend/docs/plans/epic-workflow-ui-improvements.md`

When an Epic task starts executing, the execution plan should auto-collapse to save screen space.

**What's Missing:**
- `useEffect` hook monitoring Epic task status
- Remove from `expandedPlans` when status changes from `pending_plan_approval`

**Files to Modify:**
- `frontend/src/pages/Dashboard.tsx`

---

### 10. Use EpicProgressRing Component
**Source:** `frontend/docs/plans/epic-workflow-ui-improvements.md`

Component exists at `frontend/src/components/EpicProgressRing.tsx` but is not used anywhere.

**What's Missing:**
- Import and integrate into task card displays
- Replace or supplement RalphProgress for percentage display

**Files to Modify:**
- `frontend/src/pages/Dashboard.tsx`

---

### 11. Claim Failure Logging
**Source:** `docs/plans/multi-expert-fixes.md` (Fix 6)

When `claimStory()` fails, the code silently continues with no visibility.

**What's Missing:**
- Log message when claim fails
- Post to coordination feed explaining the skip

**Files to Modify:**
- `worker/multi-expert/index.ts` - Around claim failure handling

---

### 12. Streaming Proxy Buffers Response
**Source:** `docs/TECH_DEBT.md` (P1 Issue #1)

The Anthropic API proxy uses `selfHandleResponse: true` which buffers the entire response, breaking SSE streaming.

**Verification Needed:** Confirm if workers actually use this proxy for streaming calls.

**Files to Modify:**
- `worker/src/proxy/anthropic-proxy.ts:23-27`

---

### 13. Multi-Tenancy Webhook Org Selection
**Source:** `docs/TECH_DEBT.md` (P2 Issue #3)

Webhooks use heuristic to find org (first active user's org). Breaks in true multi-tenant environment.

**Current Impact:** Not blocking - currently single-tenant mode

**Files to Modify:**
- `api/src/routes/webhooks.ts:173-183`

---

## 🟢 Low Priority

### 14. Consolidated Story Fetch Endpoint
**Source:** `docs/plans/multi-expert-fixes.md` (Fix 2)

No dedicated endpoint returning all story statuses in one atomic read.

**Files to Create:**
- `api/src/routes/coordination.ts` - Add `GET /api/coordination/stories/:parentTaskId`

---

### 15. Bounded Context Fetching
**Source:** `docs/plans/multi-expert-fixes.md` (Fix 8)

`getAllContexts()` loads ALL context messages, unbounded memory for large PRDs.

**Files to Modify:**
- `api/src/routes/coordination.ts` - Add `GET /api/coordination/stories/:parentTaskId/completed`
- `worker/multi-expert/coordination-client.ts`

---

### 16. ECS Credentials via Secrets Manager
**Source:** `docs/TECH_DEBT.md` (P2 Issue #5)

Sensitive credentials passed as plain environment variables to ECS tasks.

**Files to Modify:**
- `api/src/services/ecs-task-runner.ts:130-136`
- Terraform task definition changes

---

### 17. Missing Jira Webhook Audit Log
**Source:** `docs/TECH_DEBT.md` (P3 Issue #6)

Tasks created from Jira webhooks don't call `logTaskCreated()`.

**Files to Modify:**
- `api/src/routes/webhooks.ts:502` - Add audit logging

---

## Feature Roadmap Items (Future)

The following items from `docs/FEATURE_ROADMAP_2026.md` are wishlist features for future development:

| Phase | Feature Area | Notes |
|-------|--------------|-------|
| 1 | AI FinOps & Cost Intelligence | Token tracking, cost forecasting, budget enforcement |
| 2 | Intelligent Model Routing | Task complexity classification, cost-aware routing |
| 3 | Agent Memory & Learning | Repository memory, feedback learning, skill accumulation |
| 4 | Quality Gates Integration | SonarQube, test coverage, security scanning |
| 5 | Enhanced Observability | OpenTelemetry, distributed tracing |
| 6 | Enterprise Security | SOC 2 reports, SIEM integration, CMEK |
| 7 | Interactive Planning | Dependency graph visualization, drag-and-drop editing |
| 8 | Self-Healing | Intelligent retry, context recovery, degraded mode |
| 9 | Collaboration | Slack/Teams integration, shared dashboards |

---

## Archived Documents

Completed implementation plans have been moved to `docs/archive/`:

| Document | Description |
|----------|-------------|
| `CHECKPOINT_RECOVERY_PLAN.md` | Blocker handling + resilience system |
| `BLOCKER_HANDLING_PLAN.md` | Original blocker handling plan |
| `deploy-improvements-plan.md` | Deploy.sh database connectivity features |
| `PERSONA_CUSTOMIZATION_PLAN.md` | Custom persona studio |
| `LOCAL_PLANNING_INTEGRATION.md` | Mutex groups and validation for local mode |
| `LOCAL_WORKERMILL_PLAN.md` | Local Docker-based execution |
| `EPIC_MODE_IMPLEMENTATION_PLAN.md` | Parallel multi-agent execution |
| `plans/decouple-planning-agent-from-epic-execution.md` | Separate planning provider from execution |

---

## Quick Reference: Files by Priority

### Critical (Fix First)
```
api/src/routes/profile.ts          # MFA backup codes
worker/multi-expert/index.ts       # Story timeout
api/src/services/billing.ts        # Billing cycle fix
```

### High Priority
```
worker/multi-expert/index.ts       # Circular deps, API error handling
api/src/services/orchestrator.ts   # ADR persistence hook
worker/entrypoint.sh               # Expert spawning
api/src/models/Organization.ts     # MFA enforcement columns
```

### Medium Priority
```
frontend/src/pages/Dashboard.tsx   # Auto-collapse, EpicProgressRing
worker/multi-expert/index.ts       # Claim failure logging
worker/src/proxy/anthropic-proxy.ts # Streaming fix
api/src/routes/webhooks.ts         # Multi-tenancy
```

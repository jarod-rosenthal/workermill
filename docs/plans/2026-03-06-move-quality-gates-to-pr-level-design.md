# Move Quality Gates to PR Level Only

Date: 2026-03-06

## Problem

Per-story quality gates (Gate 1) run lint/typecheck/test in isolated worktrees. Each story passes in isolation, but when the coordinator merges all stories into the feature branch, cross-story errors appear (unused imports, conflicting types, duplicate test IDs). The integration fixer runs on the merged branch but has zero retries — one failed fix attempt and it gives up as "unfixable." Meanwhile, per-story Gate 2 (post-push CI) is dead code: CI only triggers on `push: main` and `pull_request: main`, so story branches wait 3 minutes and silently skip.

Result: tokens wasted on per-story fix retries that don't matter, and the one place that matters (integration fixer) gets no retries.

## Solution

1. Remove per-story quality gates from the executor
2. Add retry support to the integration fixer
3. Consolidate retry settings from 6 to 3

## Changes

### 1. Executor: remove per-story gates

**`executor.ts`:**
- Remove `runPreCommitGate()` call (line ~1745)
- Remove `runPostPushCIGate()` call on story branches (line ~1805)
- Remove `qualityGateRetryCountByStory` map and all quality gate retry logic in the error handler (~lines 1894-2046)
- Remove `qualityGateMaxRetries` from resilience defaults
- Delete `runPreCommitGate()` method (only used per-story)
- Keep `runPostPushCIGate()` method (still used by coordinator)

**`types.ts`:**
- Remove `qualityGateMaxRetries` from resilience type
- Add `maxFixRetries` to `EpicConfig`

**`index.ts` and `remote-bootstrap.ts`:**
- Remove `QUALITY_GATE_MAX_RETRIES` env var parsing
- Remove `qualityGateMaxRetries` from config construction

**`inline-gate-fixer.ts`:**
- Delete file (only used by per-story gate retries)

Stories now flow: agent runs -> commit -> push. No gates, no waiting.

### 2. Integration fixer: add retries

**`inline-integration-fixer.ts`:**
- `fix()` accepts `maxRetries` from config (`config.maxFixRetries`)
- Retry loop: run gates -> fail -> spawn fix agent -> verify -> still failing -> retry with previous failure context -> up to `maxFixRetries` attempts
- Each retry passes accumulated failure output so the fix agent learns from prior attempts

**`coordinator.ts`:**
- Pass `config.maxFixRetries` to integration fixer at line ~3165
- Replace hardcoded `maxCiFixRetries = parseInt(process.env.MAX_CI_FIX_RETRIES || "3", 10)` with `config.maxFixRetries`
- `mergeWithCIVerification()` reads same setting
- Log each retry attempt to dashboard

### 3. Consolidate retry settings

**Final user-facing settings (3 total):**

| Setting | Purpose | Source |
|---------|---------|--------|
| `maxFixRetries` | Fix agent retries for both integration fixer and CI fixer | Org settings via API |
| `blockerMaxAutoRetries` | Agent crash/error recovery per story | Org settings via API |
| `blockerAutoRetryEnabled` | Toggle for above | Org settings via API |

**Removed:**
- `QUALITY_GATE_MAX_RETRIES` / `qualityGateMaxRetries` — dead after Gate 1 removal
- `MAX_CI_FIX_RETRIES` / `maxCiFixRetries` — replaced by `maxFixRetries`

**Unchanged (internal, not user-configured):**
- `api-retry` (HTTP retry for API calls)
- `decision-client RETRY_CONFIG` (HTTP retry for decision API)

### 4. No hardcoded fallbacks

`maxFixRetries` comes from org settings in the DB, passed through the task config by the API. No `|| "3"` or `?? 3` patterns in the worker. The API is the source of truth for defaults.

### 5. What stays the same

- `qualityGateCommands` config — still used by integration fixer and CI fixer
- `qualityGateBypass` — still respected by coordinator
- `qualityGateEnabled` — still respected by coordinator
- `inline-ci-fixer.ts` — reads `maxFixRetries` instead of `maxCiFixRetries`
- `mergeWithCIVerification()` — same logic, different config source
- `runPostPushCIGate()` on executor — kept as method, no longer called per-story

## Files affected

- `worker/epic/executor.ts` — remove gate calls and retry logic
- `worker/epic/types.ts` — remove `qualityGateMaxRetries`, add `maxFixRetries` to config
- `worker/epic/index.ts` — remove env var parsing
- `worker/epic/remote-bootstrap.ts` — remove env var parsing
- `worker/epic/inline-integration-fixer.ts` — add retry loop
- `worker/epic/coordinator.ts` — use `config.maxFixRetries`, remove `MAX_CI_FIX_RETRIES`
- `worker/epic/inline-gate-fixer.ts` — delete file
- `api/src/services/ecs-task-runner.ts` or equivalent — pass `maxFixRetries` from org settings

# WorkerMill Settings Audit

**Date:** 2026-02-08
**Scope:** Full audit of organization settings — from frontend UI through API to worker containers
**Method:** Static analysis of Organization model, settings routes, spawners, and worker env var reads
**Verified:** Cross-referenced against source code (`ecs-task-runner.ts`, `local-epic-spawner.ts`, `Organization.ts`, `settings.ts`, `worker/epic/*.ts`, `worker/Dockerfile`)
**Corrections applied:** 2026-02-08 — Fixed `EXECUTION_MODE` (present in ECS), `autoDeployEnabled`/`REVIEW_ENABLED` appendix errors, added `/api/codebase` route note, confirmed auto-fix/skill-extraction API wiring, resolved `.ts`/`.js` divergence (`.ts` = production, CLAUDE.md updated)

---

## Critical: Settings Not Reaching Workers

### 1. Resilience Settings Missing from ECS (Cloud) Workers

These settings are properly passed by `local-epic-spawner.ts` but **never included in `ecs-task-runner.ts`** environment arrays. Cloud workers fall back to hardcoded defaults, ignoring whatever the user configures in Settings.

| Setting | Org Field | Env Var Worker Reads | Local Spawner | ECS Spawner |
|---------|-----------|---------------------|---------------|-------------|
| Blocker auto-retries | `blockerMaxAutoRetries` | `BLOCKER_MAX_AUTO_RETRIES` | ✅ Passed (line 647) | ❌ Missing |
| Blocker retry toggle | `blockerAutoRetryEnabled` | `BLOCKER_AUTO_RETRY_ENABLED` | ✅ Passed (line 648) | ❌ Missing |
| Push after commit | `pushAfterCommit` | `PUSH_AFTER_COMMIT` | ✅ Passed (line 649) | ❌ Missing |
| Graceful shutdown | `gracefulShutdownEnabled` | `GRACEFUL_SHUTDOWN_ENABLED` | ✅ Passed (line 650) | ❌ Missing |
| Self-review | `selfReviewEnabled` | `SELF_REVIEW_ENABLED` | ✅ Passed (line 651) | ❌ Missing |

**Files involved:**
- `api/src/services/local-epic-spawner.ts` — `buildEnvArgs()` passes these correctly (lines 647-651)
- `api/src/services/ecs-task-runner.ts` — `runWorkerTask()` environment array (lines 126-261) omits them
- `worker/epic/index.ts` (lines 85-89) — reads all five env vars

**Impact:** Cloud-deployed tasks ignore user's resilience preferences. For example, a user could disable self-review in Settings but cloud workers still run it (default `true`).

### 2. Local-vs-ECS Env Var Parity Gap

The local spawner is missing many env vars that ECS passes, and vice versa. This goes well beyond just manager settings.

#### Missing from Local Spawner (present in ECS)

| Env Var | ECS Line | Impact |
|---------|----------|--------|
| `MANAGER_PROVIDER` | 193 | Local workers can't use configured manager provider for tech lead review |
| `MANAGER_MODEL` | 194 | Local workers can't use configured manager model |
| `JIRA_BASE_URL` | 149 | Local workers cannot update Jira tickets |
| `JIRA_EMAIL` | 150 | Local workers cannot authenticate to Jira API |
| `JIRA_API_TOKEN` | 151 | Local workers cannot authenticate to Jira API |
| `WORKER_PERSONA` | 133 | Worker doesn't know its assigned persona |
| `DEPLOYMENT_ENABLED` | 156-158 | Local workers don't know if auto-deploy is set on the task |
| `IMPROVEMENT_ENABLED` | 171 | Local workers can't run improvement flows |
| `QUALITY_GATE_BYPASS` | 175 | Local workers can't bypass quality gates |
| `STANDARD_SDK_MODE` | 181 | Local workers can't use SDK mode |
| `TASK_NOTES` | 183 | User notes not passed to local workers |
| `TARGET_BRANCH` | 211-215 | PRD child tasks can't target feature branches |
| `STORY_BRANCH` | 218-222 | PRD workers don't get their designated branch |
| `TARGET_FILES` / `REFERENCE_FILES` | 233-245 | Planning agent file targeting not passed |
| `PARENT_JIRA_KEY` | 200-207 | Synthetic story keys can't update parent ticket |
| `PRD_CHILD_TASK` | 162-164 | Workers don't know they're PRD children |
| `RETRY_NUMBER` | 147 | Workers don't know their retry count |
| `PIPELINE_VERSION` / `V2_STEP_INPUT` | 249-260 | V2 pipeline not supported locally |

**Note:** The local spawner uses different env var names for some overlapping data (`TASK_SUMMARY` vs `JIRA_SUMMARY`, `TARGET_REPO` vs `GITHUB_REPO`). The worker code must handle both names, or one path silently fails.

#### Missing from ECS Spawner (present in Local)

| Env Var | Purpose |
|---------|---------|
| `EPIC_MODE` | Tells container entrypoint to use epic coordinator |
| `GH_TOKEN` | Duplicate of `GITHUB_TOKEN` for tools that expect `GH_TOKEN` |

**Note:** `EXECUTION_MODE` was previously listed here but IS present in ECS (line 226). These are less impactful since ECS has its own routing mechanisms.

### 3. Codebase RAG — Completely Dead Wiring

The Codebase RAG feature is broken at every layer of the stack:

| Layer | Status | Detail |
|-------|--------|--------|
| Frontend UI | ✅ Exists | `Settings.tsx` has full UI (indexing toggle, max files, auto-index on task) |
| API GET /settings | ❌ Not returned | Response object omits all `codebase*` fields (grep for "codebase" in settings.ts: zero matches) |
| API PUT /settings | ❌ Not accepted | Update handler does not process `codebase*` fields |
| API /api/codebase | ✅ Exists | `api/src/routes/codebase.ts` provides indexing/search operational endpoints — but these are runtime operations, not settings CRUD |
| Organization model | ✅ Fields exist | `codebaseIndexingEnabled`, `codebaseMaxFilesPerRepo`, `codebaseMaxFileSizeKb`, `codebaseExcludePatterns`, `codebaseIncludeLanguages`, `codebaseAutoIndexOnTask`, `codebaseMaxRetrievalChunks` (lines 508-564) |
| Local spawner | ❌ Not passed | `CODEBASE_INDEXING_ENABLED` not in env args |
| ECS spawner | ❌ Not passed | `CODEBASE_INDEXING_ENABLED` not in environment array |
| Worker | ⚠️ Reads it | `coordinator.ts` (line 517) reads `process.env.CODEBASE_INDEXING_ENABLED` — always `undefined` |

**Impact:** The Settings UI for codebase RAG configuration saves to nowhere, and workers never receive the settings. Note: a separate `/api/codebase` route exists for triggering indexing/search operations, but the settings (max files, exclude patterns, etc.) are not wired through.

---

## Medium: Settings with Partial or Missing Enforcement

### Default Worker Persona

| Field | `defaultWorkerPersona` |
|-------|------------------------|
| Model | `Organization.ts` (line 200), default `"backend_developer"` |
| API | Returned and updatable |
| Frontend | Configurable dropdown |
| Enforcement | **Partial** — used as a fallback in the **projects** flow (`projects.ts` lines 175, 1238) when creating worker tasks. However, the **webhook** flow uses `persona-inference.ts`, which falls back to `personaInferenceRules.defaultPersona` (line 316: `return orgRules.defaultPersona \|\| "backend_developer"`) — a separate config field — instead of `defaultWorkerPersona`. Users may set one expecting it to affect the other. |

### Task Retention Days

| Field | `taskRetentionDays` (default 90) |
|-------|----------------------------------|
| Model | `Organization.ts` (line 184) |
| API | Returned and updatable |
| Frontend | Configurable |
| Enforcement | **None** — no cleanup job deletes old tasks based on this value. (Note: `logRetentionDays` **is** enforced at `orchestrator.ts` line 5827 — but `taskRetentionDays` is not.) |

### qualityGateEnabled (Appendix Correction)

| Field | `qualityGateEnabled` |
|-------|----------------------|
| Appendix claim | Listed as "Properly Connected" with `QUALITY_THRESHOLDS` in ECS |
| Actual | ECS spawner passes `QUALITY_GATE_BYPASS` (line 175), **not** `QUALITY_THRESHOLDS`. Neither spawner passes `QUALITY_GATE_ENABLED` as an env var. Quality gate enforcement appears to be orchestrator-level only, not container-level. |

### Auto-Fix Settings

| Fields | `autoFixEnabled`, `autoFixMaxIterations`, `autoFixStats` |
|--------|-----------------------------------------------------------|
| Model | `Organization.ts` (lines 442-455) |
| API GET | ✅ Returned (`settings.ts` lines 154-156) |
| API PUT | ✅ Accepted with validation: `autoFixMaxIterations` must be 1-10 (`settings.ts` lines 932-942) |
| Spawner/Worker | Not verified — need to check whether these are passed as env vars to workers |

### Auto-Skill Extraction

| Field | `autoSkillExtraction` (default `true`) |
|-------|----------------------------------------|
| Model | `Organization.ts` (line 339) |
| API GET | ✅ Returned (`settings.ts` line 133) |
| API PUT | ✅ Accepted (`settings.ts` lines 796-797) |
| Enforcement | Not verified — need to check whether any worker code reads this |

---

## Low: Enterprise Features — Model/UI Stubs Only

These fields exist in the Organization model (some with frontend UI) but have no service-layer implementation. They appear to be forward-looking stubs for enterprise features.

### SIEM Integration

| Fields | `siemEnabled`, `siemProvider`, `siemWebhookUrl`, `siemWebhookSecret`, `siemEventFilters` |
|--------|-------------------------------------------------------------------------------------------|
| Status | Model fields only. No event forwarding service exists. Not exposed in API settings endpoint. |

### External Quality Tool Integrations

| Fields | `sonarqubeUrl`, `sonarqubeToken`, `coderabbitEnabled`, `coderabbitApiKey`, `deepsourceEnabled`, `deepsourceToken`, `qualityWebhookUrl`, `qualityWebhookSecret` |
|--------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Status | Model fields with API exposure (GET returns masked tokens, PUT accepts updates with validation). Frontend has configuration UI. **However**, no integration code calls these external services during task execution or PR review — the settings are saved but never consumed. |

### Customer-Managed Encryption Keys (CMEK)

| Fields | `cmekEnabled`, `cmekKeyArn`, `cmekKeyAlias`, `cmekKeyRegion`, `cmekLastRotation`, `cmekRotationScheduleDays` |
|--------|----------------------------------------------------------------------------------------------------------------|
| Status | Model fields only. No KMS integration. All data encrypted with AWS-managed keys regardless of these settings. Not exposed in API. |

### Data Residency

| Fields | `dataRegion`, `dataResidencyMode` |
|--------|-----------------------------------|
| Status | Model fields only. All data stored in us-east-1 regardless of `dataResidencyMode` value. No routing logic enforces region constraints. Not exposed in API. |

### Feature Flags

| Fields | `featureFlags` (`unifiedAiClient`, `shadowModeEnabled`) |
|--------|----------------------------------------------------------|
| Status | Model field only. No code checks `org.featureFlags.unifiedAiClient` or `shadowModeEnabled` before making execution decisions. Not exposed in API. |

### Auto-Improve

| Field | `autoImproveEnabled` |
|-------|----------------------|
| Status | Model field. **Returned in API GET** (settings.ts line 132) **and accepted in PUT** (settings.ts lines 792-793). However, no code triggers self-improvement workflows based on this flag — the setting is saved but never consumed at runtime. |

---

## Note: worker/epic/ TypeScript vs JavaScript Files

The `worker/epic/` directory contains both `.ts` and `.js` files. The Dockerfile (`worker/Dockerfile` lines 131-134) copies the entire `epic/` directory and runs `npm run build` (which is `tsc`), compiling TypeScript to `dist/`. The container entrypoint (`epic-entrypoint.sh` line 267) runs `node dist/index.js`. The 3 standalone `.js` files in the directory root (`agent-sdk.js`, `inline-reviewer.js`, `types.js`) are legacy artifacts — **dead code** not used at runtime. All env var references in this audit point to the `.ts` source files, which are the actual code that gets compiled and runs in containers.

`CLAUDE.md` has been updated to reflect this: `.ts` files are production source, `.js` files are dead code.

---

## Summary

| Category | Count | Severity | Fix Complexity |
|----------|-------|----------|----------------|
| Resilience settings not passed to ECS workers | 5 env vars | **Critical** | Low — add to `ecs-task-runner.ts` env array |
| Local spawner env var parity gap | ~17 env vars | **Critical** | Medium — add to `local-epic-spawner.ts` buildEnvArgs; some require credentials plumbing |
| Codebase RAG dead wiring | 7 fields | **Medium** | Medium — wire API GET/PUT, add to spawners, or remove UI |
| Settings with partial or missing enforcement | 4 fields | **Medium** | Varies — `defaultWorkerPersona` needs consistent fallback, `taskRetentionDays` needs cleanup job, `qualityGateEnabled` needs verification |
| Enterprise feature stubs | ~15 fields | **Low** | N/A — intentional stubs, but should not be shown in UI |

### Recommended Priority

1. **Add resilience env vars to `ecs-task-runner.ts`** — highest impact, lowest effort (5 lines)
2. **Add Jira credentials + `WORKER_PERSONA` to `local-epic-spawner.ts`** — local workers can't update tickets or know their persona
3. **Add `MANAGER_PROVIDER`/`MANAGER_MODEL` to `local-epic-spawner.ts`** — parity fix for tech lead review
4. **Add remaining parity env vars to local spawner** — `DEPLOYMENT_ENABLED`, `TARGET_BRANCH`, `TASK_NOTES`, etc.
5. **Decide on Codebase RAG** — either complete the wiring or remove the frontend UI
6. **Implement task retention cleanup job** — `taskRetentionDays` has no enforcement (unlike `logRetentionDays` which does)
7. **Verify `qualityGateEnabled` end-to-end** — appendix claims it's connected via `QUALITY_THRESHOLDS` but ECS only passes `QUALITY_GATE_BYPASS`
8. **Audit Settings UI** — hide or label features that aren't implemented yet (SIEM, quality tools)
9. ~~**Resolve CLAUDE.md contradiction**~~ — **DONE**: CLAUDE.md updated to reflect that `.ts` files are production source (compiled by `tsc`), `.js` files are dead code
10. **Fix `REVIEW_ENABLED` in local spawner** — currently hardcoded from `process.env` instead of reading `task.organization?.autoReviewEnabled`
11. **Fix `DEPLOYMENT_ENABLED` in local spawner** — appendix incorrectly listed as connected; confirmed missing from `buildEnvArgs()`

---

## Appendix: Full Settings Inventory

### Settings Properly Connected End-to-End

These settings work correctly from frontend through API to worker execution:

| Setting | Frontend | API | Local Spawner | ECS Spawner | Worker |
|---------|----------|-----|---------------|-------------|--------|
| `defaultWorkerModel` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `primaryProvider` | ✅ | ✅ | N/A (orchestrator-level) | N/A (orchestrator-level) | N/A |
| `providerRouting` | ✅ | ✅ | N/A (multi-expert only) | ✅ (multi-expert) | ✅ |
| `scmProvider` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `defaultGithubRepo` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `defaultBitbucketRepo` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `defaultGitlabRepo` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `maxConcurrentWorkers` | ✅ | ✅ | N/A (orchestrator-level) | N/A (orchestrator-level) | N/A |
| `taskCooldownSeconds` | ✅ | ✅ | N/A (orchestrator-level) | N/A (orchestrator-level) | N/A |
| `maxReviewRevisions` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `dailyBudgetLimitUsd` | ✅ | ✅ | N/A (budget-enforcement) | N/A (budget-enforcement) | N/A |
| `weeklyBudgetLimitUsd` | ✅ | ✅ | N/A (budget-enforcement) | N/A (budget-enforcement) | N/A |
| `monthlyBudgetLimitUsd` | ✅ | ✅ | N/A (budget-enforcement) | N/A (budget-enforcement) | N/A |
| `perTaskCostCeilingUsd` | ✅ | ✅ | N/A (tasks.ts) | N/A (tasks.ts) | N/A |
| `completedTaskDisplayMinutes` | ✅ | ✅ | N/A (control-center) | N/A (control-center) | N/A |
| `slackWebhookUrl` | ✅ | ✅ | N/A (notifications) | N/A (notifications) | N/A |
| `emailNotificationsEnabled` | ✅ | ✅ | N/A (notifications) | N/A (notifications) | N/A |
| `planningAgentProvider` | ✅ | ✅ | N/A (planning-agent) | N/A (planning-agent) | N/A |
| `planningAgentModel` | ✅ | ✅ | N/A (planning-agent) | N/A (planning-agent) | N/A |
| `storyCalibrationMultiplier` | ✅ | ✅ | N/A (planning-agent) | N/A (planning-agent) | N/A |
| `systemEnabled` | ✅ | ✅ (read-only) | N/A (orchestrator) | N/A (orchestrator) | N/A |
| `autoReviewEnabled` | ✅ | ✅ | ⚠️ (REVIEW_ENABLED hardcoded from `process.env`, ignores org setting) | ✅ (REVIEW_ENABLED) | ✅ |
| `autoDeployEnabled` | ✅ | ✅ | ❌ (DEPLOYMENT_ENABLED not passed) | ✅ (DEPLOYMENT_ENABLED) | ✅ |
| `costAlertThresholdUsd` | ✅ | ✅ | N/A (orchestrator) | N/A (orchestrator) | N/A |
| `defaultMaxRetries` | ✅ | ✅ | N/A (projects.ts) | N/A (projects.ts) | N/A |
| `intermediateTaskDisplayMinutes` | ✅ | ✅ | N/A (control-center) | N/A (control-center) | N/A |
| `dryRunVisibilityMinutes` | ✅ | ✅ | N/A (orchestrator) | N/A (orchestrator) | N/A |
| `warmPoolSize` | ✅ | ✅ | N/A (warm-pool.ts) | N/A (warm-pool.ts) | N/A |
| `warmPoolHoursStart` | ✅ | ✅ | N/A (warm-pool.ts) | N/A (warm-pool.ts) | N/A |
| `warmPoolHoursEnd` | ✅ | ✅ | N/A (warm-pool.ts) | N/A (warm-pool.ts) | N/A |
| `warmPoolTimezone` | ✅ | ✅ | N/A (warm-pool.ts) | N/A (warm-pool.ts) | N/A |
| `logRetentionDays` | ✅ | ✅ | N/A (orchestrator cleanup at line 5827) | N/A | N/A |

**Removed from this table (see issues above):**
- `qualityGateEnabled` — listed as connected via `QUALITY_THRESHOLDS` but ECS actually passes `QUALITY_GATE_BYPASS`; needs verification

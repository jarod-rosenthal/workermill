# Settings Integrity Audit — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every worker configuration value flows from the Organization DB column through spawners to worker env vars — no hardcoded fallbacks, no orphaned feature flags, no dead settings.

**Architecture:** Three categories of fixes: (1) Strip hardcoded fallbacks from worker config loaders so missing env vars surface immediately. (2) Add missing env vars to spawners that skip them. (3) Wire up 3 orphaned feature flags (fileOverlapGatingEnabled, incrementalRebaseEnabled, mergeAgentEnabled) with the full stack: DB migration → Organization entity → API settings routes → remote-agent endpoint → spawners → frontend + VS Code toggles. Also fix maxAgentTurns which exists in DB/UI but never reaches the worker.

**Tech Stack:** TypeScript, TypeORM, Express, React, VS Code extension API

---

## Audit Summary

| Issue | Category | Severity |
|-------|----------|----------|
| `MAX_PARALLEL_EXPERTS \|\| "3"` fallback | Hardcoded fallback | Critical |
| `BLOCKER_MAX_AUTO_RETRIES \|\| "3"` fallback | Hardcoded fallback | Critical |
| `MAX_REVIEW_REVISIONS` raw parseInt (NaN if missing) | Missing guard | Critical |
| `MAX_PER_STORY_REVISIONS` raw parseInt (NaN if missing) | Missing guard | Critical |
| `BLOCKER_WAIT_TIMEOUT_MINUTES` raw parseInt (NaN if missing) | Missing guard | Critical |
| `MAX_AGENT_TURNS` not in remote-agent endpoint or agent spawners | Dead setting | Critical |
| `maxTurns` placed on `expertConfig` but `runAgent` reads `options.maxTurns` | Bug — setting silently ignored | Critical |
| `MAX_REVIEW_REVISIONS` missing from worker-spawner.ts | Missing from spawner | High |
| `MAX_PER_STORY_REVISIONS` missing from worker-spawner.ts | Missing from spawner | High |
| `fileOverlapGatingEnabled` — no DB column, no spawner, hardcoded true | Orphaned flag | High |
| `incrementalRebaseEnabled` — no DB column, no spawner, hardcoded true | Orphaned flag | High |
| `mergeAgentEnabled` — no DB column, no spawner, hardcoded false | Orphaned flag | High |
| `ExpertConfig` missing `maxTurns` field (TS error in Docker build) | Type mismatch | Medium |
| `agent-sdk.d.ts` stale — missing fields from `AgentOptions` | Stale declaration | Medium |
| `pipeline-executor.ts` + `warm-pool.ts` missing new flags | Missing from spawner | High |
| Frontend `index.tsx` has `?? N` fallbacks when loading settings | Hardcoded fallback | Medium |

---

## File Structure

**Modified files:**
- `worker/epic/index.ts` — strip hardcoded fallbacks, add NaN guards
- `worker/epic/remote-bootstrap.ts` — strip hardcoded fallbacks, add NaN guards
- `worker/epic/coordinator.ts` — move `maxTurns` from expertConfig to options level
- `worker/epic/inline-integration-fixer.ts` — move `maxTurns` from expertConfig to options level
- `worker/epic/inline-review-fixer.ts` — move `maxTurns` from expertConfig to options level
- `worker/epic/inline-ci-fixer.ts` — move `maxTurns` from expertConfig to options level
- `api/src/services/worker-spawner.ts` — add missing env vars (MAX_REVIEW_REVISIONS, MAX_PER_STORY_REVISIONS, FILE_OVERLAP_GATING_ENABLED, INCREMENTAL_REBASE_ENABLED, MERGE_AGENT_ENABLED)
- `api/src/routes/remote-agent.ts` — add maxAgentTurns + 3 new flags to config endpoint
- `agent/src/spawner.ts` — add MAX_AGENT_TURNS + 3 new flag env vars
- `agent/src/docker-spawner.ts` — add MAX_AGENT_TURNS + 3 new flag env vars
- `api/src/models/Organization.ts` — add 3 new columns
- `api/src/routes/settings/general.ts` — add 3 new settings (GET + PUT + response)
- `frontend/src/pages/settings/types.ts` — add 3 new fields
- `frontend/src/pages/settings/index.tsx` — add 3 new defaults + strip `??` fallbacks
- `frontend/src/pages/settings/QualitySection.tsx` — add 3 new toggles
- `packages/vscode-workermill/package.json` — add 3 new settings
- `packages/vscode-workermill/src/settings-panel.ts` — add 3 new toggles
- `api/src/db/connection.ts` — register new migration
- `api/src/services/local-epic-spawner.ts` — add 3 new flag env vars

**Created files:**
- `api/src/db/migrations/1742900000000-AddResilienceFlags.ts` — migration for 3 new columns

---

## Chunk 1: Fix maxTurns bug + strip hardcoded fallbacks

### Task 1: Fix maxTurns placement in coordinator and all fixers

The `maxAgentTurns` org setting is in the DB and UI but silently ignored because `maxTurns` is placed inside `expertConfig` (which doesn't have that field) instead of at the `options` level where `runAgent()` reads it.

**Files:**
- Modify: `worker/epic/coordinator.ts:4594-4605`
- Modify: `worker/epic/inline-integration-fixer.ts:594-609`
- Modify: `worker/epic/inline-review-fixer.ts:210-229`
- Modify: `worker/epic/inline-ci-fixer.ts:223-239`

- [ ] **Step 1: Fix coordinator.ts — move maxTurns to options level**

In `worker/epic/coordinator.ts`, around line 4595, the `runAgent` call passes `maxTurns` inside `expertConfig`. Move it to the options level:

```typescript
// BEFORE (line 4595-4605):
const result: AgentResult = await runAgent(this.config, {
  prompt,
  expertConfig: {
    persona: "qa_engineer" as const,
    description: "Quality fix specialist",
    systemPrompt,
    tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
    model,
    specialties: ["testing", "quality"],
    maxTurns: this.config.maxAgentTurns,  // ← WRONG: ExpertConfig has no maxTurns
  },
  repoPath,
  ...
});

// AFTER:
const result: AgentResult = await runAgent(this.config, {
  prompt,
  expertConfig: {
    persona: "qa_engineer" as const,
    description: "Quality fix specialist",
    systemPrompt,
    tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
    model,
    specialties: ["testing", "quality"],
  },
  maxTurns: this.config.maxAgentTurns,  // ← CORRECT: options level
  repoPath,
  ...
});
```

- [ ] **Step 2: Fix inline-integration-fixer.ts — move maxTurns out of fixConfig**

In `worker/epic/inline-integration-fixer.ts`, around line 594-609:

```typescript
// BEFORE:
const fixConfig = {
  persona: "qa_engineer" as const,
  description: "Integration fix specialist — cross-story issue resolution",
  systemPrompt,
  tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
  model: this.model,
  specialties: ["testing", "integration", "quality"],
  maxTurns: this.config.maxAgentTurns,  // ← REMOVE from here
};

return this.executeAgent(
  {
    prompt,
    expertConfig: fixConfig,
    repoPath: this.repoPath,
    storyId: `integration-fix-${prNumber}`,
  },
  ...
);

// AFTER:
const fixConfig = {
  persona: "qa_engineer" as const,
  description: "Integration fix specialist — cross-story issue resolution",
  systemPrompt,
  tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
  model: this.model,
  specialties: ["testing", "integration", "quality"],
};

return this.executeAgent(
  {
    prompt,
    expertConfig: fixConfig,
    maxTurns: this.config.maxAgentTurns,  // ← ADD at options level
    repoPath: this.repoPath,
    storyId: `integration-fix-${prNumber}`,
  },
  ...
);
```

Also update `executeAgent()` (line 145-174) to pass `maxTurns` through to the unified client:

```typescript
// In executeAgent(), when building clientOptions (around line 155):
const clientOptions: AIClientOptions = {
  prompt: options.prompt,
  systemPrompt: options.expertConfig.systemPrompt,
  persona: options.expertConfig.persona,
  model: options.expertConfig.model,
  workingDir: options.repoPath,
  storyId,
  parentTaskId: this.config.parentTaskId,
  env: options.env,
  tools: options.expertConfig.tools,
  maxTurns: options.maxTurns,  // ← ADD this line
  onMessage,
};
```

- [ ] **Step 3: Fix inline-review-fixer.ts — same pattern**

In `worker/epic/inline-review-fixer.ts`, around line 210-228:

Remove `maxTurns` from `reviewFixConfig` object and add it to the `executeAgent` options:

```typescript
const reviewFixConfig = {
  persona: "tech_lead" as const,
  description: "Tech Lead review feedback applicator — surgical code changes",
  systemPrompt,
  tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
  model: this.model,
  specialties: ["code-review", "refactoring", "quality"],
  // maxTurns removed
};

const result = await this.executeAgent(
  {
    prompt,
    expertConfig: reviewFixConfig,
    maxTurns: this.config.maxAgentTurns,  // ← ADD here
    repoPath: this.worktreePath,
    storyId: `review-fix-${this.expert}`,
  },
  ...
);
```

Also update `executeAgent()` in inline-review-fixer.ts to pass `maxTurns` through to the unified client (same pattern as inline-integration-fixer.ts Step 2 — add `maxTurns: options.maxTurns` to `clientOptions`).

- [ ] **Step 4: Fix inline-ci-fixer.ts — same pattern**

In `worker/epic/inline-ci-fixer.ts`, around line 223-239:

Remove `maxTurns` from `ciFixConfig` and add to options:

```typescript
const ciFixConfig = {
  persona: "qa_engineer" as const,
  description: "QA specialist - CI failure diagnosis and fix",
  systemPrompt,
  tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
  model: this.model,
  specialties: ["testing", "ci", "quality"],
  // maxTurns removed
};

const result = await this.executeAgent(
  {
    prompt,
    expertConfig: ciFixConfig,
    maxTurns: this.config.maxAgentTurns,  // ← ADD here
    repoPath: this.repoPath,
    storyId: `ci-fix-${prNumber}`,
  },
  ...
);
```

Also update `executeAgent()` in inline-ci-fixer.ts to pass `maxTurns` through to the unified client (same pattern — add `maxTurns: options.maxTurns` to `clientOptions`).

- [ ] **Step 5: Delete ALL stale .d.ts files in worker/epic/**

Three stale declaration files exist with outdated interfaces. The Docker build compiles from `.ts` source — these `.d.ts` files can cause type resolution conflicts:

- `worker/epic/agent-sdk.d.ts` — outdated `AgentOptions` (missing `maxTurns`, `systemPrompt`, etc.)
- `worker/epic/types.d.ts` — outdated `ExpertConfig` (missing fields added since)
- `worker/epic/inline-reviewer.d.ts` — outdated `InlineReviewer` class

Delete all 6 files (3 `.d.ts` + 3 `.d.ts.map`):

```bash
rm worker/epic/agent-sdk.d.ts worker/epic/agent-sdk.d.ts.map
rm worker/epic/types.d.ts worker/epic/types.d.ts.map
rm worker/epic/inline-reviewer.d.ts worker/epic/inline-reviewer.d.ts.map
```

- [ ] **Step 6: Run worker typecheck**

```bash
cd worker && npm run typecheck
```

Expected: PASS (no errors)

- [ ] **Step 7: Commit**

```bash
git add worker/epic/coordinator.ts worker/epic/inline-integration-fixer.ts worker/epic/inline-review-fixer.ts worker/epic/inline-ci-fixer.ts
git rm worker/epic/agent-sdk.d.ts worker/epic/agent-sdk.d.ts.map worker/epic/types.d.ts worker/epic/types.d.ts.map worker/epic/inline-reviewer.d.ts worker/epic/inline-reviewer.d.ts.map
git commit -m "fix(worker): move maxTurns from expertConfig to options level — setting was silently ignored"
```

---

### Task 2: Strip hardcoded fallbacks from worker config loaders

Remove `|| "3"` and `?? value` fallbacks from `index.ts` and `remote-bootstrap.ts`. These settings come from the DB — if the env var is missing, that's a bug upstream that should surface immediately, not be masked.

**Files:**
- Modify: `worker/epic/index.ts:89,108`
- Modify: `worker/epic/remote-bootstrap.ts:400,413`

- [ ] **Step 1: Fix index.ts loadEpicConfig — strip fallbacks**

In `worker/epic/index.ts`, line 89:

```typescript
// BEFORE:
maxParallelExperts: parseInt(process.env.MAX_PARALLEL_EXPERTS || "3", 10),

// AFTER:
maxParallelExperts: parseInt(process.env.MAX_PARALLEL_EXPERTS, 10),
```

- [ ] **Step 2: Fix index.ts loadResilienceConfig — strip fallbacks**

In `worker/epic/index.ts`, line 108:

```typescript
// BEFORE:
blockerMaxAutoRetries: parseInt(process.env.BLOCKER_MAX_AUTO_RETRIES || "3", 10),

// AFTER:
blockerMaxAutoRetries: parseInt(process.env.BLOCKER_MAX_AUTO_RETRIES, 10),
```

- [ ] **Step 3: Fix remote-bootstrap.ts loadEpicConfig — strip fallbacks**

In `worker/epic/remote-bootstrap.ts`, line 400:

```typescript
// BEFORE:
maxParallelExperts: parseInt(process.env.MAX_PARALLEL_EXPERTS || "3", 10),

// AFTER:
maxParallelExperts: parseInt(process.env.MAX_PARALLEL_EXPERTS, 10),
```

- [ ] **Step 4: Fix remote-bootstrap.ts loadResilienceConfig — strip fallbacks**

In `worker/epic/remote-bootstrap.ts`, line 413:

```typescript
// BEFORE:
blockerMaxAutoRetries: parseInt(process.env.BLOCKER_MAX_AUTO_RETRIES || "3", 10),

// AFTER:
blockerMaxAutoRetries: parseInt(process.env.BLOCKER_MAX_AUTO_RETRIES, 10),
```

- [ ] **Step 5: Run worker typecheck**

```bash
cd worker && npm run typecheck
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add worker/epic/index.ts worker/epic/remote-bootstrap.ts
git commit -m "fix(worker): strip hardcoded fallbacks from config loaders — settings must come from DB"
```

---

### Task 3: Add NaN guards to required parseInt config values

For env vars that are `parseInt`'d without a fallback, add a startup guard that fails fast if the value is missing. This catches spawner bugs immediately instead of producing silent NaN behavior.

**Files:**
- Modify: `worker/epic/index.ts:89-116`
- Modify: `worker/epic/remote-bootstrap.ts:400-420`

- [ ] **Step 1: Add NaN guard helper at top of index.ts**

Add a helper function near the top of `worker/epic/index.ts` (before `loadEpicConfig`):

```typescript
function requireInt(envVar: string): number {
  const raw = process.env[envVar];
  const val = parseInt(raw!, 10);
  if (isNaN(val)) {
    throw new Error(`Required env var ${envVar} is missing or not a number (got: ${JSON.stringify(raw)})`);
  }
  return val;
}
```

Then replace the raw `parseInt` calls for required values:

```typescript
// In loadEpicConfig:
maxParallelExperts: requireInt("MAX_PARALLEL_EXPERTS"),
maxFixRetries: requireInt("MAX_FIX_RETRIES"),  // was conditional — always set by spawners
maxReviewRevisions: requireInt("MAX_REVIEW_REVISIONS"),
maxPerStoryRevisions: requireInt("MAX_PER_STORY_REVISIONS"),

// In loadResilienceConfig:
blockerMaxAutoRetries: requireInt("BLOCKER_MAX_AUTO_RETRIES"),
blockerWaitTimeoutMs: requireInt("BLOCKER_WAIT_TIMEOUT_MINUTES") * 60_000,
```

This also changes `maxFixRetries` from optional (`process.env.MAX_FIX_RETRIES ? parseInt(...) : undefined`) to required. All spawners always set `MAX_FIX_RETRIES` from the org's DB column (default: 3), so it should never be missing.

- [ ] **Step 2: Add same NaN guard helper to remote-bootstrap.ts**

Add the same `requireInt` helper to `worker/epic/remote-bootstrap.ts` and replace the same `parseInt` calls:

```typescript
// In loadEpicConfig:
maxParallelExperts: requireInt("MAX_PARALLEL_EXPERTS"),
maxFixRetries: requireInt("MAX_FIX_RETRIES"),
maxReviewRevisions: requireInt("MAX_REVIEW_REVISIONS"),
maxPerStoryRevisions: requireInt("MAX_PER_STORY_REVISIONS"),

// In loadResilienceConfig:
blockerMaxAutoRetries: requireInt("BLOCKER_MAX_AUTO_RETRIES"),
```

Note: `remote-bootstrap.ts` does NOT have `BLOCKER_WAIT_TIMEOUT_MINUTES` in its `loadResilienceConfig()` — only `index.ts` has it. Do not add it to remote-bootstrap.

- [ ] **Step 3: Run worker typecheck**

```bash
cd worker && npm run typecheck
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add worker/epic/index.ts worker/epic/remote-bootstrap.ts
git commit -m "fix(worker): add NaN guards for required int config — fail fast on missing env vars"
```

---

### Task 4: Fix coordinator.ts null safety for optional config fields

Fix the TS errors where optional fields (`blockerWaitTimeoutMs`, `maxFixRetries`) are used without null checks.

**Files:**
- Modify: `worker/epic/coordinator.ts:1388-1390,3146,3998,4061,4082,4102`

- [ ] **Step 1: Fix blockerTimeout usage at line 1388-1390**

```typescript
// BEFORE:
const blockerTimeout = this.resilience.blockerWaitTimeoutMs;
console.log(`[Epic] Waiting for human resolution (timeout: ${Math.round(blockerTimeout / 60_000)}min)...`);
const response = await this.blockerManager.waitForBlockerResponse(blocker, blockerTimeout);

// AFTER:
const blockerTimeout = this.resilience.blockerWaitTimeoutMs!;
```

Wait — `blockerWaitTimeoutMs` is defined as optional in `ResilienceConfig` (`blockerWaitTimeoutMs?: number`). But in both config loaders, it's always set from `requireInt("BLOCKER_WAIT_TIMEOUT_MINUTES") * 60_000` (after Task 3). So at runtime it's always present. The type just doesn't reflect that.

Better fix: Make `blockerWaitTimeoutMs` required in `ResilienceConfig` since it's always set:

In `worker/epic/types.ts`, line 372:
```typescript
// BEFORE:
/** Timeout in ms for waiting on human blocker resolution (default: 20 min) */
blockerWaitTimeoutMs?: number;

// AFTER:
/** Timeout in ms for waiting on human blocker resolution */
blockerWaitTimeoutMs: number;
```

- [ ] **Step 2: Make fileOverlapGatingEnabled, incrementalRebaseEnabled, mergeAgentEnabled required**

In `worker/epic/types.ts`, lines 366-370:
```typescript
// BEFORE:
fileOverlapGatingEnabled?: boolean;
incrementalRebaseEnabled?: boolean;
mergeAgentEnabled?: boolean;

// AFTER:
fileOverlapGatingEnabled: boolean;
incrementalRebaseEnabled: boolean;
mergeAgentEnabled: boolean;
```

These will be required once we wire them up in Tasks 7-14.

- [ ] **Step 3: Make maxFixRetries required in EpicConfig**

Since Task 3 changed `maxFixRetries` to use `requireInt()` (always set by all spawners, DB default: 3), make it required in the type:

In `worker/epic/types.ts`, line 223:
```typescript
// BEFORE:
maxFixRetries?: number;

// AFTER:
maxFixRetries: number;
```

This automatically resolves the TS errors at coordinator.ts lines 3146, 4082, and 4102 — no `?? 0` fallbacks needed.

- [ ] **Step 4: Fix mergeAgentEnabled parsing in worker config loaders**

`mergeAgentEnabled` defaults to `false` (opt-in), but the worker parses it with `!== "false"` which means a missing env var would enable it. Fix both config loaders:

`worker/epic/index.ts:115`:
```typescript
// BEFORE:
mergeAgentEnabled: process.env.MERGE_AGENT_ENABLED !== "false",
// AFTER:
mergeAgentEnabled: process.env.MERGE_AGENT_ENABLED === "true",
```

`worker/epic/remote-bootstrap.ts:420`:
```typescript
// BEFORE:
mergeAgentEnabled: process.env.MERGE_AGENT_ENABLED !== "false",
// AFTER:
mergeAgentEnabled: process.env.MERGE_AGENT_ENABLED === "true",
```

- [ ] **Step 5: Strip `?? true` / `?? false` from coordinator usage of resilience flags**

After making `fileOverlapGatingEnabled`, `incrementalRebaseEnabled`, `mergeAgentEnabled` required in types, remove the nullish coalescing at usage sites:

`worker/epic/coordinator.ts:1521`:
```typescript
// BEFORE:
if (!(this.resilience.fileOverlapGatingEnabled ?? true)) {
// AFTER:
if (!this.resilience.fileOverlapGatingEnabled) {
```

`worker/epic/executor.ts:563`:
```typescript
// BEFORE:
if (!(this.resilience.incrementalRebaseEnabled ?? true)) return;
// AFTER:
if (!this.resilience.incrementalRebaseEnabled) return;
```

`worker/epic/index.ts:143-145`:
```typescript
// BEFORE:
console.log("  - File overlap gating: " + (resilience.fileOverlapGatingEnabled ?? true));
console.log("  - Incremental rebase: " + (resilience.incrementalRebaseEnabled ?? true));
console.log("  - Merge agent: " + (resilience.mergeAgentEnabled ?? false));
// AFTER:
console.log("  - File overlap gating: " + resilience.fileOverlapGatingEnabled);
console.log("  - Incremental rebase: " + resilience.incrementalRebaseEnabled);
console.log("  - Merge agent: " + resilience.mergeAgentEnabled);
```

- [ ] **Step 6: Run worker typecheck**

```bash
cd worker && npm run typecheck
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add worker/epic/types.ts worker/epic/coordinator.ts worker/epic/executor.ts worker/epic/index.ts worker/epic/remote-bootstrap.ts
git commit -m "fix(worker): make resilience config fields required, fix null safety in coordinator"
```

---

## Chunk 2: Fix missing env vars in spawners

### Task 5: Add missing env vars to worker-spawner.ts

The cloud worker spawner (`worker-spawner.ts`) is missing `MAX_REVIEW_REVISIONS` and `MAX_PER_STORY_REVISIONS`.

**Files:**
- Modify: `api/src/services/worker-spawner.ts:505-510`

- [ ] **Step 1: Find the block where resilience env vars are set**

Look for the block around line 505-510 where `BLOCKER_MAX_AUTO_RETRIES`, `MAX_FIX_RETRIES`, etc. are set. Add the missing vars:

```typescript
additionalEnv.MAX_REVIEW_REVISIONS = String(org.maxReviewRevisions);
additionalEnv.MAX_PER_STORY_REVISIONS = String(org.maxPerStoryRevisions);
```

Add these near the existing `MAX_FIX_RETRIES` line.

- [ ] **Step 2: Run API typecheck**

```bash
cd api && npm run typecheck
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add api/src/services/worker-spawner.ts
git commit -m "fix(api): add MAX_REVIEW_REVISIONS and MAX_PER_STORY_REVISIONS to worker-spawner"
```

---

### Task 6: Add maxAgentTurns to remote-agent endpoint and agent spawners

The `maxAgentTurns` setting exists in DB and UI but is never returned by the `/api/agent/config` endpoint and never set by agent spawners.

**Files:**
- Modify: `api/src/routes/remote-agent.ts:1079-1082`
- Modify: `agent/src/spawner.ts:314-316`
- Modify: `agent/src/docker-spawner.ts:669-671`

- [ ] **Step 1: Add maxAgentTurns to remote-agent.ts config response**

In `api/src/routes/remote-agent.ts`, around line 1082, after the `maxFixRetries` line:

```typescript
maxFixRetries: org.maxFixRetries,
maxAgentTurns: org.maxAgentTurns,  // ← ADD
```

- [ ] **Step 2: Add MAX_AGENT_TURNS env var to agent/src/spawner.ts**

In `agent/src/spawner.ts`, near line 316 where `MAX_FIX_RETRIES` is set:

```typescript
...(orgConfig.maxAgentTurns != null ? { MAX_AGENT_TURNS: String(orgConfig.maxAgentTurns) } : {}),
```

Also check that `orgConfig` type includes `maxAgentTurns`. Search for the type definition used by the agent for org config and add the field if missing.

- [ ] **Step 3: Add MAX_AGENT_TURNS env var to agent/src/docker-spawner.ts**

In `agent/src/docker-spawner.ts`, near line 671:

```typescript
...(orgConfig.maxAgentTurns != null ? { MAX_AGENT_TURNS: String(orgConfig.maxAgentTurns) } : {}),
```

- [ ] **Step 4: Run API and agent typechecks**

```bash
cd api && npm run typecheck
cd agent && npm run typecheck
```

Expected: Both PASS

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/remote-agent.ts agent/src/spawner.ts agent/src/docker-spawner.ts
git commit -m "fix(api,agent): wire maxAgentTurns through remote-agent endpoint and agent spawners"
```

---

## Chunk 3: Wire up 3 orphaned feature flags (full stack)

### Task 7: DB migration for 3 new columns

**Files:**
- Create: `api/src/db/migrations/1742900000000-AddResilienceFlags.ts`
- Modify: `api/src/db/connection.ts`

- [ ] **Step 1: Create migration file**

Create `api/src/db/migrations/1742900000000-AddResilienceFlags.ts`:

```typescript
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddResilienceFlags1742900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS file_overlap_gating_enabled BOOLEAN DEFAULT true`
    );
    await queryRunner.query(
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS incremental_rebase_enabled BOOLEAN DEFAULT true`
    );
    await queryRunner.query(
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS merge_agent_enabled BOOLEAN DEFAULT false`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE organizations DROP COLUMN IF EXISTS file_overlap_gating_enabled`);
    await queryRunner.query(`ALTER TABLE organizations DROP COLUMN IF EXISTS incremental_rebase_enabled`);
    await queryRunner.query(`ALTER TABLE organizations DROP COLUMN IF EXISTS merge_agent_enabled`);
  }
}
```

- [ ] **Step 2: Register migration in connection.ts**

In `api/src/db/connection.ts`, import the new migration and add it to the migrations array:

```typescript
import { AddResilienceFlags1742900000000 } from "./migrations/1742900000000-AddResilienceFlags.js";
```

Add to the migrations array (after the last entry).

- [ ] **Step 3: Run API typecheck**

```bash
cd api && npm run typecheck
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add api/src/db/migrations/1742900000000-AddResilienceFlags.ts api/src/db/connection.ts
git commit -m "feat(api): add migration for fileOverlapGatingEnabled, incrementalRebaseEnabled, mergeAgentEnabled"
```

---

### Task 8: Organization entity + API settings routes

**Files:**
- Modify: `api/src/models/Organization.ts:696-698`
- Modify: `api/src/routes/settings/general.ts` (GET response, destructure, PUT handler, PUT response — follow `selfReviewEnabled` pattern exactly)

- [ ] **Step 1: Add 3 new columns to Organization entity**

In `api/src/models/Organization.ts`, after the `selfReviewEnabled` column (line 697):

```typescript
@Column({ name: "file_overlap_gating_enabled", type: "boolean", default: true })
fileOverlapGatingEnabled: boolean;

@Column({ name: "incremental_rebase_enabled", type: "boolean", default: true })
incrementalRebaseEnabled: boolean;

@Column({ name: "merge_agent_enabled", type: "boolean", default: false })
mergeAgentEnabled: boolean;
```

- [ ] **Step 2: Add to settings GET response**

In `api/src/routes/settings/general.ts`, find the resilience section of the GET response (near line 178-185) and add:

```typescript
fileOverlapGatingEnabled: org.fileOverlapGatingEnabled,
incrementalRebaseEnabled: org.incrementalRebaseEnabled,
mergeAgentEnabled: org.mergeAgentEnabled,
```

- [ ] **Step 3: Destructure from PUT request body**

In the PUT handler, find where `selfReviewEnabled` is destructured (near line 339) and add:

```typescript
fileOverlapGatingEnabled,
incrementalRebaseEnabled,
mergeAgentEnabled,
```

- [ ] **Step 4: Add PUT handler logic**

After the `selfReviewEnabled` handler (around line 1211), add:

```typescript
if (fileOverlapGatingEnabled !== undefined) {
  org.fileOverlapGatingEnabled = fileOverlapGatingEnabled === true;
}

if (incrementalRebaseEnabled !== undefined) {
  org.incrementalRebaseEnabled = incrementalRebaseEnabled === true;
}

if (mergeAgentEnabled !== undefined) {
  org.mergeAgentEnabled = mergeAgentEnabled === true;
}
```

- [ ] **Step 5: Add to PUT response**

Find the resilience section of the PUT response (near line 1392-1399) and add:

```typescript
fileOverlapGatingEnabled: org.fileOverlapGatingEnabled,
incrementalRebaseEnabled: org.incrementalRebaseEnabled,
mergeAgentEnabled: org.mergeAgentEnabled,
```

- [ ] **Step 6: Run API typecheck**

```bash
cd api && npm run typecheck
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add api/src/models/Organization.ts api/src/routes/settings/general.ts
git commit -m "feat(api): add fileOverlapGatingEnabled, incrementalRebaseEnabled, mergeAgentEnabled to org settings"
```

---

### Task 9: Remote-agent endpoint + all spawners

Wire the 3 new flags through the remote-agent config endpoint and ALL spawners (6 total).

**Files:**
- Modify: `api/src/routes/remote-agent.ts:1061-1066`
- Modify: `api/src/services/worker-spawner.ts:503-511`
- Modify: `api/src/services/local-epic-spawner.ts:817-829`
- Modify: `api/src/services/pipeline-executor.ts:574-582`
- Modify: `api/src/services/warm-pool.ts:530-533`
- Modify: `agent/src/spawner.ts:358-368`
- Modify: `agent/src/docker-spawner.ts:727-741`

- [ ] **Step 1: Add to remote-agent.ts config response**

In `api/src/routes/remote-agent.ts`, near line 1066 after `selfReviewEnabled`:

```typescript
fileOverlapGatingEnabled: org.fileOverlapGatingEnabled !== false,
incrementalRebaseEnabled: org.incrementalRebaseEnabled !== false,
mergeAgentEnabled: org.mergeAgentEnabled === true,  // default false — opt-in
```

- [ ] **Step 2: Add to worker-spawner.ts**

In `api/src/services/worker-spawner.ts`, near the resilience env vars block (around line 510):

```typescript
additionalEnv.FILE_OVERLAP_GATING_ENABLED = org.fileOverlapGatingEnabled !== false ? "true" : "false";
additionalEnv.INCREMENTAL_REBASE_ENABLED = org.incrementalRebaseEnabled !== false ? "true" : "false";
additionalEnv.MERGE_AGENT_ENABLED = org.mergeAgentEnabled === true ? "true" : "false";
```

- [ ] **Step 3: Add to local-epic-spawner.ts**

In `api/src/services/local-epic-spawner.ts`, near the resilience env vars (around line 828):

```typescript
FILE_OVERLAP_GATING_ENABLED: task.organization?.fileOverlapGatingEnabled !== false ? "true" : "false",
INCREMENTAL_REBASE_ENABLED: task.organization?.incrementalRebaseEnabled !== false ? "true" : "false",
MERGE_AGENT_ENABLED: task.organization?.mergeAgentEnabled === true ? "true" : "false",
```

- [ ] **Step 4: Add to agent/src/spawner.ts**

In `agent/src/spawner.ts`, near the resilience env vars (around line 368):

```typescript
FILE_OVERLAP_GATING_ENABLED: orgConfig.fileOverlapGatingEnabled !== false ? "true" : "false",
INCREMENTAL_REBASE_ENABLED: orgConfig.incrementalRebaseEnabled !== false ? "true" : "false",
MERGE_AGENT_ENABLED: orgConfig.mergeAgentEnabled === true ? "true" : "false",
```

Also check the agent's org config type definition and add `fileOverlapGatingEnabled`, `incrementalRebaseEnabled`, `mergeAgentEnabled` fields if missing.

- [ ] **Step 5: Add to agent/src/docker-spawner.ts**

In `agent/src/docker-spawner.ts`, near the resilience env vars (around line 740):

```typescript
FILE_OVERLAP_GATING_ENABLED: orgConfig.fileOverlapGatingEnabled !== false ? "true" : "false",
INCREMENTAL_REBASE_ENABLED: orgConfig.incrementalRebaseEnabled !== false ? "true" : "false",
MERGE_AGENT_ENABLED: orgConfig.mergeAgentEnabled === true ? "true" : "false",
```

- [ ] **Step 6: Add to pipeline-executor.ts**

In `api/src/services/pipeline-executor.ts`, near the block where `MAX_REVIEW_REVISIONS` is set (around line 575):

```typescript
additionalEnv.FILE_OVERLAP_GATING_ENABLED = org.fileOverlapGatingEnabled !== false ? "true" : "false";
additionalEnv.INCREMENTAL_REBASE_ENABLED = org.incrementalRebaseEnabled !== false ? "true" : "false";
additionalEnv.MERGE_AGENT_ENABLED = org.mergeAgentEnabled === true ? "true" : "false";
```

- [ ] **Step 7: Add to warm-pool.ts**

In `api/src/services/warm-pool.ts`, near the block where `MAX_REVIEW_REVISIONS` is set (around line 531):

```typescript
FILE_OVERLAP_GATING_ENABLED: credentials.fileOverlapGatingEnabled !== false ? "true" : "false",
INCREMENTAL_REBASE_ENABLED: credentials.incrementalRebaseEnabled !== false ? "true" : "false",
MERGE_AGENT_ENABLED: credentials.mergeAgentEnabled === true ? "true" : "false",
```

Check what type `credentials` uses and ensure the 3 new fields are included in that type.

- [ ] **Step 8: Run API and agent typechecks**

```bash
cd api && npm run typecheck
cd agent && npm run typecheck
```

Expected: Both PASS

- [ ] **Step 9: Commit**

```bash
git add api/src/routes/remote-agent.ts api/src/services/worker-spawner.ts api/src/services/local-epic-spawner.ts api/src/services/pipeline-executor.ts api/src/services/warm-pool.ts agent/src/spawner.ts agent/src/docker-spawner.ts
git commit -m "feat(api,agent): wire 3 resilience flags through all spawners and remote-agent endpoint"
```

---

### Task 10: Frontend settings toggles

**Files:**
- Modify: `frontend/src/pages/settings/types.ts:119-125`
- Modify: `frontend/src/pages/settings/index.tsx:181-187,523-529`
- Modify: `frontend/src/pages/settings/QualitySection.tsx:455-493`

- [ ] **Step 1: Add to settings types**

In `frontend/src/pages/settings/types.ts`, after `selfReviewEnabled` (line 125):

```typescript
fileOverlapGatingEnabled: boolean;
incrementalRebaseEnabled: boolean;
mergeAgentEnabled: boolean;
```

- [ ] **Step 2: Add defaults in index.tsx**

In `frontend/src/pages/settings/index.tsx`, in the defaults object (near line 187 after `selfReviewEnabled: false`):

```typescript
fileOverlapGatingEnabled: true,
incrementalRebaseEnabled: true,
mergeAgentEnabled: false,
```

- [ ] **Step 3: Strip ALL hardcoded fallbacks in index.tsx data loading**

In the data loading section (around lines 449-555), strip ALL `?? N` fallbacks. Every value comes from the API which reads from the DB — if it's missing, that's a bug upstream:

```typescript
// Strip these fallbacks (non-exhaustive — grep for `data.\w+ \?\? \d` and fix ALL):
// BEFORE → AFTER:
logRetentionDays: data.logRetentionDays ?? 7,          →  logRetentionDays: data.logRetentionDays,
taskRetentionDays: data.taskRetentionDays ?? 7,        →  taskRetentionDays: data.taskRetentionDays,
maxConcurrentWorkers: data.maxConcurrentWorkers ?? 1,  →  maxConcurrentWorkers: data.maxConcurrentWorkers,
maxParallelExperts: data.maxParallelExperts ?? 3,       →  maxParallelExperts: data.maxParallelExperts,
defaultMaxRetries: Math.min(data.defaultMaxRetries ?? 3, 5),  →  defaultMaxRetries: Math.min(data.defaultMaxRetries, 5),
taskCooldownSeconds: data.taskCooldownSeconds ?? 0,    →  taskCooldownSeconds: data.taskCooldownSeconds,
ollamaContextWindow: data.ollamaContextWindow ?? 65536, →  ollamaContextWindow: data.ollamaContextWindow,
criticApprovalThreshold: data.criticApprovalThreshold ?? 85,  →  criticApprovalThreshold: data.criticApprovalThreshold,
maxTargetFiles: data.maxTargetFiles ?? 15,             →  maxTargetFiles: data.maxTargetFiles,
storyCalibrationMultiplier: data.storyCalibrationMultiplier ?? 0.4,  →  storyCalibrationMultiplier: data.storyCalibrationMultiplier,
completedTaskDisplayMinutes: data.completedTaskDisplayMinutes ?? 10,  →  completedTaskDisplayMinutes: data.completedTaskDisplayMinutes,
intermediateTaskDisplayMinutes: data.intermediateTaskDisplayMinutes ?? 60,  →  intermediateTaskDisplayMinutes: data.intermediateTaskDisplayMinutes,
dryRunVisibilityMinutes: data.dryRunVisibilityMinutes ?? 1,  →  dryRunVisibilityMinutes: data.dryRunVisibilityMinutes,
warmPoolSize: data.warmPoolSize ?? 0,                  →  warmPoolSize: data.warmPoolSize,
warmPoolHoursStart: data.warmPoolHoursStart ?? 9,      →  warmPoolHoursStart: data.warmPoolHoursStart,
warmPoolHoursEnd: data.warmPoolHoursEnd ?? 18,         →  warmPoolHoursEnd: data.warmPoolHoursEnd,
autoFixMaxIterations: data.autoFixMaxIterations ?? 3,  →  autoFixMaxIterations: data.autoFixMaxIterations,
maxFixRetries: data.maxFixRetries ?? 3,                →  maxFixRetries: data.maxFixRetries,
blockerWaitTimeoutMinutes: data.blockerWaitTimeoutMinutes ?? 20,  →  blockerWaitTimeoutMinutes: data.blockerWaitTimeoutMinutes,
codebaseMaxFilesPerRepo: data.codebaseMaxFilesPerRepo ?? 500,  →  codebaseMaxFilesPerRepo: data.codebaseMaxFilesPerRepo,
codebaseMaxFileSizeKb: data.codebaseMaxFileSizeKb ?? 100,  →  codebaseMaxFileSizeKb: data.codebaseMaxFileSizeKb,
codebaseMaxRetrievalChunks: data.codebaseMaxRetrievalChunks ?? 10,  →  codebaseMaxRetrievalChunks: data.codebaseMaxRetrievalChunks,
specMinQualityScore: data.specMinQualityScore ?? 0,    →  specMinQualityScore: data.specMinQualityScore,
```

And add the 3 new fields:

```typescript
fileOverlapGatingEnabled: data.fileOverlapGatingEnabled,
incrementalRebaseEnabled: data.incrementalRebaseEnabled,
mergeAgentEnabled: data.mergeAgentEnabled,
```

- [ ] **Step 4: Add toggles to QualitySection.tsx**

In `frontend/src/pages/settings/QualitySection.tsx`, in the Resilience section (near the existing pushAfterCommit / gracefulShutdownEnabled / selfReviewEnabled toggles around line 455-493), add 3 new toggles following the same pattern:

```tsx
<label className="flex items-center gap-2">
  <input
    type="checkbox"
    checked={settings.fileOverlapGatingEnabled}
    onChange={(e) => updateSetting("fileOverlapGatingEnabled", e.target.checked)}
  />
  <span className="text-sm">Block overlapping stories from running in parallel</span>
</label>

<label className="flex items-center gap-2">
  <input
    type="checkbox"
    checked={settings.incrementalRebaseEnabled}
    onChange={(e) => updateSetting("incrementalRebaseEnabled", e.target.checked)}
  />
  <span className="text-sm">Incremental rebase (merge completed branches before next expert)</span>
</label>

<label className="flex items-center gap-2">
  <input
    type="checkbox"
    checked={settings.mergeAgentEnabled}
    onChange={(e) => updateSetting("mergeAgentEnabled", e.target.checked)}
  />
  <span className="text-sm">AI merge agent (resolve rebase conflicts automatically)</span>
</label>
```

Match the exact styling and structure of the existing toggles in that section.

- [ ] **Step 5: Run frontend typecheck**

```bash
cd frontend && npx tsc -b
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/settings/types.ts frontend/src/pages/settings/index.tsx frontend/src/pages/settings/QualitySection.tsx
git commit -m "feat(frontend): add toggles for fileOverlapGating, incrementalRebase, mergeAgent"
```

---

### Task 11: VS Code extension toggles

**Files:**
- Modify: `packages/vscode-workermill/package.json`
- Modify: `packages/vscode-workermill/src/settings-panel.ts`

- [ ] **Step 1: Add settings to package.json**

In `packages/vscode-workermill/package.json`, in the configuration properties section, add (follow the pattern of existing boolean settings like `blockOnE2EFailures`):

```json
"workermill.fileOverlapGatingEnabled": {
  "type": "boolean",
  "default": true,
  "description": "Block overlapping stories from running in parallel"
},
"workermill.incrementalRebaseEnabled": {
  "type": "boolean",
  "default": true,
  "description": "Merge completed branches before starting next expert"
},
"workermill.mergeAgentEnabled": {
  "type": "boolean",
  "default": false,
  "description": "Use AI agent to resolve rebase conflicts automatically"
}
```

- [ ] **Step 2: Add toggles to settings-panel.ts**

In `packages/vscode-workermill/src/settings-panel.ts`:

1. Add to the settings interface/type (find where other boolean settings are defined)
2. Add checkbox HTML in the resilience section (follow the `pushAfterCommit` or `selfReviewEnabled` toggle pattern)
3. Add to the `populateSettings` function
4. Add to the `saveSettings` function
5. Add to the `getSettings` function (reading from VS Code config)
6. Add to the API save payload

Follow the exact pattern used by `blockOnE2EFailures` which was just added.

- [ ] **Step 3: Run VS Code typecheck (if available)**

```bash
cd packages/vscode-workermill && npx tsc --noEmit
```

Expected: PASS (or no tsconfig — verify build works)

- [ ] **Step 4: Commit**

```bash
git add packages/vscode-workermill/package.json packages/vscode-workermill/src/settings-panel.ts
git commit -m "feat(vscode): add toggles for fileOverlapGating, incrementalRebase, mergeAgent"
```

---

## Chunk 4: Verification

### Task 12: Full typecheck across all packages

- [ ] **Step 1: Run all 4 typechecks**

```bash
cd api && npm run typecheck
cd frontend && npx tsc -b
cd agent && npm run typecheck
cd worker && npm run typecheck
```

Expected: All 4 PASS with no errors.

- [ ] **Step 2: Run API tests**

```bash
cd api && npm run test
```

Expected: All tests pass (the pre-existing `board-execution.test.ts` failure is unrelated).

- [ ] **Step 3: Run decision engine tests specifically**

```bash
cd api && npx vitest run src/services/worker-decision-engine.test.ts
```

Expected: All tests pass.

### Task 13: Docker worker build verification

- [ ] **Step 1: Build worker Docker image locally**

```bash
./bin/local-workermill build-worker
```

Expected: Build completes. The TS errors that previously appeared (TS2588 const assignment, TS2353 maxTurns on ExpertConfig, TS18048 undefined checks) should be resolved. The TS6059 rootDir errors will still appear (expected — cross-directory imports tolerated by `|| true`).

- [ ] **Step 2: Verify reduced error count**

Compare the tsc error output from the Docker build. Should see:
- ✅ No more `TS2588: Cannot assign to 'output'`
- ✅ No more `TS2353: 'maxTurns' does not exist in type 'ExpertConfig'`
- ✅ No more `TS18048: 'blockerTimeout' is possibly 'undefined'`
- ✅ No more `TS18048: 'maxWaitMs' is possibly 'undefined'`
- ✅ No more `TS2532: Object is possibly 'undefined'` (maxFixRetries)
- ⚠️ TS6059 rootDir errors still expected (structural, not bugs)
- ⚠️ index.ts and remote-bootstrap.ts `string | undefined` errors may still appear for env vars parsed with conditional check pattern — these are safe

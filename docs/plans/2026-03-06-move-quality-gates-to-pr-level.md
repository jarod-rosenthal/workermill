# Move Quality Gates to PR Level Only — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove per-story quality gates, add retries to integration fixer, consolidate retry settings into one `maxFixRetries` setting.

**Architecture:** Per-story Gate 1 and Gate 2 are removed from executor. The integration fixer (coordinator, pre-review) and CI fixer (coordinator, post-review) both use a single `maxFixRetries` org setting. Two separate DB columns (`qualityGateMaxRetries`, `maxCiFixRetries`) are consolidated into one (`max_fix_retries`).

**Tech Stack:** TypeScript (worker), TypeORM (API), React (frontend settings UI)

---

### Task 1: DB migration — consolidate retry columns

**Files:**
- Create: `api/src/db/migrations/1742400000000-ConsolidateFixRetries.ts`
- Modify: `api/src/models/Organization.ts:675-679`
- Modify: `api/src/db/connection.ts` (register migration)

**Step 1: Create the migration**

```typescript
// api/src/db/migrations/1742400000000-ConsolidateFixRetries.ts
import { MigrationInterface, QueryRunner } from "typeorm";

export class ConsolidateFixRetries1742400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add new column with default from maxCiFixRetries (the one that was actually working)
    await queryRunner.query(`
      ALTER TABLE organizations ADD COLUMN IF NOT EXISTS max_fix_retries INT NOT NULL DEFAULT 3
    `);
    // Copy the higher of the two existing values (prefer the value the user actually set)
    await queryRunner.query(`
      UPDATE organizations SET max_fix_retries = GREATEST(max_ci_fix_retries, 3)
    `);
    // Drop old columns
    await queryRunner.query(`ALTER TABLE organizations DROP COLUMN IF EXISTS quality_gate_max_retries`);
    await queryRunner.query(`ALTER TABLE organizations DROP COLUMN IF EXISTS max_ci_fix_retries`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE organizations ADD COLUMN quality_gate_max_retries INT NOT NULL DEFAULT 5`);
    await queryRunner.query(`ALTER TABLE organizations ADD COLUMN max_ci_fix_retries INT NOT NULL DEFAULT 3`);
    await queryRunner.query(`UPDATE organizations SET quality_gate_max_retries = max_fix_retries, max_ci_fix_retries = max_fix_retries`);
    await queryRunner.query(`ALTER TABLE organizations DROP COLUMN max_fix_retries`);
  }
}
```

**Step 2: Update Organization model**

In `api/src/models/Organization.ts`, replace lines 675-679:

```typescript
// REMOVE these two:
//   @Column({ name: "quality_gate_max_retries", type: "int", default: 5 })
//   qualityGateMaxRetries: number;
//
//   @Column({ name: "max_ci_fix_retries", type: "int", default: 3 })
//   maxCiFixRetries: number;

// ADD this one:
  @Column({ name: "max_fix_retries", type: "int", default: 3 })
  maxFixRetries: number;
```

**Step 3: Register migration in `api/src/db/connection.ts`**

Add `ConsolidateFixRetries1742400000000` to the migrations array.

**Step 4: Run typecheck**

Run: `cd api && npm run typecheck`
Expected: Errors in files that still reference `qualityGateMaxRetries` / `maxCiFixRetries` — these get fixed in subsequent tasks.

**Step 5: Commit**

```bash
git add api/src/db/migrations/1742400000000-ConsolidateFixRetries.ts api/src/models/Organization.ts api/src/db/connection.ts
git commit -m "feat(api): consolidate qualityGateMaxRetries + maxCiFixRetries into maxFixRetries"
```

---

### Task 2: API — update settings routes and spawners

**Files:**
- Modify: `api/src/routes/settings/general.ts` (replace both settings with `maxFixRetries`)
- Modify: `api/src/services/pipeline-executor.ts:580-581`
- Modify: `api/src/services/local-epic-spawner.ts:823-824`
- Modify: `api/src/services/worker-spawner.ts:505-506`
- Modify: `api/src/routes/remote-agent.ts:1078`

**Step 1: Update settings route**

In `api/src/routes/settings/general.ts`:

- Replace all `qualityGateMaxRetries` references with `maxFixRetries`
- Replace all `maxCiFixRetries` references with `maxFixRetries`
- In the GET response: return `maxFixRetries: org.maxFixRetries` (one field, not two)
- In the PUT handler: validate `maxFixRetries` (1-10 range), assign to `org.maxFixRetries`
- Remove the separate validation blocks for the old two fields

**Step 2: Update spawners**

In `api/src/services/pipeline-executor.ts`, replace lines 580-581:
```typescript
// REMOVE:
//   additionalEnv.QUALITY_GATE_MAX_RETRIES = String(org.qualityGateMaxRetries);
//   additionalEnv.MAX_CI_FIX_RETRIES = String(org.maxCiFixRetries);
// ADD:
    additionalEnv.MAX_FIX_RETRIES = String(org.maxFixRetries);
```

Same pattern in `api/src/services/local-epic-spawner.ts:823-824`:
```typescript
// REMOVE:
//   QUALITY_GATE_MAX_RETRIES: String(task.organization?.qualityGateMaxRetries ?? 5),
//   MAX_CI_FIX_RETRIES: String(task.organization?.maxCiFixRetries ?? 3),
// ADD:
      MAX_FIX_RETRIES: String(task.organization?.maxFixRetries ?? 3),
```

Same pattern in `api/src/services/worker-spawner.ts:505-506`:
```typescript
// REMOVE:
//   additionalEnv.QUALITY_GATE_MAX_RETRIES = String(org.qualityGateMaxRetries);
//   additionalEnv.MAX_CI_FIX_RETRIES = String(org.maxCiFixRetries);
// ADD:
      additionalEnv.MAX_FIX_RETRIES = String(org.maxFixRetries);
```

In `api/src/routes/remote-agent.ts:1078`:
```typescript
// REMOVE:
//   maxCiFixRetries: org.maxCiFixRetries,
// ADD:
      maxFixRetries: org.maxFixRetries,
```

**Step 3: Run typecheck**

Run: `cd api && npm run typecheck`
Expected: PASS (all API references updated)

**Step 4: Commit**

```bash
git add api/src/routes/settings/general.ts api/src/services/pipeline-executor.ts api/src/services/local-epic-spawner.ts api/src/services/worker-spawner.ts api/src/routes/remote-agent.ts
git commit -m "feat(api): replace qualityGateMaxRetries + maxCiFixRetries with maxFixRetries in settings and spawners"
```

---

### Task 3: Worker types — consolidate retry config

**Files:**
- Modify: `worker/epic/types.ts:342-363`
- Modify: `worker/epic/index.ts:98-111,139`
- Modify: `worker/epic/remote-bootstrap.ts:406-418`

**Step 1: Update ResilienceConfig type**

In `worker/epic/types.ts`, remove `qualityGateMaxRetries` from `ResilienceConfig` (line 348):

```typescript
export interface ResilienceConfig {
  blockerMaxAutoRetries: number;
  blockerAutoRetryEnabled: boolean;
  // REMOVED: qualityGateMaxRetries
  pushAfterCommit: boolean;
  gracefulShutdownEnabled: boolean;
  selfReviewEnabled?: boolean;
  fileOverlapGatingEnabled?: boolean;
  incrementalRebaseEnabled?: boolean;
  mergeAgentEnabled?: boolean;
  blockerWaitTimeoutMs?: number;
}
```

Add `maxFixRetries` to `EpicConfig` (after `maxParallelExperts`, line ~217):

```typescript
  /** Max retries for fix agents (integration fixer + CI fixer). From org settings. */
  maxFixRetries?: number;
```

Also remove `parked` from `StoryResult` (line 149) — no longer needed since per-story gate parking is removed:

```typescript
  // REMOVE: parked?: boolean;
```

**Step 2: Update index.ts config loading**

In `worker/epic/index.ts`:

In `loadConfig()` (~line 85), add:
```typescript
    maxFixRetries: process.env.MAX_FIX_RETRIES ? parseInt(process.env.MAX_FIX_RETRIES, 10) : undefined,
```

In `loadResilienceConfig()` (line 102), remove:
```typescript
    // REMOVE: qualityGateMaxRetries: parseInt(process.env.QUALITY_GATE_MAX_RETRIES || "5", 10),
```

In the console.log block (line 139), remove:
```typescript
    // REMOVE: console.log("  - Quality gate max retries: " + resilience.qualityGateMaxRetries);
```

**Step 3: Update remote-bootstrap.ts**

In `worker/epic/remote-bootstrap.ts`:

In `loadConfig()` (~line 398), add:
```typescript
    maxFixRetries: process.env.MAX_FIX_RETRIES ? parseInt(process.env.MAX_FIX_RETRIES, 10) : undefined,
```

In `loadResilienceConfig()` (line 410), remove:
```typescript
    // REMOVE: qualityGateMaxRetries: parseInt(process.env.QUALITY_GATE_MAX_RETRIES || "5", 10),
```

**Step 4: Run typecheck**

Run: `cd worker && npm run typecheck`
Expected: Errors in `executor.ts` and `coordinator.ts` (references to removed fields) — fixed in next tasks.

**Step 5: Commit**

```bash
git add worker/epic/types.ts worker/epic/index.ts worker/epic/remote-bootstrap.ts
git commit -m "feat(worker): consolidate retry types — add maxFixRetries to EpicConfig, remove qualityGateMaxRetries"
```

---

### Task 4: Executor — remove per-story gates

**Files:**
- Modify: `worker/epic/executor.ts`
- Delete: `worker/epic/inline-gate-fixer.ts`
- Delete: `worker/epic/inline-escalation-fixer.ts` (only used by per-story gate escalation)

**Step 1: Remove gate fields and imports**

In `worker/epic/executor.ts`:

Remove fields (lines ~88-98):
```typescript
  // REMOVE all of these:
  // private qualityGateRetryCountByStory: Map<number, number> = new Map();
  // private gateErrorHistoryByStory: Map<number, Array<{...}>> = new Map();
  // private worktreePathByStory: Map<number, string> = new Map();
  // private deferredRetryUsedByStory: Set<number> = new Set();
```

In the constructor default resilience (line ~121), remove `qualityGateMaxRetries: 5`.

Remove imports for `InlineGateFixer` and `InlineEscalationFixer` from the top of the file.

**Step 2: Remove Gate 1 call**

Remove lines ~1742-1749 (the `runPreCommitGate` call block):
```typescript
      // REMOVE this entire block:
      // const gatesEnabled = this.config.qualityThresholds?.qualityGateEnabled !== false;
      // if (this.config.qualityGateCommands && !this.config.qualityGateBypass && gatesEnabled) {
      //   const gateResult = await this.runPreCommitGate(worktreePath, expert);
      //   if (!gateResult.passed) {
      //     throw new Error(`Pre-commit quality gate failed (${gateResult.failedCommand}):\n${gateResult.output}`);
      //   }
      // }
```

**Step 3: Remove Gate 2 call on story branches**

Remove lines ~1805-1806 (the `runPostPushCIGate` call for story branches):
```typescript
      // REMOVE this entire block:
      // if (this.config.ciWorkflowPath && !this.config.qualityGateBypass && hasCommits) {
      //   const ciResult = await this.runPostPushCIGate(worktreePath, branchName!, expert);
      //   ... (through the CI gate error handling)
      // }
```

**Step 4: Remove quality gate error handling from catch block**

Remove the entire quality gate error handler (lines ~1893-2083) — the block that starts with:
```typescript
      // REMOVE: const isQualityGateError = errorMessage.startsWith("Pre-commit quality gate failed") ...
```
through the closing of that if block. The catch block should go straight to the blocker classification logic.

**Step 5: Remove dead methods**

Remove these methods entirely:
- `runPreCommitGate()` (~lines 692-900+)
- `getTriggeredGateCommands()` (~line 616)
- `getAutoFixCommand()` (~line 980)
- `findSubdirsNeedingInstall()` (if only used by runPreCommitGate — check first)
- `resetQualityGateRetryCounter()` (~line 164)
- `ensureGitignoreBeforeFixer()` (if only used by gate retry logic — check first)
- `finalizeFixerResult()` (if only used by gate fixer flow — check first)
- `rebaseSiblingBranches()` (if only used by gate retry — check first)

For each method, grep the file first. If used elsewhere, keep it.

**Step 6: Delete per-story fixer files**

```bash
rm worker/epic/inline-gate-fixer.ts
```

Check if `inline-escalation-fixer.ts` is used anywhere other than the executor's gate retry:
```bash
grep -r "InlineEscalationFixer\|inline-escalation-fixer" worker/epic/ --include="*.ts"
```
If only referenced in executor.ts gate retry code (which was just removed), delete it:
```bash
rm worker/epic/inline-escalation-fixer.ts
```

**Step 7: Run typecheck**

Run: `cd worker && npm run typecheck`
Expected: Errors in `coordinator.ts` (maxCiFixRetries) — fixed in next task.

**Step 8: Commit**

```bash
git add worker/epic/executor.ts
git rm worker/epic/inline-gate-fixer.ts worker/epic/inline-escalation-fixer.ts
git commit -m "feat(worker): remove per-story quality gates from executor"
```

---

### Task 5: Integration fixer — add retry loop

**Files:**
- Modify: `worker/epic/inline-integration-fixer.ts:190-272`

**Step 1: Add retry loop to fix()**

Replace the current `fix()` method body (lines ~190-272) with a retry loop. The current flow is:

```
gates -> fail -> one fix agent -> verify -> give up
```

Change to:

```
gates -> fail -> fix agent -> verify -> still failing? -> retry with accumulated context -> up to maxRetries
```

```typescript
  async fix(
    prNumber: number,
    qualityGateCommands: NonNullable<EpicConfig["qualityGateCommands"]>,
    maxRetries: number
  ): Promise<IntegrationFixResult> {
    this.allOutput = "";

    if (!qualityGateCommands || qualityGateCommands.length === 0) {
      return { success: true, decision: "passed", summary: "No quality gates configured" };
    }

    await this.postLog("Starting integration quality gate check", "system");
    await this.postLog(`PR #${prNumber} — checking ${qualityGateCommands.length} gate(s)`, "system");

    try {
      await this.installSubdirectoryDeps();
      this.runToolInstaller();

      const gateResult = await this.runAllGates(qualityGateCommands);

      if (gateResult.passed) {
        await this.postLog("All integration gates passed", "system");
        return { success: true, decision: "passed", summary: "All quality gates passed on consolidated branch" };
      }

      // Gates failed — enter fix-retry loop
      let lastOutput = gateResult.output;
      let lastFailedCommand = gateResult.failedCommand;
      const failureHistory: string[] = [lastOutput];

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        await this.postLog(
          `Integration gate failed: ${lastFailedCommand} — spawning fix agent (attempt ${attempt}/${maxRetries})`,
          "error"
        );

        const fixResult = await this.runFixAgent(
          prNumber,
          qualityGateCommands,
          failureHistory.join("\n\n---\n\n"),
          lastFailedCommand
        );

        if (!fixResult.success) {
          await this.postLog(`Fix agent failed: ${fixResult.error}`, "error");
          if (fixResult.error?.includes("unfixable")) {
            return {
              success: false,
              decision: "unfixable",
              summary: `Fix agent reports unfixable: ${fixResult.error}`,
              error: fixResult.error,
            };
          }
          continue;
        }

        // Verify gates pass after fix
        await this.postLog(`Verifying gates after fix attempt ${attempt}...`, "system");
        const verifyResult = await this.runAllGates(qualityGateCommands);

        if (verifyResult.passed) {
          await this.postLog(`All gates passing after fix attempt ${attempt}`, "system");
          return {
            success: true,
            decision: "fixed",
            summary: this.parseSummary() || `Fixed on attempt ${attempt}/${maxRetries}`,
          };
        }

        lastOutput = verifyResult.output;
        lastFailedCommand = verifyResult.failedCommand;
        failureHistory.push(lastOutput);
        await this.postLog(
          `Gates still failing after attempt ${attempt} — ${lastFailedCommand}`,
          "error"
        );
      }

      // All retries exhausted
      return {
        success: false,
        decision: "unfixable",
        summary: `Integration gates still failing after ${maxRetries} fix attempts: ${lastFailedCommand}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.postLog(`Integration fix failed: ${errorMessage}`, "error");
      return {
        success: false,
        decision: "unfixable",
        summary: `Integration fix error: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }
```

**Step 2: Run typecheck**

Run: `cd worker && npm run typecheck`
Expected: Error in `coordinator.ts` (call site needs updated signature) — fixed in next task.

**Step 3: Commit**

```bash
git add worker/epic/inline-integration-fixer.ts
git commit -m "feat(worker): add retry loop to integration fixer"
```

---

### Task 6: Coordinator — use maxFixRetries everywhere

**Files:**
- Modify: `worker/epic/coordinator.ts`

**Step 1: Remove maxCiFixRetries field**

Remove lines ~77-78:
```typescript
  // REMOVE:
  // private ciFixRetryCount: number = 0;
  // private maxCiFixRetries: number = parseInt(process.env.MAX_CI_FIX_RETRIES || "3", 10);
```

Replace with reading from config:
```typescript
  private ciFixRetryCount: number = 0;
```

(The max comes from `this.config.maxFixRetries` at usage sites.)

**Step 2: Update integration fixer call**

At line ~3165, update the `fix()` call to pass `maxFixRetries`:

```typescript
        const gateResult = await integrationFixer.fix(
          prNumber,
          this.config.qualityGateCommands!,
          this.config.maxFixRetries ?? 3
        );
```

**Step 3: Update mergeWithCIVerification**

In `mergeWithCIVerification()` (~line 4076), replace references to `this.maxCiFixRetries` with `this.config.maxFixRetries ?? 3`:

```typescript
    if ((this.config.maxFixRetries ?? 3) <= 0) {
```

And in the while loop:
```typescript
    const maxRetries = this.config.maxFixRetries ?? 3;
    while (this.ciFixRetryCount < maxRetries) {
```

Update all log messages that reference `this.maxCiFixRetries` to use `maxRetries`.

**Step 4: Run typecheck**

Run: `cd worker && npm run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add worker/epic/coordinator.ts
git commit -m "feat(worker): coordinator uses config.maxFixRetries for both integration and CI fix"
```

---

### Task 7: Frontend — consolidate settings UI

**Files:**
- Modify: `frontend/src/pages/settings/types.ts:119-120`
- Modify: `frontend/src/pages/settings/index.tsx:181-182,521-522`
- Modify: `frontend/src/pages/settings/QualitySection.tsx:378-410`

**Step 1: Update types**

In `frontend/src/pages/settings/types.ts`, replace lines 119-120:
```typescript
  // REMOVE:
  // qualityGateMaxRetries: number;
  // maxCiFixRetries: number;
  // ADD:
  maxFixRetries: number;
```

**Step 2: Update defaults in index.tsx**

In `frontend/src/pages/settings/index.tsx`, replace lines 181-182:
```typescript
  // REMOVE:
  // qualityGateMaxRetries: 5,
  // maxCiFixRetries: 3,
  // ADD:
  maxFixRetries: 3,
```

Replace lines 521-522:
```typescript
  // REMOVE:
  // qualityGateMaxRetries: data.qualityGateMaxRetries ?? 5,
  // maxCiFixRetries: data.maxCiFixRetries ?? 3,
  // ADD:
  maxFixRetries: data.maxFixRetries ?? 3,
```

**Step 3: Update QualitySection UI**

In `frontend/src/pages/settings/QualitySection.tsx`, replace the two separate input sections (lines ~378-410) with one:

```tsx
            {/* Fix Agent Max Retries */}
            <div className="flex items-center justify-between mb-4 pt-4 border-t border-border">
              <div>
                <span className="text-sm text-foreground">Fix Agent Max Retries</span>
                <p className="text-xs text-muted-foreground">Max attempts for fix agents to resolve quality gate and CI failures</p>
              </div>
              <input
                type="number"
                min="0"
                max="10"
                value={settings.maxFixRetries}
                onChange={(e) => updateSetting("maxFixRetries", parseInt(e.target.value, 10) || 3)}
                className="w-20 px-3 py-2 bg-background border border-border rounded-md text-foreground text-center"
              />
            </div>
            <p className="text-xs text-muted-foreground -mt-3 mb-4 ml-0">0-10 attempts (default: 3). Used by both the integration fixer (pre-review, on merged branch) and the CI fixer (post-review). Set to 0 to skip fix attempts.</p>
```

**Step 4: Run typecheck**

Run: `cd frontend && npx tsc -b`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/pages/settings/types.ts frontend/src/pages/settings/index.tsx frontend/src/pages/settings/QualitySection.tsx
git commit -m "feat(frontend): consolidate quality gate retry settings into maxFixRetries"
```

---

### Task 8: Final typecheck and cleanup

**Files:**
- All modified files

**Step 1: Full typecheck across all packages**

Run: `cd api && npm run typecheck`
Expected: PASS

Run: `cd worker && npm run typecheck`
Expected: PASS

Run: `cd frontend && npx tsc -b`
Expected: PASS

**Step 2: Grep for any remaining references to removed settings**

Run: `grep -r "qualityGateMaxRetries\|QUALITY_GATE_MAX_RETRIES\|maxCiFixRetries\|MAX_CI_FIX_RETRIES" api/ worker/ frontend/ --include="*.ts" --include="*.tsx" -l`
Expected: No results (or only in the migration down() method)

**Step 3: Run API tests**

Run: `cd api && npm run test`
Expected: PASS (or failures only in tests that reference old settings — fix them)

**Step 4: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: clean up remaining references to removed retry settings"
```

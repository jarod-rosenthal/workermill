# Auto-Merge Toggle + Label Override — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add org-level `autoMergeEnabled` setting + per-task `auto-merge` label so approved PRs can optionally be auto-merged, with clear precedence over deploy and deployer handling of already-merged PRs.

**Architecture:** New boolean column on `organizations` and `worker_tasks` tables, new env var `AUTO_MERGE_ENABLED` passed to workers, three-way branch in coordinator after Tech Lead approval. Follows the exact same pattern as `autoDeployEnabled`/`deploymentEnabled`.

**Tech Stack:** TypeORM migration, Express routes, React frontend toggle, worker coordinator logic.

---

### Task 1: Database Migration

**Files:**
- Create: `api/src/db/migrations/1741500000000-AddAutoMergeEnabled.ts`
- Modify: `api/src/db/connection.ts:264,565` (import + register)

**Step 1: Create the migration file**

```typescript
// api/src/db/migrations/1741500000000-AddAutoMergeEnabled.ts
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAutoMergeEnabled1741500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS auto_merge_enabled BOOLEAN NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS auto_merge_enabled BOOLEAN NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS auto_merge_enabled`);
    await queryRunner.query(`ALTER TABLE organizations DROP COLUMN IF EXISTS auto_merge_enabled`);
  }
}
```

**Step 2: Register in connection.ts**

Add import after line 264 (after `AddGithubAppInstallationId` import):
```typescript
import { AddAutoMergeEnabled1741500000000 } from "./migrations/1741500000000-AddAutoMergeEnabled.js";
```

Add to migrations array after line 565 (after `AddGithubAppInstallationId1741400000000`):
```typescript
    AddAutoMergeEnabled1741500000000,
```

**Step 3: Verify typecheck passes**

Run: `cd api && npx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add api/src/db/migrations/1741500000000-AddAutoMergeEnabled.ts api/src/db/connection.ts
git commit -m "feat: add auto_merge_enabled migration for organizations and worker_tasks"
```

---

### Task 2: Organization + WorkerTask Models

**Files:**
- Modify: `api/src/models/Organization.ts:403` (add column after `autoDeployEnabled`)
- Modify: `api/src/models/WorkerTask.ts:190` (add column after `qualityGateBypass`)

**Step 1: Add column to Organization model**

In `api/src/models/Organization.ts`, after line 403 (`autoDeployEnabled` column), add:

```typescript
  @Column({ name: "auto_merge_enabled", type: "boolean", default: false })
  autoMergeEnabled: boolean; // Auto-merge PR after review approval (like 'auto-merge' label)
```

**Step 2: Add column to WorkerTask model**

In `api/src/models/WorkerTask.ts`, after line 190 (`qualityGateBypass` column), add:

```typescript
  @Column({ name: "auto_merge_enabled", type: "boolean", default: false })
  autoMergeEnabled: boolean;  // True if 'auto-merge' label present or org setting enabled
```

**Step 3: Verify typecheck passes**

Run: `cd api && npx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add api/src/models/Organization.ts api/src/models/WorkerTask.ts
git commit -m "feat: add autoMergeEnabled column to Organization and WorkerTask models"
```

---

### Task 3: Label Recognition in API Routes (all 7 locations)

The `auto-merge` label must be recognized in every route that creates WorkerTasks. There are 7 locations that follow the same pattern as `deploymentEnabled`. Each one needs:

1. A `hasAutoMergeLabel` check
2. An `autoMergeEnabled` flag combining label + org default
3. The flag passed into `workerTaskRepo.create()`

**Files:**
- Modify: `api/src/routes/webhooks/jira.ts:126-135`
- Modify: `api/src/routes/tasks/crud.ts:380-398`
- Modify: `api/src/routes/projects.ts:1242-1253` (first location — assign endpoint)
- Modify: `api/src/routes/projects.ts:1518-1528` (second location — create+run endpoint)
- Modify: `api/src/routes/webhooks/email.ts:255-258`
- Modify: `api/src/routes/webhooks/linear.ts:163` (two locations: ~163 and ~464)
- Modify: `api/src/routes/webhooks/github-issues.ts:172` (two locations: ~172 and ~473)
- Modify: `api/src/routes/boards.ts:170-182`

**Step 1: jira.ts webhook**

After line 133 (`qualityGateBypass`), add:
```typescript
      const hasAutoMergeLabel = labels.includes("auto-merge");
      const autoMergeEnabled = hasAutoMergeLabel || (org?.autoMergeEnabled ?? false);
```

Find where `deploymentEnabled` is passed to `workerTaskRepo.create()` and add `autoMergeEnabled` right after it.

**Step 2: tasks/crud.ts**

After line 398 (`improvementEnabled` block, before line 400 logger), add:
```typescript
    // Auto-merge configuration:
    // - If auto-merge label present → enable auto-merge after review
    // - If org.autoMergeEnabled → enable auto-merge after review
    // - Only effective when review is also enabled
    const hasAutoMergeLabel = labels.includes("auto-merge");
    const autoMergeEnabled = hasAutoMergeLabel || (org.autoMergeEnabled ?? false);
```

Add `autoMergeEnabled` to the `task = taskRepo.create({...})` call (after `deploymentEnabled` on line 477).

**Step 3: projects.ts (first location — assign endpoint ~line 1242)**

After line 1250 (`qualityGateBypass`), add:
```typescript
        const hasAutoMergeLabel = labels.includes("auto-merge");
        const autoMergeEnabled = hasAutoMergeLabel || (org.autoMergeEnabled ?? false);
```

Add `autoMergeEnabled` to the `workerTaskRepo.create()` call (~line 1334).

**Step 4: projects.ts (second location — create+run endpoint ~line 1518)**

After line 1527 (`standardSdkMode`), add:
```typescript
        const hasAutoMergeLabel = parsedLabels.includes("auto-merge");
        const autoMergeEnabled = hasAutoMergeLabel || (org.autoMergeEnabled ?? false);
```

Add `autoMergeEnabled` to the `workerTaskRepo.create()` call (~line 1595).

**Step 5: email.ts webhook**

After line 258 (`managerEnabled`), add:
```typescript
      const autoMergeEnabled = labels.includes("auto-merge");
```

Note: email webhook doesn't use org defaults (matches existing pattern for this file). Add `autoMergeEnabled` to the task creation.

**Step 6: linear.ts webhook (two locations)**

At each location where `deploymentEnabled` is set from `labelNames`, add after it:
```typescript
    const autoMergeEnabled = labelNames.includes("auto-merge");
```

And add `autoMergeEnabled` to each `workerTaskRepo.create()` call.

**Step 7: github-issues.ts webhook (two locations)**

Same pattern as linear.ts — at each location where `deploymentEnabled` is set from `labels`, add:
```typescript
    const autoMergeEnabled = labels.includes("auto-merge");
```

And add `autoMergeEnabled` to each `workerTaskRepo.create()` call.

**Step 8: boards.ts**

After line 179 (`qualityGateBypass`), add:
```typescript
  const hasAutoMergeLabel = labelNames.includes("auto-merge");
  const autoMergeEnabled = hasAutoMergeLabel || (org.autoMergeEnabled ?? false);
```

Add `autoMergeEnabled` to the `workerTaskRepo.create()` call (~line 283, after `deploymentEnabled`).

**Step 9: Verify typecheck passes**

Run: `cd api && npx tsc --noEmit`
Expected: no errors

**Step 10: Commit**

```bash
git add api/src/routes/webhooks/jira.ts api/src/routes/tasks/crud.ts api/src/routes/projects.ts api/src/routes/webhooks/email.ts api/src/routes/webhooks/linear.ts api/src/routes/webhooks/github-issues.ts api/src/routes/boards.ts
git commit -m "feat: recognize auto-merge label in all task creation routes"
```

---

### Task 4: Worker Config — EpicConfig + Env Var Passthrough

**Files:**
- Modify: `worker/epic/types.ts:174` (add `autoMergeEnabled` to EpicConfig)
- Modify: `worker/epic/index.ts:72` (read env var)
- Modify: `worker/epic/remote-bootstrap.ts:390` (read env var)
- Modify: `api/src/services/ecs-task-runner.ts:164` (pass env var)
- Modify: `api/src/services/local-epic-spawner.ts:763` (pass env var)
- Modify: `agent/src/spawner.ts:304` (pass env var)
- Modify: `agent/src/docker-spawner.ts:575` (pass env var)
- Modify: `agent/src/poller.ts:125` (add to claim response type)

**Step 1: Add to EpicConfig type**

In `worker/epic/types.ts`, after line 174 (`deploymentEnabled`), add:
```typescript
  /** If true, auto-merge PR after review approval (auto-merge label) */
  autoMergeEnabled?: boolean;
```

**Step 2: Read env var in worker entry points**

In `worker/epic/index.ts`, after line 72 (`deploymentEnabled`), add:
```typescript
    autoMergeEnabled: process.env.AUTO_MERGE_ENABLED === "true",
```

In `worker/epic/remote-bootstrap.ts`, after line 390 (`deploymentEnabled`), add:
```typescript
    autoMergeEnabled: process.env.AUTO_MERGE_ENABLED === "true",
```

**Step 3: Pass env var from spawners**

In `api/src/services/ecs-task-runner.ts`, after line 164 (`DEPLOYMENT_ENABLED`), add:
```typescript
      {
        name: "AUTO_MERGE_ENABLED",
        value: task.autoMergeEnabled ? "true" : "false",
      },
```

In `api/src/services/local-epic-spawner.ts`, after line 763 (`DEPLOYMENT_ENABLED`), add:
```typescript
      AUTO_MERGE_ENABLED: task.autoMergeEnabled ? "true" : "false",
```

In `agent/src/spawner.ts`, after line 304 (`DEPLOYMENT_ENABLED`), add:
```typescript
    AUTO_MERGE_ENABLED: task.autoMergeEnabled ? "true" : "false",
```

In `agent/src/docker-spawner.ts`, after line 576 (`DEPLOYMENT_ENABLED`), add:
```typescript
    AUTO_MERGE_ENABLED:
      task.autoMergeEnabled ? "true" : "false",
```

**Step 4: Add to agent poller claim response type**

In `agent/src/poller.ts`, after line 125 (`deploymentEnabled`), add:
```typescript
      autoMergeEnabled?: boolean;
```

**Step 5: Verify typecheck passes**

Run: `cd worker && npx tsc --noEmit && cd ../api && npx tsc --noEmit && cd ../agent && npx tsc --noEmit`
Expected: no errors (or only pre-existing dotenv error in agent)

**Step 6: Commit**

```bash
git add worker/epic/types.ts worker/epic/index.ts worker/epic/remote-bootstrap.ts api/src/services/ecs-task-runner.ts api/src/services/local-epic-spawner.ts agent/src/spawner.ts agent/src/docker-spawner.ts agent/src/poller.ts
git commit -m "feat: pass autoMergeEnabled through all spawners and worker config"
```

---

### Task 5: Coordinator Logic — Three-Way Merge Branch

**Files:**
- Modify: `worker/epic/coordinator.ts:3140-3174`

This is the core behavior change. Replace the unconditional merge with a three-way branch.

**Step 1: Modify the "approved" case in coordinator**

Find the current code at lines 3160-3174:
```typescript
        } else {
          // Default: merge the PR after Tech Lead approval
          const mergeLabel = this.config.prdChildTask ? "PRD auto-run" : "Tech Lead approved";
          console.log(`[Epic] ${mergeLabel} — auto-merging PR #${prNumber}`);
          await this.postLog(`Merging PR #${prNumber} (${mergeLabel})...`);
          const merged = await this.gitOps.mergePR(prUrl, prNumber);
          if (merged) {
            console.log(`[Epic] PR #${prNumber} merged successfully`);
            await this.postLog(`PR #${prNumber} merged successfully`);
            await this.ticketOps.postComment(`🔀 PR #${prNumber} auto-merged (${mergeLabel})`);
          } else {
            console.warn(`[Epic] PR #${prNumber} merge failed — manual merge required`);
            await this.postLog(`⚠️ PR #${prNumber} auto-merge failed — manual merge required`);
          }
        }
```

Replace with:
```typescript
        } else if (this.config.autoMergeEnabled || this.config.prdChildTask) {
          // Auto-merge enabled (via label, org setting, or PRD child task)
          const mergeLabel = this.config.prdChildTask ? "PRD auto-run" : "auto-merge enabled";
          console.log(`[Epic] ${mergeLabel} — auto-merging PR #${prNumber}`);
          await this.postLog(`Merging PR #${prNumber} (${mergeLabel})...`);
          const merged = await this.gitOps.mergePR(prUrl, prNumber);
          if (merged) {
            console.log(`[Epic] PR #${prNumber} merged successfully`);
            await this.postLog(`PR #${prNumber} merged successfully`);
            await this.ticketOps.postComment(`🔀 PR #${prNumber} auto-merged (${mergeLabel})`);
          } else {
            console.warn(`[Epic] PR #${prNumber} merge failed — manual merge required`);
            await this.postLog(`⚠️ PR #${prNumber} auto-merge failed — manual merge required`);
          }
        } else {
          // No auto-merge — leave PR open for manual merge
          console.log(`[Epic] PR #${prNumber} approved — leaving open for manual merge`);
          await this.postLog(`✅ PR #${prNumber} approved by Tech Lead — ready for manual merge`);
          await this.ticketOps.postComment(`✅ PR #${prNumber} approved by Tech Lead — ready for manual merge`);
        }
```

Key points:
- `prdChildTask` still auto-merges (existing behavior for dependency-ordered boards)
- `deploymentEnabled` still takes priority (the `if` on line 3152 is unchanged)
- `autoMergeEnabled` gates the merge when deployment is not enabled
- Default (neither) leaves the PR open

**Step 2: Verify typecheck passes**

Run: `cd worker && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add worker/epic/coordinator.ts
git commit -m "feat: gate PR auto-merge on autoMergeEnabled setting"
```

---

### Task 6: isPRMerged() in GitOps + Deployer Prompt Update

**Files:**
- Modify: `worker/epic/git-ops.ts:2742` (add `isPRMerged` method before `mergePR`)
- Modify: `worker/epic/inline-deployer.ts:186,285` (add "check if already merged" to prompts)

**Step 1: Add isPRMerged method to GitOps**

In `worker/epic/git-ops.ts`, add this method before the `mergePR` method (before line 2742):

```typescript
  /**
   * Check if a PR/MR is already merged.
   * Used by deployer to skip merge step if PR was auto-merged.
   */
  async isPRMerged(prNumber: number): Promise<boolean> {
    const scmProvider = this.config.scmProvider || "github";
    const token = this.config.githubToken;
    const targetRepo = this.config.targetRepo;

    try {
      switch (scmProvider) {
        case "github": {
          const [owner, repo] = targetRepo.split("/");
          if (!owner || !repo) return false;
          return await new Promise<boolean>((resolve) => {
            const options: https.RequestOptions = {
              hostname: "api.github.com",
              path: `/repos/${owner}/${repo}/pulls/${prNumber}`,
              method: "GET",
              headers: {
                Authorization: `Bearer ${token}`,
                "User-Agent": "WorkerMill-Epic-Agent",
                Accept: "application/vnd.github+json",
              },
            };
            const req = https.request(options, (res) => {
              let data = "";
              res.on("data", (chunk) => (data += chunk));
              res.on("end", () => {
                try {
                  const pr = JSON.parse(data);
                  resolve(pr.merged === true || pr.state === "closed" && pr.merged_at != null);
                } catch {
                  resolve(false);
                }
              });
            });
            req.on("error", () => resolve(false));
            req.end();
          });
        }
        case "bitbucket": {
          const [workspace, repoSlug] = targetRepo.split("/");
          if (!workspace || !repoSlug) return false;
          const authHeader = getBitbucketAuthHeader(token);
          return await new Promise<boolean>((resolve) => {
            const options: https.RequestOptions = {
              hostname: "api.bitbucket.org",
              path: `/2.0/repositories/${workspace}/${repoSlug}/pullrequests/${prNumber}`,
              method: "GET",
              headers: {
                Authorization: authHeader,
              },
            };
            const req = https.request(options, (res) => {
              let data = "";
              res.on("data", (chunk) => (data += chunk));
              res.on("end", () => {
                try {
                  const pr = JSON.parse(data);
                  resolve(pr.state === "MERGED");
                } catch {
                  resolve(false);
                }
              });
            });
            req.on("error", () => resolve(false));
            req.end();
          });
        }
        case "gitlab": {
          const encodedProject = encodeURIComponent(targetRepo);
          const baseUrl = this.config.scmBaseUrl || "https://gitlab.com";
          return await new Promise<boolean>((resolve) => {
            const url = new URL(`/api/v4/projects/${encodedProject}/merge_requests/${prNumber}`, baseUrl);
            const options: https.RequestOptions = {
              hostname: url.hostname,
              path: url.pathname,
              method: "GET",
              headers: {
                "PRIVATE-TOKEN": token,
              },
            };
            const req = https.request(options, (res) => {
              let data = "";
              res.on("data", (chunk) => (data += chunk));
              res.on("end", () => {
                try {
                  const mr = JSON.parse(data);
                  resolve(mr.state === "merged");
                } catch {
                  resolve(false);
                }
              });
            });
            req.on("error", () => resolve(false));
            req.end();
          });
        }
        default:
          return false;
      }
    } catch {
      return false;
    }
  }
```

**Step 2: Update deployer prompts — DEVOPS_SYSTEM_PROMPT_DEPLOY_AUTO**

In `worker/epic/inline-deployer.ts`, find the "Step 4: Merge the PR" section in `DEVOPS_SYSTEM_PROMPT_DEPLOY_AUTO` (around line 186). Replace:

```
### Step 4: Merge the PR

Only after ALL local checks pass, secrets are verified, and PR checks pass (if they exist):
\`\`\`bash
gh pr merge <PR_NUMBER> --squash --delete-branch
\`\`\`
```

With:

```
### Step 4: Merge the PR

First check if the PR is already merged (it may have been auto-merged after review approval):
\`\`\`bash
gh pr view <PR_NUMBER> --json state,mergedAt --jq '{state: .state, mergedAt: .mergedAt}'
\`\`\`
If the state is "MERGED", skip the merge and proceed directly to Step 5 (Monitor Deployment). Log: "PR already merged — skipping merge step."

Otherwise, only after ALL local checks pass, secrets are verified, and PR checks pass (if they exist):
\`\`\`bash
gh pr merge <PR_NUMBER> --squash --delete-branch
\`\`\`
```

**Step 3: Update deployer prompts — DEVOPS_SYSTEM_PROMPT_DEPLOY_MANUAL**

Same change for the manual deploy prompt (around line 285). Replace:

```
### Step 4: Merge the PR

Only after ALL validations pass and secrets are verified:
\`\`\`bash
gh pr merge <PR_NUMBER> --squash --delete-branch
\`\`\`
```

With:

```
### Step 4: Merge the PR

First check if the PR is already merged:
\`\`\`bash
gh pr view <PR_NUMBER> --json state,mergedAt --jq '{state: .state, mergedAt: .mergedAt}'
\`\`\`
If the state is "MERGED", skip the merge and proceed directly to Step 5 (Trigger the Deployment Workflow). Log: "PR already merged — skipping merge step."

Otherwise, only after ALL validations pass and secrets are verified:
\`\`\`bash
gh pr merge <PR_NUMBER> --squash --delete-branch
\`\`\`
```

**Step 4: Also update the dynamic prompt sections**

The deployer also has dynamic prompt building around lines 1070 and 1147 (in `buildDeployAutoPrompt` and `buildDeployManualPrompt` methods). Find:

```
4. Only after ALL validations pass and secrets are verified, merge: \`gh pr merge ${prNumber}${repoFlag} --squash --delete-branch\`
```

And prepend a check:
```
4. Check if PR is already merged: \`gh pr view ${prNumber}${repoFlag} --json state --jq '.state'\`. If "MERGED", skip merge and go to step 5.
5. Only after ALL validations pass, merge: \`gh pr merge ${prNumber}${repoFlag} --squash --delete-branch\`
```

(Renumber subsequent steps accordingly.)

**Step 5: Verify typecheck passes**

Run: `cd worker && npx tsc --noEmit`
Expected: no errors

**Step 6: Commit**

```bash
git add worker/epic/git-ops.ts worker/epic/inline-deployer.ts
git commit -m "feat: add isPRMerged check + deployer handles already-merged PRs"
```

---

### Task 7: Frontend Settings UI

**Files:**
- Modify: `frontend/src/pages/settings/types.ts:86` (add to Settings interface)
- Modify: `frontend/src/pages/settings/index.tsx:151,489` (wire default + API fetch)
- Modify: `frontend/src/pages/settings/QualitySection.tsx:97` (add toggle)

**Step 1: Add to Settings type**

In `frontend/src/pages/settings/types.ts`, after line 86 (`autoImproveEnabled`), add:
```typescript
  autoMergeEnabled: boolean;
```

**Step 2: Wire default in settings index**

In `frontend/src/pages/settings/index.tsx`, after line 151 (`autoImproveEnabled: false`), add:
```typescript
    autoMergeEnabled: false,
```

After line 489 (`autoImproveEnabled: data.autoImproveEnabled ?? false`), add:
```typescript
        autoMergeEnabled: data.autoMergeEnabled ?? false,
```

**Step 3: Add toggle to QualitySection**

In `frontend/src/pages/settings/QualitySection.tsx`, add the Auto-Merge toggle after the PR-Review toggle (after line 97, before the Auto-Deploy section at line 99). Add a `GitMerge` import from lucide-react.

```tsx
        {/* Auto-Merge */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <div className="flex items-center gap-3">
            <GitMerge className="w-4 h-4 text-blue-400" />
            <div>
              <span className="text-sm text-foreground">Auto-Merge</span>
              <p className="text-xs text-muted-foreground">Automatically merge PR after successful review</p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.autoMergeEnabled}
              onChange={(e) => updateSetting("autoMergeEnabled", e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
          </label>
        </div>
```

Add `GitMerge` to the lucide-react import at the top of `QualitySection.tsx`.

**Step 4: Verify typecheck passes**

Run: `cd frontend && npx tsc -b`
Expected: no errors

**Step 5: Commit**

```bash
git add frontend/src/pages/settings/types.ts frontend/src/pages/settings/index.tsx frontend/src/pages/settings/QualitySection.tsx
git commit -m "feat: add Auto-Merge toggle to settings UI"
```

---

### Task 8: API Settings Route — Persist autoMergeEnabled

**Files:**
- Check: `api/src/routes/settings.ts` (ensure `autoMergeEnabled` is included in the settings save/load)

The settings route likely saves all fields from the request body to the Organization model. Since TypeORM uses `Object.assign()` or `.save()`, the new column should be picked up automatically. But we need to verify.

**Step 1: Verify the settings PUT route handles the field**

Read `api/src/routes/settings.ts` and find the PUT handler. Confirm that `autoMergeEnabled` is either:
- Explicitly listed in the fields to save, OR
- The route uses a generic pattern that saves all fields from the request body

If it uses an explicit whitelist, add `autoMergeEnabled` to that list.

**Step 2: Verify by running typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit (only if changes needed)**

```bash
git add api/src/routes/settings.ts
git commit -m "feat: include autoMergeEnabled in settings save"
```

---

### Task 9: Final Verification + Deploy

**Step 1: Full typecheck across all packages**

Run each:
```bash
cd api && npx tsc --noEmit
cd ../frontend && npx tsc -b
cd ../worker && npx tsc --noEmit
cd ../agent && npx tsc --noEmit
```

Expected: no errors (agent may have pre-existing dotenv error — that's OK)

**Step 2: Run API tests**

Run: `cd api && npm run test`
Expected: all existing tests pass

**Step 3: Final commit if any fixups needed**

**Step 4: Deploy API**

Run: `./deploy.sh --api`

This will:
- Build and push the API image
- Run the migration automatically on startup
- Make the new setting available

**Step 5: Deploy frontend**

Run: `./deploy.sh --frontend`

**Step 6: Deploy worker (for deployer prompt changes)**

Run: `./deploy.sh --worker`

**After deploy:** The worker and agent changes only take effect for new tasks. Existing in-flight tasks use the old code. The agent binary needs a new release for remote agent users — bump version, tag, push.

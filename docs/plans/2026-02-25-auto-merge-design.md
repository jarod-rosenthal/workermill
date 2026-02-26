# Auto-Merge Toggle + Label Override

**Date:** 2026-02-25
**Status:** Approved

## Problem

When a PR is approved by the Tech Lead reviewer, the coordinator always auto-merges the PR (coordinator.ts:3160-3174). There is no way to leave an approved PR open for manual merge. This caused confusion when the `deploy` label was present — the PR was merged as part of deployment, but if deployment failed, the merge behavior was unclear.

Users need:
1. An org-level toggle to control whether approved PRs auto-merge (default: OFF)
2. A per-task `auto-merge` label to override the org default
3. Clear precedence when both `auto-merge` and `deploy` are active
4. The deployer must gracefully handle already-merged PRs

## Precedence Rules

```
1. deploymentEnabled (deploy label / org setting)    → Deployer merges + deploys
2. autoMergeEnabled (auto-merge label / org setting)  → Merge after review approval
3. Neither                                            → Leave PR open after approval
```

`deploy` always takes priority over `auto-merge`. When both are set, the deployer owns the merge. `autoMergeEnabled` is ignored when `deploymentEnabled` is true.

`auto-merge` only takes effect when review is enabled (via `review` label or `autoReviewEnabled` org setting). We never auto-merge unreviewed PRs.

## Coordinator Logic

```
After Tech Lead approves:
  IF deploymentEnabled:
    → InlineDeployer handles merge + deploy (unchanged)
  ELSE IF autoMergeEnabled AND reviewEnabled:
    → merge PR via gitOps.mergePR()
    → status = "pr_approved"
    → ticket comment: "🔀 PR auto-merged (Tech Lead approved, auto-merge enabled)"
  ELSE:
    → leave PR open
    → status = "pr_approved"
    → ticket comment: "✅ PR approved — ready for manual merge"
```

## Deployer Confusion Handling

### Scenario A: `deploy` + `auto-merge` on same task
- `deploymentEnabled = true` takes priority in coordinator (existing `if` at line 3152)
- `autoMergeEnabled` is skipped — deployer handles merge+deploy as a unit

### Scenario B: PR manually merged before deployer runs
- Add `isPRMerged()` check to `git-ops.ts`
- Deployer checks PR state before attempting merge
- If already merged → skip merge, proceed to deployment monitoring
- Log: "PR #N already merged — skipping merge, proceeding to deployment monitoring"

### Scenario C: `auto-merge` org default ON, `deploy` label on specific task
- Label-level `deploymentEnabled = true` takes priority
- Auto-merge never fires because `deploymentEnabled` branch runs first

### Deployer Prompt Update
Add instruction to deployer system prompt: before merging, check PR state via `gh pr view <PR_NUMBER> --json state`. If state is "MERGED", skip merge and proceed to deployment monitoring.

## Changes

### Database
- New migration: add `auto_merge_enabled boolean DEFAULT false` to `organizations` table
- New migration: add `auto_merge_enabled boolean DEFAULT false` to `worker_tasks` table

### API Models
- `Organization.ts`: add `autoMergeEnabled` column
- `WorkerTask.ts`: add `autoMergeEnabled` column

### API Routes (label → flag mapping)
- `routes/webhooks/jira.ts`: recognize `auto-merge` label, set `autoMergeEnabled` flag
- `routes/tasks/crud.ts`: same label recognition
- `routes/projects.ts`: same label recognition
- Precedence: `deploy` label sets `deploymentEnabled`, `auto-merge` label sets `autoMergeEnabled`

### Worker Types
- `types.ts`: add `autoMergeEnabled?: boolean` to `EpicConfig`

### Worker Coordinator
- `coordinator.ts` (lines 3140-3175): replace unconditional merge with three-way branch:
  1. `deploymentEnabled` → deployer (unchanged)
  2. `autoMergeEnabled` → merge + pr_approved
  3. neither → leave open + pr_approved

### Worker Git Ops
- `git-ops.ts`: add `isPRMerged(prNumber)` method (GitHub/Bitbucket/GitLab)

### Worker Deployer
- `inline-deployer.ts`: add "check if PR already merged" to deployer system prompts (Phase 2A and 2B)

### Frontend Settings
- `types.ts`: add `autoMergeEnabled: boolean` to `Settings` interface
- `index.tsx`: wire `autoMergeEnabled` in defaults and API fetch
- `QualitySection.tsx`: add Auto-Merge toggle between PR-Review and Auto-Deploy toggles

## UI Placement

The Auto-Merge toggle sits in the Quality section between "PR-Review" and "Auto-Deploy":

```
PR-Review          [toggle]  — Automatically run AI PR review
Auto-Merge         [toggle]  — Automatically merge PR after successful review
Auto-Deploy        [toggle]  — Automatically merge and deploy after successful review
Anneal             [toggle]  — Iteratively refine and improve code quality
```

Auto-Merge description: "Automatically merge PR after successful review"
Note: Auto-Merge has no effect unless PR-Review is also enabled.

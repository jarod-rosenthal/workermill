# WorkerMill recovery handoff

Updated UTC: 2026-09-06T19:04:27.519570+00:00. This file is the restart entry point. Read it before making implementation changes. The current user request is **retrospective, preservation, and prevention instructions**. Do not treat the older instruction to finish the backlog as permission to restart implementation during this recovery task.

## Current state

- Repository: `/home/user/github/workermill`, a single-package TypeScript CLI, npm package `workermill` (commands `wm` / `workermill`). This is not the archived server/frontend project.
- Integration branch: `reliability/core`; implementation HEAD: `22ba7d7c0d12dd9bed85586fcbf6f966030245c7`.
- Baseline, local `main`, and cached `origin/main`: `9e317488` (`chore: release v1.1.1`). Remote refs were not refreshed during recovery.
- Saved implementation: 146 commits beyond baseline; 163 changed paths, 17,514 added lines, 6,757 deleted lines. These counts describe scope, not correctness or completion percentage.
- 38 registered worktrees survive. Before recovery documentation, core was clean and the other worktrees had only an untracked `node_modules` symlink. No unfinished merge/cherry-pick was present in core.
- **Core is broken.** Fresh Node 22.22.2 full unit run: **80 failed, 1,550 passed, one skipped**, exit 1, 106 test files. Typecheck passed. See the retrospective and recovery evidence for details.
- The 80 failures consist of 79 manifest-related cases and one browser discovery cancellation assertion at `src/__tests__/browser.test.ts:190`. The browser failure's cause is not yet established.
- No implementation fixes, branch resets, worktree cleanup, pushes, PRs, releases, or paid model evaluations were performed by this recovery task.

## Read these files

1. [AGENTS.md](AGENTS.md): project conventions and continuity rules.
2. [Retrospective](docs/recovery/2026-09-06-retrospective.md): incident, evidence, work completed, remaining work, and process failures.
3. [Inventory](docs/recovery/2026-09-06-inventory.json): all worktree paths/HEADs, every changed path, all 32 pre-recovery tracked Markdown docs, and recent commits.
4. [Historical evidence](docs/recovery/2026-09-06-evidence.json): termination record, final worker reports, and source-located historical validation summaries.
5. [Implementation specification](docs/reliability-plan.md) and [queue](docs/reliability-queue.json): acceptance criteria and prior task tracking. Queue completion statements are historical evidence, **not** a green qualification of current HEAD.

## Why execution stopped

Original session: `01a07404-1d34-7de0-86c0-00962f101911`.

At `2026-09-06T18:42:01.964Z` (2:42:01 p.m. EDT), its terminal event recorded:

```text
This request was blocked by our safety systems. Reason: Potentially unintended activity.
codex_error_info: misalignment_policy_violation
```

The available event does not identify the triggering action. Do not claim this proves the user did not authorize reliability/security work, or that the code regression caused the block. Do not attempt to bypass the host's safety controls.

## Immediate code blocker

R15a introduced a validated active/terminal manifest schema but core still has the previous orchestration writer:

- `src/run-manifest.ts:125` creates `phase: "active"`, `outcome: "in_progress"`.
- `src/run-manifest.ts:102` rejects active manifests with terminal fields.
- `src/orchestrator.ts:806–828` sets `completedAt` and a terminal outcome, leaves phase active and terminal reason unset, then calls `saveRunManifest`.
- This produces `active manifests must be in-progress without terminal fields` on ordinary orchestration completion.
- Many early returns still never persist a terminal record. Identity preflight exists in `src/review-identity.ts` but is not wired into orchestration. R15 is incomplete; changing only the phase would not finish its acceptance contract.

Do not disable validation, swallow the error, or delete failing tests to make the suite green. A future implementation owner must reconcile caller and storage contracts and qualify terminal outcomes.

## Saved work requiring special handling

| Work | Location | State / next action |
| --- | --- | --- |
| R15a storage | Core `5aa6a940`, `22ba7d7c`; worker `/home/user/github/workermill-r15a` | Integrated, but not compatible with the unchanged caller. Queue still says in progress. |
| R15b attempt-event seams | `/home/user/github/workermill-r15b`, branch `reliability/r15b`, commit `7aa8e08929293456a21fe687696dbe17a4fc1368` | Not integrated. Worker committed at 2:45:49 p.m. EDT after parent block. Three production adapters and three focused test files. Reported focused tests/typecheck pass; full R15 finalizer/preflight is absent. Review before cherry-picking. |
| R23 cleanup | Core `861008d9`, `b1fec7fe`; worker `/home/user/github/workermill-r23`, HEAD `8b279527` | Cleanup and MCP coverage correction are already in core. `git cherry` lists some differences because conflict resolutions changed patch IDs. Core and worker production/test trees match; their final tree diff is only two docs. Do not replay the branch wholesale. Full integration qualification remains failed. |
| Remaining worktrees | See inventory | Other worker patch sets are represented in core. Preserve until recovery is reviewed; no cleanup is required to continue. |

## What remains after the audit

The queue has 15 parent tasks marked complete: R01–R14 and R20. R15 and R23 are in progress. R16, R17, R18, R19, R21, R22, and R24 are not marked complete. This is task bookkeeping, not an effort estimate.

If implementation is resumed under the user's current direction, use this order:

1. Review the manifest mismatch and saved R15b diff. Finish truthful start/progress/final persistence and identity preflight; test failure, cancellation, blocked publication, success, and retry lineage. Keep this a bounded task.
2. Requalify R15/R23 together at one exact commit; reconcile removed legacy test coverage with production-path replacements. Record every failure and skip.
3. R16a–c: real SDK scripted-model fixture and actual runtime contract tests; remove remaining copied test logic.
4. R18a–c: complete per-call usage ledger and unknown pricing semantics; include all roles and children exactly once. Can overlap R16 only under the existing file/lock contract.
5. R17: offline installed-package/PTY/platform CI qualification. R22: final useful docs and migration notes. R24: final release-candidate review and checks.
6. R19 budgets and R21 comparison harness are optional for the first release. R20 fixtures exist; no live comparative benchmark is established. Live evaluations, publishing, pushes, PRs, and releases require the separately applicable authorization.

## Reproduction and validation

Use Node 22.22.2 locally; package support starts at Node 22.12. Do not use the installed Node 18/20 for qualification.

```bash
cd /home/user/github/workermill
source /home/user/.nvm/nvm.sh
nvm use 22.22.2
git status --short --branch
git rev-parse HEAD
npm run typecheck
npm test
```

The suite uses temporary WorkerMill application state. Process/local-server/OS fixtures can fail or stall in a restricted outer sandbox. Request the host's normal escalation when needed; record the environment. Do not reinterpret sandbox failures as product failures or quietly skip those tests. No live-provider E2E is needed for this audit.

Fresh recovery output initially lives in `/tmp/workermill-recovery-audit/`; the durable evidence summaries are under `docs/recovery/`. `/tmp` and host session records are not portable backups. Do not require either to understand the next action.

## Checkpoint protocol

Before each new implementation batch, update this file with current authorization, exact base/HEAD, one bounded objective, owned files, worker/worktree mapping, and completion criteria. After each integration or failed check, update it with the actual result and next action **before** expanding work. Checkpoint at least every 15 minutes during long work and before a context handoff. Failed integration stops new feature dispatch; fix or preserve it with explicit evidence. An unexpected shutdown may still occur between checkpoints; repository instructions cannot prevent platform termination.

Do not ask the user to reconstruct the old conversation until this handoff, plan, queue, Git evidence, and available local session history have been checked.

## Recovery documentation checkpoint

The requested retrospective and prevention instructions are now written. Recovery artifacts are `HANDOFF.md`, `docs/recovery/2026-09-06-{retrospective.md,inventory.json,evidence.json,validation.json}`, plus links/instructions in `AGENTS.md`, `docs/README.md`, and a snapshot in `docs/reliability-queue.json`. These are local documentation changes; implementation HEAD remains `22ba7d7c`. No implementation workers or feature batches were started by this recovery task. Local Markdown links, JSON parsing, and `git diff --check` passed. Documentation/hook checks passed all 32 tests (exit 0); the full implementation test failure is preserved above. The next implementation action, if resumed, is the bounded R15 integration repair and browser-failure diagnosis, not a restart of the entire project.

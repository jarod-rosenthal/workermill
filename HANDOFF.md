# WorkerMill recovery handoff

Updated UTC: 2026-09-06T20:21:04.629168+00:00. User-authorized recovery repair batch is implemented and qualified on `reliability/core`. Base: `f613413b`; the local repair commit immediately following that base contains the tested implementation. No release, push, paid evaluation, or unrelated feature expansion.

**Current qualification: 1,643 passed, zero failed, one pre-existing skipped test across 107 files; typecheck and build passed on Node 22.22.2.** The original 80 failures are resolved. Read the final checkpoint below before acting; historical audit sections preserve the evidence from the broken head.

Coordinator owns final documentation/commit. Both bounded workers have finished. The broader reliability backlog remains incomplete. Next bounded task is R15/R23 acceptance reconciliation and replacement-coverage mapping before downstream R16/R18 dispatch.


## Historical audit state (before the repair below)

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

## Historical code blocker (repair in progress)

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

## Recovery documentation checkpoint (before implementation resumed)

The requested retrospective and prevention instructions are now written. Recovery artifacts are `HANDOFF.md`, `docs/recovery/2026-09-06-{retrospective.md,inventory.json,evidence.json,validation.json}`, plus links/instructions in `AGENTS.md`, `docs/README.md`, and a snapshot in `docs/reliability-queue.json`. These are local documentation changes; implementation HEAD remains `22ba7d7c`. No implementation workers or feature batches were started by this recovery task. Local Markdown links, JSON parsing, and `git diff --check` passed. Documentation/hook checks passed all 32 tests (exit 0); the full implementation test failure is preserved above. The next implementation action, if resumed, is the bounded R15 integration repair and browser-failure diagnosis, not a restart of the entire project.

## Active repair checkpoint — 2026-09-06T19:17:34.170466+00:00

Base commit: `f613413b`; current HEAD remains that documentation checkpoint. R15b `7aa8e089` applied with `--no-commit`; production orchestration now persists active/progress/terminal records, wires real attempt/review callbacks and reviewer identity preflight, and passes run IDs through retry state. Resource-teardown aborts no longer mislabel failed attempts as user cancellation. Completion-blocked outcomes are failed, not partial. No validation was disabled.

Uncommitted ownership: coordinator — `src/orchestrator.ts`, execution/planning/review adapters and policy tests, `src/orchestrator/types.ts`, `src/ship-state.ts`, `src/ui/useOrchestrator.ts`; test worker `manifest_regressions` — only new `src/__tests__/orchestration-manifest-runtime.test.ts` in core. Browser worker `browser_repair` — isolated `/home/user/github/workermill-recovery-browser`, branch `recovery/browser`; saved `9ca76df3` is not integrated yet because coordinator requested a bounded-cleanup check before accepting an awaited cancellation.

Checks on dirty core using Node 22.22.2: typecheck exit 0; orchestrator/final-evidence/startup/manifest focused suite exit 0, 134 passed/1 skipped. New persistence tests initially found completion invalidation labeled partial; repaired the outcome mapping. Latest worker/review/manifest focused suite exit 0, 23 passed. The test worker is adding pending-completion and identity/review-block cases. Full suite/build have not yet qualified the integrated repair. Browser worker reports 17 focused passes and 20 consecutive assertion passes, but its initial full run still had the known 79 core manifest failures.

Next action: finish focused manifest coverage and bounded browser cleanup, integrate browser, run typecheck/full unit suite/build on one fixed tree, record exact results and commit the bounded repair. R15/R23 remain in progress until qualification and acceptance reconciliation; do not dispatch downstream features yet.

### Integration failure and correction — 2026-09-06T20:19:28.404466+00:00

Combined full suite exit 1: 1,639 passed, 1 failed, 1 skipped, 107 files; browser slow-stream cancellation assertion at line 179 failed. Typecheck/build exit 0. Log `/tmp/workermill-recovery-repair-full.log`. Coordinator found the browser fixture writes DevToolsActivePort asynchronously, racing a 100 ms startup deadline against the 100 ms discovery retry. Fetch may never begin, so cancellation was never exercised. Worker production cleanup diagnosis was not established; both browser production patches were removed from core. Fixture now publishes its fake port file synchronously before discovery starts; original cancellation assertions retained, plus non-settling cancellation regression. No production browser changes remain.

Coordinator added three manifest tests after the full run: pending completion remains active, required identity blocks before workers, strict review rejection persists and prevents completion. Full requalification is required after these changes. Both workers have finished; coordinator owns final correction and qualification.

## Qualified repair checkpoint

- Base `f613413b` plus this repair's tracked implementation diff and new manifest runtime test; branch `reliability/core`. No provider/model defaults or routing changed.
- Saved R15b event seams `7aa8e089` integrated with orchestration active/progress/final persistence, typed planner exit reasons, actual attempt/review events, identity preflight, and retry run IDs. Success is recorded after completion settles and cleanup succeeds. Blocked completion/gates/review and cleanup failure record failed outcomes; cancellation is distinct from teardown's internal abort.
- Browser production remains identical to base. Corrected the fixture's asynchronous handshake race; all original assertions retained. Added bounded non-settling cancellation coverage. Browser worker commits `9ca76df3` and `cd42e38e` remain preserved on `recovery/browser` but their production workaround is intentionally absent from core.
- `npm test` exit 0: **1,643 passed, 0 failed, 1 skipped, 107 files**, 31.14s, started 2026-09-06 16:19:42 EDT. Runtime process/server fixtures used normal approved execution outside the outer restricted sandbox. Final log: `/tmp/workermill-recovery-repair-full.log`; failed first qualification: `/tmp/workermill-recovery-repair-first-full.log`. These portable counts are authoritative without those temporary logs.
- `npm run typecheck` exit 0; `npm run build` exit 0. `git diff --check` passed. Existing skip is the obsolete `useCritic` configuration case in `src/__tests__/orchestrator.test.ts`; no new skips.
- Added tests read real manifest storage across planner rejection/error, startup cancellation, cleanup failure, required gates, deferred completion, completion invalidation, required reviewer identity, strict review rejection, failed worker callbacks, and retry lineage. Adapter tests exercise actual worker failure/cancellation and revision timeout events. Orchestration storage tests mock stage adapters; they are not full live model integration.

### Remaining work and exact next action

R15 and R23 remain **in progress**, even with a green integrated suite. Reconcile R15 acceptance for partial-run evidence, permission/hook failure reason detail, actual review/revision attempt evidence, and completion/runs display agreement; reconcile R23 removed legacy coverage against production-path replacement tests. Check the plan and existing tests before adding or changing anything. Do not equate this regression repair with completion of every R15/R23 criterion.

Then follow the documented dependency order: R16 scripted-model runtime contract coverage; R18 usage/pricing ledger; R17 installed-package/PTY/platform qualification; R22 final reference docs; R24 release-candidate qualification. R19 budgets/R21 comparison harness remain optional first-release work. No paid live evaluation, publication, or cleanup of surviving worktrees was performed.

All implementation workers are finished. No worker-owned edits remain pending outside the changes recorded here. Recovery/browser commits are preserved as rejected implementation evidence; R15b was incorporated with coordinator corrections. The original retrospective and recovery inventory remain unchanged historical evidence. Continue from this checkout and this checkpoint; do not redo the original eleven hours.

# WorkerMill recovery handoff

Checkpoint: 2026-09-06 21:24 UTC. Integration branch `reliability/core`; latest implementation `47dc4d7f`. User authorized finishing remaining reliability work as far as possible. R15/R23, all R16, R18a/b1/b2 accepted. Latest combined qualification: **1,588 passed, zero failed, one existing skip, 110 test files; typecheck/build passed.** Test count decreased because copied UI/policy helpers were removed with coverage mapping in `docs/recovery/r16-coverage.md`, not because failed tests were skipped.

Accepted candidates: R16c `ed038c9e` -> core `47dc4d7f`; R18b2 `e7674a1b`/`83967db8` -> core `6a402911`/`4a295f3f`, root regression `6eaaeab9`. Full `npm test` exit0, Node22.22.2/Linux, 31.08sec, supplemental log `/tmp/workermill-r16c-r18b2-qualified.log`. `npm run typecheck` and `npm run build` exit0. Core source clean; this checkpoint edits docs only.

Next batch (two implementation workers, isolated worktrees from this qualified implementation plus checkpoint): R18b3 owns `src/ui/useAgent.ts`, session-accounting helpers and chat tests; R17 owns package test scripts, CI workflow, packaged/PTY tests/helpers only. R17 can progress independently of chat. R18c orchestration ledger follows chat, now split before dispatch into c1 planning/spec/critic/extraction, c2 workers/reviews/revisions, c3 storage/UI/whole-run qualification. See plan/queue scope contracts. No paid model evaluation, publication, push, release, or worktree cleanup.

Workers must not request escalated tool calls: these stalled in the delegated environment. Freeze/report sandbox EPERM; coordinator runs focused commands through normal escalation. Worker candidates require review and full combined qualification before acceptance. No failed integrated check is currently unresolved. Read appended historical checkpoints for earlier evidence; this header is current.

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

- Tested implementation commit: `08077002`; base `f613413b`; branch `reliability/core`. No provider/model defaults or routing changed.
- Saved R15b event seams `7aa8e089` integrated with orchestration active/progress/final persistence, typed planner exit reasons, actual attempt/review events, identity preflight, and retry run IDs. Success is recorded after completion settles and cleanup succeeds. Blocked completion/gates/review and cleanup failure record failed outcomes; cancellation is distinct from teardown's internal abort.
- Browser production remains identical to base. Corrected the fixture's asynchronous handshake race; all original assertions retained. Added bounded non-settling cancellation coverage. Browser worker commits `9ca76df3` and `cd42e38e` remain preserved on `recovery/browser` but their production workaround is intentionally absent from core.
- `npm test` exit 0: **1,643 passed, 0 failed, 1 skipped, 107 files**, 31.14s, started 2026-09-06 16:19:42 EDT. Runtime process/server fixtures used normal approved execution outside the outer restricted sandbox. Final log: `/tmp/workermill-recovery-repair-full.log`; failed first qualification: `/tmp/workermill-recovery-repair-first-full.log`. These portable counts are authoritative without those temporary logs.
- `npm run typecheck` exit 0; `npm run build` exit 0. `git diff --check` passed. Existing skip is the obsolete `useCritic` configuration case in `src/__tests__/orchestrator.test.ts`; no new skips.
- Added tests read real manifest storage across planner rejection/error, startup cancellation, cleanup failure, required gates, deferred completion, completion invalidation, required reviewer identity, strict review rejection, failed worker callbacks, and retry lineage. Adapter tests exercise actual worker failure/cancellation and revision timeout events. Orchestration storage tests mock stage adapters; they are not full live model integration.

### Remaining work and exact next action

R15 and R23 remain **in progress**, even with a green integrated suite. Reconcile R15 acceptance for partial-run evidence, permission/hook failure reason detail, actual review/revision attempt evidence, and completion/runs display agreement; reconcile R23 removed legacy coverage against production-path replacement tests. Check the plan and existing tests before adding or changing anything. Do not equate this regression repair with completion of every R15/R23 criterion.

Then follow the documented dependency order: R16 scripted-model runtime contract coverage; R18 usage/pricing ledger; R17 installed-package/PTY/platform qualification; R22 final reference docs; R24 release-candidate qualification. R19 budgets/R21 comparison harness remain optional first-release work. No paid live evaluation, publication, or cleanup of surviving worktrees was performed.

All implementation workers are finished. No worker-owned edits remain pending outside the changes recorded here. Recovery/browser commits are preserved as rejected implementation evidence; R15b was incorporated with coordinator corrections. The original retrospective and recovery inventory remain unchanged historical evidence. Continue from this checkout and this checkpoint; do not redo the original eleven hours.

## Continuation authorized — 2026-09-06T20:37:47.679962+00:00

Base `8cd7c733`, clean tree. Resume existing backlog under latest user direction. Two implementation workers maximum; smaller-model bounded dispatches per plan. First batch ownership and acceptance are recorded at top.

### R15/R23 integration checkpoint

Base8cd7c733 dirty R15 final-outcome/UI agreement plus permission failure evidence; R23 audit and MCP transport/emergency tests restored. Focused checks30+5 and MCP7 passed; typecheck/build passed. First combined suite exit1:1653passed,1failed,1skip; failure is `manifest completed before it started` in orchestrator planner-prompt test. Writer now clamps wall-clock completion timestamps to corresponding starts; validator unchanged; regression simulates backward wall clock. Next: qualify corrected combined tree before downstream dispatch.

## R15/R23 accepted checkpoint

Base `8cd7c733` plus this commit's bounded diff: R15/R23 accepted. Combined `npm test` exit0, 1655 passed/0 failed/1 pre-existing skip,107files,30.99s; `npm run typecheck` exit0; build passed before final timestamp-only correction and will be repeated at next integration boundary. Evidence: `docs/recovery/r15-acceptance.md`, `r23-acceptance.md`. UI/program completion now uses the finalized persisted outcome; terminal reason visible in run details; partial/retry/blocked/clock tests passed. MCP transport and emergency-stop gaps restored. No active workers.

Next batch: R16a scripted-model fixture (test-harness lock) and R18a ledger/types only (cost lock), in separate worktrees from this committed integration. Coordinator owns integration and checkpoint docs, no overlapping adapter changes. No live calls or pricing/default changes. R16/R18 parents remain in progress until suffix packages integrate.

### Prepared successor inventory (read-only)

R18b: headless success-only addUsage is `run-command.ts:284`; chat success-only addUsage `ui/useAgent.ts:1093`; child callback already exists as `onSubAgentUsage` through `engine/tools/index.ts:60,835` to `sub-agent.ts:284`; compaction generateText has no usage callback (`compaction.ts:338`). Chat invokes auto and manual compaction. Preserve reported failed/partial usage, record each invocation once in finalization, and distinguish missing usage. R18c: planner/critic aggregates added in `orchestrator.ts`, workers/review/revisions in adapters; session stores numeric summaries in `session.ts`, manifest has a strict allowlist/schema, both need explicit ledger completeness metadata. New call IDs should identify SDK invocations and document step aggregation.

R17 prep: current CI only Ubuntu/Node22 and duplicates lint/typecheck; existing headless CLI tests run source through tsx with a node_modules symlink, so they do not qualify a packed install. Package already has node-pty and engines>=22.12; matrix must explicitly include22.12.0/22.22.2 on Linux/macOS. Installed-package tests need built dist and offline scripted transport, no keys/live calls.

### Worker wait intervention — 2026-09-06T20:56:08.503955+00:00

Both worker full-test tool calls stopped returning output for over five minutes and provided no process session IDs. Coordinator interrupted both waits; no full-test pass is claimed. Saved edits/focused checks remain intact. Workers are producing candidate commits after bounded corrections and focused/typecheck results; full acceptance remains coordinator-owned on combined core. Do not restart duplicate worker full suites. R16a focused corrected4/4 and typecheck pass; R18a corrections preserve unknown-price token totals/local LMStudio/partial completeness before handoff.

## R16a/R18a accepted and successor batch

Implementation8ab95df8 (R16a e9184308, R18a8ab95df8). Full suite1665passed0failed1skip108files31.34s; typecheck/buildexit0. Original worker full waits aborted; this combined run qualifies both candidates. Next R16b owns real-SDK governance tests only. R18b split before implementation into b1 child/compaction usage events, b2 headless, b3 chat, preserving sequential runtime ownership and150-350line target. Coordinator owns integration; no parallel adapter writers. All suffixes require combined qualification before advancing.

Current coordinator-only correction during R16b/R18b1: clarify ledger inputTokens are SDK total input including cache tokens; subtract cache-priced dimensions before applying ordinary input rate. Existing cache test double-charged those dimensions. Own only cost-tracker.ts and cost-tracker.test.ts; worker files disjoint. Provider rate values unchanged.

Coordinator R18 accounting correction also includes observed partial-call cost in known subtotal while preserving partial/missing flags, rather than dropping known failed-attempt usage. Focused initial correction hit floating-point exact equality (.0012 vs .0012000000000000001); assertion now uses tight numeric tolerance. No rate/default changes.

## R16b/R18b1 accepted checkpoint

Exact tested implementation36471d14 including coordinator cache/partial corrections aeea7bb5, child/compaction43f3b197, SDKgovernance36471d14. Combined npmtest exit0:1675passed0failed1skip109files31.07s; typecheck/buildexit0. Root-run focused SDK6pass and child13pass; worker compaction39pass. Revision fixture corrected to actually enter a revision (maxRevisions2); worker fixture declares required file and verifies failure after denied writes. No production permission assertions weakened.

Next scopes: R16c test-only mounted chat/session/child lifecycle and mirrored-test replacement; R18b2 headless ledger/child callback integration, optional shared SDK usage normalization helper and session metadata type only. Separate worktrees from current core. Coordinator runs all escalation-requiring checks directly; workers must freeze/report after sandbox failure, never submit another long delegated escalation wait. Candidates only until combined full qualification.

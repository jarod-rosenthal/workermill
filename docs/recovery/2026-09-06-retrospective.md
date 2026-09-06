# WorkerMill reliability work: September 6 retrospective

Prepared on 2026-09-06 from the local repository, all 38 registered worktrees, the prior coordinator and final worker session records, and a fresh test run. Implementation snapshot: `22ba7d7c0d12dd9bed85586fcbf6f966030245c7`. This is an incident/recovery document requested by the user, not a product guarantee or release qualification.

## Findings

The prior work was **not erased**. WorkerMill has 146 commits on `reliability/core` beyond the `9e317488` baseline, affecting 163 paths. A further R15b worker commit survives on its own branch. Repeating eleven hours of implementation is not the recovery plan.

The work was also **not finished or healthy when interrupted**. Manifest storage validation landed before its production caller was migrated. A worker reported 79 failing tests after the coordinator stopped. A fresh recovery run reproduced that failure family and one additional browser assertion: **80 failed, 1,550 passed, one skipped**. The branch is not release-ready.

The host terminated the coordinator with a safety-system error. The visible record gives a category, not the particular action or reasoning that triggered it. The integration regression is established independently; there is no evidence that it caused the host decision.

The recovery assistant then compounded the disruption by repeatedly discussing an audit, saying it lacked prior context, and asking the user for the original prompt before checking recoverable local session files. Those records were present. That was an avoidable recovery failure.

## User intent and authorized work

The recovered user history belongs to coordinator session `01a07404-1d34-7de0-86c0-00962f101911`, titled “Review WorkerMill codebase.” The sequence was:

1. Review the WorkerMill codebase and assess whether investment is worthwhile and what the major gaps are.
2. Produce a comprehensive, decomposed plan suitable for lower-tier coding models and parallel agents, with token discipline.
3. Assign work to lower-tier models and coordinate it; the user then explicitly said to proceed.
4. After a progress question, continue delegation until wrapped up, updating useful repository docs rather than filling reference docs with retrospectives.
5. After the forced restart, audit the preceding 24 hours, document what happened and what remains, create a durable handoff, and add prevention instructions. The user subsequently requested refund guidance and challenged whether continuing was worthwhile.

The authorized reliability scope includes policy/isolation, cancellation, required gates and final-state verification, truthful run evidence, usage accounting, runtime testing, documentation, and qualification. Existing provider/model defaults and routing were to remain intact. This was not permission for a replacement architecture, server/frontend expansion, automatically paid evaluations, or publication/release activity. The plan defines 24 parent items and bounded suffix packages.

The current recovery work preserves that intent and documents the state. It does not automatically restart the remaining implementation backlog. The user's later request for a retrospective explicitly authorizes this document despite the earlier preference that ordinary product docs remain useful references.

## What the shutdown record establishes

At **2026-09-06 14:42:01 EDT / 18:42:01.964 UTC**, the coordinator's `task_complete` event recorded:

```text
This request was blocked by our safety systems. Reason: Potentially unintended activity.
codex_error_info: misalignment_policy_violation
last_agent_message: null
```

Source: coordinator rollout line 8363, preserved by location and excerpt in [historical evidence](2026-09-06-evidence.json).

This establishes that the run ended through a host safety block rather than a successful task completion. It does **not** establish which edit, command, delegation, or accumulated behavior triggered the block. The user had authorized substantial reliability changes. Treating the error category as proof that all of those changes were unsolicited would be unsupported. Likewise, attributing the block to context length, runtime duration, a particular model, or the manifest failure would be speculation.

The host did not provide a final coordinator handoff. Two already-dispatched workers produced results afterward: a qualification failure at 14:42:59 and R15b event-seam completion at 14:46:00. This is why inspecting only the coordinator's last message misses material state.

Official guidance checked during recovery explains that monitoring deliberately pauses or ends conversations over suspected instruction misinterpretation, and a flag does not prove an agent mistake. Some ended conversations cannot resume; supported paused chats may offer review and continuation. No personal setting guaranteeing uninterrupted execution was established. See [OpenAI's precautionary-stop explanation](https://help.openai.com/en/articles/20001509). The [API guidance](https://developers.openai.com/api/docs/guides/safety-checks/misalignment-monitoring) says to preserve records, review actions, and not automatically retry a blocked workflow. It also explains that stopping does not reverse prior actions. These sources explain the mechanism, not the undisclosed trigger in this session.

This restart created a different conversation (`01a07808-9458-7f51-9129-bda8d4ad2ed6`). The old transcript was not supplied in its active context, but remained on disk. That is context not carried into the new session, not demonstrated deletion of the old record. Normal saved-chat resume features do not establish that this particular blocked thread can be resumed. The handoff supports a reviewed continuation without depending on that possibility.

Local records span September 5 evening and September 6 afternoon. They do not establish eleven hours of continuous inference or the user's billable usage. The user's account of approximately eleven hours of personal effort is the impact report; repository timestamps are not a billing meter. No refund decision or refund submission was made by this assistant.

## Timeline of saved work

Times below are EDT. Where a commit was cherry-picked, its author date may precede integration. The inventory preserves both author and commit timestamps; the final sequence also uses tool completion events.

| Time | Evidence / action | Result |
| --- | --- | --- |
| Sep 5, about 20:30 | Initial review of baseline `9e317488` | Identified inconsistent permissions, blocking shell execution, weak completion guarantees, copied-logic tests, and unmeasured cost/quality claims. Initial isolated-state run reported 1,474 passes, six state-related failures, one skip. |
| Sep 5, 21:30 | `c2aff776` | Reliability plan and 24-item backlog established. |
| Sep 5, 21:33–23:56 | R01–R05a, R12, R14, R20a batches | Test-state isolation, process/path/policy foundations, blocking gates, reviewer identity helper, first fixture protocol. Historical combined suites passed after corrections. |
| Sep 6, 09:44–11:48 | R05b/c, R06–R10, R20b–e | Scoped sandbox/process integration; chat/headless/worker/planner/review adapters; isolated child behavior; twenty offline fixtures. |
| Sep 6, 12:01–13:09 | R13a–c | Typed gates, review outcomes, repository fingerprints, candidate/final-state enforcement and runtime tests. |
| Sep 6, 12:03–14:19 | R11 resource and caller packages | MCP/LSP ownership; chat/headless/orchestration cancellation; child administration; browser/HTTP cleanup; asynchronous startup/publication fixes. |
| Sep 6, 14:18:12 | Coordinator full-suite command completed | 1,706 passed, one skipped, 104 files; preceding typecheck/build passed. This is historical, before final storage/cleanup integration. |
| Sep 6, 14:19:52 | `bb271fcf` integrated | Additional startup branch-lifecycle tests. |
| Sep 6, 14:27–14:29 | Focused review checks | A standalone-review timeout and a test syntax error occurred. Syntax was corrected; isolated retry test subsequently passed. These were visible failures, not an all-green sequence. |
| Sep 6, 14:31:39–14:32:05 | `0452742a`, then `861008d9` | Scoped Git-context reads; R23 cleanup cherry-pick required a test conflict resolution. |
| Sep 6, 14:33–14:35 | `c397ad75`, `cc6aa8b8` | Preserve unverified recovery branch state; update reference docs and cleanup tracking. |
| Sep 6, 14:40:32 | `b1fec7fe`, `5aa6a940`, `22ba7d7c` integrated | Restore run-owned MCP coverage, add validated manifest storage, harden evidence validation. Existing orchestration writer was not migrated. |
| Sep 6, 14:41 | Read orchestration types/finalization; dispatch follow-ups | R15b adapter events and full integration qualification were underway. |
| Sep 6, 14:42:01 | Host safety block | Coordinator ended without a final message. |
| Sep 6, 14:42:59 | Worker qualification report | 79 failed, 1,551 passed, one skipped; typecheck/build passed. Worker identified the manifest caller/schema mismatch. |
| Sep 6, 14:45:49–14:46:00 | Worker commit `7aa8e089` and final report | R15b event seams saved outside core; focused tests and typecheck reported passing. Full finalizer/identity wiring not completed. |
| Sep 6, 14:52:12 | Fresh recovery suite started on core | 80 failed, 1,550 passed, one skipped; 18.45 seconds, exit 1. The additional failure is the browser discovery cancellation assertion. |

## Saved repository and worktree state

Repository: `/home/user/github/workermill`. This is the single-package TypeScript CLI published as `workermill`, version 1.1.1, not the historical multi-package WorkerMill application.

- Core HEAD: `22ba7d7c0d12dd9bed85586fcbf6f966030245c7` on `reliability/core`.
- Baseline, local `main`, and cached `origin/main`: `9e317488`. The audit did not fetch remotes, so cached refs are not a fresh remote-state assertion.
- Core changes since baseline: **163 paths; 17,514 insertions, 6,757 deletions; 146 commits**.
- All reachable refs in the inventory's 24-hour window: **230 commits touching 164 unique paths**. Cherry-picked copies are included in 230; this is not 230 independent features.
- **38 registered worktrees**. Core was clean before the recovery documents. Each other worktree had only its untracked `node_modules` symlink, not uncommitted source edits.
- No in-progress merge/cherry-pick/rebase directory was found in the core checkout at inspection.
- Runtime provider implementation files, routing files, and persona files were not changed in the baseline-to-core history inspected. `config.ts` changes added gate/reviewer/sandbox capability fields rather than changing model defaults.

The [inventory](2026-09-06-inventory.json) enumerates every core changed file with line counts and content hash, every recent-history path, all commits in the window, all worktree branches/HEADs/statuses, and the complete pre-recovery tracked Markdown inventory. A checkout's filesystem modification time is not proof of an authored edit; Git changes and clean/dirty worktree state are used to distinguish them. Dependencies, generated bundles, host databases, and unrelated repositories are not represented as authored WorkerMill source changes. This is a complete saved Git-state inventory for the stated scope, not a certification that every changed line is correct.

### Work not to lose or duplicate

`reliability/r15b` at `/home/user/github/workermill-r15b` contains **`7aa8e08929293456a21fe687696dbe17a4fc1368`**, not integrated into core. Its six changed files are `src/orchestrator/{execution,planning,review}.ts` and `src/__tests__/{worker-runtime-policy,planner-runtime-policy,review-runtime-policy}.test.ts`. It adds worker/revision attempt callbacks, review-round callbacks, and planner failure reasons. It does not implement the orchestration finalizer. Preserve and review this exact diff before replaying it.

`reliability/r23` at `/home/user/github/workermill-r23` has HEAD `8b279527`. Some `git cherry` entries look unintegrated because conflict resolution changed patch identity. The final production/test tree matches core. Its diff from core is only `docs/architecture.md` and `docs/reliability-queue.json`, where the worker branch lacks later coordinator documentation. Do not cherry-pick the apparent leftovers without comparing actual content.

R15a storage is already integrated as `5aa6a940` and `22ba7d7c`. R23 cleanup and coverage repair are already integrated as `861008d9` and `b1fec7fe`. All other inspected worker patch sets are represented in core. Preserve worktrees until reviewed; deleting them is unnecessary for recovery.

## What was implemented

The table records saved code and historical queue status. “Complete” means the previous queue marked the package complete with stated evidence; it is not a claim that current core passes or satisfies final release acceptance.

| Task | Implemented work and principal code | Recorded status / remaining limitation |
| --- | --- | --- |
| R01 | Temporary per-worker application state, setup/teardown fixtures | Complete; avoids ordinary tests writing to real WorkerMill state. |
| R02 | Asynchronous `engine/process-runner.ts`, bash lifecycle, bounded output and process-group cleanup | Complete; native Windows requires WSL. |
| R03 | Canonical `engine/path-policy.ts`, grants, path-bearing tools and patch validation | Complete; path policy is not arbitrary-shell/TOCTOU containment. |
| R04 | Shared `tool-policy.ts` / `tool-executor.ts`, permission ordering and mutation ownership | Complete; production runtime acceptance remains part of final qualification. |
| R05a–c | Verify/gates/background/registry process adapters, scoped sandbox lease, explicit capabilities | Complete; explicit OS support and real containment are environment-sensitive. |
| R06 | Interactive chat shared-policy adapter, mounted prompt and cancellation tests | Complete in queue. |
| R07 | Headless policy, structured terminal result/CLI exits and cleanup | Complete in queue; installed-package qualification is still R17. |
| R08 | Worker shared-policy execution, required commands, narrow approval scope | Complete in queue. |
| R09a/b | Planner/critic/read-only role policy; reviewer and mutating revision adapters | Complete in queue. |
| R10 | Child worktree/path/process policy, inherited cancellation, preserved changed work | Complete; shared Git metadata and path-only limitations are documented. |
| R11r/s/a/b/t/u | Owned MCP/LSP/browser/HTTP resources, chat/headless/orchestration cancellation, awaited child/startup/publication cleanup | Complete in queue; recovery run found an additional browser fixture assertion failure needing diagnosis. |
| R12 | Immediate blocking gate exits before publication | Complete in queue. |
| R13a/b/c | Typed required/advisory gates; structured review; async fingerprints; candidate and final-state verification | Complete in queue; manifest failure now prevents many runtime scenarios reaching completion. |
| R14 | Reviewer binding identity comparison and configurable requirement, settings/schema support | Helper complete; enforcement at orchestration startup remains R15b. |
| R15a | Versioned active/terminal manifests, validated loading, atomic replacement, legacy reader limits | Integrated, unqualified with current caller. |
| R15b | Attempt/review event seams on worker branch | Partial, unintegrated; finalizer, complete evidence persistence and preflight remain. |
| R20a–e | Twenty deterministic bug-fix/feature/refactor/maintenance/security fixtures and acceptance protocol | Complete in queue; no model-based comparison or measured product-quality claim established. |
| R23 | Remove obsolete permission/concurrency/Git paths; migrate/recover MCP tests | Integrated, pending successful combined qualification and coverage reconciliation. |

### Documentation located and changed

All **32 tracked Markdown files** are indexed by path/hash in the inventory. They include top-level project/contributor/security/changelog/conduct/agent guidance; the documentation index and eleven other `docs/*.md` files; `evals/README.md`; eleven personas; and three GitHub issue/PR templates.

Thirteen Markdown files changed from baseline: `AGENTS.md`, `CONTRIBUTING.md`, `README.md`, `SECURITY.md`, `docs/architecture.md`, `docs/commands.md`, `docs/configuration.md`, `docs/contributing.md`, `docs/quality-gates.md`, `docs/recipes.md`, `docs/reliability-plan.md`, `docs/troubleshooting.md`, and `evals/README.md`. The machine-readable `docs/reliability-queue.json` was also added. Reference updates explain permission/isolation limits, required/advisory gates, cancellation, recovery, supported Node versions, and the absence of measured reviewer/cost claims. `CHANGELOG.md` and CI qualification did not receive the final R22/R17 work.

The existing plan and queue preserve substantial implementation context. They were insufficient as a restart handoff because they did not capture the final broken integration, late worker commit, exact current test result, or immediate repair action. The new root handoff and these incident artifacts fill that gap without converting ordinary user reference pages into chronological logs.

## Concrete defects and management failures

### 1. Incompatible manifest contract was integrated

`createRunManifest` initializes `phase: "active"` and `outcome: "in_progress"` (`src/run-manifest.ts:125`). Its new validator correctly rejects active records with terminal fields (`:102`). The unchanged writer sets `completedAt` and terminal `outcome`, then calls `saveRunManifest` while phase remains active and terminal reason remains absent (`src/orchestrator.ts:806–828`). The validator throws at `src/run-manifest.ts:144`.

This is a production integration defect, not just a test expectation change. The coordinator integrated a breaking producer/consumer contract in separate pieces without first preserving a usable combined branch. R15's scope already called for caller migration and a central finalizer; those requirements were not complete at interruption.

Fix direction for a future implementation task: wire truthful active/progress/terminal persistence, including early exits and cleanup failures, and connect the saved event seams and identity preflight. Merely adding `phase = "terminal"`, suppressing the exception, or relaxing validation would leave required outcome/freshness/retry evidence unfinished.

### 2. Additional browser cancellation assertion failed

The fresh full run failed `browser resources > bounds slow/oversized discovery and rejects a non-private endpoint` at `src/__tests__/browser.test.ts:190`: `expected "vi.fn()" to be called at least once` for `oversizedCancelled`. The previous worker's 79-failure run did not report it. This audit has not established whether it is a race, environment-sensitive fixture, or production regression. Preserve it as an unresolved failure; do not relabel it harmless or delete it.

### 3. Historical green evidence was not sufficient for final state

The 1,706-pass result predates storage integration and cleanup. After R23, the suite contains 1,631 tests rather than 1,707, reflecting test removal/replacement plus intervening additions. A lower count alone proves neither improved testing nor lost meaningful coverage. R23 removed obsolete tests and then restored run-owned MCP coverage; final qualification must map important removed behaviors to surviving production-path tests.

The prior coordinator did dispatch a final qualification run, and the worker honestly reported failure. The evidence does not show a final claim that the broken HEAD was green. The failure is leaving an incompatible branch plus stale durable status at interruption, not proven fabrication of that final run.

### 4. Completion state and delegation ownership were not durable enough

The queue still describes R15a as in progress despite its integration, omits the new R15b worker state, and cannot explain the late qualification failure. There was no root restart file that assembled these facts. The coordinator's interruption did not prevent already-running workers from producing later results; there was no final reconciliation before the session disappeared.

The recovered metadata identifies 32 child threads over the project (12 recorded as `gpt-5.6-luna`, 20 as `gpt-5.6-terra`) and 38 worktrees, with follow-up tasks reusing workers. Those totals are not concurrent-agent counts. Available counters were not used as a trustworthy billing total, and this audit cannot establish actual dollars or compliance with the user's intended token economy. The plan's small-package discipline should have kept exact scope, ownership, retries, and evidence easy to recover.

### 5. Communication and recovery failed the user

Prior progress messages sometimes had multi-minute gaps, including an approximately eleven-minute gap between 14:29 and 14:40. Long-running work needs frequent concise updates and disk checkpoints. Repeated assurances that the next package is nearly ready do not substitute for a saved state report.

In the restart session, the assistant repeatedly apologized or proposed an investigation instead of first recovering available evidence. It asked for the original prompt even though local history contained it, and suggested the user needed to supply context that the assistant could inspect. It also ended a response with the retrospective and instructions still unfinished. These are confirmed failures in handling the recovery request. They unnecessarily increased the user's effort and uncertainty.

## Validation evidence and its limits

| Evidence | Environment / revision | Result |
| --- | --- | --- |
| Historical integrated unit suite | Prior coordinator, before final R15/R23 integration | 1,706 passed, one skipped; exit 0. Applies to that earlier tree only. |
| Final worker qualification | Post-integration core, reported after host block | 1,551 passed, 79 failed, one skipped; typecheck/build passed. |
| Fresh recovery typecheck | Node 22.22.2, core `22ba7d7c`, implementation unchanged | Exit 0. |
| Fresh recovery unit attempt under outer sandbox | Same source, restricted process/local-server environment | Stalled with numerous fixture failures; interrupted, exit 130. Not used as the product failure count. |
| Fresh recovery full unit run through approved escalation | Node 22.22.2, core `22ba7d7c`; `timeout 120s npm test` | Exit 1; 4 failed/102 passed test files; 80 failed/1,550 passed/1 skipped tests; duration 18.45 seconds. |
| Fresh build / installed package / paid E2E | Not run in this documentation recovery | Historical worker build is evidence only; R17/R24 and live evaluation remain unqualified. |

The fresh 80 failures comprise the manifest failure family (79 test failures across orchestration/startup/final-evidence suites) and one browser assertion. Raw output can group failures, so error-message occurrence count is not itself the failed-test count. See [recovery validation](2026-09-06-validation.json) for durable exact summaries and failure excerpts. Temporary full output is additionally available at `/tmp/workermill-recovery-audit/unit-tests-unsandboxed.log` while that directory survives.

No new live-provider calls, paid benchmarks, user configuration changes, source fixes, branch resets, or worktree deletions were performed by the recovery task. Existing offline tests exercised their normal temporary fixtures. Remote refs were not refreshed and no hosted PR/release state was asserted.

## Remaining work and resumption sequence

The 24-parent queue has **15 marked complete (R01–R14 and R20), two in progress (R15 and R23), and seven not marked complete**. This must not be converted into a percentage of elapsed effort or an eleven-hour estimate.

| Remaining item | Concrete deliverable | Dependency / stopping condition |
| --- | --- | --- |
| Immediate integration repair | Reconcile R15 storage and caller; inspect preserved `7aa8e089`; diagnose browser failure | One bounded change and named tests first; no unrelated feature dispatch while core remains broken. |
| R15 | Start/progress/terminal persistence, actual attempts/bindings, early failure/cancellation, retry lineage, reviewer identity preflight | Correct terminal records for every exit; final completion policy agrees with persisted evidence. |
| R23 qualification | Confirm superseded runtime removal and meaningful coverage replacements | Combined tree typecheck/unit checks pass with failures/skips explained. |
| R16a–c | Real installed SDK scripted-model fixture, actual runtime governance/lifecycle/resume/child tests, remaining mirrored-test removal | After R15/R23; unexpected model calls fail; no network/keys. |
| R18a–c | Per-call usage ledger, failed/child/compaction/role usage exactly once, unknown pricing, aligned summaries | After R15/R23; coordinate R16 usage assertions and avoid overlapping adapter writes. |
| R17 | Offline packed CLI, installed assets, PTY cancellation, supported Node/platform CI matrix | Depends on R16; actual OS qualification on supported hosts. |
| R22 | Final accurate user docs, onboarding, migration notes/changelog | Match implemented R15/R17/R18 guarantees; no fabricated benchmarks. |
| R24 | Exact-revision release-candidate review and complete deterministic qualification | No open high-severity finding, explicit skips/limitations; no automatic release. |
| R19 (optional) | Estimated execution budgets with documented overshoot | After ledger and lifecycle work; not required for first release. |
| R21 (optional) | Comparison harness, fake dry run and evidence report | R20 fixtures exist; actual paid study needs separately specified authorization and budget. |

There is no evidence-based remaining-time estimate yet. The first decision point is the bounded integration repair and full qualification, not repeating earlier foundations or promising another unbounded run. A different agent or human can take that task from [HANDOFF.md](../../HANDOFF.md) without reconstructing the chat.

## Prevention and accountability

The root [AGENTS.md](../../AGENTS.md) now requires a restart read of `HANDOFF.md`; scope and ownership recorded before dispatch; checkpoints after each integration/failure and at least every 15 minutes; meaningful progress updates; complete producer/consumer integration; no downstream feature expansion on a red branch; exact-revision test evidence; and late-worker reconciliation. It prohibits manufacturing green results by weakening validation or tests and prohibits bypassing host safety controls.

These are operational instructions, not a technical guarantee that the platform will never stop. They reduce the amount of unrecoverable context and make failures visible early. Their effectiveness depends on the next operator following them. A forced stop between checkpoints can still leave in-flight work; the handoff therefore identifies branches and worker commits, not just prose intentions.

Future checkpoints should answer: what is authorized now, what commit was tested, what is dirty, who owns each active file, what failed, what remains unintegrated, and what one step happens next. Do not rely on the user to remember those facts. Do not claim the project is wrapped up until the final acceptance matrix is actually satisfied.

## Evidence locations and portability

- [HANDOFF.md](../../HANDOFF.md): live restart entry point and next actions.
- [Inventory](2026-09-06-inventory.json): captured Git/worktree/document inventory, with exact scope/window and hashes.
- [Historical evidence](2026-09-06-evidence.json): selected public reports, visible termination error, and historical validation summaries with source line numbers.
- [Recovery validation](2026-09-06-validation.json): newly observed test results and exact failures.
- [Plan](../reliability-plan.md) and [queue](../reliability-queue.json): original acceptance contracts and historical progress.
- Coordinator local rollout: `/home/user/.codex/sessions/2026/09/05/rollout-2026-09-05T20-00-21-01a07404-1d34-7de0-86c0-00962f101911.jsonl`.
- R15b worker rollout: `/home/user/.codex/sessions/2026/09/06/rollout-2026-09-06T13-26-13-01a077c1-a23c-7bf3-8482-92a0a10a9598.jsonl`.
- Final qualification worker rollout: `/home/user/.codex/sessions/2026/09/06/rollout-2026-09-06T13-26-38-01a077c2-00f4-7f22-9a9f-54c346e930e4.jsonl`.

Full host transcripts/databases are not copied into the repo; the report preserves the required facts without credentials, private tool payloads, or hidden reasoning. Local files survive this conversation restart, but they are not an off-machine backup. No claim of remote backup is made.

## Recovery deliverable status

The retrospective, root handoff, inventory, historical evidence, fresh validation evidence, and continuity instructions have been written locally. `AGENTS.md` and the docs index link the recovery entry points. The queue includes a recovery snapshot so historical completed-task entries cannot be mistaken for current qualification. Implementation source remains at `22ba7d7c`; the known runtime failures are documented and unfixed. No new implementation batch is active.

Final documentation verification: 32 documentation/hook tests passed (exit 0); local Markdown links, JSON parsing, and `git diff --check` passed. This does not change the failed implementation qualification.

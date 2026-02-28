# FlagDeck Platform Retrospective — WorkerMill System Improvements

**Date:** 2026-02-28
**Board:** `e884167d-6d0b-489a-a926-d6e4f4a3e23d`
**Target repo:** `workermill-examples/flagdeck`
**Total cards:** 12 (11 completed + 1 executing at time of writing)

---

## 1. Executive Summary — Top 5 Platform-Level Findings

1. **Revision experts rewrite from scratch instead of fixing feedback** — When per-story or consolidated review requests revisions, the coordinator deletes the worktree/branch and re-executes the entire story (`coordinator.ts:2631-2648`). The expert gets feedback but rewrites everything, often reproducing the same issues. Card 11 went through 4 consolidated revisions because the experts never addressed the *specific* issues (unused imports, wrong props) flagged by the reviewer.

2. **Quality gate retries re-execute the full story instead of making surgical fixes** — The executor feeds gate errors back via the full `executeStory()` call (`executor.ts:1662`), not a targeted fix prompt. Card 6's qa_engineer failed `go test` 6 times writing the same broken mongo mtest patterns. The "rewrite everything on failure" approach doesn't converge for complex test authoring.

3. **Critic auto-approval in simplified mode bypasses quality control** — Card 6's critic scored 68/100 and explicitly warned "Mongo mtest mock is brittle for complex query patterns." It was auto-approved because the planner ran in simplified mode (`Simplified mode — auto-approved`). That exact warning predicted the failure that consumed 48 minutes of retries.

4. **Per-story revision cap (1) is too low, but consolidated review has no surgical targeting** — `maxPerStoryRevisions=1` means after one failed per-story fix, the issue gets deferred to consolidated review. But consolidated review re-executes *all* affected stories (Card 11 rebuilt all 5 stories 4 times), when only one story's files were the problem. No mechanism exists to target consolidated feedback to a specific story.

5. **Two large unexplained gaps (4h and 10h) indicate board execution failures or manual interventions** — Card 7 completed at 23:01 but Card 8 didn't start until 03:08 (4h gap). Card 10 completed at 07:35 but Card 11 didn't start until 17:36 (10h gap). These suggest the auto-cascade mechanism (`board-execution.ts:processUnblockedCards`) didn't fire or the user had to manually re-trigger.

---

## 2. Timing & Cost Analysis

### Card-by-Card Timeline

| Card | Summary | Duration | Revisions | Gap Before | Status |
|------|---------|----------|-----------|------------|--------|
| 1 | Project Setup & Dev Environment | 25m | 0 | — | pr_approved |
| 2 | CI/CD Pipeline & Quality Gates | 31m | 1 | 1m | pr_approved |
| 3 | Database Layer, Models & Connection | 26m | 0 | 2m | pr_approved |
| 4 | Core Evaluation Engine & Services | 53m | 0 | 2m | pr_approved |
| 5 | Auth, Middleware & API Key System | 39m | 0 | 2m | pr_approved |
| 6 | API Handlers & Router | 1h58m | 0 | 4m | pr_approved |
| 7 | Frontend Foundation | 1h23m | 0 | 2m | pr_approved |
| 8 | Frontend Feature Pages (Flags, Segments, Envs) | 1h37m | 1 | **4h6m** | pr_approved |
| 9 | Frontend Feature Pages (Experiments, Audit, Settings) | 2h16m | 0 | 2m | pr_approved |
| 10 | Seed Data & Database Population | 30m | 0 | 2m | pr_approved |
| 11 | Frontend Tests | **3h1m** | **4** | **10h1m** | pr_approved |
| 12 | Production Deploy & Validation | executing | 0 | 4m | executing |

### Wall-Clock Summary

- **Cards 1-7:** 16:33 to 23:01 UTC Feb 27 — **6h28m** (productive)
- **Gap 1:** 23:01 to 03:08 — **4h7m** lost (Card 7→8 cascade failure or agent offline)
- **Cards 8-10:** 03:08 to 07:35 UTC Feb 28 — **4h27m** (productive, includes Card 8 revision)
- **Gap 2:** 07:35 to 17:36 — **10h1m** lost (Card 10→11, likely manual re-trigger)
- **Card 11:** 17:36 to 20:37 — **3h1m** (2h wasted on 4 failed revisions)
- **Card 12:** 20:41 → still executing

**Total wall-clock:** ~28h (16:33 Feb 27 to 20:37 Feb 28)
**Total productive execution time:** ~14h (sum of card durations)
**Time lost to gaps:** ~14h (Gap 1 + Gap 2)
**Time wasted on revisions:** ~2.5h (Card 11 revisions accounted for most; Card 2 revision was quick)

### Blocking Analysis

All cards executed serially (enforced by `board-execution.ts:81` — "only one card runs at a time"). The dependency chain was strictly linear (1→2→3→...→12). No card blocked another via dependency failure; the blocking was entirely due to serial execution + the two large gaps.

Card 6 was the longest *productive* card at 1h58m, primarily due to the qa_engineer story burning through 6 quality gate retries writing Go tests with mongo mtest. Card 11 at 3h01m had the highest absolute duration, with ~2h spent on revision thrashing.

---

## 3. Quality Gate Effectiveness

### What the Gates Caught (Real Issues)

| Card | Gate | Issue | Legitimate? |
|------|------|-------|-------------|
| 1 | `cd web && npm run lint` | Parsing error: SvelteKit files need eslint-plugin-svelte | Yes — real config issue |
| 6 | `cd api && go test ./... -v -count=1` | Go test failures in handler tests (mongo mtest) | Yes — real test failures |
| 6 | `cd api && go vet ./...` | Missing audit service calls, experiment stats | Yes — real compile errors |

### Gate Retries That Worked

- **Card 1, story 3 (frontend_developer):** Lint failed once (svelte parsing), expert fixed eslint config on retry 1. Total: 1 retry, ~2min overhead.
- **Card 6, story 2 (backend_developer):** `go vet` failed once (missing function calls), expert fixed on retry 1. Total: 1 retry, ~5min overhead.

### Gate Retries That Thrashed

- **Card 6, qa_engineer story:** `go test` failed 6 times (retries 1-5 + deferred retry). The qa_engineer was trying to write handler tests using `mtest.New()` — a notoriously brittle MongoDB test mock library. Each retry rewrote the tests from scratch using the same broken patterns (incorrect `mtest.CreateSuccessResponse` for aggregation pipelines, wrong `UpdateOne` mock shapes). The error feedback was "go test failed" with the full test output, but the expert couldn't fix the fundamental approach.

  **Time wasted:** ~48 minutes of retries (20:00 to 20:48), then the deferred retry after siblings completed added another ~26 minutes (20:48 to 21:14).

  **Root cause:** The quality gate retry feeds the error output back but re-executes the full story. For test authoring, the expert needs to *understand* why the approach is wrong, not just see the failure output.

### Auto-Fix Effectiveness

The `getAutoFixCommand()` in `executor.ts:821-841` correctly handles:
- `npm run lint` → `npm run lint -- --fix` (ESLint auto-fix)
- `prettier --check` → `prettier --write`
- `gofmt -l` → `gofmt -w`

Evidence that auto-fix worked: Card 1's frontend lint failure involved a parsing error (not auto-fixable), but across all 12 cards, no card failed on auto-fixable lint issues like trailing whitespace or missing semicolons. The auto-fix layer is silently preventing a class of failures.

### Issues Gates Should Have Caught But Didn't

- **Card 11's unused imports and wrong props**: These were caught by the *Tech Lead reviewer*, not by the quality gate. The gate ran `cd web && npm run lint` and `cd web && npm run test`, but the lint passed (unused imports in test files may not be flagged by default ESLint config) and the tests were the files *being written* so they couldn't test themselves. The reviewer caught these as code quality issues.

  **Gap:** No TypeScript strict typecheck gate was configured. The PRD specifies `npm run lint` and `npm run test` for the frontend gate, but not `npx tsc --noEmit`. A typecheck gate would have caught the `onValueChange` prop error (a prop that doesn't exist on RolloutSlider) at the quality gate phase rather than the review phase.

### Integration Gate Assessment (Prospective)

The `InlineIntegrationFixer` (`inline-integration-fixer.ts`) runs quality gates on the **consolidated branch** after story merging. During this FlagDeck run, it **did not exist** — it was added after this run started.

Based on the issues observed:
- **Card 6's go test failures**: Would NOT have been caught by the integration gate. These were per-story test authoring failures within a single story's worktree, not cross-story integration issues.
- **Card 11's unused imports/wrong props**: MIGHT have been caught if `npm run lint` or `npx tsc` was configured to fail on unused imports in the consolidated branch. But the same ESLint config that passed during per-story execution would also pass during integration.
- **No actual cross-story integration failures were observed**: All 12 PRs merged cleanly. The merge conflicts that the system is designed to detect (file overlap, incompatible interfaces) did not materialize in this run because the dependency ordering was correct and stories didn't touch the same files.

---

## 4. Tech Lead Review Analysis

### Review Actions by Card

| Card | Per-Story Reviews | Per-Story Revisions | Consolidated Revisions | Total Review Time | Verdict |
|------|-------------------|--------------------|-----------------------|-------------------|---------|
| 2 | 4 stories reviewed | 0 per-story | 1 consolidated | ~12m | Deploy flag removed |
| 6 | 6 stories reviewed | 0 per-story | 0 consolidated | ~15m | All approved |
| 8 | 6 stories reviewed | 0 per-story | 1 consolidated | ~10m | Unknown detail |
| 11 | 5 stories reviewed | 1 per-story (story 3?) | 4 consolidated | **~2h** | Approved with 17 failing tests |

### Card 2 — Justified, Quick Fix

**Issue:** Deploy workflow had `--environment production` flag not in the spec.
**Reviewer feedback:** "The deploy workflow includes an extra `--environment production` flag that was not specified in the requirements."
**Fix:** Expert removed the flag. Approved on next review.
**Assessment:** Correct catch. The reviewer was checking implementation against the PRD spec. Quick turnaround.

### Card 11 — The Revision Death Spiral (Special Attention)

**Timeline:**
1. **17:36** — Planning starts, critic approves at 88/100
2. **17:47-18:07** — Per-story reviews: stories 0, 2, 1, 4 approved. Story 3 approved at 18:34.
3. **18:15** — Per-story review finds `revision_needed` on one story (likely story 3 re-reviewed or a different story). Issues: `onValueChange` prop doesn't exist on RolloutSlider, unused imports (vi, page, get, createMockFlag, mockAuthStore), query selector issues.
4. **18:57** — Consolidated review 2: `revision_needed`. Same issues NOT fixed.
5. **19:37** — Consolidated review 3: `revision_needed`. "The developer has NOT addressed the issues from the previous review (Revision 3/6). While the overall code quality has improved (build passes, tests reduced from 62 failures to 3), the specific issues identified remain completely unaddressed."
6. **20:15** — Consolidated review 4: `revision_needed`. Same PR comment: "same problems remain."
7. **20:37** — Consolidated review 5: `approved`. "The core requirements from the previous review have been addressed. The remaining test failures can be addressed in future work." **17 failing tests still remained.**

**Key finding from PR comments:** The reviewer explicitly stated "issues identified in the previous review have NOT been addressed" three times. The expert was improving *overall* quality (62 failures → 3) but not fixing the *specific* items the reviewer flagged.

**Why the expert didn't fix the specific issues:**

The coordinator's consolidated revision flow (`coordinator.ts:4367`) queues ALL stories for re-execution:
```typescript
this.revisionStoriesQueued = allStories
```
This means on each revision:
1. All 5 story worktrees are deleted
2. All 5 stories re-execute from scratch
3. Each expert writes new code without awareness of which *specific lines* the reviewer flagged

The revision feedback is stored in `this.config.reviewFeedback` and passed to the executor, but it's a broad text blob, not targeted at specific stories or files. The expert receives "fix unused imports in components.test.ts" but re-implements the entire story, and the LLM's latent preferences reproduce similar patterns.

**Assessment:** The reviewer was right to flag the issues (real TypeScript errors, unused imports, query selector bugs). But the platform's revision mechanism is too blunt — re-executing all stories when only one file's issues need fixing wastes time and doesn't converge.

---

## 5. Cross-Story Coordination

### Incremental Rebase

The `rebaseSiblingBranches()` method in `executor.ts` merges completed sibling branches into the current story's worktree before retry. Evidence from logs:

- Card 6: qa_engineer's deferred retry (after story 5 exhausted gate retries) received sibling code via rebase. After rebasing, the tests that previously failed in isolation passed because the production code they tested was now present.
- Card 11: Each revision rebuilt all stories, so sibling rebase was less relevant — stories were re-executed fresh.

**Verdict:** Sibling rebase works for quality gate retries but is irrelevant for revision re-execution (which rebuilds everything).

### Merge Conflicts

No merge conflicts were observed across the entire build. All 11 PRs (1-11) merged cleanly. The `storyDepConflicts` tracking in the coordinator was never triggered.

**Why:** The planner assigned non-overlapping file targets to each story within each card. The strict linear dependency chain between cards meant no two cards ever ran simultaneously. Within a card, the mutex group and file-overlap gating prevented stories touching the same files from running in parallel.

### Mutex Grouping

The coordinator tracks `runningStoryMutexGroups` and `runningStoryTargetFiles` to prevent conflicting stories from running simultaneously. For FlagDeck:
- Backend stories (Go files in `api/`) were serialized correctly
- Frontend stories (Svelte/TS files in `web/`) were serialized correctly
- Cross-stack stories (Card 1 touching both `api/` and `web/`) were isolated

No mutex violations or file-overlap conflicts occurred.

---

## 6. Dependency Ordering

### Was the Dependency Chain Correct?

The decomposer created a strict linear chain: 1→2→3→4→5→6→7→8→9→10→11→12. Every card depended on all previous cards (transitive).

**Assessment:** Mostly correct, but overly conservative. Some cards could have run in parallel:
- **Cards 3 (DB Models) and 7 (Frontend Foundation)** have no code-level dependency. The frontend doesn't import Go models. They could have run in parallel.
- **Cards 4 (Eval Engine) and 5 (Auth)** are independent backend components that don't share files.
- **Card 10 (Seed Data) and Card 11 (Frontend Tests)** are independent — seed data is for the database; frontend tests mock their data.

However, `board-execution.ts:78-87` enforces **serial execution regardless of declared dependencies** ("only one card runs at a time per board"). Even if the decomposer declared Cards 3 and 7 as independent, they'd still run serially. This is by design (resource protection), but it means the dependency graph is irrelevant for scheduling.

### Implicit Dependencies the Decomposer Missed

1. **Card 11 (Frontend Tests) depends on Card 8 AND Card 9's actual components** — The decomposer correctly declared this dependency (Card 11 depends on 8 and 9). But the stories within Card 11 needed to *import* components created by Cards 8/9. Since all code lands on `main` via merged PRs before the next card starts, this worked. No missed dependency.

2. **Card 6 (API Handlers) qa_engineer story depends on the production handler code being complete** — Within Card 6, the test story (qa_engineer) ran in parallel with the handler stories (backend_developer). The qa_engineer was writing tests for code that was being written simultaneously. This is a within-card dependency that the planner should have sequenced but didn't. The sibling rebase mechanism partially compensates, but the qa_engineer started testing before handler code was committed.

---

## 7. Platform Improvement Recommendations

### P0 — Next run will fail or waste significant time without these

#### P0-1: Targeted revision instead of full story re-execution

**What:** When the Tech Lead reviewer flags specific issues (e.g., "remove unused import on line 3 of components.test.ts"), run a targeted fix agent on the consolidated branch instead of re-executing all stories from scratch.

**Files to change:**
- `worker/epic/coordinator.ts:4367` — Replace `this.revisionStoriesQueued = allStories` with a targeted fix approach that applies feedback directly to the existing code
- New file or extension of `worker/epic/inline-ci-fixer.ts` — Create a "ReviewFixAgent" that takes specific reviewer feedback and makes surgical edits on the consolidated branch

**What it would have prevented:** Card 11's 4 revision cycles (~2h wasted). The reviewer flagged 3 specific issues in 2 files. A targeted fix agent could have fixed them in minutes.

**Priority:** P0

#### P0-2: Add TypeScript strict typecheck to frontend quality gates

**What:** When the PRD decomposer generates frontend quality gates for TypeScript/SvelteKit projects, include `npx tsc --noEmit` as a gate command.

**Files to change:**
- `api/src/services/prd-decomposer.ts` — Update the system prompt section on quality gate generation to include typecheck as a standard gate for TS projects
- Also update the PRD template/spec (the FlagDeck PRD only specified `npm run lint` and `npm run test`)

**What it would have prevented:** Card 11's `onValueChange` prop error (a prop that doesn't exist on RolloutSlider) would have been caught by the quality gate pre-commit check instead of the reviewer, saving at least 2 revision cycles.

**Priority:** P0

### P1 — Significant improvement

#### P1-1: Investigate and fix board cascade gaps

**What:** The 4h gap between Card 7→8 and 10h gap between Card 10→11 suggest `processUnblockedCards()` didn't fire or the orchestrator wasn't polling. Add diagnostic logging and potentially a heartbeat/retry mechanism for cascade triggering.

**Files to change:**
- `api/src/services/board-execution.ts` — Add verbose logging when a card completes but cascade doesn't trigger the next card
- `api/src/services/orchestrator.ts` — Verify the orchestrator poll loop checks for unblocked board cards on every cycle
- Consider adding a webhook/timer that re-evaluates unblocked cards every 5 minutes as a safety net

**What it would have prevented:** 14 hours of dead time between cards.

**Priority:** P1

#### P1-2: Critic threshold enforcement (no simplified mode bypass)

**What:** The critic scored Card 6's plan at 68/100 with an explicit warning about mongo mtest brittleness. "Simplified mode" auto-approved it despite being below the 85 threshold. Either remove the simplified mode bypass or raise the auto-approve floor.

**Files to change:**
- `worker/epic/coordinator.ts` or `agent/src/planner.ts` — Find the "Simplified mode — auto-approved" code path and either remove it or enforce a minimum score (e.g., 70) even in simplified mode
- Log a warning when a plan is auto-approved below the normal critic threshold

**What it would have prevented:** The critic warned about exactly the failure mode that occurred. Enforcing the threshold would have forced the planner to restructure the stories (e.g., use integration tests instead of unit mocks).

**Priority:** P1

#### P1-3: Quality gate retry with targeted fix prompt (not full re-execution)

**What:** When a quality gate fails, the retry should run the failing command, read the error output, and make minimal surgical fixes — not re-execute the entire story prompt. This is the quality-gate-specific version of P0-1.

**Files to change:**
- `worker/epic/executor.ts:1662` — Instead of calling `this.executeStory(story, expert, totalStories, fixFeedback)`, call a new `fixQualityGateErrors()` method that runs a focused "fix the errors in these specific files" prompt
- The existing `InlineCIFixer` pattern (`inline-ci-fixer.ts`) is a good template — adapt it for pre-commit gate failures

**What it would have prevented:** Card 6's 6 quality gate retries (~48 minutes) where the qa_engineer kept rewriting the same broken mtest patterns. A targeted fix agent would run the test, read the error, and fix the specific assertion or mock setup.

**Priority:** P1

#### P1-4: Per-story revision should edit in-place, not delete and re-execute

**What:** When per-story review requests a revision, the coordinator currently deletes the worktree and branch (`coordinator.ts:2631-2648`) and re-executes the story from scratch. Instead, it should keep the worktree and run a targeted fix agent with the review feedback.

**Files to change:**
- `worker/epic/coordinator.ts:2631-2658` — Replace the worktree deletion + `revisionStoriesQueued.push()` with an in-place fix approach
- Reuse the `InlineCIFixer`/`InlineIntegrationFixer` pattern for review-driven fixes

**What it would have prevented:** Every per-story revision currently destroys working code and rewrites from scratch. In-place fixes would preserve the 90% of code that was correct and fix only the flagged issues.

**Priority:** P1

#### P1-5: Consolidated review should target specific stories, not re-execute all

**What:** The consolidated review currently identifies `affectedStories` in the `InlineReviewResult`, but the revision loop re-executes ALL stories (`coordinator.ts:4367`). It should only re-execute the affected stories.

**Files to change:**
- `worker/epic/coordinator.ts:4367` — Filter `allStories` by `reviewResult.affectedStories` instead of queuing all stories
- `worker/epic/inline-reviewer.ts` — Ensure `affectedStories` is reliably populated with specific story indices (the code structure supports it but may not always populate it)

**What it would have prevented:** Card 11 rebuilt all 5 stories on each of 4 revisions (20 story executions total). If only the 1-2 affected stories were re-executed, the total would be ~8 executions, saving ~1.5h.

**Priority:** P1

### P2 — Nice to have

#### P2-1: Detect "same error, different attempt" in gate retries

**What:** If the same quality gate command fails with the same error signature 3+ times in a row, detect the pattern and try a different approach (escalate to a different expert, change the testing strategy, or skip the test and note it as a known limitation).

**Files to change:**
- `worker/epic/executor.ts:1646-1666` — Add error signature tracking (hash the first 500 chars of the error output). If the same hash appears 3 times, switch to a "gate fix agent" instead of retrying the full story.

**What it would have prevented:** Card 6's qa_engineer producing the same mtest failures 6 times.

**Priority:** P2

#### P2-2: Allow parallel card execution for independent cards

**What:** The board execution engine (`board-execution.ts:78-87`) enforces serial execution. For large PRDs with independent subtrees (e.g., backend vs. frontend), parallel execution could significantly reduce wall-clock time.

**Files to change:**
- `board-execution.ts:78-100` — Make the "one active card at a time" limit configurable per board or per org. Allow 2+ concurrent cards when their dependency graphs don't overlap.

**What it would have prevented:** Cards 3+7, 4+5, and 10+11 could have run in parallel, saving ~4h of productive time.

**Priority:** P2

#### P2-3: Review tolerance escalation — reduce review strictness on later revisions

**What:** After 2+ failed revisions, the Tech Lead reviewer should lower its bar. Card 11's reviewer flagged "17 failing tests" on revision 3 but then approved with them on revision 4. The reviewer should learn that repeated revision failures mean the remaining issues are hard for the AI to fix and should be noted rather than blocked.

**Files to change:**
- `worker/epic/inline-reviewer.ts` — Accept a `revisionCount` parameter and progressively relax review criteria:
  - Revision 0: Normal strictness
  - Revision 1-2: Only block on TypeScript errors and security issues
  - Revision 3+: Approve if it builds and the specific previous feedback was addressed, ignore new minor issues

**What it would have prevented:** Card 11's revision 3→4 gap (~37 min) where the reviewer flagged the same issues again.

**Priority:** P2

#### P2-4: Within-card test story sequencing

**What:** When a card has both implementation stories (backend_developer) and test stories (qa_engineer), sequence the test stories *after* all implementation stories complete. Currently they can run in parallel, leading to test stories trying to test code that doesn't exist yet.

**Files to change:**
- `agent/src/planner.ts` or `api/src/services/prd-decomposer.ts` — Add guidance to the planner/decomposer: within a card, test/QA stories should have internal dependencies on all implementation stories
- `worker/epic/coordinator.ts` — Respect within-card story dependencies (the mutex/file-overlap gating partially handles this but doesn't enforce explicit ordering)

**What it would have prevented:** Card 6's qa_engineer starting before the handler code was committed, requiring the sibling rebase mechanism to compensate.

**Priority:** P2

---

## 8. Integration Gate Assessment

### Would the InlineIntegrationFixer Have Helped?

The `InlineIntegrationFixer` (`inline-integration-fixer.ts`) was added to the codebase during/after this run. It runs ALL quality gate commands (not filtered by trigger glob) on the consolidated branch after PR creation but before Tech Lead review.

**Assessment by card:**

| Card | Cross-story integration issues? | Integration gate would have helped? |
|------|-------------------------------|--------------------------------------|
| 1-5 | None — small cards, 3-4 stories each | No — no cross-story conflicts |
| 6 | qa_engineer tests failed, but this was a within-story issue (bad mtest patterns), not cross-story | **No** — the test failures were intrinsic to the test code, not caused by story merging |
| 7 | None — SvelteKit foundation | No |
| 8 | None — PR merged cleanly | No |
| 9 | None — PR merged cleanly | No |
| 10 | None — seed data is isolated | No |
| 11 | **Potentially** — unused imports and wrong props COULD have been caught if `npm run lint --strict` or `npx tsc --noEmit` was a gate command | **Partial** — only if typecheck was configured as a gate |
| 12 | N/A — deploy card | No |

**Verdict:** The integration gate would NOT have changed the outcome for this specific run. The issues were either:
1. Within-story quality problems (Card 6 mtest, Card 11 unused vars) — caught by pre-commit gates or reviewer
2. Code quality issues not covered by the configured gate commands (Card 11's typecheck issues)

### What Gaps Remain Even With the Integration Gate?

1. **The integration gate runs the same commands as the pre-commit gate** — If `npm run lint` passes per-story, it'll also pass on the consolidated branch (lint is file-local). The integration gate adds value only for cross-file issues like missing imports, broken interfaces, or type errors caused by incompatible changes. **Without `npx tsc --noEmit` as a gate command, the integration gate catches nothing that per-story gates don't already catch for TypeScript projects.**

2. **The integration gate runs AFTER story merging but BEFORE review** — If it finds issues, the `InlineIntegrationFixer` agent tries to fix them. But if the fix agent fails, the only recourse is to proceed to Tech Lead review (which will then flag the issues too). There's no retry loop for integration fixes — one shot and done.

3. **No integration test capability** — The gate runs the project's test suite, but there's no mechanism for WorkerMill to generate and run *integration tests* that verify cross-story contracts (e.g., "Component A from story 1 correctly imports Type B from story 2"). This is the class of bug the integration gate was designed to catch, but it relies entirely on the project's existing test infrastructure.

---

## Appendix: Raw Data

### Quality Gate Results Across All Cards

Total quality gate checks: ~120+ across 12 cards
Total gate failures: 8 (Card 1: 1, Card 6: 7 across qa_engineer and backend_developer)
Gate failure rate: ~7%
Auto-fix interventions: Unknown exact count (silently runs `npm run lint -- --fix`, `gofmt -w` before each check)

### Card 11 Revision Timeline

```
17:36  Plan approved (critic score 88/100)
17:47  Per-story review starts (story 0)
18:07  Stories 0, 2, 1, 4 all approved
18:15  Per-story review: revision_needed (story with unused imports, wrong props)
18:31  Story 3 reviewed and approved
18:57  Consolidated review 2: revision_needed (same issues)
19:37  Consolidated review 3: revision_needed ("NOT addressed")
20:15  Consolidated review 4: revision_needed ("same problems remain")
20:37  Consolidated review 5: approved (17 failing tests accepted)
```

### Card 6 qa_engineer Quality Gate Retries

```
20:00  go test ❌ (retry 0)
20:06  go test ❌ (retry 1) — same mtest pattern
20:16  go test ❌ (retry 2) — same mtest pattern
20:25  go test ❌ (retry 3) — same mtest pattern, 2/7 test groups failing
20:35  go test ❌ (retry 4) — same mtest pattern
20:48  go test ❌ (retry 5) — retries exhausted, story parked
21:14  Deferred retry — expert tries new approach, eventually passes
21:36  Card 6 completes (PR approved)
```

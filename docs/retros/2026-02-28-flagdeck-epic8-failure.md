# Retrospective: FlagDeck FDPFB-8 Failure

**Date:** 2026-02-28
**Duration of build:** ~9h 24m (16:14 - 01:38 UTC)
**Result:** 7/8 epics completed, epic 8 failed on story 6 (qa_engineer)
**Impact:** Demo build failed. 7 successful PRs merged, 8th epic's code lost entirely.

---

## Timeline

| Epic | Time | Duration | Stories | Result |
|------|------|----------|---------|--------|
| FDPFB-1 | 16:14 - 16:58 | 44m | 4 | Repo root config |
| FDPFB-2 | ~17:00 - 17:30 | 30m | 4 | CI/CD + README |
| FDPFB-3 | ~17:31 - 17:58 | 27m | 3 | MongoDB models |
| FDPFB-4 | ~17:59 - 18:53 | 54m | 5 | Targeting engine |
| FDPFB-5 | ~18:54 - 19:33 | 39m | 5 | Auth middleware |
| FDPFB-6 | ~19:34 - 21:36 | 2h 2m | 6 | Handlers + pagination |
| FDPFB-7 | ~21:37 - 23:01 | 1h 24m | 6 | SvelteKit frontend |
| FDPFB-8 | ~23:05 - 01:38 | **2h 33m** | 7 (6+1 QA) | **FAILED** |

**Total code produced:** 14,100 lines (7,151 Go production + 6,840 Go tests + 102 frontend)

---

## What Happened in FDPFB-8

Epic 8 had 7 stories: stories 0-5 assigned to `frontend_developer`, story 6 assigned to `qa_engineer`.

### Story execution timeline (FDPFB-8)

```
23:05  frontend_developer starts story 0
23:33  story 0 complete (28m)
23:42  story 1 starts → 23:46 complete (4m)
23:49  story 2 starts → 23:56 complete (7m)
23:57  story 3 starts → 00:09 complete (12m)
00:05  qa_engineer starts story 6 (parallel with story 3)
00:12  story 4 starts → 00:23 complete (11m, revision requested)
00:27  story 5 starts → 00:31 complete (4m)
00:33  story 4 revision → 00:42 complete (9m)
00:41  qa_engineer story 6 "completes" (passes to quality gate)
00:44  QUALITY GATE FAILS — lint errors in test files
       ... 40 minutes of retry loop (5 retries) ...
01:24  All 5 retries exhausted → BLOCKER escalated
01:31  User hits Retry on dashboard
01:38  Fails again immediately → Task marked FAILED
```

### The actual error (9 ESLint violations)

```
Pagination.test.ts:21    — 'mockProps' assigned but never used
Pagination.test.ts:109   — 'end' should be const (x5 more)
RolloutSlider.test.ts:29 — 'Props' defined but never used
segments.test.ts:314     — unexpected 'any' type
```

**These are trivially fixable.** `let` → `const`, remove unused vars, replace `any` with a type. The expert failed to fix them across 5+ retry attempts.

---

## Root Causes

### 1. Quality gate retry is "same expert, same context, same mistake"

The retry loop calls `executeStory()` with the error as feedback, but the expert regenerates the entire story from scratch each time. It doesn't surgically fix the lint errors — it rewrites everything and introduces the same patterns again. Five retries of "rewrite everything" produces five copies of the same mistakes.

**Why:** The quality gate fix feedback says "fix the errors below" but the expert is re-executing the full story prompt, not a targeted fix prompt. The expert doesn't understand it should make minimal edits to fix specific lint issues.

### 2. No `--fix` in the quality gate command

The lint gate runs `cd web && npm run lint`. ESLint reported "6 errors and 0 warnings potentially fixable with the `--fix` option." If the gate had run `npm run lint -- --fix` (or a pre-gate auto-fix step), 6 of 9 errors would have been fixed automatically. The remaining 3 (unused vars, `any` type) still need code changes, but reducing the error surface from 9 to 3 would have dramatically increased the expert's chance of fixing them.

**Why:** Quality gate commands are baked into the board at PRD decomposition time. The PRD prompt doesn't instruct the LLM to use `--fix` flags, and there's no auto-fix step before running the gate.

### 3. One story failure kills the entire epic

Story 6 was the QA story (writing tests). Stories 0-5 (the actual implementation) all completed successfully. But because story 6 failed, the entire epic was marked `failed` and no PR was created. All code from stories 0-5 was lost (branches never pushed from remote agent worktrees).

**Why:** The coordinator's deadlock detection treats any story failure as a task-level failure. There's no "complete with partial success" path — it's all or nothing.

### 4. No branches pushed = code lost

FDPFB-8 has zero branches on GitHub. Unlike the earlier FDPFB-1 through FDPFB-7 which pushed story branches, FDPFB-8's code existed only in the remote agent's worktrees. When the task failed, the worktrees were cleaned up and all work was lost.

**Why:** The remote agent pushes branches from worktrees, but if the epic fails before the consolidation/PR step, no `feature/fdpfb-8` branch is created. Story branches may have been pushed individually, but they were cleaned up.

### 5. Same failure pattern as FDPFB-6

In the original FlagDeck showcase (FDPFB-6, documented in the PRD lessons), the QA engineer's story also failed quality gates repeatedly because its worktree lacked sibling code. The sibling rebase + deferred retry commit we made today addresses part of this, but the deeper issue is that the quality gate retry loop doesn't produce targeted fixes.

---

## Action Items

### P0 — Prevent total code loss on partial failure

| # | Action | Complexity |
|---|--------|-----------|
| 1 | **Push story branches immediately after commits** — ensure `pushAfterCommit` always pushes the story branch to remote, not just locally. Verify FDPFB-8's stories actually pushed. | Low — verify config |
| 2 | **Create PR on partial completion** — when deadlock is detected (some stories complete, some failed), still create a PR with the completed stories' branches. Mark the PR as draft and note which stories failed. | Medium |
| 3 | **Don't clean up worktrees on failure** — or at least push all story branches to remote before cleanup. | Low |

### P1 — Make quality gate retries effective

| # | Action | Complexity |
|---|--------|-----------|
| 4 | **Auto-fix before gate check** — run `npm run lint -- --fix` (or equivalent) automatically before running the gate command. This handles the 6/9 auto-fixable errors. | Low |
| 5 | **Targeted fix prompt on retry** — instead of re-executing the full story, give the expert a surgical prompt: "Run `npm run lint`, read the errors, fix each one individually, commit." Don't re-run the full story prompt. | Medium |
| 6 | **Deploy sibling rebase + deferred retry** — the commit from today (`8c829c8`) adds sibling branch merging before retries and parks stories for deferred retry. Release a new agent binary so this is live. | Low — just release |

### P2 — Structural improvements

| # | Action | Complexity |
|---|--------|-----------|
| 7 | **Quality gate pre-flight in PRD decomposition** — validate that quality gate commands will work (e.g., `npm run lint` exists in package.json) at decomposition time, not at runtime after 5 retries. | Medium |
| 8 | **Separate test stories from the failure blast radius** — if a QA story fails, don't block the implementation stories. Tests are additive — the implementation code is still valid without them. | Medium |
| 9 | **Retry budget awareness** — after 2-3 identical failures, detect the pattern ("same lint errors every time") and try a different approach (e.g., run `--fix`, or ask the user). | High |

---

## What Went Well

- 7 of 8 epics completed successfully (14,100 lines of code)
- Frontend developer completed all 6 stories including a tech lead revision
- Quality gates caught real issues (the lint errors were genuine)
- The system correctly identified the deadlock and reported it to the user
- Sibling rebase + deferred retry was designed and committed during the build

## What We'll Do Differently

1. **Release the agent with the resilience commit before the next demo**
2. **Add auto-fix as a pre-gate step** — `eslint --fix`, `gofmt`, `prettier --write` should run automatically before the gate check
3. **Never lose completed code** — partial completion must still produce a PR
4. **Targeted fix prompts** — quality gate retries must not re-execute the full story

# Lessons Learned: Multi-Worker Coordination Architecture

> **Created:** 2025-01-18
> **Purpose:** Preserve institutional knowledge before simplification
> **Git Tag:** `v1-full-coordination` (pre-simplification)

---

## Executive Summary

We built a sophisticated multi-worker coordination system for PRD decomposition. While functional, the complexity-to-value ratio was unfavorable. This document captures everything we learned so future development can avoid the same pitfalls or revisit coordination if needed.

**Key Insight:** Most coordination complexity solves problems that disappear if workers don't share branches/files.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [What Worked Well](#what-worked-well)
3. [What Didn't Work Well](#what-didnt-work-well)
4. [All Discovered Issues](#all-discovered-issues)
5. [Edge Cases & Race Conditions](#edge-cases--race-conditions)
6. [Code Patterns to Preserve](#code-patterns-to-preserve)
7. [Code Patterns to Avoid](#code-patterns-to-avoid)
8. [The Coordination Tax](#the-coordination-tax)
9. [Files Reference](#files-reference)

---

## Architecture Overview

### The Full Coordination Model

```
Jira PRD Ticket
       │
       ▼
┌──────────────────┐
│ Planning Agent   │ ← Analyzes PRD, creates execution plan
│ (Claude Sonnet)  │   with stories, dependencies, targetFiles
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Approval UI      │ ← Human reviews plan, can request changes
│ (Dashboard)      │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Dispatcher       │ ← Creates child tasks, sets up branches
│ (Orchestrator)   │   handles dependency graph
└────────┬─────────┘
         │
    ┌────┴────┬────────┐
    ▼         ▼        ▼
┌───────┐ ┌───────┐ ┌───────┐
│Story 1│ │Story 2│ │Story 3│  ← ECS containers
│RUNNING│ │BLOCKED│ │BLOCKED│    with Claude Code
└───┬───┘ └───┬───┘ └───┬───┘
    │         │        │
    │    (waits for PR merge)
    │         │        │
    ▼         ▼        ▼
┌──────────────────────────────┐
│ Coordination Systems:        │
│ • File Locking (DB-based)    │
│ • Context Sharing API        │
│ • Dependency Tracking        │
│ • PR Merge Detection         │
│ • Unblock Logic              │
└──────────────────────────────┘
```

### State Machine

```
planning → pending_plan_approval → queued → dispatching
                    │                            │
                    │ (feedback)                 │
                    ▼                            ▼
           changes_requested            ┌───────┴───────┐
                                        │               │
                                   [Story 1]      [Story 2+]
                                    queued          blocked
                                       │               │
                                       ▼               │
                                   running             │
                                       │               │
                                       ▼               │
                                   completed ─────────►│
                                       │               │
                                   (PR merged) ───────►│ (unblocked)
                                                       ▼
                                                    queued
                                                       │
                                                       ▼
                                                    running
                                                       │
                                                       ▼
                                                   completed
```

---

## What Worked Well

### 1. Planning Agent with Codebase Context
- Fetching file tree, README, and package.json before planning
- Prevents hallucinated targetFiles
- LLM makes better decomposition decisions with real structure

### 2. Cost-First Story Sizing
- Max 3 story points per story for Haiku accuracy
- Smaller, focused stories = higher success rate
- Easy to estimate costs per story

### 3. Approval UI
- Users can review plans before expensive execution
- "Request Feedback" flow for iterating on plans
- Transparency into what workers will do

### 4. PostgreSQL + SSE for Log Streaming
- Real-time visibility into worker progress
- 500ms polling (faster than CloudWatch's 1s minimum)
- Battle-tested over weeks of iteration

### 5. Atomic Task Claiming
- `UPDATE...WHERE` pattern prevents double-execution
- Handles concurrent orchestrator restarts gracefully

### 6. Idempotent Child Task Creation
- Checks for existing children before dispatch
- Prevents duplicate story execution on retry

---

## What Didn't Work Well

### 1. File Locking System
**Built:** `WorkerFileLock` model, coordination endpoints
**Problem:** Rarely exercised, added complexity without clear benefit
**Reality:** If stories are well-decomposed, they don't touch same files

### 2. Context Sharing API
**Built:** `POST /coordination/context`, `GET /coordination/context`
**Problem:** Workers are ephemeral; by the time one finishes, context is stale
**Reality:** Better to put all context in the initial prompt

### 3. Dependency Blocking at Runtime
**Built:** `blocked` status, unblock logic, PR merge detection
**Problem:** Complex state machine, many edge cases
**Reality:** Simpler to run all in parallel, merge in order

### 4. PR Merge as Unblock Trigger
**Built:** GitHub webhook handler, polling for merge status
**Problem:** External action (human merge) required to unblock
**Reality:** Created confusion about who's responsible for merging

### 5. Complex Status Transitions
**Built:** 10+ statuses with intricate transition rules
**Problem:** Hard to reason about, easy to leave tasks orphaned
**Reality:** Simpler state machines are more maintainable

---

## All Discovered Issues

### PRD Workflow Analysis Issues (17 total)

| # | Issue | Severity | Root Cause |
|---|-------|----------|------------|
| 1 | Feature branch created twice | HIGH | Race condition in dispatch |
| 2 | Blocked tasks never unblock on dep failure | HIGH | Missing cascade cancellation |
| 3 | Single-story PRD uses wrong persona | MEDIUM | Default override logic |
| 4 | No idempotency in child task creation | HIGH | Missing existence check |
| 5 | PR merge required for unblocking | BY DESIGN | Prevents race conditions |
| 6 | Final PR not created when feature fails | MEDIUM | Early exit in completion |
| 7 | Story index 0-based vs 1-based | LOW | Inconsistent numbering |
| 10 | No orphan detection for dispatching | HIGH | Missing status in cleanup |
| 11 | No timeout for pending_plan_approval | MEDIUM | Infinite wait state |
| 12 | No timeout for planning status | MEDIUM | Crash leaves task stuck |
| 13 | No PR merge webhook handler | MEDIUM | Event-driven vs polling |
| 14 | No validation of child count | LOW | Partial dispatch recovery |
| 15 | Context archival timing | LOW | Archived before PR review |
| 16 | No cleanup of blocked children | MEDIUM | Manual cancel leaves orphans |
| 17 | Cooldown ignores blocked status | LOW | Edge case in logic |

### Critical Feedback Issues (9 total)

| # | Issue | Severity | Root Cause |
|---|-------|----------|------------|
| A | targetFiles not passed to workers | HIGH | Data flow gap |
| B | storyPoints not used | MEDIUM | Generated but discarded |
| C | Quality gates decorative | MEDIUM | No enforcement |
| D | Naive sequential dependencies | MEDIUM | Over-conservative default |
| E | No codebase context in planning | HIGH | Hallucinated paths |
| F | Complexity scoring incomplete | LOW | Missing dimensions |
| G | Static persona assignment | LOW | Single persona per story |
| H | No feedback loop | MEDIUM | Can't learn from execution |
| I | Vague acceptance criteria | MEDIUM | Prompt issue |

---

## Edge Cases & Race Conditions

### 1. Double Dispatch Race
**Scenario:** Orchestrator restarts during dispatch, both instances try to create children
**Solution:** Atomic claim with `planStatus` field, idempotency check on children

### 2. PR Merged Before Worker Checks
**Scenario:** Human merges PR while worker is finishing up
**Solution:** Always check merge status before considering task blocked

### 3. Orphaned Dispatching Parent
**Scenario:** Exception after setting status to `dispatching` but before creating children
**Solution:** Include `dispatching` in orphan detection with timeout

### 4. Blocked Child with Failed Sibling
**Scenario:** Story 1 fails, Story 2 is blocked waiting for Story 1
**Solution:** Cascade cancellation - fail all blocked siblings when any sibling fails

### 5. Plan Approval Timeout
**Scenario:** User never approves plan, task sits in `pending_plan_approval` forever
**Solution:** 24-hour timeout auto-cancellation

### 6. Planning Agent Crash
**Scenario:** Planning agent times out or crashes mid-execution
**Solution:** 30-minute timeout for `planning` status, return to queue

### 7. Concurrent File Edits
**Scenario:** Two workers edit same file simultaneously
**Prevention (Complex):** File locking, sequential dependencies
**Prevention (Simple):** Separate branches, merge conflicts at merge time

---

## Code Patterns to Preserve

### 1. Atomic Task Claiming
```typescript
const result = await taskRepo
  .createQueryBuilder()
  .update(WorkerTask)
  .set({ status: "claimed", claimedAt: new Date() })
  .where("id = :id AND status = :status", { id: taskId, status: "queued" })
  .execute();

if (result.affected === 0) {
  // Another process claimed it
  return null;
}
```

### 2. Idempotent Operations
```typescript
const existingChildren = await taskRepo.find({
  where: { parentTaskId: task.id }
});
if (existingChildren.length > 0) {
  logger.warn("Children already exist, skipping dispatch");
  return existingChildren;
}
```

### 3. Graceful Degradation
```typescript
try {
  const codebaseContext = await fetchCodebaseContext(owner, repo);
} catch (error) {
  logger.warn("Could not fetch codebase context, proceeding without", { error });
  codebaseContext = { fileTree: "Not available", readme: null, techStack: null };
}
```

### 4. Dashboard Logging
```typescript
await addPlanningLog(task.id, `Starting phase: ${phaseName}`);
// ... do work ...
await addPlanningLog(task.id, `Completed phase: ${phaseName}`);
```

### 5. Timeout-Based Recovery
```typescript
const stuckTasks = await taskRepo.find({
  where: {
    status: "planning",
    updatedAt: LessThan(new Date(Date.now() - 30 * 60 * 1000)) // 30 min
  }
});
for (const task of stuckTasks) {
  task.status = "failed";
  task.errorMessage = "Planning timeout";
  await taskRepo.save(task);
}
```

---

## Code Patterns to Avoid

### 1. Complex State Machines
**Problem:** More states = more edge cases
**Better:** Minimize states, use timestamps for timeout detection

### 2. External Event Dependencies
**Problem:** Relying on GitHub webhook for PR merge is fragile
**Better:** Polling or orchestrator-controlled merging

### 3. Worker-to-Worker Communication
**Problem:** Workers are ephemeral, coordination is complex
**Better:** All communication through orchestrator

### 4. Shared Mutable State
**Problem:** File locking, context sharing between workers
**Better:** Workers are independent, merge at the end

### 5. Implicit Dependencies
**Problem:** "Story 2 waits for Story 1's PR to merge"
**Better:** Explicit orchestrator control of execution order

---

## The Coordination Tax

### Code Added for Coordination

| Feature | Lines | Files |
|---------|-------|-------|
| File Locking | ~200 | 3 |
| Context Sharing | ~150 | 2 |
| Dependency Blocking | ~300 | 1 |
| Unblock Logic | ~200 | 1 |
| PR Merge Detection | ~150 | 2 |
| Orphan Recovery | ~100 | 1 |
| Cascade Cancellation | ~100 | 1 |
| **Total** | **~1200** | **11** |

### Bugs Fixed Related to Coordination

- 17 issues in PRD Workflow Analysis
- 9 issues in Critical Feedback
- Countless hours debugging state transitions

### Operational Complexity

- 10+ task statuses to understand
- Complex webhook integrations
- Dashboard UI for coordination visibility
- Documentation overhead

---

## Files Reference

### Core Coordination Files (May Be Simplified)

| File | Purpose | Lines |
|------|---------|-------|
| `api/src/services/orchestrator.ts` | Main orchestration logic | ~2600 |
| `api/src/services/planning-agent.ts` | Plan generation | ~1100 |
| `api/src/services/quality-gates.ts` | Gate validation | ~470 |
| `api/src/routes/coordination.ts` | File locking API | ~200 |
| `api/src/routes/webhooks.ts` | GitHub/Jira webhooks | ~500 |
| `api/src/models/WorkerFileLock.ts` | File lock model | ~50 |

### Files to Keep

| File | Purpose |
|------|---------|
| `api/src/services/ecs-task-runner.ts` | ECS spawning |
| `api/src/utils/github.ts` | GitHub API utilities |
| `api/src/utils/jira.ts` | Jira API utilities |
| `api/src/models/WorkerTask.ts` | Task model |
| `worker/entrypoint.sh` | Worker execution |

---

## Recommendations for Simplification

### Remove
- [ ] File locking system (`WorkerFileLock`, coordination endpoints)
- [ ] Context sharing API
- [ ] `blocked` status and unblock logic
- [ ] PR merge as trigger for next story
- [ ] Worker-side coordination code

### Keep
- [x] Planning agent with codebase context
- [x] Approval UI
- [x] ECS task spawning
- [x] Cost tracking
- [x] Log streaming
- [x] Story decomposition

### Add
- [ ] Per-story branches (story-1, story-2, story-3)
- [ ] Orchestrator-managed PR merging (in dependency order)
- [ ] Parallel execution with ordered merge

---

## Conclusion

The full coordination architecture was an ambitious attempt to enable parallel workers editing the same codebase. In practice:

1. **Well-decomposed stories rarely share files** - The planning agent naturally separates concerns
2. **Coordination complexity exceeds its value** - 1200+ lines of coordination code, 26+ bugs
3. **Simpler models exist** - Separate branches + ordered merge achieves same result

The lessons here are preserved for future reference. If we ever need true concurrent file editing, this document captures all the edge cases we discovered.

---

## Git Tag

Before simplification, the codebase is tagged:

```bash
git tag -a v1-full-coordination -m "Full coordination architecture before simplification"
git push origin v1-full-coordination
```

This allows full restoration if needed:
```bash
git checkout v1-full-coordination
```

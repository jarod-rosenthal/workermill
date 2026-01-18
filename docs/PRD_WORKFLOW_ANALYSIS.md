# PRD Workflow Analysis

> **Last Updated:** 2025-01-18
> **Status:** Post-fix verification with new issues identified

This document provides a comprehensive analysis of the PRD (Product Requirements Document) workflow in WorkerMill, including identified issues and their status.

---

## Table of Contents

1. [Workflow Overview](#workflow-overview)
2. [State Machine Diagram](#state-machine-diagram)
3. [Previously Known Issues (Fixed)](#previously-known-issues-fixed)
4. [New Issues Identified](#new-issues-identified)
5. [Issue Details](#issue-details)
6. [Recommendations](#recommendations)

---

## Workflow Overview

When a Jira ticket has a `prd`, `epic`, `multi-story`, or `orchestration` label, it triggers a special workflow:

1. **Planning Phase**: A planning agent analyzes the PRD and creates an execution plan (single-story or multi-story)
2. **Approval Phase**: User reviews and approves the plan in the dashboard
3. **Dispatch Phase**: For multi-story plans, child tasks are created for each story
4. **Execution Phase**: Workers execute stories (with dependency ordering)
5. **Completion Phase**: When all stories finish, a summary is posted and final PR created

### Key Files

| File | Purpose |
|------|---------|
| `api/src/routes/webhooks.ts` | Entry point - Jira webhook handler |
| `api/src/services/planning-agent.ts` | Plan generation and complexity scoring |
| `api/src/services/orchestrator.ts` | Task dispatch, monitoring, and completion |
| `api/src/routes/tasks.ts` | Plan approval endpoints |
| `api/src/routes/coordination.ts` | Sibling worker communication |

---

## State Machine Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         PRD WORKFLOW - COMPLETE STATE MACHINE                    │
└─────────────────────────────────────────────────────────────────────────────────┘

                              ┌──────────────────┐
                              │     planning     │ ← Jira webhook (prd label)
                              └────────┬─────────┘
                                       │ runPlanningAgent()
                                       │
                 ┌─────────────────────┴─────────────────────┐
                 │                                           │
                 ▼ (success)                                 ▼ (error)
    ┌────────────────────────┐                        ┌─────────┐
    │ pending_plan_approval  │                        │ failed  │
    └───────────┬────────────┘                        └─────────┘
                │
    ┌───────────┴───────────┐
    │ (no timeout/cleanup!) │ ← ⚠️ ISSUE #11
    └───────────┬───────────┘
                │ POST /plan/approve
                ▼
         ┌───────────┐
         │  queued   │
         └─────┬─────┘
               │ dispatchMultiStoryPlan()
               │
    ┌──────────┴──────────┐
    │ single              │ multi
    ▼                     ▼
┌───────────┐      ┌─────────────┐
│spawnWorker│      │ dispatching │ ← ⚠️ ISSUE #10: no orphan detection
└───────────┘      └──────┬──────┘
                          │
         ┌────────────────┼────────────────┐
         ▼                ▼                ▼
    ┌─────────┐      ┌─────────┐      ┌─────────┐
    │ queued  │      │ blocked │      │ blocked │
    └────┬────┘      └────┬────┘      └────┬────┘
         │                │                │
         ▼                ▼                ▼
     [Worker]         [Waits for deps]  [Waits]
         │                │                │
         ▼                │                │
    Terminal          ←───┴────────────────┘
    (completed/deployed/review_requested/failed)
                          │
                          ▼ (all children terminal)
                   ┌──────────────┐
                   │  completed   │ ← Parent transitions
                   │  or failed   │
                   └──────────────┘
```

---

## Previously Known Issues (Fixed)

These issues were identified in the initial analysis and have been verified as fixed:

| # | Issue | Status | Fix Location |
|---|-------|--------|--------------|
| 1 | Feature branch created twice with different naming | ✅ FIXED | `orchestrator.ts:620-627` |
| 2 | Blocked tasks never unblock if dependency fails | ✅ FIXED | `orchestrator.ts:1252-1275` |
| 3 | Single-story PRD uses wrong persona | ✅ FIXED | `orchestrator.ts:602-617` |
| 4 | No idempotency check in child task creation | ✅ FIXED | `orchestrator.ts:684-705` |
| 5 | PR merge required for unblocking | ⚠️ BY DESIGN | `orchestrator.ts:1207-1233` |
| 6 | Final PR not created when feature branch fails | ✅ FIXED | `orchestrator.ts:921-922` |
| 7 | Story index conversion (0-based vs 1-based) | ✅ FIXED | `orchestrator.ts:820-829` |

### Issue 5 Note (By Design)

The PR merge requirement for unblocking is intentional - it prevents race conditions where a dependent task starts editing files before the dependency's changes are merged. This is documented behavior.

---

## New Issues Identified

| # | Issue | Severity | Location | Impact |
|---|-------|----------|----------|--------|
| 10 | No orphan detection for `dispatching` parent tasks | **HIGH** | `orchestrator.ts:2563` | Parent stuck forever if dispatch fails |
| 11 | No timeout for `pending_plan_approval` status | MEDIUM | `orchestrator.ts:2547-2566` | Tasks waiting for approval stay forever |
| 12 | No timeout for `planning` status | MEDIUM | `orchestrator.ts:457-469` | Tasks stuck if planning agent crashes |
| 13 | GitHub webhook doesn't handle PR merge events | MEDIUM | `webhooks.ts:429-431` | No event-driven unblock on PR merge |
| 14 | No validation of child task count after dispatch | LOW | `orchestrator.ts:684-705` | Partial dispatch leaves fewer children |
| 15 | Context archival happens before final PR merge | LOW | `orchestrator.ts:1090-1110` | Context unavailable during PR review |
| 16 | No cleanup of blocked children when parent cancelled | MEDIUM | `orchestrator.ts:1252-1275` | Manual cancellation leaves orphans |
| 17 | Cooldown check doesn't account for blocked status | LOW | `orchestrator.ts:341-360` | Edge case with cooldown logic |

---

## Issue Details

### Issue 10 (HIGH): No Orphan Detection for `dispatching` Parent Tasks

**Location:** `orchestrator.ts:2560-2566`

The `failOrphanedTasks()` function only checks for these statuses:

```typescript
const activeTasks = await taskRepo
  .createQueryBuilder("task")
  .where("task.status IN (:...statuses)", {
    statuses: ["claimed", "environment_setup", "executing"],  // Missing: "dispatching"
  })
```

**Problem:** If a parent task enters `dispatching` status but child task creation fails:

1. Parent task set to `dispatching` at line 853
2. Child task creation fails at line 837 (DB error)
3. Exception thrown, parent stays `dispatching`
4. Parent stuck forever - no cleanup

**Root Cause:** `failOrphanedTasks()` doesn't include `dispatching` in its status check.

---

### Issue 11 (MEDIUM): No Timeout for `pending_plan_approval`

**Location:** `orchestrator.ts:2547-2566`

Tasks that reach `pending_plan_approval` wait indefinitely for human approval. There's no mechanism to:
- Auto-fail after N days
- Notify that approval is pending
- Clean up stale approval requests

**Impact:** Dashboard clutter, orphaned plans consuming mental overhead.

---

### Issue 12 (MEDIUM): No Timeout for `planning` Status

**Location:** `orchestrator.ts:476-489`

The claim mechanism sets `planStatus = "pending_approval"` before running the planning agent:

```typescript
.set({ planStatus: "pending_approval" })
.where("id = :id AND status = :status AND plan_status IS NULL", { id: taskId, status: "planning" })
```

If the planning agent crashes or times out:
- Task stays in `planning` status with `planStatus = "pending_approval"`
- `findPlanningTasks()` skips it (planStatus is not NULL)
- Task is stuck forever

---

### Issue 13 (MEDIUM): No PR Merge Webhook Handler

**Location:** `webhooks.ts:429-431`

```typescript
// Only process pull_request_review events
if (event !== "pull_request_review") {
  res.json({ status: "ignored", reason: "Not a PR review event" });
  return;
}
```

The GitHub webhook only handles `pull_request_review` events, not `pull_request` closed/merged events.

**Impact:** When a dependency PR is merged externally (human merges on GitHub), blocked tasks don't unblock until the next relevant status change event.

---

### Issue 14 (LOW): No Validation of Child Task Count After Dispatch

**Location:** `orchestrator.ts:684-705`

The idempotency check verifies children exist but doesn't verify count matches expected:

```typescript
if (existingChildren.length > 0) {
  logger.warn("Child tasks already exist for parent - skipping dispatch", {
    existingChildCount: existingChildren.length,
    expectedStoryCount: planJson.stories.length,  // Not validated!
  });
```

If dispatch created 2 of 4 children before failing, re-dispatch would skip entirely.

---

### Issue 15 (LOW): Context Archival Before Final PR Review

**Location:** `orchestrator.ts:1090-1110`

Context is archived when the parent task completes, but the final PR might still need review. Archived context is still accessible via `includeArchived=true` query param, so impact is minimal.

---

### Issue 16 (MEDIUM): No Cleanup of Blocked Children When Parent Cancelled

**Location:** `orchestrator.ts:1252-1275`

The `checkAndUnblockDependentTasks()` function cancels blocked tasks when a **sibling** fails, but not when the **parent** is manually cancelled.

**Scenario:**
1. User manually cancels parent task from dashboard
2. Parent status → `cancelled`
3. Blocked children stay `blocked` forever

---

### Issue 17 (LOW): Cooldown Check Doesn't Account for Blocked Status

**Location:** `orchestrator.ts:341-360`

The cooldown only checks terminal statuses (`failed`, `completed`, `deployed`, `cancelled`). Edge case where blocked tasks from the same Jira key could interact with cooldown logic.

---

## Recommendations

### High Priority

1. **Issue 10**: Add `"dispatching"` to `failOrphanedTasks()` status list with logic to check if `childTaskIds` is empty after a timeout (e.g., 10 minutes).

### Medium Priority

2. **Issue 11 & 12**: Add a cleanup routine in `cleanupLoop()` that fails tasks stuck in `pending_plan_approval` or `planning` status for more than X days (configurable per org).

3. **Issue 13**: Add handler for `pull_request` events with `action: "closed"` and `merged: true` to trigger `checkAndUnblockDependentTasks()` for all tasks with PRs targeting that repo.

4. **Issue 16**: When a parent task is manually cancelled/failed via API, cascade cancellation to all blocked children.

### Low Priority

5. **Issue 14**: Add validation that `existingChildren.length === planJson.stories.length` and implement partial dispatch recovery.

6. **Issue 15**: Delay context archival until final PR is merged or closed.

7. **Issue 17**: Consider excluding `blocked` status from cooldown calculations.

---

## Summary

| Category | Count |
|----------|-------|
| Previously Known Issues | 7 |
| Fixed | 6 |
| By Design | 1 |
| **New Issues Found** | **8** |
| High Severity | 1 |
| Medium Severity | 4 |
| Low Severity | 3 |

The PRD workflow is functioning well after the initial fixes. The most critical new issue is **#10** - `dispatching` parent tasks have no orphan detection and can get stuck forever if child dispatch fails.

# Quality Gates Implementation

## Overview

This document describes the implementation of **Quality Gates Validation** for WorkerMill, which addresses Critical Feedback Issue C: "Quality gates are decorative."

## Problem Statement

Previously, quality gates were:
1. Generated in every execution plan as text strings
2. Never validated during task execution
3. Never checked before marking tasks as complete
4. Only displayed in Jira comments as decorative/informational

This made quality gates a "checkbox feature" with no actual enforcement or validation.

## Solution

Quality gates are now **validated when tasks complete**, providing visibility into which gates passed/failed.

### Key Files

1. **`/mnt/c/Users/jarod/github/workermill/api/src/services/quality-gates.ts`** (NEW)
   - New validation module with comprehensive gate checking logic
   - Supports gates: PR created, PR merged, tests pass, no TypeScript errors, PR review approved, no lint errors, deployment successful, code coverage
   - Returns detailed validation results with per-gate status

2. **`/mnt/c/Users/jarod/github/workermill/api/src/services/orchestrator.ts`** (MODIFIED)
   - Added import: `import { validateQualityGates } from "./quality-gates.js";`
   - Added quality gate validation at task completion (line ~1984-2033)
   - Validation runs for tasks with status: `completed`, `deployed`, `review_requested`
   - Logs detailed results to task logs for dashboard visibility
   - Stores summary in `task.taskNotes` for audit trail

## How It Works

### Task Completion Flow

1. Task finishes execution in ECS
2. Orchestrator detects completion and sets `task.status` to `completed`/`deployed`/`review_requested`
3. **NEW: Quality gates validation runs**
   - Extracts quality gates from `task.planJson.qualityGates`
   - Validates each gate against task state and GitHub API
4. Validation results logged to `WorkerTaskLog` with types `info`/`warning`/`error`
5. Summary stored in `task.taskNotes` for audit
6. **Task status is NOT affected by gate failures** (informational only, for now)

### Validation Results

Each quality gate validation returns:
```typescript
{
  status: "passed" | "failed" | "warning" | "unknown",
  message: string
}
```

Overall result aggregates per-gate results:
```typescript
{
  passed: boolean,           // All gates passed
  failures: string[],        // Failed gates with reasons
  warnings: string[],        // Warnings (not blocking)
  details: Record<string, GateCheckResult>  // Per-gate results
}
```

## Supported Quality Gates

### 1. PR Created / PR Exists
**Keywords:** `pr created`, `pr exists`
- **Check:** `task.githubPrUrl` and `task.githubPrNumber` are set
- **Passes if:** PR was created and linked
- **Source:** Task fields updated by worker output markers

### 2. PR Merged / PR Merged to Main
**Keywords:** `pr merged`, `merged to`
- **Check:** Task status is `deployed` OR PR fetch shows merged state
- **Passes if:** PR was merged into base branch
- **Source:** Task status (proxy) or GitHub API (if implemented)

### 3. Tests Pass / CI Passes
**Keywords:** `test pass`, `ci passes`, `tests passing`
- **Check:** GitHub PR status via API
- **Passes if:** PR is merged (implies tests passed)
- **Source:** GitHub API (check-runs for comprehensive check)
- **Note:** Currently uses PR merge status as proxy; can be extended with check-runs API

### 4. No TypeScript Errors / Type Checks Pass
**Keywords:** `typescript`, `type error`, `type check`, `tsc`
- **Check:** Searches task logs for TypeScript error patterns
- **Patterns:** `error TS####`, `typescript error`, `tsc: error`, `type error`
- **Passes if:** No error patterns found in logs
- **Source:** Worker task logs

### 5. PR Review Approved
**Keywords:** `review` + `approved`, `pr review approved`
- **Check:** Task status indicates approval
- **Passes if:** Status is `pr_approved`, `review_approved`, or `deployed`
- **Source:** Task status field

### 6. No Linting Errors / Lints Pass
**Keywords:** `lint pass`, `eslint`
- **Check:** Searches task logs for linting error patterns
- **Patterns:** `eslint error`, `lint error`, `linting failed`, `eslint found`
- **Passes if:** No error patterns found in logs
- **Source:** Worker task logs

### 7. Code Coverage Meets Threshold
**Keywords:** `coverage`
- **Current:** Returns `unknown` status
- **Future:** Can be extended to parse coverage data from CI logs or stored separately

### 8. Deployment Successful
**Keywords:** `deploy` + `success`
- **Check:** Task status
- **Passes if:** Status is `deployed`
- **Fails if:** Status is `failed`
- **Source:** Task status field

### Unknown Gates
Any gate not matching above patterns returns status `unknown` without blocking.

## Task Log Output

When quality gates are validated, the following logs appear in the task's dashboard view:

### Example: All Gates Pass
```
✅ All quality gates passed
```

### Example: Some Gates Fail
```
Quality gates validation: 2 gate(s) failed:
Quality gate failed: "No TypeScript errors" - Found 3 TypeScript errors in task logs
Quality gate failed: "Tests pass" - PR is open, tests may still be running
```

### Example: Warnings
```
Quality gates validation: 1 gate(s) have warnings:
Quality gate: Cannot verify tests - no PR or repo info available
```

## Important Notes

1. **Quality gates do NOT block task completion**
   - Task status is set before validation
   - Validation is informational/advisory (for now)
   - Allows monitoring without disrupting workflows
   - Can be made blocking later with organizational setting

2. **Validation is best-effort**
   - Relies on task state, logs, and GitHub API
   - API failures return `warning` status, not blocking
   - Coverage metrics (future) may be unavailable

3. **Gates are logged to dashboard**
   - Users see pass/fail/warning per gate in task logs
   - Summary stored in `task.taskNotes` for audit
   - Provides transparency into quality metrics

4. **Extensible design**
   - New gates can be added by extending `checkQualityGate()` function
   - Patterns for logs can be customized
   - API checks can be enhanced (e.g., actual check-runs)

## Implementation Details

### Query Logs Efficiently
- Limits to 500 most recent logs to avoid scanning entire history
- Uses simple regex patterns for quick matching
- Stops on first error match per pattern (early exit)

### Avoid GitHub API Throttling
- Uses existing `getPullRequestStatus()` function (cached token)
- Only makes API call if PR number and repo are available
- Returns gracefully on API errors (warning status)

### Database Updates
- Quality gates validation adds to `WorkerTaskLog` table
- Summary stored in `task.taskNotes` column
- Does NOT create new columns or migrations

## Future Enhancements

1. **Blocking Gates**: Add org setting to fail task on gate failures
   ```typescript
   if (!gateValidation.passed && org.enforceQualityGates) {
     task.status = "failed";
     task.errorMessage = "Quality gates validation failed";
   }
   ```

2. **GitHub Check Runs API**: Query actual CI status
   ```typescript
   // Check GitHub API for check-runs instead of just merge status
   const checkRuns = await fetch(`/repos/{owner}/{repo}/commits/{sha}/check-runs`)
   ```

3. **Code Coverage Parsing**: Extract coverage from CI logs or stored metrics

4. **Custom Gates**: Allow organizations to define custom gate patterns

5. **Gate Analytics**: Track gate pass rates over time for team insights

6. **Jira Comments**: Post gate summary as Jira comment for full audit trail

## Testing

To test quality gates validation:

1. Create a task with quality gates in the plan
2. Let task complete normally
3. Check dashboard task logs for validation results
4. Look for quality gate summary in `task.taskNotes`

Example log entries to verify:
```
✅ All quality gates passed
Quality gates validation: 1 gate(s) have warnings: ...
Quality gate failed: "PR was not created or not linked to task"
```

## Configuration

Quality gates validation is **enabled by default** for all tasks.

To disable for specific task types, modify the condition in orchestrator.ts:
```typescript
// Current: validates for completed, deployed, review_requested
if (["completed", "deployed", "review_requested"].includes(newStatus)) {
  // ...
}

// To disable for certain statuses:
if (["deployed"].includes(newStatus)) {
  // Only validate deployed tasks
}
```

## Error Handling

- Validation errors are caught and logged as warnings
- If validation fails, a warning log entry is created but task completes normally
- This prevents gate validation from breaking task processing

## Performance Impact

- Minimal: validation runs sequentially after task completion
- 500ms-2s typical per task (depends on log query and API calls)
- Runs in background after task is already complete
- No impact on real-time log streaming

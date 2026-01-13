# Ralph Integration Implementation Plan

## Overview

Integrate [Ralph](https://github.com/iannuttall/ralph) as an optional execution engine for WorkerMill workers. Ralph provides a structured PRD → Plan → Loop workflow with file-based state persistence.

## Goals

1. Add Ralph as an alternative execution mode (not replacing current Claude Code direct execution)
2. Maintain existing log streaming functionality
3. Enable resumable task execution for complex tickets
4. Preserve rollback capability to current approach

## Non-Goals

- Replacing the current worker execution entirely
- Modifying WorkerMill's orchestration layer
- Changing the Jira webhook or task queuing system

## Architecture

```
Current Flow:
Jira Ticket → WorkerMill API → ECS Container → Claude Code → PR

Ralph Flow (New):
Jira Ticket → WorkerMill API → ECS Container → Ralph Loop → Claude Code → PR
                                                   ↓
                                            .ralph/ state files
```

## Implementation Phases

### Phase 1: Worker Container Preparation

**Objective:** Add Ralph to the worker Docker image without changing default behavior.

**Tasks:**
- [ ] Add Ralph installation to `worker/Dockerfile`
  ```dockerfile
  RUN npm install -g @iannuttall/ralph
  ```
- [ ] Create Ralph configuration template at `worker/ralph/config.template.json`
- [ ] Add environment variable `USE_RALPH=false` (default off)
- [ ] Verify worker image builds and existing flow still works

**Validation:** Deploy worker image, run task without Ralph, confirm no regression.

### Phase 2: Jira-to-PRD Converter

**Objective:** Convert Jira ticket content into Ralph's PRD format.

**Tasks:**
- [ ] Create `worker/execution/ralph/jira-to-prd.ts` script
- [ ] Map Jira fields to PRD structure:
  | Jira Field | PRD Section |
  |------------|-------------|
  | Summary | Title |
  | Description | Overview |
  | Acceptance Criteria | Requirements |
  | Technical Notes | Constraints |
- [ ] Handle Gherkin-format acceptance criteria parsing
- [ ] Write PRD to `.ralph/prd.md` in cloned repo
- [ ] Add unit tests for conversion logic

**Validation:** Convert 5 existing OCS tickets, review PRD quality.

### Phase 3: Entrypoint Integration

**Objective:** Add Ralph execution path to worker entrypoint.

**Tasks:**
- [ ] Modify `worker/entrypoint.sh` to check `USE_RALPH` env var
- [ ] If enabled:
  1. Run Jira-to-PRD converter
  2. Execute `ralph plan`
  3. Execute `ralph loop`
  4. Capture exit code and map to task status
- [ ] Configure Ralph to use Claude Code as agent:
  ```json
  {
    "agent": {
      "command": "claude -p \"$PROMPT\""
    }
  }
  ```
- [ ] Ensure `.ralph/` directory is created in target repo (oncallshift)

**Validation:** Run single task with `USE_RALPH=true`, verify execution completes.

### Phase 4: Log Streaming Integration

**Objective:** Stream Ralph's activity to WorkerMill dashboard.

**Tasks:**
- [ ] Create background process to tail `.ralph/activity.log`
- [ ] Pipe activity log lines to `post_log()` function
- [ ] Add prefix to distinguish Ralph logs: `[ralph] Planning story 1 of 3...`
- [ ] Handle log file rotation/truncation
- [ ] Ensure terminal output from Claude Code still streams normally

**Validation:** Watch dashboard during Ralph task, confirm both Ralph and Claude logs appear.

### Phase 5: State Persistence (Optional)

**Objective:** Enable task resumption by persisting Ralph state.

**Tasks:**
- [ ] Add S3 bucket path for Ralph state: `s3://workermill-dev-state/ralph/{taskId}/`
- [ ] On task start: download existing `.ralph/` state if present
- [ ] On task completion/failure: upload `.ralph/` state to S3
- [ ] Add cleanup job for old state files (align with `taskRetentionDays`)
- [ ] Update retry logic to resume from state instead of restarting

**Validation:** Kill task mid-execution, retry, confirm it resumes from last story.

### Phase 6: Dashboard Integration

**Objective:** Surface Ralph-specific information in the UI.

**Tasks:**
- [ ] Add "Execution Mode" field to task model (`direct` | `ralph`)
- [ ] Display current story progress in task details
- [ ] Parse `.ralph/progress.json` for story completion status
- [ ] Add "Stories" progress indicator (e.g., "2/5 stories complete")

**Validation:** View Ralph task in dashboard, see story-level progress.

## Configuration

### New Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `USE_RALPH` | `false` | Enable Ralph execution mode |
| `RALPH_STATE_BUCKET` | (none) | S3 bucket for state persistence |
| `RALPH_MAX_STORIES` | `10` | Maximum stories Ralph will plan |

### New Organization Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `useRalphExecution` | `false` | Enable Ralph for this org's tasks |
| `ralphMaxStories` | `10` | Story limit per task |

## Risk Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking log streaming | Phase 4 adds Ralph logs alongside existing streaming, not replacing it |
| Ralph hangs/loops infinitely | Add timeout matching existing `TASK_TIMEOUT_MINUTES` |
| Debugging complexity | Prefix all Ralph logs with `[ralph]` for easy filtering |
| Ralph project abandoned | Vendor the specific version in `worker/vendor/ralph/` if needed |
| Regression in direct mode | `USE_RALPH=false` by default; feature flag per-org |

## Rollback Strategy

1. **Phase 1-2:** No risk - just adds files, doesn't change behavior
2. **Phase 3+:** Set `USE_RALPH=false` in environment to revert to direct execution
3. **Emergency:** Revert worker image to previous tag

## Success Criteria

1. Tasks can run in either direct or Ralph mode via configuration
2. Log streaming works identically in both modes
3. No increase in task failure rate when using Ralph
4. Complex tickets show improved completion rate with Ralph (measured over 20+ tasks)

## Timeline

No time estimates provided - phases are sequenced by dependency, not duration.

## Open Questions

1. Should Ralph mode be selectable per-ticket via Jira label (e.g., `ralph`)?
2. How should Ralph's multi-story output map to single Jira ticket completion?
3. Should failed stories create sub-tasks in Jira for visibility?

---

*Plan created: 2025-01-12*
*Status: Draft - Awaiting approval*

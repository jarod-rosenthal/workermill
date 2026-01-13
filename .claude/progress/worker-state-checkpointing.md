# Worker State Checkpointing Implementation Plan

## Overview

Add lightweight state persistence to WorkerMill workers, enabling task resumption after Spot interruptions, timeouts, or failures. This provides resumability benefits without introducing external dependencies like Ralph.

## Goals

1. Recover from Spot instance interruptions without losing work
2. Resume long-running tasks that hit timeout limits
3. Reduce costs by not redoing completed work on retries
4. Improve debugging visibility into task progress

## Non-Goals

- Full workflow orchestration (that's Ralph territory)
- Breaking tasks into stories/subtasks
- Changing the Claude Code execution model

## Architecture

```
Current Flow:
Task Start → Clone → Execute → Complete/Fail
     ↓ (on retry)
Task Start → Clone → Execute (from scratch)

With Checkpointing:
Task Start → Load State? → Clone → Execute → Checkpoint → Complete/Fail
     ↓ (on retry)                      ↑
Task Start → Load State → Resume ──────┘
```

## State Schema

```typescript
interface WorkerCheckpoint {
  taskId: string;
  version: 1;
  createdAt: string;
  updatedAt: string;

  // Execution progress
  stage: 'cloning' | 'analyzing' | 'implementing' | 'testing' | 'committing' | 'pr_creating';

  // Git state (implicit checkpoint)
  repoCloned: boolean;
  branch: string | null;
  commits: string[];  // commit SHAs made during this task

  // Work completed
  filesAnalyzed: string[];
  filesModified: string[];
  testsRun: boolean;
  testsPassed: boolean | null;

  // For resume context
  lastAction: string;  // Human-readable description
  pendingWork: string | null;  // What was in progress when interrupted
}
```

## Storage Options

| Option | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| **S3 bucket** | Persistent, survives container death | Extra AWS calls | **Use for production** |
| **Database column** | Already have DB connection | Adds writes during execution | Good for metadata |
| **Local file + S3 sync** | Fast local writes | Complexity | Best of both |

**Decision:** Local file with periodic S3 sync (every 60s) and sync on stage transitions.

## Implementation Phases

### Phase 1: State Infrastructure

**Objective:** Create state storage and retrieval mechanisms.

**Tasks:**
- [ ] Add S3 bucket for worker state in Terraform
  ```hcl
  resource "aws_s3_bucket" "worker_state" {
    bucket = "workermill-dev-worker-state-${data.aws_caller_identity.current.account_id}"
  }

  resource "aws_s3_bucket_lifecycle_configuration" "worker_state_cleanup" {
    bucket = aws_s3_bucket.worker_state.id
    rule {
      id     = "cleanup-old-state"
      status = "Enabled"
      expiration {
        days = 7  # State only needed for retries
      }
    }
  }
  ```
- [ ] Add IAM permissions for worker task role to read/write state bucket
- [ ] Create `worker/lib/checkpoint.sh` with functions:
  - `checkpoint_init()` - Create initial state file
  - `checkpoint_update()` - Update stage/progress
  - `checkpoint_load()` - Download existing state from S3
  - `checkpoint_save()` - Upload state to S3
- [ ] Add `CHECKPOINT_BUCKET` environment variable to worker task definition

**Validation:** Worker can write and read state file from S3.

### Phase 2: Checkpoint Creation

**Objective:** Workers write checkpoints during execution.

**Tasks:**
- [ ] Modify `worker/entrypoint.sh` to call checkpoint functions:
  ```bash
  # At start
  checkpoint_init

  # After clone
  checkpoint_update "cloning" "complete"

  # Before Claude execution
  checkpoint_update "analyzing" "started"

  # Periodic background sync (every 60s)
  (while true; do sleep 60; checkpoint_save; done) &
  CHECKPOINT_PID=$!

  # On exit (success or failure)
  trap 'checkpoint_save; kill $CHECKPOINT_PID 2>/dev/null' EXIT
  ```
- [ ] Add stage markers that Claude Code can write:
  ```bash
  # Claude writes these markers to stdout, entrypoint parses them
  # ::checkpoint::implementing::Modified src/api/users.ts
  ```
- [ ] Parse Claude output for checkpoint markers and update state
- [ ] Track git commits made during execution:
  ```bash
  # After any git commit in the repo
  COMMIT_SHA=$(git rev-parse HEAD)
  checkpoint_update "commits" "$COMMIT_SHA"
  ```

**Validation:** Run task to completion, verify state file contains accurate progress.

### Phase 3: Resume Logic

**Objective:** Workers resume from checkpoint on retry.

**Tasks:**
- [ ] Add retry detection in `entrypoint.sh`:
  ```bash
  # Check if this is a retry
  if checkpoint_load; then
    RESUMING=true
    RESUME_CONTEXT=$(cat /tmp/checkpoint.json | jq -r '.lastAction')
  fi
  ```
- [ ] Skip completed stages on resume:
  ```bash
  if [ "$RESUMING" = true ]; then
    STAGE=$(jq -r '.stage' /tmp/checkpoint.json)
    case $STAGE in
      "implementing"|"testing"|"committing"|"pr_creating")
        # Skip clone, go straight to repo
        cd /workspace/$REPO_NAME
        git checkout $(jq -r '.branch' /tmp/checkpoint.json)
        ;;
    esac
  fi
  ```
- [ ] Inject resume context into Claude prompt:
  ```bash
  if [ "$RESUMING" = true ]; then
    RESUME_PREFIX="IMPORTANT: This is a RESUMED task. Previous progress:
  - Stage reached: $STAGE
  - Files modified: $(jq -r '.filesModified | join(", ")' /tmp/checkpoint.json)
  - Commits made: $(jq -r '.commits | join(", ")' /tmp/checkpoint.json)
  - Last action: $RESUME_CONTEXT

  Continue from where you left off. Do NOT redo completed work.

  "
    PROMPT="${RESUME_PREFIX}${PROMPT}"
  fi
  ```
- [ ] Handle branch already exists scenario (checkout instead of create)

**Validation:**
1. Start task, kill it mid-execution
2. Retry task
3. Verify it resumes from checkpoint, doesn't redo work

### Phase 4: Spot Interruption Handling

**Objective:** Gracefully handle Spot instance termination.

**Tasks:**
- [ ] Add Spot interruption detection in entrypoint:
  ```bash
  # Check for Spot termination notice (2-minute warning)
  check_spot_termination() {
    if curl -s -f http://169.254.169.254/latest/meta-data/spot/instance-action > /dev/null 2>&1; then
      echo "Spot termination notice received, saving checkpoint..."
      checkpoint_update "pendingWork" "Spot interruption - was $CURRENT_STAGE"
      checkpoint_save
      exit 137  # Signal spot interruption
    fi
  }

  # Check every 5 seconds in background
  (while true; do sleep 5; check_spot_termination; done) &
  ```
- [ ] Ensure orchestrator recognizes exit code 137 as "retry with checkpoint" (already exists per CLAUDE.md)
- [ ] Add checkpoint validation before resume (don't resume from corrupted state)

**Validation:** Simulate Spot interruption, verify clean checkpoint save and successful resume.

### Phase 5: Dashboard Integration

**Objective:** Show checkpoint status in WorkerMill dashboard.

**Tasks:**
- [ ] Add `checkpoint` JSON column to `worker_tasks` table
- [ ] Update task log endpoint to include checkpoint data
- [ ] Display in task detail view:
  - Current stage progress bar
  - Files modified list
  - Commits made
  - "Resumed X times" indicator
- [ ] Add "Resume from checkpoint" manual action button (for stuck tasks)

**Validation:** View running task in dashboard, see live checkpoint updates.

### Phase 6: Cleanup and Monitoring

**Objective:** Maintain state storage and track resumption metrics.

**Tasks:**
- [ ] S3 lifecycle policy to delete state after 7 days (already in Phase 1)
- [ ] Add CloudWatch metrics:
  - `WorkerTasksResumed` - count of tasks that used checkpoints
  - `CheckpointSaveLatency` - time to save checkpoint
  - `WorkSavedByResume` - estimated minutes of work not redone
- [ ] Add alerting for checkpoint failures
- [ ] Log checkpoint events to task logs for debugging

**Validation:** Review metrics after running 20+ tasks with checkpointing enabled.

## Checkpoint Markers for Claude

Add to worker directives (`worker/directives/common/`):

```markdown
## Progress Checkpoints

When working on tasks, emit checkpoint markers to track progress:

- After analyzing the codebase: `::checkpoint::analyzing::Analyzed X files`
- When starting implementation: `::checkpoint::implementing::Starting work on Y`
- After modifying files: `::checkpoint::implementing::Modified Z`
- Before running tests: `::checkpoint::testing::Running test suite`
- After tests pass: `::checkpoint::testing::Tests passed`
- When creating commits: `::checkpoint::committing::Created commit for A`
- When creating PR: `::checkpoint::pr_creating::Opening pull request`

These markers help the system track progress and enable task resumption if interrupted.
```

## Configuration

### New Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CHECKPOINT_ENABLED` | `true` | Enable checkpointing |
| `CHECKPOINT_BUCKET` | (required) | S3 bucket for state |
| `CHECKPOINT_INTERVAL` | `60` | Seconds between auto-saves |

### New Organization Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `enableCheckpointing` | `true` | Enable checkpoints for org's tasks |

## Risk Mitigations

| Risk | Mitigation |
|------|------------|
| Corrupted checkpoint causes bad resume | Validate checkpoint schema before loading; fall back to fresh start |
| S3 adds latency | Local file primary, S3 sync in background |
| Claude ignores resume context | Make resume prefix very prominent; test with different phrasings |
| State file grows too large | Cap at 64KB; only store essential data |
| Clock skew issues | Use task ID as primary key, not timestamps |

## Rollback Strategy

1. Set `CHECKPOINT_ENABLED=false` to disable without code changes
2. Workers fall back to current behavior (fresh start on retry)
3. No database migrations to roll back

## Success Criteria

1. Spot interruptions result in successful resume 90%+ of the time
2. Resumed tasks complete without redoing previously committed work
3. No increase in task failure rate
4. Dashboard shows clear checkpoint status
5. Cost reduction visible in tasks that would have restarted

## Comparison to Ralph Integration

| Aspect | Checkpointing (this plan) | Ralph Integration |
|--------|---------------------------|-------------------|
| Complexity | Low | Medium-High |
| New dependencies | None | Ralph npm package |
| Resume granularity | Stage-level | Story-level |
| Planning capability | None | PRD → Plan → Stories |
| Risk | Low | Medium |
| Time to implement | ~3-5 phases | ~6 phases |

**Recommendation:** Implement checkpointing first. If more structured planning is needed later, Ralph can be added on top.

---

*Plan created: 2025-01-12*
*Status: Draft - Awaiting approval*

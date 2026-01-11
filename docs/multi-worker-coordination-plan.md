# Multi-Worker Coordination System for WorkerMill

## Overview

Enable multiple AI workers to execute tasks in parallel on the same repository without collisions, using a hybrid coordination approach: **real-time database tracking + git-based audit manifest**.

## Problem Statement

Currently, WorkerMill prevents collisions via persona-level serialization (1 active task per persona per org). This is safe but slow - workers queue even when they could work on different files in parallel.

**Goal**: Allow true parallel execution while preventing:
- Same file edits (merge conflicts)
- Git push races (non-fast-forward)
- Resource conflicts (test DBs, deploy slots, CI runners)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         WorkerMill API                                   │
│                                                                          │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐     │
│  │  Coordination   │    │   File Lock     │    │   Resource      │     │
│  │  Service        │◄───│   Manager       │    │   Manager       │     │
│  │                 │    │                 │    │                 │     │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘     │
│           │                      │                      │               │
│           ▼                      ▼                      ▼               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    PostgreSQL Database                           │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │   │
│  │  │ worker_     │  │ worker_     │  │ worker_resource_        │  │   │
│  │  │ check_ins   │  │ file_locks  │  │ reservations            │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ API Calls
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Worker Containers (ECS)                           │
│                                                                          │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐     │
│  │  Worker A       │    │  Worker B       │    │  Worker C       │     │
│  │  PROJ-101       │    │  PROJ-102       │    │  PROJ-103       │     │
│  │  backend_dev    │    │  frontend_dev   │    │  backend_dev    │     │
│  │                 │    │                 │    │                 │     │
│  │  Files:         │    │  Files:         │    │  Files:         │     │
│  │  - api/auth.ts  │    │  - ui/login.tsx │    │  - api/users.ts │     │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘     │
│           │                      │                      │               │
│           └──────────────────────┴──────────────────────┘               │
│                                  │                                       │
│                                  ▼                                       │
│                    ┌─────────────────────────┐                          │
│                    │  .workermill/           │                          │
│                    │  coordination.json      │                          │
│                    │  (Git Manifest)         │                          │
│                    └─────────────────────────┘                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### Table: `worker_check_ins`

Real-time status of active workers.

```sql
CREATE TABLE worker_check_ins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES worker_tasks(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id),
  worker_id VARCHAR(100) NOT NULL,  -- ECS task ID
  repo VARCHAR(255) NOT NULL,        -- e.g., "owner/repo"
  branch VARCHAR(255) NOT NULL,      -- e.g., "ai/PROJ-101"
  status VARCHAR(50) NOT NULL,       -- 'starting', 'analyzing', 'coding', 'testing', 'committing'
  current_file VARCHAR(500),         -- File currently being edited
  files_modified JSONB DEFAULT '[]', -- List of files touched so far
  heartbeat_at TIMESTAMP NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',       -- Extra context (model, persona, etc.)

  UNIQUE(task_id),
  INDEX idx_checkins_repo (org_id, repo),
  INDEX idx_checkins_heartbeat (heartbeat_at)
);
```

### Table: `worker_file_locks`

Pessimistic file-level locks.

```sql
CREATE TABLE worker_file_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  repo VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  task_id UUID NOT NULL REFERENCES worker_tasks(id) ON DELETE CASCADE,
  worker_id VARCHAR(100) NOT NULL,
  lock_type VARCHAR(20) NOT NULL,    -- 'exclusive' or 'shared'
  acquired_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,     -- Auto-release if worker dies

  UNIQUE(org_id, repo, file_path),   -- Only one lock per file
  INDEX idx_locks_expiry (expires_at)
);
```

### Table: `worker_resource_reservations`

Shared resource coordination.

```sql
CREATE TABLE worker_resource_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  resource_type VARCHAR(50) NOT NULL,  -- 'test_db', 'deploy_slot', 'ci_runner'
  resource_id VARCHAR(100) NOT NULL,   -- Specific resource identifier
  task_id UUID NOT NULL REFERENCES worker_tasks(id) ON DELETE CASCADE,
  worker_id VARCHAR(100) NOT NULL,
  acquired_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,

  UNIQUE(org_id, resource_type, resource_id),
  INDEX idx_resources_expiry (expires_at)
);
```

---

## Git Coordination Manifest

Each repository gets a `.workermill/coordination.json` file:

```json
{
  "version": "1.0",
  "lastUpdated": "2026-01-11T17:30:00Z",
  "activeWorkers": [
    {
      "taskId": "abc-123",
      "jiraKey": "PROJ-101",
      "branch": "ai/PROJ-101",
      "persona": "backend_developer",
      "startedAt": "2026-01-11T17:00:00Z",
      "status": "coding",
      "filesLocked": [
        "api/src/services/auth.ts",
        "api/src/routes/login.ts"
      ],
      "filesModified": [
        "api/src/services/auth.ts"
      ]
    },
    {
      "taskId": "def-456",
      "jiraKey": "PROJ-102",
      "branch": "ai/PROJ-102",
      "persona": "frontend_developer",
      "startedAt": "2026-01-11T17:15:00Z",
      "status": "testing",
      "filesLocked": [
        "frontend/src/pages/Login.tsx"
      ],
      "filesModified": [
        "frontend/src/pages/Login.tsx",
        "frontend/src/components/AuthForm.tsx"
      ]
    }
  ],
  "recentCompletions": [
    {
      "taskId": "ghi-789",
      "jiraKey": "PROJ-100",
      "completedAt": "2026-01-11T16:45:00Z",
      "result": "pr_merged",
      "prUrl": "https://github.com/owner/repo/pull/42"
    }
  ]
}
```

**Benefits:**
- Auditable history in git
- Workers can read without API call
- Humans can inspect coordination state
- Survives API outages

---

## API Endpoints

### Coordination Service

```
POST   /api/coordination/check-in
       Body: { taskId, workerId, repo, branch, status, currentFile?, filesModified? }
       Response: { success: true, conflicts: [] }

GET    /api/coordination/active-workers?repo=owner/repo
       Response: { workers: [...], fileLocks: [...] }

POST   /api/coordination/heartbeat
       Body: { taskId, status, currentFile? }
       Response: { success: true }

DELETE /api/coordination/check-out
       Body: { taskId }
       Response: { success: true }
```

### File Lock Service

```
POST   /api/coordination/locks/acquire
       Body: { taskId, repo, filePaths: [...], lockType: 'exclusive' }
       Response: { success: true, acquired: [...], conflicts: [...] }

POST   /api/coordination/locks/release
       Body: { taskId, filePaths: [...] }
       Response: { success: true }

GET    /api/coordination/locks?repo=owner/repo
       Response: { locks: [...] }

POST   /api/coordination/locks/check
       Body: { repo, filePaths: [...] }
       Response: { available: [...], locked: [...] }
```

### Resource Reservation Service

```
POST   /api/coordination/resources/reserve
       Body: { taskId, resourceType, resourceId?, ttlSeconds }
       Response: { success: true, resourceId, expiresAt }

POST   /api/coordination/resources/release
       Body: { taskId, resourceType, resourceId }
       Response: { success: true }
```

---

## Worker Protocol

### Phase 1: Check-In (Before Starting Work)

```bash
# In entrypoint.sh, after cloning repo

# 1. Announce presence
curl -X POST "${API_BASE}/api/coordination/check-in" \
  -H "x-api-key: ${ORG_API_KEY}" \
  -d '{
    "taskId": "'${TASK_ID}'",
    "workerId": "'${ECS_TASK_ID}'",
    "repo": "'${GITHUB_REPO}'",
    "branch": "'${BRANCH_NAME}'",
    "status": "starting",
    "metadata": {
      "persona": "'${WORKER_PERSONA}'",
      "model": "'${CLAUDE_MODEL}'",
      "jiraKey": "'${JIRA_ISSUE_KEY}'"
    }
  }'

# 2. Get active workers and check for conflicts
ACTIVE_WORKERS=$(curl -s "${API_BASE}/api/coordination/active-workers?repo=${GITHUB_REPO}")
echo "[coordination] Active workers on ${GITHUB_REPO}:"
echo "${ACTIVE_WORKERS}" | jq '.workers[] | "\(.jiraKey) (\(.persona)) - \(.status)"'
```

### Phase 2: File Lock Acquisition (Before Editing)

Claude's prompt includes instructions to acquire locks:

```markdown
## Coordination Protocol

Before editing any file, you MUST acquire a lock:

1. Call the lock API: `curl -X POST .../api/coordination/locks/acquire -d '{"filePaths": ["path/to/file.ts"]}'`
2. If `conflicts` array is non-empty, another worker has the file - choose a different approach
3. If `success: true`, proceed with editing
4. Release locks when done or if you decide not to edit

**Important**: Check `.workermill/coordination.json` to see what other workers are doing.
```

### Phase 3: Heartbeat (During Execution)

Background process sends heartbeats every 30 seconds:

```bash
# Heartbeat function
send_heartbeat() {
  curl -s -X POST "${API_BASE}/api/coordination/heartbeat" \
    -H "x-api-key: ${ORG_API_KEY}" \
    -d '{
      "taskId": "'${TASK_ID}'",
      "status": "executing",
      "currentFile": "'${CURRENT_FILE:-}'"
    }' >/dev/null
}

# Start heartbeat in background
while true; do
  send_heartbeat
  sleep 30
done &
HEARTBEAT_PID=$!
```

### Phase 4: Check-Out (After Completion)

```bash
# Before exiting
curl -X DELETE "${API_BASE}/api/coordination/check-out" \
  -H "x-api-key: ${ORG_API_KEY}" \
  -d '{"taskId": "'${TASK_ID}'"}'

# Kill heartbeat
kill $HEARTBEAT_PID 2>/dev/null
```

---

## Conflict Resolution Strategies

### Strategy 1: Wait and Retry

If a file is locked, worker waits for release:

```typescript
async function acquireLockWithRetry(filePath: string, maxWaitMs: number = 60000): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const result = await acquireLock(filePath);
    if (result.success) return true;

    // Wait and retry
    await sleep(5000);
  }

  return false; // Timeout - choose different approach
}
```

### Strategy 2: Alternative Approach

Claude is instructed to find alternative solutions:

```markdown
If you cannot acquire a lock on a file:
1. Check who has the lock and what they're doing
2. Consider if your change can be made in a different file
3. If the change is blocking, report conflict and let orchestrator decide
4. Never force-edit a locked file
```

### Strategy 3: Conflict Escalation

If workers genuinely need the same file:

```typescript
// API detects conflict
if (conflictingWorkers.length > 0) {
  // Notify orchestrator
  await notifyConflict({
    file: filePath,
    requestingWorker: taskId,
    holdingWorker: lockHolder.taskId,
    suggestion: 'queue_second_task'
  });

  // Orchestrator can:
  // 1. Requeue the second task to run after first completes
  // 2. Cancel one task and merge work
  // 3. Alert human for manual resolution
}
```

---

## Implementation Plan

### Phase 1: Database Schema (Migration)

**File:** `api/src/db/migrations/1704067200010-AddWorkerCoordination.ts`

```typescript
export class AddWorkerCoordination1704067200010 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // Create worker_check_ins table
    await queryRunner.query(`
      CREATE TABLE worker_check_ins (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id UUID NOT NULL REFERENCES worker_tasks(id) ON DELETE CASCADE,
        org_id UUID NOT NULL REFERENCES organizations(id),
        worker_id VARCHAR(100) NOT NULL,
        repo VARCHAR(255) NOT NULL,
        branch VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL,
        current_file VARCHAR(500),
        files_modified JSONB DEFAULT '[]',
        heartbeat_at TIMESTAMP NOT NULL DEFAULT NOW(),
        started_at TIMESTAMP NOT NULL DEFAULT NOW(),
        metadata JSONB DEFAULT '{}'
      );

      CREATE UNIQUE INDEX idx_checkins_task ON worker_check_ins(task_id);
      CREATE INDEX idx_checkins_repo ON worker_check_ins(org_id, repo);
      CREATE INDEX idx_checkins_heartbeat ON worker_check_ins(heartbeat_at);
    `);

    // Create worker_file_locks table
    await queryRunner.query(`
      CREATE TABLE worker_file_locks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id),
        repo VARCHAR(255) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        task_id UUID NOT NULL REFERENCES worker_tasks(id) ON DELETE CASCADE,
        worker_id VARCHAR(100) NOT NULL,
        lock_type VARCHAR(20) NOT NULL DEFAULT 'exclusive',
        acquired_at TIMESTAMP NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL
      );

      CREATE UNIQUE INDEX idx_locks_file ON worker_file_locks(org_id, repo, file_path);
      CREATE INDEX idx_locks_expiry ON worker_file_locks(expires_at);
    `);

    // Create worker_resource_reservations table
    await queryRunner.query(`
      CREATE TABLE worker_resource_reservations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id),
        resource_type VARCHAR(50) NOT NULL,
        resource_id VARCHAR(100) NOT NULL,
        task_id UUID NOT NULL REFERENCES worker_tasks(id) ON DELETE CASCADE,
        worker_id VARCHAR(100) NOT NULL,
        acquired_at TIMESTAMP NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL
      );

      CREATE UNIQUE INDEX idx_resources_unique ON worker_resource_reservations(org_id, resource_type, resource_id);
      CREATE INDEX idx_resources_expiry ON worker_resource_reservations(expires_at);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE worker_resource_reservations`);
    await queryRunner.query(`DROP TABLE worker_file_locks`);
    await queryRunner.query(`DROP TABLE worker_check_ins`);
  }
}
```

### Phase 2: TypeORM Models

**File:** `api/src/models/WorkerCheckIn.ts`
**File:** `api/src/models/WorkerFileLock.ts`
**File:** `api/src/models/WorkerResourceReservation.ts`

### Phase 3: Coordination Service

**File:** `api/src/services/coordination.ts`

Core methods:
- `checkIn(taskId, workerId, repo, branch, status, metadata)`
- `checkOut(taskId)`
- `heartbeat(taskId, status, currentFile)`
- `getActiveWorkers(orgId, repo)`
- `acquireFileLocks(taskId, repo, filePaths)`
- `releaseFileLocks(taskId, filePaths)`
- `reserveResource(taskId, resourceType, resourceId, ttlSeconds)`
- `releaseResource(taskId, resourceType, resourceId)`
- `cleanupExpiredLocks()` - Called by watcher

### Phase 4: API Routes

**File:** `api/src/routes/coordination.ts`

Endpoints:
- `POST /api/coordination/check-in`
- `DELETE /api/coordination/check-out`
- `POST /api/coordination/heartbeat`
- `GET /api/coordination/active-workers`
- `POST /api/coordination/locks/acquire`
- `POST /api/coordination/locks/release`
- `GET /api/coordination/locks`
- `POST /api/coordination/resources/reserve`
- `POST /api/coordination/resources/release`

### Phase 5: Worker Integration

**File:** `worker/entrypoint.sh` - Add check-in/out, heartbeat
**File:** `worker/src/coordination/client.ts` - API client for coordination
**File:** `worker/AGENTS.md` - Add coordination protocol instructions

### Phase 6: Git Manifest

**File:** `worker/src/coordination/manifest.ts`

Functions:
- `readManifest(repoPath)` - Parse .workermill/coordination.json
- `updateManifest(repoPath, workerInfo)` - Add/update worker entry
- `removeFromManifest(repoPath, taskId)` - Remove worker on completion
- `commitManifest(repoPath, message)` - Commit changes

### Phase 7: Orchestrator Updates

**File:** `api/src/services/orchestrator.ts`

Changes:
- Remove strict persona serialization for same repo
- Check file lock conflicts before spawning
- Allow parallel execution when no file conflicts
- Requeue tasks with `file_conflict` reason

### Phase 8: Watcher/Cleanup

**File:** `api/src/services/coordination-watcher.ts`

Scheduled job (every 1 minute):
- Clean up expired file locks
- Clean up stale check-ins (no heartbeat for 5+ minutes)
- Release resources from dead workers

---

## Files to Modify/Create

| File | Action | Description |
|------|--------|-------------|
| `api/src/db/migrations/1704067200010-AddWorkerCoordination.ts` | NEW | Database schema |
| `api/src/models/WorkerCheckIn.ts` | NEW | Check-in model |
| `api/src/models/WorkerFileLock.ts` | NEW | File lock model |
| `api/src/models/WorkerResourceReservation.ts` | NEW | Resource model |
| `api/src/services/coordination.ts` | NEW | Coordination service |
| `api/src/services/coordination-watcher.ts` | NEW | Cleanup job |
| `api/src/routes/coordination.ts` | NEW | API endpoints |
| `api/src/index.ts` | MODIFY | Register routes |
| `worker/entrypoint.sh` | MODIFY | Add check-in/heartbeat/check-out |
| `worker/src/coordination/client.ts` | NEW | API client |
| `worker/src/coordination/manifest.ts` | NEW | Git manifest handling |
| `worker/AGENTS.md` | MODIFY | Add coordination instructions |
| `api/src/services/orchestrator.ts` | MODIFY | Enable parallel execution |

---

## Verification Plan

### Unit Tests
- Coordination service: check-in, check-out, heartbeat
- File lock manager: acquire, release, conflict detection
- Resource manager: reserve, release, expiration

### Integration Tests
1. Two workers check in for same repo - should see each other
2. Worker A locks file, Worker B tries to lock same file - should fail
3. Worker A dies (no heartbeat), lock should expire and be available
4. Git manifest should be updated when workers check in/out

### End-to-End Tests
1. Create two Jira tickets for same repo, different files
2. Both should execute in parallel
3. Both should complete without conflicts
4. Manifest should show history of both workers

### Manual Verification
1. Dashboard shows active workers per repo
2. Logs show coordination check-in/out events
3. Git history shows manifest updates
4. No merge conflicts on concurrent PRs

---

## Success Criteria

- [ ] Multiple workers can run in parallel on same repo (different files)
- [ ] File locks prevent concurrent edits to same file
- [ ] Workers can see what other workers are doing
- [ ] Stale locks are automatically cleaned up
- [ ] Git manifest provides audit trail
- [ ] Dashboard shows real-time coordination status
- [ ] No merge conflicts from concurrent worker execution

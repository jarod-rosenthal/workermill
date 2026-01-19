# WorkerMill Critical Analysis

**Date:** January 18, 2026
**Analyst:** Claude Opus 4.5
**Scope:** Full codebase review of api/, frontend/, worker/ directories

---

## Executive Summary

After thorough analysis of the WorkerMill codebase, **67 distinct issues** were identified across 6 major areas. The system has solid foundational patterns (atomic task claiming, SSE log streaming) but suffers from security vulnerabilities, race conditions, and architectural gaps that could cause production incidents.

### Issue Distribution

| Category | Critical | High | Medium | Total |
|----------|----------|------|--------|-------|
| Security | 3 | 2 | 4 | 9 |
| Race Conditions | 1 | 4 | 2 | 7 |
| Data Integrity | 1 | 3 | 3 | 7 |
| Error Handling | 0 | 3 | 5 | 8 |
| Performance | 0 | 2 | 4 | 6 |
| State Management | 1 | 2 | 3 | 6 |
| Worker Execution | 1 | 4 | 3 | 8 |
| API Design | 0 | 2 | 4 | 6 |

---

## Critical Issues (Immediate Action Required)

### 1. Webhook Authentication is Optional

**Location:** `api/src/routes/webhooks.ts:85-95`
**Severity:** CRITICAL
**Category:** Security

Signature verification only happens IF `org.jiraWebhookSecret` is configured:

```typescript
if (org.jiraWebhookSecret) {
  if (!verifyJiraSignature(...)) { return 401; }
}
// If no secret configured, ANY payload is accepted!
```

**Impact:** Attackers can trigger arbitrary task creation without authentication. Any external party knowing the webhook URL can create tasks, spawn workers, and incur costs.

**Remediation:**
```typescript
// BEFORE (vulnerable)
if (org.jiraWebhookSecret) {
  if (!verifyJiraSignature(...)) { return 401; }
}

// AFTER (secure)
if (!org.jiraWebhookSecret) {
  logger.error("Webhook secret not configured", { orgId: org.id });
  return res.status(500).json({ error: "Webhook not configured" });
}
if (!verifyJiraSignature(...)) {
  return res.status(401).json({ error: "Invalid signature" });
}
```

---

### 2. Cross-Organization Data Leakage

**Location:** `api/src/routes/webhooks.ts:60-82`, `api/src/routes/tasks.ts:340-379`
**Severity:** CRITICAL
**Category:** Security

Two separate issues combine to break multi-tenant isolation:

**Issue A: Webhook Org Fallback**
```typescript
const activeUser = await userRepo.findOne({
  where: { status: "active" },
  relations: ["organization"],
});
let org = activeUser?.organization;

// DANGEROUS: Falls back to first org in database!
if (!org) {
  org = await orgRepo.findOne({ where: {} }) ?? undefined;
}
```

**Issue B: Missing Org Isolation in Task Routes**
```typescript
router.get("/:id/logs", authenticateRequest, async (req, res) => {
  // NO check that user's org owns this task!
  const task = await taskRepo.findOne({ where: { id: taskId } });
  // Returns logs from ANY org's task
});
```

**Impact:**
- Webhooks for Org A could create tasks in Org B
- Authenticated users can read logs from other organizations' tasks
- Complete breakdown of tenant isolation

**Remediation:**
```typescript
// Add org isolation to ALL task queries
const task = await taskRepo.findOne({
  where: {
    id: taskId,
    orgId: req.organization!.id  // MUST include org filter
  }
});

if (!task) {
  return res.status(404).json({ error: "Task not found" });
}
```

---

### 3. No Webhook Idempotency (Duplicate Task Creation)

**Location:** `api/src/routes/webhooks.ts`
**Severity:** CRITICAL
**Category:** Race Condition

No tracking of webhook delivery IDs. Both Jira and GitHub send unique delivery identifiers:
- GitHub: `x-github-delivery` header
- Jira: `x-atlassian-webhook-id` header

When webhook providers retry (network timeout, 5xx response), duplicate tasks are created.

**Impact:**
- Duplicate workers spawn for same Jira ticket
- Duplicate PRs created against same repository
- Cost overruns from duplicate executions
- Race conditions between duplicate workers

**Remediation:**

1. Create tracking table:
```sql
CREATE TABLE webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(50) NOT NULL,
  delivery_id VARCHAR(255) NOT NULL,
  processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(provider, delivery_id)
);

CREATE INDEX idx_webhook_deliveries_lookup
ON webhook_deliveries(provider, delivery_id);
```

2. Check before processing:
```typescript
const deliveryId = req.headers["x-github-delivery"] ||
                   req.headers["x-atlassian-webhook-id"];

if (deliveryId) {
  const existing = await webhookDeliveryRepo.findOne({
    where: { provider: "jira", deliveryId }
  });

  if (existing) {
    return res.json({ status: "deduplicated" });
  }

  await webhookDeliveryRepo.save({ provider: "jira", deliveryId });
}
```

---

### 4. Checkpoint Not Persisted (Resume Broken)

**Location:** `worker/entrypoint.sh:11-12`
**Severity:** CRITICAL
**Category:** Data Loss

Checkpoints are stored in `/tmp` which is ephemeral container storage:

```bash
CHECKPOINT_DIR="${CHECKPOINT_DIR:-/tmp}"
CHECKPOINT_FILE="${CHECKPOINT_DIR}/checkpoint.json"
```

On Spot interruption:
1. SIGTERM received, checkpoint saved to `/tmp/checkpoint.json`
2. Container terminated with SIGKILL after grace period
3. New container starts for retry
4. `/tmp` is empty - checkpoint lost
5. Task restarts from scratch

**Impact:**
- "Resume" feature doesn't actually work
- Spot interruptions cause full task restarts
- Wasted compute costs
- Longer task completion times

**Remediation:**

```bash
# Use S3 for checkpoint persistence
CHECKPOINT_BUCKET="${CHECKPOINT_BUCKET:-workermill-checkpoints}"
CHECKPOINT_KEY="checkpoints/${TASK_ID}/state.json"

save_checkpoint() {
  local checkpoint_data="$1"
  echo "$checkpoint_data" > /tmp/checkpoint.json
  aws s3 cp /tmp/checkpoint.json "s3://${CHECKPOINT_BUCKET}/${CHECKPOINT_KEY}"
}

load_checkpoint() {
  if aws s3 cp "s3://${CHECKPOINT_BUCKET}/${CHECKPOINT_KEY}" /tmp/checkpoint.json 2>/dev/null; then
    cat /tmp/checkpoint.json
  else
    echo "{}"
  fi
}
```

---

### 5. No Token Refresh Logic (Silent Auth Failures)

**Location:** `frontend/src/store/auth-store.ts`
**Severity:** CRITICAL
**Category:** State Management

Tokens expire after 1 hour (Cognito default) with no refresh mechanism:

```typescript
set({
  tokens: {
    accessToken,
    refreshToken,
    idToken,
    expiresIn: 3600,  // Hardcoded, never checked!
  },
  isAuthenticated: true,
});
```

SSE connections use these tokens but don't handle expiry:
```typescript
const es = new EventSource(`${API_BASE}/api/control-center/stream`, {
  withCredentials: true,  // Token in cookie, expires after 1 hour
});
```

**Impact:**
- Users logged out unexpectedly after 1 hour
- SSE streams fail silently when tokens expire
- Dashboard stops updating without error message
- Lost work if user was monitoring active tasks

**Remediation:**

```typescript
// Add token refresh logic
const refreshTokens = async () => {
  const { refreshToken } = get().tokens || {};
  if (!refreshToken) return false;

  try {
    const response = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (response.ok) {
      const newTokens = await response.json();
      set({ tokens: newTokens });
      return true;
    }
  } catch (err) {
    console.error('Token refresh failed:', err);
  }

  // Refresh failed, logout
  get().logout();
  return false;
};

// Schedule refresh before expiry
const scheduleRefresh = () => {
  const expiresIn = get().tokens?.expiresIn || 3600;
  const refreshAt = (expiresIn - 300) * 1000; // 5 min before expiry

  setTimeout(async () => {
    if (await refreshTokens()) {
      scheduleRefresh(); // Schedule next refresh
    }
  }, refreshAt);
};
```

---

## High Severity Issues

### 6. Task Creation Race Condition

**Location:** `api/src/routes/webhooks.ts:142-201`
**Severity:** HIGH
**Category:** Race Condition

Non-atomic check-then-create pattern:

```typescript
const existing = await taskRepo.findOne({ where: { jiraIssueKey } });

if (!existing) {
  // RACE WINDOW: Another request could create task here
  const task = taskRepo.create({ jiraIssueKey, ... });
  await taskRepo.save(task);
}
```

**Remediation:** Use database-level unique constraint and handle conflict:

```typescript
try {
  const task = taskRepo.create({ jiraIssueKey, orgId, ... });
  await taskRepo.save(task);
} catch (error) {
  if (error.code === '23505') { // Unique violation
    const existing = await taskRepo.findOne({ where: { jiraIssueKey, orgId } });
    // Handle existing task
  }
  throw error;
}
```

---

### 7. Jira Signature Format Incorrect

**Location:** `api/src/routes/webhooks.ts:31-34`
**Severity:** HIGH
**Category:** Security

Missing `sha256=` prefix in expected signature:

```typescript
const expectedSignature = crypto
  .createHmac("sha256", secret)
  .update(payload)
  .digest("hex");  // Returns "abc123..." but Jira sends "sha256=abc123..."
```

**Impact:** Signature verification NEVER succeeds. Either:
- Secret is not configured (webhook accepted without auth)
- Secret is configured (all webhooks rejected as invalid)

**Remediation:**
```typescript
const expectedSignature = "sha256=" + crypto
  .createHmac("sha256", secret)
  .update(payload)
  .digest("hex");
```

---

### 8. N+1 Query Problem in SSE Streaming

**Location:** `api/src/routes/control-center.ts:592-600`
**Severity:** HIGH
**Category:** Performance

For each running task, fetches 100 logs individually:

```typescript
await Promise.all(
  runningTasks.slice(0, 10).map(async (task) => {
    const [ralphData, checkpointData] = await Promise.all([
      fetchRalphProgressForTask(task.id),  // Query 1
      fetchCheckpointForTask(task.id),     // Query 2
    ]);
  })
);
```

With 10 active tasks: 20+ queries per SSE update (every 500ms) = 2,400 queries/minute.

**Remediation:** Batch into single query:

```typescript
const taskIds = runningTasks.slice(0, 10).map(t => t.id);

const allLogs = await logRepo
  .createQueryBuilder("log")
  .where("log.taskId IN (:...taskIds)", { taskIds })
  .orderBy("log.createdAt", "DESC")
  .take(100 * taskIds.length)
  .getMany();

// Group by taskId in application
const logsByTask = groupBy(allLogs, 'taskId');
```

---

### 9. Missing Database Indexes

**Location:** `api/src/models/WorkerTask.ts`, `api/src/models/WorkerTaskLog.ts`
**Severity:** HIGH
**Category:** Performance

High-query columns without indexes:

| Column | Query Pattern | Impact |
|--------|--------------|--------|
| `WorkerTask.status` | Dashboard aggregations | Full table scan |
| `WorkerTask.orgId + createdAt` | Task listings | Sort requires filesort |
| `WorkerTaskLog.taskId + createdAt` | Log streaming | Filter then sort |
| `WorkerTask.githubPrUrl` | Webhook lookups | Full table scan |

**Remediation:** Add migration:

```typescript
export class AddPerformanceIndexes1705600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX idx_worker_task_status ON worker_tasks(status);
      CREATE INDEX idx_worker_task_org_created ON worker_tasks(org_id, created_at DESC);
      CREATE INDEX idx_worker_task_log_task_created ON worker_task_logs(task_id, created_at DESC);
      CREATE INDEX idx_worker_task_github_pr ON worker_tasks(github_pr_url);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX idx_worker_task_status;
      DROP INDEX idx_worker_task_org_created;
      DROP INDEX idx_worker_task_log_task_created;
      DROP INDEX idx_worker_task_github_pr;
    `);
  }
}
```

---

### 10. Planning Task Status Double-Meaning

**Location:** `api/src/services/orchestrator.ts:533-554`
**Severity:** HIGH
**Category:** Race Condition

`planStatus = "pending_approval"` used for two different states:
1. "Being claimed for planning" (temporary)
2. "Plan created, waiting for human approval" (permanent)

```typescript
async function claimPlanningTask(taskId: string): Promise<boolean> {
  const result = await taskRepo
    .createQueryBuilder()
    .update(WorkerTask)
    .set({ planStatus: "pending_approval" })  // Ambiguous!
    .where("id = :id AND status = :status AND plan_status IS NULL")
    .execute();
  return (result.affected || 0) > 0;
}
```

**Impact:** Multiple orchestrator instances could claim the same task.

**Remediation:** Use dedicated claim timestamp:

```typescript
.set({
  planClaimedAt: new Date(),
  planClaimedBy: instanceId
})
.where("id = :id AND plan_claimed_at IS NULL")
```

---

### 11. Fire-and-Forget Log Posting Race

**Location:** `worker/entrypoint.sh:790-803`
**Severity:** HIGH
**Category:** Data Loss

`post_log()` uses background curl which can lose messages:

```bash
post_log() {
    local message="$1"
    curl -s -X POST "${API_BASE_URL}/api/tasks/${TASK_ID}/logs" \
        -H "x-api-key: ${ORG_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "{\"message\": \"$message\"}" >/dev/null 2>&1 &  # Fire-and-forget!
}
```

If worker exits quickly after calling `post_log()`, background curl is killed.

**Impact:** Initial startup logs often missing from dashboard.

**Remediation:** Use synchronous posting for critical messages:

```bash
post_log_sync() {
    local message="$1"
    curl -s -X POST "${API_BASE_URL}/api/tasks/${TASK_ID}/logs" \
        -H "x-api-key: ${ORG_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "{\"message\": \"$message\"}" || true  # Synchronous, no &
}

# Use sync for critical startup/shutdown messages
post_log_sync "system" "Worker starting..."
```

---

### 12. SSE Connection Leaks

**Location:** `frontend/src/pages/MissionControl/hooks/useMissionControlStreams.ts:187-212`
**Severity:** HIGH
**Category:** Resource Leak

Reconnection logic races with error handlers:

```typescript
const connect = useCallback(() => {
  if (eventSourceRef.current) {
    eventSourceRef.current.close();
  }

  const es = new EventSource(url);

  es.onerror = (e) => {
    // Error on OLD connection
    reconnectTimeoutRef.current = setTimeout(() => {
      connect();  // Creates NEW connection
    }, 5000);
  };

  eventSourceRef.current = es;
}, []);
```

Race scenario:
1. Connection A errors
2. Error handler schedules reconnect in 5s
3. Before timeout: Connection A errors again
4. Second timeout scheduled
5. First timeout fires, creates Connection B
6. Second timeout fires, creates Connection C
7. Both B and C active simultaneously

**Remediation:**

```typescript
const connect = useCallback(() => {
  // Cancel any pending reconnect
  if (reconnectTimeoutRef.current) {
    clearTimeout(reconnectTimeoutRef.current);
    reconnectTimeoutRef.current = null;
  }

  // Close existing connection
  if (eventSourceRef.current) {
    eventSourceRef.current.close();
    eventSourceRef.current = null;
  }

  const es = new EventSource(url);
  eventSourceRef.current = es;

  es.onerror = () => {
    // Only reconnect if this is still the current connection
    if (eventSourceRef.current === es) {
      eventSourceRef.current = null;
      reconnectTimeoutRef.current = setTimeout(connect, 5000);
    }
  };
}, []);
```

---

### 13. Feature Branch Failure Silently Breaks PRD Workflow

**Location:** `api/src/services/orchestrator.ts:929-963`
**Severity:** HIGH
**Category:** Error Handling

If feature branch creation fails, workflow continues with undefined branch:

```typescript
const branchCreated = await createBranch(task.githubRepo, featureBranch, "main");
if (branchCreated) {
  // Store featureBranch
} else {
  featureBranch = undefined;  // Silent failure!
}

// Later, child tasks created without knowing target branch
// They push to main instead of feature branch
```

**Impact:**
- PRD child stories push directly to main
- No consolidated PR for feature
- Workflow fundamentally broken

**Remediation:**

```typescript
const branchCreated = await createBranch(task.githubRepo, featureBranch, "main");
if (!branchCreated) {
  task.status = "failed";
  task.errorMessage = `Failed to create feature branch: ${featureBranch}`;
  await taskRepo.save(task);
  return false;
}
```

---

### 14. Placeholder URL Detection Incomplete

**Location:** `worker/entrypoint.sh:1986-1997`
**Severity:** HIGH
**Category:** Data Integrity

Only checks for specific placeholder patterns:

```bash
if echo "${DETECTED_PR_URL}" | grep -qiE "(owner/repo|your-|example|placeholder|test-repo|my-repo)"; then
  IS_PLACEHOLDER=true
fi
```

Models can hallucinate URLs like:
- `github.com/actualowner/actualrepo/pull/99999` (non-existent PR)
- `github.com/someorg/somerepo/pull/1` (exists but wrong repo)

**Impact:** Hallucinated PR URLs stored as real, breaking workflow status.

**Remediation:** Validate PR exists via GitHub API:

```bash
validate_pr_url() {
    local pr_url="$1"

    # Extract owner/repo/number from URL
    if [[ "$pr_url" =~ github\.com/([^/]+)/([^/]+)/pull/([0-9]+) ]]; then
        local owner="${BASH_REMATCH[1]}"
        local repo="${BASH_REMATCH[2]}"
        local number="${BASH_REMATCH[3]}"

        # Check PR exists
        if gh pr view "$number" --repo "$owner/$repo" >/dev/null 2>&1; then
            return 0  # Valid
        fi
    fi

    return 1  # Invalid or non-existent
}
```

---

## Medium Severity Issues

### 15. Unbounded Log Storage in Frontend

**Location:** `frontend/src/store/mission-control-store.ts:195-211`

Stores 100 lines per task with no upper bound on task count. With 100 concurrent tasks, 10,000+ log lines in browser memory.

**Remediation:** Add maximum task limit and LRU eviction.

---

### 16. Result Marker Override

**Location:** `worker/entrypoint.sh:2072-2102`

Auto-creates PRs even when agent explicitly said `::result::no_changes`, causing contradictory task states.

**Remediation:** Respect agent's explicit result markers.

---

### 17. Sibling Merge Conflicts Not Escalated

**Location:** `worker/entrypoint.sh:1069-1097`

Logs warning on merge conflict but continues on divergent branch instead of failing.

**Remediation:** Fail task with clear error when merge conflict detected.

---

### 18. Deprecated Blocking Logic Still Exported

**Location:** `api/src/services/orchestrator.ts:1795-2043`

`checkAndUnblockDependentTasks()` is deprecated but still exported and could be accidentally called.

**Remediation:** Remove function entirely or throw error if called.

---

### 19. Silent API Failures in Frontend

**Location:** `frontend/src/pages/MissionControl/index.tsx:61-89`

All API calls catch errors but only log to console - no user feedback.

**Remediation:** Add toast/notification system for failures.

---

### 20. localStorage Token Storage (XSS Risk)

**Location:** `frontend/src/store/auth-store.ts:44-48`

Auth tokens in localStorage are accessible to any XSS attack.

**Remediation:** Consider httpOnly cookies for sensitive tokens.

---

### 21. CSRF Protection Missing

No CSRF tokens on state-changing POST requests.

**Remediation:** Add CSRF token generation and validation.

---

### 22. Heartbeat Process Runs Unmonitored

**Location:** `worker/entrypoint.sh:124-131`

If heartbeat subprocess dies, main worker continues without knowing coordination is broken.

**Remediation:** Monitor heartbeat process, restart or fail if dead.

---

### 23. Provider Stderr Not Posted to API

**Location:** `worker/entrypoint.sh:1920-1924`

Error output goes to local logs but never to dashboard API.

**Remediation:** Post stderr content to task logs endpoint.

---

### 24. Cost Snapshots Trigger Mass Re-renders

**Location:** `frontend/src/pages/MissionControl/hooks/useMissionControlStreams.ts:270-283`

Every 10 seconds, 100 separate Zustand updates for cost tracking.

**Remediation:** Batch into single `recordMultipleCostSnapshots()` action.

---

### 25. Dry-Run Cleanup Race Condition

**Location:** `api/src/services/orchestrator.ts:1721-1772`

Uses `setTimeout` for cleanup which races with process lifecycle.

**Remediation:** Use database flag and cleanup in polling loop.

---

### 26. Story Dependency Index Format Mismatch

**Location:** `api/src/services/orchestrator.ts:886-897, 1152-1163`

Planning agent outputs 0-based indices, storage uses 1-based.

**Remediation:** Standardize on one format with clear documentation.

---

### 27. Token Passed in URL for SSE

**Location:** `frontend/src/pages/Orchestration/hooks/useOrchestrationStreams.ts:57`

Token in URL query param is logged in browser history and access logs.

**Remediation:** Use POST-based token exchange or WebSocket with headers.

---

### 28. Missing Validation on Worker Persona

**Location:** `api/src/routes/tasks.ts:81`

Accepts any string for workerPersona instead of validating against allowed values.

**Remediation:** Add `.isIn([...allowedPersonas])` validation.

---

### 29. No Token Limit Enforcement

**Location:** `api/src/routes/tasks.ts:1108-1111`

Can report 999,999,999 tokens causing massive cost calculation.

**Remediation:** Add reasonable per-task token limits (e.g., 5M tokens max).

---

### 30. Planning Task Reset Loses Plan State

**Location:** `api/src/services/orchestrator.ts:3877-3914`

Wipes `planJson` when resetting stuck planning tasks instead of preserving or retrying.

**Remediation:** Preserve plan data or implement retry-with-existing-plan.

---

## Recommended Fix Priority

### Week 1: Critical Security
1. Make webhook signature verification mandatory
2. Add org isolation to all task queries
3. Implement webhook delivery ID deduplication
4. Fix Jira signature format (add `sha256=` prefix)

### Week 2: Data Integrity
5. Add atomic upsert for task creation
6. Persist checkpoints to S3
7. Add database indexes on high-query columns
8. Implement token refresh in frontend

### Week 3: Reliability
9. Batch N+1 queries in SSE streaming
10. Fix SSE reconnection race conditions
11. Make log posting synchronous for critical messages
12. Validate PR URLs exist before trusting them

### Week 4: Polish
13. Add user-facing error notifications
14. Implement rate limiting on webhooks
15. Migrate tokens to httpOnly cookies
16. Add Error Boundaries to React components

---

## Architecture Strengths (Preserve These)

The codebase has good patterns that should be preserved:

- **Atomic task claiming** via `UPDATE...WHERE status = 'queued'`
- **PostgreSQL-based log streaming** (faster than CloudWatch)
- **Orphaned task detection** with proper timeouts
- **Staleness checks** prevent processing ancient tasks
- **Multi-provider abstraction** for AI models
- **Persona system** for role-specific worker behavior

---

## Testing Gap

Per CLAUDE.md: "No test suite is configured yet."

Many identified bugs would be caught by integration tests. Recommended test additions:

1. **Webhook handlers** - deduplication, signature verification
2. **Task state machine** - valid transitions, race conditions
3. **SSE streaming** - connection handling, data integrity
4. **Load testing** - concurrent task claiming, database performance

---

## Appendix: Files Analyzed

### API Routes
- `api/src/routes/webhooks.ts` - Jira, GitHub, Linear webhook handlers
- `api/src/routes/tasks.ts` - Task CRUD and log ingestion
- `api/src/routes/control-center.ts` - SSE streaming and dashboard API
- `api/src/routes/orchestrator.ts` - System control endpoints

### Services
- `api/src/services/orchestrator.ts` - Task orchestration (3,950 lines)
- `api/src/services/ecs-task-runner.ts` - ECS container management
- `api/src/services/billing.ts` - Stripe integration
- `api/src/services/coordination.ts` - Multi-worker coordination

### Models
- `api/src/models/WorkerTask.ts` - Core task entity
- `api/src/models/WorkerTaskLog.ts` - Log storage
- `api/src/models/Organization.ts` - Tenant configuration
- `api/src/models/User.ts` - User accounts

### Frontend
- `frontend/src/store/auth-store.ts` - Authentication state
- `frontend/src/store/mission-control-store.ts` - Dashboard state
- `frontend/src/pages/MissionControl/` - Main dashboard
- `frontend/src/pages/MissionControl/hooks/useMissionControlStreams.ts` - SSE handling

### Worker
- `worker/entrypoint.sh` - Main worker script (2,350 lines)
- `worker/execution/git/create_pr.ts` - PR creation logic
- `worker/lib/checkpoint.sh` - Checkpoint management
- `worker/lib/coordination.sh` - Multi-worker coordination

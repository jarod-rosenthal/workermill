# Unified SSE Multiplexer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace all polling loops and per-resource SSE connections with a single multiplexed SSE stream per client, using Redis pub/sub for fan-out.

**Architecture:** One `GET /api/stream` SSE endpoint per client. Redis-mediated subscription management so any API instance can handle subscribe/unsubscribe. CloudWatch EMF metrics for auto-scaling on connection count.

**Tech Stack:** Express, Redis (ioredis, already in use), CloudWatch Embedded Metric Format (`aws-embedded-metrics`), TypeORM replication, PgBouncer, Vitest, supertest.

**Design Doc:** `docs/plans/2026-02-26-unified-sse-multiplexer-design.md`

---

## Phase 0: Database Foundation

Fix pre-existing PgBouncer config issues and prepare read replica infrastructure BEFORE adding SSE.

---

### Task 0A: Fix PgBouncer Config on API ECS Task Definition

PgBouncer sidecar **already exists** on the API ECS task (`main.tf:208-241`). However, there's a pre-existing bug: `DB_POOL_MAX=60` (TypeORM pool) exceeds `MAX_CLIENT_CONN=50` (PgBouncer limit), causing connection refusals under sustained load. Also increase `DEFAULT_POOL_SIZE` from 8 to 10 for SSE write burst headroom.

**Files:**
- Modify: `infrastructure/terraform/modules/ecs-service/main.tf` (PgBouncer container config, lines 208-241)

**Context:**
- PgBouncer sidecar is at `main.tf:208-241` with `DEFAULT_POOL_SIZE=8`, `MAX_CLIENT_CONN=50`
- API container already sets `PGBOUNCER_HOST=127.0.0.1`, `PGBOUNCER_PORT=5432` (`main.tf:165-166`)
- API container already has `dependsOn: [{ containerName: "pgbouncer", condition: "START" }]` (`main.tf:204-206`)
- TypeORM already disables prepared statements when `PGBOUNCER_HOST` is set (`connection.ts:302`)

**Step 1: Update PgBouncer environment in main.tf**

In `infrastructure/terraform/modules/ecs-service/main.tf`, update the PgBouncer container's environment (lines 215-224):

Change `DEFAULT_POOL_SIZE` from `"8"` to `"10"`:
```hcl
{ name = "DEFAULT_POOL_SIZE", value = "10" },
```

Change `MAX_CLIENT_CONN` from `"50"` to `"100"`:
```hcl
{ name = "MAX_CLIENT_CONN", value = "100" },
```

**Step 2: Run Terraform plan**

```bash
cd infrastructure/terraform && terraform plan
```

Verify: Only the API task definition changes (PgBouncer environment values). No other resources affected.

**Step 3: Deploy**

```bash
./deploy.sh --api
```

**Step 4: Verify connections**

Connect to bastion and check RDS connection count:

```sql
SELECT count(*) FROM pg_stat_activity WHERE datname = 'workermill';
```

Should show ~24-30 connections (10 per PgBouncer × 2 API instances + 8 orchestrator). Verify no PgBouncer connection errors in CloudWatch logs.

**Step 5: Commit**

```bash
git commit -m "infra: fix PgBouncer MAX_CLIENT_CONN (50→100), increase pool size (8→10)"
```

---

### Task 0B: Add Read Replica Terraform Resource (Disabled by Default)

Add a read replica resource for future use. Keep RDS at `db.t4g.micro` for now — PgBouncer fixes make connection exhaustion a non-issue, and instance upgrade can happen later when CPU/memory metrics warrant it (5-10 min downtime, schedule during low traffic).

**Files:**
- Modify: `infrastructure/terraform/modules/database/main.tf` (instance class, add replica)
- Modify: `infrastructure/terraform/modules/database/outputs.tf` (add replica endpoint output)
- Modify: `infrastructure/terraform/modules/database/variables.tf` (add replica toggle)

**Step 1: Add read replica resource**

```hcl
resource "aws_db_instance" "read_replica" {
  count = var.enable_read_replica ? 1 : 0

  identifier          = "workermill-${var.environment}-replica"
  replicate_source_db = aws_db_instance.main.identifier
  instance_class      = var.replica_instance_class

  # Replica inherits storage from primary
  storage_type = "gp3"

  # Network — same security group and subnet as primary
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false

  # No separate backup (primary handles it)
  backup_retention_period = 0

  # Performance Insights disabled (cost)
  performance_insights_enabled = false

  # Deletion protection
  deletion_protection = true

  tags = {
    Name = "workermill-${var.environment}-replica"
  }
}
```

**Step 2: Add variables**

```hcl
variable "enable_read_replica" {
  description = "Enable RDS read replica"
  type        = bool
  default     = false
}

variable "replica_instance_class" {
  description = "Instance class for read replica"
  type        = string
  default     = "db.t4g.small"
}
```

**Step 3: Add outputs**

```hcl
output "replica_endpoint" {
  description = "RDS read replica endpoint"
  value       = var.enable_read_replica ? aws_db_instance.read_replica[0].endpoint : ""
}

output "replica_address" {
  description = "RDS read replica address (hostname only)"
  value       = var.enable_read_replica ? aws_db_instance.read_replica[0].address : ""
}
```

**Step 4: Terraform plan**

```bash
cd infrastructure/terraform && terraform plan
```

Review: should only show new resources with `count = 0` (no actual changes since `enable_read_replica` defaults to `false`).

**Step 5: Commit**

```bash
git commit -m "infra: add read replica Terraform resource (disabled by default)"
```

---

### Task 0C: Wire TypeORM Read Replica Support

Configure TypeORM to route read queries to the replica when available.

**Files:**
- Modify: `api/src/db/connection.ts` (add replication config)
- Modify: `infrastructure/terraform/modules/ecs-service/main.tf` (add `DB_REPLICA_HOST` env var)

**Step 1: Update connection.ts for replication**

```typescript
// After existing dbConnectionOptions
const replicaHost = process.env.DB_REPLICA_HOST;
const pgbouncerHost = process.env.PGBOUNCER_HOST;
const pgbouncerPort = parseInt(process.env.PGBOUNCER_PORT || "5432");
const pgbouncerReplicaPort = parseInt(process.env.PGBOUNCER_REPLICA_PORT || "5433");

export const AppDataSource = new DataSource({
  type: "postgres",
  ...(replicaHost
    ? {
        replication: {
          master: {
            ...dbConnectionOptions,
            ...(pgbouncerHost ? { host: pgbouncerHost, port: pgbouncerPort } : {}),
          },
          slaves: [{
            ...dbConnectionOptions,
            // CRITICAL: Route replica traffic through PgBouncer too (port 5433).
            // Without this, TypeORM opens DB_POOL_MAX direct connections to the
            // replica, bypassing PgBouncer entirely.
            ...(pgbouncerHost
              ? { host: pgbouncerHost, port: pgbouncerReplicaPort }
              : { host: replicaHost, port: parseInt(process.env.DB_REPLICA_PORT || "5432") }),
          }],
        },
      }
    : dbConnectionOptions),
  extra: {
    max: parseInt(process.env.DB_POOL_MAX || "10", 10),
    min: 1,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
    ...(pgbouncerHost ? { prepareStatements: false } : {}),
  },
  // ... entities, migrations unchanged
});
```

When `DB_REPLICA_HOST` is not set, TypeORM operates with a single connection (current behavior). When set, TypeORM routes `find*()` / `getMany()` / `getOne()` to the replica — through PgBouncer on port 5433.

**PgBouncer replica listener:** The simplest approach is a **second PgBouncer sidecar container** in the ECS task definition, dedicated to the replica. This avoids custom config files and uses the same Bitnami image with env vars:

```hcl
# In main.tf, add alongside existing pgbouncer container (only when replica is enabled):
{
  name      = "pgbouncer-replica"
  image     = var.pgbouncer_image
  essential = false  # replica is optional — API works without it
  environment = [
    { name = "POOL_MODE", value = "transaction" },
    { name = "DEFAULT_POOL_SIZE", value = "8" },
    { name = "MAX_CLIENT_CONN", value = "100" },
    { name = "LISTEN_ADDR", value = "127.0.0.1" },
    { name = "LISTEN_PORT", value = "5433" },  # Different port from primary PgBouncer
    { name = "AUTH_TYPE", value = "plain" },
  ]
  secrets = [
    { name = "DATABASE_URL", valueFrom = var.db_replica_url_secret_arn }  # Points at replica
  ]
  cpu = 64, memory = 128
}
```

Add `PGBOUNCER_REPLICA_PORT=5433` to the API container environment. TypeORM connects to `127.0.0.1:5433` for reads, which PgBouncer-replica routes to the RDS replica. This container is only added when `var.enable_read_replica` is true.

**Step 2: Add env var to ECS task definition**

In `main.tf`, add to API container environment (conditionally):

```json
{ "name": "DB_REPLICA_HOST", "value": "${var.db_replica_host}" }
```

With a new variable defaulting to `""` (empty = no replica).

**Step 3: Test locally without replica**

```bash
cd api && npm run test
```

All tests should pass — the replication config is only activated when `DB_REPLICA_HOST` is set.

**Step 4: Test with mock replica (same host)**

Set `DB_REPLICA_HOST` to the same host as primary. Verify queries still work (TypeORM uses the replica pool for reads).

**Step 5: Commit**

```bash
git commit -m "feat: TypeORM read replica support — routes reads to replica when DB_REPLICA_HOST is set"
```

---

## Phase 1: Server-Side Foundation

Build all new endpoints and Redis publish infrastructure. No client changes. Old endpoints unchanged.

**Prerequisite:** Phase 0 (PgBouncer config fix) should be deployed first.

---

### Task 1: Redis Publish on All Write Paths

Add Redis PUBLISH calls to every write path that feeds real-time data. These publishes are fire-and-forget (existing pattern in `redis-client.ts`). The unified SSE writer (Task 3) will subscribe to these topics.

**Files:**
- Modify: `api/src/routes/control-center/logs.ts` (log ingestion POST handler)
- Modify: `api/src/routes/control-center/code-events.ts` (code event POST handler)
- Modify: `api/src/routes/coordination.ts` (coordination write handlers)
- Modify: `api/src/services/redis-client.ts` (add publish helper for stream topics)
- Modify: Various task state change locations (task-claimer.ts, task-monitor.ts, orchestrator.ts)
- Test: `api/src/routes/control-center/logs.test.ts` (new)

**Context:**
- Redis client is at `api/src/services/redis-client.ts`, singleton export `redis`
- Existing pattern: `redis.publish(channel, payload)` — fire-and-forget, catches errors silently
- Coordination already publishes: `redis.publishContext(parentTaskId, context)` on channel `coordination:{parentTaskId}`
- Logs and code events currently only use in-memory EventEmitters (no Redis publish)

**Step 1: Add stream topic publish helpers to redis-client.ts**

Add methods to `RedisService` class in `api/src/services/redis-client.ts`:

```typescript
publishStreamEvent(topic: string, event: Record<string, unknown>): void {
  if (!this.isConnected) return;
  this.pub.publish(`stream:${topic}`, JSON.stringify(event)).catch(() => {});
}

// Create a new ioredis subscriber connection for per-session SSE subscriptions.
// Each SSE session gets its own subscriber to avoid shared-subscriber
// scalability ceiling and refcount bugs.
createSubscriber(): Redis {
  return new Redis(this.url, {
    ...this.options,
    lazyConnect: true,
    enableReadyCheck: false,
  });
}
```

Topic naming convention:
- `stream:org:{orgId}:tasks` — task lifecycle
- `stream:task:{taskId}:logs` — log lines
- `stream:task:{taskId}:coordination` — coordination messages
- `stream:task:{taskId}:code` — code events
- `stream:task:{taskId}:cost` — cost ticks

**Step 2: Add Redis publish to log ingestion**

In `api/src/routes/control-center/logs.ts`, after the DB insert in the POST handler (around line 530), add:

```typescript
redis.publishStreamEvent(`task:${taskId}:logs`, {
  t: "log",
  p: { id: saved.id, taskId, message, type, severity, createdAt: saved.createdAt.toISOString() },
});
```

Import `redis` from `../../services/redis-client.js`.

**Step 3: Add Redis publish to code event ingestion**

In `api/src/routes/control-center/code-events.ts`, after the DB insert in the POST handler, add:

```typescript
redis.publishStreamEvent(`task:${taskId}:code`, {
  t: "code_event",
  p: { id: saved.id, filePath, message, metadata, createdAt: saved.createdAt.toISOString() },
});
```

**Step 4: Add Redis publish to task state changes**

In `api/src/services/task-claimer.ts` (after status update), `api/src/services/task-monitor.ts` (on completion/failure), and anywhere task status changes:

```typescript
redis.publishStreamEvent(`org:${orgId}:tasks`, {
  t: "task_state",
  p: { taskId, status: newStatus, summary, updatedAt: new Date().toISOString() },
});
```

This requires passing `orgId` through to these services. Check if it's already available on the task entity.

**Step 5: Add Redis publish to cost events**

In `api/src/services/cost-events.ts`, alongside the existing in-memory EventEmitter emission:

```typescript
redis.publishStreamEvent(`task:${taskId}:cost`, {
  t: "cost",
  p: { taskId, cost, currency, provider, model },
});
```

**Step 6: Write tests**

Create `api/src/routes/control-center/logs-publish.test.ts`:
- Mock `redis.publishStreamEvent`
- POST a log entry
- Verify `publishStreamEvent` called with correct topic and payload
- Verify DB insert still happens (existing behavior preserved)

Run: `cd api && npx vitest run src/routes/control-center/logs-publish.test.ts`

**Step 7: Commit**

```bash
git add api/src/services/redis-client.ts api/src/routes/control-center/logs.ts api/src/routes/control-center/code-events.ts api/src/services/cost-events.ts api/src/services/task-claimer.ts api/src/services/task-monitor.ts api/src/routes/control-center/logs-publish.test.ts
git commit -m "feat: add Redis PUBLISH on all write paths for unified SSE multiplexer"
```

---

### Task 2: Unified SSE Endpoint — Session Management and Event Writer

The core SSE endpoint: `GET /api/stream`. Handles authentication, session creation, Redis subscriptions, event writing, heartbeat, and cleanup.

**Files:**
- Create: `api/src/routes/stream.ts`
- Create: `api/src/services/sse-session-manager.ts`
- Modify: `api/src/routes/index.ts` (add export)
- Modify: `api/src/index.ts` (mount route)
- Test: `api/src/routes/stream.test.ts` (new)

**Context:**
- Auth pattern: `authenticateSSE` from `api/src/middleware/auth.ts` — supports JWT via `?token=` query param (required for browser EventSource)
- SSE slot limiting: `acquireSSESlot` / `releaseSSESlot` from `api/src/middleware/sse-limiter.ts`
- SSE headers pattern (from `stream.ts` line 63-68):
  ```typescript
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  ```
- Compression middleware in `api/src/index.ts` already skips `text/event-stream`

**Step 1: Create SSE Session Manager**

Create `api/src/services/sse-session-manager.ts`:

```typescript
import { Response } from "express";
import { redis } from "./redis-client.js";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger.js";

interface SSESession {
  id: string;
  res: Response;
  orgId: string;
  userId: string;                              // Owner — validated on subscribe/unsubscribe
  redisSubscriber: Redis;                      // Per-session subscriber (redis.duplicate())
  dataSubscriptions: Set<string>;              // Active Redis data topic names
  controlUnsubscribe: (() => void) | null;
  bufferBytes: number;
  eventCounter: number;                        // Monotonic per-session event ID (not timestamp)
  lifetimeTimer: NodeJS.Timeout;               // 4hr max connection timer (cleared on destroy)
  createdAt: number;
}

const sessions = new Map<string, SSESession>();
const orgConnectionCounts = new Map<string, number>();

const MAX_CONNECTIONS_PER_ORG = 20;
const MAX_SUBSCRIPTIONS_PER_SESSION = 50;
const BUFFER_WARN_BYTES = 256 * 1024;   // 256 KB — drop non-critical
const BUFFER_MAX_BYTES = 1024 * 1024;   // 1 MB — disconnect
const HEARTBEAT_INTERVAL_MS = 30_000;
const RECONNECT_GAP_MAX_MS = 5 * 60 * 1000;  // 5 minutes
```

Methods:
- `createSession(res, orgId, userId)` → sessionId (stores userId for ownership validation; null for API key sessions — use orgId instead)
- `destroySession(sessionId)` — cleanup: clear lifetime timer, unsubscribe all Redis topics, close response
- `subscribeChannels(sessionId, channels[], requestOrgId)` — validates channel authorization (task orgId matches session orgId) THEN subscribes to Redis data topics
- `unsubscribeChannels(sessionId, channels[])` — unsubscribe from Redis data topics
- `writeEvent(session, channel, type, payload)` — serialize and write SSE frame with composite `id: {counter}:{epoch_ms}`, track buffer
- `getSessionCount()` — for EMF metric
- `getTotalSubscriptions()` — for EMF metric
- `getTotalBufferBytes()` — for EMF metric
- `gracefulShutdown()` — send `reconnect` event to all sessions, clean up

**Channel authorization in `subscribeChannels`:** For task-scoped channels (`logs:{taskId}`, etc.), look up `Task.orgId` from DB (or LRU cache with 60s TTL), verify it matches `session.orgId`. Reject mismatches with an `error` event on the SSE stream. For `org:{orgId}:tasks`, verify the requested orgId matches `session.orgId`. This prevents IDOR — a user from Org A cannot subscribe to Org B's task channels.

**Session ownership in control message handler:** When the control message arrives, validate: if `session.userId` is set (JWT auth), `ownerId` must match `session.userId`. If `session.userId` is null (API key auth), `orgId` must match `session.orgId`. This prevents session hijacking.

The control channel subscriber: when a session is created, subscribe to `session:{sessionId}:control` Redis topic. When a control message arrives, validate ownership, then call `subscribeChannels`/`unsubscribeChannels`.

**Redis subscriber creation:** Each session needs its own ioredis subscriber. The existing `RedisService` in `redis-client.ts` does NOT expose a `duplicate()` method. Add a `createSubscriber(): Redis` method to `RedisService` that creates a new ioredis connection using the same URL and options. The session manager uses this for per-session subscribers.

**Step 2: Create the SSE route**

Create `api/src/routes/stream.ts`:

```typescript
import { Router, Request, Response } from "express";
import { authenticateSSE, authenticateRequest } from "../middleware/auth.js";
import { sessionManager } from "../services/sse-session-manager.js";

const router = Router();

// GET /api/stream — unified SSE endpoint
router.get("/", authenticateSSE, (req: Request, res: Response) => {
  const org = req.organization;
  const userId = req.user?.id || null;

  const sessionId = sessionManager.createSession(res, org.id, userId);
  if (!sessionId) {
    // Connection limit exceeded
    res.status(429).json({ error: "Too many connections", retryAfter: 5 });
    return;
  }

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Content-Encoding", "identity");  // Prevent CloudFront gzip buffering
  res.flushHeaders();

  // Send session ID as first event
  res.write(`event: session\ndata: ${JSON.stringify({ sessionId })}\n\n`);

  // Auto-subscribe to org tasks channel
  sessionManager.subscribeChannels(sessionId, [`org:${org.id}:tasks`]);

  // Handle Last-Event-ID for reconnection
  const lastEventId = req.headers["last-event-id"];
  if (lastEventId) {
    // Backfill logic — check gap, replay or send refresh event
    sessionManager.handleReconnect(sessionId, parseInt(lastEventId, 10));
  }

  // Cleanup on disconnect
  req.on("close", () => {
    sessionManager.destroySession(sessionId);
  });
});

// Channel name validation — prevent subscription to arbitrary Redis channels
const CHANNEL_PATTERN = /^(logs|coordination|code|cost):[a-f0-9-]{36}$|^org:[a-f0-9-]{36}:tasks$/;

function validateChannels(channels: unknown): string[] | null {
  if (!Array.isArray(channels) || channels.length === 0 || channels.length > 10) return null;
  for (const ch of channels) {
    if (typeof ch !== "string" || !CHANNEL_PATTERN.test(ch)) return null;
  }
  return channels;
}

// POST /api/stream/subscribe
router.post("/subscribe", authenticateRequest, (req, res) => {
  const { sessionId, channels: rawChannels } = req.body;
  const channels = validateChannels(rawChannels);
  if (!channels) return res.status(400).json({ error: "Invalid channel names" });

  // Session ownership: userId for JWT auth, orgId for API key auth (agents are org-scoped)
  const ownerId = req.user?.id || null;
  const orgId = req.organization?.id;

  redis.publishStreamEvent(`session:${sessionId}:control`, {
    action: "subscribe",
    channels,
    ownerId,  // SSE writer validates: userId match (JWT) or orgId match (API key)
    orgId,    // SSE writer validates: task orgId matches session orgId (IDOR protection)
  });
  res.json({ ok: true });
});

// POST /api/stream/unsubscribe
router.post("/unsubscribe", authenticateRequest, (req, res) => {
  const { sessionId, channels: rawChannels } = req.body;
  const channels = validateChannels(rawChannels);
  if (!channels) return res.status(400).json({ error: "Invalid channel names" });

  const ownerId = req.user?.id || null;
  const orgId = req.organization?.id;

  redis.publishStreamEvent(`session:${sessionId}:control`, {
    action: "unsubscribe",
    channels,
    ownerId,
    orgId,
  });
  res.json({ ok: true });
});

export default router;
```

**Step 3: Register the route**

In `api/src/routes/index.ts`, add:
```typescript
export { default as streamRouter } from "./stream.js";
```

In `api/src/index.ts`, mount with the authenticated limiter:
```typescript
app.use("/api/stream", authenticatedLimiter, streamRouter);
```

**Step 4: Add JWT lifecycle and connection max lifetime**

In `sse-session-manager.ts`, add a 4-hour max connection timer per session:

```typescript
// Max connection lifetime — forces reconnect with fresh JWT
const MAX_CONNECTION_MS = 4 * 60 * 60 * 1000; // 4 hours

createSession(sessionId, res, orgId) {
  // ... existing session setup ...

  // Schedule max-lifetime reconnect
  const lifetimeTimer = setTimeout(() => {
    this.sendEvent(sessionId, { event: "reconnect", data: { reason: "token_refresh" } });
    this.destroySession(sessionId);
  }, MAX_CONNECTION_MS);

  this.sessions.set(sessionId, { ...session, lifetimeTimer });
}
```

In `destroySession`, clear the lifetime timer:
```typescript
clearTimeout(session.lifetimeTimer);
```

**Step 5: Integrate SSE shutdown into existing SIGTERM handler**

The API already has a graceful shutdown handler in `api/src/index.ts:415-442`. **Do NOT register a separate `process.on("SIGTERM")` handler** — that would conflict with the existing one. Instead, call `sessionManager.gracefulShutdown()` at the top of the existing handler, before `server.close()`.

In `api/src/index.ts`, modify `gracefulShutdown()` (line 415):
```typescript
const gracefulShutdown = async (signal: string) => {
  logger.info(`${signal} received, shutting down gracefully`);
  stopOrchestrator();

  // SSE multiplexer: send reconnect events with stagger delay, then clean up
  await sessionManager.gracefulShutdown();  // ← ADD THIS (completes in ~3.5s)

  // Wait for fire-and-forget operations (max 20s)
  // ... existing code unchanged ...
};
```

In `sse-session-manager.ts`, the `gracefulShutdown` method sends staggered reconnects and waits:

```typescript
async gracefulShutdown(): Promise<void> {
  for (const [sessionId, session] of this.sessions) {
    // Random delay 0-3000ms to prevent thundering herd on reconnect
    const delay = Math.floor(Math.random() * 3000);
    this.sendEvent(sessionId, {
      event: "reconnect",
      data: { reason: "server_shutdown", delay },
    });
  }
  // Wait 3.5s for all clients to receive their delay, then destroy all sessions
  await new Promise(resolve => setTimeout(resolve, 3500));
  for (const [sessionId] of this.sessions) {
    this.destroySession(sessionId);  // clears lifetime timer, unsubscribes Redis, closes response
  }
}
```

**Timing budget:** SSE stagger (3.5s) + active ops wait (up to 20s) + server.close() = fits within 25s force-exit timer (`index.ts:438`). ECS `stopTimeout` is 30s, providing 5s margin.

Clients use the `delay` field to stagger their reconnection, spreading 300 reconnects across 3 seconds instead of a thundering herd.

**Step 6: Write tests**

Create `api/src/routes/stream.test.ts`:
- Test session creation returns sessionId
- Test org connection limit (21st connection returns 429)
- Test subscribe/unsubscribe publishes to Redis control channel
- Test session ownership validation — subscribe with wrong userId is rejected
- Test cleanup on disconnect removes session and clears lifetime timer
- Test monotonic event IDs increment per-session (not shared across sessions)
- Test backpressure — buffer exceeds 256KB drops non-critical events
- Test backpressure — buffer exceeds 1MB disconnects client
- Test graceful shutdown sends reconnect with stagger delay to all sessions
- Test SIGTERM integration — sessionManager.gracefulShutdown() called before server.close()
- Mock auth, Redis, use supertest

Run: `cd api && npx vitest run src/routes/stream.test.ts`

**Step 7: Commit**

```bash
git add api/src/services/sse-session-manager.ts api/src/routes/stream.ts api/src/routes/index.ts api/src/index.ts api/src/routes/stream.test.ts
git commit -m "feat: unified SSE endpoint with session management, ownership validation, and SIGTERM integration"
```

---

### Task 3: Backfill REST Endpoints

One-shot REST endpoints for initial data load when a client subscribes to a channel. These replace the "first poll" that clients currently do alongside SSE.

**Files:**
- Create: `api/src/routes/backfill.ts`
- Modify: `api/src/routes/index.ts` (add export)
- Modify: `api/src/index.ts` (mount route)
- Test: `api/src/routes/backfill.test.ts` (new)

**Context:**
- Existing log query pattern: `api/src/routes/control-center/logs.ts` lines 40-100 (GET handler with cursor-based pagination)
- Existing coordination query: `api/src/routes/coordination.ts` lines 40-70 (GET context by parentTaskId)
- Existing code events query: `api/src/routes/control-center/code-events.ts` lines 101-148

**Step 1: Create backfill route**

Create `api/src/routes/backfill.ts`:

```typescript
import { Router } from "express";
import { authenticateRequest } from "../middleware/auth.js";
import { AppDataSource } from "../db/connection.js";
import { WorkerTaskLog } from "../models/WorkerTaskLog.js";
import { WorkerContext } from "../models/WorkerContext.js";
import rateLimit from "express-rate-limit";

// Backfill rate limiter — protects DB from reconnection storms
// When 300 SSE clients reconnect simultaneously, each fires 3-5 backfill requests.
// This caps the burst to 50 req/s per org, spreading the load.
const backfillLimiter = rateLimit({
  windowMs: 1000,
  max: 50,
  keyGenerator: (req) => (req as any).orgId || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();
router.use(backfillLimiter);

// Org authorization helper — prevents IDOR (cross-org data access)
async function authorizeTaskAccess(req: Request, res: Response): Promise<boolean> {
  const task = await taskRepo.findOne({
    where: { id: req.params.taskId },
    select: ["id", "orgId"],
  });
  if (!task || task.orgId !== req.organization.id) {
    res.status(404).json({ error: "Task not found" });
    return false;
  }
  return true;
}

// GET /api/backfill/logs/:taskId?limit=200
// Response includes `cursor` (ISO timestamp of newest event) for client-side dedup.
// Client flow: subscribe (SSE starts) → buffer SSE events → fetch backfill →
// render backfill → replay SSE events with createdAt > cursor → switch to live.
router.get("/logs/:taskId", authenticateRequest, async (req, res) => {
  if (!(await authorizeTaskAccess(req, res))) return;
  const limit = Math.min(parseInt(req.query.limit as string) || 200, 500);
  const logs = await logRepo.find({
    where: { taskId: req.params.taskId },
    order: { createdAt: "DESC" },
    take: limit,
  });
  const ordered = logs.reverse();  // oldest first for terminal display
  const cursor = ordered.length > 0 ? ordered[ordered.length - 1].createdAt.toISOString() : null;
  res.json({ data: ordered, cursor });
});

// GET /api/backfill/coordination/:taskId?limit=50
router.get("/coordination/:taskId", authenticateRequest, async (req, res) => {
  if (!(await authorizeTaskAccess(req, res))) return;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const messages = await contextRepo.find({
    where: { parentTaskId: req.params.taskId },
    order: { createdAt: "DESC" },
    take: limit,
  });
  res.json(messages.reverse());
});

// GET /api/backfill/code/:taskId
router.get("/code/:taskId", authenticateRequest, async (req, res) => {
  if (!(await authorizeTaskAccess(req, res))) return;
  const events = await logRepo.find({
    where: { taskId: req.params.taskId, type: "code_event" },
    order: { createdAt: "ASC" },
  });
  res.json(events);
});

export default router;
```

**Important:** When the read replica is enabled (Task 0C), these backfill queries are purely read-only and will automatically route to the replica via TypeORM's replication config. This absorbs reconnection bursts without impacting the primary.

**Step 2: Register the route**

In `api/src/routes/index.ts`:
```typescript
export { default as backfillRouter } from "./backfill.js";
```

In `api/src/index.ts`:
```typescript
app.use("/api/backfill", authenticatedLimiter, backfillRouter);
```

**Step 3: Write tests**

Create `api/src/routes/backfill.test.ts`:
- Test log backfill returns correct limit, order, and cursor
- Test coordination backfill returns correct limit
- Test code events returns all events for task
- Test limit capping (request 1000, get 500 max)
- Test rate limiter returns 429 on burst exceeding 50 req/s
- Test org authorization — request task from different org returns 404
- Test nonexistent task returns 404

Run: `cd api && npx vitest run src/routes/backfill.test.ts`

**Step 4: Commit**

```bash
git add api/src/routes/backfill.ts api/src/routes/index.ts api/src/index.ts api/src/routes/backfill.test.ts
git commit -m "feat: backfill REST endpoints with reconnection storm rate limiting"
```

---

### Task 4: Last-Event-ID Reconnection and Gap Detection

Handle `Last-Event-ID` header on SSE reconnect. Replay missed events from DB if gap < 5 minutes, send `refresh` event if gap is larger.

**Files:**
- Modify: `api/src/services/sse-session-manager.ts` (add `handleReconnect` method)
- Test: `api/src/services/sse-session-manager.test.ts` (new or extend)

**Step 1: Implement handleReconnect in session manager**

Event IDs use composite format `{counter}:{epoch_ms}`. The `epoch_ms` portion is used for gap detection and DB replay. On reconnect:

```typescript
async handleReconnect(sessionId: string, lastEventIdStr: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Parse composite ID: "42:1708900000123" → epoch_ms = 1708900000123
  const parts = lastEventIdStr.split(":");
  const epochMs = parseInt(parts[1] || parts[0], 10);
  if (isNaN(epochMs)) return;

  const gapMs = Date.now() - epochMs;

  if (gapMs > RECONNECT_GAP_MAX_MS) {
    // Gap too large — tell client to refetch via REST backfill
    this.writeRawEvent(session, "refresh", {
      reason: "gap_too_large",
      channels: Array.from(session.dataSubscriptions),
    });
    return;
  }

  // Replay missed events from DB for subscribed channels
  // Query logs, coordination, code events WHERE created_at > to_timestamp(epochMs / 1000)
  // Push them through the SSE connection as catch-up events
  const since = new Date(epochMs);
  // ... query each subscribed channel's backing table with createdAt > since
}
```

**Step 2: Write tests**

- Test gap < 5 min triggers DB replay
- Test gap > 5 min sends `refresh` event
- Test no Last-Event-ID skips reconnect handling

Run: `cd api && npx vitest run src/services/sse-session-manager.test.ts`

**Step 3: Commit**

```bash
git add api/src/services/sse-session-manager.ts api/src/services/sse-session-manager.test.ts
git commit -m "feat: Last-Event-ID reconnection with gap detection for unified SSE"
```

---

### Task 5: EMF Metric Emission

Emit SSE connection metrics using CloudWatch Embedded Metric Format. The API writes structured JSON to stdout every 60 seconds. The `awslogs` driver (already configured) extracts metrics automatically.

**Files:**
- Create: `api/src/services/sse-metrics.ts`
- Modify: `api/src/index.ts` (start metric emission interval)
- No new npm dependencies (EMF is just structured JSON written to stdout)

**Step 1: Create metric emitter**

Create `api/src/services/sse-metrics.ts`:

```typescript
import { sessionManager } from "./sse-session-manager.js";
import { logger } from "../utils/logger.js";

let emitInterval: ReturnType<typeof setInterval> | null = null;

export function startSSEMetricEmission(): void {
  emitInterval = setInterval(() => {
    const metrics = {
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [{
          Namespace: "WorkerMill/API",
          Dimensions: [["ServiceName", "Environment"]],
          Metrics: [
            { Name: "SSEConnectionCount", Unit: "Count" },
            { Name: "SSEChannelSubscriptions", Unit: "Count" },
            { Name: "SSEBufferBytesTotal", Unit: "Bytes" },
          ],
        }],
      },
      ServiceName: "workermill-api",
      Environment: process.env.ENVIRONMENT || "dev",
      SSEConnectionCount: sessionManager.getSessionCount(),
      SSEChannelSubscriptions: sessionManager.getTotalSubscriptions(),
      SSEBufferBytesTotal: sessionManager.getTotalBufferBytes(),
    };

    // Write to stdout — awslogs driver picks up EMF JSON automatically
    process.stdout.write(JSON.stringify(metrics) + "\n");
  }, 60_000);
}

export function stopSSEMetricEmission(): void {
  if (emitInterval) clearInterval(emitInterval);
}
```

**Step 2: Start emission in index.ts**

In `api/src/index.ts`, after server starts listening:
```typescript
import { startSSEMetricEmission } from "./services/sse-metrics.js";
startSSEMetricEmission();
```

**Step 3: Commit**

```bash
git add api/src/services/sse-metrics.ts api/src/index.ts
git commit -m "feat: CloudWatch EMF metric emission for SSE connection count"
```

---

### Task 6: Deploy and Validate Phase 1

Deploy Phase 1 server-side changes. Verify new endpoints work without affecting existing clients.

**Step 1: Type check**

Run: `cd api && npm run typecheck`

**Step 2: Run all existing tests to verify no regressions**

Run: `cd api && npm run test`

**Step 3: Deploy API**

Run: `./deploy.sh --api`

**Step 4: Validate new endpoints with curl**

```bash
# Test unified SSE endpoint
curl -N -H "Authorization: Bearer <token>" https://workermill.com/api/stream

# Test subscribe (will fail gracefully since no session yet — that's expected)
curl -X POST https://workermill.com/api/stream/subscribe \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"test","channels":["logs:some-task-id"]}'

# Test backfill
curl -H "Authorization: Bearer <token>" https://workermill.com/api/backfill/logs/<taskId>?limit=10
```

**Step 5: Verify old endpoints still work**

Open the dashboard — confirm SSE streams, log polling, coordination all function identically.

**Step 6: Check CloudWatch for EMF metrics**

In CloudWatch console → Metrics → Custom Namespaces → `WorkerMill/API` → verify `SSEConnectionCount` appears (will be 0 until clients connect).

**Step 7: Commit any fixes, tag as Phase 1 complete**

```bash
git commit -m "chore: Phase 1 complete — unified SSE server-side foundation"
```

---

## Phase 2: Dashboard Migration

Migrate the React frontend from multiple SSE connections + polling to the unified stream. Behind a feature flag.

---

### Task 7: Unified Stream React Hook

Create `useUnifiedStream` — manages the single EventSource, session ID, subscriptions, and channel routing.

**Files:**
- Create: `frontend/src/hooks/useUnifiedStream.ts`
- Test manually in browser devtools

**Context:**
- Dashboard creates EventSource at `frontend/src/pages/Dashboard/MainDashboard.tsx` line 536
- Auth token from `localStorage.getItem("accessToken")`
- API base URL from `API_BASE` constant
- Zustand stores at `frontend/src/stores/` handle state

**Step 1: Create the hook**

Create `frontend/src/hooks/useUnifiedStream.ts`:

```typescript
import { useEffect, useRef, useCallback, useState } from "react";

interface StreamEvent {
  ch: string;  // channel
  t: string;   // type
  p: unknown;  // payload
}

type ChannelHandler = (type: string, payload: unknown) => void;

export function useUnifiedStream() {
  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [reconnectCounter, setReconnectCounter] = useState(0);  // Triggers new EventSource on server-initiated reconnect
  const eventSourceRef = useRef<EventSource | null>(null);
  const handlersRef = useRef<Map<string, Set<ChannelHandler>>>(new Map());
  const subscribedRef = useRef<Set<string>>(new Set());

  // Connect on mount
  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    if (!token) return;

    const es = new EventSource(`${API_BASE}/api/stream?token=${encodeURIComponent(token)}`);
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);

    es.addEventListener("session", (e) => {
      const data = JSON.parse(e.data);
      setSessionId(data.sessionId);
    });

    es.onmessage = (e) => {
      const event: StreamEvent = JSON.parse(e.data);
      const handlers = handlersRef.current.get(event.ch);
      if (handlers) {
        for (const handler of handlers) handler(event.t, event.p);
      }
    };

    es.addEventListener("refresh", () => {
      // Gap too large — refetch backfill for all subscribed channels
    });

    es.addEventListener("reconnect", (e) => {
      // Server shutting down — close and create NEW EventSource after delay.
      // IMPORTANT: EventSource.close() permanently kills auto-reconnect.
      // A new instance must be created manually.
      const { delay } = JSON.parse(e.data);
      es.close();
      eventSourceRef.current = null;
      setConnected(false);
      setTimeout(() => {
        // Re-create EventSource — the useEffect dependency on a reconnect
        // counter (or a reconnect() function) triggers a new connection.
        // Re-subscribe happens automatically after new session is created.
        setReconnectCounter(c => c + 1);
      }, delay || 0);
    });

    es.onerror = () => setConnected(false);

    return () => { es.close(); eventSourceRef.current = null; };
  }, [reconnectCounter]);  // reconnectCounter triggers re-creation

  const subscribe = useCallback((channels: string[], handler: ChannelHandler) => {
    // Register handler for each channel
    // POST /api/stream/subscribe for channels not already subscribed
    // Return unsubscribe function (with refcounting)
  }, [sessionId]);

  return { connected, sessionId, subscribe };
}
```

**Step 2: Commit**

```bash
git add frontend/src/hooks/useUnifiedStream.ts
git commit -m "feat: useUnifiedStream React hook for unified SSE client"
```

---

### Task 8: Dashboard MainDashboard Migration

Replace the multiple SSE connections and polling loops in MainDashboard with the unified stream. Behind a feature flag checked via org settings.

**Files:**
- Modify: `frontend/src/pages/Dashboard/MainDashboard.tsx`
- Modify: `frontend/src/components/EmbeddedCommunicationsFeed.tsx`

**Context:**
- Current SSE: `mainEventSourceRef` (main stream), per-task `EventSource` for logs (line 801), per-task coordination SSE in `EmbeddedCommunicationsFeed.tsx` (line 188)
- Current polling: `fetchTerminalLogs` interval (5s fallback), `startPolling`/`stopPolling`
- Feature flag: check `orgSettings.unifiedStreamEnabled` (add to org settings table in a migration)

**Step 1: Add feature flag org setting**

Create migration: `cd api && npm run migrate:create AddUnifiedStreamSetting`

```sql
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS unified_stream_enabled BOOLEAN NOT NULL DEFAULT false;
```

Register in `api/src/db/connection.ts`. Add to Organization entity.

**Step 2: Expose in settings API**

In `api/src/routes/settings.ts`, include `unifiedStreamEnabled` in the GET response.

**Step 3: Conditional rendering in MainDashboard**

In `MainDashboard.tsx`, check the flag:
```typescript
if (orgSettings?.unifiedStreamEnabled) {
  // Use unified stream path
} else {
  // Existing SSE + polling path (unchanged)
}
```

Wire the `tasks` channel to the existing `setData()` state updates. Wire `logs:{taskId}` to the terminal log display. Wire `coordination:{taskId}` to the comms feed. Wire `code:{taskId}` to the live code viewer.

On task expand: `subscribe(["logs:{id}", "coordination:{id}", "code:{id}", "cost:{id}"])` + one-shot backfill calls.

On task collapse: `unsubscribe(["logs:{id}", "coordination:{id}", "code:{id}", "cost:{id}"])`.

**Step 4: Remove polling loops (behind flag)**

When unified stream is active:
- Don't create per-task `EventSource` for logs
- Don't create per-task coordination SSE
- Don't start `fetchTerminalLogs` interval
- Don't start `startPolling` timer

**Step 5: Test manually**

1. Set `unified_stream_enabled = true` for test org
2. Open dashboard — verify task list loads via SSE
3. Open a running task — verify logs stream in real-time
4. Verify coordination messages appear
5. Verify code events work in live code viewer
6. Set flag to false — verify old behavior still works

**Step 6: Commit**

```bash
git add api/src/db/migrations/* api/src/db/connection.ts api/src/models/Organization.ts api/src/routes/settings.ts frontend/src/pages/Dashboard/MainDashboard.tsx frontend/src/components/EmbeddedCommunicationsFeed.tsx
git commit -m "feat: dashboard unified SSE migration behind feature flag"
```

---

### Task 9: Deploy and Validate Phase 2

**Step 1: Type check both API and frontend**

Run: `cd api && npm run typecheck && cd ../frontend && npx tsc -b`

**Step 2: Run API tests**

Run: `cd api && npm run test`

**Step 3: Deploy**

Run: `./deploy.sh --api && ./deploy.sh --frontend`

**Step 4: Enable flag for test org, validate in production**

**Step 5: Flip flag to default-on once validated**

Update the migration default from `false` to `true`, or update via SQL:
```sql
UPDATE organizations SET unified_stream_enabled = true;
```

**Step 6: Commit**

```bash
git commit -m "chore: Phase 2 complete — dashboard unified SSE migration"
```

---

## Phase 3: Agent + VS Code Migration

Migrate the agent and VS Code extension to use the unified stream.

---

### Task 10: Agent Unified Stream Client (Cloud-Facing)

The agent connects to `GET /api/stream` on the cloud API instead of polling `GET /api/agent/poll` for task discovery.

**Files:**
- Create: `agent/src/unified-stream.ts`
- Modify: `agent/src/poller.ts` (add fallback logic)
- Modify: `agent/src/index.ts` (connect unified stream on startup)

**Context:**
- Agent API client: `agent/src/api.ts` — axios instance with cloud API URL and org API key
- Current task discovery: `pollOnce()` in `agent/src/poller.ts` calls `GET /api/agent/poll`
- Agent events: `agentEvents` EventEmitter in `agent/src/local-api.ts`

**Step 1: Create unified stream client**

Create `agent/src/unified-stream.ts`:

Connects to `GET /api/stream` with API key auth. Uses Node.js `https.request` (same pattern as `worker/epic/sse-subscriber.ts` — no browser EventSource available in Node).

On `tasks` channel events:
- `task_assigned` → emit to `agentEvents` → triggers task handling (same flow as current `pollOnce`)

Manages subscriptions for active tasks (logs, coordination, code events channels). Re-broadcasts all events to VS Code via the local API SSE writer.

Falls back to `pollOnce()` if the unified stream endpoint returns 404 (old API version).

**Step 2: Wire into agent startup**

In `agent/src/index.ts`, try unified stream first. If it connects, reduce poll interval to a long safety-net interval (60s instead of the normal 5-10s). If it fails, keep current polling behavior.

**Step 3: Commit**

```bash
git add agent/src/unified-stream.ts agent/src/poller.ts agent/src/index.ts
git commit -m "feat: agent unified SSE stream client with poll fallback"
```

---

### Task 11: Agent Local API — Unified Stream for VS Code

The agent local API mirrors the cloud unified stream to VS Code. VS Code connects to `GET /api/stream` on the agent's local HTTP server.

**Files:**
- Modify: `agent/src/local-api.ts`

**Context:**
- Current SSE endpoints in local API: `GET /api/stream/tasks`, `GET /api/stream/logs/:taskId`, `GET /api/stream/coordination/:taskId`
- Current REST proxy endpoints: `GET /api/tasks/:id/logs`, `GET /api/tasks/:id/coordination`, `GET /api/tasks/:id/detail`, `GET /api/tasks/:id/code-events`
- Broadcast pattern: `broadcastSSE(channel, event, data)` at line 152

**Step 1: Add unified stream SSE endpoint**

Add `GET /api/stream` handler to local API. Re-broadcasts all cloud unified stream events to connected VS Code clients using the existing `broadcastSSE` pattern.

Add `POST /api/stream/subscribe` and `POST /api/stream/unsubscribe` handlers. These translate VS Code subscription requests into cloud API subscription requests.

Add backfill proxy endpoints: `GET /api/backfill/logs/:taskId`, `GET /api/backfill/coordination/:taskId`, `GET /api/backfill/code/:taskId` — proxy to cloud API.

**Step 2: Keep old endpoints working**

Don't remove existing SSE and REST proxy endpoints yet. Old VS Code extensions need them.

**Step 3: Commit**

```bash
git add agent/src/local-api.ts
git commit -m "feat: agent local API unified SSE stream for VS Code"
```

---

### Task 12: VS Code Extension — Shared Subscription Layer

Replace independent polling loops in all three panels with a shared subscription layer in `AgentClient`.

**Files:**
- Modify: `packages/vscode-workermill/src/agent-client.ts` (add unified stream + subscription management)
- Modify: `packages/vscode-workermill/src/mission-control-panel.ts` (remove polling, use subscriptions)
- Modify: `packages/vscode-workermill/src/feed-view.ts` (remove polling, use subscriptions)
- Modify: `packages/vscode-workermill/src/task-detail-panel.ts` (remove polling, use subscriptions)
- Modify: `packages/vscode-workermill/src/live-diff-manager.ts` (remove polling, use subscriptions)

**Context:**
- `AgentClient` at `agent-client.ts` — HTTP client for agent local API
- Current `startTaskStream()` opens `GET /api/stream/tasks` SSE
- Each panel has its own `startPolling()` / `pollUpdates()` / `stopPolling()` with `setInterval(5000)`

**Step 1: Add shared subscription layer to AgentClient**

```typescript
// Reference counting for channel subscriptions
private channelRefCounts = new Map<string, number>();
private channelHandlers = new Map<string, Set<(type: string, payload: unknown) => void>>();

subscribe(channels: string[], handler: (type: string, payload: unknown) => void): () => void {
  for (const ch of channels) {
    const count = this.channelRefCounts.get(ch) || 0;
    this.channelRefCounts.set(ch, count + 1);
    if (count === 0) {
      // First subscriber — send subscribe to agent
      this.post("/api/stream/subscribe", { sessionId: this.sessionId, channels: [ch] });
    }
    // Register handler
  }
  // Return unsubscribe function that decrements refcounts
}
```

Connect to `GET /api/stream` on the agent local API (unified stream). Route incoming events to registered handlers by channel name.

**Step 2: Detect agent capability**

On connect, try `GET /api/stream`. If the agent returns 404 (old agent without unified stream), fall back to existing SSE endpoints + polling. This ensures backward compatibility.

**Step 3: Migrate MissionControlPanel**

Replace `startPolling()` / `pollUpdates()` with:
```typescript
this.unsubscribe = this.client.subscribe(
  [`logs:${this.taskId}`, `coordination:${this.taskId}`],
  (type, payload) => { /* route to webview */ }
);
// One-shot backfill for initial data
const logs = await this.client.getBackfill("logs", this.taskId, 200);
const coord = await this.client.getBackfill("coordination", this.taskId, 50);
```

**Step 4: Migrate FeedViewProvider**

Same pattern. Replace `pollUpdates()` with subscribe to `coordination:{taskId}`.

**Step 5: Migrate TaskDetailPanel**

Same pattern. Replace `poll()` with subscribe to task detail via `tasks` channel events.

**Step 6: Migrate LiveDiffManager**

Replace `poll()` timer with subscribe to `code:{taskId}`. Process events exactly as the current `processEvents()` method does.

**Step 7: Bump extension version**

In `packages/vscode-workermill/package.json`, bump version.

**Step 8: Commit**

```bash
git add packages/vscode-workermill/src/agent-client.ts packages/vscode-workermill/src/mission-control-panel.ts packages/vscode-workermill/src/feed-view.ts packages/vscode-workermill/src/task-detail-panel.ts packages/vscode-workermill/src/live-diff-manager.ts packages/vscode-workermill/package.json
git commit -m "feat: VS Code unified SSE with shared subscription layer, eliminate all polling"
```

---

### Task 13: Deploy and Validate Phase 3

**Step 1: Type check agent and VS Code extension**

Run: `cd agent && npm run typecheck && cd ../packages/vscode-workermill && npx tsc --noEmit`

**Step 2: Build and release agent**

```bash
cd agent
# bump version in package.json
npm run build:binary
git tag agent-v<version>
git push upstream agent-v<version>
```

**Step 3: Build and release VS Code extension**

```bash
cd packages/vscode-workermill
npm run build
npx @vscode/vsce package --no-dependencies
git tag vscode-v<version>
git push origin vscode-v<version>
```

**Step 4: Test on real machine**

Install new agent + extension on test machine. Verify:
- Task discovery works via SSE (not polling)
- MissionControlPanel shows live logs without polling
- FeedViewProvider shows coordination messages
- LiveDiffManager shows code changes
- Agent falls back to polling with old API (backward compat)

**Step 5: Commit**

```bash
git commit -m "chore: Phase 3 complete — agent + VS Code unified SSE migration"
```

---

## Phase 4: Worker Log Batching

Independent of Phases 2-3. Can run in parallel.

---

### Task 14: Worker Log Buffer

Buffer log lines in the worker executor and flush in batches.

**Files:**
- Create: `worker/epic/log-buffer.ts`
- Modify: `worker/epic/executor.ts` (use buffer instead of direct POST)

**Context:**
- Current `postLog()` in `executor.ts` lines 213-229: individual `this.logsApi.post("/api/control-center/logs", { taskId, type, message, severity })`
- `logsApi` is a `RetryableApi` instance (axios-based)

**Step 1: Create log buffer**

Create `worker/epic/log-buffer.ts`:

```typescript
export class LogBuffer {
  private buffer: Array<{ taskId: string; type: string; message: string; severity: string }> = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private api: RetryableApi;

  constructor(api: RetryableApi, private maxSize = 50, private flushIntervalMs = 500) {
    this.api = api;
  }

  add(entry: { taskId: string; type: string; message: string; severity: string }): void {
    this.buffer.push(entry);
    if (this.buffer.length >= this.maxSize) {
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.flushIntervalMs);
    }
  }

  async flush(): Promise<void> {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (this.buffer.length === 0) return;
    const entries = this.buffer.splice(0);
    try {
      // Use EXISTING batch endpoint: POST /api/control-center/logs/batch
      // (already exists at api/src/routes/control-center/logs.ts:599)
      // Accepts { entries: [...] }, validates up to 100 entries per request
      await this.api.post("/api/control-center/logs/batch", { entries });
    } catch {
      // Fire-and-forget — match existing postLog behavior
    }
  }

  async destroy(): Promise<void> {
    await this.flush();  // final flush on task completion
  }
}

```

**Crash safety:** `process.on('exit')` callbacks are synchronous-only — you cannot `await` the async `flush()`. Two approaches:

1. **`process.on('beforeExit')`** — fires when the event loop is empty, allows async operations. But does NOT fire on `SIGTERM`/`SIGKILL`.
2. **`SIGTERM`/`SIGINT` handlers** — call `await flush()` then `process.exit()`. This handles graceful shutdown.
3. **Synchronous HTTP fallback** — for `process.on('exit')` (truly last-resort), use `child_process.execFileSync('curl', [...])` to do a blocking HTTP POST. This is ugly but guarantees delivery of buffered logs even on forced exit.

Recommended: Use approach #2 (SIGTERM/SIGINT handlers) for the common case. Accept that `SIGKILL` or OOM kills lose buffered logs — this is acceptable since it's just terminal output, not state.

**Step 2: Modify executor.ts to use buffer**

Replace direct `this.logsApi.post(...)` in `postLog()` with `this.logBuffer.add(...)`. Call `this.logBuffer.destroy()` in the task cleanup/completion path.

**Step 3: Commit**

```bash
git add worker/epic/log-buffer.ts worker/epic/executor.ts
git commit -m "feat: worker log batching — buffer and flush every 50 lines or 500ms"
```

---

### Task 15: Add Redis Publish to Existing Batch Log Endpoint

The batch endpoint already exists at `POST /api/control-center/logs/batch` (`logs.ts:599`). It accepts `{ entries: [...] }` and does a bulk insert. The missing piece is Redis publish — the existing endpoint does NOT publish to Redis, so SSE clients won't see batch-ingested logs in real-time.

**Files:**
- Modify: `api/src/routes/control-center/logs.ts` (batch POST handler, ~line 599)
- Test: Extend existing log tests

**Context:**
- Existing batch endpoint at `logs.ts:599`: accepts `{ entries: [...] }`, validates up to 100 entries, bulk inserts
- Single-log POST at `logs.ts:507`: already publishes to Redis (Task 1 adds this)
- Worker `LogBuffer` (Task 14) uses the existing batch endpoint

**Step 1: Add Redis publish to batch handler**

After the bulk insert in the batch handler, publish each entry individually to Redis:

```typescript
// After bulk insert — publish each log to Redis for SSE delivery
for (const entry of savedEntries) {
  redis.publishStreamEvent(`task:${entry.taskId}:logs`, {
    t: "log",
    p: { id: entry.id, taskId: entry.taskId, message: entry.message, type: entry.type, severity: entry.severity, createdAt: entry.createdAt.toISOString() },
  });
}
```

**Step 2: Write tests**

- Test batch POST with Redis publish — verify `redis.publishStreamEvent` called once per entry
- Test batch POST still works (existing tests should pass)
- Test single-log POST still works (backward compat)

Run: `cd api && npx vitest run src/routes/control-center/logs.test.ts`

**Step 3: Commit**

```bash
git add api/src/routes/control-center/logs.ts api/src/routes/control-center/logs.test.ts
git commit -m "feat: add Redis publish to existing batch log endpoint for SSE delivery"
```

---

### Task 16: Deploy Phase 4

**Step 1: Deploy API** (batch ingestion endpoint)

Run: `./deploy.sh --api`

**Step 2: Release worker** (log buffer)

Worker code is bundled into the agent binary. Release new agent:
```bash
cd agent && npm run build:binary
git tag agent-v<version>
git push upstream agent-v<version>
```

For cloud ECS workers: `./deploy.sh --worker`

**Step 3: Validate**

- Verify logs still appear in dashboard in real-time
- Check API logs for batch POST requests (should see array payloads)
- Verify old single-log POST still works from old workers

**Step 4: Commit**

```bash
git commit -m "chore: Phase 4 complete — worker log batching"
```

---

## Phase 5: Infrastructure — Auto-Scaling and ALB

Terraform changes for auto-scaling on SSE connection count, ALB timeout adjustments, and deregistration delay.

---

### Task 17: Terraform — ALB and Target Group Settings

**Files:**
- Modify: `infrastructure/terraform/modules/ecs-service/main.tf`
- Modify: `infrastructure/terraform/modules/ecs-service/variables.tf` (if new vars needed)

**Step 1: Update ALB idle timeout**

In `aws_lb.main`:
```hcl
idle_timeout = 120  # SSE heartbeat is 30s, this gives 4 missed pings
```

**Step 2: Update target group deregistration delay**

In `aws_lb_target_group.api`:
```hcl
deregistration_delay = 30  # SSE clients reconnect in 1-3s after graceful shutdown
```

**Step 3: Configure Redis ElastiCache parameter group for pub/sub buffer limits**

In `infrastructure/terraform/modules/redis/main.tf`, add a custom parameter group:

```hcl
resource "aws_elasticache_parameter_group" "workermill" {
  name   = "workermill-${var.environment}-redis7"
  family = "redis7"

  parameter {
    name  = "client-output-buffer-limit-pubsub-hard-limit"
    value = "67108864"  # 64MB
  }

  parameter {
    name  = "client-output-buffer-limit-pubsub-soft-limit"
    value = "16777216"  # 16MB
  }

  parameter {
    name  = "client-output-buffer-limit-pubsub-soft-seconds"
    value = "120"
  }
}
```

Reference this parameter group in the ElastiCache replication group or cluster. This prevents Redis from disconnecting SSE subscriber connections under high log volume.

**Step 4: Add CloudFront cache behavior for SSE (disable compression)**

In `infrastructure/terraform/modules/cdn/main.tf`, add a new `ordered_cache_behavior` BEFORE the existing `/api/*` behavior (CloudFront evaluates in order, first match wins):

```hcl
ordered_cache_behavior {
  path_pattern     = "/api/stream*"
  allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
  cached_methods   = ["GET", "HEAD"]
  target_origin_id = "api"

  min_ttl     = 0
  default_ttl = 0
  max_ttl     = 0

  forwarded_values {
    query_string = true
    headers      = ["Authorization", "Origin", "Accept", "Content-Type", "Host", "x-api-key"]
    cookies { forward = "all" }
  }

  viewer_protocol_policy = "https-only"
  compress               = false  # CRITICAL: disable compression for SSE streaming
}
```

This prevents CloudFront from gzip-buffering SSE events. The existing `/api/*` behavior (with `compress = true`) continues to handle all other API calls.

Also add `Content-Encoding: identity` to the SSE endpoint response headers in `stream.ts` as a defense-in-depth measure.

**Step 5: Run terraform plan**

Run: `cd infrastructure/terraform && terraform plan`

Review changes — should be ALB timeout, target group deregistration delay, Redis parameter group, and new CloudFront cache behavior.

**Step 6: Apply**

Run: `terraform apply`

**Step 7: Verify zero drift**

Run: `terraform plan` — confirm zero changes.

**Step 8: Commit**

```bash
git add infrastructure/terraform/modules/ecs-service/main.tf infrastructure/terraform/modules/redis/main.tf infrastructure/terraform/modules/cdn/main.tf
git commit -m "infra: ALB idle timeout 120s, deregistration delay 30s, Redis pub/sub limits, CloudFront SSE behavior"
```

---

### Task 18: Terraform — Auto-Scaling Policies

Add ECS Application Auto Scaling with target tracking on SSE connection count custom metric, plus CPU/memory emergency guardrails.

**Files:**
- Create: `infrastructure/terraform/modules/ecs-service/autoscaling.tf`
- Modify: `infrastructure/terraform/modules/ecs-service/variables.tf`

**Step 1: Create autoscaling.tf**

```hcl
resource "aws_appautoscaling_target" "api" {
  max_capacity       = 20
  min_capacity       = 2
  resource_id        = "service/${var.ecs_cluster_name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

# Primary: Target tracking on SSE connection count
resource "aws_appautoscaling_policy" "sse_connections" {
  name               = "sse-connection-target"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = 300
    scale_in_cooldown  = 300
    scale_out_cooldown = 60

    customized_metric_specification {
      metric_name = "SSEConnectionCount"
      namespace   = "WorkerMill/API"
      statistic   = "Average"
    }
  }
}

# Emergency guardrail: CPU
resource "aws_appautoscaling_policy" "cpu_emergency" {
  name               = "cpu-emergency-scaleout"
  policy_type        = "StepScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = 120
    metric_aggregation_type = "Average"

    step_adjustment {
      scaling_adjustment          = 2
      metric_interval_lower_bound = 0
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "cpu_high" {
  alarm_name          = "workermill-${var.environment}-api-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 60
  statistic           = "Average"
  threshold           = 70
  alarm_actions       = [aws_appautoscaling_policy.cpu_emergency.arn]

  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = aws_ecs_service.api.name
  }
}

# Emergency guardrail: Memory
resource "aws_appautoscaling_policy" "memory_emergency" {
  name               = "memory-emergency-scaleout"
  policy_type        = "StepScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = 120
    metric_aggregation_type = "Average"

    step_adjustment {
      scaling_adjustment          = 2
      metric_interval_lower_bound = 0
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "memory_high" {
  alarm_name          = "workermill-${var.environment}-api-memory-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  period              = 60
  statistic           = "Average"
  threshold           = 80
  alarm_actions       = [aws_appautoscaling_policy.memory_emergency.arn]

  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = aws_ecs_service.api.name
  }
}
```

**Step 2: Update ECS service to remove ignore_changes on desired_count**

In `aws_ecs_service.api`, the lifecycle block has `ignore_changes = [desired_count]` — this is correct and must stay. Auto-scaling manages desired count; Terraform ignores it.

**Step 3: Plan and apply**

Run: `terraform plan` → review → `terraform apply` → `terraform plan` (confirm zero drift)

**Step 4: Commit**

```bash
git add infrastructure/terraform/modules/ecs-service/autoscaling.tf infrastructure/terraform/modules/ecs-service/variables.tf
git commit -m "infra: ECS auto-scaling — target tracking on SSE connections + CPU/memory guardrails"
```

---

### Task 19: Predictive Scaling (Post-Launch)

Enable after 14 days of SSE connection metric data has been collected.

**Step 1: Enable Forecast Only mode via AWS CLI**

```bash
aws application-autoscaling put-scaling-policy \
  --service-namespace ecs \
  --resource-id "service/workermill-dev/workermill-dev-api" \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-name "sse-predictive" \
  --policy-type "PredictiveScaling" \
  --predictive-scaling-policy-configuration '{
    "MetricSpecifications": [{
      "TargetValue": 300,
      "CustomizedScalingMetricSpecification": {
        "MetricDataQueries": [{
          "Id": "scaling",
          "MetricStat": {
            "Metric": {
              "MetricName": "SSEConnectionCount",
              "Namespace": "WorkerMill/API"
            },
            "Stat": "Average"
          }
        }]
      },
      "CustomizedLoadMetricSpecification": {
        "MetricDataQueries": [{
          "Id": "load",
          "MetricStat": {
            "Metric": {
              "MetricName": "SSEConnectionCount",
              "Namespace": "WorkerMill/API"
            },
            "Stat": "Sum"
          }
        }]
      }
    }],
    "Mode": "ForecastOnly",
    "MaxCapacityBreachBehavior": "HonorMaxCapacity"
  }'
```

**Step 2: Monitor forecasts for 1-2 weeks**

Check CloudWatch → Application Auto Scaling → Predictive Scaling → compare forecast vs actual.

**Step 3: Switch to ForecastAndScale when validated**

Change `"Mode": "ForecastOnly"` to `"Mode": "ForecastAndScale"`.

**Step 4: Migrate to Terraform when provider support lands**

Track [hashicorp/terraform-provider-aws#40328](https://github.com/hashicorp/terraform-provider-aws/issues/40328).

---

## Phase 6: Cleanup

After all clients validated on unified stream.

---

### Task 20: Remove Old SSE Endpoints and Polling Code

**Files:**
- Remove polling code from: `MainDashboard.tsx` (old SSE + fallback paths)
- Remove polling code from: `EmbeddedCommunicationsFeed.tsx` (old SSE)
- Remove old SSE routes: `api/src/routes/control-center/stream.ts` (or keep as legacy)
- Remove old REST proxy endpoints from: `agent/src/local-api.ts`
- Remove feature flag: `unified_stream_enabled` column (set to always-on)

**Important:** Only proceed after confirming:
- Zero clients using old SSE endpoints (check ALB access logs)
- All agents updated to version with unified stream
- All VS Code extensions updated
- Dashboard feature flag has been default-on for at least 1 week

**Step 1: Remove old code paths**

Remove the conditional branches that used old SSE + polling. Keep unified stream as the only path.

**Step 2: Remove old SSE route handlers**

Optionally keep them returning 301 redirects to `/api/stream` for a transition period, then remove entirely.

**Step 3: Remove feature flag column**

Migration: `ALTER TABLE organizations DROP COLUMN IF EXISTS unified_stream_enabled;`

**Step 4: Run all tests**

Run: `cd api && npm run test && cd ../frontend && npx tsc -b`

**Step 5: Deploy**

Run: `./deploy.sh --all`

**Step 6: Commit**

```bash
git commit -m "chore: remove legacy SSE endpoints and polling code — unified stream is sole path"
```

---

## Summary

| Phase | Tasks | Client Impact | Rollback |
|-------|-------|--------------|----------|
| **0: Database foundation** | **0A-0C** | **None — config fix + prep** | **Revert PgBouncer config, remove replication code** |
| 1: Server foundation | 1-6 | None — new endpoints, old unchanged | Delete new endpoints |
| 2: Dashboard | 7-9 | Behind feature flag | Flip flag off |
| 3: Agent + VS Code | 10-13 | Version bump, auto-fallback | Downgrade agent/extension |
| 4: Worker batching | 14-16 | Transparent, backward compat | Deploy old worker |
| 5: Infrastructure | 17-19 | Transparent | Revert Terraform |
| 6: Cleanup | 20 | N/A — old paths already unused | N/A |

### Database Scaling Roadmap

| Milestone | RDS Config | Connections (with PgBouncer) | Read Replica | Multi-AZ |
|-----------|-----------|------------------------------|-------------|----------|
| Phase 0 (now) | db.t4g.micro (existing) | 10/instance × PgBouncer (MAX_CLIENT_CONN fix) | Disabled (toggle ready) | No |
| 50+ tasks | db.t4g.small | Same | Enable (db.t4g.small) | Yes |
| 100+ tasks | db.t4g.medium | Same | db.t4g.medium | Yes |
| 500+ tasks | db.r7g.large | Same | db.t4g.medium | Yes |

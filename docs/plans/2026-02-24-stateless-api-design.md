# Stateless API & Connection Pool Design

**Date:** 2026-02-24
**Status:** Approved

---

## Problem

The API process runs both HTTP request handling and background orchestration in the same process. A single `pg.Pool` of 10 connections serves all consumers — SSE polling, dashboard queries, orchestrator cron jobs, agent polls, and worker log posts. During heavy workloads (e.g., multi-story epic runs), unbounded concurrency exhausts the pool, cascading into 502 errors and full API crashes.

The API also holds in-memory state (orchestrator timers, OAuth PKCE states, EventEmitters, rate limiter counters) that prevents horizontal scaling — running multiple instances causes duplicate cron executions, broken OAuth flows, and missed real-time events.

**Trigger:** FDPFB-5 epic run on 2026-02-24. Story 4 revision hit 502s from the WorkerMill API, Decision API went down (circuit breaker opened), blocker timed out after 1 hour, and the entire epic failed. The API then became fully unreachable (ECONNREFUSED).

---

## Goals

1. **Stateless API** — run N API instances behind the ALB with no shared in-memory state
2. **Separate orchestrator** — single-instance background service for poll loop, cron jobs, task spawning
3. **Connection multiplexing** — PgBouncer sidecar prevents pool exhaustion across multiple instances
4. **Graceful degradation** — back-pressure and load shedding instead of crashing
5. **Local dev unchanged** — `./bin/local-workermill start` continues to run everything in one process

---

## Architecture

### Before

```
┌──────────────────────────────────┐
│  ECS Service: workermill-api     │
│  desired_count: 2                │
│                                  │
│  ┌────────────────────────────┐  │
│  │ Node.js process            │  │
│  │ ├── Express HTTP server    │  │
│  │ ├── SSE endpoints          │  │
│  │ ├── Orchestrator poll loop │  │  ──► RDS (pool: 10 per instance)
│  │ ├── Cron jobs              │  │
│  │ └── EventEmitters          │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

### After

```
┌─────────────────────────────┐     ┌──────────────────────────────┐
│ ECS: workermill-api         │     │ ECS: workermill-orchestrator │
│ desired_count: 2+ (scale)   │     │ desired_count: 1 (singleton) │
│ ALB attached: yes           │     │ ALB attached: no             │
│ ENABLE_ORCHESTRATOR=false   │     │ ENABLE_ORCHESTRATOR=true     │
│                             │     │                              │
│ ┌─────────┐ ┌────────────┐ │     │ ┌─────────┐ ┌────────────┐  │
│ │ app     │→│ pgbouncer  │─┼──┐  │ │ app     │→│ pgbouncer  │──┼──┐
│ │ pool:20 │ │ server: 8  │ │  │  │ │ pool:15 │ │ server: 8  │  │  │
│ └─────────┘ └────────────┘ │  │  │ └─────────┘ └────────────┘  │  │
└─────────────────────────────┘  │  └──────────────────────────────┘  │
                                 │                                    │
                                 └────────────► RDS ◄────────────────┘
                                            (db.t4g.micro)
```

Both services use the same Docker image. The only difference is the `ENABLE_ORCHESTRATOR` env var, which already exists and gates `startOrchestrator()` in `index.ts`.

---

## 1. Service Split

### API Service (`workermill-api`)

- `ENABLE_ORCHESTRATOR=false` — skips `startOrchestrator()`, which is already the behavior
- `desired_count: 2` (or more, auto-scalable)
- Attached to ALB target group
- Handles all HTTP requests, SSE streams, webhooks
- Stateless — all shared state in Redis or DB

### Orchestrator Service (`workermill-orchestrator`)

- `ENABLE_ORCHESTRATOR=true`
- `desired_count: 1` — singleton, no distributed locking needed
- **Not** attached to ALB — no inbound HTTP traffic
- Runs: poll loop, task claiming, worker spawning, task monitoring, cleanup crons, marketing agent, trial reminders
- No port mapping needed (no HTTP server). Express still starts (same entrypoint) but receives no traffic. Alternatively, a future optimization could add a `SKIP_HTTP=true` flag to skip Express entirely.

### Orchestrator Heartbeat

The orchestrator writes a Redis key every poll cycle:

```
SET orchestrator:heartbeat <ISO timestamp> EX 30
```

The status page (`GET /api/status`) reads this key instead of calling `isOrchestratorRunning()` (which is in-memory). If the key is stale (>30s), the status page reports `taskProcessing: "degraded"`.

### ECS Infrastructure Changes

New Terraform resources in `modules/ecs-service/`:
- `aws_ecs_task_definition.orchestrator` — same image, same env vars, `ENABLE_ORCHESTRATOR=true`, no port mappings, smaller resource allocation (256 CPU / 512 MB)
- `aws_ecs_service.orchestrator` — `desired_count: 1`, same VPC/subnets/security groups, no ALB attachment, Fargate Spot (cost optimization — orchestrator restarts are safe since tasks are claimed atomically)

Existing API task definition changes:
- `ENABLE_ORCHESTRATOR=false`
- Add PgBouncer sidecar container (see Section 2)

### Shared Code Coupling

Routes import from `task-monitor.ts` (`syncKbCardColumn`, `checkAndUnblockDependentTasks`, `cascadeCancellationToChildren`). These are pure DB functions with no orchestrator dependency. They stay in the shared codebase — both services run the same image and can import them. No code split required.

### Local Development

**No change.** `./bin/local-workermill start` runs a single API process with `ENABLE_ORCHESTRATOR` defaulting to `true`. The service split is purely an ECS deployment concern. Local dev runs one process with everything, no PgBouncer, direct DB connection — same as today.

The `ENABLE_ORCHESTRATOR` env var can be set in `.env.local` if needed for testing the split locally, but this is not required for normal development.

---

## 2. Connection Pooling — PgBouncer Sidecar

### Why

Multiple ECS tasks (2+ API + 1 orchestrator) each run their own `pg.Pool`. Without a multiplexer, connection counts scale linearly with instance count and can exhaust RDS `max_connections` (~85 on `db.t4g.micro`).

### How

PgBouncer runs as a sidecar container in each ECS task definition. The app connects to PgBouncer on `localhost:5432`; PgBouncer maintains a smaller pool of real connections to RDS.

**PgBouncer container config:**

```ini
[databases]
workermill = host=<RDS_HOST> port=5432 dbname=workermill

[pgbouncer]
pool_mode = transaction
default_pool_size = 8
max_client_conn = 50
server_idle_timeout = 30
server_lifetime = 3600
auth_type = plain
listen_addr = 127.0.0.1
listen_port = 5432
```

**Connection math:**

| Scenario | App pool per container | PgBouncer server conns per container | Total real RDS connections |
|----------|----------------------|-------------------------------------|--------------------------|
| 2 API + 1 orchestrator | 20 / 15 | 8 each | 24 max (usually <16 active) |
| 4 API + 1 orchestrator | 20 / 15 | 8 each | 40 max |
| 6 API + 1 orchestrator | 20 / 15 | 8 each | 56 max |

All well within `db.t4g.micro` capacity (~85). Upgrade to `db.t4g.small` (~170, ~$24/mo) only needed beyond 8+ instances.

### Application Changes

In `api/src/db/connection.ts`:

1. **Point to PgBouncer when available:** Use `PGBOUNCER_HOST` env var (set to `localhost` in ECS, unset locally). When set, connect to PgBouncer on port 5432 instead of RDS directly.
2. **Disable prepared statements:** `extra: { ...existing, prepareStatements: false }` — required for PgBouncer transaction pooling mode. TypeORM's prepared statements don't work when connections are recycled between transactions.
3. **Raise app pool:** `max: 20` for API instances, `max: 15` for orchestrator (configurable via `DB_POOL_MAX` env var with sensible defaults).

### Local Development

**No PgBouncer locally.** The app connects directly to Postgres on port 5433 as today. `PGBOUNCER_HOST` is not set in `.env.local`, so the connection falls through to the existing `DATABASE_URL` / direct host config. Pool stays at 10 locally (sufficient for single-process dev).

---

## 3. Redis Migration — Stateless API

### 3a. OAuth PKCE State → Redis

**Problem:** `microsoftOAuthStates` and `githubOAuthStates` are in-memory Maps. User starts OAuth on instance A, ALB routes the callback to instance B, login fails.

**Fix:** Replace Maps with Redis keys:

```
SET oauth:github:<state> <JSON payload> EX 600    # 10-minute TTL
SET oauth:microsoft:<state> <JSON payload> EX 600
```

On callback: `GET oauth:github:<state>` + `DEL oauth:github:<state>` (read-and-delete). Drop the in-memory Maps and their `setInterval` cleanup entirely — Redis TTL handles expiry.

**Files:** `api/src/routes/auth.ts`

**Local dev:** Works as-is — local Redis runs on port 6379 via docker-compose. If Redis is unavailable, fall back to in-memory Maps (single process, so they work fine).

### 3b. EventEmitters → Redis Pub/Sub

Three in-memory EventEmitters need to bridge across instances using the existing Redis pub/sub pattern from `redis-client.ts`:

| Emitter | Channel pattern | Payload size | DB fallback? |
|---------|----------------|--------------|--------------|
| `costEvents` | `cost:<orgId>` | Small (numeric) | Yes — 8s dashboard poll |
| `planningProgressEmitter` | `planning:<taskId>` | Small (phase + counters) | None — ephemeral by design |
| `codeEventEmitter` | `code:<taskId>` | Up to 100KB | Yes — persisted to `WorkerTaskLog` |

**Pattern:** Each emitter class keeps its local `EventEmitter` for in-process delivery but also:
- **Publish:** After local emit, call `redis.publish(channel, payload)` (fire-and-forget, no-ops if Redis unavailable)
- **Subscribe:** On SSE connection, call `redis.subscribe(channel, callback)` in addition to (or instead of) local `emitter.on()`. Unsubscribe on `req.close`.
- **Fallback:** If Redis is unavailable, local emit still works (single instance covers most events). For `costEvents` and `codeEventEmitter`, the DB polling fallback catches missed events.

This follows the exact same pattern already working for coordination events.

**Files:** `api/src/services/cost-events.ts`, `api/src/services/planning-progress-events.ts`, `api/src/services/code-events.ts`, `api/src/services/redis-client.ts`

**Local dev:** Single process — local emit works without Redis. Redis pub/sub adds redundancy but isn't required.

### 3c. Rate Limiters → Redis Store

Two inline auth rate limiters (`passwordResetLimiter`, `githubOnboardLimiter`) use in-memory stores, bypassing the Redis-backed `createStore()` used by all other limiters.

**Fix:** Switch both to use `createStore()` from `api/src/middleware/rate-limit.ts` — same Redis-backed store all other limiters use. Falls back to in-memory if Redis unavailable.

**Files:** `api/src/routes/auth.ts` (2 rate limiter definitions)

**Local dev:** Falls back to in-memory store (single process, works fine).

### 3d. Credential Cache Invalidation

`org-credentials.ts` has `invalidateOrgCredentialsCache(orgId)` which only clears the local instance's cache. After credential rotation, other instances serve stale credentials for up to 5 minutes.

**Fix:** On invalidation, publish to `cache-invalidate:org-credentials` channel with `{ orgId }`. All instances subscribe at startup and clear their local cache entry for that org. TTL still provides the safety net if Redis is down.

**Files:** `api/src/services/org-credentials.ts`, `api/src/services/redis-client.ts`

**Local dev:** Single process — local invalidation sufficient.

---

## 4. Application-Level Back-Pressure

### 4a. Dashboard SSE Query Semaphore

**Problem:** `sendUpdate()` in `control-center/stream.ts` fires `N_tasks × 3` concurrent DB queries via nested `Promise.all`. With 6+ running tasks, this is 18+ simultaneous connection requests.

**Fix:** Limit per-task concurrency to 3 tasks at a time. Use a simple semaphore (`p-limit` or hand-rolled). All tasks still get their data — later tasks wait milliseconds for a slot. Max concurrent queries capped at 9 (3 tasks × 3 queries) regardless of how many tasks are running.

**Files:** `api/src/routes/control-center/stream.ts`

**Local dev:** Same code path — semaphore applies everywhere, which is fine.

### 4b. Pool Health Middleware

**Problem:** When the pool exhausts, all requests fail simultaneously — no graceful degradation.

**Fix:** New middleware that checks pool utilization on each request. When utilization > 80% (8+ of 10 connections active, or equivalent ratio for other pool sizes):
- Non-essential endpoints return `503 Service Unavailable` with `Retry-After: 1` header
- Essential endpoints (health checks, agent poll `/api/agent/poll`, worker log POST `/api/tasks/:id/logs`, coordination SSE) are exempt — always processed
- ALB sees 503s and routes traffic to healthier instances

Pool stats exposed on the `pg.Pool` instance via `pool.totalCount`, `pool.idleCount`, `pool.waitingCount`.

**Files:** New `api/src/middleware/pool-health.ts`, register in `api/src/app.ts`

**Local dev:** Same middleware applies. Protects against local pool exhaustion during heavy epic runs. 503 is better than a crash.

### 4c. Orchestrator Fire-and-Forget Concurrency Cap

**Problem:** The poll loop fires `spawnWorker()`, `processPlanningTask()`, `runSequentialPipeline()` etc. as non-awaited promises. Under load, these pile up unbounded.

**Fix:** Track active fire-and-forget operations with a counter. If active count exceeds a threshold (e.g., 10), skip spawning new work in that poll cycle. Tasks get picked up on the next cycle (5s later). The orchestrator is a singleton, so this is just a local counter.

**Files:** `api/src/services/orchestrator.ts`

**Local dev:** Same code path — protects local dev too.

### 4d. Per-Org SSE Connection Limits

**Problem:** Each SSE connection holds a DB polling interval. No limit on concurrent connections. A runaway client or large epic can monopolize the pool.

**Fix:** Per-org connection limits enforced at SSE endpoint entry:

| Endpoint | Max per org | Behavior when exceeded |
|----------|------------|----------------------|
| Coordination SSE | 20 | `429 Too Many Connections` |
| Log stream SSE | 10 | `429` |
| Dashboard stream SSE | 5 | `429` |

Track counts in a module-level Map (per-instance is fine — ALB distributes connections). Decrement on `req.close`.

**Files:** `api/src/routes/coordination.ts`, `api/src/routes/control-center/logs.ts`, `api/src/routes/control-center/stream.ts`

**Local dev:** Same limits apply. Generous enough for normal use.

---

## 5. Observability & Graceful Shutdown

### 5a. Pool Metrics Enhancement

Extend the existing pool monitor (30s interval, warns at 80%):

- **Expose on `/health/ready`:** Include `pool.totalCount`, `pool.idleCount`, `pool.waitingCount`, `pool.max` in the JSON response. Not used by ALB health check (that uses `/health`) but useful for monitoring and alerting.
- **CloudWatch custom metric:** Publish `DBPoolUtilization` percentage every 30s. Alarm at 80% — fires before pool exhausts. Uses existing CloudWatch agent pattern.
- **Connection acquire time logging:** When a query waits >5s for a pool connection, log a warning with context (caller name, current pool stats). Shows exactly which code path is under pressure.

**Files:** `api/src/db/connection.ts`, `api/src/routes/health.ts`

### 5b. Graceful Shutdown Fix

**Problem:** Fire-and-forget operations (marketing agent, planning tasks, pipeline runs) continue running after `stopOrchestrator()` sets `state.running = false`. They can be mid-query when `AppDataSource.destroy()` closes the pool.

**Fix:** Track active fire-and-forget operations in a Set. On SIGTERM:
1. `stopOrchestrator()` — sets `state.running = false`, poll loop exits
2. Await all tracked operations with a 20-second deadline
3. `server.close()` — drain HTTP connections
4. `AppDataSource.destroy()` — close pool

This fits within the existing 25-second force-exit timeout.

**Files:** `api/src/index.ts`, `api/src/services/orchestrator.ts`

### 5c. Local Dev

All observability changes apply to local dev. Pool metrics on `/health/ready`, connection timing warnings, graceful shutdown — all useful locally. No separate behavior needed.

---

## Summary of Changes

### New Files

| File | Purpose |
|------|---------|
| `api/src/middleware/pool-health.ts` | Pool utilization middleware — 503 when pool >80% |
| `infrastructure/terraform/modules/ecs-service/orchestrator.tf` | Orchestrator ECS task definition + service |
| PgBouncer config (embedded in Terraform or mounted) | PgBouncer `pgbouncer.ini` and `userlist.txt` |

### Modified Files

| File | Change |
|------|--------|
| `api/src/db/connection.ts` | PgBouncer host support, `prepareStatements: false`, configurable pool size via env var, connection acquire time logging, enhanced pool metrics |
| `api/src/services/orchestrator.ts` | Fire-and-forget concurrency cap, operation tracking for graceful shutdown, orchestrator heartbeat to Redis |
| `api/src/services/orchestrator-utils.ts` | Export tracked operations Set for shutdown |
| `api/src/routes/auth.ts` | OAuth PKCE states → Redis, rate limiters → Redis store |
| `api/src/services/cost-events.ts` | Redis pub/sub for cross-instance delivery |
| `api/src/services/planning-progress-events.ts` | Redis pub/sub for cross-instance delivery |
| `api/src/services/code-events.ts` | Redis pub/sub for cross-instance delivery |
| `api/src/services/redis-client.ts` | New pub/sub channel methods for EventEmitters + cache invalidation |
| `api/src/services/org-credentials.ts` | Cache invalidation broadcast via Redis |
| `api/src/routes/control-center/stream.ts` | Dashboard query semaphore, SSE connection limit |
| `api/src/routes/control-center/logs.ts` | SSE connection limit |
| `api/src/routes/coordination.ts` | SSE connection limit |
| `api/src/routes/status.ts` | Read orchestrator heartbeat from Redis instead of `isOrchestratorRunning()` |
| `api/src/routes/health.ts` | Pool stats on `/health/ready` |
| `api/src/middleware/rate-limit.ts` | No change (already Redis-backed) |
| `api/src/index.ts` | Graceful shutdown awaits tracked operations |
| `api/src/app.ts` | Register pool-health middleware |
| `infrastructure/terraform/modules/ecs-service/main.tf` | Add PgBouncer sidecar container, set `ENABLE_ORCHESTRATOR=false` on API |
| `docker-compose.local.yml` | No change — local dev doesn't use PgBouncer or service split |
| `bin/local-workermill` | No change |

### Environment Variables

| Variable | Where | Value | Purpose |
|----------|-------|-------|---------|
| `ENABLE_ORCHESTRATOR` | API ECS task def | `false` | Disable orchestrator on API instances (already exists) |
| `ENABLE_ORCHESTRATOR` | Orchestrator ECS task def | `true` | Enable orchestrator on singleton instance (already exists) |
| `PGBOUNCER_HOST` | ECS task defs | `localhost` | Connect to PgBouncer sidecar instead of RDS directly |
| `DB_POOL_MAX` | ECS task defs | `20` (API) / `15` (orchestrator) | Configurable app-level pool size |
| `DB_POOL_MAX` | Local dev | Not set (defaults to 10) | Keep current local behavior |

---

## Migration Plan

1. **Deploy PgBouncer sidecar** to existing API task definition first (no service split yet). Validate connections work through PgBouncer.
2. **Deploy application changes** — Redis migrations, back-pressure, observability. All backward-compatible with single-instance.
3. **Deploy orchestrator service** — new ECS service with `desired_count: 1`. Set `ENABLE_ORCHESTRATOR=false` on API. Validate orchestrator runs independently.
4. **Scale API** — increase `desired_count` to 2+. Validate multi-instance behavior (OAuth flows, SSE events, rate limiting).

Each step is independently deployable and rollback-safe.

---

## RDS Upgrade Path

Stay on `db.t4g.micro` (~85 max connections, ~$12/mo) for now. PgBouncer multiplexing means real connection count stays well below capacity even with 6+ API instances.

If scaling beyond 8 API instances or adding additional services that need DB access: upgrade to `db.t4g.small` (~170 connections, ~$24/mo). No application changes needed — just a Terraform variable change.

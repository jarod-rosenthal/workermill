# Unified SSE Multiplexer Design

## Problem

With 2 concurrent tasks, the API handles ~260 requests/min and pegs CPU at 100% on 0.5 vCPU Fargate. The root cause is not the API architecture — it's stateless and horizontally scalable. The problem is the **demand side**: clients generate excessive, redundant requests through a combination of parallel polling loops and SSE connections that duplicate each other.

**Current per-task request breakdown (~150 req/min/task):**

| Client | Mechanism | Requests/min |
|--------|-----------|-------------|
| Dashboard | Main SSE (8s DB poll) + per-task log SSE (2s DB poll) + per-task coordination SSE + REST fallbacks | ~80 |
| VS Code | 3 panels × 5s polling × 2-3 endpoints each | ~36 |
| Worker | Per-line log POST (fire-and-forget) | ~24 |
| Agent | Task poll + heartbeat | ~12 |

**At 100 concurrent tasks:** ~15,000 req/min — unsustainable even with horizontal scaling.

**Key redundancy findings:**
- VS Code's MissionControlPanel, FeedViewProvider, and TaskDetailPanel each independently poll the same coordination + task detail endpoints at 5s intervals. Three panels open = 6 duplicate polling loops.
- VS Code has no SSE path for coordination or code events through the agent, forcing REST polling for data the dashboard receives in real-time via SSE.
- Dashboard SSE endpoints poll the database on fixed intervals (2s for logs, 8s for tasks) rather than using Redis pub/sub push.
- Workers POST individual log lines with no batching.

## Solution: Unified SSE Multiplexer

**One SSE connection per client. All real-time data flows through it on named channels. Redis pub/sub handles server-side fan-out. Database is only touched for writes and one-shot backfill reads.**

### Core Principles

1. **SSE is the sole real-time read path** — no polling loops, no fallback timers
2. **Redis pub/sub replaces DB polling** — SSE writers subscribe to Redis topics, never query the DB for live data
3. **REST is for writes and one-shot reads only** — log ingestion, code event posting, initial backfill on subscribe
4. **Stateless API unchanged** — session state is ephemeral and per-instance, reconstructable on reconnect
5. **Horizontal scaling unchanged** — more instances = more capacity, ALB distributes connections

### Request Volume Impact

| Client | Current (per task) | After (per task) |
|--------|-------------------|-----------------|
| Dashboard | ~80 req/min | ~2 req/min (writes + one-shot backfills) |
| VS Code (3 panels) | ~36 req/min | ~0 req/min (SSE only) |
| Worker | ~24 req/min | ~4 req/min (batched log POST) |
| Agent | ~12 req/min | ~2 req/min (heartbeat only) |
| **Total** | **~150 req/min** | **~8 req/min** |

**At 100 concurrent tasks:** 15,000 req/min → 800 req/min

### DB Connection Impact

**Note:** PgBouncer sidecar already exists on API ECS tasks (`main.tf:208-241`), with `DEFAULT_POOL_SIZE=8`, `MAX_CLIENT_CONN=50`. The API container connects through PgBouncer at `127.0.0.1:5432` (`PGBOUNCER_HOST`/`PGBOUNCER_PORT` env vars at `main.tf:165-166`). TypeORM auto-disables prepared statements when `PGBOUNCER_HOST` is set (`connection.ts:302`).

| | Current (with PgBouncer) | After |
|---|---------|-------|
| Actual RDS connections (2 API instances) | ~16 (8 server conns × 2 instances) | Same — PgBouncer unchanged |
| DB checkouts/min (10 clients, 5 tasks) | ~260 (constant polling) | ~30-50 (writes + occasional one-shot reads) |
| Peak concurrent connections | Spikes when polls align — PgBouncer queues excess | Steady, write-driven only |
| SSE connections holding DB connections | Yes (DB poll every 2-8s per SSE) | No (SSE reads from Redis only) |

**Pre-existing issue:** `DB_POOL_MAX=60` (`main.tf:167`) exceeds PgBouncer `MAX_CLIENT_CONN=50` (`main.tf:218`). Under sustained load, TypeORM can attempt 60 client connections but PgBouncer only allows 50, causing connection refusals. Fix: raise `MAX_CLIENT_CONN` to 100 (Phase 0).

---

## Channel Architecture

### Channel Types

| Channel | Pattern | Volume | Delivery |
|---------|---------|--------|----------|
| `tasks` | Org-wide task state, stats, queue | Low (~1 event per state change) | Auto-pushed on connect |
| `logs:{taskId}` | Terminal output lines | High | Subscribe per task |
| `coordination:{taskId}` | Expert messages, questions, answers | Medium | Subscribe per task |
| `code:{taskId}` | File Write/Edit events | Low-Medium | Subscribe per task |
| `cost:{taskId}` | Real-time cost ticks | Low | Subscribe per task |

**Auto-pushed** channels are always delivered once connected. **Subscribe** channels require explicit opt-in — prevents flooding a client with log output from 100 tasks they're not looking at.

### Redis Pub/Sub Topics

```
stream:org:{orgId}:tasks              → task lifecycle, stats, queue state
stream:task:{taskId}:logs             → log lines (from batched worker POST)
stream:task:{taskId}:coordination     → expert messages, questions, answers
stream:task:{taskId}:code             → file Write/Edit events
stream:task:{taskId}:cost             → cost ticks
```

### Event Wire Format

```
id: 1708900000123
event: message
data: {"ch":"logs:abc123","t":"log","p":{"message":"Building...","level":"info","ts":"..."}}
```

- `id` — composite `{counter}:{epoch_ms}` format. `counter` is monotonic per-session (starts at 0, increments per event) for ordering. `epoch_ms` is the server timestamp at emission for gap detection on reconnect. On reconnect with `Last-Event-ID`, server parses the `epoch_ms` portion, computes the gap, and replays events from DB `WHERE created_at > to_timestamp(epoch_ms / 1000)`. This avoids clock skew issues (single server clock per event emission) while providing both ordering (counter) and temporal anchoring (epoch_ms) in one field.
- `ch` — channel name (client routes to handler)
- `t` — event type within channel
- `p` — payload

---

## Server-Side Architecture

### SSE Endpoint

Single new endpoint replaces all existing SSE streams:

```
GET /api/stream?token=<jwt>
```

On connect:
1. Authenticate JWT, resolve org
2. Generate `sessionId` (UUID), send as first event
3. Auto-subscribe to `stream:org:{orgId}:tasks` Redis topic
4. Hold connection open, write events as they arrive from Redis

### Subscription Management (Redis-Mediated)

SSE is unidirectional (server→client), so subscriptions are managed via companion REST endpoints:

```
POST /api/stream/subscribe     { sessionId, channels: ["logs:abc123", "coordination:abc123"] }
POST /api/stream/unsubscribe   { sessionId, channels: ["logs:abc123"] }
```

**Critical design constraint:** ALB round-robins REST requests, so `POST /subscribe` may hit a different instance than the one holding the SSE connection. Subscriptions must be mediated through Redis, not stored in-memory.

**How it works:**
1. `POST /api/stream/subscribe` writes the subscription change to a Redis control channel: `PUBLISH session:{sessionId}:control {"action":"subscribe","channels":["logs:abc123"]}`
2. The instance holding the SSE connection subscribes to `session:{sessionId}:control` when the session is created
3. When it receives the control message, it adds/removes the corresponding Redis data topic subscriptions
4. Any API instance can handle the subscribe/unsubscribe REST call — no sticky sessions needed

This keeps the API truly stateless. The REST handler validates session ownership (authenticated userId must match session owner), then does a one-line Redis PUBLISH. The SSE writer reacts to control messages. ALB routing is irrelevant.

### Session State (Per-Instance, Ephemeral)

Each API instance keeps an in-memory map for its locally-held SSE connections only:

```
Map<sessionId, {
  res: Response,                    // Held-open SSE response
  orgId: string,
  userId: string,                   // Owner — subscribe/unsubscribe validated against this
  redisSubscriptions: Set<string>,  // Active Redis data topic subscriptions
  controlSubscription: string,      // Redis control channel for this session
  bufferBytes: number,              // Current write buffer size (for backpressure)
  eventCounter: number,             // Monotonic event ID counter (starts at 0)
  lifetimeTimer: NodeJS.Timeout,    // 4-hour max connection timer (cleared on destroy)
}>
```

Not shared across instances. If an instance dies, the client reconnects to another instance and re-subscribes. Stateless from the cluster perspective — session state is ephemeral and fully reconstructable from the client's re-subscribe call.

**Session ownership validation:** `POST /api/stream/subscribe` and `POST /api/stream/unsubscribe` verify that the authenticated user/org matches the session owner. For user-authenticated sessions (JWT), `userId` is checked. For agent sessions (API key), `orgId` is checked (agents are org-scoped, not user-scoped). The sessionId is a UUID (unguessable), and the ownership check is a defense-in-depth measure.

**Channel authorization (CRITICAL):** The session manager validates that the user is authorized to access the requested channel's data before subscribing. For task-scoped channels (`logs:{taskId}`, `coordination:{taskId}`, `code:{taskId}`, `cost:{taskId}`), the task's `orgId` must match `session.orgId`. For org-scoped channels (`org:{orgId}:tasks`), the requested `orgId` must match `session.orgId`. Without this check, an authenticated user from Org A could subscribe to `logs:task-from-org-B` and receive cross-org data.

**Channel name validation:** Channel names are validated against a whitelist regex (`^(logs|coordination|code|cost):[a-f0-9-]{36}$` or `^org:[a-f0-9-]{36}:tasks$`). Invalid names are rejected before reaching Redis. This prevents subscription to internal Redis channels and limits attack surface.

### Event Flow (Example: Worker Posts a Log Batch)

```
Worker POST /api/control-center/logs { batch: [line1, line2, ...] }
  → API writes batch to DB (single INSERT)
  → API publishes each line to Redis stream:task:{taskId}:logs
  → All SSE writers subscribed to that topic receive it
  → SSE writer serializes and pushes to connected clients
```

DB write and Redis publish happen in the same request handler. SSE writers are separate long-lived connections that only listen to Redis — they never query the DB for live data.

### Redis Subscriber Architecture

Each API instance creates **one Redis subscriber connection per SSE session** (using ioredis). This is deliberate — sharing a single Redis subscriber across 300+ SSE sessions creates a scalability ceiling (one `message` callback dispatches to all sessions, creating a serialization bottleneck) and introduces cross-session refcount bugs.

**Per-session subscriber:** Each SSE session gets its own `redis.duplicate()` subscriber. When the session subscribes to `logs:abc123`, the subscriber calls `SUBSCRIBE stream:task:abc123:logs`. When the session ends, the subscriber calls `UNSUBSCRIBE` on all topics and `quit()`. No shared state, no refcount bugs.

**Redis connection overhead:** Each subscriber is a TCP connection (~8KB memory on Redis side). At 300 SSE sessions per instance, that's ~2.4MB on Redis — well within `cache.t4g.micro` limits (500MB available). The alternative (shared subscriber with in-memory fan-out) saves Redis connections but adds complexity and a serialization bottleneck.

**If this becomes a concern at scale (1000+ sessions/instance):** Pool subscribers — each subscriber handles N sessions (e.g., 10), with in-memory routing. But don't optimize for this until Redis `connected_clients` metrics indicate pressure.

### JWT Token Lifecycle on Long-Lived Connections

SSE connections authenticate via `?token=<jwt>` on connect. JWTs have an expiry (typically 1 hour). SSE connections can last much longer. Policy:

1. **Authenticate once on connect.** Do not periodically revalidate the JWT — this would require DB lookups and defeats the purpose of stateless JWT.
2. **Set a maximum connection lifetime of 4 hours.** After 4 hours, the server sends a `reconnect` event. The client reconnects with a fresh JWT (it refreshes tokens independently via the auth flow). This limits exposure if a token is compromised.
3. **Immediate disconnect on user deactivation.** When a user is deactivated or their org membership is revoked, publish a control message via Redis: `PUBLISH session:{sessionId}:control {"action":"disconnect","reason":"auth_revoked"}`. The SSE writer disconnects the session immediately.

This is the same approach used by Slack, Discord, and other real-time platforms. Periodic revalidation on every heartbeat would reintroduce DB load.

### Connection Keepalive

ALB kills connections idle for 60 seconds. SSE connections must send periodic heartbeat pings to stay alive through the ALB:

```
: keepalive
```

(SSE comment line — ignored by EventSource, resets ALB idle timer.)

Heartbeat interval: **every 30 seconds**. This is standard SSE practice and ensures connections survive through any intermediary proxy or load balancer.

### Backpressure Policy

If a client can't consume events fast enough (slow network, overloaded browser tab), the Node.js response write buffer grows per-connection. Without limits, this is a memory leak under load.

**Policy:**
1. Track `bufferBytes` per session (bytes written but not flushed to TCP)
2. When `bufferBytes` exceeds **256 KB**: drop non-critical events (cost ticks, planning progress) — keep logs and coordination
3. When `bufferBytes` exceeds **1 MB**: disconnect the client with a `reconnect` event. Client reconnects fresh and catches up via `Last-Event-ID` backfill.

Node.js `res.write()` returns `false` when the internal buffer is full. Use the `drain` event to track buffer recovery. This is the same pattern used by `socket.io` and `Pusher` for slow client handling.

### Connection Limits

Per-org caps prevent a buggy or malicious client from exhausting server resources:

| Limit | Value | Rationale |
|-------|-------|-----------|
| Max SSE connections per org | 20 | Enough for a team (dashboards + VS Code agents), not enough to DDoS |
| Max channel subscriptions per session | 50 | ~10 active tasks × 5 channels each |

When a new connection exceeds the org limit, reject with HTTP 429 and `Retry-After: 5`. The client falls back to polling (old endpoints still available during migration) or waits for a slot.

### Redis Publish Integration Points

Every write path publishes to the corresponding Redis topic:

| Write Endpoint | Redis Topic |
|---------------|-------------|
| `POST /api/control-center/logs` | `stream:task:{taskId}:logs` |
| `POST /api/control-center/code-events` | `stream:task:{taskId}:code` |
| Coordination writes (various) | `stream:task:{taskId}:coordination` |
| Task state changes (various) | `stream:org:{orgId}:tasks` |
| Cost updates | `stream:task:{taskId}:cost` |

---

## Backfill Strategy

### Initial Connection (No Last-Event-ID)

When a client subscribes to a task's channels, it fetches history via one-shot REST:

| Channel | Backfill Endpoint | Limit | Rationale |
|---------|------------------|-------|-----------|
| `tasks` | Snapshot sent on SSE connect | N/A | Point-in-time state, not event replay |
| `logs:{taskId}` | `GET /api/backfill/logs/:taskId?limit=200` | 200 lines | Sufficient terminal scrollback |
| `coordination:{taskId}` | `GET /api/backfill/coordination/:taskId?limit=50` | 50 messages | Recent conversation context |
| `code:{taskId}` | `GET /api/backfill/code/:taskId` | All events | Required to reconstruct file diffs (client-side accumulation) |
| `cost:{taskId}` | Included in task snapshot | N/A | Current total only |

Backfill is delivered via REST, not pumped through the SSE pipe. This keeps the SSE connection lightweight and prevents large backfill payloads from blocking real-time events.

**Backfill + SSE Deduplication:** There's a race window between subscribing (which starts live SSE delivery) and fetching backfill (which returns historical data). Events created during this window may appear in both. The client handles this:

1. Subscribe to channel → SSE events start flowing → buffer them in memory
2. Fetch backfill via REST → backfill response includes a `cursor` (DB timestamp of newest included event)
3. Merge: render backfill, then replay buffered SSE events that have `created_at > cursor`
4. Switch to live consumption

This is the same pattern used by Slack's real-time messaging — subscribe first, backfill second, dedup by timestamp. The server does not need to participate in dedup.

### Reconnection (With Last-Event-ID)

The SSE spec provides `Last-Event-ID` — the browser/client automatically sends it on reconnect.

- **Gap < 5 minutes:** Server replays missed events from DB, then switches to live Redis stream. Client sees no gap.
- **Gap > 5 minutes:** Server sends a `refresh` event. Client re-fetches via REST backfill endpoints and re-subscribes. Prevents massive replay dumps.

```
event: refresh
data: {"reason":"gap_too_large","channels":["logs:abc123","coordination:abc123"]}
```

### Graceful Shutdown (Rolling Deploys + Scale-In)

On SIGTERM (rolling deploy, scale-in, or manual stop), the API's existing graceful shutdown handler (`api/src/index.ts:415-442`) fires. The SSE multiplexer integrates into this existing handler — it does NOT register a separate SIGTERM listener.

**Integration point:** The existing handler calls `server.close()` which stops new connections. Before that call, the SSE shutdown hook runs:

1. Sends a proactive reconnect signal to each SSE session with a **random stagger delay** (0-3000ms):
   ```
   event: reconnect
   data: {"reason":"server_shutdown","delay":1234}
   ```
   The `delay` field tells the client how many milliseconds to wait before reconnecting. This spreads 300 reconnects across 3 seconds instead of a thundering herd.
2. Waits 3.5 seconds (enough for all clients to receive their delay)
3. Unsubscribes from all Redis topics (data + control channels), clears all lifetime timers
4. Closes all SSE response streams
5. Returns control to the existing handler (which then calls `server.close()`, waits for in-flight requests, disconnects DB/Redis, and exits)

The existing 25-second force-exit timer (`index.ts:438-441`) remains as the ultimate backstop. The SSE stagger (3.5s) + active operations wait (up to 20s) + server close fits within the 25s budget. ECS `stopTimeout` is 30s, providing 5s of additional margin.

Client receives the `reconnect` event → waits `delay` ms → calls `EventSource.close()` → creates a **new** `EventSource` instance (note: `close()` permanently kills auto-reconnect — a new instance is required) → new instance connects to ALB, sends `Last-Event-ID` header → server backfills any gap → client re-sends subscribe requests for its active channels → live events resume.

**No client-visible disruption to terminal sessions.** The reconnect is fast enough that log output appears continuous. The only observable effect is a brief pause (<3-6s) in the event stream — no errors, no lost data, no UI flicker if the client handles the `reconnect` event cleanly (suppress the default EventSource error handler during intentional reconnects).

---

## Client-Side Changes

### Dashboard (React Frontend)

**Current:** 1 main SSE + N per-task log SSEs + N per-task coordination SSEs + REST fallback polls

**After:** 1 SSE connection + REST backfill on subscribe

Flow:
1. `MainDashboard` mounts → connect `EventSource` to `GET /api/stream?token=...`
2. Receive `sessionId` from first event, auto-receive `tasks` channel
3. User opens task detail → `POST /api/stream/subscribe` for that task's channels + one-shot REST backfill
4. Live events flow in on channels, update existing Zustand stores
5. User closes task detail → `POST /api/stream/unsubscribe`

**Eliminated:**
- `startPolling()` / `stopPolling()` fallback loop
- `fetchTerminalLogs()` interval
- Per-task `EventSource` connections for log streams
- `EmbeddedCommunicationsFeed` separate SSE connections

**Kept (one-shot REST, not polling):**
- `fetchOrgSettings()` on mount — org settings aren't real-time
- `fetchPersistedErrors()` per task — not a real-time data flow
- Worker offline detection timer — pure in-memory, no network calls

### Agent

Agent subscribes to one multiplexed SSE from the cloud and re-broadcasts to VS Code.

**Cloud-facing:**
- Connect `EventSource` to `GET /api/stream?token=...`
- Auto-receive `tasks` channel (replaces `GET /api/agent/poll` for task discovery)
- Subscribe to channels for active tasks it manages
- Keep `POST /api/agent/heartbeat` as-is (write path — carries diagnostics, GPU info, cancellation signals)
- Fall back to `GET /api/agent/poll` if unified stream unavailable (backward compat)

**VS Code-facing (agent local API):**
- `GET /api/stream` (local) — re-broadcasts cloud events to VS Code
- `POST /api/stream/subscribe` / `POST /api/stream/unsubscribe` (local) — agent translates to cloud
- Backfill endpoints (local) — agent proxies to cloud REST backfill

### VS Code Extension

**Current:** 3 panels with independent 5s polling loops = 9 REST calls every 5 seconds for the same data.

**After:** Shared subscription layer in `AgentClient` with reference counting.

```
Panel 1 subscribes to coordination:abc → refcount=1, send subscribe to agent
Panel 2 subscribes to coordination:abc → refcount=2, no-op (already subscribed)
Panel 1 closes → refcount=1, keep subscription
Panel 2 closes → refcount=0, send unsubscribe to agent
```

Three panels watching the same task = one subscription, one set of events, three UI updates.

**Eliminated:**
- `MissionControlPanel.startPolling()`
- `FeedViewProvider.startPolling()`
- `TaskDetailPanel.startPolling()`
- `LiveDiffManager` polling timer

### Worker

Minimal changes. Workers already use SSE for coordination.

**Log batching (new):**
- Buffer log lines in memory
- Flush on: 50 lines OR 500ms since last flush OR task completion (final flush)
- Single `POST /api/control-center/logs` with array payload
- Reduces log POST volume from ~24 req/min/task to ~3-5 req/min/task

**Code event posting:** Unchanged — already fire-and-forget, low volume.

**Coordination SSE:** Leave as-is on the separate endpoint. Workers are short-lived per task and already efficient. Migrating to unified stream is optional and low-priority.

---

## Migration Path

Incremental rollout. Old and new coexist at every phase. Every phase is independently reversible.

### Phase 0: Database Foundation

Fix pre-existing config issues and prepare for scaling BEFORE building SSE infrastructure.

1. Fix PgBouncer `MAX_CLIENT_CONN` (50→100) on existing API sidecar — resolves pre-existing mismatch with `DB_POOL_MAX=60`
2. Increase `DEFAULT_POOL_SIZE` (8→10) for SSE write burst headroom
3. Read replica Terraform resource (disabled by default — enable at 50+ tasks)
4. TypeORM replication config with PgBouncer routing for replica traffic (activates when `DB_REPLICA_HOST` is set)

**Deploy and validate. No client impact. Minimal code changes (connection.ts for replication).**

### Phase 1: Server-Side Foundation

Build new infrastructure without touching any clients.

1. Redis publish on every write path (logs, code events, coordination, task state, cost)
2. New unified SSE endpoint (`api/src/routes/stream.ts`) with session management
3. Subscribe/unsubscribe REST endpoints (Redis-mediated)
4. Backfill REST endpoints with rate limiting (50 req/s/org for reconnection storm protection)
5. `Last-Event-ID` handling with 5-minute gap detection
6. EMF metric emission for auto-scaling
7. Graceful shutdown: SIGTERM → send `reconnect` event with stagger delay (0-3s random per client)

**Deploy and validate. No client impact. Old endpoints unchanged.**

### Phase 2: Dashboard Migration

Behind a feature flag (org setting or query param).

1. New `useUnifiedStream` hook — manages single EventSource, session, subscriptions
2. Channel router dispatches events to existing Zustand stores
3. Replace per-task SSE connections + fallback polling with unified stream
4. Client-side subscribe/backfill ordering: subscribe first, buffer SSE events, fetch backfill, merge by event ID, then consume live stream
5. Validate behind flag, flip to default-on

### Phase 3: Agent + VS Code Migration

Ships as a version bump. Users get it on update.

1. Agent unified stream client (cloud-facing) with poll fallback
2. Agent local API mirrors unified stream (VS Code-facing)
3. VS Code `AgentClient` shared subscription layer with reference counting
4. Delete all panel polling loops
5. Backward compatibility: version negotiation — new extension + old agent falls back to polling

### Phase 4: Worker Log Batching

Independent of SSE work. Can run in parallel with Phases 2-3.

1. Log buffer in executor (50 lines / 500ms / task completion)
2. Crash safety: `beforeExit` + `SIGINT`/`SIGTERM` handlers for final flush
3. API batch ingestion endpoint (accepts array, publishes per-line to Redis)
4. Old single-line POST still accepted (backward compat)

### Phase 5: Infrastructure — Auto-Scaling and ALB

1. ALB idle timeout (120s), target group deregistration delay (30s)
2. ECS auto-scaling policies (target tracking on SSE connection count, step scaling guardrails)
3. Predictive scaling (Forecast Only → Forecast And Scale after 2 weeks of data)

### Phase 6: Cleanup

After all clients migrated and validated.

1. Remove old SSE endpoints
2. Remove `GET /api/agent/poll` (or keep as emergency fallback)
3. Remove polling fallback code from all clients
4. Remove feature flag

### Phase Dependencies

```
Phase 0 (Database)   ████░░░░░░░░░░░░░░░░  ← prerequisite for horizontal scaling
Phase 1 (Server)     ░░░░████████░░░░░░░░  ← depends on Phase 0
Phase 2 (Dashboard)  ░░░░░░░░████████░░░░  ← depends on Phase 1
Phase 3 (Agent+VSC)  ░░░░░░░░░░░░████████  ← depends on Phase 1, parallel with Phase 2
Phase 4 (Worker)     ░░░░░░░░████████░░░░  ← independent (parallel with Phases 2-3)
Phase 5 (Infra)      ░░░░░░░░░░░░████████  ← after Phase 1 (needs EMF metrics live)
Phase 6 (Cleanup)    ░░░░░░░░░░░░░░░░████  ← after all clients migrated
```

### Rollback

| Phase | Rollback |
|-------|----------|
| Phase 0 | Revert PgBouncer config changes. Remove `DB_REPLICA_HOST` env var. Remove read replica resource. |
| Phase 1 | Delete new endpoints. No client uses them. |
| Phase 2 | Flip feature flag off. Dashboard reverts to old SSE + polling. |
| Phase 3 | Users downgrade agent/extension. Old polling paths still work. |
| Phase 4 | Deploy old worker image. Single-line POST still accepted. |
| Phase 5 | Revert Terraform (scaling policies, ALB settings). |

---

## Infrastructure Requirements

### Redis (ElastiCache)

Currently running `cache.t4g.micro` (single node). Redis becomes the backbone of all real-time data delivery — if Redis goes down, all SSE streams stop.

**High Availability strategy (phased):**

| Scale | Redis Configuration | Rationale |
|-------|-------------------|-----------|
| Launch (10-50 tasks) | Single `cache.t4g.micro` (current) | Sufficient. Redis restarts in seconds. Brief SSE reconnection is acceptable at this scale. |
| Growth (50-200 tasks) | `cache.t4g.small` with Multi-AZ replica | Automatic failover if primary dies. Replica promotes in ~15s. Clients reconnect seamlessly via `Last-Event-ID`. |
| Scale (200+ tasks) | `cache.t4g.medium` with Multi-AZ replica | More memory for pub/sub subscriber state and connection buffers. |

**Redis failure mode:** If Redis is completely unavailable, SSE writers have nothing to listen to. Clients remain connected but receive no events (heartbeat pings keep the connection alive). When Redis recovers, pub/sub resumes automatically. Clients may have a gap — `Last-Event-ID` backfill from DB covers it.

**No DB polling fallback in the unified SSE writer.** The old SSE endpoints (which do poll the DB) remain available during migration phases, so clients on old code paths are unaffected. Adding a DB polling fallback to the new writer would defeat the purpose and reintroduce the original scaling problem.

**Redis pub/sub memory management:** High-volume log channels push through pub/sub. If an SSE writer (subscriber) falls behind, Redis buffers messages in the subscriber's output buffer. Default `client-output-buffer-limit` for pub/sub is `32mb 8mb 60` (32MB hard, 8MB soft sustained for 60s). At scale with many log channels, a slow subscriber could hit this limit and get disconnected by Redis. Set explicit limits in the ElastiCache parameter group:

```
client-output-buffer-limit pubsub 64mb 16mb 120
```

This gives subscribers more headroom before Redis disconnects them. Combined with the SSE-side backpressure policy (drop events at 256KB, disconnect at 1MB), slow clients get cut off before they stress Redis.

**Monitoring:** `pubsub_channels`, `connected_clients`, `used_memory`, `pubsub_patterns`. Alert if `connected_clients` exceeds 80% of max connections (default 65,000 for t4g.micro). Alert if `used_memory` exceeds 70% of instance capacity.

### ECS Fargate

No changes to task definition. More SSE connections per instance, but each connection is lightweight (no DB polling, no DB connection held). May actually need fewer instances than before due to dramatically reduced CPU load.

**Deregistration delay:** Set ALB target group deregistration delay to **30 seconds** (up from default 300s). On scale-in or rolling deploy:
1. ECS sends SIGTERM to old task
2. API sends `reconnect` event to all SSE sessions (immediate)
3. Clients reconnect to new instances via ALB (1-3s)
4. 30s deregistration window is more than enough for graceful handoff
5. Old task terminates cleanly

The 300s default is excessive for SSE — we don't want long-lived connections lingering on draining instances.

### ALB

SSE connections are long-lived HTTP/1.1. Key settings:

| Setting | Value | Rationale |
|---------|-------|-----------|
| Idle timeout | 120s | Must exceed heartbeat interval (30s). Provides 4 missed heartbeats before ALB kills the connection. |
| Deregistration delay | 30s | SSE clients reconnect in 1-3s after graceful shutdown signal. No need to hold for 300s. |
| Sticky sessions | **OFF** | Not needed. Redis-mediated subscriptions allow any instance to handle subscribe/unsubscribe. |

### CloudFront (CRITICAL)

The dashboard frontend routes ALL `/api/*` requests through CloudFront (same-origin, `VITE_API_URL=""` resolves to relative URLs). CloudFront's `/api/*` cache behavior currently has `compress = true`, which can buffer SSE event delivery.

**Existing SSE works** because the current endpoints already stream through CloudFront with 30s heartbeats and `origin_read_timeout = 60s`. However, the unified SSE endpoint needs explicit protection:

1. **Disable compression for SSE path** — add a separate CloudFront cache behavior for `/api/stream*` with `compress = false`. Gzip compression buffers data and can delay SSE events by seconds.
2. **Verify `origin_read_timeout`** — current 60s is sufficient since heartbeat (30s) keeps data flowing well within the timeout. The 4-hour max connection lifetime works because each heartbeat resets the timeout.
3. **Set `Content-Encoding: identity`** — API SSE endpoint should set this header to prevent CloudFront from attempting gzip compression even if the cache behavior has `compress = true` as a fallback.

**Agent SSE connections bypass CloudFront** — agents connect directly to the API via `API_BASE_URL` (`https://workermill.com`), which resolves through CloudFront. This is the same path as the dashboard. If SSE through CloudFront proves unreliable at scale, agents can be pointed at the ALB directly via a separate `API_SSE_URL` env var. This is a fallback, not a Phase 1 requirement.

### Database (PostgreSQL RDS) — SCALING PLAN

The current database is a **single `db.t4g.micro` instance** (1 GiB RAM, single AZ, no read replicas). While PgBouncer already handles connection pooling, the instance size and lack of read replicas/HA are scaling ceilings.

#### Current State: PgBouncer Already in Place

PgBouncer sidecar **already exists** on both API and orchestrator ECS tasks:

- API: `main.tf:208-241` — `DEFAULT_POOL_SIZE=8`, `MAX_CLIENT_CONN=50`
- Orchestrator: `orchestrator.tf:85-117` — same config
- API container already sets `PGBOUNCER_HOST=127.0.0.1`, `PGBOUNCER_PORT=5432` (`main.tf:165-166`)
- TypeORM already disables prepared statements when `PGBOUNCER_HOST` is set (`connection.ts:302`)

RDS `max_connections` formula: `LEAST(DBInstanceClassMemory / 9531392, 5000)`

For `db.t4g.micro` (1 GiB): **max_connections ≈ 112**

| Component | PgBouncer Server Conns | Actual RDS Connections |
|-----------|----------------------|----------------------|
| 2 API instances × PgBouncer (`DEFAULT_POOL_SIZE=8`) | 8 each | 16 |
| 1 orchestrator × PgBouncer (`DEFAULT_POOL_SIZE=8`) | 8 | 8 |
| **Total** | | **~24** |

Connection exhaustion is **not an immediate risk** thanks to PgBouncer. However, there's a pre-existing config bug and the instance itself is undersized.

#### Fix 1: PgBouncer Config Fix (Phase 0)

**Pre-existing bug:** `DB_POOL_MAX=60` (`main.tf:167`) exceeds PgBouncer `MAX_CLIENT_CONN=50` (`main.tf:218`). Under sustained load (all TypeORM pool connections active), 10 connection attempts fail with "no more connections allowed."

**Fix:** Increase `MAX_CLIENT_CONN` from 50 to 100 in the PgBouncer container environment. Also increase `DEFAULT_POOL_SIZE` from 8 to 10 to give each API instance slightly more RDS headroom for the SSE write bursts (Redis publishes trigger DB writes in the same request handler).

#### Fix 2: RDS Instance Upgrade Path

| Scale | Instance | Memory | max_connections | With PgBouncer | Est. Cost |
|-------|----------|--------|-----------------|---------------|-----------|
| Current (10 tasks) | `db.t4g.micro` | 1 GiB | ~112 | Sufficient with PgBouncer | $12/mo |
| Growth (50 tasks) | `db.t4g.small` | 2 GiB | ~224 | Comfortable headroom | $24/mo |
| Scale (100+ tasks) | `db.t4g.medium` | 4 GiB | ~448 | Room for read replicas + many instances | $48/mo |
| Enterprise (500+ tasks) | `db.r7g.large` | 16 GiB | ~1,680 | Full horizontal scaling | $190/mo |

Upgrade to `db.t4g.small` when traffic warrants it. The micro instance CPU is also a constraint for complex queries (6-way board JOINs, full-text search, analytics aggregations).

**RDS Resize Downtime Mitigation:** Instance class modifications cause 5-10 minutes of downtime (RDS restarts). Mitigate:
1. Schedule during lowest-traffic window (check CloudWatch `DatabaseConnections` metric for the quietest hour)
2. Set `apply_immediately = true` in Terraform (don't wait for maintenance window)
3. API PgBouncer sidecar auto-reconnects after RDS restart — no API code changes needed
4. SSE clients experience a brief gap, covered by `Last-Event-ID` backfill on reconnect
5. For future resizes with Multi-AZ enabled: RDS does a rolling upgrade (standby first, failover ~60s, then old primary) with near-zero downtime

#### Fix 3: Read Replica

A read replica offloads read-only queries to a separate instance. The SSE multiplexer eliminates DB polling for real-time reads, but significant read load remains:

**Route to read replica (safe, no read-after-write dependency):**

| Query Pattern | File | Frequency | Complexity |
|--------------|------|-----------|------------|
| SSE backfill (logs, coordination, code) | backfill endpoints (new) | Per-reconnect burst | Medium |
| Board detail (6-way JOINs) | `boards.ts:640` | Per user click | Very high |
| Dashboard control center (500 tasks/org) | `dashboard.ts:22` | Per page load | High |
| Analytics (stats, costs, token usage) | `analytics/*.ts` | Per session | Medium |
| Full-text log search | `search.ts:14` | On-demand | Very high |
| Board list with card counts | `boards.ts:355` | Per page load | Medium |

**Must stay on primary (write-dependent):**

| Query Pattern | Why Primary |
|--------------|-------------|
| Orchestrator task claiming | Atomic `UPDATE...WHERE status='queued'` |
| Task state transitions | Read-after-write consistency |
| Coordination write+read | Workers read their own writes |
| Log ingestion | Write path |

**TypeORM native replication support:**

```typescript
export const AppDataSource = new DataSource({
  type: "postgres",
  replication: {
    master: {
      host: process.env.PGBOUNCER_HOST || dbHost,  // Primary through PgBouncer
      port: parseInt(process.env.PGBOUNCER_PORT || "5432"),
      ...credentials,
    },
    slaves: [{
      host: process.env.PGBOUNCER_HOST || dbHost,  // Replica ALSO through PgBouncer
      port: parseInt(process.env.PGBOUNCER_REPLICA_PORT || "5433"),
      ...credentials,
    }],
  },
});
```

**Critical: Replica traffic MUST go through PgBouncer** to maintain connection pooling. Run a second PgBouncer listener on port 5433 pointed at the replica endpoint. Without this, TypeORM's replica pool creates `DB_POOL_MAX` (60) direct connections to the replica, bypassing PgBouncer entirely. The PgBouncer sidecar container supports multiple databases — configure a separate `[replica]` section in the PgBouncer config.

TypeORM routes `find*()` / `.getMany()` / `.getOne()` to slaves, and `save()` / `update()` / `insert()` / `.execute()` to master automatically. For explicit read-after-write cases, use `queryRunner` on master.

**Replica lag tolerance:** All read-replica candidates tolerate 1-5s lag. Backfill queries serve reconnecting clients (1-2s stale is invisible). Board/analytics queries are inherently non-real-time.

**Phased rollout:**

| Scale | Database Configuration | Rationale |
|-------|----------------------|-----------|
| Launch (10-50 tasks) | `db.t4g.micro` (existing) + PgBouncer fix (`MAX_CLIENT_CONN` 50→100) | Fix config bug, PgBouncer already handles connection pooling |
| Growth (50-200 tasks) | + Read replica (`db.t4g.small`) | Offload backfill bursts, board JOINs, analytics, search |
| Scale (200+ tasks) | `db.t4g.medium` primary + `db.t4g.medium` replica + Multi-AZ | Full HA, handle enterprise load |

#### Fix 4: Multi-AZ (Reliability)

Currently single-AZ. AZ failure = total database outage.

| Scale | Configuration | Cost Impact |
|-------|--------------|-------------|
| Current | Single AZ | — |
| Growth (paying customers) | Multi-AZ standby | ~2x instance cost (automatic failover ~60s, zero data loss) |
| Scale | Multi-AZ primary + read replica in different AZ | Full HA across zones |

Enable Multi-AZ when onboarding paying customers. The standby is synchronous replication — zero data loss on failover.

#### Fix 5: Backfill Reconnection Storm Protection

Rolling deploy or scale-in triggers all SSE clients on one instance to reconnect simultaneously. Each client fires 3-5 backfill REST requests (logs 200 lines, coordination 50 messages, code events). With 300 connections per instance, that's **900-1500 backfill queries in 1-3 seconds**.

**Mitigations:**
1. **Stagger reconnection:** Instead of all clients reconnecting at `t=0`, the server's `reconnect` event includes a random `delay` field (0-3000ms). Clients wait `delay` ms before reconnecting. Spreads 300 clients across 3 seconds instead of a thundering herd.
2. **Rate limit backfill endpoints:** Per-org rate limit on backfill (50 req/s). Clients that exceed get 429 + `Retry-After`. The SSE connection itself is already live — they just don't get backfill history until the rate limit window passes.
3. **Route backfill to read replica:** Backfill queries are read-only and tolerate 1-2s lag. Read replica absorbs the burst without impacting primary write performance.

## Auto-Scaling Strategy

### Why Traditional Metrics Fail for SSE

With the shift from polling to SSE, the workload profile changes fundamentally:

| Metric | Polling Workload | SSE Workload | Useful for Scaling? |
|--------|-----------------|--------------|-------------------|
| CPU | High (every request = CPU work) | Very low (idle connections, occasional serialization) | No — CPU stays at 5-10% even with 500 connections |
| `ALBRequestCountPerTarget` | High (measures request throughput) | Near-zero (each SSE is ONE long-lived request) | No — doesn't reflect connection load |
| Memory | Correlates with request volume | Correlates with connection count + buffers | Loosely — too noisy to be primary |
| **SSE connection count** | N/A | Directly proportional to real load | **Yes — this is what we scale on** |

### Metric Emission: CloudWatch Embedded Metric Format (EMF)

The API emits a custom CloudWatch metric using [Embedded Metric Format](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format.html) — the modern approach for Fargate. The application writes structured JSON to stdout. The `awslogs` log driver (already configured) picks it up and CloudWatch automatically extracts the metric. No SDK calls, no sidecar, no additional IAM permissions beyond `logs:PutLogEvents` (already granted).

**Emitted every 60 seconds from each API instance:**

```json
{
  "_aws": {
    "Timestamp": 1708900000000,
    "CloudWatchMetrics": [{
      "Namespace": "WorkerMill/API",
      "Dimensions": [["ServiceName", "Environment"]],
      "Metrics": [
        { "Name": "SSEConnectionCount", "Unit": "Count" },
        { "Name": "SSEChannelSubscriptions", "Unit": "Count" },
        { "Name": "SSEBufferBytesTotal", "Unit": "Bytes" }
      ]
    }]
  },
  "ServiceName": "workermill-api",
  "Environment": "prod",
  "SSEConnectionCount": 247,
  "SSEChannelSubscriptions": 1235,
  "SSEBufferBytesTotal": 524288
}
```

**Three metrics emitted:**
- `SSEConnectionCount` — active SSE sessions on this instance (primary scaling metric)
- `SSEChannelSubscriptions` — total Redis topic subscriptions across all sessions (capacity indicator)
- `SSEBufferBytesTotal` — aggregate write buffer across all sessions (backpressure indicator)

### Three-Layer Scaling

#### Layer 1: Target Tracking (Reactive — Primary)

Maintains a target average SSE connection count per instance. This is the steady-state scaling mechanism.

| Setting | Value | Rationale |
|---------|-------|-----------|
| Metric | `SSEConnectionCount` average per task | Custom metric via EMF |
| Target value | **300 connections/instance** | Comfortable for 512 CPU / 1024 MB. Each connection ~15KB memory (response + buffer + Redis subs). 300 × 15KB = 4.5MB — trivial. Real ceiling is event loop throughput for heartbeat pings + serialization. |
| Scale-out cooldown | 60s | New connections arrive fast during onboarding or peak hours. React quickly. |
| Scale-in cooldown | 300s | Don't scale in aggressively. Connections take time to redistribute after graceful shutdown. |
| Min capacity | 2 | Always have redundancy for rolling deploys. |
| Max capacity | 20 | Cost guardrail. 20 × 300 = 6,000 concurrent SSE connections. |

**How target tracking works:** If average connections per instance exceeds 300, Application Auto Scaling adds instances until the average drops back to target. If average drops significantly below 300, it removes instances (after cooldown), triggering graceful shutdown → reconnect → redistribution.

**Metric math for per-task average:** Application Auto Scaling supports [inline metric math](https://aws.amazon.com/blogs/containers/autoscaling-amazon-ecs-services-based-on-custom-metrics-with-application-auto-scaling/). The scaling metric is defined as:

```
SSEConnectionCount (SUM across all instances) / DesiredTaskCount
```

This gives the true average connections per instance, which is what target tracking needs.

#### Layer 2: Predictive Scaling (Proactive)

[ECS Predictive Scaling](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/predictive-auto-scaling.html) uses ML to analyze up to 14 days of historical metric data and forecast demand 48 hours ahead. It proactively scales out before load arrives — preventing the "cold start" lag of reactive target tracking.

**Rollout plan:**
1. **Week 1-2:** Collect SSEConnectionCount data (EMF publishes from day one)
2. **Week 3:** Enable predictive scaling in **Forecast Only** mode — generates forecasts without taking action. Review predicted vs. actual capacity in CloudWatch.
3. **Week 4+:** Switch to **Forecast And Scale** mode once forecasts are validated.

**Configuration:**

| Setting | Value | Rationale |
|---------|-------|-----------|
| Mode | `ForecastOnly` → `ForecastAndScale` | Validate forecasts before acting on them |
| Load metric | `SSEConnectionCount` (SUM) | Total connection load across the service |
| Scaling metric | `SSEConnectionCount` (AVG per task) | What target tracking optimizes |
| Target utilization | 300 | Same as target tracking target — keeps them aligned |
| Max capacity buffer | 10% | Pre-provision 10% above forecast as headroom |
| Scheduling function | Daily + weekly patterns | Business hours = more users = more connections |

**Why this matters:** SSE connection patterns follow daily cycles — users open dashboards during business hours and close them at night. Predictive scaling pre-provisions instances at 8 AM before the morning surge, rather than waiting for target tracking to react after connections pile up.

**Terraform note:** As of February 2026, ECS predictive scaling with custom metrics may require [AWS CLI or SDK configuration](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/predictive-scaling-create-policy.html) — the Terraform AWS provider has an [open enhancement request](https://github.com/hashicorp/terraform-provider-aws/issues/40328) for full support. Start with CLI, migrate to Terraform when provider support lands.

#### Layer 3: Step Scaling (Emergency Guardrails)

CPU and memory-based step scaling as safety nets. These should **never fire** under normal SSE operation — if they do, something unexpected is happening.

| Trigger | Threshold | Action | Direction |
|---------|-----------|--------|-----------|
| CPU > 70% sustained 3 min | Emergency — unexpected CPU spike | Add 2 instances | Scale-out only |
| Memory > 80% sustained 3 min | Emergency — buffer leak or memory issue | Add 2 instances | Scale-out only |

**Critical: CPU and memory guardrails only scale OUT, never in.** Scale-in is governed solely by the SSE connection count target tracking policy. This prevents the auto-scaler from removing instances that have low CPU but are holding hundreds of active SSE connections.

### Connection Redistribution on Scale Events

**Scale-out (new instance added):**
1. New Fargate task starts, registers with ALB target group
2. ALB routes **new** SSE connections to the least-loaded target (least outstanding requests algorithm)
3. Existing SSE connections remain on their current instances — zero disruption
4. Over time, connections naturally rebalance as users refresh pages, close/reopen browsers, or agents reconnect

**Scale-in (instance removed):**
1. Application Auto Scaling selects the instance with fewest connections (default behavior)
2. ALB deregisters the target — stops routing new connections
3. ECS sends SIGTERM to the Fargate task
4. API SIGTERM handler sends `reconnect` event to all SSE sessions on this instance
5. Clients reconnect in 1-3s → ALB routes to remaining instances
6. Backfill via `Last-Event-ID` covers any brief gap
7. Task exits after 30s deregistration delay
8. **No visible disruption to terminal sessions**

**Fargate Spot reclaim:**
- Same flow as scale-in, but with a 120-second SIGTERM warning (Fargate Spot maximum)
- SIGTERM handler fires immediately — 120s is more than enough for graceful SSE shutdown
- The existing capacity_provider_strategy (1 base FARGATE + weight 100 FARGATE_SPOT) works correctly here

### Capacity Planning

| Concurrent Tasks | SSE Conns | API Instances | Orchestrator | RDS Instance | Read Replica | Redis | Est. Total/mo |
|-----------------|-----------|--------------|-------------|-------------|-------------|-------|--------------|
| 10 | ~30 | 2 (min) | 1 × 512/1024 | t4g.small | — | t4g.micro | ~$60 |
| 50 | ~150 | 2 | 1 × 512/1024 | t4g.small | t4g.small | t4g.micro | ~$85 |
| 100 | ~300 | 2 | 1 × 512/1024 | t4g.medium | t4g.small | t4g.small | ~$115 |
| 200 | ~600 | 3 | 2 × 512/1024 | t4g.medium | t4g.medium | t4g.small | ~$175 |
| 500 | ~1,500 | 5-6 | 2 × 1024/2048 | r7g.large | t4g.medium | t4g.medium | ~$360 |
| 1,000 | ~3,000 | 10-11 | 3 × 1024/2048 | r7g.large | r7g.large | t4g.medium | ~$560 |

*Includes Fargate Spot (~$0.01/hr), RDS on-demand, ElastiCache on-demand. Multi-AZ adds ~2x RDS cost (recommended at 50+ tasks with paying customers).*

**Compare to current polling model at 100 tasks:** ~15,000 req/min → need 8-10 Fargate instances just for CPU headroom → ~$75/mo compute + bottlenecked on 112-connection db.t4g.micro. The SSE model handles the same load on 2 API instances + 1 orchestrator with headroom to grow.

### Monitoring and Alerts

| Metric | Alert Threshold | Action |
|--------|----------------|--------|
| `SSEConnectionCount` avg > 400/instance | Warning | Investigate — approaching target, auto-scaler should be adding instances |
| `SSEConnectionCount` avg > 500/instance | Critical | Auto-scaler may be failing. Check scaling policy, max capacity. |
| `SSEBufferBytesTotal` avg > 50MB/instance | Warning | Slow clients accumulating. Backpressure policy should be handling this. |
| `SSEChannelSubscriptions` > 5,000/instance | Warning | High subscription density. Check for subscription leaks (clients not unsubscribing). |
| Predictive scaling forecast vs actual divergence > 30% | Info | Re-evaluate load metric. Patterns may have shifted. |
| Step scaling (CPU/memory) fires | Critical | Something unexpected. Investigate immediately — this should never happen under normal SSE load. |
| Orchestrator heartbeat stale > 30s | Critical | Orchestrator may be down. Check ECS service, Fargate Spot reclaim. |
| Orchestrator `activeOps.size` > 8 sustained | Warning | Operations piling up. Check for stuck ECS spawns or planning tasks. |
| Orchestrator CPU > 60% sustained | Warning | Right-size up or add second instance. Event-driven mode should keep CPU < 30%. |
| Orchestrator memory > 70% sustained | Warning | Right-size up. Check cleanup operations for memory leaks. |
| `orchestrator:task-queued` publish failures | Warning | Redis may be down. Orchestrator auto-falls back to DB polling. |

---

## Orchestrator Scaling

The orchestrator is a **separate ECS service** (`orchestrator.tf`) running the same API image with `ENABLE_ORCHESTRATOR=true` and no ALB. It is currently a **singleton on 256 CPU (0.25 vCPU) / 512 MB Fargate Spot**. No inbound traffic — it talks exclusively to the database, Redis, and ECS API.

The SSE multiplexer eliminates polling on the *client* side. But the orchestrator itself still **polls the database every 5 seconds** to find queued tasks, monitor executing tasks, run planning workflows, and perform cleanup. As concurrent tasks scale, the orchestrator becomes the bottleneck — not the API.

### Current Orchestrator Workload (Per 5s Poll Cycle)

| Operation | DB Queries | Scales With |
|-----------|-----------|-------------|
| `findQueuedTasks()` — queued + org settings + active counts + deps + quota/budget | 6-15 | O(queued × orgs) |
| `claimTask()` — atomic `UPDATE...WHERE status = 'queued'` | 1 per claim | O(queued) |
| `dispatchMultiStoryPlan()` / `spawnWorker()` | 2-5 per task | O(claimed) |
| `findPlanningTasks()` + `processPlanningTask()` | 1 + 5-10 per task | O(planning) |
| `findV2PipelineTasks()` + `runSequentialPipeline()` | 1 + 3-5 per task | O(pipelines) |
| `findTasksNeedingManagerReview()` + `spawnManagerReview()` | 1 + 2-3 per task | O(review) |
| `findTasksNeedingLogAnalysis()` | 1 | Fixed |
| `findApprovedTasksNeedingDeployment()` | 1 | Fixed |
| `monitorExecutingTasks()` — ECS DescribeTasks + status checks | 2-3 + 1 per batch of 100 | O(executing) |
| `monitorManagerTasks()` | 1-2 | Fixed |
| `checkParentTaskCompletion()` — parent + children queries | 2-3 per parent | O(parents) |

**Scheduled cron jobs** (distributed-locked via Redis `SETNX`):

| Job | Frequency | DB Queries | CPU Impact |
|-----|-----------|-----------|------------|
| `cleanupStaleCoordination()` + `failHungTasks()` | ~60s | 5-10 | Low |
| `failOrphanedTasks()` — ECS DescribeTasks API calls | ~5 min | 10-20 + ECS API | Medium (network I/O) |
| `maintainAllWarmPools()` | ~30s | 5-10 | Low |
| `checkTrialReminders()` | ~1 hour | 2-5 | Negligible |
| `cleanupLoop()` — 6 parallel cleanup tasks (logs, checkpoints, referrals, stuck planning, stale agents, orphaned) | ~1 hour | 50-100 | **High (30-60s spike)** |

### DB Query Volume Projections

| Concurrent Tasks | Queries/Poll | Polls/Hour | Queries/Hour | Cron/Hour | Total/Hour |
|-----------------|-------------|-----------|-------------|-----------|-----------|
| 10 | 10-15 | 720 | 7,200-10,800 | ~50 | ~10,000 |
| 50 | 20-30 | 720 | 14,400-21,600 | ~100 | ~20,000 |
| 100 | 35-50 | 720 | 25,200-36,000 | ~200 | ~35,000 |
| 200 | 60-80 | 720 | 43,200-57,600 | ~400 | ~55,000 |

### Phase 1: Event-Driven Task Pickup (Replace Polling for Queued Tasks)

The biggest win is eliminating the `findQueuedTasks()` DB poll. This is the heaviest per-cycle query (6-15 DB queries) and runs every 5 seconds regardless of whether any tasks are actually queued.

**Mechanism:** When any API route creates or transitions a task to `queued` status, it publishes a Redis event. The orchestrator subscribes to this channel and reacts instantly instead of polling.

```
# API route (existing task creation / status change code)
await redis.publish("orchestrator:task-queued", JSON.stringify({ taskId, orgId }))

# Orchestrator (new event-driven listener)
redisSub.subscribe("orchestrator:task-queued", async (message) => {
  const { taskId } = JSON.parse(message)
  // Claim + dispatch immediately — no 5s wait
  if (await claimTask(taskId)) { await spawnWorker(task) }
})
```

**What this replaces:** The `findQueuedTasks()` call that runs 720 times/hour. At 100 concurrent tasks, this eliminates ~40% of the orchestrator's DB query volume (from ~35,000/hr to ~21,000/hr).

**What it does NOT replace:** The poll loop still runs for monitoring, cleanup, and cron jobs. But it becomes a **slow background sweep** (every 30s instead of 5s) that catches anything the event-driven path missed — a safety net, not the primary mechanism.

**Publish points** (where `orchestrator:task-queued` must be emitted):

| Location | When |
|----------|------|
| `POST /api/tasks` (task creation) | New task → `queued` |
| `POST /api/boards/:boardId/cards/:cardId/run` | Card run → task created → `queued` |
| Board execution engine (`board-execution.ts`) | Dependency cascade triggers child → `queued` |
| `POST /api/agent/plan-result` | Plan approved → children → `queued` |
| `checkAndUnblockDependentTasks()` in task-monitor.ts | Blocked → `queued` when dependency completes |
| `requeueForDeployment()` in manager-workflow.ts | Approved → `queued` for deploy |
| Manual retry / re-queue via dashboard | Failed → `queued` |

**Fallback:** The slow-poll sweep (30s) catches any missed events. If Redis is down, the orchestrator falls back to the current 5s polling — same as the SSE multiplexer's DB polling fallback.

### Phase 2: Event-Driven Task Completion (Replace monitorExecutingTasks Polling)

The second heaviest operation is `monitorExecutingTasks()`, which calls ECS `DescribeTasks` every 5 seconds for all executing tasks. At 100 executing tasks, this is 3-4 ECS API calls per cycle (batches of 100).

**Mechanism:** Workers already POST task results to the API (`POST /api/tasks/:taskId/callback`). When the callback handler updates task status, it publishes:

```
await redis.publish("orchestrator:task-completed", JSON.stringify({ taskId, status, orgId }))
```

The orchestrator subscribes and runs post-completion logic (quality gates, Jira transition, dependency unblocking) immediately instead of waiting for the next poll cycle.

**ECS monitoring as safety net:** `monitorExecutingTasks()` drops from 5s to 60s interval — catches cases where workers crash without calling back (OOM, Spot reclaim, etc.). This is already rare; making it the fallback path instead of primary reduces ECS API costs and DB queries by ~12x.

### Phase 3: Right-Size the Orchestrator

With event-driven task pickup and completion, the poll loop becomes a slow background sweep. Resource requirements drop significantly.

**Current state:**

| Resource | Current | With Event-Driven | Rationale |
|----------|---------|-------------------|-----------|
| CPU | 256 (0.25 vCPU) | 512 (0.5 vCPU) | Headroom for ECS API calls + cleanup spikes |
| Memory | 512 MB | 1024 MB | Node.js baseline ~200MB + cleanup operations |
| `DB_POOL_MAX` | 15 | 10 | Fewer concurrent queries with event-driven |
| Poll interval | 5s | 30s (background sweep) | Primary path is event-driven |
| ECS monitor interval | 5s | 60s (safety net) | Worker callbacks are primary |
| Desired count | 1 | 1 (→ 2 at 200+ tasks) | Already multi-instance ready |

**Scaling tiers:**

| Concurrent Tasks | Orchestrator Instances | CPU | Memory | Queries/Hour (event-driven) |
|-----------------|----------------------|-----|--------|----------------------------|
| 10-50 | 1 | 512 | 1024 MB | ~5,000 (mostly cron) |
| 50-200 | 1 | 512 | 1024 MB | ~8,000 |
| 200-500 | 2 | 512 | 1024 MB | ~6,000/instance |
| 500+ | 2-3 | 1024 | 2048 MB | ~8,000/instance |

At 200+ tasks, add a second orchestrator instance. The code is already multi-instance safe — all task claims use atomic `UPDATE...WHERE`, all cron jobs use Redis distributed locks (`SETNX`). The second instance provides:
- Redundancy if Fargate Spot reclaims one instance
- Halved query volume per instance
- Parallel cleanup operations

### Monitoring Metrics

| Metric | Source | Alert Threshold | Action |
|--------|--------|----------------|--------|
| `orchestrator:heartbeat` Redis key age | Redis | > 30s stale | Orchestrator may be down. Check ECS task status. |
| Poll loop duration (`state.lastPollAt` → next) | CloudWatch EMF | > 10s average (event-driven mode) | Poll is taking too long. Check DB connection pool, cleanup operations. |
| `activeOps.size` | CloudWatch EMF | > 8 sustained (of 10 max) | Operations piling up. Check for stuck ECS spawns or planning tasks. |
| DB query latency (PgBouncer `avg_query_time`) | PgBouncer stats | > 50ms average | DB under load. Check read replica, indexes, vacuum status. |
| ECS `DescribeTasks` API errors | CloudWatch | > 5/min | ECS API throttling. Increase monitor interval or add backoff. |
| `orchestrator:task-queued` Redis publish failures | App logs | Any | Redis may be down. Orchestrator falls back to polling automatically. |
| `cleanupLoop` duration | CloudWatch EMF | > 120s | Cleanup taking too long. Check S3 ListObjects pagination, orphaned task count. |
| Orchestrator CPU utilization | ECS/CloudWatch | > 60% sustained | Right-size up. Event-driven mode should keep CPU < 30%. |
| Orchestrator memory utilization | ECS/CloudWatch | > 70% sustained | Right-size up. Check for memory leaks in cleanup operations. |

### Orchestrator Scaling Roadmap

| Milestone | Instances | CPU/Memory | Poll Interval | Primary Mechanism | Queries/Hour |
|-----------|----------|------------|---------------|-------------------|-------------|
| **Phase 0** (now) | 1 | 256/512 MB | 5s DB poll | DB polling | ~10,000 |
| **Phase 1** (with SSE multiplexer) | 1 | 512/1024 MB | 30s sweep | Redis `task-queued` events | ~5,000 |
| **50+ tasks** | 1 | 512/1024 MB | 30s sweep | Event-driven + sweep | ~8,000 |
| **200+ tasks** | 2 | 512/1024 MB | 30s sweep | Event-driven + sweep | ~6,000/inst |
| **500+ tasks** | 2-3 | 1024/2048 MB | 60s sweep | Event-driven + sweep | ~8,000/inst |

---

## Design Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| **DB connection exhaustion on horizontal scale** | **Critical** | PgBouncer already in place. Fix `MAX_CLIENT_CONN` 50→100 (Phase 0). At 20 instances × 10 server conns = 200 RDS connections, well within limits. |
| Subscribe/unsubscribe hits wrong instance | Critical | Redis-mediated subscriptions — REST handler publishes control message, SSE writer reacts. No sticky sessions. |
| **Backfill reconnection storm overwhelms DB** | **High** | Staggered reconnect delay (0-3s random), backfill rate limit (50 req/s/org), route backfill to read replica. |
| Slow client causes memory leak | High | Backpressure policy — drop non-critical events at 256KB buffer, disconnect at 1MB. Client catches up via Last-Event-ID. |
| Redis single point of failure | High | Phased HA — single node at launch, Multi-AZ replica at 50+ tasks. Old SSE endpoints remain during migration as fallback. |
| **Redis pub/sub subscriber buffer overflow** | Medium | Set `client-output-buffer-limit pubsub 64mb 16mb 120`. SSE backpressure cuts off slow clients before they stress Redis. |
| **JWT expires on long-lived SSE connection** | Medium | Authenticate once on connect. 4-hour max connection lifetime with server-initiated reconnect. Immediate disconnect on user deactivation via Redis control channel. |
| ALB kills idle SSE connections | Medium | 30s heartbeat pings keep connections alive. ALB idle timeout set to 120s. |
| Client opens excessive connections | Medium | Per-org cap of 20 SSE connections. Excess rejected with 429. |
| Rolling deploy drops terminal sessions | Medium | Graceful SIGTERM → `reconnect` event → client reconnects in <3s → Last-Event-ID backfill. No visible disruption. |
| **db.t4g.micro CPU/memory ceiling** | Medium | Upgrade to db.t4g.small at Phase 1. Read replica at 50+ tasks. Instance sizing matches scaling tiers. |
| **Single-AZ database (no failover)** | Medium | Enable Multi-AZ when onboarding paying customers. Automatic failover ~60s, zero data loss. |
| Auto-scaler scales in on low CPU despite active connections | Medium | CPU/memory guardrails are scale-out only. Scale-in governed exclusively by SSE connection count target tracking. |
| Scale-in redistributes connections | Low | Same as rolling deploy — graceful shutdown signal + seamless reconnect. ECS deregistration delay set to 30s. |
| Predictive scaling forecast inaccuracy | Low | Start in Forecast Only mode for 1-2 weeks. Target tracking handles real-time load regardless. Predictive is additive optimization. |
| Fargate Spot reclaim during active sessions | Low | SIGTERM handler fires immediately. 120s Spot warning is ample time. Clients reconnect seamlessly. Existing strategy already uses Spot. |
| **Worker crash loses buffered logs** | Low | `process.on('exit')` handler is sync-only — use synchronous HTTP (e.g., `child_process.execFileSync('curl', ...)`) for final flush. Acceptable loss if flush fails — just terminal output, not state. |
| **Session hijacking via subscribe endpoint** | Medium | Session ownership check — `userId` stored on session creation, validated on every subscribe/unsubscribe. SessionId is UUID (unguessable) as additional defense. |
| **Backfill + SSE race condition (duplicate events)** | Medium | Client-side dedup: subscribe first → buffer SSE → fetch backfill → merge by cursor timestamp → switch to live. |
| **RDS resize downtime (5-10 min)** | Medium | Schedule during low-traffic window. PgBouncer auto-reconnects. SSE gap covered by Last-Event-ID backfill. Multi-AZ enables near-zero-downtime resizes. |
| **SIGTERM handler conflict** | Low | SSE shutdown integrates into existing handler (index.ts:415-442), runs before `server.close()`. 3.5s stagger + 20s ops wait fits within 25s force-exit timer. |
| **Lifetime timer leak** | Low | `clearTimeout(lifetimeTimer)` called in session destroy path. Destroy called on: client disconnect, backpressure disconnect, SIGTERM, auth revocation. |
| **Orchestrator singleton on 256 CPU / 512 MB** | **High** | Right-size to 512/1024 in Phase 1. Event-driven task pickup reduces CPU from ~16% to <5% at 100 tasks. Background sweep at 30s instead of 5s polling. |
| **Orchestrator missed Redis event (task stuck queued)** | Medium | 30s background sweep catches anything the event-driven path missed. Same safety-net pattern as SSE multiplexer's DB polling fallback. |
| **Fargate Spot reclaim on singleton orchestrator** | Medium | At 200+ tasks, scale to 2 instances. Below that, Spot reclaim causes ~60s gap (ECS restarts task). Queued tasks wait; executing tasks are unaffected (workers are independent). |
| **Duplicate task claims from Redis event + sweep race** | Low | `claimTask()` uses atomic `UPDATE...WHERE status = 'queued'`. Two instances competing never double-claim. Idempotent by design. |
| **`cleanupLoop` 30-60s CPU spike on undersized orchestrator** | Medium | Right-sizing to 512 CPU provides headroom. Cleanup runs hourly under distributed lock. At 200+ tasks, second instance may win the lock, distributing the load. |

---

## What Changes (Infrastructure)

- **RDS:** Upgrade `db.t4g.micro` → `db.t4g.small` (when traffic warrants). Add read replica (50+ tasks). Enable Multi-AZ (paying customers).
- **PgBouncer:** Fix `MAX_CLIENT_CONN` 50→100 on existing API sidecar. Add second listener on port 5433 for replica traffic (when read replica is enabled).
- **Redis:** Set `client-output-buffer-limit` for pub/sub. Upgrade to Multi-AZ replica at 50+ tasks. New channels: `orchestrator:task-queued`, `orchestrator:task-completed`.
- **ALB:** Idle timeout 120s, deregistration delay 30s.
- **ECS API service:** Auto-scaling policies (target tracking + predictive + step guardrails).
- **ECS Orchestrator service:** Right-size 256/512 → 512/1024. Event-driven task pickup via Redis. Poll interval 5s → 30s background sweep. Scale to 2 instances at 200+ tasks.

## What Does NOT Change

- Database schema (no new tables — reads are rerouted, not restructured)
- All REST write endpoints
- Auth middleware (JWT validation)
- Worker coordination SSE (already efficient, optional migration)
- Agent heartbeat (write path, stays as REST POST)
- Stateless API architecture (session state is ephemeral, per-instance, reconstructable)
- Orchestrator atomic task claiming (`UPDATE...WHERE`) — already multi-instance safe
- Orchestrator distributed cron locks (Redis `SETNX`) — already multi-instance safe

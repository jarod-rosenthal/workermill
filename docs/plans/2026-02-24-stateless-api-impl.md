# Stateless API & Connection Pool Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the WorkerMill API horizontally scalable by eliminating in-memory state, adding PgBouncer connection pooling, splitting the orchestrator into its own ECS service, and adding back-pressure/observability.

**Architecture:** Same Docker image, two ECS services (API + orchestrator) differentiated by `ENABLE_ORCHESTRATOR` env var. PgBouncer sidecars multiplex connections. Redis replaces all in-memory shared state (OAuth PKCE, EventEmitters, rate limiters, credential cache invalidation). Application-level back-pressure prevents pool exhaustion.

**Tech Stack:** TypeScript, Express, TypeORM, PostgreSQL, PgBouncer (transaction mode), Redis (ioredis), Terraform (ECS Fargate), Docker

**Design doc:** `docs/plans/2026-02-24-stateless-api-design.md`

---

## Migration Order

Each phase is independently deployable and rollback-safe:

1. **Phase 1 — Connection Pooling** (Tasks 1–3): PgBouncer support in app code + Terraform sidecar
2. **Phase 2 — Redis State Migration** (Tasks 4–10): OAuth, EventEmitters, rate limiters, credential cache
3. **Phase 3 — Back-Pressure & Observability** (Tasks 11–16): Semaphore, pool health, concurrency cap, metrics, graceful shutdown
4. **Phase 4 — Orchestrator Service Split** (Tasks 17–20): Heartbeat, status route, Terraform, ENABLE_ORCHESTRATOR toggle

---

### Task 1: Add Redis Generic Pub/Sub Methods to RedisService

The existing `RedisService` only supports coordination-specific pub/sub (`publishContext`, `subscribe`). We need generic `publish` and `subscribeToChannel` methods for EventEmitters, cache invalidation, and orchestrator heartbeat.

**Files:**
- Modify: `api/src/services/redis-client.ts:107-148`
- Test: `api/src/services/redis-client.test.ts` (create)

**Step 1: Write the failing test**

Create `api/src/services/redis-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We'll test the generic pub/sub methods via the exported redis singleton.
// For unit tests, we mock ioredis and verify publish/subscribe behavior.

describe("RedisService generic pub/sub", () => {
  it("publish() calls pub.publish with channel and JSON payload", async () => {
    // Tests that redis.publish(channel, payload) serializes and publishes
  });

  it("publish() silently no-ops when not connected", () => {
    // Tests that publish doesn't throw when redis is disconnected
  });

  it("subscribeToChannel() registers callback and returns unsubscribe fn", () => {
    // Tests that subscribe registers and unsubscribe cleans up
  });

  it("subscribeToChannel() routes messages to correct callbacks", () => {
    // Tests message routing when multiple channels are subscribed
  });

  it("get() and set() proxy to Redis GET/SET commands", async () => {
    // Tests key-value operations for OAuth state storage
  });

  it("del() proxies to Redis DEL command", async () => {
    // Tests key deletion
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run src/services/redis-client.test.ts`
Expected: FAIL (test file doesn't exist yet or tests reference unimplemented methods)

**Step 3: Implement generic pub/sub + key-value methods**

Add to `api/src/services/redis-client.ts` after the existing `subscribe()` method (line ~148):

```typescript
  /**
   * Generic publish to any channel. Fire-and-forget.
   */
  publish(channel: string, payload: Record<string, unknown>): void {
    if (!this.pub || !this._connected) return;
    this.pub.publish(channel, JSON.stringify(payload)).catch(() => {});
  }

  /**
   * Generic subscribe to any channel.
   * Returns an unsubscribe function.
   */
  subscribeToChannel(channel: string, callback: MessageCallback): () => void {
    if (!this.sub) return () => {};

    let channelListeners = this.listeners.get(channel);
    if (!channelListeners) {
      channelListeners = new Set();
      this.listeners.set(channel, channelListeners);
      this.sub.subscribe(channel).catch((err) => {
        logger.warn("Redis subscribe failed", { channel, error: err.message });
      });
    }
    channelListeners.add(callback);

    return () => {
      channelListeners!.delete(callback);
      if (channelListeners!.size === 0) {
        this.listeners.delete(channel);
        this.sub?.unsubscribe(channel).catch(() => {});
      }
    };
  }

  /**
   * GET a key. Returns null if Redis unavailable or key missing.
   */
  async get(key: string): Promise<string | null> {
    if (!this.pub || !this._connected) return null;
    try {
      return await this.pub.get(key);
    } catch {
      return null;
    }
  }

  /**
   * SET a key with optional TTL (seconds).
   */
  async set(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    if (!this.pub || !this._connected) return false;
    try {
      if (ttlSeconds) {
        await this.pub.set(key, value, "EX", ttlSeconds);
      } else {
        await this.pub.set(key, value);
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * DEL a key. Returns true if deleted, false otherwise.
   */
  async del(key: string): Promise<boolean> {
    if (!this.pub || !this._connected) return false;
    try {
      const result = await this.pub.del(key);
      return result > 0;
    } catch {
      return false;
    }
  }
```

**Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run src/services/redis-client.test.ts`
Expected: PASS

**Step 5: Type check**

Run: `cd api && npm run typecheck`
Expected: No new errors

**Step 6: Commit**

```bash
git add api/src/services/redis-client.ts api/src/services/redis-client.test.ts
git commit -m "feat: add generic pub/sub and key-value methods to RedisService"
```

---

### Task 2: Configurable Pool Size and PgBouncer Host Support

Make pool size configurable via `DB_POOL_MAX` env var and add `PGBOUNCER_HOST` support for connecting through PgBouncer sidecar. Disable prepared statements when PgBouncer is active.

**Files:**
- Modify: `api/src/db/connection.ts:265-284` (DataSource config)
- Modify: `api/src/db/connection.ts:572-574` (pool monitor hardcoded `POOL_MAX`)

**Step 1: Write the test**

This is configuration code — test by verifying typecheck passes and the pool monitor uses the dynamic value.

**Step 2: Implement pool configuration changes**

In `api/src/db/connection.ts`, replace the `extra` block (lines 279–284):

```typescript
  // PgBouncer sidecar: when PGBOUNCER_HOST is set, connect to PgBouncer
  // instead of RDS directly. PgBouncer multiplexes a smaller pool of real
  // connections, preventing pool exhaustion across multiple API instances.
  ...(process.env.PGBOUNCER_HOST
    ? {
        host: process.env.PGBOUNCER_HOST,
        port: parseInt(process.env.PGBOUNCER_PORT || "5432", 10),
        // Override DATABASE_URL host when PgBouncer is in use
        url: undefined,
      }
    : {}),
  extra: {
    max: parseInt(process.env.DB_POOL_MAX || "10", 10),
    min: 1,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
    // PgBouncer transaction pooling requires disabling prepared statements
    // because connections are recycled between transactions
    ...(process.env.PGBOUNCER_HOST ? { prepareStatements: false } : {}),
  },
```

Update the pool monitor to use dynamic pool max (line 573):

```typescript
function startPoolMonitor(): void {
  const POOL_MAX = parseInt(process.env.DB_POOL_MAX || "10", 10);
```

Update the comment block above `extra` (lines 273–278) to reflect the new configuration:

```typescript
  // Connection pool configuration.
  // DB_POOL_MAX: configurable pool size (default 10 for local dev, 20 for API, 15 for orchestrator)
  // PGBOUNCER_HOST: when set, connects to PgBouncer sidecar instead of RDS directly
  // PgBouncer multiplexes app-level pool onto fewer real RDS connections.
```

**Step 3: Type check**

Run: `cd api && npm run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add api/src/db/connection.ts
git commit -m "feat: configurable pool size (DB_POOL_MAX) and PgBouncer sidecar support"
```

---

### Task 3: PgBouncer Sidecar Terraform Configuration

Add PgBouncer as a sidecar container in the API ECS task definition. PgBouncer listens on localhost:5432, the app connects to it instead of RDS directly.

**Files:**
- Modify: `infrastructure/terraform/modules/ecs-service/main.tf:119-201` (API task definition)
- Modify: `infrastructure/terraform/modules/ecs-service/variables.tf` (new variables)

**Step 1: Add PgBouncer sidecar container to API task definition**

In `main.tf`, the `container_definitions` jsonencode block (line 129), add the PgBouncer container alongside the `api` container:

```hcl
  container_definitions = jsonencode([
    {
      name      = "api"
      image     = var.api_image_digest != "" ? "${var.ecr_api_repository_url}@${var.api_image_digest}" : "${var.ecr_api_repository_url}:latest"
      essential = true
      # ... existing config ...
      environment = concat([
        # ... existing env vars ...
        { name = "ENABLE_ORCHESTRATOR", value = "true" },  # Changed to false in Phase 4
        # New PgBouncer env vars
        { name = "PGBOUNCER_HOST", value = "127.0.0.1" },
        { name = "PGBOUNCER_PORT", value = "5432" },
        { name = "DB_POOL_MAX", value = "20" },
      ])
      dependsOn = [
        {
          containerName = "pgbouncer"
          condition     = "START"
        }
      ]
    },
    {
      name      = "pgbouncer"
      image     = "edoburu/pgbouncer:1.22.0"
      essential = true
      portMappings = []  # Only accessible via localhost (sidecar)

      environment = [
        { name = "DATABASE_URL", value = "" },  # Set via secret below
        { name = "POOL_MODE", value = "transaction" },
        { name = "DEFAULT_POOL_SIZE", value = "8" },
        { name = "MAX_CLIENT_CONN", value = "50" },
        { name = "SERVER_IDLE_TIMEOUT", value = "30" },
        { name = "SERVER_LIFETIME", value = "3600" },
        { name = "AUTH_TYPE", value = "plain" },
        { name = "LISTEN_ADDR", value = "127.0.0.1" },
        { name = "LISTEN_PORT", value = "5432" },
      ]

      secrets = [
        { name = "DATABASE_URL", valueFrom = var.database_url_secret_arn }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = var.log_group_name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "pgbouncer"
        }
      }

      # PgBouncer is lightweight — minimal resources
      cpu    = 64
      memory = 128
    }
  ])
```

**Step 2: Validate Terraform**

Run: `cd infrastructure/terraform && terraform validate`
Expected: Validation passes

**Step 3: Commit**

```bash
git add infrastructure/terraform/modules/ecs-service/main.tf infrastructure/terraform/modules/ecs-service/variables.tf
git commit -m "feat: add PgBouncer sidecar container to API ECS task definition"
```

> **Note:** Do NOT `terraform apply` yet. PgBouncer deploys alongside the app code changes from Task 2. Deploy both together with `./deploy.sh --api`.

---

### Task 4: Migrate OAuth PKCE States to Redis

Replace in-memory `microsoftOAuthStates` and `githubOAuthStates` Maps with Redis keys. TTL handles expiry automatically — no more `setInterval` cleanup.

**Files:**
- Modify: `api/src/routes/auth.ts:1500-1511` (Microsoft OAuth Map + cleanup)
- Modify: `api/src/routes/auth.ts:2026-2037` (GitHub OAuth Map + cleanup)
- Modify: `api/src/routes/auth.ts` (all `.set()` and `.get()` calls on both Maps)

**Step 1: Write the failing test**

Create `api/src/services/__tests__/oauth-state-redis.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { redis } from "../redis-client.js";

describe("OAuth state Redis storage", () => {
  it("stores and retrieves Microsoft OAuth state via Redis", async () => {
    const state = "test-state-ms";
    const payload = { codeVerifier: "verifier123", expiresAt: Date.now() + 600000 };

    await redis.set(`oauth:microsoft:${state}`, JSON.stringify(payload), 600);
    const stored = await redis.get(`oauth:microsoft:${state}`);

    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.codeVerifier).toBe("verifier123");
  });

  it("stores and retrieves GitHub OAuth state via Redis", async () => {
    const state = "test-state-gh";
    const payload = { expiresAt: Date.now() + 600000, inviteToken: "inv123" };

    await redis.set(`oauth:github:${state}`, JSON.stringify(payload), 600);
    const stored = await redis.get(`oauth:github:${state}`);

    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.inviteToken).toBe("inv123");
  });

  it("returns null for expired/missing state", async () => {
    const result = await redis.get("oauth:github:nonexistent");
    expect(result).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run src/services/__tests__/oauth-state-redis.test.ts`
Expected: FAIL (redis not connected in test env — tests against mock)

**Step 3: Implement Redis-backed OAuth state**

In `api/src/routes/auth.ts`, add redis import at the top:

```typescript
import { redis } from "../services/redis-client.js";
```

Replace the Microsoft OAuth Map and cleanup (lines 1500–1511):

```typescript
// OAuth PKCE state stored in Redis with 10-minute TTL.
// Falls back to in-memory Map for local dev without Redis.
const microsoftOAuthStatesFallback = new Map<string, { codeVerifier: string; expiresAt: number; inviteToken?: string }>();

async function setMicrosoftOAuthState(state: string, data: { codeVerifier: string; expiresAt: number; inviteToken?: string }): Promise<void> {
  const stored = await redis.set(`oauth:microsoft:${state}`, JSON.stringify(data), 600);
  if (!stored) microsoftOAuthStatesFallback.set(state, data);
}

async function getMicrosoftOAuthState(state: string): Promise<{ codeVerifier: string; expiresAt: number; inviteToken?: string } | undefined> {
  const raw = await redis.get(`oauth:microsoft:${state}`);
  if (raw) {
    await redis.del(`oauth:microsoft:${state}`); // Read-and-delete
    return JSON.parse(raw);
  }
  const fallback = microsoftOAuthStatesFallback.get(state);
  if (fallback) microsoftOAuthStatesFallback.delete(state);
  return fallback;
}
```

Replace the GitHub OAuth Map and cleanup (lines 2026–2037):

```typescript
const githubOAuthStatesFallback = new Map<string, { expiresAt: number; inviteToken?: string }>();

async function setGithubOAuthState(state: string, data: { expiresAt: number; inviteToken?: string }): Promise<void> {
  const stored = await redis.set(`oauth:github:${state}`, JSON.stringify(data), 600);
  if (!stored) githubOAuthStatesFallback.set(state, data);
}

async function getGithubOAuthState(state: string): Promise<{ expiresAt: number; inviteToken?: string } | undefined> {
  const raw = await redis.get(`oauth:github:${state}`);
  if (raw) {
    await redis.del(`oauth:github:${state}`);
    return JSON.parse(raw);
  }
  const fallback = githubOAuthStatesFallback.get(state);
  if (fallback) githubOAuthStatesFallback.delete(state);
  return fallback;
}
```

Then update all call sites:
- `microsoftOAuthStates.set(state, {...})` → `await setMicrosoftOAuthState(state, {...})`
- `microsoftOAuthStates.get(state)` → `await getMicrosoftOAuthState(state)`
- `microsoftOAuthStates.delete(state)` → remove (read-and-delete handles it)
- `githubOAuthStates.set(state, {...})` → `await setGithubOAuthState(state, {...})`
- `githubOAuthStates.get(state)` → `await getGithubOAuthState(state)`

Remove both `setInterval` cleanup blocks — Redis TTL handles expiry.

**Step 4: Type check**

Run: `cd api && npm run typecheck`
Expected: No errors

**Step 5: Commit**

```bash
git add api/src/routes/auth.ts api/src/services/__tests__/oauth-state-redis.test.ts
git commit -m "feat: migrate OAuth PKCE states from in-memory Maps to Redis with TTL"
```

---

### Task 5: Migrate Auth Rate Limiters to Redis Store

Switch `passwordResetLimiter` and `githubOnboardLimiter` from in-memory stores to the existing Redis-backed `createStore()`.

**Files:**
- Modify: `api/src/routes/auth.ts:845-849` (passwordResetLimiter)
- Modify: `api/src/routes/auth.ts:2336-2340` (githubOnboardLimiter)

**Step 1: Import createStore**

The rate-limit middleware already exports a Redis-backed store factory. Import it in auth.ts:

```typescript
import { createStore } from "../middleware/rate-limit.js";
```

Wait — `createStore` is not exported. It's a private function. We need to export it.

**Step 2: Export createStore from rate-limit.ts**

In `api/src/middleware/rate-limit.ts`, change line 22:

```typescript
export function createStore(): Partial<Pick<Options, "store">> {
```

**Step 3: Update rate limiters in auth.ts**

Replace `passwordResetLimiter` (line 845):

```typescript
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many password reset attempts. Please try again later." },
  ...createStore(),
});
```

Replace `githubOnboardLimiter` (line 2336):

```typescript
const githubOnboardLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: "Too many signup attempts" },
  ...createStore(),
});
```

**Step 4: Type check**

Run: `cd api && npm run typecheck`
Expected: No errors

**Step 5: Commit**

```bash
git add api/src/middleware/rate-limit.ts api/src/routes/auth.ts
git commit -m "feat: switch auth rate limiters to Redis-backed store"
```

---

### Task 6: Migrate CostEventEmitter to Redis Pub/Sub

Add Redis pub/sub bridging to `CostEventEmitter` so cost updates reach SSE clients on all API instances.

**Files:**
- Modify: `api/src/services/cost-events.ts:24-62`

**Step 1: Write the failing test**

Create `api/src/services/__tests__/cost-events-redis.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { costEvents } from "../cost-events.js";
import { redis } from "../redis-client.js";

describe("CostEventEmitter Redis bridging", () => {
  it("publishes to Redis on emitCostUpdate", () => {
    const publishSpy = vi.spyOn(redis, "publish");
    const event = {
      taskId: "t1",
      orgId: "org1",
      inputTokens: 100,
      outputTokens: 50,
      estimatedCostUsd: 0.01,
      timestamp: new Date().toISOString(),
    };

    costEvents.emitCostUpdate(event);

    expect(publishSpy).toHaveBeenCalledWith(
      "events:cost:org1",
      expect.objectContaining({ taskId: "t1" }),
    );
  });

  it("still delivers events locally via EventEmitter", () => {
    const callback = vi.fn();
    const unsub = costEvents.subscribeToCostUpdates("org2", callback);

    costEvents.emitCostUpdate({
      taskId: "t2",
      orgId: "org2",
      inputTokens: 200,
      outputTokens: 100,
      estimatedCostUsd: 0.02,
      timestamp: new Date().toISOString(),
    });

    expect(callback).toHaveBeenCalledTimes(1);
    unsub();
  });
});
```

**Step 2: Implement Redis bridging**

In `api/src/services/cost-events.ts`, add Redis import and bridge:

```typescript
import { EventEmitter } from "events";
import { redis } from "./redis-client.js";

// ... CostUpdateEvent interface unchanged ...

class CostEventEmitter extends EventEmitter {
  private static instance: CostEventEmitter;

  private constructor() {
    super();
    this.setMaxListeners(100);
  }

  public static getInstance(): CostEventEmitter {
    if (!CostEventEmitter.instance) {
      CostEventEmitter.instance = new CostEventEmitter();
    }
    return CostEventEmitter.instance;
  }

  /**
   * Initialize Redis subscription for cross-instance delivery.
   * Call once after Redis connects.
   */
  public initRedisSubscription(): void {
    redis.subscribeToChannel("events:cost", (msg) => {
      const orgId = msg.orgId as string;
      if (orgId) {
        // Deliver to local SSE listeners without re-publishing to Redis
        super.emit(`cost:${orgId}`, msg);
      }
    });
  }

  public emitCostUpdate(event: CostUpdateEvent): void {
    // Local delivery
    this.emit(`cost:${event.orgId}`, event);
    // Cross-instance delivery via Redis
    redis.publish("events:cost", event as unknown as Record<string, unknown>);
  }

  public subscribeToCostUpdates(
    orgId: string,
    callback: (event: CostUpdateEvent) => void
  ): () => void {
    const eventName = `cost:${orgId}`;
    this.on(eventName, callback);
    return () => {
      this.off(eventName, callback);
    };
  }
}

export const costEvents = CostEventEmitter.getInstance();
```

**Step 3: Initialize Redis subscription in startup**

In `api/src/index.ts`, after `redis.connect()` (line ~372), add:

```typescript
    if (config.redisUrl) {
      redis.connect(config.redisUrl);
      // Initialize cross-instance event bridging
      const { costEvents } = await import("./services/cost-events.js");
      costEvents.initRedisSubscription();
    }
```

**Step 4: Run test and type check**

Run: `cd api && npx vitest run src/services/__tests__/cost-events-redis.test.ts`
Run: `cd api && npm run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add api/src/services/cost-events.ts api/src/services/__tests__/cost-events-redis.test.ts api/src/index.ts
git commit -m "feat: bridge CostEventEmitter to Redis pub/sub for cross-instance delivery"
```

---

### Task 7: Migrate PlanningProgressEmitter to Redis Pub/Sub

Same pattern as Task 6, applied to planning progress events.

**Files:**
- Modify: `api/src/services/planning-progress-events.ts:24-53`

**Step 1: Implement Redis bridging**

Apply the same pattern as cost-events.ts:

```typescript
import { EventEmitter } from "events";
import { redis } from "./redis-client.js";

// ... PlanningPhase, PlanningProgressEvent types unchanged ...

class PlanningProgressEmitter extends EventEmitter {
  private static instance: PlanningProgressEmitter;

  private constructor() {
    super();
    this.setMaxListeners(100);
  }

  public static getInstance(): PlanningProgressEmitter {
    if (!PlanningProgressEmitter.instance) {
      PlanningProgressEmitter.instance = new PlanningProgressEmitter();
    }
    return PlanningProgressEmitter.instance;
  }

  public initRedisSubscription(): void {
    redis.subscribeToChannel("events:planning", (msg) => {
      const taskId = msg.taskId as string;
      if (taskId) {
        super.emit(`planning:${taskId}`, msg);
      }
    });
  }

  public emitProgress(taskId: string, event: PlanningProgressEvent): void {
    this.emit(`planning:${taskId}`, event);
    redis.publish("events:planning", { taskId, ...event } as unknown as Record<string, unknown>);
  }

  public subscribeToProgress(
    taskId: string,
    callback: (event: PlanningProgressEvent) => void,
  ): () => void {
    const eventName = `planning:${taskId}`;
    this.on(eventName, callback);
    return () => {
      this.off(eventName, callback);
    };
  }
}

export const planningProgressEmitter = PlanningProgressEmitter.getInstance();
```

**Step 2: Initialize in startup**

In `api/src/index.ts`, add after costEvents init:

```typescript
      const { planningProgressEmitter } = await import("./services/planning-progress-events.js");
      planningProgressEmitter.initRedisSubscription();
```

**Step 3: Type check**

Run: `cd api && npm run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add api/src/services/planning-progress-events.ts api/src/index.ts
git commit -m "feat: bridge PlanningProgressEmitter to Redis pub/sub"
```

---

### Task 8: Migrate CodeEventEmitter to Redis Pub/Sub

Same pattern, applied to code events. Note: payloads can be up to 100KB — Redis handles this fine.

**Files:**
- Modify: `api/src/services/code-events.ts:19-48`

**Step 1: Implement Redis bridging**

```typescript
import { EventEmitter } from "events";
import { redis } from "./redis-client.js";

// ... CodeEvent interface unchanged ...

class CodeEventEmitter extends EventEmitter {
  private static instance: CodeEventEmitter;

  private constructor() {
    super();
    this.setMaxListeners(100);
  }

  public static getInstance(): CodeEventEmitter {
    if (!CodeEventEmitter.instance) {
      CodeEventEmitter.instance = new CodeEventEmitter();
    }
    return CodeEventEmitter.instance;
  }

  public initRedisSubscription(): void {
    redis.subscribeToChannel("events:code", (msg) => {
      const taskId = msg.taskId as string;
      if (taskId) {
        super.emit(`code:${taskId}`, msg);
      }
    });
  }

  public emitCodeEvent(taskId: string, event: CodeEvent): void {
    this.emit(`code:${taskId}`, event);
    redis.publish("events:code", { taskId, ...event } as unknown as Record<string, unknown>);
  }

  public subscribeToCodeEvents(
    taskId: string,
    callback: (event: CodeEvent) => void,
  ): () => void {
    const eventName = `code:${taskId}`;
    this.on(eventName, callback);
    return () => {
      this.off(eventName, callback);
    };
  }
}

export const codeEventEmitter = CodeEventEmitter.getInstance();
```

**Step 2: Initialize in startup**

In `api/src/index.ts`, add after planningProgressEmitter init:

```typescript
      const { codeEventEmitter } = await import("./services/code-events.js");
      codeEventEmitter.initRedisSubscription();
```

**Step 3: Type check**

Run: `cd api && npm run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add api/src/services/code-events.ts api/src/index.ts
git commit -m "feat: bridge CodeEventEmitter to Redis pub/sub"
```

---

### Task 9: Credential Cache Invalidation via Redis

When org credentials are updated, broadcast the invalidation to all API instances so they clear their local cache.

**Files:**
- Modify: `api/src/services/org-credentials.ts:79-83` (invalidateOrgCredentialsCache)
- Modify: `api/src/index.ts` (subscribe on startup)

**Step 1: Add Redis broadcast to invalidation**

In `api/src/services/org-credentials.ts`, add import:

```typescript
import { redis } from "./redis-client.js";
```

Modify `invalidateOrgCredentialsCache` (line 79):

```typescript
export function invalidateOrgCredentialsCache(orgId: string): void {
  const deletedCreds = credentialsCache.delete(orgId);
  const deletedReviewer = reviewerTokenCache.delete(orgId);
  if (deletedCreds || deletedReviewer) {
    logger.info("Invalidated credentials cache for org", { orgId });
  }
  // Broadcast to other instances
  redis.publish("cache-invalidate:org-credentials", { orgId });
}
```

Add a function to subscribe to invalidation broadcasts:

```typescript
/**
 * Subscribe to credential cache invalidation from other instances.
 * Call once after Redis connects.
 */
export function initCredentialCacheSubscription(): void {
  redis.subscribeToChannel("cache-invalidate:org-credentials", (msg) => {
    const orgId = msg.orgId as string;
    if (orgId) {
      credentialsCache.delete(orgId);
      reviewerTokenCache.delete(orgId);
      logger.debug("Credential cache invalidated via Redis", { orgId });
    }
  });
}
```

**Step 2: Initialize in startup**

In `api/src/index.ts`, add after EventEmitter inits:

```typescript
      const { initCredentialCacheSubscription } = await import("./services/org-credentials.js");
      initCredentialCacheSubscription();
```

**Step 3: Type check**

Run: `cd api && npm run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add api/src/services/org-credentials.ts api/src/index.ts
git commit -m "feat: broadcast credential cache invalidation to all instances via Redis"
```

---

### Task 10: Consolidate Redis Init in Startup

The previous tasks added multiple init calls after Redis connects. Clean up into a single function.

**Files:**
- Modify: `api/src/index.ts:371-383` (Redis connect block)

**Step 1: Create initRedisSubscriptions function**

In `api/src/index.ts`, replace the scattered inits with:

```typescript
    // Connect Redis for coordination pub/sub (optional — falls back to DB polling)
    if (config.redisUrl) {
      redis.connect(config.redisUrl);

      // Initialize cross-instance event bridging
      const { costEvents } = await import("./services/cost-events.js");
      const { planningProgressEmitter } = await import("./services/planning-progress-events.js");
      const { codeEventEmitter } = await import("./services/code-events.js");
      const { initCredentialCacheSubscription } = await import("./services/org-credentials.js");

      costEvents.initRedisSubscription();
      planningProgressEmitter.initRedisSubscription();
      codeEventEmitter.initRedisSubscription();
      initCredentialCacheSubscription();

      logger.info("Redis event bridging initialized");
    } else {
      logger.info("Redis not configured — SSE will use DB polling fallback");
    }
```

**Step 2: Type check**

Run: `cd api && npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add api/src/index.ts
git commit -m "refactor: consolidate Redis subscription init into startup block"
```

---

### Task 11: Dashboard SSE Query Semaphore

Limit concurrent per-task DB queries in the dashboard SSE endpoint to prevent pool exhaustion.

**Files:**
- Modify: `api/src/routes/control-center/stream.ts:160-169` (the `Promise.all(filteredRunningTasks.map(...))` block)

**Step 1: Implement semaphore**

At the top of `stream.ts`, add a simple semaphore utility:

```typescript
/**
 * Simple concurrency limiter for DB queries.
 * Limits how many tasks are fetched in parallel to prevent pool exhaustion.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
```

Replace the `Promise.all(filteredRunningTasks.map(...))` block (line 160):

```typescript
      // Fetch Ralph progress, checkpoint data, and Epic progress
      // Limit concurrency to 3 tasks at a time to prevent pool exhaustion
      const runningTasks = await mapWithConcurrency(
        filteredRunningTasks,
        3,
        async (task) => {
          const [ralphData, checkpointData, epicProgressData] = await Promise.all([
            fetchRalphProgressForTask(task.id),
            fetchCheckpointForTask(task.id),
            fetchEpicProgressForTask(task),
          ]);
          return formatTaskData(task, ralphData, checkpointData, epicProgressData || undefined, freshOrg.maxReviewRevisions, cardContextMap.get(task.id) ?? null);
        },
      );
```

**Step 2: Type check**

Run: `cd api && npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add api/src/routes/control-center/stream.ts
git commit -m "feat: add concurrency limiter to dashboard SSE queries (max 3 parallel tasks)"
```

---

### Task 12: Pool Health Middleware

Return 503 when DB pool utilization exceeds 80%, allowing ALB to route traffic to healthier instances.

**Files:**
- Create: `api/src/middleware/pool-health.ts`
- Modify: `api/src/index.ts` (register middleware)

**Step 1: Write the failing test**

Create `api/src/middleware/pool-health.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

describe("poolHealthMiddleware", () => {
  it("passes requests through when pool is healthy", async () => {
    // Pool at 50% utilization — should pass
  });

  it("returns 503 for non-essential endpoints when pool is exhausted", async () => {
    // Pool at 90% utilization — non-essential returns 503
  });

  it("passes essential endpoints even when pool is exhausted", async () => {
    // Pool at 90% but /health, /api/agent/poll should pass
  });
});
```

**Step 2: Implement pool health middleware**

Create `api/src/middleware/pool-health.ts`:

```typescript
import { Request, Response, NextFunction } from "express";
import { AppDataSource } from "../db/connection.js";
import { logger } from "../utils/logger.js";

// Endpoints exempt from pool health gating — always processed
const EXEMPT_PATHS = [
  "/health",
  "/api/agent/poll",
  "/api/tasks/", // Worker log POST (contains task ID suffix)
  "/api/coordination/",
  "/api/status",
];

/**
 * Middleware that returns 503 when DB pool utilization exceeds threshold.
 * Essential endpoints (health checks, agent poll, worker logs) are exempt.
 * ALB sees 503s and routes traffic to healthier instances.
 */
export function poolHealthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Skip for exempt paths
  if (EXEMPT_PATHS.some((p) => req.path.startsWith(p))) {
    return next();
  }

  try {
    const pool = (AppDataSource.driver as any)?.master;
    if (!pool) return next();

    const poolMax = parseInt(process.env.DB_POOL_MAX || "10", 10);
    const total: number = pool.totalCount ?? 0;
    const idle: number = pool.idleCount ?? 0;
    const active = total - idle;
    const utilization = poolMax > 0 ? active / poolMax : 0;

    if (utilization >= 0.8) {
      logger.warn("Pool health gate: rejecting request", {
        path: req.path,
        active,
        idle,
        total,
        poolMax,
        utilizationPct: Math.round(utilization * 100),
      });
      res.setHeader("Retry-After", "1");
      res.status(503).json({
        error: "Service temporarily unavailable — high database load",
        retryAfter: 1,
      });
      return;
    }
  } catch {
    // Best-effort — never block requests due to monitoring failure
  }

  next();
}
```

**Step 3: Register in index.ts**

In `api/src/index.ts`, after the security middleware (after line 140, before routes):

```typescript
import { poolHealthMiddleware } from "./middleware/pool-health.js";

// Pool health gating — 503 when pool exhausted (before routes)
app.use(poolHealthMiddleware);
```

**Step 4: Type check and test**

Run: `cd api && npm run typecheck`
Run: `cd api && npx vitest run src/middleware/pool-health.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add api/src/middleware/pool-health.ts api/src/middleware/pool-health.test.ts api/src/index.ts
git commit -m "feat: add pool health middleware — 503 when DB pool >80% utilized"
```

---

### Task 13: Per-Org SSE Connection Limits

Prevent runaway SSE connections from monopolizing the pool.

**Files:**
- Create: `api/src/middleware/sse-limiter.ts`
- Modify: `api/src/routes/control-center/stream.ts:22` (add limiter)
- Modify: `api/src/routes/control-center/logs.ts:264` (add limiter)
- Modify: `api/src/routes/coordination.ts:75` (add limiter)

**Step 1: Create SSE connection limiter utility**

Create `api/src/middleware/sse-limiter.ts`:

```typescript
import { logger } from "../utils/logger.js";

/**
 * Per-org SSE connection limiter.
 * Tracks active connections per org and rejects new ones when limit exceeded.
 * Per-instance tracking is sufficient — ALB distributes connections across instances.
 */
const orgConnections = new Map<string, number>();

export function acquireSSESlot(orgId: string, limit: number): boolean {
  const current = orgConnections.get(orgId) || 0;
  if (current >= limit) {
    logger.warn("SSE connection limit reached", { orgId, current, limit });
    return false;
  }
  orgConnections.set(orgId, current + 1);
  return true;
}

export function releaseSSESlot(orgId: string): void {
  const current = orgConnections.get(orgId) || 0;
  if (current <= 1) {
    orgConnections.delete(orgId);
  } else {
    orgConnections.set(orgId, current - 1);
  }
}
```

**Step 2: Apply to dashboard stream**

In `api/src/routes/control-center/stream.ts`, at the start of the SSE handler (after org check, line ~30):

```typescript
import { acquireSSESlot, releaseSSESlot } from "../../middleware/sse-limiter.js";

// Inside the handler, after org check:
  if (!acquireSSESlot(org.id, 5)) {
    res.status(429).json({ error: "Too many dashboard connections" });
    return;
  }

// In the cleanup (req.on("close")):
  req.on("close", () => {
    clearInterval(interval);
    unsubscribeCost();
    releaseSSESlot(org.id);
  });
```

**Step 3: Apply to log stream**

In `api/src/routes/control-center/logs.ts`, at the SSE handler (line ~264):

```typescript
import { acquireSSESlot, releaseSSESlot } from "../../middleware/sse-limiter.js";

// After auth check:
  if (!acquireSSESlot(org.id, 10)) {
    res.status(429).json({ error: "Too many log stream connections" });
    return;
  }

// In cleanup:
  req.on("close", () => { releaseSSESlot(org.id); /* ...existing cleanup... */ });
```

**Step 4: Apply to coordination stream**

In `api/src/routes/coordination.ts`, at the SSE handler (line ~75):

```typescript
import { acquireSSESlot, releaseSSESlot } from "../middleware/sse-limiter.js";

// After auth:
  if (!acquireSSESlot(orgId, 20)) {
    res.status(429).json({ error: "Too many coordination connections" });
    return;
  }

// In cleanup:
  req.on("close", () => { releaseSSESlot(orgId); /* ...existing cleanup... */ });
```

**Step 5: Type check**

Run: `cd api && npm run typecheck`
Expected: No errors

**Step 6: Commit**

```bash
git add api/src/middleware/sse-limiter.ts api/src/routes/control-center/stream.ts api/src/routes/control-center/logs.ts api/src/routes/coordination.ts
git commit -m "feat: add per-org SSE connection limits (5/10/20 dashboard/logs/coordination)"
```

---

### Task 14: Orchestrator Fire-and-Forget Concurrency Cap

Track active fire-and-forget operations and skip spawning when too many are in flight.

**Files:**
- Modify: `api/src/services/orchestrator-utils.ts:182-187` (add active ops tracking)
- Modify: `api/src/services/orchestrator.ts:46-120` (wrap fire-and-forget calls)

**Step 1: Add tracking to orchestrator-utils.ts**

In `api/src/services/orchestrator-utils.ts`, after the `state` export (line 187):

```typescript
/** Active fire-and-forget operations for graceful shutdown + concurrency cap */
export const activeOps = new Set<Promise<unknown>>();
const MAX_ACTIVE_OPS = 10;

/**
 * Track a fire-and-forget operation.
 * Returns false if too many operations are in flight (caller should skip).
 */
export function trackOperation(op: Promise<unknown>): boolean {
  if (activeOps.size >= MAX_ACTIVE_OPS) {
    logger.warn("Orchestrator concurrency cap reached, skipping spawn", {
      activeOps: activeOps.size,
      max: MAX_ACTIVE_OPS,
    });
    return false;
  }
  activeOps.add(op);
  op.finally(() => activeOps.delete(op));
  return true;
}
```

**Step 2: Update orchestrator.ts to use trackOperation**

In `api/src/services/orchestrator.ts`, import `trackOperation`:

```typescript
import {
  logTaskEvent,
  state,
  trackOperation,
  type OrchestratorState,
} from "./orchestrator-utils.js";
```

Wrap fire-and-forget calls. For example, `spawnWorker` (line 113):

```typescript
            const op = spawnWorker(task).catch((error) => {
              logger.error("Error in spawnWorker", {
                taskId: task.id,
                error: error instanceof Error ? error.message : String(error),
              });
            });
            trackOperation(op);
```

Apply the same pattern to: `runSequentialPipeline` (lines 85, 150), `processPlanningTask` (line 129), `spawnManagerReview` (line 164), `spawnManagerLogAnalysis` (line 178), `requeueForDeployment` (line 193).

**Step 3: Type check**

Run: `cd api && npm run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add api/src/services/orchestrator-utils.ts api/src/services/orchestrator.ts
git commit -m "feat: cap orchestrator fire-and-forget concurrency at 10 active operations"
```

---

### Task 15: Enhanced Pool Metrics on /health/ready

Expose pool stats on the readiness endpoint for monitoring.

**Files:**
- Modify: `api/src/routes/health.ts:19-42`

**Step 1: Add pool stats to /health/ready**

In `api/src/routes/health.ts`, expand the ready handler:

```typescript
router.get("/ready", async (_req: Request, res: Response) => {
  try {
    await AppDataSource.query("SELECT 1");

    const redisStatus = !redis.isConfigured
      ? "not_configured"
      : redis.isConnected
        ? "connected"
        : "disconnected";

    // Pool stats for monitoring
    let pool: Record<string, number> = {};
    try {
      const pgPool = (AppDataSource.driver as any).master;
      if (pgPool) {
        const poolMax = parseInt(process.env.DB_POOL_MAX || "10", 10);
        pool = {
          total: pgPool.totalCount ?? 0,
          idle: pgPool.idleCount ?? 0,
          waiting: pgPool.waitingCount ?? 0,
          active: (pgPool.totalCount ?? 0) - (pgPool.idleCount ?? 0),
          max: poolMax,
          utilizationPct: Math.round(
            ((pgPool.totalCount ?? 0) - (pgPool.idleCount ?? 0)) / poolMax * 100,
          ),
        };
      }
    } catch {
      // Best-effort
    }

    res.json({
      status: "ready",
      database: "connected",
      redis: redisStatus,
      pool,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: "not ready",
      database: "disconnected",
    });
  }
});
```

**Step 2: Type check**

Run: `cd api && npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add api/src/routes/health.ts
git commit -m "feat: expose DB pool stats on /health/ready for monitoring"
```

---

### Task 16: Graceful Shutdown Fix

Await tracked fire-and-forget operations before closing the DB pool.

**Files:**
- Modify: `api/src/index.ts:392-408` (gracefulShutdown function)

**Step 1: Import activeOps**

```typescript
import { activeOps } from "./services/orchestrator-utils.js";
import { stopPoolMonitor } from "./db/connection.js";
```

**Step 2: Update gracefulShutdown**

Replace the gracefulShutdown function (line 392):

```typescript
    const gracefulShutdown = async (signal: string) => {
      logger.info(`${signal} received, shutting down gracefully`);
      stopOrchestrator();

      // Wait for fire-and-forget operations to complete (max 20s)
      if (activeOps.size > 0) {
        logger.info(`Waiting for ${activeOps.size} active operations to complete`);
        await Promise.race([
          Promise.allSettled([...activeOps]),
          new Promise((resolve) => setTimeout(resolve, 20_000)),
        ]);
      }

      // Stop accepting new connections and wait for in-flight requests
      server.close(async () => {
        logger.info("HTTP server closed, cleaning up resources");
        stopPoolMonitor();
        await redis.disconnect();
        await AppDataSource.destroy();
        process.exit(0);
      });

      // Force exit after 25 seconds (ECS default stopTimeout is 30s)
      setTimeout(() => {
        logger.warn("Graceful shutdown timed out, forcing exit");
        process.exit(1);
      }, 25_000).unref();
    };
```

**Step 3: Type check**

Run: `cd api && npm run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add api/src/index.ts
git commit -m "feat: graceful shutdown awaits fire-and-forget operations before pool destroy"
```

---

### Task 17: Orchestrator Heartbeat to Redis

The orchestrator writes a Redis key every poll cycle. API instances read this key to report orchestrator status without needing in-process state.

**Files:**
- Modify: `api/src/services/orchestrator.ts:46-50` (add heartbeat in poll loop)

**Step 1: Add heartbeat to poll loop**

In `api/src/services/orchestrator.ts`, import Redis:

```typescript
import { redis } from "./redis-client.js";
```

At the start of the poll loop body (line 49, after `state.lastPollAt = new Date()`):

```typescript
      state.lastPollAt = new Date();

      // Write heartbeat to Redis — API instances read this to report status
      redis.set("orchestrator:heartbeat", new Date().toISOString(), 30).catch(() => {});
      state.tasksProcessed++;
```

**Step 2: Type check**

Run: `cd api && npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add api/src/services/orchestrator.ts
git commit -m "feat: orchestrator writes heartbeat to Redis every poll cycle"
```

---

### Task 18: Status Route Reads Orchestrator Heartbeat from Redis

Replace the in-memory `isOrchestratorRunning()` check with a Redis key read, so API instances that don't run the orchestrator can still report its status.

**Files:**
- Modify: `api/src/routes/status.ts:3,73-79`

**Step 1: Replace isOrchestratorRunning with Redis read**

In `api/src/routes/status.ts`, replace the import and usage:

```typescript
import { Router, Request, Response } from "express";
import { AppDataSource } from "../db/connection.js";
import { redis } from "../services/redis-client.js";

// ... types unchanged ...

router.get("/", async (_req: Request, res: Response) => {
  // ... api health and database health unchanged ...

  // Task processing: check orchestrator heartbeat from Redis
  // Falls back to "degraded" if Redis is unavailable or heartbeat is stale
  let orchestratorRunning = false;
  try {
    const heartbeat = await redis.get("orchestrator:heartbeat");
    if (heartbeat) {
      const heartbeatAge = Date.now() - new Date(heartbeat).getTime();
      orchestratorRunning = heartbeatAge < 30_000; // Stale if >30s
    }
  } catch {
    // Redis unavailable — can't determine orchestrator status
  }

  const taskProcessingHealth: ServiceHealth = {
    name: "Task Processing",
    status: orchestratorRunning ? "operational" : "degraded",
    checkedAt: timestamp,
    message: orchestratorRunning ? "Orchestrator active" : "Maintenance mode",
  };

  // ... rest unchanged ...
});
```

Remove the `isOrchestratorRunning` import (line 3).

**Step 2: Type check**

Run: `cd api && npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add api/src/routes/status.ts
git commit -m "feat: status route reads orchestrator heartbeat from Redis instead of in-memory"
```

---

### Task 19: Orchestrator ECS Terraform Configuration

Create a new ECS service for the orchestrator — same Docker image, singleton instance, no ALB attachment.

**Files:**
- Create: `infrastructure/terraform/modules/ecs-service/orchestrator.tf`

**Step 1: Create orchestrator.tf**

```hcl
# Orchestrator Task Definition — same image, ENABLE_ORCHESTRATOR=true, no ALB
resource "aws_ecs_task_definition" "orchestrator" {
  family                   = "workermill-${var.environment}-orchestrator"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = var.ecs_execution_role_arn
  task_role_arn            = var.ecs_task_role_arn

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = var.api_image_digest != "" ? "${var.ecr_api_repository_url}@${var.api_image_digest}" : "${var.ecr_api_repository_url}:latest"
      essential = true

      # No port mappings — orchestrator receives no inbound traffic
      portMappings = []

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "ENVIRONMENT", value = var.environment },
        { name = "PORT", value = "3000" },
        { name = "AWS_REGION", value = data.aws_region.current.name },
        { name = "ENABLE_ORCHESTRATOR", value = "true" },
        { name = "ECS_CLUSTER", value = var.ecs_cluster_name },
        { name = "WORKER_TASK_DEFINITION", value = var.worker_task_definition },
        { name = "PRIVATE_SUBNETS", value = join(",", var.private_subnet_ids) },
        { name = "SECURITY_GROUPS", value = var.ecs_tasks_security_group_id },
        { name = "WORKER_LOG_GROUP", value = var.worker_log_group },
        { name = "RUNNER_TASK_DEFINITION", value = var.runner_task_definition },
        { name = "RUNNER_SECURITY_GROUP", value = var.runner_security_group },
        { name = "API_BASE_URL", value = "https://${var.domain_name}" },
        { name = "CORS_ORIGINS", value = "http://localhost:5173,https://${var.domain_name}" },
        { name = "COGNITO_USER_POOL_ID", value = var.cognito_user_pool_id },
        { name = "COGNITO_CLIENT_ID", value = var.cognito_client_id },
        { name = "COGNITO_DOMAIN", value = var.cognito_domain },
        { name = "SES_SOURCE_EMAIL", value = var.ses_source_email },
        { name = "SUPPORT_AGENT_ENABLED", value = var.support_agent_enabled },
        { name = "SENTRY_DSN", value = var.sentry_dsn },
        { name = "REDIS_URL", value = var.redis_url },
        # PgBouncer sidecar
        { name = "PGBOUNCER_HOST", value = "127.0.0.1" },
        { name = "PGBOUNCER_PORT", value = "5432" },
        { name = "DB_POOL_MAX", value = "15" },
      ]

      secrets = concat([
        { name = "DATABASE_URL", valueFrom = var.database_url_secret_arn },
        { name = "ANTHROPIC_API_KEY", valueFrom = var.anthropic_api_key_secret_arn },
        { name = "GITHUB_TOKEN", valueFrom = var.github_token_secret_arn },
        { name = "JWT_SECRET", valueFrom = var.jwt_secret_arn },
        { name = "SESSION_SECRET", valueFrom = var.session_secret_arn },
        { name = "JIRA_CREDENTIALS", valueFrom = var.jira_credentials_secret_arn },
        { name = "STRIPE_SECRET_KEY", valueFrom = var.stripe_secret_key_arn },
        { name = "STRIPE_WEBHOOK_SECRET", valueFrom = var.stripe_webhook_secret_arn },
        { name = "PLATFORM_API_KEY", valueFrom = var.platform_api_key_secret_arn }
        ],
        var.microsoft_client_id_secret_arn != "" ? [{ name = "MICROSOFT_CLIENT_ID", valueFrom = var.microsoft_client_id_secret_arn }] : [],
        var.microsoft_client_secret_secret_arn != "" ? [{ name = "MICROSOFT_CLIENT_SECRET", valueFrom = var.microsoft_client_secret_secret_arn }] : [],
        var.github_client_id_secret_arn != "" ? [{ name = "GITHUB_CLIENT_ID", valueFrom = var.github_client_id_secret_arn }] : [],
        var.github_client_secret_secret_arn != "" ? [{ name = "GITHUB_CLIENT_SECRET", valueFrom = var.github_client_secret_secret_arn }] : [],
        var.admin_phone_number_secret_arn != "" ? [{ name = "ADMIN_PHONE_NUMBER", valueFrom = var.admin_phone_number_secret_arn }] : [],
        var.admin_email_secret_arn != "" ? [{ name = "ADMIN_EMAIL", valueFrom = var.admin_email_secret_arn }] : [],
        var.github_runner_webhook_secret_arn != "" ? [{ name = "GITHUB_RUNNER_WEBHOOK_SECRET", valueFrom = var.github_runner_webhook_secret_arn }] : []
      )

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = var.log_group_name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "orchestrator"
        }
      }

      dependsOn = [
        {
          containerName = "pgbouncer"
          condition     = "START"
        }
      ]
    },
    {
      name      = "pgbouncer"
      image     = "edoburu/pgbouncer:1.22.0"
      essential = true
      portMappings = []

      environment = [
        { name = "DATABASE_URL", value = "" },
        { name = "POOL_MODE", value = "transaction" },
        { name = "DEFAULT_POOL_SIZE", value = "8" },
        { name = "MAX_CLIENT_CONN", value = "50" },
        { name = "SERVER_IDLE_TIMEOUT", value = "30" },
        { name = "SERVER_LIFETIME", value = "3600" },
        { name = "AUTH_TYPE", value = "plain" },
        { name = "LISTEN_ADDR", value = "127.0.0.1" },
        { name = "LISTEN_PORT", value = "5432" },
      ]

      secrets = [
        { name = "DATABASE_URL", valueFrom = var.database_url_secret_arn }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = var.log_group_name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "orchestrator-pgbouncer"
        }
      }

      cpu    = 64
      memory = 128
    }
  ])
}

# Orchestrator ECS Service — singleton, no ALB, Fargate Spot
resource "aws_ecs_service" "orchestrator" {
  name            = "workermill-${var.environment}-orchestrator"
  cluster         = var.ecs_cluster_id
  task_definition = aws_ecs_task_definition.orchestrator.arn
  desired_count   = 1

  enable_execute_command = true

  # Use Fargate Spot for cost optimization — orchestrator restarts are safe
  # because tasks are claimed atomically (UPDATE...WHERE status = 'queued')
  capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 100
  }

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_tasks_security_group_id]
    assign_public_ip = false
  }

  # No load_balancer block — orchestrator receives no inbound traffic

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  lifecycle {
    ignore_changes = [desired_count]
  }
}
```

**Step 2: Validate Terraform**

Run: `cd infrastructure/terraform && terraform validate`
Expected: Validation passes

**Step 3: Commit**

```bash
git add infrastructure/terraform/modules/ecs-service/orchestrator.tf
git commit -m "feat: add orchestrator ECS service — singleton, no ALB, Fargate Spot"
```

---

### Task 20: Disable Orchestrator on API Task Definition

Set `ENABLE_ORCHESTRATOR=false` on the API service so only the orchestrator service runs the poll loop.

**Files:**
- Modify: `infrastructure/terraform/modules/ecs-service/main.tf:148`

**Step 1: Update ENABLE_ORCHESTRATOR**

In `main.tf`, change line 148:

```hcl
        { name = "ENABLE_ORCHESTRATOR", value = "false" },
```

**Step 2: Validate Terraform**

Run: `cd infrastructure/terraform && terraform validate`
Expected: Validation passes

**Step 3: Commit**

```bash
git add infrastructure/terraform/modules/ecs-service/main.tf
git commit -m "feat: disable orchestrator on API instances (ENABLE_ORCHESTRATOR=false)"
```

---

## Deployment Sequence

Deploy in this exact order:

1. **Deploy app code** (Tasks 1–18): `./deploy.sh --api`
   - PgBouncer sidecar starts alongside API
   - All Redis migrations are backward-compatible
   - Orchestrator still runs on API instances (ENABLE_ORCHESTRATOR=true)

2. **Deploy orchestrator service** (Tasks 19–20): `terraform apply`
   - Creates new orchestrator ECS service
   - Sets ENABLE_ORCHESTRATOR=false on API
   - Orchestrator transitions to its own service

3. **Validate**: Check `/health/ready` for pool stats, `/api/status` for orchestrator heartbeat

4. **Scale API**: Increase `desired_count` in Terraform or via ECS auto-scaling

## Local Dev Impact

**None.** All changes are backward-compatible with local dev:
- `PGBOUNCER_HOST` not set → direct DB connection
- `DB_POOL_MAX` not set → defaults to 10
- `ENABLE_ORCHESTRATOR` not set → defaults to `true`
- Redis unavailable → falls back to in-memory (single process)
- `./bin/local-workermill start` works unchanged

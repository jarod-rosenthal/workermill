# System Design Fundamentals

Standard Operating Procedure for architectural thinking across all WorkerMill AI Workers.

## Scalability Considerations

Before implementing any feature, consider these dimensions:

### Scalability Checklist

| Dimension | Questions to Ask | Common Solutions |
|-----------|------------------|------------------|
| **Data Volume** | How much data? Growth rate? | Partitioning, archiving, compression |
| **Traffic** | Expected QPS? Peak vs average? | Horizontal scaling, load balancing |
| **Latency** | Acceptable P50/P95/P99? | Caching, CDN, read replicas |
| **Availability** | Required uptime (99.9%? 99.99%)? | Multi-AZ, redundancy, failover |
| **Consistency** | Strong or eventual? | Database choice, replication strategy |

---

## CAP Theorem

**You can only have 2 of 3: Consistency, Availability, Partition Tolerance**

Since network partitions are inevitable in distributed systems, you must choose:

| Choice | Trade-off | Use When |
|--------|-----------|----------|
| **CP** (Consistency + Partition Tolerance) | Sacrifice availability during partitions | Financial transactions, inventory counts |
| **AP** (Availability + Partition Tolerance) | Sacrifice consistency during partitions | Social feeds, user sessions, caching |

```
         Consistency
             /\
            /  \
           /    \
          / CP   \
         /________\
        /\        /\
       /  \  CA  /  \
      / AP \    /    \
     /______\  /______\
   Availability  Partition Tolerance
```

### Practical Application

```typescript
// CP System - Banking Transfer
async function transferMoney(from: string, to: string, amount: number) {
  const tx = await db.transaction();
  try {
    // Strong consistency - both must succeed or neither
    await tx.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [amount, from]);
    await tx.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [amount, to]);
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

// AP System - User Activity Feed
async function getActivityFeed(userId: string) {
  // Try cache first (available but potentially stale)
  const cached = await cache.get(`feed:${userId}`);
  if (cached) return cached;

  // Fall back to database
  const feed = await db.query('SELECT * FROM activities WHERE user_id = $1', [userId]);

  // Cache for eventual consistency
  await cache.set(`feed:${userId}`, feed, { ttl: 60 });
  return feed;
}
```

---

## Consistency Models

### Strong Consistency
Every read receives the most recent write.

```typescript
// Strong consistency via synchronous replication
async function updateUserProfile(userId: string, data: ProfileData) {
  // Write to primary
  await primaryDb.update('users', userId, data);
  // Synchronous replication to replicas (blocks until confirmed)
  await Promise.all([
    replica1.sync(userId),
    replica2.sync(userId),
  ]);
  // Now safe to return - all nodes have latest data
}
```

### Eventual Consistency
Reads may return stale data, but will eventually reflect writes.

```typescript
// Eventual consistency via async replication
async function updateUserProfile(userId: string, data: ProfileData) {
  // Write to primary
  await primaryDb.update('users', userId, data);
  // Async replication (don't wait)
  replicationQueue.publish({ type: 'USER_UPDATE', userId, data });
  // Return immediately - replicas will catch up
}
```

### Read-Your-Writes Consistency
Users see their own writes immediately.

```typescript
async function updateAndReadProfile(userId: string, data: ProfileData, sessionId: string) {
  await db.update('users', userId, data);

  // Store version token in session
  const version = await db.getVersion('users', userId);
  await session.set(sessionId, `user:${userId}:version`, version);
}

async function readProfile(userId: string, sessionId: string) {
  const requiredVersion = await session.get(sessionId, `user:${userId}:version`);

  if (requiredVersion) {
    // Read from primary to ensure we see our write
    return primaryDb.query('SELECT * FROM users WHERE id = $1', [userId]);
  }

  // No version requirement - can read from replica
  return replicaDb.query('SELECT * FROM users WHERE id = $1', [userId]);
}
```

---

## Horizontal vs Vertical Scaling

### Vertical Scaling (Scale Up)
Add more power to existing machines.

| Pros | Cons |
|------|------|
| Simple to implement | Hardware limits |
| No code changes | Single point of failure |
| Strong consistency easy | Expensive at scale |

### Horizontal Scaling (Scale Out)
Add more machines.

| Pros | Cons |
|------|------|
| Near-infinite scaling | Complexity (distributed systems) |
| Better fault tolerance | Data consistency challenges |
| Cost-effective at scale | Requires stateless design |

```typescript
// Design for horizontal scaling - stateless services

// BAD - State stored in memory
class UserService {
  private cache = new Map<string, User>(); // Lost on restart/scale

  getUser(id: string) {
    return this.cache.get(id) || this.fetchFromDb(id);
  }
}

// GOOD - Externalized state
class UserService {
  constructor(private redis: Redis, private db: Database) {}

  async getUser(id: string) {
    const cached = await this.redis.get(`user:${id}`);
    if (cached) return JSON.parse(cached);

    const user = await this.db.query('SELECT * FROM users WHERE id = $1', [id]);
    await this.redis.set(`user:${id}`, JSON.stringify(user), 'EX', 300);
    return user;
  }
}
```

---

## Caching Strategies

### Cache-Aside (Lazy Loading)

```typescript
async function getProduct(id: string): Promise<Product> {
  // 1. Check cache
  const cached = await cache.get(`product:${id}`);
  if (cached) return JSON.parse(cached);

  // 2. Cache miss - load from database
  const product = await db.products.findById(id);

  // 3. Populate cache
  await cache.set(`product:${id}`, JSON.stringify(product), 'EX', 3600);

  return product;
}

async function updateProduct(id: string, data: Partial<Product>): Promise<Product> {
  // Update database
  const product = await db.products.update(id, data);

  // Invalidate cache
  await cache.del(`product:${id}`);

  return product;
}
```

### Write-Through

```typescript
async function updateProduct(id: string, data: Partial<Product>): Promise<Product> {
  // Update database
  const product = await db.products.update(id, data);

  // Update cache synchronously
  await cache.set(`product:${id}`, JSON.stringify(product), 'EX', 3600);

  return product;
}
```

### Write-Behind (Write-Back)

```typescript
async function updateProduct(id: string, data: Partial<Product>): Promise<Product> {
  const product = { ...data, id, updatedAt: new Date() };

  // Update cache immediately
  await cache.set(`product:${id}`, JSON.stringify(product), 'EX', 3600);

  // Queue async write to database
  await writeQueue.publish({
    type: 'PRODUCT_UPDATE',
    id,
    data: product,
  });

  return product;
}
```

### Cache Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                        Client                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  L1: Browser Cache (Cache-Control headers)                   │
│  TTL: Seconds to minutes, per-user                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  L2: CDN (CloudFront, Cloudflare)                           │
│  TTL: Minutes to hours, shared across users                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  L3: Application Cache (Redis)                               │
│  TTL: Minutes to hours, computed/aggregated data            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  L4: Database Query Cache / Read Replicas                    │
│  TTL: Automatic, raw query results                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Database Scaling Patterns

### Read Replicas

```typescript
class DatabasePool {
  constructor(
    private primary: Connection,
    private replicas: Connection[]
  ) {}

  // Writes go to primary
  async write(query: string, params: any[]) {
    return this.primary.query(query, params);
  }

  // Reads distributed across replicas
  async read(query: string, params: any[]) {
    const replica = this.replicas[Math.floor(Math.random() * this.replicas.length)];
    return replica.query(query, params);
  }

  // Strong consistency reads go to primary
  async readStrong(query: string, params: any[]) {
    return this.primary.query(query, params);
  }
}
```

### Sharding

```typescript
// Hash-based sharding
function getShardKey(userId: string): number {
  const hash = crypto.createHash('md5').update(userId).digest('hex');
  return parseInt(hash.substring(0, 8), 16) % NUM_SHARDS;
}

class ShardedDatabase {
  constructor(private shards: Connection[]) {}

  async getUserData(userId: string) {
    const shardId = getShardKey(userId);
    return this.shards[shardId].query(
      'SELECT * FROM user_data WHERE user_id = $1',
      [userId]
    );
  }

  // Cross-shard queries are expensive!
  async getAllUsers() {
    const results = await Promise.all(
      this.shards.map(shard =>
        shard.query('SELECT * FROM users')
      )
    );
    return results.flat();
  }
}
```

---

## Message Queue Patterns

### Point-to-Point (Work Queue)

```typescript
// Producer
async function submitTask(task: Task) {
  await queue.send('tasks', {
    id: task.id,
    type: task.type,
    payload: task.payload,
  });
}

// Consumer (only one receives each message)
queue.consume('tasks', async (message) => {
  const task = message.body;
  await processTask(task);
  await message.ack();
});
```

### Publish-Subscribe

```typescript
// Publisher
async function publishOrderCreated(order: Order) {
  await pubsub.publish('order.created', {
    orderId: order.id,
    customerId: order.customerId,
    total: order.total,
  });
}

// Multiple subscribers receive the same message
pubsub.subscribe('order.created', async (event) => {
  await emailService.sendOrderConfirmation(event);
});

pubsub.subscribe('order.created', async (event) => {
  await inventoryService.reserveItems(event);
});

pubsub.subscribe('order.created', async (event) => {
  await analyticsService.trackOrder(event);
});
```

### Event Sourcing Pattern

```typescript
interface DomainEvent {
  aggregateId: string;
  type: string;
  payload: any;
  timestamp: Date;
  version: number;
}

class OrderAggregate {
  private events: DomainEvent[] = [];
  private state: OrderState = { items: [], status: 'draft' };

  // Commands produce events
  addItem(item: OrderItem) {
    this.apply({
      type: 'ITEM_ADDED',
      payload: item,
    });
  }

  checkout() {
    if (this.state.items.length === 0) {
      throw new Error('Cannot checkout empty order');
    }
    this.apply({
      type: 'ORDER_CHECKED_OUT',
      payload: { total: this.calculateTotal() },
    });
  }

  // Events update state
  private apply(event: Partial<DomainEvent>) {
    const fullEvent = {
      ...event,
      aggregateId: this.id,
      timestamp: new Date(),
      version: this.events.length + 1,
    } as DomainEvent;

    this.events.push(fullEvent);
    this.state = this.reduce(this.state, fullEvent);
  }

  private reduce(state: OrderState, event: DomainEvent): OrderState {
    switch (event.type) {
      case 'ITEM_ADDED':
        return { ...state, items: [...state.items, event.payload] };
      case 'ORDER_CHECKED_OUT':
        return { ...state, status: 'pending', total: event.payload.total };
      default:
        return state;
    }
  }

  // Rebuild state from events
  static fromEvents(events: DomainEvent[]): OrderAggregate {
    const order = new OrderAggregate();
    for (const event of events) {
      order.events.push(event);
      order.state = order.reduce(order.state, event);
    }
    return order;
  }
}
```

---

## Idempotency

Ensure operations can be safely retried.

```typescript
// Idempotency key pattern
async function processPayment(request: PaymentRequest) {
  const idempotencyKey = request.idempotencyKey;

  // Check if we've already processed this
  const existing = await db.payments.findByIdempotencyKey(idempotencyKey);
  if (existing) {
    return existing; // Return cached result
  }

  // Process payment
  const result = await paymentGateway.charge(request);

  // Store with idempotency key
  await db.payments.create({
    ...result,
    idempotencyKey,
  });

  return result;
}

// Database operations - use upserts
async function updateUserStats(userId: string, newStats: Stats) {
  // Instead of:
  // await db.query('INSERT INTO stats (user_id, ...) VALUES ($1, ...)', [userId, ...]);

  // Use upsert (idempotent):
  await db.query(`
    INSERT INTO stats (user_id, points, level)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id) DO UPDATE SET
      points = EXCLUDED.points,
      level = EXCLUDED.level
  `, [userId, newStats.points, newStats.level]);
}
```

---

## Load Balancing Strategies

| Strategy | Description | Use Case |
|----------|-------------|----------|
| **Round Robin** | Distribute sequentially | Equal capacity servers |
| **Weighted Round Robin** | Distribute by weight | Different capacity servers |
| **Least Connections** | Send to least busy | Variable request duration |
| **IP Hash** | Same IP to same server | Session affinity needed |
| **Random** | Random selection | Simple, stateless |

```nginx
# nginx.conf
upstream api_servers {
    # Weighted round robin
    server api1.internal:3000 weight=3;
    server api2.internal:3000 weight=2;
    server api3.internal:3000 weight=1;

    # Health checks
    check interval=5000 rise=2 fall=3 timeout=1000;
}
```

---

## Decision Framework

When designing a system, answer these questions:

1. **What are the read/write patterns?**
   - Read-heavy: Add caching, read replicas
   - Write-heavy: Consider write-behind, event sourcing

2. **What consistency level is needed?**
   - Strong: Use transactions, synchronous replication
   - Eventual: Use async replication, caching

3. **What is the scale requirement?**
   - Thousands of users: Vertical scaling may suffice
   - Millions of users: Plan for horizontal scaling

4. **What is the availability requirement?**
   - 99%: Simple deployment ok
   - 99.9%+: Need multi-AZ, failover, redundancy

5. **What happens if a component fails?**
   - Plan graceful degradation for each dependency
   - Design circuit breakers and fallbacks

## Self-Annealing Notes

*This section is updated by AI Workers with learned improvements*

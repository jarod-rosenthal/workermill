***REMOVED*** Resilience Patterns

Standard Operating Procedure for building fault-tolerant systems across all WorkerMill AI Workers.

***REMOVED******REMOVED*** Core Resilience Patterns

Production systems must handle failures gracefully. These patterns prevent cascading failures and ensure system stability.

---

***REMOVED******REMOVED*** Circuit Breaker Pattern

Prevent cascading failures by stopping calls to a failing service.

***REMOVED******REMOVED******REMOVED*** States

```
         ┌─────────────────────────────────────┐
         │                                     │
         ▼                                     │
     ┌───────┐    failure threshold    ┌──────┴────┐
     │ CLOSED│ ──────────────────────> │   OPEN    │
     └───┬───┘                         └─────┬─────┘
         │                                   │
         │  success                          │ timeout
         │                                   │
         │         ┌───────────┐             │
         │         │ HALF-OPEN │ <───────────┘
         │         └─────┬─────┘
         │               │
         │    success    │    failure
         │<──────────────┘────────────>┐
         │                             │
         └─────────────────────────────┘
```

***REMOVED******REMOVED******REMOVED*** Implementation

```typescript
interface CircuitBreakerConfig {
  failureThreshold: number;    // Failures before opening
  resetTimeout: number;        // Ms before trying half-open
  monitorWindow: number;       // Ms to track failures
  successThreshold?: number;   // Successes needed to close (half-open)
}

class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failures: number[] = [];
  private lastFailure: number = 0;
  private successCount: number = 0;

  constructor(
    private config: CircuitBreakerConfig,
    private name: string
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure > this.config.resetTimeout) {
        this.state = 'half-open';
        this.successCount = 0;
      } else {
        throw new CircuitOpenError(`Circuit ${this.name} is open`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= (this.config.successThreshold || 1)) {
        this.state = 'closed';
        this.failures = [];
      }
    }
  }

  private onFailure(): void {
    const now = Date.now();
    this.lastFailure = now;

    // Remove old failures outside monitoring window
    this.failures = this.failures.filter(
      t => now - t < this.config.monitorWindow
    );
    this.failures.push(now);

    if (this.failures.length >= this.config.failureThreshold) {
      this.state = 'open';
      logger.warn({
        circuit: this.name,
        failures: this.failures.length,
      }, 'Circuit breaker opened');
    }
  }

  getState(): string {
    return this.state;
  }
}

// Usage
const paymentCircuit = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 30000,  // 30 seconds
  monitorWindow: 60000, // 1 minute
  successThreshold: 3,
}, 'payment-service');

async function processPayment(orderId: string) {
  return paymentCircuit.execute(async () => {
    return paymentService.charge(orderId);
  });
}
```

---

***REMOVED******REMOVED*** Retry with Exponential Backoff

Handle transient failures by retrying with increasing delays.

```typescript
interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
  retryableErrors?: (error: Error) => boolean;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig
): Promise<T> {
  const {
    maxRetries,
    baseDelayMs,
    maxDelayMs,
    jitter,
    retryableErrors = () => true,
  } = config;

  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry non-retryable errors
      if (!retryableErrors(error)) {
        throw error;
      }

      // Don't delay after last attempt
      if (attempt === maxRetries) {
        break;
      }

      // Calculate delay with exponential backoff
      let delay = Math.min(
        baseDelayMs * Math.pow(2, attempt),
        maxDelayMs
      );

      // Add jitter (0-25% of delay)
      if (jitter) {
        delay = delay * (1 + Math.random() * 0.25);
      }

      logger.warn({
        attempt: attempt + 1,
        maxRetries,
        delayMs: Math.round(delay),
        error: error.message,
      }, 'Retrying after error');

      await sleep(delay);
    }
  }

  throw lastError!;
}

// Helper to identify retryable errors
function isTransientError(error: Error): boolean {
  // Network errors
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
    return true;
  }

  // HTTP 5xx errors (server errors)
  if (error instanceof HttpError && error.status >= 500) {
    return true;
  }

  // Rate limiting (429)
  if (error instanceof HttpError && error.status === 429) {
    return true;
  }

  // Database connection errors
  if (error.message?.includes('connection')) {
    return true;
  }

  return false;
}

// Usage
const result = await withRetry(
  () => externalService.fetchData(id),
  {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    jitter: true,
    retryableErrors: isTransientError,
  }
);
```

---

***REMOVED******REMOVED*** Bulkhead Pattern

Isolate failures by partitioning resources.

```typescript
class Bulkhead {
  private active: number = 0;
  private queue: Array<{
    resolve: (value: void) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(
    private maxConcurrent: number,
    private maxQueue: number,
    private name: string
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if we can execute immediately
    if (this.active < this.maxConcurrent) {
      return this.run(fn);
    }

    // Check if queue is full
    if (this.queue.length >= this.maxQueue) {
      throw new BulkheadFullError(
        `Bulkhead ${this.name} is full: ${this.active} active, ${this.queue.length} queued`
      );
    }

    // Wait for a slot
    await new Promise<void>((resolve, reject) => {
      this.queue.push({ resolve, reject });
    });

    return this.run(fn);
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    this.active++;

    try {
      return await fn();
    } finally {
      this.active--;

      // Release next queued item
      const next = this.queue.shift();
      if (next) {
        next.resolve();
      }
    }
  }

  getStats() {
    return {
      active: this.active,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      maxQueue: this.maxQueue,
    };
  }
}

// Usage - separate bulkheads for different services
const databaseBulkhead = new Bulkhead(10, 50, 'database');
const externalApiBulkhead = new Bulkhead(5, 20, 'external-api');

async function getUserWithOrders(userId: string) {
  // These execute in separate bulkheads
  const [user, orders] = await Promise.all([
    databaseBulkhead.execute(() => db.users.findById(userId)),
    externalApiBulkhead.execute(() => orderService.getOrders(userId)),
  ]);

  return { user, orders };
}
```

---

***REMOVED******REMOVED*** Timeout Pattern

Prevent operations from hanging indefinitely.

```typescript
class TimeoutError extends Error {
  constructor(message: string, public operation: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new TimeoutError(
        `Operation '${operation}' timed out after ${timeoutMs}ms`,
        operation
      ));
    }, timeoutMs);
  });

  return Promise.race([fn(), timeoutPromise]);
}

// Usage with AbortController for cancellation
async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Tiered timeouts for different operations
const TIMEOUTS = {
  database: 5000,      // 5 seconds
  externalApi: 10000,  // 10 seconds
  fileUpload: 60000,   // 1 minute
  healthCheck: 2000,   // 2 seconds
};

async function queryWithTimeout(query: string) {
  return withTimeout(
    () => db.query(query),
    TIMEOUTS.database,
    'database-query'
  );
}
```

---

***REMOVED******REMOVED*** Graceful Degradation

Provide reduced functionality when dependencies fail.

```typescript
interface FallbackConfig<T> {
  primary: () => Promise<T>;
  fallback: () => Promise<T> | T;
  shouldFallback?: (error: Error) => boolean;
}

async function withFallback<T>(config: FallbackConfig<T>): Promise<T> {
  const { primary, fallback, shouldFallback = () => true } = config;

  try {
    return await primary();
  } catch (error) {
    if (shouldFallback(error)) {
      logger.warn({ error: error.message }, 'Primary failed, using fallback');
      return fallback();
    }
    throw error;
  }
}

// Usage examples

// 1. Cache fallback
async function getUserProfile(userId: string) {
  return withFallback({
    primary: () => userService.fetchProfile(userId),
    fallback: () => cache.get(`user:${userId}`), // Stale cache is better than nothing
  });
}

// 2. Default value fallback
async function getFeatureFlags() {
  return withFallback({
    primary: () => featureFlagService.getFlags(),
    fallback: () => DEFAULT_FEATURE_FLAGS,
  });
}

// 3. Degraded functionality
async function getRecommendations(userId: string) {
  return withFallback({
    primary: () => mlService.getPersonalizedRecommendations(userId),
    fallback: () => getPopularItems(), // Generic fallback
    shouldFallback: (error) => error instanceof TimeoutError,
  });
}

// 4. Multi-tier fallback
async function getProductPrice(productId: string): Promise<number> {
  // Try real-time pricing
  try {
    return await pricingService.getRealTimePrice(productId);
  } catch (e) {
    logger.warn('Real-time pricing unavailable');
  }

  // Try cached pricing
  const cached = await cache.get(`price:${productId}`);
  if (cached) {
    return cached;
  }

  // Fall back to database
  const product = await db.products.findById(productId);
  return product.basePrice;
}
```

---

***REMOVED******REMOVED*** Health Checks

Implement comprehensive health checks for all dependencies.

```typescript
interface HealthCheck {
  name: string;
  check: () => Promise<HealthStatus>;
  critical: boolean;  // If false, system can run degraded
  timeout?: number;
}

interface HealthStatus {
  healthy: boolean;
  latencyMs?: number;
  message?: string;
  details?: Record<string, unknown>;
}

interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: Record<string, HealthStatus>;
}

class HealthChecker {
  constructor(private checks: HealthCheck[]) {}

  async check(): Promise<SystemHealth> {
    const results: Record<string, HealthStatus> = {};
    let hasCriticalFailure = false;
    let hasAnyFailure = false;

    await Promise.all(
      this.checks.map(async (check) => {
        const start = Date.now();
        try {
          const status = await withTimeout(
            check.check,
            check.timeout || 5000,
            check.name
          );
          results[check.name] = {
            ...status,
            latencyMs: Date.now() - start,
          };
          if (!status.healthy) {
            hasAnyFailure = true;
            if (check.critical) hasCriticalFailure = true;
          }
        } catch (error) {
          results[check.name] = {
            healthy: false,
            latencyMs: Date.now() - start,
            message: error.message,
          };
          hasAnyFailure = true;
          if (check.critical) hasCriticalFailure = true;
        }
      })
    );

    return {
      status: hasCriticalFailure ? 'unhealthy' :
              hasAnyFailure ? 'degraded' : 'healthy',
      timestamp: new Date().toISOString(),
      checks: results,
    };
  }
}

// Define health checks
const healthChecker = new HealthChecker([
  {
    name: 'database',
    critical: true,
    check: async () => {
      await db.query('SELECT 1');
      return { healthy: true };
    },
  },
  {
    name: 'redis',
    critical: false, // Can run without cache
    check: async () => {
      await redis.ping();
      return { healthy: true };
    },
  },
  {
    name: 'external-api',
    critical: false,
    timeout: 3000,
    check: async () => {
      const response = await fetch(`${EXTERNAL_API_URL}/health`);
      return { healthy: response.ok };
    },
  },
]);

// Health endpoint
app.get('/health', async (req, res) => {
  const health = await healthChecker.check();
  const statusCode = health.status === 'unhealthy' ? 503 : 200;
  res.status(statusCode).json(health);
});

// Liveness probe (is the process running?)
app.get('/health/live', (req, res) => {
  res.status(200).json({ status: 'alive' });
});

// Readiness probe (can it accept traffic?)
app.get('/health/ready', async (req, res) => {
  const health = await healthChecker.check();
  const ready = health.status !== 'unhealthy';
  res.status(ready ? 200 : 503).json({ ready });
});
```

---

***REMOVED******REMOVED*** Graceful Shutdown

Handle shutdown signals properly to prevent data loss.

```typescript
class GracefulShutdown {
  private shuttingDown = false;
  private cleanupTasks: Array<() => Promise<void>> = [];

  constructor(private timeout: number = 30000) {
    // Handle shutdown signals
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('SIGINT', () => this.shutdown('SIGINT'));

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.fatal({ error }, 'Uncaught exception');
      this.shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason) => {
      logger.fatal({ reason }, 'Unhandled rejection');
      this.shutdown('unhandledRejection');
    });
  }

  register(name: string, cleanup: () => Promise<void>): void {
    this.cleanupTasks.push(async () => {
      logger.info({ task: name }, 'Running cleanup task');
      try {
        await withTimeout(cleanup, 10000, `cleanup:${name}`);
        logger.info({ task: name }, 'Cleanup task completed');
      } catch (error) {
        logger.error({ task: name, error }, 'Cleanup task failed');
      }
    });
  }

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  private async shutdown(signal: string): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    logger.info({ signal }, 'Shutdown initiated');

    // Force exit after timeout
    const forceExitTimer = setTimeout(() => {
      logger.error('Forced exit after timeout');
      process.exit(1);
    }, this.timeout);

    try {
      // Run all cleanup tasks in parallel
      await Promise.all(this.cleanupTasks.map(task => task()));
      logger.info('Graceful shutdown completed');
      clearTimeout(forceExitTimer);
      process.exit(0);
    } catch (error) {
      logger.error({ error }, 'Error during shutdown');
      clearTimeout(forceExitTimer);
      process.exit(1);
    }
  }
}

// Usage
const shutdown = new GracefulShutdown(30000);

// Register cleanup tasks
shutdown.register('http-server', async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

shutdown.register('database', async () => {
  await db.destroy();
});

shutdown.register('redis', async () => {
  await redis.quit();
});

shutdown.register('message-queue', async () => {
  await messageQueue.close();
});

// Check in request handlers
app.use((req, res, next) => {
  if (shutdown.isShuttingDown()) {
    res.status(503).json({ error: 'Server is shutting down' });
    return;
  }
  next();
});
```

---

***REMOVED******REMOVED*** Pattern Combination Example

Combine patterns for robust external service calls:

```typescript
async function callExternalService(request: ServiceRequest): Promise<ServiceResponse> {
  // Layer 1: Bulkhead - limit concurrent calls
  return externalServiceBulkhead.execute(async () => {
    // Layer 2: Circuit breaker - stop if service is failing
    return externalServiceCircuit.execute(async () => {
      // Layer 3: Retry with backoff - handle transient failures
      return withRetry(
        async () => {
          // Layer 4: Timeout - don't wait forever
          return withTimeout(
            () => httpClient.post('/api/process', request),
            TIMEOUTS.externalApi,
            'external-service-call'
          );
        },
        {
          maxRetries: 3,
          baseDelayMs: 1000,
          maxDelayMs: 5000,
          jitter: true,
          retryableErrors: isTransientError,
        }
      );
    });
  });
}

// With fallback wrapper
async function processOrderSafely(order: Order): Promise<ProcessResult> {
  return withFallback({
    primary: () => callExternalService({ type: 'process_order', order }),
    fallback: () => queueForLaterProcessing(order),
    shouldFallback: (error) =>
      error instanceof CircuitOpenError ||
      error instanceof BulkheadFullError,
  });
}
```

---

***REMOVED******REMOVED*** Checklist

Before deploying to production:

- [ ] Circuit breakers on all external service calls
- [ ] Retry logic with exponential backoff for transient failures
- [ ] Timeouts on all I/O operations
- [ ] Bulkheads for resource isolation
- [ ] Health checks for all dependencies
- [ ] Graceful shutdown handling
- [ ] Fallback strategies for non-critical features
- [ ] Monitoring and alerting on resilience patterns

***REMOVED******REMOVED*** Self-Annealing Notes

*This section is updated by AI Workers with learned improvements*

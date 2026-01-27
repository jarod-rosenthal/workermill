/**
 * Request Coalescer (Singleflight Pattern)
 *
 * Industry-standard pattern for deduplicating concurrent API requests.
 * When multiple callers request the same data simultaneously, only ONE
 * network request is made and all callers share the result.
 *
 * Features:
 * - Singleflight: Concurrent identical requests share a single in-flight promise
 * - TTL Cache: Results cached for a short duration to reduce redundant calls
 * - Automatic cleanup: Expired entries and completed requests are cleaned up
 *
 * References:
 * - Go's sync/singleflight: https://pkg.go.dev/golang.org/x/sync/singleflight
 * - Facebook's DataLoader: https://github.com/graphql/dataloader
 * - Node.js promise-singleflight: https://www.npmjs.com/package/promise-singleflight
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface InFlightRequest<T> {
  promise: Promise<T>;
  startedAt: number;
}

/**
 * Request coalescer implementing the singleflight pattern with TTL caching.
 */
export class RequestCoalescer {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private inFlight: Map<string, InFlightRequest<unknown>> = new Map();
  private defaultTtlMs: number;
  private maxInflightMs: number;

  /**
   * Create a new request coalescer.
   * @param defaultTtlMs - Default cache TTL in milliseconds (default: 2000ms)
   * @param maxInflightMs - Max time to wait for an in-flight request (default: 30000ms)
   */
  constructor(defaultTtlMs: number = 2000, maxInflightMs: number = 30000) {
    this.defaultTtlMs = defaultTtlMs;
    this.maxInflightMs = maxInflightMs;
  }

  /**
   * Execute a function with request coalescing.
   *
   * If there's a cached result that hasn't expired, return it.
   * If there's an in-flight request for the same key, wait for it.
   * Otherwise, execute the function and cache the result.
   *
   * @param key - Unique key identifying the request (e.g., "getAllContexts")
   * @param fn - Async function to execute if no cached/in-flight result exists
   * @param ttlMs - Optional TTL override for this specific request
   */
  async execute<T>(
    key: string,
    fn: () => Promise<T>,
    ttlMs?: number
  ): Promise<T> {
    const now = Date.now();
    const effectiveTtl = ttlMs ?? this.defaultTtlMs;

    // 1. Check cache first
    const cached = this.cache.get(key) as CacheEntry<T> | undefined;
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    // 2. Check if there's an in-flight request we can piggyback on
    const existing = this.inFlight.get(key) as InFlightRequest<T> | undefined;
    if (existing) {
      // Don't wait forever for stale in-flight requests
      if (now - existing.startedAt < this.maxInflightMs) {
        return existing.promise;
      }
      // Request is too old, clean it up and make a new one
      this.inFlight.delete(key);
    }

    // 3. No cache hit, no usable in-flight request - make a new one
    const promise = this.executeAndCache(key, fn, effectiveTtl);

    // Store as in-flight
    this.inFlight.set(key, {
      promise: promise as Promise<unknown>,
      startedAt: now,
    });

    try {
      return await promise;
    } finally {
      // Clean up in-flight entry (but cache remains)
      this.inFlight.delete(key);
    }
  }

  /**
   * Execute the function and cache the result.
   */
  private async executeAndCache<T>(
    key: string,
    fn: () => Promise<T>,
    ttlMs: number
  ): Promise<T> {
    const result = await fn();

    // Cache the result
    this.cache.set(key, {
      value: result,
      expiresAt: Date.now() + ttlMs,
    });

    return result;
  }

  /**
   * Invalidate a specific cache entry.
   * Call this after mutations (POST/PUT/DELETE) that affect the cached data.
   */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Invalidate all cache entries matching a prefix.
   * Useful for invalidating related caches (e.g., all "context:" prefixed entries).
   */
  invalidatePrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Invalidate all cache entries.
   * Call this at the start of each coordination loop iteration if desired.
   */
  invalidateAll(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics for debugging.
   */
  getStats(): {
    cacheSize: number;
    inFlightCount: number;
    entries: Array<{ key: string; expiresIn: number }>;
  } {
    const now = Date.now();
    const entries = Array.from(this.cache.entries()).map(([key, entry]) => ({
      key,
      expiresIn: Math.max(0, entry.expiresAt - now),
    }));

    return {
      cacheSize: this.cache.size,
      inFlightCount: this.inFlight.size,
      entries,
    };
  }

  /**
   * Clean up expired cache entries.
   * Call periodically to prevent memory leaks in long-running processes.
   */
  cleanup(): void {
    const now = Date.now();

    // Clean expired cache entries
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }

    // Clean stale in-flight requests (shouldn't happen normally)
    for (const [key, request] of this.inFlight.entries()) {
      if (now - request.startedAt > this.maxInflightMs) {
        this.inFlight.delete(key);
      }
    }
  }
}

/**
 * Create a singleton coalescer for the coordination client.
 * Using a factory function allows proper scoping per worker instance.
 */
export function createCoordinationCoalescer(): RequestCoalescer {
  // 2 second TTL is optimal for coordination loops that poll every 5 seconds
  // This ensures data is fresh within a single loop iteration while preventing
  // redundant calls within that iteration
  return new RequestCoalescer(2000, 30000);
}

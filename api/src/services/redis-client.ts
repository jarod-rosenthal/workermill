/**
 * Redis Client for Coordination Pub/Sub
 *
 * Provides publish/subscribe for real-time coordination events.
 * DB stays source of truth — Redis is a notification layer.
 * If Redis is down, callers fall back to DB polling (fire-and-forget publishes).
 *
 * Uses two connections: one for publishing, one for subscribing
 * (Redis requires separate connections for sub mode).
 */

import Redis from "ioredis";
import { logger } from "../utils/logger.js";

type MessageCallback = (msg: Record<string, unknown>) => void;

class RedisService {
  private pub: Redis | null = null;
  private sub: Redis | null = null;
  private _connected = false;
  private _configured = false;
  private listeners = new Map<string, Set<MessageCallback>>();

  /**
   * Connect to Redis. Call once on startup.
   * Handles reconnection automatically via ioredis defaults.
   */
  connect(url: string): void {
    this._configured = true;
    const opts = {
      maxRetriesPerRequest: null as unknown as undefined, // Disable per-command retry (pub/sub doesn't use it)
      retryStrategy(times: number) {
        if (times > 20) {
          // Stop reconnecting after ~10 minutes of failures
          return null;
        }
        // Exponential backoff: 500ms, 1s, 2s, 4s, ... capped at 30s
        return Math.min(times * 500, 30000);
      },
      // Don't queue commands while disconnected — callers fall back to DB
      enableOfflineQueue: false,
    };

    this.pub = new Redis(url, { ...opts, lazyConnect: true });
    this.sub = new Redis(url, { ...opts, lazyConnect: true });

    // Publisher connection events
    this.pub.on("connect", () => {
      this._connected = true;
      logger.info("Redis publisher connected");
    });
    this.pub.on("error", (err) => {
      logger.warn("Redis publisher error", { error: err.message });
    });
    this.pub.on("close", () => {
      this._connected = false;
      logger.info("Redis publisher disconnected");
    });

    // Subscriber connection events
    this.sub.on("connect", () => {
      logger.info("Redis subscriber connected");
    });
    this.sub.on("error", (err) => {
      logger.warn("Redis subscriber error", { error: err.message });
    });

    // Route incoming messages to registered callbacks
    this.sub.on("message", (channel: string, message: string) => {
      const callbacks = this.listeners.get(channel);
      if (!callbacks || callbacks.size === 0) return;

      try {
        const parsed = JSON.parse(message) as Record<string, unknown>;
        for (const cb of callbacks) {
          try {
            cb(parsed);
          } catch (cbErr) {
            logger.error("Redis message callback error", {
              channel,
              error: cbErr instanceof Error ? cbErr.message : String(cbErr),
            });
          }
        }
      } catch {
        logger.warn("Redis message parse error", { channel });
      }
    });

    // Connect both clients
    this.pub.connect().catch((err) => {
      logger.warn("Redis publisher initial connect failed (will retry)", {
        error: err.message,
      });
    });
    this.sub.connect().catch((err) => {
      logger.warn("Redis subscriber initial connect failed (will retry)", {
        error: err.message,
      });
    });
  }

  /**
   * Publish a coordination event. Fire-and-forget — never blocks the caller.
   * If Redis is down, the publish silently fails. DB is the source of truth.
   */
  publishContext(parentTaskId: string, context: Record<string, unknown>): void {
    if (!this.pub || !this._connected) return;

    const channel = `coordination:${parentTaskId}`;
    this.pub.publish(channel, JSON.stringify(context)).catch(() => {
      // Intentionally swallowed — DB write already committed
    });
  }

  /**
   * Subscribe to coordination events for a task.
   * Returns an unsubscribe function for cleanup.
   */
  subscribe(parentTaskId: string, callback: MessageCallback): () => void {
    if (!this.sub) return () => {};

    const channel = `coordination:${parentTaskId}`;

    // Track the callback
    let channelListeners = this.listeners.get(channel);
    if (!channelListeners) {
      channelListeners = new Set();
      this.listeners.set(channel, channelListeners);
      // First listener for this channel — subscribe at Redis level
      this.sub.subscribe(channel).catch((err) => {
        logger.warn("Redis subscribe failed", {
          channel,
          error: err.message,
        });
      });
    }
    channelListeners.add(callback);

    // Return unsubscribe function
    return () => {
      channelListeners!.delete(callback);
      if (channelListeners!.size === 0) {
        this.listeners.delete(channel);
        this.sub?.unsubscribe(channel).catch(() => {});
      }
    };
  }

  // ── Generic pub/sub (any channel) ─────────────────────────────────────

  /**
   * Publish a message to any channel. Fire-and-forget — never blocks the caller.
   * If Redis is down, the publish silently fails.
   */
  publish(channel: string, payload: Record<string, unknown>): void {
    if (!this.pub || !this._connected) return;

    this.pub.publish(channel, JSON.stringify(payload)).catch(() => {
      // Intentionally swallowed — callers handle Redis-down case
    });
  }

  /**
   * Subscribe to messages on any channel.
   * Returns an unsubscribe function for cleanup.
   */
  subscribeToChannel(
    channel: string,
    callback: MessageCallback,
  ): () => void {
    if (!this.sub) return () => {};

    // Track the callback
    let channelListeners = this.listeners.get(channel);
    if (!channelListeners) {
      channelListeners = new Set();
      this.listeners.set(channel, channelListeners);
      // First listener for this channel — subscribe at Redis level
      this.sub.subscribe(channel).catch((err) => {
        logger.warn("Redis subscribe failed", {
          channel,
          error: err.message,
        });
      });
    }
    channelListeners.add(callback);

    // Return unsubscribe function
    return () => {
      channelListeners!.delete(callback);
      if (channelListeners!.size === 0) {
        this.listeners.delete(channel);
        this.sub?.unsubscribe(channel).catch(() => {});
      }
    };
  }

  // ── Key-value operations ─────────────────────────────────────────────

  /**
   * GET a key from Redis. Returns null if Redis is unavailable or key doesn't exist.
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
   * SET a key in Redis with optional TTL. Returns false if Redis is unavailable.
   */
  async set(
    key: string,
    value: string,
    ttlSeconds?: number,
  ): Promise<boolean> {
    if (!this.pub || !this._connected) return false;

    try {
      if (ttlSeconds !== undefined) {
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
   * DEL a key from Redis. Returns false if Redis is unavailable.
   */
  async del(key: string): Promise<boolean> {
    if (!this.pub || !this._connected) return false;

    try {
      await this.pub.del(key);
      return true;
    } catch {
      return false;
    }
  }

  get isConnected(): boolean {
    return this._connected;
  }

  get isConfigured(): boolean {
    return this._configured;
  }

  /**
   * Active health check — sends PING to Redis and returns latency in ms.
   * Returns null if not configured or not connected.
   */
  async ping(): Promise<number | null> {
    if (!this.pub || !this._connected) return null;
    const start = Date.now();
    await this.pub.ping();
    return Date.now() - start;
  }

  /**
   * Gracefully disconnect both clients.
   */
  async disconnect(): Promise<void> {
    if (!this.pub && !this.sub) return; // Never connected
    this._connected = false;
    this.listeners.clear();
    await Promise.allSettled([
      this.pub?.quit(),
      this.sub?.quit(),
    ]);
    this.pub = null;
    this.sub = null;
    logger.info("Redis disconnected");
  }
}

export const redis = new RedisService();

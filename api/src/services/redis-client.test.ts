/**
 * RedisService Unit Tests
 *
 * Tests the generic pub/sub and key-value methods added to RedisService.
 * Since Redis won't be running in test, we verify:
 * 1. Disconnected fallback behavior (methods return null/false when not connected)
 * 2. Method signatures are correct
 * 3. Existing methods (publishContext, subscribe) remain unchanged
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock ioredis before importing the service
vi.mock("ioredis", () => {
  return {
    default: vi.fn(),
  };
});

vi.mock("../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import the singleton — it will NOT have called connect(), so pub/sub are null
import { redis } from "./redis-client.js";

describe("RedisService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Connection state ──────────────────────────────────────────────

  describe("initial state (not connected)", () => {
    it("isConnected returns false", () => {
      expect(redis.isConnected).toBe(false);
    });

    it("isConfigured returns false", () => {
      expect(redis.isConfigured).toBe(false);
    });
  });

  // ── Generic publish ───────────────────────────────────────────────

  describe("publish", () => {
    it("is a function with correct arity", () => {
      expect(typeof redis.publish).toBe("function");
      expect(redis.publish.length).toBe(2);
    });

    it("silently no-ops when disconnected", () => {
      // Should not throw
      const result = redis.publish("test-channel", { foo: "bar" });
      expect(result).toBeUndefined();
    });
  });

  // ── Generic subscribeToChannel ────────────────────────────────────

  describe("subscribeToChannel", () => {
    it("is a function with correct arity", () => {
      expect(typeof redis.subscribeToChannel).toBe("function");
      expect(redis.subscribeToChannel.length).toBe(2);
    });

    it("returns a no-op unsubscribe function when disconnected", () => {
      const callback = vi.fn();
      const unsub = redis.subscribeToChannel("test-channel", callback);
      expect(typeof unsub).toBe("function");
      // Calling unsub should not throw
      unsub();
    });

    it("callback is never invoked when disconnected", () => {
      const callback = vi.fn();
      redis.subscribeToChannel("test-channel", callback);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  // ── Key-value: get ────────────────────────────────────────────────

  describe("get", () => {
    it("is an async function with correct arity", () => {
      expect(typeof redis.get).toBe("function");
      expect(redis.get.length).toBe(1);
    });

    it("returns null when disconnected", async () => {
      const result = await redis.get("some-key");
      expect(result).toBeNull();
    });

    it("returns a promise", () => {
      const result = redis.get("some-key");
      expect(result).toBeInstanceOf(Promise);
    });
  });

  // ── Key-value: set ────────────────────────────────────────────────

  describe("set", () => {
    it("is an async function", () => {
      expect(typeof redis.set).toBe("function");
    });

    it("returns false when disconnected (no TTL)", async () => {
      const result = await redis.set("some-key", "some-value");
      expect(result).toBe(false);
    });

    it("returns false when disconnected (with TTL)", async () => {
      const result = await redis.set("some-key", "some-value", 60);
      expect(result).toBe(false);
    });

    it("returns a promise", () => {
      const result = redis.set("key", "val");
      expect(result).toBeInstanceOf(Promise);
    });
  });

  // ── Key-value: del ────────────────────────────────────────────────

  describe("del", () => {
    it("is an async function with correct arity", () => {
      expect(typeof redis.del).toBe("function");
      expect(redis.del.length).toBe(1);
    });

    it("returns false when disconnected", async () => {
      const result = await redis.del("some-key");
      expect(result).toBe(false);
    });

    it("returns a promise", () => {
      const result = redis.del("some-key");
      expect(result).toBeInstanceOf(Promise);
    });
  });

  // ── Existing methods preserved (backward compat) ──────────────────

  describe("publishContext (existing, unchanged)", () => {
    it("is a function with correct arity", () => {
      expect(typeof redis.publishContext).toBe("function");
      expect(redis.publishContext.length).toBe(2);
    });

    it("silently no-ops when disconnected", () => {
      const result = redis.publishContext("task-123", { type: "update" });
      expect(result).toBeUndefined();
    });
  });

  describe("subscribe (existing, unchanged)", () => {
    it("is a function with correct arity", () => {
      expect(typeof redis.subscribe).toBe("function");
      expect(redis.subscribe.length).toBe(2);
    });

    it("returns a no-op unsubscribe function when disconnected", () => {
      const callback = vi.fn();
      const unsub = redis.subscribe("task-123", callback);
      expect(typeof unsub).toBe("function");
      unsub();
    });
  });

  describe("disconnect", () => {
    it("is a function", () => {
      expect(typeof redis.disconnect).toBe("function");
    });

    it("resolves cleanly when never connected", async () => {
      // Should not throw — early return when pub/sub are null
      await expect(redis.disconnect()).resolves.toBeUndefined();
    });
  });
});

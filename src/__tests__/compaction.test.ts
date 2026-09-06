import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the "ai" module so generateText doesn't make real API calls
vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

import {
  getContextLimit,
  shouldCompact,
  compactMessages,
  microCompact,
  extractMemoriesBeforeCompact,
  resetCompactionState,
  estimateContextTokens,
} from "../compaction.js";
import { generateText } from "ai";

const mockGenerateText = vi.mocked(generateText);

describe("compaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getContextLimit()", () => {
    it("returns 1M for claude opus 4.6 and sonnet 4.6", () => {
      expect(getContextLimit("claude-opus-4-6")).toBe(1000000);
      expect(getContextLimit("claude-sonnet-4-6")).toBe(1000000);
    });

    it("returns 200K for legacy claude and haiku", () => {
      expect(getContextLimit("claude-haiku-4-5")).toBe(200000);
      expect(getContextLimit("claude-opus-4-5")).toBe(200000);
      expect(getContextLimit("claude-sonnet-4-5")).toBe(200000);
    });

    it("returns 1.05M for gpt-5.4 and gpt-5.4-pro", () => {
      expect(getContextLimit("gpt-5.4")).toBe(1050000);
      expect(getContextLimit("gpt-5.4-pro")).toBe(1050000);
    });

    it("returns 400K for other gpt-5.x models", () => {
      expect(getContextLimit("gpt-5.4-mini")).toBe(400000);
      expect(getContextLimit("gpt-5.4-nano")).toBe(400000);
      expect(getContextLimit("gpt-5.3-codex")).toBe(400000);
      expect(getContextLimit("gpt-5.2")).toBe(400000);
      expect(getContextLimit("gpt-5.1-codex")).toBe(400000);
      expect(getContextLimit("gpt-5")).toBe(400000);
      expect(getContextLimit("gpt-5-mini")).toBe(400000);
    });

    it("returns 1M+ for gemini models", () => {
      expect(getContextLimit("gemini-3.1-pro")).toBe(1048576);
      expect(getContextLimit("gemini-3.1-flash-lite")).toBe(1048576);
      expect(getContextLimit("gemini-2.5-pro")).toBe(1048576);
    });

    it("returns default 65536 for unknown models", () => {
      expect(getContextLimit("some-unknown-model")).toBe(65536);
    });
  });

  describe("shouldCompact()", () => {
    it("returns 'none' when tokens are below 50% of limit", () => {
      // claude-haiku-4-5 = 200K, 200000 * 0.49 = 98000
      expect(shouldCompact(98000, "claude-haiku-4-5").level).toBe("none");
    });

    it("returns 'micro' when tokens are between 50% and 70%", () => {
      // 200000 * 0.55 = 110000
      const result = shouldCompact(110000, "claude-haiku-4-5");
      expect(result.level).toBe("micro");
      expect(result.limit).toBe(200000);
      expect(result.usage).toBe(110000);
    });

    it("returns 'soft' when tokens are between 70% and 90%", () => {
      // 200000 * 0.75 = 150000
      expect(shouldCompact(150000, "claude-haiku-4-5").level).toBe("soft");
    });

    it("returns 'hard' when tokens are at or above 90%", () => {
      // 200000 * 0.90 = 180000
      expect(shouldCompact(180000, "claude-haiku-4-5").level).toBe("hard");
    });

    it("returns 'hard' when tokens exceed the limit", () => {
      expect(shouldCompact(250000, "claude-haiku-4-5").level).toBe("hard");
    });

    it("uses configuredContextLength when provided", () => {
      // Custom limit of 10000
      expect(shouldCompact(4000, "anything", 10000).level).toBe("none");
      expect(shouldCompact(5500, "anything", 10000).level).toBe("micro");
      expect(shouldCompact(7500, "anything", 10000).level).toBe("soft");
      expect(shouldCompact(9100, "anything", 10000).level).toBe("hard");
    });

    it("returns 'none' for zero tokens", () => {
      expect(shouldCompact(0, "claude-haiku-4-5").level).toBe("none");
    });

    it("includes limit and usage in result", () => {
      const result = shouldCompact(150000, "claude-haiku-4-5");
      expect(result.limit).toBe(200000);
      expect(result.usage).toBe(150000);
    });
  });

  describe("compactMessages()", () => {
    const fakeModel = {} as any;

    it("does not call the provider after cancellation", async () => {
      const controller = new AbortController();
      controller.abort(new Error("cancelled"));
      await expect(compactMessages(fakeModel, [], "soft", undefined, controller.signal)).rejects.toThrow("cancelled");
      expect(mockGenerateText).not.toHaveBeenCalled();
    });

    it("rejects late summaries without tripping the failure circuit", async () => {
      resetCompactionState();
      const messages = Array.from({ length: 6 }, (_, index) => ({ role: "user" as const, content: `message ${index}` }));
      for (let attempt = 0; attempt < 4; attempt++) {
        const controller = new AbortController();
        mockGenerateText.mockImplementationOnce(async (options) => {
          expect(options.abortSignal).toBe(controller.signal);
          controller.abort(new Error("cancelled"));
          return { text: "late summary" } as Awaited<ReturnType<typeof generateText>>;
        });
        await expect(compactMessages(fakeModel, messages, "soft", undefined, controller.signal)).rejects.toThrow("cancelled");
      }
      expect(mockGenerateText).toHaveBeenCalledTimes(4);
      expect(messages[0].content).toBe("message 0");
      resetCompactionState();
    });

    it("returns messages unchanged when 4 or fewer", async () => {
      const msgs = [
        { role: "user" as const, content: "hello" },
        { role: "assistant" as const, content: "hi" },
        { role: "user" as const, content: "how are you" },
        { role: "assistant" as const, content: "good" },
      ];
      const result = await compactMessages(fakeModel, msgs, "soft");
      expect(result).toBe(msgs); // Same reference — no compaction
    });

    it("returns messages unchanged when empty", async () => {
      const result = await compactMessages(fakeModel, [], "soft");
      expect(result).toEqual([]);
    });

    it("returns messages unchanged for single message", async () => {
      const msgs = [{ role: "user" as const, content: "hello" }];
      const result = await compactMessages(fakeModel, msgs, "soft");
      expect(result).toBe(msgs);
    });

    it("compacts older messages in soft mode (keeps last 4)", async () => {
      mockGenerateText.mockResolvedValue({ text: "Summary of earlier discussion." } as any);

      const msgs = [
        { role: "user" as const, content: "message 1" },
        { role: "assistant" as const, content: "response 1" },
        { role: "user" as const, content: "message 2" },
        { role: "assistant" as const, content: "response 2" },
        { role: "user" as const, content: "message 3" },
        { role: "assistant" as const, content: "response 3" },
      ];

      const result = await compactMessages(fakeModel, msgs, "soft");

      // Should have: 2 summary messages + 4 kept messages = 6
      expect(result.length).toBe(6);
      expect(result[0].role).toBe("user");
      expect(result[0].content).toContain("summarized from earlier");
      expect(result[1].role).toBe("assistant");
      expect(result[1].content).toContain("Summary of earlier discussion.");
      // Last 4 preserved
      expect(result[2].content).toBe("message 2");
      expect(result[5].content).toBe("response 3");
    });

    it("compacts more aggressively in hard mode (keeps last 2)", async () => {
      mockGenerateText.mockResolvedValue({ text: "Hard compacted summary." } as any);

      const msgs = [
        { role: "user" as const, content: "old 1" },
        { role: "assistant" as const, content: "old 2" },
        { role: "user" as const, content: "old 3" },
        { role: "assistant" as const, content: "old 4" },
        { role: "user" as const, content: "recent" },
        { role: "assistant" as const, content: "recent reply" },
      ];

      const result = await compactMessages(fakeModel, msgs, "hard");

      // 2 summary + 2 kept = 4
      expect(result.length).toBe(4);
      expect(result[0].content).toContain("summarized from earlier");
      expect(result[1].content).toContain("Hard compacted summary.");
      expect(result[2].content).toBe("recent");
      expect(result[3].content).toBe("recent reply");
    });

    it("falls back to keeping only recent messages when summarization fails", async () => {
      mockGenerateText.mockRejectedValue(new Error("API error"));

      const msgs = [
        { role: "user" as const, content: "old 1" },
        { role: "assistant" as const, content: "old 2" },
        { role: "user" as const, content: "old 3" },
        { role: "assistant" as const, content: "old 4" },
        { role: "user" as const, content: "recent" },
        { role: "assistant" as const, content: "recent reply" },
      ];

      const result = await compactMessages(fakeModel, msgs, "soft");

      // On failure, returns only the kept messages (last 4 for soft)
      expect(result.length).toBe(4);
      expect(result[0].content).toBe("old 3");
    });

    it("calls generateText with the model and a system prompt", async () => {
      mockGenerateText.mockResolvedValue({ text: "summary" } as any);

      const msgs = [
        { role: "user" as const, content: "a" },
        { role: "assistant" as const, content: "b" },
        { role: "user" as const, content: "c" },
        { role: "assistant" as const, content: "d" },
        { role: "user" as const, content: "e" },
        { role: "assistant" as const, content: "f" },
      ];

      await compactMessages(fakeModel, msgs, "soft");

      expect(mockGenerateText).toHaveBeenCalledOnce();
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: fakeModel,
          system: expect.stringContaining("Summarize"),
          prompt: expect.stringContaining("USER: a"),
        }),
      );
    });

    it("circuit breaker: returns toKeep after MAX_CONSECUTIVE_FAILURES", async () => {
      resetCompactionState();
      mockGenerateText.mockRejectedValue(new Error("fail"));

      const msgs = [
        { role: "user" as const, content: "a" },
        { role: "assistant" as const, content: "b" },
        { role: "user" as const, content: "c" },
        { role: "assistant" as const, content: "d" },
        { role: "user" as const, content: "e" },
        { role: "assistant" as const, content: "f" },
      ];

      // Fail 3 times to trip the circuit breaker
      await compactMessages(fakeModel, msgs, "soft");
      await compactMessages(fakeModel, msgs, "soft");
      await compactMessages(fakeModel, msgs, "soft");

      // 4th call should skip the API call entirely
      mockGenerateText.mockClear();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await compactMessages(fakeModel, msgs, "soft");
      warnSpy.mockRestore();

      expect(mockGenerateText).not.toHaveBeenCalled();
      // Returns only kept messages (last 4 for soft)
      expect(result.length).toBe(4);

      resetCompactionState();
    });

    it("circuit breaker resets on success", async () => {
      resetCompactionState();
      mockGenerateText.mockRejectedValueOnce(new Error("fail"));
      mockGenerateText.mockRejectedValueOnce(new Error("fail"));
      mockGenerateText.mockResolvedValueOnce({ text: "recovered" } as any);

      const msgs = [
        { role: "user" as const, content: "a" },
        { role: "assistant" as const, content: "b" },
        { role: "user" as const, content: "c" },
        { role: "assistant" as const, content: "d" },
        { role: "user" as const, content: "e" },
        { role: "assistant" as const, content: "f" },
      ];

      await compactMessages(fakeModel, msgs, "soft"); // fail 1
      await compactMessages(fakeModel, msgs, "soft"); // fail 2
      const result = await compactMessages(fakeModel, msgs, "soft"); // success

      // Should have summary + kept messages
      expect(result[1].content).toContain("recovered");

      // Circuit breaker should be reset — next failure doesn't trip it
      mockGenerateText.mockRejectedValueOnce(new Error("fail again"));
      await compactMessages(fakeModel, msgs, "soft");
      // Still works (only 1 failure after reset)
      mockGenerateText.mockResolvedValueOnce({ text: "still working" } as any);
      const result2 = await compactMessages(fakeModel, msgs, "soft");
      expect(result2[1].content).toContain("still working");

      resetCompactionState();
    });
  });

  describe("microCompact()", () => {
    it("returns messages unchanged when fewer than preserveRecent", () => {
      const msgs = [
        { role: "user" as const, content: "short" },
        { role: "assistant" as const, content: "also short" },
      ];
      const { messages, charsSaved } = microCompact(msgs);
      expect(messages).toBe(msgs); // Same reference
      expect(charsSaved).toBe(0);
    });

    it("truncates long content in older messages", () => {
      const longContent = "x".repeat(5000);
      const msgs = [
        { role: "user" as const, content: longContent },
        { role: "assistant" as const, content: longContent },
        { role: "user" as const, content: "recent 1" },
        { role: "assistant" as const, content: "recent 2" },
        { role: "user" as const, content: "recent 3" },
        { role: "assistant" as const, content: "recent 4" },
        { role: "user" as const, content: "recent 5" },
        { role: "assistant" as const, content: "recent 6" },
      ];
      const { messages, charsSaved } = microCompact(msgs);

      // First two messages are in "middle" bucket — content > 2000 triggers fallback truncation
      expect(messages[0].content.length).toBeLessThan(600);
      expect(messages[0].content).toContain("truncated");
      expect(messages[1].content).toContain("truncated");

      // Last 4 untouched (preserveRecent default = 4)
      expect(messages[7].content).toBe("recent 6");
      expect(messages[6].content).toBe("recent 5");
      expect(messages[5].content).toBe("recent 4");
      expect(messages[4].content).toBe("recent 3");

      expect(charsSaved).toBeGreaterThan(8000);
    });

    it("does not truncate short older messages", () => {
      const msgs = [
        { role: "user" as const, content: "short old message" },
        { role: "assistant" as const, content: "short old reply" },
        ...Array.from({ length: 4 }, (_, i) => ({
          role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
          content: `recent ${i}`,
        })),
      ];
      const { messages, charsSaved } = microCompact(msgs);
      expect(charsSaved).toBe(0);
      expect(messages[0].content).toBe("short old message");
    });

    it("compresses tool output patterns in middle messages", () => {
      // Code block that matches tool output pattern
      const codeOutput = "```json\n" + '{"key": "value", '.repeat(100) + "}\n```";
      const msgs = [
        { role: "user" as const, content: "old message" },
        { role: "assistant" as const, content: codeOutput },
        { role: "user" as const, content: "middle message" },
        { role: "assistant" as const, content: codeOutput },
        { role: "user" as const, content: "recent 1" },
        { role: "assistant" as const, content: "recent 2" },
        { role: "user" as const, content: "recent 3" },
        { role: "assistant" as const, content: "recent 4" },
      ];
      const { messages, charsSaved } = microCompact(msgs);
      // Old and middle messages with tool output should be compressed
      expect(charsSaved).toBeGreaterThan(0);
      // Recent 4 preserved
      expect(messages[7].content).toBe("recent 4");
    });

    it("respects custom preserveRecent", () => {
      const msgs = [
        { role: "user" as const, content: "a".repeat(3000) },
        { role: "assistant" as const, content: "b".repeat(3000) },
        { role: "user" as const, content: "recent" },
        { role: "assistant" as const, content: "recent" },
      ];
      const { messages, charsSaved } = microCompact(msgs, 2);
      // First two messages are middle bucket (3000 > 2000) — fallback truncation
      expect(charsSaved).toBeGreaterThan(0);
      expect(messages[2].content).toBe("recent");
      expect(messages[3].content).toBe("recent");
    });
  });

  describe("estimateContextTokens()", () => {
    it("estimates tokens from message content", () => {
      const msgs = [
        { content: "a".repeat(400) },  // 100 tokens
        { content: "b".repeat(800) },  // 200 tokens
      ];
      expect(estimateContextTokens(msgs)).toBe(300);
    });

    it("includes system prompt size when provided", () => {
      const msgs = [{ content: "a".repeat(400) }];
      expect(estimateContextTokens(msgs, 400)).toBe(200); // 400 + 400 = 800 chars = 200 tokens
    });

    it("returns 0 for empty messages", () => {
      expect(estimateContextTokens([])).toBe(0);
    });
  });

  describe("extractMemoriesBeforeCompact()", () => {
    it("extracts ::learning:: markers", () => {
      const msgs = [
        { role: "user" as const, content: "some text" },
        { role: "assistant" as const, content: "::learning:: Always run tests before commit" },
        { role: "user" as const, content: "ok" },
      ];
      const result = extractMemoriesBeforeCompact(msgs);
      expect(result).toEqual(["Always run tests before commit"]);
    });

    it("extracts ::remember:: markers", () => {
      const msgs = [
        { role: "assistant" as const, content: "::remember:: User prefers tabs over spaces" },
      ];
      const result = extractMemoriesBeforeCompact(msgs);
      expect(result).toEqual(["User prefers tabs over spaces"]);
    });

    it("extracts multiple markers from multiple messages", () => {
      const msgs = [
        { role: "assistant" as const, content: "::learning:: fact one\nsome other text\n::remember:: fact two" },
        { role: "user" as const, content: "no markers here" },
        { role: "assistant" as const, content: "::learning:: fact three" },
      ];
      const result = extractMemoriesBeforeCompact(msgs);
      expect(result).toEqual(["fact one", "fact two", "fact three"]);
    });

    it("returns empty array when no markers present", () => {
      const msgs = [
        { role: "user" as const, content: "hello" },
        { role: "assistant" as const, content: "hi there" },
      ];
      expect(extractMemoriesBeforeCompact(msgs)).toEqual([]);
    });
  });
});

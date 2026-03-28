import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the "ai" module so generateText doesn't make real API calls
vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

import { getContextLimit, shouldCompact, compactMessages } from "../compaction.js";
import { generateText } from "ai";

const mockGenerateText = vi.mocked(generateText);

describe("compaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getContextLimit()", () => {
    it("returns 200000 for claude models", () => {
      expect(getContextLimit("claude-opus-4-6")).toBe(200000);
      expect(getContextLimit("claude-sonnet-4-6")).toBe(200000);
      expect(getContextLimit("claude-haiku-4-5")).toBe(200000);
    });

    it("returns 400000 for gpt-5.4", () => {
      expect(getContextLimit("gpt-5.4")).toBe(400000);
      expect(getContextLimit("gpt-5.4-mini")).toBe(400000);
    });

    it("returns 1000000 for gemini models", () => {
      expect(getContextLimit("gemini-3.1-pro")).toBe(1000000);
      expect(getContextLimit("gemini-3.1-flash-lite")).toBe(1000000);
    });

    it("returns default 65536 for unknown models", () => {
      expect(getContextLimit("some-unknown-model")).toBe(65536);
    });
  });

  describe("shouldCompact()", () => {
    it("returns 'none' when tokens are below 80% of limit", () => {
      // 200000 * 0.79 = 158000
      expect(shouldCompact(158000, "claude-sonnet-4-6")).toBe("none");
    });

    it("returns 'soft' when tokens are between 80% and 95%", () => {
      // 200000 * 0.85 = 170000
      expect(shouldCompact(170000, "claude-sonnet-4-6")).toBe("soft");
    });

    it("returns 'hard' when tokens are at or above 95%", () => {
      // 200000 * 0.95 = 190000
      expect(shouldCompact(190000, "claude-sonnet-4-6")).toBe("hard");
    });

    it("returns 'hard' when tokens exceed the limit", () => {
      expect(shouldCompact(250000, "claude-sonnet-4-6")).toBe("hard");
    });

    it("uses configuredContextLength when provided", () => {
      // Custom limit of 10000, 80% = 8000
      expect(shouldCompact(7000, "anything", 10000)).toBe("none");
      expect(shouldCompact(8500, "anything", 10000)).toBe("soft");
      expect(shouldCompact(9600, "anything", 10000)).toBe("hard");
    });

    it("returns 'none' for zero tokens", () => {
      expect(shouldCompact(0, "claude-sonnet-4-6")).toBe("none");
    });
  });

  describe("compactMessages()", () => {
    const fakeModel = {} as any;

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
      expect(result[0].content).toContain("Summarize the conversation");
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
      expect(result[0].content).toContain("Summarize");
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
          prompt: expect.stringContaining("user: a"),
        }),
      );
    });
  });
});

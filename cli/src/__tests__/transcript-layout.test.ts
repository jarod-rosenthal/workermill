import { describe, it, expect } from "vitest";
import type { Message } from "../ui/types.js";
import {
  getAssistantMarginTop,
  normalizeAssistantContent,
  shouldRenderUserDivider,
} from "../ui/transcript-layout.js";

function msg(
  role: "user" | "assistant",
  content: string,
  compact = false,
): Message {
  return {
    id: `${role}-${Math.random()}`,
    role,
    content,
    compact: compact || undefined,
    timestamp: new Date().toISOString(),
  };
}

describe("transcript layout contract", () => {
  it("gives normal chat assistant replies breathing room after a user turn", () => {
    const messages: Message[] = [
      msg("user", "hello"),
      msg("assistant", "Hi there"),
    ];
    expect(getAssistantMarginTop(messages, 1)).toBe(1);
  });

  it("adds one blank line before first compact output after user input", () => {
    const messages: Message[] = [
      msg("user", "/ship GH-7"),
      msg("assistant", "[planner] reading files", true),
    ];
    expect(getAssistantMarginTop(messages, 1)).toBe(1);
  });

  it("keeps consecutive compact lines single-spaced", () => {
    const messages: Message[] = [
      msg("assistant", "[planner] step 1", true),
      msg("assistant", "[planner] step 2", true),
      msg("assistant", "[planner] step 3", true),
    ];
    expect(getAssistantMarginTop(messages, 1)).toBe(0);
    expect(getAssistantMarginTop(messages, 2)).toBe(0);
  });

  it("keeps /ship-style compact output single-spaced after the first line", () => {
    const messages: Message[] = [
      msg("user", "/ship GH-7"),
      msg("assistant", "[coordinator] fetched issue", true),
      msg("assistant", "[planner] reading files", true),
      msg("assistant", "[planner] produced plan", true),
    ];
    expect(getAssistantMarginTop(messages, 1)).toBe(1); // one blank line after user input
    expect(getAssistantMarginTop(messages, 2)).toBe(0); // then single-spaced
    expect(getAssistantMarginTop(messages, 3)).toBe(0);
  });

  it("does not add extra top margin between consecutive normal assistant messages", () => {
    const messages: Message[] = [
      msg("assistant", "part one"),
      msg("assistant", "part two"),
    ];
    expect(getAssistantMarginTop(messages, 1)).toBe(0);
  });

  it("ignores hidden empty assistant placeholders when computing spacing", () => {
    const messages: Message[] = [
      msg("user", "hello"),
      msg("assistant", "", false), // hidden by App
      msg("assistant", "response"),
    ];
    expect(getAssistantMarginTop(messages, 2)).toBe(1);
  });

  it("normalizes trailing newlines while preserving internal blank lines", () => {
    const content = "line 1\r\n\r\nline 2\n\n";
    expect(normalizeAssistantContent(content)).toBe("line 1\n\nline 2");
  });

  it("renders user divider for all but the first user message", () => {
    expect(shouldRenderUserDivider(0)).toBe(false);
    expect(shouldRenderUserDivider(1)).toBe(true);
    expect(shouldRenderUserDivider(8)).toBe(true);
  });
});

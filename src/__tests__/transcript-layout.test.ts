import { describe, it, expect } from "vitest";
import type { Message } from "../ui/types.js";
import {
  getAssistantMarginTop,
  normalizeAssistantContent,
  normalizeUserContent,
  shouldSeparateLiveActivityFromPrompt,
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

  it("normalizes accidental wrapped user gaps without flattening normal prose", () => {
    const content = "what is the low\n\n hanging fruit?";
    expect(normalizeUserContent(content)).toBe("what is the low hanging fruit?");
  });

  it("keeps intentional user paragraph breaks when next paragraph starts uppercase", () => {
    const content = "First paragraph.\n\nSecond paragraph.";
    expect(normalizeUserContent(content)).toBe("First paragraph.\n\nSecond paragraph.");
  });

  it("reflows chopped prose with mid-word newline splits", () => {
    const content = "ok, great work ... onl\ny\n\n real issues.";
    expect(normalizeUserContent(content)).toBe("ok, great work ... only real issues.");
  });

  it("fixes orphan punctuation line followed by an empty-line gap", () => {
    const content = "This happens after enter, it gets reformatted\n,\n\n so this is a test.";
    expect(normalizeUserContent(content)).toBe("This happens after enter, it gets reformatted, so this is a test.");
  });

  it("reflows lowercase hard-wrap continuation from long submitted input", () => {
    const content = "I'm checking the terminal and it's\nsupposed to stay on one line.";
    expect(normalizeUserContent(content)).toBe("I'm checking the terminal and it's supposed to stay on one line.");
  });

  it("normalizes carriage-return variants before applying user-wrap cleanup", () => {
    const content = "This happens after enter, it gets reformatted\r,\r\r so this is a test.";
    expect(normalizeUserContent(content)).toBe("This happens after enter, it gets reformatted, so this is a test.");
  });

  it("renders user divider for all but the first user message", () => {
    expect(shouldRenderUserDivider(0)).toBe(false);
    expect(shouldRenderUserDivider(1)).toBe(true);
    expect(shouldRenderUserDivider(8)).toBe(true);
  });

  it("adds live-activity spacer when the last visible message is user input", () => {
    const messages: Message[] = [
      msg("assistant", "Prior response"),
      msg("user", "can you describe the open issues for this repo?"),
    ];
    expect(shouldSeparateLiveActivityFromPrompt(messages, true, true)).toBe(true);
  });

  it("does not add live-activity spacer when the last visible message is assistant output", () => {
    const messages: Message[] = [
      msg("user", "question"),
      msg("assistant", "answer"),
    ];
    expect(shouldSeparateLiveActivityFromPrompt(messages, true, true)).toBe(false);
  });

  it("ignores hidden empty assistant placeholders when deciding live-activity spacing", () => {
    const messages: Message[] = [
      msg("assistant", "setup"),
      msg("user", "run a command"),
      msg("assistant", "", false), // hidden by App
    ];
    expect(shouldSeparateLiveActivityFromPrompt(messages, true, false)).toBe(true);
  });

  it("skips live-activity spacer when there is no live activity", () => {
    const messages: Message[] = [msg("user", "hello")];
    expect(shouldSeparateLiveActivityFromPrompt(messages, false, false)).toBe(false);
  });
});

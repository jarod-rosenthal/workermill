import { describe, it, expect, vi } from "vitest";

vi.mock("../logger.js", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../session.js", () => ({
  listSessions: vi.fn(() => []),
  saveSession: vi.fn(),
}));

import { resolveEditorCommand } from "../ui/commands/session.js";

describe("resolveEditorCommand", () => {
  it("prefers an explicitly configured editor over the environment", () => {
    expect(resolveEditorCommand("vim", { EDITOR: "nano" })).toBe("vim");
    expect(resolveEditorCommand("nano", { EDITOR: "vim", VISUAL: "code" })).toBe("nano");
  });

  it('falls back to $EDITOR when configured as "auto"', () => {
    expect(resolveEditorCommand("auto", { EDITOR: "hx" })).toBe("hx");
  });

  it("falls back to $EDITOR when nothing is configured", () => {
    expect(resolveEditorCommand(undefined, { EDITOR: "hx" })).toBe("hx");
  });

  it("falls back to $VISUAL when $EDITOR is unset", () => {
    expect(resolveEditorCommand("auto", { VISUAL: "code -w" })).toBe("code -w");
  });

  it("falls back to vi when neither the config nor the environment names an editor", () => {
    expect(resolveEditorCommand(undefined, {})).toBe("vi");
    expect(resolveEditorCommand("auto", {})).toBe("vi");
  });
});

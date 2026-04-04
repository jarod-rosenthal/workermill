import { describe, it, expect } from "vitest";
import { areStatusBarPropsEqual } from "../ui/StatusBar.js";

function baseProps() {
  return {
    model: "gpt-5.4",
    provider: "openai",
    tokens: 1000,
    maxContext: 1_000_000,
    cost: 0.12,
    mode: "default",
    gitBranch: "main",
    cwd: "cli",
    roleModels: {
      worker: "openai/gpt-5.4",
      planner: "google/gemini-3.1-pro",
      reviewer: "openai/gpt-5.4",
    },
    toolCounts: { read_file: 3, bash: 1 },
    mcpCount: 1,
    sessionStart: 1_700_000_000_000,
    hasInstructions: true,
    tokPerSec: { "openai/gpt-5.4": 42 },
  };
}

describe("areStatusBarPropsEqual", () => {
  it("returns true for value-equivalent props", () => {
    const a = baseProps();
    const b = {
      ...baseProps(),
      roleModels: { ...baseProps().roleModels },
      toolCounts: { ...baseProps().toolCounts },
      tokPerSec: { ...baseProps().tokPerSec },
    };
    expect(areStatusBarPropsEqual(a, b)).toBe(true);
  });

  it("returns false when toolCounts values differ", () => {
    const a = baseProps();
    const b = { ...baseProps(), toolCounts: { read_file: 4, bash: 1 } };
    expect(areStatusBarPropsEqual(a, b)).toBe(false);
  });

  it("returns false when tokPerSec values differ", () => {
    const a = baseProps();
    const b = { ...baseProps(), tokPerSec: { "openai/gpt-5.4": 43 } };
    expect(areStatusBarPropsEqual(a, b)).toBe(false);
  });

  it("returns false when roleModels differ", () => {
    const a = baseProps();
    const b = { ...baseProps(), roleModels: { worker: "openai/gpt-5.4", planner: "google/gemini-3.1-flash", reviewer: "openai/gpt-5.4" } };
    expect(areStatusBarPropsEqual(a, b)).toBe(false);
  });

  it("returns false when scalar fields differ", () => {
    const a = baseProps();
    const b = { ...baseProps(), tokens: 1200 };
    expect(areStatusBarPropsEqual(a, b)).toBe(false);
  });
});

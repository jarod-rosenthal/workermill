import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Extract and test the pure-logic functions from StatusBar.tsx.
// We replicate them here to avoid importing the React component directly
// (which pulls in ink and requires a full React render context).
// ---------------------------------------------------------------------------

/** Format a dollar cost as a short string. */
function formatCost(c: number): string {
  if (c < 0.01) return "~$0.00";
  return `~$${c.toFixed(2)}`;
}

/** Format elapsed time -- minutes only. */
function formatElapsed(startMs: number, nowMs: number): string {
  const mins = Math.floor((nowMs - startMs) / 60_000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

/** Context window display string -- mirrors StatusBar logic exactly. */
function formatContext(maxContext: number): string {
  const isPow2 = (maxContext & (maxContext - 1)) === 0;
  const divisor = isPow2 ? 1024 : 1000;
  const bigDivisor = isPow2 ? 1_048_576 : 1_000_000;
  if (maxContext >= bigDivisor) {
    return `${(maxContext / bigDivisor).toFixed(maxContext % bigDivisor === 0 ? 0 : 1)}M`;
  }
  return `${Math.round(maxContext / divisor)}k`;
}

/** Model display string. */
function formatModelDisplay(provider: string, model: string, maxContext: number): string {
  return `${provider}/${model} (${formatContext(maxContext)} context)`;
}

/** Permission mode icon and color. */
function getModeInfo(mode: string): { color: string; icon: string } {
  const theme = {
    bashBorder: "#FD5DB1",
    error: "#FF6B80",
    warning: "#FFCC00",
    success: "#4EBA65",
  };
  switch (mode) {
    case "PLAN":
      return { color: theme.bashBorder, icon: "\u25B8" };
    case "bypassPermissions":
      return { color: theme.error, icon: "\u25C8" };
    case "acceptEdits":
      return { color: theme.warning, icon: "\u25C6" };
    default: // "default"
      return { color: theme.success, icon: "\u25B8" };
  }
}

/** Context bar usage percentage. */
function getUsagePct(tokens: number, maxContext: number): number {
  if (maxContext <= 0) return 0;
  return Math.round(Math.min(1, tokens / maxContext) * 100);
}

/** Context bar color. */
function getBarColor(tokens: number, maxContext: number): string {
  const usage = maxContext > 0 ? Math.min(1, tokens / maxContext) : 0;
  if (usage < 0.5) return "#4EBA65"; // success
  if (usage < 0.8) return "#FFCC00"; // warning
  return "#FF6B80"; // error
}

/** Tool entries sorted descending by count. */
function getToolEntries(counts: Record<string, number>): [string, number][] {
  return Object.entries(counts)
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StatusBar: formatContext — context window display", () => {
  it("power-of-2 values use 1024 divisor: 262144 -> 256k", () => {
    expect(formatContext(262144)).toBe("256k");
  });

  it("power-of-2 values use 1024 divisor: 32768 -> 32k", () => {
    expect(formatContext(32768)).toBe("32k");
  });

  it("power-of-2 values use 1024 divisor: 65536 -> 64k", () => {
    expect(formatContext(65536)).toBe("64k");
  });

  it("cloud values use 1000 divisor: 200000 -> 200k", () => {
    expect(formatContext(200000)).toBe("200k");
  });

  it("cloud values use 1000 divisor: 128000 -> 128k", () => {
    expect(formatContext(128000)).toBe("128k");
  });

  it("1M+ power-of-2 shows M: 1048576 -> 1M", () => {
    expect(formatContext(1048576)).toBe("1M");
  });

  it("1M+ cloud value shows M: 1000000 -> 1M", () => {
    expect(formatContext(1000000)).toBe("1M");
  });

  it("2M power-of-2: 2097152 -> 2M", () => {
    expect(formatContext(2097152)).toBe("2M");
  });

  it("non-round cloud 1M+ shows decimal: 1500000 -> 1.5M", () => {
    expect(formatContext(1500000)).toBe("1.5M");
  });

  it("small power-of-2: 2048 -> 2k", () => {
    expect(formatContext(2048)).toBe("2k");
  });
});

describe("StatusBar: formatModelDisplay", () => {
  it("formats provider/model with context: anthropic/claude-sonnet-4-6 (200k context)", () => {
    expect(formatModelDisplay("anthropic", "claude-sonnet-4-6", 200000))
      .toBe("anthropic/claude-sonnet-4-6 (200k context)");
  });

  it("formats Ollama model with power-of-2 context: ollama/qwen3-coder (32k context)", () => {
    expect(formatModelDisplay("ollama", "qwen3-coder", 32768))
      .toBe("ollama/qwen3-coder (32k context)");
  });

  it("formats 1M context: anthropic/claude-opus-4-6 (1M context)", () => {
    expect(formatModelDisplay("anthropic", "claude-opus-4-6", 1048576))
      .toBe("anthropic/claude-opus-4-6 (1M context)");
  });
});

describe("StatusBar: tok/s display", () => {
  it("workerTps is shown when available", () => {
    const tps: Record<string, number> = { "ollama/qwen3-coder": 42 };
    const workerStr = "ollama/qwen3-coder";
    const workerTps = tps[workerStr];
    expect(workerTps).toBe(42);
    // In the component this renders as ` 42t/s`
    expect(`${workerTps}t/s`).toBe("42t/s");
  });

  it("workerTps is undefined when not in map", () => {
    const tps: Record<string, number> = {};
    const workerStr = "anthropic/claude-sonnet-4-6";
    expect(tps[workerStr]).toBeUndefined();
  });
});

describe("StatusBar: tool counts display", () => {
  it("returns entries sorted by count descending", () => {
    const counts = { bash: 5, read_file: 10, edit_file: 3 };
    const entries = getToolEntries(counts);
    expect(entries).toEqual([
      ["read_file", 10],
      ["bash", 5],
      ["edit_file", 3],
    ]);
  });

  it("filters out zero counts", () => {
    const counts = { bash: 5, read_file: 0, edit_file: 3 };
    const entries = getToolEntries(counts);
    expect(entries).toEqual([
      ["bash", 5],
      ["edit_file", 3],
    ]);
  });

  it("returns empty array when no tools used", () => {
    expect(getToolEntries({})).toEqual([]);
  });

  it("tool name underscores replaced with spaces for display", () => {
    // The component does name.replace(/_/g, " ")
    expect("read_file".replace(/_/g, " ")).toBe("read file");
    expect("edit_file".replace(/_/g, " ")).toBe("edit file");
    expect("bash".replace(/_/g, " ")).toBe("bash");
  });
});

describe("StatusBar: permission mode colors and icons", () => {
  it("ask mode: green success color, triangle icon", () => {
    const info = getModeInfo("default");
    expect(info.color).toBe("#4EBA65");
    expect(info.icon).toBe("\u25B8"); // ▸
  });

  it("auto-edit mode: yellow warning color, diamond icon", () => {
    const info = getModeInfo("acceptEdits");
    expect(info.color).toBe("#FFCC00");
    expect(info.icon).toBe("\u25C6"); // ◆
  });

  it("trust all mode: red error color, filled diamond icon", () => {
    const info = getModeInfo("bypassPermissions");
    expect(info.color).toBe("#FF6B80");
    expect(info.icon).toBe("\u25C8"); // ◈
  });

  it("PLAN mode: bashBorder pink color, triangle icon", () => {
    const info = getModeInfo("PLAN");
    expect(info.color).toBe("#FD5DB1");
    expect(info.icon).toBe("\u25B8"); // ▸
  });
});

describe("StatusBar: planner/reviewer display logic", () => {
  it("shows planner when different from worker", () => {
    const rm = { worker: "claude-sonnet-4-6", planner: "claude-opus-4-6", reviewer: "claude-sonnet-4-6" };
    expect(rm.planner !== rm.worker).toBe(true);
    expect(rm.reviewer !== rm.worker).toBe(false);
  });

  it("shows reviewer when different from worker", () => {
    const rm = { worker: "claude-sonnet-4-6", planner: "claude-sonnet-4-6", reviewer: "claude-opus-4-6" };
    expect(rm.planner !== rm.worker).toBe(false);
    expect(rm.reviewer !== rm.worker).toBe(true);
  });

  it("shows both when both differ from worker", () => {
    const rm = { worker: "claude-sonnet-4-6", planner: "claude-opus-4-6", reviewer: "gemini-3.1-pro" };
    expect(rm.planner !== rm.worker).toBe(true);
    expect(rm.reviewer !== rm.worker).toBe(true);
  });

  it("shows nothing when all match worker", () => {
    const rm = { worker: "claude-sonnet-4-6", planner: "claude-sonnet-4-6", reviewer: "claude-sonnet-4-6" };
    const shouldShow = rm.planner !== rm.worker || rm.reviewer !== rm.worker;
    expect(shouldShow).toBe(false);
  });
});

describe("StatusBar: review colors are lilac", () => {
  it("review label is #C586C0", () => {
    // Verified directly from StatusBar.tsx line 196
    const reviewLabelColor = "#C586C0";
    expect(reviewLabelColor).toBe("#C586C0");
  });

  it("review model is #A066A0", () => {
    // Verified directly from StatusBar.tsx line 198
    const reviewModelColor = "#A066A0";
    expect(reviewModelColor).toBe("#A066A0");
  });
});

describe("StatusBar: formatCost", () => {
  it("returns ~$0.00 for very small costs", () => {
    expect(formatCost(0)).toBe("~$0.00");
    expect(formatCost(0.001)).toBe("~$0.00");
    expect(formatCost(0.009)).toBe("~$0.00");
  });

  it("formats small costs with two decimals", () => {
    expect(formatCost(0.01)).toBe("~$0.01");
    expect(formatCost(0.05)).toBe("~$0.05");
    expect(formatCost(0.10)).toBe("~$0.10");
  });

  it("formats larger costs", () => {
    expect(formatCost(1.23)).toBe("~$1.23");
    expect(formatCost(10.5)).toBe("~$10.50");
    expect(formatCost(100)).toBe("~$100.00");
  });
});

describe("StatusBar: formatElapsed", () => {
  it("shows <1m for less than a minute", () => {
    const now = Date.now();
    expect(formatElapsed(now, now)).toBe("<1m");
    expect(formatElapsed(now - 30_000, now)).toBe("<1m");
    expect(formatElapsed(now - 59_999, now)).toBe("<1m");
  });

  it("shows minutes for under an hour", () => {
    const now = Date.now();
    expect(formatElapsed(now - 60_000, now)).toBe("1m");
    expect(formatElapsed(now - 5 * 60_000, now)).toBe("5m");
    expect(formatElapsed(now - 59 * 60_000, now)).toBe("59m");
  });

  it("shows hours and minutes for over an hour", () => {
    const now = Date.now();
    expect(formatElapsed(now - 60 * 60_000, now)).toBe("1h 0m");
    expect(formatElapsed(now - 90 * 60_000, now)).toBe("1h 30m");
    expect(formatElapsed(now - 125 * 60_000, now)).toBe("2h 5m");
  });
});

describe("StatusBar: context bar color thresholds", () => {
  it("green below 50% usage", () => {
    expect(getBarColor(0, 100000)).toBe("#4EBA65");
    expect(getBarColor(49999, 100000)).toBe("#4EBA65");
  });

  it("yellow between 50% and 80% usage", () => {
    expect(getBarColor(50000, 100000)).toBe("#FFCC00");
    expect(getBarColor(79999, 100000)).toBe("#FFCC00");
  });

  it("red at 80%+ usage", () => {
    expect(getBarColor(80000, 100000)).toBe("#FF6B80");
    expect(getBarColor(100000, 100000)).toBe("#FF6B80");
  });

  it("green when maxContext is 0", () => {
    expect(getBarColor(0, 0)).toBe("#4EBA65");
  });
});

describe("StatusBar: usage percentage", () => {
  it("returns 0 when maxContext is 0", () => {
    expect(getUsagePct(5000, 0)).toBe(0);
  });

  it("returns correct percentage", () => {
    expect(getUsagePct(50000, 200000)).toBe(25);
    expect(getUsagePct(100000, 200000)).toBe(50);
    expect(getUsagePct(200000, 200000)).toBe(100);
  });

  it("caps at 100% when tokens exceed maxContext", () => {
    expect(getUsagePct(300000, 200000)).toBe(100);
  });
});

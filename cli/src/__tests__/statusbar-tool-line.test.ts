import { describe, expect, it } from "vitest";
import { formatToolUsageLine } from "../ui/StatusBar.js";

describe("formatToolUsageLine", () => {
  it("returns no tool calls when empty", () => {
    expect(formatToolUsageLine({}, 40)).toBe("no tool calls");
  });

  it("uses compact labels for file tools", () => {
    const line = formatToolUsageLine({ read_file: 10, write_file: 2, edit_file: 1 }, 120);
    expect(line).toContain("read");
    expect(line).toContain("write");
    expect(line).toContain("edit");
    expect(line).not.toContain("read file");
  });

  it("truncates with ellipsis when content exceeds max width", () => {
    const line = formatToolUsageLine(
      { read_file: 40, write_file: 20, edit_file: 10, bash: 8, grep: 6, glob: 4 },
      28,
    );
    expect(line.endsWith("...")).toBe(true);
    expect(line.length).toBeLessThanOrEqual(28);
  });

  it("fits without ellipsis when room is available", () => {
    const line = formatToolUsageLine({ bash: 2, read_file: 1 }, 80);
    expect(line.endsWith("...")).toBe(false);
  });
});


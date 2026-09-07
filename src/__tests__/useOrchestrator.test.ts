import { describe, expect, it, vi } from "vitest";
import {
  addSessionSummaryDivider,
  SESSION_SUMMARY_DIVIDER,
} from "../ui/useOrchestrator.js";

import { formatToolCallDetail } from "../ui/orchestration-presentation.js";

describe("session summary divider", () => {
  it("inserts the production divider when operational output exists", () => {
    const addMessage = vi.fn();
    addSessionSummaryDivider(addMessage, true);
    expect(addMessage).toHaveBeenCalledWith(SESSION_SUMMARY_DIVIDER);
  });

  it("skips the divider when there was no operational output", () => {
    const addMessage = vi.fn();
    addSessionSummaryDivider(addMessage, false);
    expect(addMessage).not.toHaveBeenCalled();
  });
});

describe("orchestration tool presentation", () => {
  it("uses caller-owned file sequences across write, edit and patch displays", () => {
    const counts = new Map<string, number>();
    const next = (file: string) => {
      const count = (counts.get(file) ?? 0) + 1;
      counts.set(file, count);
      return count;
    };
    expect(formatToolCallDetail("write_file", { file_path: "app.ts", content: "one" }, next))
      .toBe("app.ts [#1 write 3b 1l]");
    expect(formatToolCallDetail("edit_file", { file_path: "app.ts", old_string: "one", new_string: "two", replaceAll: true }, next))
      .toBe("app.ts [#2 replace 3->3b 1->1l x*]");
    expect(formatToolCallDetail("patch", { patch_text: "+++ b/app.ts\n@@ -1 +1 @@\n-one\n+two" }, next))
      .toBe("app.ts [#3 1f 1h patch]");
    expect(counts).toEqual(new Map([["app.ts", 3]]));
  });

  it("does not advance edit sequences when rendering ordinary tool details", () => {
    const next = vi.fn();
    expect(formatToolCallDetail("read_file", { path: "app.ts" }, next)).toBe("app.ts");
    expect(formatToolCallDetail("bash", { command: "x".repeat(121) }, next)).toBe("x".repeat(117) + "...");
    expect(formatToolCallDetail("custom", {}, next)).toBe("");
    expect(next).not.toHaveBeenCalled();
  });
});

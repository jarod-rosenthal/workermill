import { describe, expect, it } from "vitest";
import { buildEditedFilePreviews } from "../ui/EditedFilePreview.js";
import type { ToolCallInfo } from "../ui/types.js";

function tool(
  name: string,
  input: Record<string, unknown>,
  status: ToolCallInfo["status"] = "done",
): ToolCallInfo {
  return {
    id: `${name}-${Math.random()}`,
    name,
    input,
    status,
  };
}

describe("buildEditedFilePreviews", () => {
  it("builds remove/add lines for edit_file", () => {
    const previews = buildEditedFilePreviews([
      tool("edit_file", {
        path: "src/example.ts",
        old_string: "const a = 1;\nreturn a;",
        new_string: "const b = 2;\nreturn b;",
      }),
    ]);

    expect(previews).toHaveLength(1);
    expect(previews[0].filePath).toBe("src/example.ts");
    expect(previews[0].additions).toBe(2);
    expect(previews[0].removals).toBe(2);
    expect(previews[0].lines.some((line) => line.kind === "remove")).toBe(true);
    expect(previews[0].lines.some((line) => line.kind === "add")).toBe(true);
  });

  it("parses unified patch hunks", () => {
    const patchText = [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -10,2 +10,2 @@",
      "-const oldValue = 1;",
      "+const newValue = 2;",
      " return newValue;",
    ].join("\n");

    const previews = buildEditedFilePreviews([
      tool("patch", { patch_text: patchText }),
    ]);

    expect(previews).toHaveLength(1);
    expect(previews[0].filePath).toBe("src/app.ts");
    expect(previews[0].additions).toBe(1);
    expect(previews[0].removals).toBe(1);
    expect(previews[0].lines.some((line) => line.hunkHeader?.startsWith("@@"))).toBe(true);
    expect(previews[0].lines.some((line) => line.kind === "remove")).toBe(true);
    expect(previews[0].lines.some((line) => line.kind === "add")).toBe(true);
  });

  it("ignores unfinished tool calls", () => {
    const previews = buildEditedFilePreviews([
      tool("edit_file", { path: "x.ts", old_string: "a", new_string: "b" }, "running"),
    ]);
    expect(previews).toHaveLength(0);
  });
});

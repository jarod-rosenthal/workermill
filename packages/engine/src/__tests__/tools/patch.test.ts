import fs from "fs";
import path from "path";
import { createTempDir, cleanupTempDir } from "../helpers/temp-dir.js";
import { createToolDefinitions } from "../../tools/index.js";

const CTX = { toolCallId: "1", messages: [] as any[] };

describe("patch tool", () => {
  let dir: string;
  let tools: ReturnType<typeof createToolDefinitions>;

  beforeEach(() => {
    dir = createTempDir("wm-patch-");
    tools = createToolDefinitions(dir);
  });

  afterEach(() => cleanupTempDir(dir));

  it("applies a unified diff to an existing file", async () => {
    const filePath = path.join(dir, "target.txt");
    fs.writeFileSync(filePath, "line1\nline2\nline3\n");
    const patchText = [
      `--- a/${filePath}`,
      `+++ b/${filePath}`,
      "@@ -1,3 +1,3 @@",
      " line1",
      "-line2",
      "+line2_modified",
      " line3",
    ].join("\n");
    const result = await tools.patch.execute({ patch_text: patchText }, CTX);
    expect(result).toContain("Patch applied successfully");
    expect(result).toContain("Modified");
    expect(fs.readFileSync(filePath, "utf8")).toContain("line2_modified");
  });

  it("creates a new file from patch", async () => {
    const filePath = path.join(dir, "brand_new.txt");
    const patchText = [
      "--- /dev/null",
      `+++ b/${filePath}`,
      "@@ -0,0 +1,2 @@",
      "+new line 1",
      "+new line 2",
    ].join("\n");
    const result = await tools.patch.execute({ patch_text: patchText }, CTX);
    expect(result).toContain("Patch applied successfully");
    expect(result).toContain("Created");
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, "utf8")).toContain("new line 1");
  });
});

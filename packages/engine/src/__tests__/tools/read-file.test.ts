import fs from "fs";
import path from "path";
import { createTempDir, cleanupTempDir } from "../helpers/temp-dir.js";
import { createToolDefinitions } from "../../tools/index.js";

const CTX = { toolCallId: "1", messages: [] as any[] };

describe("read_file tool", () => {
  let dir: string;
  let tools: ReturnType<typeof createToolDefinitions>;

  beforeEach(() => {
    dir = createTempDir("wm-read-");
    tools = createToolDefinitions(dir);
  });

  afterEach(() => cleanupTempDir(dir));

  it("reads full file content", async () => {
    fs.writeFileSync(path.join(dir, "hello.txt"), "line1\nline2\nline3\n");
    const result = await tools.read_file.execute({ path: "hello.txt" }, CTX);
    expect(result).toContain("line1");
    expect(result).toContain("line2");
    expect(result).toContain("line3");
  });

  it("reads from startLine", async () => {
    fs.writeFileSync(path.join(dir, "lines.txt"), "a\nb\nc\nd\ne\n");
    const result = await tools.read_file.execute({ path: "lines.txt", startLine: 3 }, CTX);
    expect(result).toContain("c");
    expect(result).toContain("d");
    expect(result).not.toContain("a\n");
  });

  it("reads with maxLines", async () => {
    fs.writeFileSync(path.join(dir, "lines.txt"), "a\nb\nc\nd\ne\n");
    const result = await tools.read_file.execute({ path: "lines.txt", startLine: 2, maxLines: 2 }, CTX);
    expect(result).toContain("b");
    expect(result).toContain("c");
    expect(result).not.toContain("d");
  });

  it("returns error for missing file", async () => {
    const result = await tools.read_file.execute({ path: "nonexistent.txt" }, CTX);
    expect(result).toMatch(/Error.*not found/i);
  });

  it("rejects path outside sandbox", async () => {
    await expect(
      tools.read_file.execute({ path: "../../etc/passwd" }, CTX)
    ).rejects.toThrow(/outside the working directory/);
  });
});

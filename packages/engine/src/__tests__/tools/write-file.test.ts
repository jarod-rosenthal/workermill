import fs from "fs";
import path from "path";
import { createTempDir, cleanupTempDir } from "../helpers/temp-dir.js";
import { createToolDefinitions } from "../../tools/index.js";

const CTX = { toolCallId: "1", messages: [] as any[] };

describe("write_file tool", () => {
  let dir: string;
  let tools: ReturnType<typeof createToolDefinitions>;

  beforeEach(() => {
    dir = createTempDir("wm-write-");
    tools = createToolDefinitions(dir);
  });

  afterEach(() => cleanupTempDir(dir));

  it("creates a new file", async () => {
    const result = await tools.write_file.execute(
      { path: "new.txt", content: "hello world" },
      CTX,
    );
    expect(result).toContain("written successfully");
    expect(fs.readFileSync(path.join(dir, "new.txt"), "utf8")).toBe("hello world");
  });

  it("overwrites an existing file", async () => {
    fs.writeFileSync(path.join(dir, "old.txt"), "old content");
    const result = await tools.write_file.execute(
      { path: "old.txt", content: "new content" },
      CTX,
    );
    expect(result).toContain("written successfully");
    expect(fs.readFileSync(path.join(dir, "old.txt"), "utf8")).toBe("new content");
  });

  it("appends to an existing file", async () => {
    fs.writeFileSync(path.join(dir, "app.txt"), "first\n");
    const result = await tools.write_file.execute(
      { path: "app.txt", content: "second\n", append: true },
      CTX,
    );
    expect(result).toContain("appended");
    expect(fs.readFileSync(path.join(dir, "app.txt"), "utf8")).toBe("first\nsecond\n");
  });

  it("creates intermediate directories", async () => {
    const result = await tools.write_file.execute(
      { path: "a/b/c/deep.txt", content: "deep" },
      CTX,
    );
    expect(result).toContain("written successfully");
    expect(fs.existsSync(path.join(dir, "a/b/c/deep.txt"))).toBe(true);
  });

  it("rejects path that escapes sandbox", async () => {
    await expect(
      tools.write_file.execute({ path: "../../escape.txt", content: "bad" }, CTX)
    ).rejects.toThrow(/outside the working directory/);
  });
});

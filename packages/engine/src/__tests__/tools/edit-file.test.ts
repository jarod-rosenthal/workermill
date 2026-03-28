import fs from "fs";
import path from "path";
import { createTempDir, cleanupTempDir } from "../helpers/temp-dir.js";
import { createToolDefinitions } from "../../tools/index.js";

const CTX = { toolCallId: "1", messages: [] as any[] };

describe("edit_file tool", () => {
  let dir: string;
  let tools: ReturnType<typeof createToolDefinitions>;

  beforeEach(() => {
    dir = createTempDir("wm-edit-");
    tools = createToolDefinitions(dir);
  });

  afterEach(() => cleanupTempDir(dir));

  it("performs exact match replacement", async () => {
    fs.writeFileSync(path.join(dir, "f.txt"), "hello world\nfoo bar\n");
    const result = await tools.edit_file.execute(
      { path: "f.txt", old_string: "hello world", new_string: "goodbye world" },
      CTX,
    );
    expect(result).toContain("File edited");
    expect(result).toContain("1 replacement(s)");
    expect(fs.readFileSync(path.join(dir, "f.txt"), "utf8")).toContain("goodbye world");
  });

  it("replaces all occurrences with replaceAll", async () => {
    fs.writeFileSync(path.join(dir, "f.txt"), "aaa bbb aaa ccc aaa\n");
    const result = await tools.edit_file.execute(
      { path: "f.txt", old_string: "aaa", new_string: "zzz", replaceAll: true },
      CTX,
    );
    expect(result).toContain("3 replacement(s)");
    expect(fs.readFileSync(path.join(dir, "f.txt"), "utf8")).toBe("zzz bbb zzz ccc zzz\n");
  });

  it("returns hint when old_string not found", async () => {
    fs.writeFileSync(path.join(dir, "f.txt"), "alpha beta gamma\n");
    const result = await tools.edit_file.execute(
      { path: "f.txt", old_string: "nonexistent string", new_string: "x" },
      CTX,
    );
    expect(result).toContain("Error");
    expect(result).toContain("Hint");
  });

  it("errors on multiple matches without replaceAll", async () => {
    fs.writeFileSync(path.join(dir, "f.txt"), "foo\nfoo\nbar\n");
    const result = await tools.edit_file.execute(
      { path: "f.txt", old_string: "foo", new_string: "baz" },
      CTX,
    );
    expect(result).toContain("Error");
    expect(result).toMatch(/found 2 times/);
  });
});

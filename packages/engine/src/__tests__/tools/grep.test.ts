import fs from "fs";
import path from "path";
import { createTempDir, cleanupTempDir } from "../helpers/temp-dir.js";
import { createToolDefinitions } from "../../tools/index.js";

const CTX = { toolCallId: "1", messages: [] as any[] };

describe("grep tool", () => {
  let dir: string;
  let tools: ReturnType<typeof createToolDefinitions>;

  beforeEach(() => {
    dir = createTempDir("wm-grep-");
    tools = createToolDefinitions(dir);
    fs.writeFileSync(path.join(dir, "a.ts"), "const foo = 1;\nconst bar = 2;\nconst FOO = 3;\n");
    fs.writeFileSync(path.join(dir, "b.js"), "let baz = true;\nlet foo = false;\n");
  });

  afterEach(() => cleanupTempDir(dir));

  it("finds regex matches", async () => {
    const result = await tools.grep.execute({ pattern: "foo" }, CTX);
    expect(result).toContain("foo");
    expect(result).toContain("a.ts");
    expect(result).toContain("b.js");
  });

  it("case-insensitive search", async () => {
    const result = await tools.grep.execute({ pattern: "foo", ignoreCase: true }, CTX);
    expect(result).toContain("FOO");
    expect(result).toContain("foo");
  });

  it("filters by file pattern", async () => {
    const result = await tools.grep.execute({ pattern: "foo", filePattern: "*.ts" }, CTX);
    expect(result).toContain("a.ts");
    expect(result).not.toContain("b.js");
  });

  it("returns no matches message", async () => {
    const result = await tools.grep.execute({ pattern: "zzzzz_no_match" }, CTX);
    expect(result).toContain("No matches found");
  });
});

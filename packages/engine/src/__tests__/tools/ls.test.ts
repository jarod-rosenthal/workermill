import fs from "fs";
import path from "path";
import { createTempDir, cleanupTempDir } from "../helpers/temp-dir.js";
import { createToolDefinitions } from "../../tools/index.js";

const CTX = { toolCallId: "1", messages: [] as any[] };

describe("ls tool", () => {
  let dir: string;
  let tools: ReturnType<typeof createToolDefinitions>;

  beforeEach(() => {
    dir = createTempDir("wm-ls-");
    tools = createToolDefinitions(dir);
    fs.writeFileSync(path.join(dir, "root.txt"), "hello");
    fs.mkdirSync(path.join(dir, "sub"));
    fs.writeFileSync(path.join(dir, "sub", "child.txt"), "world");
    fs.mkdirSync(path.join(dir, "sub", "deep"));
    fs.writeFileSync(path.join(dir, "sub", "deep", "leaf.txt"), "!");
  });

  afterEach(() => cleanupTempDir(dir));

  it("lists directory tree", async () => {
    const result = await tools.ls.execute({ path: "." }, CTX);
    expect(result).toContain("root.txt");
    expect(result).toContain("sub/");
    expect(result).toContain("child.txt");
    expect(result).toMatch(/\d+ files, \d+ director/);
  });

  it("respects maxDepth", async () => {
    const result = await tools.ls.execute({ path: ".", maxDepth: 1 }, CTX);
    expect(result).toContain("root.txt");
    expect(result).toContain("sub/");
    // child.txt is depth 1 (inside sub), but leaf.txt is depth 2 (sub/deep)
    expect(result).toContain("child.txt");
    expect(result).not.toContain("leaf.txt");
  });
});

import fs from "fs";
import path from "path";
import { createTempDir, cleanupTempDir } from "../helpers/temp-dir.js";
import { createToolDefinitions } from "../../tools/index.js";

const CTX = { toolCallId: "1", messages: [] as any[] };

describe("glob tool", () => {
  let dir: string;
  let tools: ReturnType<typeof createToolDefinitions>;

  beforeEach(() => {
    dir = createTempDir("wm-glob-");
    tools = createToolDefinitions(dir);
    // Create test file structure
    fs.writeFileSync(path.join(dir, "a.ts"), "");
    fs.writeFileSync(path.join(dir, "b.ts"), "");
    fs.writeFileSync(path.join(dir, "c.js"), "");
    fs.mkdirSync(path.join(dir, "sub"));
    fs.writeFileSync(path.join(dir, "sub", "d.ts"), "");
    fs.writeFileSync(path.join(dir, "sub", "e.js"), "");
  });

  afterEach(() => cleanupTempDir(dir));

  it("matches *.ts in current directory", async () => {
    const result = await tools.glob.execute({ pattern: "*.ts" }, CTX);
    expect(result).toContain("a.ts");
    expect(result).toContain("b.ts");
    expect(result).not.toContain("c.js");
    // *.ts should not match nested files
    expect(result).not.toContain("d.ts");
  });

  it("matches **/*.ts recursively", async () => {
    const result = await tools.glob.execute({ pattern: "**/*.ts" }, CTX);
    expect(result).toContain("a.ts");
    expect(result).toContain("b.ts");
    expect(result).toContain("d.ts");
    expect(result).not.toContain("c.js");
  });

  it("returns empty result message", async () => {
    const result = await tools.glob.execute({ pattern: "*.xyz" }, CTX);
    expect(result).toContain("No files found");
  });
});

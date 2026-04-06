import { createTempDir, cleanupTempDir } from "../helpers/temp-dir.js";
import { createToolDefinitions } from "../../tools/index.js";

const CTX = { toolCallId: "1", messages: [] as any[] };

describe("bash tool", () => {
  let dir: string;
  let tools: ReturnType<typeof createToolDefinitions>;

  beforeEach(() => {
    dir = createTempDir("wm-bash-");
    tools = createToolDefinitions(dir);
  });

  afterEach(() => cleanupTempDir(dir));

  it("captures stdout", async () => {
    const result = await tools.bash.execute({ command: "echo hello" }, CTX);
    expect(result).toBe("hello");
  });

  it("returns stderr on failure", async () => {
    const result = await tools.bash.execute({ command: "cat nonexistent_file_xyz" }, CTX);
    expect(result).toContain("Error");
  });

  it("uses working directory", async () => {
    const result = await tools.bash.execute({ command: "pwd" }, CTX);
    expect(result).toContain(dir);
  });

  it("handles non-zero exit code", async () => {
    const result = await tools.bash.execute({ command: "exit 42" }, CTX);
    expect(result).toContain("Error");
  });

  it("falls back gracefully when os sandbox dependencies are unavailable", async () => {
    const osTools = createToolDefinitions(dir, undefined, "os");
    const result = await osTools.bash.execute({ command: "echo fallback-ok" }, CTX);
    expect(result).toContain("fallback-ok");
  });
});

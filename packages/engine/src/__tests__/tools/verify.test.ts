import { createTempDir, cleanupTempDir } from "../helpers/temp-dir.js";
import { createToolDefinitions } from "../../tools/index.js";

const CTX = { toolCallId: "1", messages: [] as any[] };

describe("verify tool", () => {
  let dir: string;
  let tools: ReturnType<typeof createToolDefinitions>;

  beforeEach(() => {
    dir = createTempDir("wm-verify-");
    tools = createToolDefinitions(dir);
  });

  afterEach(() => cleanupTempDir(dir));

  it("reports passing command", async () => {
    const result = await tools.verify.execute({ command: "echo ok" }, CTX);
    expect(result).toContain("PASSED");
    expect(result).toContain("exit code 0");
  });

  it("reports failing command", async () => {
    const result = await tools.verify.execute({ command: "exit 1" }, CTX);
    expect(result).toContain("FAILED");
  });
});

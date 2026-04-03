import { createTempDir, cleanupTempDir } from "../helpers/temp-dir.js";
import { createToolDefinitions } from "../../tools/index.js";

describe("createToolDefinitions", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTempDir("wm-index-");
  });

  afterEach(() => cleanupTempDir(dir));

  it("returns all base tools without a model", () => {
    const tools = createToolDefinitions(dir);
    const keys = Object.keys(tools);
    expect(keys).toContain("bash");
    expect(keys).toContain("read_file");
    expect(keys).toContain("write_file");
    expect(keys).toContain("edit_file");
    expect(keys).toContain("glob");
    expect(keys).toContain("grep");
    expect(keys).toContain("ls");
    expect(keys).toContain("fetch");
    expect(keys).toContain("patch");
    expect(keys).toContain("web_search");
    expect(keys).toContain("todo");
    expect(keys).toContain("verify");
    expect(keys).toContain("lsp");
    expect(keys).not.toContain("sub_agent");
    // Base tools count (no sub_agent without model)
    const baseCount = keys.length;
    expect(baseCount).toBeGreaterThanOrEqual(13);
  });

  it("includes sub_agent when model is provided", () => {
    const fakeModel = {} as any;
    const tools = createToolDefinitions(dir, fakeModel);
    const keys = Object.keys(tools);
    expect(keys).toContain("sub_agent");
    expect(keys.length).toBeGreaterThan(14);
  });

  it("does not include sub_agent without model", () => {
    const tools = createToolDefinitions(dir);
    expect(Object.keys(tools)).not.toContain("sub_agent");
  });
});

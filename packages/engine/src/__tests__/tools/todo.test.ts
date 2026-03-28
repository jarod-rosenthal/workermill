import { createTempDir, cleanupTempDir } from "../helpers/temp-dir.js";
import { createToolDefinitions } from "../../tools/index.js";

const CTX = { toolCallId: "1", messages: [] as any[] };

describe("todo tool", () => {
  let dir: string;
  let tools: ReturnType<typeof createToolDefinitions>;

  beforeEach(() => {
    dir = createTempDir("wm-todo-");
    tools = createToolDefinitions(dir);
    // Clear state between tests
    tools.todo.execute({ action: "clear" }, CTX);
  });

  afterEach(() => cleanupTempDir(dir));

  it("adds a todo and returns it", async () => {
    const result = await tools.todo.execute({ action: "add", text: "Write tests" }, CTX);
    expect(result).toContain("pending");
    expect(result).toContain("Write tests");
  });

  it("lists todos", async () => {
    await tools.todo.execute({ action: "add", text: "Item 1" }, CTX);
    await tools.todo.execute({ action: "add", text: "Item 2" }, CTX);
    const result = await tools.todo.execute({ action: "list" }, CTX);
    expect(result).toContain("Item 1");
    expect(result).toContain("Item 2");
    expect(result).toContain("0/2 completed");
  });

  it("clears all todos", async () => {
    await tools.todo.execute({ action: "add", text: "temp" }, CTX);
    await tools.todo.execute({ action: "clear" }, CTX);
    const result = await tools.todo.execute({ action: "list" }, CTX);
    expect(result).toBe("No todos");
  });
});

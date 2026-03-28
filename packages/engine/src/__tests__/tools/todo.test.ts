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

  describe("update action", () => {
    it("updates status to in_progress", async () => {
      const added = await tools.todo.execute({ action: "add", text: "Task A" }, CTX);
      // Extract the todo ID from the output: "[pending] todo-N: Task A"
      const idMatch = added.match(/todo-\d+/);
      expect(idMatch).not.toBeNull();
      const id = idMatch![0];

      const result = await tools.todo.execute({ action: "update", id, status: "in_progress" }, CTX);
      expect(result).toContain("in_progress");
      expect(result).toContain(id);
    });

    it("updates status to completed", async () => {
      const added = await tools.todo.execute({ action: "add", text: "Task B" }, CTX);
      const id = added.match(/todo-\d+/)![0];

      const result = await tools.todo.execute({ action: "update", id, status: "completed" }, CTX);
      expect(result).toContain("completed");
      expect(result).toContain(id);
    });

    it("updates text of existing todo", async () => {
      const added = await tools.todo.execute({ action: "add", text: "Old text" }, CTX);
      const id = added.match(/todo-\d+/)![0];

      const result = await tools.todo.execute({ action: "update", id, text: "New text" }, CTX);
      expect(result).toContain("New text");
      expect(result).not.toContain("Old text");
    });

    it("updates both status and text", async () => {
      const added = await tools.todo.execute({ action: "add", text: "Original" }, CTX);
      const id = added.match(/todo-\d+/)![0];

      const result = await tools.todo.execute(
        { action: "update", id, status: "completed", text: "Done task" },
        CTX
      );
      expect(result).toContain("completed");
      expect(result).toContain("Done task");
    });

    it("returns error for nonexistent ID", async () => {
      const result = await tools.todo.execute(
        { action: "update", id: "todo-99999", status: "completed" },
        CTX
      );
      expect(result).toContain("not found");
    });

    it("returns error when ID is missing", async () => {
      const result = await tools.todo.execute({ action: "update", status: "completed" }, CTX);
      expect(result).toContain("required");
    });

    it("reflects updates in list", async () => {
      await tools.todo.execute({ action: "add", text: "First" }, CTX);
      const added = await tools.todo.execute({ action: "add", text: "Second" }, CTX);
      const id = added.match(/todo-\d+/)![0];

      await tools.todo.execute({ action: "update", id, status: "completed" }, CTX);

      const list = await tools.todo.execute({ action: "list" }, CTX);
      expect(list).toContain("1/2 completed");
      expect(list).toContain("1 remaining");
    });
  });
});

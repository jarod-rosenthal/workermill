/**
 * Todo/Task Tracking Tool
 *
 * In-memory task list for tracking progress within a story.
 * Workers can create todos, mark them complete, and list status.
 * Similar to Claude Code's TaskCreate/TaskUpdate/TaskGet.
 */

export const description =
  "Track your progress within a task. Create todo items, mark them complete, and list status. Use this to stay organized on multi-step work.";

interface TodoItem {
  id: string;
  text: string;
  status: "pending" | "in_progress" | "completed";
  createdAt: string;
}

// In-memory store — resets each story execution
const todos: Map<string, TodoItem> = new Map();
let nextId = 1;

export interface TodoResult {
  success: boolean;
  items?: TodoItem[];
  item?: TodoItem;
  error?: string;
}

export async function execute(input: {
  action: "add" | "update" | "list" | "clear";
  text?: string;
  id?: string;
  status?: "pending" | "in_progress" | "completed";
}): Promise<TodoResult> {
  const { action, text, id, status } = input;

  switch (action) {
    case "add": {
      if (!text) return { success: false, error: "Text is required for adding a todo" };
      const todoId = `todo-${nextId++}`;
      const item: TodoItem = {
        id: todoId,
        text,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      todos.set(todoId, item);
      return { success: true, item };
    }

    case "update": {
      if (!id) return { success: false, error: "ID is required for updating a todo" };
      const existing = todos.get(id);
      if (!existing) return { success: false, error: `Todo not found: ${id}` };
      if (status) existing.status = status;
      if (text) existing.text = text;
      return { success: true, item: existing };
    }

    case "list": {
      const items = Array.from(todos.values());
      return { success: true, items };
    }

    case "clear": {
      todos.clear();
      nextId = 1;
      return { success: true, items: [] };
    }

    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}

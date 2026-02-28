/**
 * LocalBackend — Standalone mode implementation of AgentBackend.
 *
 * All data in local SQLite. Real-time events via in-process EventEmitter.
 * No cloud API dependency. Workers POST to agent local API on localhost.
 */

import type {
  AgentBackend,
  StreamEvent,
  TaskInfo,
  CreateTaskInput,
  TaskResult,
  LogEntry,
  CoordinationMessage,
  BlockerResponse,
  CodeEvent,
  Board,
  BoardColumn,
  Card,
  CreateBoardInput,
  CreateCardInput,
  PrdInput,
  RepoInfo,
  AgentSettings,
  BackfillResponse,
  ClaimResult,
} from "../types.js";
import { getDb, closeDb, generateId } from "./db.js";
import {
  emitStreamEvent,
  onStreamEvent,
  offStreamEvent,
} from "./event-bus.js";
import {
  loadStandaloneConfig,
  saveStandaloneConfig,
} from "./config.js";

export class LocalBackend implements AgentBackend {
  readonly mode = "local" as const;

  async initialize(): Promise<void> {
    // Opens database connection and runs schema
    getDb();
  }

  async shutdown(): Promise<void> {
    closeDb();
  }

  // ── Stream Events ──

  onStreamEvent(handler: (event: StreamEvent) => void): void {
    onStreamEvent(handler);
  }

  offStreamEvent(handler: (event: StreamEvent) => void): void {
    offStreamEvent(handler);
  }

  // ── Tasks ──

  async getTasks(): Promise<TaskInfo[]> {
    const rows = getDb()
      .prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT 100")
      .all() as any[];
    return rows.map(rowToTask);
  }

  async getTask(id: string): Promise<TaskInfo | null> {
    const row = getDb()
      .prepare("SELECT * FROM tasks WHERE id = ?")
      .get(id) as any;
    return row ? rowToTask(row) : null;
  }

  async createTask(input: CreateTaskInput): Promise<TaskInfo> {
    const id = generateId();
    const now = new Date().toISOString();

    getDb()
      .prepare(
        `
      INSERT INTO tasks (id, summary, description, github_repo, scm_provider, worker_model, board_id, card_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
    `,
      )
      .run(
        id,
        input.summary,
        input.description || null,
        input.githubRepo || null,
        input.scmProvider || null,
        input.workerModel || null,
        input.boardId || null,
        input.cardId || null,
        now,
        now,
      );

    // Link card to task
    if (input.cardId) {
      getDb()
        .prepare("UPDATE cards SET task_id = ? WHERE id = ?")
        .run(id, input.cardId);
    }

    const task = await this.getTask(id);
    emitStreamEvent("org:local:tasks", "task_state", {
      taskId: id,
      status: "queued",
    });
    return task!;
  }

  async cancelTask(id: string): Promise<void> {
    const result = getDb()
      .prepare(
        "UPDATE tasks SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND status IN ('queued', 'executing', 'planning')",
      )
      .run(id);
    if (result.changes > 0) {
      emitStreamEvent("org:local:tasks", "task_state", {
        taskId: id,
        status: "cancelled",
      });
    }
  }

  async retryTask(id: string): Promise<void> {
    const task = await this.getTask(id);
    if (!task) return;
    getDb()
      .prepare(
        "UPDATE tasks SET status = 'queued', started_at = NULL, completed_at = NULL, updated_at = datetime('now') WHERE id = ?",
      )
      .run(id);
    emitStreamEvent("org:local:tasks", "task_state", {
      taskId: id,
      status: "queued",
    });
  }

  // ── Task Execution Lifecycle ──

  async claimTask(taskId: string): Promise<ClaimResult> {
    const result = getDb()
      .prepare(
        "UPDATE tasks SET status = 'executing', started_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'queued'",
      )
      .run(taskId);

    if (result.changes === 0) {
      return { claimed: false };
    }

    const task = await this.getTask(taskId);
    const config = loadStandaloneConfig();

    return {
      claimed: true,
      task: task!,
      credentials: {
        scmToken: config.scm?.token || "",
        anthropicApiKey: config.llm?.apiKey || "",
      },
    };
  }

  async reportTaskStarted(taskId: string): Promise<void> {
    getDb()
      .prepare(
        "UPDATE tasks SET status = 'executing', started_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      )
      .run(taskId);
    emitStreamEvent("org:local:tasks", "task_state", {
      taskId,
      status: "executing",
    });
  }

  async reportTaskCompleted(
    taskId: string,
    result: TaskResult,
  ): Promise<void> {
    getDb()
      .prepare(
        "UPDATE tasks SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      )
      .run(taskId);
    emitStreamEvent("org:local:tasks", "task_state", {
      taskId,
      status: "completed",
      ...result,
    });
  }

  async reportTaskFailed(taskId: string, error: string): Promise<void> {
    getDb()
      .prepare(
        "UPDATE tasks SET status = 'failed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      )
      .run(taskId);
    await this.postLog({
      taskId,
      message: `Task failed: ${error}`,
      severity: "error",
    });
    emitStreamEvent("org:local:tasks", "task_state", {
      taskId,
      status: "failed",
      error,
    });
  }

  // ── Logging ──

  async postLog(entry: LogEntry): Promise<void> {
    getDb()
      .prepare(
        "INSERT INTO task_logs (task_id, type, message, severity) VALUES (?, ?, ?, ?)",
      )
      .run(
        entry.taskId,
        entry.type || "execution",
        entry.message,
        entry.severity || "info",
      );

    emitStreamEvent(`logs:${entry.taskId}`, "log", {
      taskId: entry.taskId,
      type: entry.type || "execution",
      message: entry.message,
      severity: entry.severity || "info",
      createdAt: new Date().toISOString(),
    });
  }

  // ── Coordination ──

  async postCoordinationMessage(msg: CoordinationMessage): Promise<void> {
    getDb()
      .prepare(
        "INSERT INTO coordination_messages (parent_task_id, task_id, message_type, content) VALUES (?, ?, ?, ?)",
      )
      .run(
        msg.parentTaskId,
        msg.taskId || null,
        msg.messageType,
        JSON.stringify(msg.content),
      );

    emitStreamEvent(
      `coordination:${msg.parentTaskId}`,
      msg.messageType,
      msg,
    );
  }

  async getCoordinationContext(
    taskId: string,
  ): Promise<CoordinationMessage[]> {
    const rows = getDb()
      .prepare(
        "SELECT * FROM coordination_messages WHERE parent_task_id = ? ORDER BY created_at ASC LIMIT 200",
      )
      .all(taskId) as any[];

    return rows.map((r: any) => ({
      parentTaskId: r.parent_task_id,
      taskId: r.task_id,
      messageType: r.message_type,
      content: JSON.parse(r.content),
    }));
  }

  async talkToWorker(taskId: string, message: string): Promise<void> {
    await this.postCoordinationMessage({
      parentTaskId: taskId,
      messageType: "user_message",
      content: { message },
    });
  }

  async respondToBlocker(
    taskId: string,
    response: BlockerResponse,
  ): Promise<void> {
    await this.postCoordinationMessage({
      parentTaskId: taskId,
      messageType: "blocker_response",
      content: response,
    });
  }

  // ── Code Events ──

  async postCodeEvent(event: CodeEvent): Promise<void> {
    getDb()
      .prepare(
        "INSERT INTO code_events (task_id, file_path, tool_name, expert, metadata) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        event.taskId,
        event.filePath,
        event.toolName,
        event.expert || null,
        event.metadata ? JSON.stringify(event.metadata) : null,
      );

    emitStreamEvent(`code:${event.taskId}`, "code_event", event);
  }

  // ── Backfill ──

  async getLogBackfill(
    taskId: string,
    since?: string,
    limit?: number,
  ): Promise<BackfillResponse> {
    const lim = limit || 500;
    let rows: any[];
    if (since) {
      rows = getDb()
        .prepare(
          "SELECT * FROM task_logs WHERE task_id = ? AND created_at > ? ORDER BY created_at ASC LIMIT ?",
        )
        .all(taskId, since, lim) as any[];
    } else {
      rows = getDb()
        .prepare(
          "SELECT * FROM task_logs WHERE task_id = ? ORDER BY created_at ASC LIMIT ?",
        )
        .all(taskId, lim) as any[];
    }

    return {
      data: rows.map((r: any) => ({
        id: r.id,
        taskId: r.task_id,
        type: r.type,
        message: r.message,
        severity: r.severity,
        createdAt: r.created_at,
      })),
      cursor:
        rows.length > 0 ? rows[rows.length - 1].created_at : null,
    };
  }

  async getCoordinationBackfill(
    taskId: string,
    since?: string,
    limit?: number,
  ): Promise<BackfillResponse> {
    const lim = limit || 200;
    let rows: any[];
    if (since) {
      rows = getDb()
        .prepare(
          "SELECT * FROM coordination_messages WHERE parent_task_id = ? AND created_at > ? ORDER BY created_at ASC LIMIT ?",
        )
        .all(taskId, since, lim) as any[];
    } else {
      rows = getDb()
        .prepare(
          "SELECT * FROM coordination_messages WHERE parent_task_id = ? ORDER BY created_at ASC LIMIT ?",
        )
        .all(taskId, lim) as any[];
    }

    return {
      data: rows.map((r: any) => ({
        parentTaskId: r.parent_task_id,
        taskId: r.task_id,
        messageType: r.message_type,
        content: JSON.parse(r.content),
        createdAt: r.created_at,
      })),
      cursor:
        rows.length > 0 ? rows[rows.length - 1].created_at : null,
    };
  }

  async getCodeBackfill(
    taskId: string,
    since?: string,
  ): Promise<BackfillResponse> {
    let rows: any[];
    if (since) {
      rows = getDb()
        .prepare(
          "SELECT * FROM code_events WHERE task_id = ? AND created_at > ? ORDER BY created_at ASC",
        )
        .all(taskId, since) as any[];
    } else {
      rows = getDb()
        .prepare(
          "SELECT * FROM code_events WHERE task_id = ? ORDER BY created_at ASC",
        )
        .all(taskId) as any[];
    }

    return {
      data: rows.map((r: any) => ({
        taskId: r.task_id,
        filePath: r.file_path,
        toolName: r.tool_name,
        expert: r.expert,
        metadata: r.metadata ? JSON.parse(r.metadata) : null,
        createdAt: r.created_at,
      })),
      cursor:
        rows.length > 0 ? rows[rows.length - 1].created_at : null,
    };
  }

  // ── Boards ──

  async getBoards(): Promise<Board[]> {
    const rows = getDb()
      .prepare("SELECT * FROM boards ORDER BY created_at DESC")
      .all() as any[];
    const boards: Board[] = [];
    for (const row of rows) {
      const columns = getDb()
        .prepare(
          "SELECT * FROM board_columns WHERE board_id = ? ORDER BY position ASC",
        )
        .all(row.id) as any[];
      boards.push(rowToBoard(row, columns));
    }
    return boards;
  }

  async getBoard(id: string): Promise<Board | null> {
    const row = getDb()
      .prepare("SELECT * FROM boards WHERE id = ?")
      .get(id) as any;
    if (!row) return null;
    const columns = getDb()
      .prepare(
        "SELECT * FROM board_columns WHERE board_id = ? ORDER BY position ASC",
      )
      .all(id) as any[];
    return rowToBoard(row, columns);
  }

  async createBoard(input: CreateBoardInput): Promise<Board> {
    const id = generateId();
    const now = new Date().toISOString();

    getDb()
      .prepare(
        "INSERT INTO boards (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, input.name, input.description || null, now, now);

    // Create default columns
    const defaultColumns = [
      { name: "Backlog", position: 0, isDone: 0 },
      { name: "In Progress", position: 1, isDone: 0 },
      { name: "Done", position: 2, isDone: 1 },
    ];
    for (const col of defaultColumns) {
      const colId = generateId();
      getDb()
        .prepare(
          "INSERT INTO board_columns (id, board_id, name, position, is_done_column) VALUES (?, ?, ?, ?, ?)",
        )
        .run(colId, id, col.name, col.position, col.isDone);
    }

    return (await this.getBoard(id))!;
  }

  async deleteBoard(id: string): Promise<void> {
    getDb().prepare("DELETE FROM boards WHERE id = ?").run(id);
  }

  async getBoardCards(boardId: string): Promise<Card[]> {
    const rows = getDb()
      .prepare(
        "SELECT * FROM cards WHERE board_id = ? ORDER BY position ASC",
      )
      .all(boardId) as any[];
    return rows.map(rowToCard);
  }

  async createCard(
    boardId: string,
    input: CreateCardInput,
  ): Promise<Card> {
    const id = generateId();
    const now = new Date().toISOString();

    // Auto-increment card_number per board
    const maxRow = getDb()
      .prepare(
        "SELECT MAX(card_number) as max_num FROM cards WHERE board_id = ?",
      )
      .get(boardId) as any;
    const cardNumber = (maxRow?.max_num || 0) + 1;

    getDb()
      .prepare(
        `
      INSERT INTO cards (id, board_id, column_id, card_number, title, description, priority, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        id,
        boardId,
        input.columnId,
        cardNumber,
        input.title,
        input.description || null,
        input.priority || "medium",
        input.position || 0,
        now,
        now,
      );

    return rowToCard(
      getDb().prepare("SELECT * FROM cards WHERE id = ?").get(id) as any,
    );
  }

  async updateCard(
    cardId: string,
    input: Partial<Card>,
  ): Promise<Card> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (input.title !== undefined) {
      sets.push("title = ?");
      values.push(input.title);
    }
    if (input.description !== undefined) {
      sets.push("description = ?");
      values.push(input.description);
    }
    if (input.priority !== undefined) {
      sets.push("priority = ?");
      values.push(input.priority);
    }
    if (input.columnId !== undefined) {
      sets.push("column_id = ?");
      values.push(input.columnId);
    }
    if (input.position !== undefined) {
      sets.push("position = ?");
      values.push(input.position);
    }
    if (input.taskId !== undefined) {
      sets.push("task_id = ?");
      values.push(input.taskId);
    }

    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      values.push(cardId);
      getDb()
        .prepare(
          `UPDATE cards SET ${sets.join(", ")} WHERE id = ?`,
        )
        .run(...values);
    }

    return rowToCard(
      getDb()
        .prepare("SELECT * FROM cards WHERE id = ?")
        .get(cardId) as any,
    );
  }

  async moveCard(
    cardId: string,
    columnId: string,
    position: number,
  ): Promise<void> {
    getDb()
      .prepare(
        "UPDATE cards SET column_id = ?, position = ?, updated_at = datetime('now') WHERE id = ?",
      )
      .run(columnId, position, cardId);
  }

  async runCard(boardId: string, cardId: string): Promise<TaskInfo> {
    const card = getDb()
      .prepare("SELECT * FROM cards WHERE id = ?")
      .get(cardId) as any;
    if (!card) throw new Error("Card not found");

    const config = loadStandaloneConfig();
    return this.createTask({
      summary: card.title,
      description: card.description,
      githubRepo: config.defaultRepo,
      scmProvider: config.scm?.provider,
      workerModel: config.llm?.model,
      boardId,
      cardId,
    });
  }

  async runAllCards(boardId: string): Promise<void> {
    // Get all cards in the first column (backlog) that don't have tasks
    const board = await this.getBoard(boardId);
    if (!board || board.columns.length === 0) return;

    const backlogCol = board.columns[0];
    const cards = getDb()
      .prepare(
        "SELECT * FROM cards WHERE board_id = ? AND column_id = ? AND task_id IS NULL ORDER BY position ASC",
      )
      .all(boardId, backlogCol.id) as any[];

    for (const card of cards) {
      await this.runCard(boardId, card.id);
    }
  }

  // ── Config ──

  async getSettings(): Promise<AgentSettings> {
    const config = loadStandaloneConfig();
    return {
      mode: config.mode,
      llmProvider: config.llm?.provider,
      llmModel: config.llm?.model,
      scmProvider: config.scm?.provider,
      defaultRepo: config.defaultRepo,
      maxParallelExperts: config.settings?.maxParallelExperts ?? 4,
      maxStories: config.settings?.maxStories ?? 8,
    };
  }

  async updateSettings(input: Partial<AgentSettings>): Promise<void> {
    const config = loadStandaloneConfig();
    if (input.llmProvider && config.llm)
      config.llm.provider = input.llmProvider;
    if (input.llmModel && config.llm)
      config.llm.model = input.llmModel;
    if (input.scmProvider && config.scm)
      config.scm.provider = input.scmProvider;
    if (input.defaultRepo !== undefined)
      config.defaultRepo = input.defaultRepo;
    if (input.maxParallelExperts !== undefined) {
      if (!config.settings) config.settings = {};
      config.settings.maxParallelExperts = input.maxParallelExperts;
    }
    if (input.maxStories !== undefined) {
      if (!config.settings) config.settings = {};
      config.settings.maxStories = input.maxStories;
    }
    saveStandaloneConfig(config);
  }

  async getRepos(): Promise<RepoInfo[]> {
    const config = loadStandaloneConfig();
    if (!config.defaultRepo) return [];
    return [{ url: config.defaultRepo, isDefault: true }];
  }

  // ── Plan approval (local — auto-approve) ──

  async approvePlan(taskId: string): Promise<void> {
    await this.postCoordinationMessage({
      parentTaskId: taskId,
      messageType: "plan_approved",
      content: { approved: true },
    });
  }

  async rejectPlan(taskId: string, feedback: string): Promise<void> {
    await this.postCoordinationMessage({
      parentTaskId: taskId,
      messageType: "plan_rejected",
      content: { feedback },
    });
  }

  // ── PRD ──

  async getPrdPrompt(): Promise<string> {
    // Return the bundled PRD system prompt (same as local-api.ts fallback)
    const { PRD_SYSTEM_PROMPT } = await import("../../local-api.js");
    return PRD_SYSTEM_PROMPT;
  }

  async decomposePrd(
    input: PrdInput,
    onProgress?: (msg: string) => void,
  ): Promise<Board> {
    const config = loadStandaloneConfig();

    // Reuse the existing decomposePrdLocal function from local-api.ts
    const { decomposePrdLocal } = await import("../../local-api.js");

    const planningConfig = {
      provider: config.llm?.provider || "anthropic",
      model: config.llm?.model || "claude-sonnet-4-20250514",
      apiKey: config.llm?.apiKey,
    };

    const result = await decomposePrdLocal(
      input.content,
      planningConfig,
      undefined,
      onProgress,
    );

    // Create board from decomposition result
    const boardId = generateId();
    const now = new Date().toISOString();
    const db = getDb();

    db.prepare(
      "INSERT INTO boards (id, name, description, quality_gate_commands, ci_workflow_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      boardId,
      result.boardName,
      `Generated from PRD`,
      (result as any).qualityGates
        ? JSON.stringify((result as any).qualityGates)
        : null,
      (result as any).ciWorkflowPath || null,
      now,
      now,
    );

    // Create columns
    const colBacklog = generateId();
    const colInProgress = generateId();
    const colDone = generateId();
    db.prepare(
      "INSERT INTO board_columns (id, board_id, name, position, is_done_column) VALUES (?, ?, ?, ?, ?)",
    ).run(colBacklog, boardId, "Backlog", 0, 0);
    db.prepare(
      "INSERT INTO board_columns (id, board_id, name, position, is_done_column) VALUES (?, ?, ?, ?, ?)",
    ).run(colInProgress, boardId, "In Progress", 1, 0);
    db.prepare(
      "INSERT INTO board_columns (id, board_id, name, position, is_done_column) VALUES (?, ?, ?, ?, ?)",
    ).run(colDone, boardId, "Done", 2, 1);

    // Create cards
    const cardIds: string[] = [];
    for (let i = 0; i < result.cards.length; i++) {
      const card = result.cards[i] as any;
      const cardId = generateId();
      cardIds.push(cardId);

      db.prepare(
        `
        INSERT INTO cards (id, board_id, column_id, card_number, title, description, priority, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        cardId,
        boardId,
        colBacklog,
        i + 1,
        card.title,
        card.description,
        card.priority || "medium",
        i,
        now,
        now,
      );
    }

    // Create dependencies
    for (let i = 0; i < result.cards.length; i++) {
      const card = result.cards[i] as any;
      if (Array.isArray(card.dependencyIndices)) {
        for (const depIdx of card.dependencyIndices) {
          if (depIdx >= 0 && depIdx < cardIds.length) {
            const depId = generateId();
            db.prepare(
              "INSERT INTO card_dependencies (id, card_id, depends_on_card_id) VALUES (?, ?, ?)",
            ).run(depId, cardIds[i], cardIds[depIdx]);
          }
        }
      }
    }

    onProgress?.(
      `Board "${result.boardName}" created with ${result.cards.length} cards`,
    );

    return (await this.getBoard(boardId))!;
  }
}

// ── Row Mappers ──

function rowToTask(row: any): TaskInfo {
  return {
    id: row.id,
    parentTaskId: row.parent_task_id || undefined,
    boardId: row.board_id || undefined,
    cardId: row.card_id || undefined,
    summary: row.summary,
    description: row.description || undefined,
    status: row.status,
    executionPlan: row.execution_plan
      ? JSON.parse(row.execution_plan)
      : undefined,
    githubRepo: row.github_repo || undefined,
    scmProvider: row.scm_provider || undefined,
    workerModel: row.worker_model || undefined,
    workerProvider: row.worker_provider || undefined,
    workerPersona: row.worker_persona || undefined,
    expertIndex: row.expert_index ?? undefined,
    totalExperts: row.total_experts ?? undefined,
    workerPid: row.worker_pid ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at || undefined,
    completedAt: row.completed_at || undefined,
  };
}

function rowToBoard(row: any, columnRows: any[]): Board {
  return {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    qualityGateCommands: row.quality_gate_commands
      ? JSON.parse(row.quality_gate_commands)
      : undefined,
    ciWorkflowPath: row.ci_workflow_path || undefined,
    columns: columnRows.map(rowToColumn),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToColumn(row: any): BoardColumn {
  return {
    id: row.id,
    boardId: row.board_id,
    name: row.name,
    position: row.position,
    isDoneColumn: row.is_done_column === 1,
  };
}

function rowToCard(row: any): Card {
  return {
    id: row.id,
    boardId: row.board_id,
    columnId: row.column_id,
    cardNumber: row.card_number ?? undefined,
    title: row.title,
    description: row.description || undefined,
    priority: row.priority || "medium",
    position: row.position,
    taskId: row.task_id || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

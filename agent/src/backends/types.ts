/**
 * AgentBackend Interface
 *
 * Abstracts all data access for the agent. Two implementations:
 * - CloudBackend: wraps existing api.ts + poller.ts (premium users)
 * - LocalBackend: SQLite + EventEmitter (standalone/open-source)
 *
 * The VS Code extension doesn't know or care which backend is active —
 * it talks to the agent local API, which delegates to the active backend.
 */

// ── Stream Events (SSE multiplexer wire format) ──────────

/** Real-time event delivered via SSE or EventEmitter. */
export interface StreamEvent {
  /** Channel name, e.g. "logs:{taskId}", "coordination:{taskId}", "org:{orgId}:tasks" */
  ch: string;
  /** Event type within channel, e.g. "log", "task_state", "code_event" */
  t: string;
  /** Payload — shape depends on channel and event type */
  p: unknown;
}

// ── Data Types ───────────────────────────────────────────

export interface TaskInfo {
  id: string;
  parentTaskId?: string;
  boardId?: string;
  cardId?: string;
  summary: string;
  description?: string;
  status: "queued" | "planning" | "executing" | "completed" | "failed" | "cancelled";
  executionPlan?: unknown;
  githubRepo?: string;
  scmProvider?: string;
  workerModel?: string;
  workerProvider?: string;
  workerPersona?: string;
  expertIndex?: number;
  totalExperts?: number;
  workerPid?: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface CreateTaskInput {
  summary: string;
  description?: string;
  githubRepo?: string;
  scmProvider?: string;
  workerModel?: string;
  boardId?: string;
  cardId?: string;
}

export interface TaskResult {
  exitCode: number;
  prUrl?: string;
  prNumber?: number;
  error?: string;
}

export interface LogEntry {
  taskId: string;
  type?: string;
  message: string;
  severity?: "info" | "warn" | "error";
}

export interface CoordinationMessage {
  parentTaskId: string;
  taskId?: string;
  messageType: string;
  content: unknown;
}

export interface BlockerResponse {
  blockerId: string;
  action: "retry" | "skip" | "abort";
  guidance?: string;
}

export interface CodeEvent {
  taskId: string;
  filePath: string;
  toolName: "Write" | "Edit";
  expert?: string;
  metadata?: Record<string, unknown>;
}

export interface Board {
  id: string;
  name: string;
  description?: string;
  qualityGateCommands?: unknown;
  ciWorkflowPath?: string;
  columns: BoardColumn[];
  createdAt: string;
  updatedAt: string;
}

export interface BoardColumn {
  id: string;
  boardId: string;
  name: string;
  position: number;
  isDoneColumn: boolean;
}

export interface Card {
  id: string;
  boardId: string;
  columnId: string;
  cardNumber?: number;
  title: string;
  description?: string;
  priority: "urgent" | "high" | "medium" | "low";
  position: number;
  taskId?: string;
  dependencyIndices?: number[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateBoardInput {
  name: string;
  description?: string;
}

export interface CreateCardInput {
  columnId: string;
  title: string;
  description?: string;
  priority?: string;
  position?: number;
  dependencyIndices?: number[];
}

export interface PrdInput {
  content: string;
  repo?: string;
  scmProvider?: string;
}

export interface RepoInfo {
  url: string;
  isDefault: boolean;
}

export interface AgentSettings {
  mode: "standalone" | "cloud";
  llmProvider?: string;
  llmModel?: string;
  scmProvider?: string;
  defaultRepo?: string;
  maxParallelExperts?: number;
  maxStories?: number;
}

export interface BackfillResponse {
  data: unknown[];
  cursor: string | null;
}

export interface ClaimResult {
  claimed: boolean;
  task?: TaskInfo;
  credentials?: Record<string, string>;
}

// ── Backend Interface ────────────────────────────────────

export interface AgentBackend {
  readonly mode: "cloud" | "local";

  /** Initialize backend (open DB, connect to API, etc.) */
  initialize(): Promise<void>;
  /** Graceful shutdown (close DB, disconnect, etc.) */
  shutdown(): Promise<void>;

  // ── Real-time stream ──
  onStreamEvent(handler: (event: StreamEvent) => void): void;
  offStreamEvent(handler: (event: StreamEvent) => void): void;

  // ── Tasks ──
  getTasks(): Promise<TaskInfo[]>;
  getTask(id: string): Promise<TaskInfo | null>;
  createTask(input: CreateTaskInput): Promise<TaskInfo>;
  cancelTask(id: string): Promise<void>;
  retryTask(id: string): Promise<void>;

  // ── Task execution lifecycle ──
  claimTask(taskId: string): Promise<ClaimResult>;
  reportTaskStarted(taskId: string): Promise<void>;
  reportTaskCompleted(taskId: string, result: TaskResult): Promise<void>;
  reportTaskFailed(taskId: string, error: string): Promise<void>;

  // ── Logging ──
  postLog(entry: LogEntry): Promise<void>;

  // ── Coordination ──
  postCoordinationMessage(msg: CoordinationMessage): Promise<void>;
  getCoordinationContext(taskId: string): Promise<CoordinationMessage[]>;
  talkToWorker(taskId: string, message: string): Promise<void>;
  respondToBlocker(taskId: string, response: BlockerResponse): Promise<void>;

  // ── Code events ──
  postCodeEvent(event: CodeEvent): Promise<void>;

  // ── Backfill ──
  getLogBackfill(taskId: string, since?: string, limit?: number): Promise<BackfillResponse>;
  getCoordinationBackfill(taskId: string, since?: string, limit?: number): Promise<BackfillResponse>;
  getCodeBackfill(taskId: string, since?: string): Promise<BackfillResponse>;

  // ── Planning (PRD) ──
  getPrdPrompt(): Promise<string>;
  decomposePrd(input: PrdInput, onProgress?: (msg: string) => void): Promise<Board>;

  // ── Boards ──
  getBoards(): Promise<Board[]>;
  getBoard(id: string): Promise<Board | null>;
  createBoard(input: CreateBoardInput): Promise<Board>;
  deleteBoard(id: string): Promise<void>;
  getBoardCards(boardId: string): Promise<Card[]>;
  createCard(boardId: string, input: CreateCardInput): Promise<Card>;
  updateCard(cardId: string, input: Partial<Card>): Promise<Card>;
  moveCard(cardId: string, columnId: string, position: number): Promise<void>;
  runCard(boardId: string, cardId: string): Promise<TaskInfo>;
  runAllCards(boardId: string): Promise<void>;

  // ── Config ──
  getSettings(): Promise<AgentSettings>;
  updateSettings(input: Partial<AgentSettings>): Promise<void>;
  getRepos(): Promise<RepoInfo[]>;

  // ── Plan approval ──
  approvePlan(taskId: string): Promise<void>;
  rejectPlan(taskId: string, feedback: string): Promise<void>;
}

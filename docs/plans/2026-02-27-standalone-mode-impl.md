# Standalone Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the WorkerMill agent binary fully operational without the cloud API — users bring their own LLM keys, data stays in local SQLite, premium features available by opting in to workermill.com.

**Architecture:** A `Backend` interface (`AgentBackend`) abstracts all data access. Two implementations: `CloudBackend` (wraps existing `api.ts` + `poller.ts` for premium users) and `LocalBackend` (SQLite via `bun:sqlite` + in-process EventEmitter for standalone). The agent's `local-api.ts` delegates to whichever backend is active. The VS Code extension is unchanged — it talks to the agent local API regardless.

**Tech Stack:** TypeScript, Bun (`bun:sqlite`), esbuild, EventEmitter, Commander.js (CLI), existing agent binary compilation pipeline.

**Design doc:** `docs/plans/2026-02-27-standalone-mode-design.md`

---

## Phase A: Build System + Backend Interface Foundation

### Task 1: Remove minification and mangling from agent build

**Files:**
- Modify: `agent/build.mjs:42-62`

**Context:** The build currently minifies and mangles all output bundles. For open source, this makes bug reports unreadable, hides bundled dependency licenses, and prevents users from reading the code. The standalone binary bundle (`entry.js`, line 143) already disables `mangleProps` due to SDK crashes — this change makes all bundles consistent.

**Step 1: Update the `shared` config in `build.mjs`**

Change lines 42-62 from:

```javascript
const shared = {
  platform: "node",
  target: "node20",
  format: "esm",
  bundle: true,
  minify: true,
  treeShaking: true,
  // Mangle all non-exported identifiers
  mangleProps: /_$/,
  // Keep Node builtins external (fs, path, child_process, etc.)
  packages: "external",
  // Banner to preserve shebang for CLI entry point
  legalComments: "none",
  sourcemap: false,
  // Drop console.debug calls (keep console.log/error/warn for user-facing output)
  drop: [],
  define: {
    __AGENT_VERSION__: JSON.stringify(pkg.version),
    __DOCKER_IMAGE_TAG__: JSON.stringify(pkg.version),
  },
};
```

To:

```javascript
const shared = {
  platform: "node",
  target: "node20",
  format: "esm",
  bundle: true,
  minify: false,
  treeShaking: true,
  packages: "external",
  legalComments: "eof",
  sourcemap: true,
  drop: [],
  define: {
    __AGENT_VERSION__: JSON.stringify(pkg.version),
    __DOCKER_IMAGE_TAG__: JSON.stringify(pkg.version),
  },
};
```

**Step 2: Update worker bundle banners (remove "minified" wording)**

In `build.mjs`, change these banner strings:
- Line 97: `"// WorkerMill Worker - minified"` → `"// WorkerMill Worker"`
- Line 106: `"// WorkerMill Manager - minified"` → `"// WorkerMill Manager"`
- Line 115: `"// WorkerMill Multi-Expert - minified"` → `"// WorkerMill Multi-Expert"`
- Line 124: `"// WorkerMill AI SDK Executor - minified"` → `"// WorkerMill AI SDK Executor"`

**Step 3: Remove `mangleProps: undefined` override on entry.js bundle**

Line 143 (`mangleProps: undefined`) is now redundant since `shared` no longer sets `mangleProps`. Remove that line from the entry.js build config.

**Step 4: Update the file header comment**

Change the file header (lines 1-10) to remove references to "minified, mangled":

```javascript
/**
 * esbuild bundler for @workermill/agent
 *
 * Produces single-file bundles for CLI and library entry points,
 * plus worker entry points (epic worker and manager worker).
 *
 * tsc runs first (via package.json "build" script) to generate dist/*.js,
 * then this script re-bundles those into output files and additionally
 * bundles worker code from ../worker/ into dist/worker.js and dist/manager-worker.js.
 */
```

**Step 5: Update final log message**

Line 181: `"✓ Agent bundled and minified"` → `"✓ Agent bundled"`

**Step 6: Verify the build works**

Run: `cd agent && npm run build`
Expected: Build succeeds, `dist/` contains unminified bundles with `.js.map` files alongside each `.js` file.

**Step 7: Verify bundle readability**

Run: `head -20 agent/dist/cli.js`
Expected: Readable JavaScript (not minified), first line is `#!/usr/bin/env node`.

**Step 8: Commit**

```bash
git add agent/build.mjs
git commit -m "build(agent): drop minification for open-source readability

Remove minify/mangleProps, enable sourcemaps and license preservation.
All bundles now produce readable output. Tree-shaking still active."
```

---

### Task 2: Create AgentBackend interface and shared types

**Files:**
- Create: `agent/src/backends/types.ts`

**Context:** This interface defines the contract between the agent local API and whichever backend is active (cloud or local). Every method here corresponds to something the VS Code extension already calls or the agent needs internally. The stream event format (`{ ch, t, p }`) matches the SSE multiplexer design doc (`docs/plans/2026-02-26-unified-sse-multiplexer-design.md`).

**Step 1: Create the types file**

Create `agent/src/backends/types.ts`:

```typescript
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
```

**Step 2: Verify TypeScript compiles**

Run: `cd agent && npx tsc --noEmit`
Expected: No errors from `backends/types.ts` (it's purely types/interfaces).

**Step 3: Commit**

```bash
git add agent/src/backends/types.ts
git commit -m "feat(agent): add AgentBackend interface and shared types

Defines the contract between agent local API and backend implementations.
SSE wire format matches unified multiplexer design ({ ch, t, p })."
```

---

### Task 3: Create SQLite database layer

**Files:**
- Create: `agent/src/backends/local/db.ts`

**Context:** This is the persistence layer for standalone mode. Uses Bun's built-in `bun:sqlite` (zero external deps). WAL mode enables concurrent reads while a single writer is active — important because workers POST to the agent API while the agent reads.

**Step 1: Create the database module**

Create `agent/src/backends/local/db.ts`:

```typescript
/**
 * SQLite Database Layer for Standalone Mode
 *
 * Uses Bun's built-in bun:sqlite (zero dependencies).
 * WAL mode for concurrent read/write from agent + worker processes.
 * Stored at ~/.workermill/data.db.
 */

import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// bun:sqlite is a Bun built-in — not an npm package.
// At runtime in Bun, this resolves. For tsc, we declare the module below.
// eslint-disable-next-line @typescript-eslint/no-var-requires
let Database: any;
let dbInstance: any = null;

const DATA_DIR = join(homedir(), ".workermill");
const DB_PATH = join(DATA_DIR, "data.db");

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_info (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Settings (key-value)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Boards (Kanban)
CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  description TEXT,
  quality_gate_commands TEXT,
  ci_workflow_path TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS board_columns (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  is_done_column INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  column_id TEXT NOT NULL REFERENCES board_columns(id),
  card_number INTEGER,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT DEFAULT 'medium',
  position INTEGER NOT NULL DEFAULT 0,
  task_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS card_dependencies (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  depends_on_card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE
);

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  board_id TEXT REFERENCES boards(id),
  card_id TEXT REFERENCES cards(id),
  summary TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  execution_plan TEXT,
  github_repo TEXT,
  scm_provider TEXT,
  worker_model TEXT,
  worker_provider TEXT,
  worker_persona TEXT,
  parent_task_id TEXT REFERENCES tasks(id),
  expert_index INTEGER,
  total_experts INTEGER,
  worker_pid INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT
);

-- Logs
CREATE TABLE IF NOT EXISTS task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  type TEXT NOT NULL DEFAULT 'execution',
  message TEXT NOT NULL,
  severity TEXT DEFAULT 'info',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_task_logs_task_id ON task_logs(task_id, created_at);

-- Coordination
CREATE TABLE IF NOT EXISTS coordination_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_task_id TEXT NOT NULL,
  task_id TEXT,
  message_type TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_coord_parent ON coordination_messages(parent_task_id, created_at);

-- Code events
CREATE TABLE IF NOT EXISTS code_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  file_path TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  expert TEXT,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_code_events_task ON code_events(task_id, created_at);
`;

/** Generate a random hex ID (same format as PostgreSQL UUIDs but shorter). */
export function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Get or create the singleton database instance. */
export function getDb(): any {
  if (dbInstance) return dbInstance;

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  // Dynamic import of bun:sqlite — this is a Bun built-in
  // In Node.js environments (dev/test), this will fail gracefully
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Database = require("bun:sqlite").Database;
  } catch {
    throw new Error(
      "bun:sqlite is not available. Standalone mode requires the Bun runtime. " +
      "Install the agent binary (which embeds Bun) or run via 'bun' instead of 'node'."
    );
  }

  dbInstance = new Database(DB_PATH);

  // Run schema — all CREATE IF NOT EXISTS, safe to re-run
  dbInstance.exec(SCHEMA_SQL);

  // Track schema version
  const existing = dbInstance.prepare("SELECT value FROM schema_info WHERE key = 'version'").get();
  if (!existing) {
    dbInstance.prepare("INSERT INTO schema_info (key, value) VALUES ('version', ?)").run(String(SCHEMA_VERSION));
  }

  return dbInstance;
}

/** Close the database connection. */
export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/** Get a setting value from the settings table. */
export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null;
  return row?.value ?? null;
}

/** Set a setting value in the settings table. */
export function setSetting(key: string, value: string): void {
  getDb().prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

/** Get a setting as integer with a default. */
export function getSettingInt(key: string, defaultValue: number): number {
  const val = getSetting(key);
  if (val === null) return defaultValue;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/** Get the database file path (for diagnostics). */
export function getDbPath(): string {
  return DB_PATH;
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd agent && npx tsc --noEmit`
Expected: Compiles without errors. The `bun:sqlite` import is dynamic (`require()`), so tsc won't try to resolve it.

**Step 3: Commit**

```bash
git add agent/src/backends/local/db.ts
git commit -m "feat(agent): add SQLite database layer for standalone mode

Uses bun:sqlite (zero deps), WAL mode for concurrent access.
Schema: boards, columns, cards, tasks, logs, coordination, code events."
```

---

### Task 4: Create local event bus

**Files:**
- Create: `agent/src/backends/local/event-bus.ts`

**Context:** In standalone mode there's no Redis. This in-process EventEmitter delivers real-time events using the same wire format as the SSE multiplexer (`{ ch, t, p }`). When `LocalBackend.postLog()` writes to SQLite, it also emits via this bus. The agent's SSE endpoints listen here and write to connected clients.

**Step 1: Create the event bus module**

Create `agent/src/backends/local/event-bus.ts`:

```typescript
/**
 * Local Event Bus for Standalone Mode
 *
 * In-process EventEmitter that replaces Redis pub/sub.
 * Uses the same wire format as the SSE multiplexer: { ch, t, p }
 *
 * When LocalBackend writes data (logs, coordination, code events),
 * it also emits here. The agent's SSE endpoints listen and forward
 * to connected VS Code clients.
 */

import { EventEmitter } from "events";
import type { StreamEvent } from "../types.js";

const bus = new EventEmitter();
bus.setMaxListeners(100);

/** Emit a stream event to all listeners. */
export function emitStreamEvent(channel: string, type: string, payload: unknown): void {
  const event: StreamEvent = { ch: channel, t: type, p: payload };
  bus.emit("stream-event", event);
}

/** Subscribe to all stream events. */
export function onStreamEvent(handler: (event: StreamEvent) => void): void {
  bus.on("stream-event", handler);
}

/** Unsubscribe from stream events. */
export function offStreamEvent(handler: (event: StreamEvent) => void): void {
  bus.off("stream-event", handler);
}

/** Get the underlying EventEmitter (for testing or direct access). */
export function getEventBus(): EventEmitter {
  return bus;
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd agent && npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add agent/src/backends/local/event-bus.ts
git commit -m "feat(agent): add local event bus for standalone real-time events

In-process EventEmitter using SSE multiplexer wire format { ch, t, p }.
Replaces Redis pub/sub in standalone mode."
```

---

### Task 5: Create standalone config manager

**Files:**
- Create: `agent/src/backends/local/config.ts`

**Context:** In standalone mode, sensitive config (LLM API keys, SCM tokens) lives in `~/.workermill/config.json` — NOT in SQLite. This is separate from the existing `config.ts` which handles the cloud agent config. The standalone config has a different shape: no `apiUrl`/`apiKey` fields, but has `llm` and `scm` sections.

**Step 1: Create the standalone config module**

Create `agent/src/backends/local/config.ts`:

```typescript
/**
 * Standalone Mode Configuration
 *
 * Manages ~/.workermill/config.json for standalone (non-cloud) operation.
 * Sensitive values (API keys, tokens) live here, not in SQLite.
 *
 * This is separate from agent/src/config.ts which handles cloud agent config.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CONFIG_DIR = join(homedir(), ".workermill");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface StandaloneConfig {
  mode: "standalone" | "cloud";
  llm?: {
    provider: string;
    model: string;
    apiKey: string;
  };
  scm?: {
    provider: string;
    token: string;
  };
  defaultRepo?: string;
  settings?: {
    maxParallelExperts?: number;
    maxStories?: number;
  };
}

const DEFAULT_CONFIG: StandaloneConfig = {
  mode: "standalone",
  llm: {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    apiKey: "",
  },
  settings: {
    maxParallelExperts: 4,
    maxStories: 8,
  },
};

/** Load standalone config from disk. Returns defaults if file doesn't exist. */
export function loadStandaloneConfig(): StandaloneConfig {
  if (!existsSync(CONFIG_FILE)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as StandaloneConfig;
    return parsed;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** Save standalone config to disk with restricted permissions. */
export function saveStandaloneConfig(config: StandaloneConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");

  try {
    chmodSync(CONFIG_FILE, 0o600);
  } catch {
    // chmod may not work on Windows
  }
}

/** Check if standalone mode is configured (has LLM API key). */
export function isStandaloneReady(): boolean {
  const config = loadStandaloneConfig();
  return config.mode === "standalone" && !!config.llm?.apiKey;
}

/** Check if the config file indicates cloud mode. */
export function isCloudMode(): boolean {
  if (!existsSync(CONFIG_FILE)) return false;
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed.mode === "cloud" && !!parsed.apiKey;
  } catch {
    return false;
  }
}

/** Get the config directory path. */
export function getStandaloneConfigDir(): string {
  return CONFIG_DIR;
}

/** Get the config file path. */
export function getStandaloneConfigFile(): string {
  return CONFIG_FILE;
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd agent && npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add agent/src/backends/local/config.ts
git commit -m "feat(agent): add standalone config manager

Manages ~/.workermill/config.json for standalone operation.
Separates LLM keys and SCM tokens from SQLite data."
```

---

### Task 6: Create LocalBackend implementation (core)

**Files:**
- Create: `agent/src/backends/local/index.ts`

**Context:** This is the main LocalBackend class implementing `AgentBackend`. It wires together SQLite (db.ts), the event bus (event-bus.ts), and config (config.ts). Each method either reads/writes SQLite and emits stream events, or delegates to the local orchestrator for execution. This task implements the core CRUD operations — tasks, logs, coordination, code events, boards. The orchestrator and PRD decomposition are separate tasks.

**Step 1: Create the LocalBackend class**

Create `agent/src/backends/local/index.ts`:

```typescript
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
import { getDb, closeDb, generateId, getSetting, setSetting, getSettingInt } from "./db.js";
import { emitStreamEvent, onStreamEvent, offStreamEvent } from "./event-bus.js";
import { loadStandaloneConfig, saveStandaloneConfig, type StandaloneConfig } from "./config.js";

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
    const rows = getDb().prepare(
      "SELECT * FROM tasks ORDER BY created_at DESC LIMIT 100"
    ).all() as any[];
    return rows.map(rowToTask);
  }

  async getTask(id: string): Promise<TaskInfo | null> {
    const row = getDb().prepare("SELECT * FROM tasks WHERE id = ?").get(id) as any;
    return row ? rowToTask(row) : null;
  }

  async createTask(input: CreateTaskInput): Promise<TaskInfo> {
    const id = generateId();
    const now = new Date().toISOString();

    getDb().prepare(`
      INSERT INTO tasks (id, summary, description, github_repo, scm_provider, worker_model, board_id, card_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
    `).run(
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
      getDb().prepare("UPDATE cards SET task_id = ? WHERE id = ?").run(id, input.cardId);
    }

    const task = await this.getTask(id);
    emitStreamEvent("org:local:tasks", "task_state", { taskId: id, status: "queued" });
    return task!;
  }

  async cancelTask(id: string): Promise<void> {
    const result = getDb().prepare(
      "UPDATE tasks SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND status IN ('queued', 'executing', 'planning')"
    ).run(id);
    if (result.changes > 0) {
      emitStreamEvent("org:local:tasks", "task_state", { taskId: id, status: "cancelled" });
    }
  }

  async retryTask(id: string): Promise<void> {
    const task = await this.getTask(id);
    if (!task) return;
    getDb().prepare(
      "UPDATE tasks SET status = 'queued', started_at = NULL, completed_at = NULL, updated_at = datetime('now') WHERE id = ?"
    ).run(id);
    emitStreamEvent("org:local:tasks", "task_state", { taskId: id, status: "queued" });
  }

  // ── Task Execution Lifecycle ──

  async claimTask(taskId: string): Promise<ClaimResult> {
    const result = getDb().prepare(
      "UPDATE tasks SET status = 'executing', started_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'queued'"
    ).run(taskId);

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
    getDb().prepare(
      "UPDATE tasks SET status = 'executing', started_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).run(taskId);
    emitStreamEvent("org:local:tasks", "task_state", { taskId, status: "executing" });
  }

  async reportTaskCompleted(taskId: string, result: TaskResult): Promise<void> {
    getDb().prepare(
      "UPDATE tasks SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).run(taskId);
    emitStreamEvent("org:local:tasks", "task_state", { taskId, status: "completed", ...result });
  }

  async reportTaskFailed(taskId: string, error: string): Promise<void> {
    getDb().prepare(
      "UPDATE tasks SET status = 'failed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).run(taskId);
    await this.postLog({ taskId, message: `Task failed: ${error}`, severity: "error" });
    emitStreamEvent("org:local:tasks", "task_state", { taskId, status: "failed", error });
  }

  // ── Logging ──

  async postLog(entry: LogEntry): Promise<void> {
    getDb().prepare(
      "INSERT INTO task_logs (task_id, type, message, severity) VALUES (?, ?, ?, ?)"
    ).run(entry.taskId, entry.type || "execution", entry.message, entry.severity || "info");

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
    getDb().prepare(
      "INSERT INTO coordination_messages (parent_task_id, task_id, message_type, content) VALUES (?, ?, ?, ?)"
    ).run(msg.parentTaskId, msg.taskId || null, msg.messageType, JSON.stringify(msg.content));

    emitStreamEvent(`coordination:${msg.parentTaskId}`, msg.messageType, msg);
  }

  async getCoordinationContext(taskId: string): Promise<CoordinationMessage[]> {
    const rows = getDb().prepare(
      "SELECT * FROM coordination_messages WHERE parent_task_id = ? ORDER BY created_at ASC LIMIT 200"
    ).all(taskId) as any[];

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

  async respondToBlocker(taskId: string, response: BlockerResponse): Promise<void> {
    await this.postCoordinationMessage({
      parentTaskId: taskId,
      messageType: "blocker_response",
      content: response,
    });
  }

  // ── Code Events ──

  async postCodeEvent(event: CodeEvent): Promise<void> {
    getDb().prepare(
      "INSERT INTO code_events (task_id, file_path, tool_name, expert, metadata) VALUES (?, ?, ?, ?, ?)"
    ).run(event.taskId, event.filePath, event.toolName, event.expert || null, event.metadata ? JSON.stringify(event.metadata) : null);

    emitStreamEvent(`code:${event.taskId}`, "code_event", event);
  }

  // ── Backfill ──

  async getLogBackfill(taskId: string, since?: string, limit?: number): Promise<BackfillResponse> {
    const lim = limit || 500;
    let rows: any[];
    if (since) {
      rows = getDb().prepare(
        "SELECT * FROM task_logs WHERE task_id = ? AND created_at > ? ORDER BY created_at ASC LIMIT ?"
      ).all(taskId, since, lim) as any[];
    } else {
      rows = getDb().prepare(
        "SELECT * FROM task_logs WHERE task_id = ? ORDER BY created_at ASC LIMIT ?"
      ).all(taskId, lim) as any[];
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
      cursor: rows.length > 0 ? rows[rows.length - 1].created_at : null,
    };
  }

  async getCoordinationBackfill(taskId: string, since?: string, limit?: number): Promise<BackfillResponse> {
    const lim = limit || 200;
    let rows: any[];
    if (since) {
      rows = getDb().prepare(
        "SELECT * FROM coordination_messages WHERE parent_task_id = ? AND created_at > ? ORDER BY created_at ASC LIMIT ?"
      ).all(taskId, since, lim) as any[];
    } else {
      rows = getDb().prepare(
        "SELECT * FROM coordination_messages WHERE parent_task_id = ? ORDER BY created_at ASC LIMIT ?"
      ).all(taskId, lim) as any[];
    }

    return {
      data: rows.map((r: any) => ({
        parentTaskId: r.parent_task_id,
        taskId: r.task_id,
        messageType: r.message_type,
        content: JSON.parse(r.content),
        createdAt: r.created_at,
      })),
      cursor: rows.length > 0 ? rows[rows.length - 1].created_at : null,
    };
  }

  async getCodeBackfill(taskId: string, since?: string): Promise<BackfillResponse> {
    let rows: any[];
    if (since) {
      rows = getDb().prepare(
        "SELECT * FROM code_events WHERE task_id = ? AND created_at > ? ORDER BY created_at ASC"
      ).all(taskId, since) as any[];
    } else {
      rows = getDb().prepare(
        "SELECT * FROM code_events WHERE task_id = ? ORDER BY created_at ASC"
      ).all(taskId) as any[];
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
      cursor: rows.length > 0 ? rows[rows.length - 1].created_at : null,
    };
  }

  // ── Boards ──

  async getBoards(): Promise<Board[]> {
    const rows = getDb().prepare("SELECT * FROM boards ORDER BY created_at DESC").all() as any[];
    const boards: Board[] = [];
    for (const row of rows) {
      const columns = getDb().prepare(
        "SELECT * FROM board_columns WHERE board_id = ? ORDER BY position ASC"
      ).all(row.id) as any[];
      boards.push(rowToBoard(row, columns));
    }
    return boards;
  }

  async getBoard(id: string): Promise<Board | null> {
    const row = getDb().prepare("SELECT * FROM boards WHERE id = ?").get(id) as any;
    if (!row) return null;
    const columns = getDb().prepare(
      "SELECT * FROM board_columns WHERE board_id = ? ORDER BY position ASC"
    ).all(id) as any[];
    return rowToBoard(row, columns);
  }

  async createBoard(input: CreateBoardInput): Promise<Board> {
    const id = generateId();
    const now = new Date().toISOString();

    getDb().prepare(
      "INSERT INTO boards (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run(id, input.name, input.description || null, now, now);

    // Create default columns
    const defaultColumns = [
      { name: "Backlog", position: 0, isDone: 0 },
      { name: "In Progress", position: 1, isDone: 0 },
      { name: "Done", position: 2, isDone: 1 },
    ];
    for (const col of defaultColumns) {
      const colId = generateId();
      getDb().prepare(
        "INSERT INTO board_columns (id, board_id, name, position, is_done_column) VALUES (?, ?, ?, ?, ?)"
      ).run(colId, id, col.name, col.position, col.isDone);
    }

    return (await this.getBoard(id))!;
  }

  async deleteBoard(id: string): Promise<void> {
    getDb().prepare("DELETE FROM boards WHERE id = ?").run(id);
  }

  async getBoardCards(boardId: string): Promise<Card[]> {
    const rows = getDb().prepare(
      "SELECT * FROM cards WHERE board_id = ? ORDER BY position ASC"
    ).all(boardId) as any[];
    return rows.map(rowToCard);
  }

  async createCard(boardId: string, input: CreateCardInput): Promise<Card> {
    const id = generateId();
    const now = new Date().toISOString();

    // Auto-increment card_number per board
    const maxRow = getDb().prepare(
      "SELECT MAX(card_number) as max_num FROM cards WHERE board_id = ?"
    ).get(boardId) as any;
    const cardNumber = (maxRow?.max_num || 0) + 1;

    getDb().prepare(`
      INSERT INTO cards (id, board_id, column_id, card_number, title, description, priority, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, boardId, input.columnId, cardNumber,
      input.title, input.description || null,
      input.priority || "medium", input.position || 0,
      now, now,
    );

    return rowToCard(getDb().prepare("SELECT * FROM cards WHERE id = ?").get(id) as any);
  }

  async updateCard(cardId: string, input: Partial<Card>): Promise<Card> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (input.title !== undefined) { sets.push("title = ?"); values.push(input.title); }
    if (input.description !== undefined) { sets.push("description = ?"); values.push(input.description); }
    if (input.priority !== undefined) { sets.push("priority = ?"); values.push(input.priority); }
    if (input.columnId !== undefined) { sets.push("column_id = ?"); values.push(input.columnId); }
    if (input.position !== undefined) { sets.push("position = ?"); values.push(input.position); }
    if (input.taskId !== undefined) { sets.push("task_id = ?"); values.push(input.taskId); }

    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      values.push(cardId);
      getDb().prepare(`UPDATE cards SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    }

    return rowToCard(getDb().prepare("SELECT * FROM cards WHERE id = ?").get(cardId) as any);
  }

  async moveCard(cardId: string, columnId: string, position: number): Promise<void> {
    getDb().prepare(
      "UPDATE cards SET column_id = ?, position = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(columnId, position, cardId);
  }

  async runCard(boardId: string, cardId: string): Promise<TaskInfo> {
    const card = getDb().prepare("SELECT * FROM cards WHERE id = ?").get(cardId) as any;
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
    const cards = getDb().prepare(
      "SELECT * FROM cards WHERE board_id = ? AND column_id = ? AND task_id IS NULL ORDER BY position ASC"
    ).all(boardId, backlogCol.id) as any[];

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
    if (input.llmProvider && config.llm) config.llm.provider = input.llmProvider;
    if (input.llmModel && config.llm) config.llm.model = input.llmModel;
    if (input.scmProvider && config.scm) config.scm.provider = input.scmProvider;
    if (input.defaultRepo !== undefined) config.defaultRepo = input.defaultRepo;
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

  // ── PRD (stub — implemented in Task 10) ──

  async getPrdPrompt(): Promise<string> {
    // Will be implemented in Phase E
    throw new Error("PRD not yet implemented for standalone mode");
  }

  async decomposePrd(_input: PrdInput, _onProgress?: (msg: string) => void): Promise<Board> {
    // Will be implemented in Phase E
    throw new Error("PRD decomposition not yet implemented for standalone mode");
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
    executionPlan: row.execution_plan ? JSON.parse(row.execution_plan) : undefined,
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
    qualityGateCommands: row.quality_gate_commands ? JSON.parse(row.quality_gate_commands) : undefined,
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
```

**Step 2: Verify TypeScript compiles**

Run: `cd agent && npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add agent/src/backends/local/index.ts
git commit -m "feat(agent): add LocalBackend for standalone mode

Implements AgentBackend against SQLite + EventEmitter.
CRUD for tasks, boards, cards, logs, coordination, code events.
PRD decomposition stubbed — implemented in Phase E."
```

---

### Task 7: Create backend selector

**Files:**
- Create: `agent/src/backends/selector.ts`

**Context:** This module reads `~/.workermill/config.json` and returns the appropriate backend instance. It's the single decision point for "are we in cloud or standalone mode?"

**Step 1: Create the selector module**

Create `agent/src/backends/selector.ts`:

```typescript
/**
 * Backend Selector
 *
 * Reads ~/.workermill/config.json and returns the appropriate backend.
 * - mode: "cloud" + apiKey → CloudBackend
 * - mode: "standalone" or no config → LocalBackend
 */

import { isCloudMode } from "./local/config.js";
import type { AgentBackend } from "./types.js";

let activeBackend: AgentBackend | null = null;

/**
 * Get or create the active backend based on config.
 * Caches the instance — call resetBackend() to force re-evaluation.
 */
export async function getBackend(): Promise<AgentBackend> {
  if (activeBackend) return activeBackend;

  if (isCloudMode()) {
    // CloudBackend wraps existing agent code (api.ts, poller.ts)
    // Will be implemented in Phase B — for now, fall through to local
    const { CloudBackend } = await import("./cloud/index.js");
    activeBackend = new CloudBackend();
  } else {
    const { LocalBackend } = await import("./local/index.js");
    activeBackend = new LocalBackend();
  }

  await activeBackend.initialize();
  return activeBackend;
}

/** Get the active backend without initializing (returns null if not yet created). */
export function getActiveBackend(): AgentBackend | null {
  return activeBackend;
}

/** Shut down and reset the active backend. */
export async function resetBackend(): Promise<void> {
  if (activeBackend) {
    await activeBackend.shutdown();
    activeBackend = null;
  }
}
```

**Step 2: Create a stub CloudBackend so imports don't fail**

Create `agent/src/backends/cloud/index.ts`:

```typescript
/**
 * CloudBackend — wraps existing agent code (api.ts, poller.ts) behind AgentBackend.
 *
 * Implemented in Phase B. This stub exists so the backend selector can import it.
 */

import type { AgentBackend } from "../types.js";

export class CloudBackend implements AgentBackend {
  readonly mode = "cloud" as const;

  async initialize(): Promise<void> {
    throw new Error("CloudBackend not yet implemented — use 'workermill-agent setup' for cloud mode");
  }

  async shutdown(): Promise<void> {}

  // All methods throw — this is a stub. Phase B will implement them
  // by wrapping the existing api.ts and poller.ts modules.
  onStreamEvent(): void { throw new Error("Not implemented"); }
  offStreamEvent(): void { throw new Error("Not implemented"); }
  getTasks(): Promise<any> { throw new Error("Not implemented"); }
  getTask(): Promise<any> { throw new Error("Not implemented"); }
  createTask(): Promise<any> { throw new Error("Not implemented"); }
  cancelTask(): Promise<any> { throw new Error("Not implemented"); }
  retryTask(): Promise<any> { throw new Error("Not implemented"); }
  claimTask(): Promise<any> { throw new Error("Not implemented"); }
  reportTaskStarted(): Promise<any> { throw new Error("Not implemented"); }
  reportTaskCompleted(): Promise<any> { throw new Error("Not implemented"); }
  reportTaskFailed(): Promise<any> { throw new Error("Not implemented"); }
  postLog(): Promise<any> { throw new Error("Not implemented"); }
  postCoordinationMessage(): Promise<any> { throw new Error("Not implemented"); }
  getCoordinationContext(): Promise<any> { throw new Error("Not implemented"); }
  talkToWorker(): Promise<any> { throw new Error("Not implemented"); }
  respondToBlocker(): Promise<any> { throw new Error("Not implemented"); }
  postCodeEvent(): Promise<any> { throw new Error("Not implemented"); }
  getLogBackfill(): Promise<any> { throw new Error("Not implemented"); }
  getCoordinationBackfill(): Promise<any> { throw new Error("Not implemented"); }
  getCodeBackfill(): Promise<any> { throw new Error("Not implemented"); }
  getPrdPrompt(): Promise<any> { throw new Error("Not implemented"); }
  decomposePrd(): Promise<any> { throw new Error("Not implemented"); }
  getBoards(): Promise<any> { throw new Error("Not implemented"); }
  getBoard(): Promise<any> { throw new Error("Not implemented"); }
  createBoard(): Promise<any> { throw new Error("Not implemented"); }
  deleteBoard(): Promise<any> { throw new Error("Not implemented"); }
  getBoardCards(): Promise<any> { throw new Error("Not implemented"); }
  createCard(): Promise<any> { throw new Error("Not implemented"); }
  updateCard(): Promise<any> { throw new Error("Not implemented"); }
  moveCard(): Promise<any> { throw new Error("Not implemented"); }
  runCard(): Promise<any> { throw new Error("Not implemented"); }
  runAllCards(): Promise<any> { throw new Error("Not implemented"); }
  getSettings(): Promise<any> { throw new Error("Not implemented"); }
  updateSettings(): Promise<any> { throw new Error("Not implemented"); }
  getRepos(): Promise<any> { throw new Error("Not implemented"); }
  approvePlan(): Promise<any> { throw new Error("Not implemented"); }
  rejectPlan(): Promise<any> { throw new Error("Not implemented"); }
}
```

**Step 3: Verify TypeScript compiles**

Run: `cd agent && npx tsc --noEmit`
Expected: No errors.

**Step 4: Commit**

```bash
git add agent/src/backends/selector.ts agent/src/backends/cloud/index.ts
git commit -m "feat(agent): add backend selector + CloudBackend stub

Reads config to route to LocalBackend (standalone) or CloudBackend (cloud).
CloudBackend is a stub — Phase B will wrap existing api.ts/poller.ts."
```

---

### Task 8: Create local orchestrator

**Files:**
- Create: `agent/src/backends/local/orchestrator.ts`

**Context:** In standalone mode, the agent IS the orchestrator. This module claims tasks from SQLite, spawns worker processes (using the existing self-invocation pattern from `spawner.ts`), monitors liveness, and handles the board dependency cascade. Workers are spawned via `process.execPath` with `__WORKERMILL_MODE=worker` — identical to the existing remote agent native spawner.

**Step 1: Create the local orchestrator**

Create `agent/src/backends/local/orchestrator.ts`:

```typescript
/**
 * Local Orchestrator for Standalone Mode
 *
 * Claims tasks from SQLite, spawns worker processes, monitors liveness.
 * Workers are self-invocations (process.execPath with __WORKERMILL_MODE=worker).
 *
 * Unlike the cloud orchestrator, this is event-driven (not polling).
 * Tasks are picked up immediately when created.
 */

import { spawn, type ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { fileURLToPath } from "url";
import { getDb, generateId, getSettingInt } from "./db.js";
import { emitStreamEvent } from "./event-bus.js";
import { loadStandaloneConfig } from "./config.js";

interface ActiveWorker {
  taskId: string;
  process: ChildProcess;
  startedAt: number;
}

const activeWorkers = new Map<string, ActiveWorker>();
let staleCheckInterval: ReturnType<typeof setInterval> | null = null;
let localApiPort: number | null = null;

/**
 * Initialize the local orchestrator.
 * Starts the stale task sweep and sets the local API port for worker communication.
 */
export function initOrchestrator(port: number): void {
  localApiPort = port;

  // Sweep for stale tasks every 60s
  staleCheckInterval = setInterval(sweepStaleWorkers, 60_000);
}

/** Shut down the orchestrator and kill all active workers. */
export function shutdownOrchestrator(): void {
  if (staleCheckInterval) {
    clearInterval(staleCheckInterval);
    staleCheckInterval = null;
  }

  for (const [taskId, worker] of activeWorkers) {
    try {
      worker.process.kill("SIGTERM");
    } catch { /* already dead */ }
    activeWorkers.delete(taskId);
  }
}

/**
 * Process a queued task — claim it and spawn a worker.
 * Called when a task is created or retried.
 */
export async function processQueuedTask(taskId: string): Promise<void> {
  const db = getDb();

  // Check concurrency limit
  const maxParallel = getSettingInt("max_parallel_experts", 4);
  const config = loadStandaloneConfig();
  const limit = config.settings?.maxParallelExperts ?? maxParallel;

  const { count } = db.prepare(
    "SELECT COUNT(*) as count FROM tasks WHERE status = 'executing'"
  ).get() as { count: number };

  if (count >= limit) {
    // At capacity — task stays queued, will be picked up when a slot opens
    return;
  }

  // Atomic claim
  const result = db.prepare(
    "UPDATE tasks SET status = 'executing', started_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'queued'"
  ).run(taskId);

  if (result.changes === 0) return; // Already claimed or status changed

  emitStreamEvent("org:local:tasks", "task_state", { taskId, status: "executing" });

  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as any;
  if (!task) return;

  await spawnLocalWorker(task);
}

/** Spawn a worker process for a task. */
async function spawnLocalWorker(task: any): Promise<void> {
  if (!localApiPort) {
    throw new Error("Local orchestrator not initialized — call initOrchestrator(port) first");
  }

  const config = loadStandaloneConfig();
  const taskId = task.id;

  // Working directory
  const workDir = path.join(os.tmpdir(), `workermill-${taskId.slice(0, 8)}`);
  fs.mkdirSync(workDir, { recursive: true });

  // Resolve spawn command (same pattern as spawner.ts:37-49)
  const execName = path.basename(process.execPath).replace(/\.exe$/i, "");
  let command: string;
  let args: string[];
  if (execName === "node" || execName === "nodejs") {
    const thisFile = fileURLToPath(import.meta.url);
    const distDir = path.resolve(path.dirname(thisFile), "../..");
    const entryScript = path.join(distDir, "entry.js");
    command = process.execPath;
    args = [entryScript];
  } else {
    command = process.execPath;
    args = [];
  }

  // Environment for the worker
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    __WORKERMILL_MODE: "worker",
    WORKERMILL_API_URL: `http://127.0.0.1:${localApiPort}`,
    TASK_ID: taskId,
    PARENT_TASK_ID: task.parent_task_id || taskId,
    TASK_SUMMARY: task.summary || "",
    TASK_DESCRIPTION: task.description || "",
    GITHUB_REPO: task.github_repo || config.defaultRepo || "",
    SCM_PROVIDER: task.scm_provider || config.scm?.provider || "github",
    WORKER_MODEL: task.worker_model || config.llm?.model || "claude-sonnet-4-20250514",
    SCM_TOKEN: config.scm?.token || "",
  };

  // LLM API key
  if (config.llm?.provider === "anthropic" || !config.llm?.provider) {
    env.ANTHROPIC_API_KEY = config.llm?.apiKey || "";
  } else if (config.llm?.provider === "openai") {
    env.OPENAI_API_KEY = config.llm?.apiKey || "";
  } else if (config.llm?.provider === "google") {
    env.GOOGLE_API_KEY = config.llm?.apiKey || "";
  }

  // Execution plan (if this is a sub-task of a planned epic)
  if (task.execution_plan) {
    env.EXECUTION_PLAN = typeof task.execution_plan === "string"
      ? task.execution_plan
      : JSON.stringify(JSON.parse(task.execution_plan));
  }

  const child = spawn(command, args, {
    env,
    cwd: workDir,
    stdio: ["pipe", "pipe", "pipe"],
    detached: false,
  });

  // Store PID in database for stale detection
  if (child.pid) {
    getDb().prepare("UPDATE tasks SET worker_pid = ? WHERE id = ?").run(child.pid, taskId);
  }

  activeWorkers.set(taskId, {
    taskId,
    process: child,
    startedAt: Date.now(),
  });

  // Pipe stdout/stderr as log events
  child.stdout?.on("data", (data: Buffer) => {
    const line = data.toString("utf-8").trim();
    if (line) {
      emitStreamEvent(`logs:${taskId}`, "log", {
        taskId,
        message: line,
        severity: "info",
        createdAt: new Date().toISOString(),
      });
    }
  });

  child.stderr?.on("data", (data: Buffer) => {
    const line = data.toString("utf-8").trim();
    if (line) {
      emitStreamEvent(`logs:${taskId}`, "log", {
        taskId,
        message: line,
        severity: "error",
        createdAt: new Date().toISOString(),
      });
    }
  });

  // Handle worker exit
  child.on("exit", (exitCode) => {
    activeWorkers.delete(taskId);

    const db = getDb();
    if (exitCode === 0) {
      db.prepare(
        "UPDATE tasks SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
      ).run(taskId);
      emitStreamEvent("org:local:tasks", "task_state", { taskId, status: "completed" });

      // Trigger dependency cascade
      triggerDependentCards(taskId);
    } else {
      db.prepare(
        "UPDATE tasks SET status = 'failed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
      ).run(taskId);
      emitStreamEvent("org:local:tasks", "task_state", { taskId, status: "failed", exitCode });
    }

    // Check if there are queued tasks waiting for a slot
    processNextQueued();
  });
}

/** Process the next queued task (called when a slot opens). */
function processNextQueued(): void {
  const db = getDb();
  const next = db.prepare(
    "SELECT id FROM tasks WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1"
  ).get() as { id: string } | null;

  if (next) {
    processQueuedTask(next.id).catch((err) => {
      console.error("[local-orchestrator] Failed to process queued task:", err);
    });
  }
}

/** Board dependency cascade — when a card's task completes, trigger dependent cards. */
function triggerDependentCards(completedTaskId: string): void {
  const db = getDb();

  // Find the card associated with this task
  const card = db.prepare(
    "SELECT id, board_id FROM cards WHERE task_id = ?"
  ).get(completedTaskId) as { id: string; board_id: string } | null;

  if (!card) return;

  // Find cards that depend on this card
  const dependents = db.prepare(
    "SELECT card_id FROM card_dependencies WHERE depends_on_card_id = ?"
  ).all(card.id) as { card_id: string }[];

  for (const dep of dependents) {
    // Check if ALL dependencies of this dependent card are complete
    const blockers = db.prepare(`
      SELECT cd.depends_on_card_id
      FROM card_dependencies cd
      JOIN cards c ON c.id = cd.depends_on_card_id
      LEFT JOIN tasks t ON t.id = c.task_id
      WHERE cd.card_id = ? AND (t.status IS NULL OR t.status != 'completed')
    `).all(dep.card_id) as any[];

    if (blockers.length === 0) {
      // All dependencies met — create and queue a task for this card
      const depCard = db.prepare("SELECT * FROM cards WHERE id = ?").get(dep.card_id) as any;
      if (depCard && !depCard.task_id) {
        const config = loadStandaloneConfig();
        const taskId = generateId();
        const now = new Date().toISOString();

        db.prepare(`
          INSERT INTO tasks (id, summary, description, github_repo, scm_provider, worker_model, board_id, card_id, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
        `).run(
          taskId, depCard.title, depCard.description,
          config.defaultRepo || null, config.scm?.provider || null,
          config.llm?.model || null, depCard.board_id, depCard.id,
          now, now,
        );

        db.prepare("UPDATE cards SET task_id = ? WHERE id = ?").run(taskId, depCard.id);
        emitStreamEvent("org:local:tasks", "task_state", { taskId, status: "queued" });

        // Try to process immediately
        processQueuedTask(taskId).catch(() => {});
      }
    }
  }
}

/** Sweep for stale workers — tasks in 'executing' with dead PIDs. */
function sweepStaleWorkers(): void {
  const db = getDb();
  const executing = db.prepare(
    "SELECT id, worker_pid FROM tasks WHERE status = 'executing' AND worker_pid IS NOT NULL"
  ).all() as { id: string; worker_pid: number }[];

  for (const task of executing) {
    try {
      // Check if PID is alive (signal 0 doesn't kill, just checks)
      process.kill(task.worker_pid, 0);
    } catch {
      // Process is dead — mark task as failed
      db.prepare(
        "UPDATE tasks SET status = 'failed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
      ).run(task.id);
      activeWorkers.delete(task.id);
      emitStreamEvent("org:local:tasks", "task_state", {
        taskId: task.id,
        status: "failed",
        error: "Worker process exited unexpectedly",
      });
    }
  }
}

/** Stop a specific worker task. */
export function stopWorkerTask(taskId: string): void {
  const worker = activeWorkers.get(taskId);
  if (worker) {
    try {
      worker.process.kill("SIGTERM");
    } catch { /* already dead */ }
    activeWorkers.delete(taskId);
  }
}

/** Get count of active workers. */
export function getActiveWorkerCount(): number {
  return activeWorkers.size;
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd agent && npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add agent/src/backends/local/orchestrator.ts
git commit -m "feat(agent): add local orchestrator for standalone mode

Claims tasks from SQLite, spawns worker self-invocations,
monitors PID liveness, handles board dependency cascade."
```

---

## Phase C: Agent Local API Integration

### Task 9: Add standalone endpoints to local-api.ts

**Files:**
- Modify: `agent/src/local-api.ts`

**Context:** The local API currently requires `cloudProxy` for most operations ("Cloud API not connected" errors). In standalone mode, these endpoints must work without the cloud — delegating to the active backend. This task adds backend-aware routing: if the backend is local, handle locally; if cloud, proxy to cloud (existing behavior).

This is the highest-risk task — it touches the main API surface. Make changes incrementally: first add the backend import and worker ingestion endpoints (which don't exist yet), then gradually convert existing endpoints to be backend-aware.

**Step 1: Add backend import and standalone worker ingestion endpoints**

At the top of `local-api.ts`, add the backend import after the existing imports (around line 21):

```typescript
import { getActiveBackend } from "./backends/selector.js";
import { processQueuedTask, stopWorkerTask } from "./backends/local/orchestrator.js";
```

Then, in the `handleRequest` function (after the existing POST endpoints, around line 946 before the `return notFound(res)` line), add worker ingestion endpoints that standalone workers POST to:

```typescript
  // ── Worker ingestion endpoints (standalone mode) ──

  // POST /api/tasks/:id/logs — worker posts log entries
  const workerLogMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/logs$/);
  if (req.method === "POST" && workerLogMatch) {
    const backend = getActiveBackend();
    if (!backend || backend.mode !== "local") return notFound(res);
    try {
      const body = JSON.parse(await readBody(req));
      await backend.postLog({
        taskId: workerLogMatch[1],
        type: body.type || "execution",
        message: body.message,
        severity: body.severity || "info",
      });
      return json(res, { success: true });
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // POST /api/coordination/messages — worker posts coordination messages
  if (req.method === "POST" && path === "/api/coordination/messages") {
    const backend = getActiveBackend();
    if (!backend || backend.mode !== "local") return notFound(res);
    try {
      const body = JSON.parse(await readBody(req));
      await backend.postCoordinationMessage({
        parentTaskId: body.parentTaskId,
        taskId: body.taskId,
        messageType: body.messageType || body.type,
        content: body.content,
      });
      return json(res, { success: true });
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // POST /api/control-center/code-events — worker posts code events
  if (req.method === "POST" && path === "/api/control-center/code-events") {
    const backend = getActiveBackend();
    if (!backend || backend.mode !== "local") return notFound(res);
    try {
      const body = JSON.parse(await readBody(req));
      await backend.postCodeEvent({
        taskId: body.taskId,
        filePath: body.filePath,
        toolName: body.toolName,
        expert: body.expert,
        metadata: body.metadata,
      });
      return json(res, { success: true });
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // ── Board endpoints (standalone mode) ──

  // GET /api/boards
  if (req.method === "GET" && path === "/api/boards") {
    const backend = getActiveBackend();
    if (!backend || backend.mode !== "local") {
      if (cloudProxy) {
        try {
          const result = await cloudProxy("GET", "/api/boards");
          return json(res, result);
        } catch (err) {
          return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
        }
      }
      return json(res, { error: "No backend available" }, 503);
    }
    try {
      const boards = await backend.getBoards();
      return json(res, boards);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // GET /api/boards/:id/cards
  const boardCardsMatch = path.match(/^\/api\/boards\/([a-f0-9]+)\/cards$/);
  if (req.method === "GET" && boardCardsMatch) {
    const backend = getActiveBackend();
    if (!backend || backend.mode !== "local") return json(res, { error: "No backend available" }, 503);
    try {
      const cards = await backend.getBoardCards(boardCardsMatch[1]);
      return json(res, cards);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // POST /api/boards/:id/cards/:cardId/run
  const runCardMatch = path.match(/^\/api\/boards\/([a-f0-9]+)\/cards\/([a-f0-9]+)\/run$/);
  if (req.method === "POST" && runCardMatch) {
    const backend = getActiveBackend();
    if (!backend || backend.mode !== "local") return json(res, { error: "No backend available" }, 503);
    try {
      const task = await backend.runCard(runCardMatch[1], runCardMatch[2]);
      // Trigger orchestrator
      processQueuedTask(task.id).catch(() => {});
      return json(res, task, 201);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }
```

**Step 2: Make the task run endpoint backend-aware**

Modify the existing `POST /api/tasks/run` handler (around line 502). Change:

```typescript
  if (req.method === "POST" && path === "/api/tasks/run") {
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
```

To:

```typescript
  if (req.method === "POST" && path === "/api/tasks/run") {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const body = JSON.parse(await readBody(req));
        const task = await backend.createTask({
          summary: body.summary,
          description: body.description,
          githubRepo: body.githubRepo || body.repo,
          scmProvider: body.scmProvider,
          workerModel: body.workerModel,
        });
        processQueuedTask(task.id).catch(() => {});
        return json(res, task, 201);
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
```

**Step 3: Make the cancel endpoint work locally**

The existing cancel handler (around line 708) already kills local processes. Add local backend status update before the cloud proxy call:

After the line `if (localTask) localTask.status = "failed";` and before the cloud proxy section, add:

```typescript
    // Update local backend if in standalone mode
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      stopWorkerTask(taskId);
      await backend.cancelTask(taskId);
      return json(res, { success: true, message: "Task cancelled" });
    }
```

**Step 4: Make the settings endpoint work locally**

The existing `GET /api/repos` handler (around line 535) requires cloudProxy. Add a local fallback:

Change:
```typescript
  if (req.method === "GET" && path === "/api/repos") {
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
```

To:
```typescript
  if (req.method === "GET" && path === "/api/repos") {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const repos = await backend.getRepos();
        return json(res, {
          repos: repos.map(r => r.url),
          defaultRepo: repos.find(r => r.isDefault)?.url || null,
          scmProvider: (await backend.getSettings()).scmProvider || "github",
        });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
```

**Step 5: Verify TypeScript compiles**

Run: `cd agent && npx tsc --noEmit`
Expected: No errors.

**Step 6: Verify build works**

Run: `cd agent && npm run build`
Expected: Build succeeds.

**Step 7: Commit**

```bash
git add agent/src/local-api.ts
git commit -m "feat(agent): add standalone endpoints to local API

Worker ingestion (logs, coordination, code events), board CRUD,
backend-aware task run/cancel/repos. Existing cloud proxy paths preserved."
```

---

### Task 10: Wire backend into agent startup

**Files:**
- Modify: `agent/src/index.ts`

**Context:** Currently `startAgent()` assumes cloud mode — it calls `initApi()`, starts polling, starts heartbeat. For standalone mode, it should initialize the backend selector, start the local API, and initialize the local orchestrator. The VS Code extension connects the same way regardless — via `~/.workermill/agent.port`.

**Step 1: Add standalone startup path**

In `agent/src/index.ts`, after the existing imports (around line 20), add:

```typescript
import { getBackend, resetBackend } from "./backends/selector.js";
import { initOrchestrator, shutdownOrchestrator } from "./backends/local/orchestrator.js";
import { isCloudMode } from "./backends/local/config.js";
```

Then modify `startAgent()` to detect mode and branch. After `writePidFile()` (line 77) and before the banner (line 79), add:

```typescript
  const standaloneMode = !isCloudMode();
```

Then wrap the existing cloud setup in a conditional. Before the `initApi(config.apiUrl, config.apiKey);` call (line 85), add:

```typescript
  if (standaloneMode) {
    console.log();
    console.log(chalk.bold.cyan("  WorkerMill Agent (Standalone)"));
    console.log(chalk.dim("  ─────────────────────────────────────"));
    console.log();
    console.log(`  ${chalk.dim("Version:")}    ${AGENT_VERSION}`);
    console.log(`  ${chalk.dim("Mode:")}       ${chalk.green("Standalone")} (local SQLite)`);
    console.log();

    // Initialize backend
    const backend = await getBackend();
    const settings = await backend.getSettings();

    console.log(`  ${chalk.dim("LLM:")}        ${settings.llmProvider || "anthropic"} / ${chalk.yellow(settings.llmModel || "not configured")}`);
    console.log(`  ${chalk.dim("Repo:")}       ${settings.defaultRepo || chalk.yellow("not configured")}`);
    console.log(`  ${chalk.dim("SCM:")}        ${settings.scmProvider || "github"}`);
    console.log();

    // Start local API server
    let localApiPort: number | undefined;
    try {
      localApiPort = await startLocalApi(config);
      console.log(`  ${chalk.dim("Local API:")} http://127.0.0.1:${localApiPort}/api/status`);

      // Initialize local orchestrator
      initOrchestrator(localApiPort);
    } catch (err) {
      console.log(`  ${chalk.yellow("⚠")} Local API failed to start: ${err instanceof Error ? err.message : String(err)}`);
    }

    console.log(chalk.dim("  ─────────────────────────────────────"));
    console.log(`  ${chalk.green("●")} Agent is running (standalone). ${chalk.dim("Press Ctrl+C to stop.")}`);
    console.log();

    // Return cleanup function
    return async () => {
      console.log();
      console.log(chalk.dim("  Shutting down..."));
      shutdownOrchestrator();
      await stopLocalApi();
      await resetBackend();
      removePidFile();
      console.log(`  ${chalk.red("●")} Agent stopped.`);
    };
  }
```

This goes BEFORE the existing cloud setup code, so if `standaloneMode` is true, we return early with the standalone cleanup function. The existing cloud code runs only when `standaloneMode` is false.

**Step 2: Verify TypeScript compiles**

Run: `cd agent && npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add agent/src/index.ts
git commit -m "feat(agent): wire standalone mode into agent startup

Detects standalone vs cloud mode from config.
Standalone: initializes LocalBackend + local orchestrator.
Cloud: existing behavior unchanged."
```

---

### Task 11: Add `init --standalone` CLI command

**Files:**
- Create: `agent/src/commands/init-standalone.ts`
- Modify: `agent/src/cli.ts`

**Context:** Users need a way to configure standalone mode. This interactive CLI command sets up `~/.workermill/config.json` with their LLM API key, default repo, and SCM token. It uses `inquirer` (already a dependency) for the prompts.

**Step 1: Create the init-standalone command**

Create `agent/src/commands/init-standalone.ts`:

```typescript
/**
 * workermill-agent init --standalone
 *
 * Interactive setup for standalone (non-cloud) mode.
 * Configures LLM API key, default repo, and SCM token.
 */

import chalk from "chalk";
import inquirer from "inquirer";
import { loadStandaloneConfig, saveStandaloneConfig, type StandaloneConfig } from "../backends/local/config.js";

export async function initStandaloneCommand(): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan("  WorkerMill Standalone Setup"));
  console.log(chalk.dim("  ─────────────────────────────────────"));
  console.log();
  console.log("  Configure WorkerMill to run fully offline with your own AI keys.");
  console.log("  You can connect to workermill.com later for premium features.");
  console.log();

  const existing = loadStandaloneConfig();

  const answers = await inquirer.prompt([
    {
      type: "list",
      name: "llmProvider",
      message: "LLM provider:",
      choices: [
        { name: "Anthropic (Claude)", value: "anthropic" },
        { name: "OpenAI (GPT)", value: "openai" },
        { name: "Google (Gemini)", value: "google" },
      ],
      default: existing.llm?.provider || "anthropic",
    },
    {
      type: "input",
      name: "llmModel",
      message: "Model name:",
      default: (answers: any) => {
        if (answers.llmProvider === "anthropic") return existing.llm?.model || "claude-sonnet-4-20250514";
        if (answers.llmProvider === "openai") return "gpt-4o";
        if (answers.llmProvider === "google") return "gemini-2.5-pro";
        return "";
      },
    },
    {
      type: "password",
      name: "llmApiKey",
      message: "API key:",
      mask: "*",
      validate: (input: string) => input.length > 0 || "API key is required",
    },
    {
      type: "input",
      name: "defaultRepo",
      message: "Default repository (e.g., https://github.com/user/repo):",
      default: existing.defaultRepo || "",
    },
    {
      type: "list",
      name: "scmProvider",
      message: "SCM provider:",
      choices: [
        { name: "GitHub", value: "github" },
        { name: "Bitbucket", value: "bitbucket" },
        { name: "GitLab", value: "gitlab" },
      ],
      default: existing.scm?.provider || "github",
    },
    {
      type: "password",
      name: "scmToken",
      message: "SCM token (for pushing branches/PRs):",
      mask: "*",
    },
  ]);

  const config: StandaloneConfig = {
    mode: "standalone",
    llm: {
      provider: answers.llmProvider,
      model: answers.llmModel,
      apiKey: answers.llmApiKey,
    },
    scm: {
      provider: answers.scmProvider,
      token: answers.scmToken || "",
    },
    defaultRepo: answers.defaultRepo || undefined,
    settings: existing.settings || {
      maxParallelExperts: 4,
      maxStories: 8,
    },
  };

  saveStandaloneConfig(config);

  console.log();
  console.log(`  ${chalk.green("✓")} Configuration saved to ~/.workermill/config.json`);
  console.log();
  console.log(`  Run ${chalk.cyan("workermill-agent")} to start the agent.`);
  console.log();
}
```

**Step 2: Register the command in cli.ts**

In `agent/src/cli.ts`, add the import (after line 17):

```typescript
import { initStandaloneCommand } from "./commands/init-standalone.js";
```

Then add the command registration (after the `update` command, around line 64):

```typescript
program
  .command("init")
  .description("Initialize standalone mode - configure LLM keys and repo")
  .option("--standalone", "Run in standalone mode (no cloud API)")
  .action(async (opts) => {
    if (opts.standalone) {
      await initStandaloneCommand();
    } else {
      console.log("Use --standalone for offline mode, or 'workermill-agent setup' for cloud mode.");
    }
  });
```

**Step 3: Verify TypeScript compiles**

Run: `cd agent && npx tsc --noEmit`
Expected: No errors.

**Step 4: Commit**

```bash
git add agent/src/commands/init-standalone.ts agent/src/cli.ts
git commit -m "feat(agent): add 'init --standalone' CLI command

Interactive setup for standalone mode — configures LLM API key,
default repo, and SCM token in ~/.workermill/config.json."
```

---

## Phase E: PRD Decomposition in Standalone

### Task 12: Implement local PRD decomposition

**Files:**
- Modify: `agent/src/backends/local/index.ts`

**Context:** PRD decomposition already works in the agent — `local-api.ts` has `decomposePrdLocal()` which routes to Claude Agent SDK or Vercel AI SDK. For standalone mode, the LocalBackend's `decomposePrd()` method needs to call the same function, then create a board + cards in SQLite from the result, including card dependencies.

**Step 1: Implement getPrdPrompt() and decomposePrd() in LocalBackend**

In `agent/src/backends/local/index.ts`, replace the two PRD stub methods with real implementations:

Replace:
```typescript
  async getPrdPrompt(): Promise<string> {
    throw new Error("PRD not yet implemented for standalone mode");
  }

  async decomposePrd(_input: PrdInput, _onProgress?: (msg: string) => void): Promise<Board> {
    throw new Error("PRD decomposition not yet implemented for standalone mode");
  }
```

With:
```typescript
  async getPrdPrompt(): Promise<string> {
    // Return the bundled PRD system prompt (same as local-api.ts fallback)
    const { PRD_SYSTEM_PROMPT } = await import("../../local-api.js");
    return PRD_SYSTEM_PROMPT;
  }

  async decomposePrd(input: PrdInput, onProgress?: (msg: string) => void): Promise<Board> {
    const config = loadStandaloneConfig();

    // Reuse the existing decomposePrdLocal function from local-api.ts
    const { decomposePrdLocal } = await import("../../local-api.js");

    const planningConfig = {
      provider: config.llm?.provider || "anthropic",
      model: config.llm?.model || "claude-sonnet-4-20250514",
      apiKey: config.llm?.apiKey,
    };

    const result = await decomposePrdLocal(input.content, planningConfig, undefined, onProgress);

    // Create board from decomposition result
    const boardId = generateId();
    const now = new Date().toISOString();
    const db = getDb();

    db.prepare(
      "INSERT INTO boards (id, name, description, quality_gate_commands, ci_workflow_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      boardId, result.boardName, `Generated from PRD`,
      result.qualityGates ? JSON.stringify(result.qualityGates) : null,
      result.ciWorkflowPath || null,
      now, now,
    );

    // Create columns
    const colBacklog = generateId();
    const colInProgress = generateId();
    const colDone = generateId();
    db.prepare("INSERT INTO board_columns (id, board_id, name, position, is_done_column) VALUES (?, ?, ?, ?, ?)").run(colBacklog, boardId, "Backlog", 0, 0);
    db.prepare("INSERT INTO board_columns (id, board_id, name, position, is_done_column) VALUES (?, ?, ?, ?, ?)").run(colInProgress, boardId, "In Progress", 1, 0);
    db.prepare("INSERT INTO board_columns (id, board_id, name, position, is_done_column) VALUES (?, ?, ?, ?, ?)").run(colDone, boardId, "Done", 2, 1);

    // Create cards
    const cardIds: string[] = [];
    for (let i = 0; i < result.cards.length; i++) {
      const card = result.cards[i] as any;
      const cardId = generateId();
      cardIds.push(cardId);

      db.prepare(`
        INSERT INTO cards (id, board_id, column_id, card_number, title, description, priority, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        cardId, boardId, colBacklog, i + 1,
        card.title, card.description,
        card.priority || "medium", i,
        now, now,
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
              "INSERT INTO card_dependencies (id, card_id, depends_on_card_id) VALUES (?, ?, ?)"
            ).run(depId, cardIds[i], cardIds[depIdx]);
          }
        }
      }
    }

    onProgress?.(`✅ Board "${result.boardName}" created with ${result.cards.length} cards`);

    return (await this.getBoard(boardId))!;
  }
```

**Step 2: Export PRD_SYSTEM_PROMPT and decomposePrdLocal from local-api.ts**

In `agent/src/local-api.ts`, the `PRD_SYSTEM_PROMPT` constant (line 955) and `decomposePrdLocal` function (line 1076) are currently private. Add `export` keyword to both:

- Line 955: `const PRD_SYSTEM_PROMPT` → `export const PRD_SYSTEM_PROMPT`
- Line 1076: `async function decomposePrdLocal` → `export async function decomposePrdLocal`

**Step 3: Verify TypeScript compiles**

Run: `cd agent && npx tsc --noEmit`
Expected: No errors.

**Step 4: Commit**

```bash
git add agent/src/backends/local/index.ts agent/src/local-api.ts
git commit -m "feat(agent): implement PRD decomposition for standalone mode

LocalBackend.decomposePrd() reuses existing decomposePrdLocal(),
creates board + cards + dependencies in SQLite from the result."
```

---

## Phase F: CLI Standalone Commands

### Task 13: Add `run` and `prd` CLI commands for standalone

**Files:**
- Create: `agent/src/commands/run-standalone.ts`
- Create: `agent/src/commands/prd-standalone.ts`
- Modify: `agent/src/cli.ts`

**Context:** These commands let users run tasks and decompose PRDs from the CLI without VS Code. They start the agent in the foreground, run the operation, then exit.

**Step 1: Create the run command**

Create `agent/src/commands/run-standalone.ts`:

```typescript
/**
 * workermill-agent run --repo <url> --task "description"
 *
 * Creates a task in standalone mode and runs it.
 */

import chalk from "chalk";
import { getBackend, resetBackend } from "../backends/selector.js";
import { initOrchestrator, shutdownOrchestrator, processQueuedTask } from "../backends/local/orchestrator.js";
import { startLocalApi, stopLocalApi } from "../local-api.js";
import { loadStandaloneConfig, isStandaloneReady } from "../backends/local/config.js";
import { loadConfigFromFile } from "../config.js";

export async function runStandaloneCommand(opts: {
  repo?: string;
  task?: string;
}): Promise<void> {
  if (!isStandaloneReady()) {
    console.error(chalk.red("Not configured. Run 'workermill-agent init --standalone' first."));
    process.exit(1);
  }

  if (!opts.task) {
    console.error(chalk.red("--task is required. Describe what you want the AI worker to do."));
    process.exit(1);
  }

  console.log(chalk.bold.cyan("  WorkerMill — Running task"));
  console.log();

  const backend = await getBackend();
  const config = loadStandaloneConfig();

  // Start local API for worker communication
  // Use a minimal config for startLocalApi
  const agentConfig = {
    apiUrl: "",
    apiKey: "",
    agentId: "standalone",
    maxWorkers: config.settings?.maxParallelExperts || 4,
    pollIntervalMs: 5000,
    heartbeatIntervalMs: 30000,
    githubToken: config.scm?.token || "",
    bitbucketToken: config.scm?.token || "",
    gitlabToken: config.scm?.token || "",
    githubReviewerToken: "",
    sandbox: "none" as const,
    dockerImage: "",
    dockerMemoryGb: 4,
    localRag: false,
    ollamaPort: 11434,
  };

  const port = await startLocalApi(agentConfig);
  initOrchestrator(port);

  // Create and run the task
  const task = await backend.createTask({
    summary: opts.task,
    githubRepo: opts.repo || config.defaultRepo,
    scmProvider: config.scm?.provider,
    workerModel: config.llm?.model,
  });

  console.log(`  ${chalk.dim("Task:")}  ${task.id.slice(0, 8)} — ${task.summary}`);
  console.log(`  ${chalk.dim("Repo:")}  ${opts.repo || config.defaultRepo || "none"}`);
  console.log();

  await processQueuedTask(task.id);

  // Wait for task to complete
  console.log(chalk.dim("  Waiting for worker to finish..."));
  console.log();

  await new Promise<void>((resolve) => {
    const check = setInterval(async () => {
      const current = await backend.getTask(task.id);
      if (current && (current.status === "completed" || current.status === "failed" || current.status === "cancelled")) {
        clearInterval(check);
        if (current.status === "completed") {
          console.log(`  ${chalk.green("✓")} Task completed successfully.`);
        } else {
          console.log(`  ${chalk.red("✗")} Task ${current.status}.`);
        }
        resolve();
      }
    }, 2000);
  });

  // Cleanup
  shutdownOrchestrator();
  await stopLocalApi();
  await resetBackend();
}
```

**Step 2: Create the PRD command**

Create `agent/src/commands/prd-standalone.ts`:

```typescript
/**
 * workermill-agent prd --repo <url> --file prd.md
 *
 * Decomposes a PRD into a board with cards in standalone mode.
 */

import chalk from "chalk";
import { readFileSync } from "fs";
import { getBackend, resetBackend } from "../backends/selector.js";
import { isStandaloneReady } from "../backends/local/config.js";

export async function prdStandaloneCommand(opts: {
  repo?: string;
  file?: string;
  content?: string;
}): Promise<void> {
  if (!isStandaloneReady()) {
    console.error(chalk.red("Not configured. Run 'workermill-agent init --standalone' first."));
    process.exit(1);
  }

  let prdContent: string;
  if (opts.file) {
    try {
      prdContent = readFileSync(opts.file, "utf-8");
    } catch {
      console.error(chalk.red(`Failed to read file: ${opts.file}`));
      process.exit(1);
    }
  } else if (opts.content) {
    prdContent = opts.content;
  } else {
    console.error(chalk.red("--file or --content is required."));
    process.exit(1);
  }

  console.log(chalk.bold.cyan("  WorkerMill — PRD Decomposition"));
  console.log();

  const backend = await getBackend();

  const board = await backend.decomposePrd(
    { content: prdContent, repo: opts.repo, scmProvider: undefined },
    (msg) => console.log(`  ${msg}`),
  );

  console.log();
  console.log(`  ${chalk.green("✓")} Board created: ${chalk.bold(board.name)}`);
  console.log(`  ${chalk.dim("ID:")} ${board.id}`);
  console.log();

  await resetBackend();
}
```

**Step 3: Register both commands in cli.ts**

In `agent/src/cli.ts`, add imports:

```typescript
import { runStandaloneCommand } from "./commands/run-standalone.js";
import { prdStandaloneCommand } from "./commands/prd-standalone.js";
```

Add command registrations:

```typescript
program
  .command("run")
  .description("Run a task in standalone mode")
  .option("--repo <url>", "Target repository URL")
  .requiredOption("--task <description>", "Task description for the AI worker")
  .action(runStandaloneCommand);

program
  .command("prd")
  .description("Decompose a PRD into a board with cards")
  .option("--repo <url>", "Target repository URL")
  .option("--file <path>", "Path to PRD file")
  .option("--content <text>", "PRD content as text")
  .action(prdStandaloneCommand);
```

**Step 4: Update auto-detect logic for standalone**

In `cli.ts`, modify the auto-detect block (lines 67-74). Change:

```typescript
if (process.argv.length <= 2) {
  if (existsSync(getConfigFile())) {
    startCommand({ detach: false });
  } else {
    setupCommand();
  }
}
```

To:

```typescript
import { isStandaloneReady, isCloudMode } from "./backends/local/config.js";

if (process.argv.length <= 2) {
  if (existsSync(getConfigFile()) || isStandaloneReady()) {
    startCommand({ detach: false });
  } else {
    // No config at all — prompt for setup
    console.log("No configuration found. Choose a setup mode:");
    console.log("  workermill-agent setup         — Connect to WorkerMill Cloud");
    console.log("  workermill-agent init --standalone — Run fully offline");
    process.exit(0);
  }
}
```

**Step 5: Verify TypeScript compiles**

Run: `cd agent && npx tsc --noEmit`
Expected: No errors.

**Step 6: Verify build works**

Run: `cd agent && npm run build`
Expected: Build succeeds.

**Step 7: Commit**

```bash
git add agent/src/commands/run-standalone.ts agent/src/commands/prd-standalone.ts agent/src/cli.ts
git commit -m "feat(agent): add standalone CLI commands (run, prd, init)

workermill-agent run --task 'description' --repo <url>
workermill-agent prd --file prd.md --repo <url>
workermill-agent init --standalone"
```

---

## Phase D: VS Code Extension Onboarding

### Task 14: Add standalone mode indicator to VS Code status bar

**Files:**
- Modify: `packages/vscode-workermill/src/status-bar.ts`

**Context:** When the agent is running in standalone mode, the VS Code status bar should show "Standalone" instead of "Cloud". The extension already reads agent status from `GET /api/status` — we need the agent to include the mode in its response, then the extension displays it.

**Step 1: Update agent status response to include mode**

In `agent/src/local-api.ts`, find the `GET /api/status` handler (around line 348). Add `mode` to the response:

```typescript
  if (req.method === "GET" && path === "/api/status") {
    const backend = getActiveBackend();
    const state: AgentState & { mode?: string } = {
      version: AGENT_VERSION,
      agentId: agentConfig?.agentId || "unknown",
      apiUrl: agentConfig?.apiUrl || "unknown",
      uptime: Math.round((Date.now() - startTime) / 1000),
      sandbox: agentConfig?.sandbox || "none",
      tasks: Array.from(localTasks.values()),
      mode: backend?.mode || "cloud",
    };
    return json(res, state);
  }
```

**Step 2: Update VS Code status bar to show mode**

In `packages/vscode-workermill/src/status-bar.ts`, find where the status bar text is set (look for the connected state). Add mode display:

After the status bar text is set to show "WorkerMill: Connected", add a check:

```typescript
// If agent reports standalone mode, show it
if (status.mode === "local") {
  this.statusBarItem.text = "$(check) WorkerMill: Standalone";
} else {
  this.statusBarItem.text = "$(check) WorkerMill: Connected";
}
```

The exact location depends on the current code — read the file first and adapt.

**Step 3: Verify TypeScript compiles**

Run: `cd agent && npx tsc --noEmit && cd ../packages/vscode-workermill && npx tsc --noEmit`
Expected: No errors.

**Step 4: Commit**

```bash
git add agent/src/local-api.ts packages/vscode-workermill/src/status-bar.ts
git commit -m "feat(vscode): show standalone/cloud mode in status bar

Agent status response includes mode. Extension displays
'Standalone' or 'Connected' accordingly."
```

---

## Verification & Wrap-up

### Task 15: End-to-end verification

**Files:** None (verification only)

**Step 1: Build the agent**

Run: `cd agent && npm run build`
Expected: Build succeeds, `dist/` contains readable (unminified) JS with source maps.

**Step 2: Verify TypeScript compiles across all modified packages**

Run: `cd agent && npx tsc --noEmit`
Expected: Zero errors.

**Step 3: Verify standalone config creation works**

Run: `cd agent && node dist/cli.js init --standalone` (or via the built binary)
Expected: Interactive prompts for LLM provider, model, API key, repo, SCM token. Config saved to `~/.workermill/config.json`.

**Step 4: Verify agent starts in standalone mode**

Run: `cd agent && node dist/cli.js`
Expected: Agent starts, shows "WorkerMill Agent (Standalone)", shows mode/LLM/repo info, local API starts on a random port.

**Step 5: Verify VS Code extension connects**

Expected: Extension discovers agent via `~/.workermill/agent.port`, status bar shows "Standalone".

**Step 6: Commit any verification fixes**

If any fixes were needed during verification, commit them.

---

## Summary

| Phase | Tasks | Files Created | Files Modified |
|-------|-------|---------------|----------------|
| A: Build + Foundation | 1-8 | 7 new files | 1 (build.mjs) |
| C: Local API Integration | 9-10 | 0 | 2 (local-api.ts, index.ts) |
| E: PRD Standalone | 12 | 0 | 2 (local/index.ts, local-api.ts) |
| F: CLI Commands | 11, 13 | 3 new files | 1 (cli.ts) |
| D: VS Code | 14 | 0 | 2 (local-api.ts, status-bar.ts) |
| Verification | 15 | 0 | 0 |

**Total: 15 tasks, 10 new files, ~6 modified files.**

**New files:**
1. `agent/src/backends/types.ts` — AgentBackend interface
2. `agent/src/backends/selector.ts` — Mode detection
3. `agent/src/backends/local/db.ts` — SQLite layer
4. `agent/src/backends/local/event-bus.ts` — In-process events
5. `agent/src/backends/local/config.ts` — Standalone config
6. `agent/src/backends/local/index.ts` — LocalBackend
7. `agent/src/backends/local/orchestrator.ts` — Local task orchestrator
8. `agent/src/backends/cloud/index.ts` — CloudBackend stub
9. `agent/src/commands/init-standalone.ts` — CLI init command
10. `agent/src/commands/run-standalone.ts` — CLI run command
11. `agent/src/commands/prd-standalone.ts` — CLI prd command

**Modified files:**
1. `agent/build.mjs` — Drop minification
2. `agent/src/local-api.ts` — Backend-aware endpoints + export PRD functions
3. `agent/src/index.ts` — Standalone startup path
4. `agent/src/cli.ts` — New CLI commands
5. `packages/vscode-workermill/src/status-bar.ts` — Mode indicator

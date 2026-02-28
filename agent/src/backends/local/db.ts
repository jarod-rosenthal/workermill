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
        "Install the agent binary (which embeds Bun) or run via 'bun' instead of 'node'.",
    );
  }

  dbInstance = new Database(DB_PATH);

  // Run schema — all CREATE IF NOT EXISTS, safe to re-run
  dbInstance.exec(SCHEMA_SQL);

  // Track schema version
  const existing = dbInstance
    .prepare("SELECT value FROM schema_info WHERE key = 'version'")
    .get();
  if (!existing) {
    dbInstance
      .prepare(
        "INSERT INTO schema_info (key, value) VALUES ('version', ?)",
      )
      .run(String(SCHEMA_VERSION));
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
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | null;
  return row?.value ?? null;
}

/** Set a setting value in the settings table. */
export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
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

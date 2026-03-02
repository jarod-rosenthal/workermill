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

const SCHEMA_VERSION = 4;

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

/** Migration v2: Add token usage columns to tasks + error_type to task_logs. */
function migrateToV2(db: any): void {
  // Add token usage columns — idempotent (ALTER TABLE ADD COLUMN IF NOT EXISTS not in SQLite,
  // so we check the schema first)
  const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
  const colNames = new Set(cols.map((c: { name: string }) => c.name));

  if (!colNames.has("input_tokens")) {
    db.exec("ALTER TABLE tasks ADD COLUMN input_tokens INTEGER DEFAULT 0");
  }
  if (!colNames.has("output_tokens")) {
    db.exec("ALTER TABLE tasks ADD COLUMN output_tokens INTEGER DEFAULT 0");
  }
  if (!colNames.has("cache_creation_tokens")) {
    db.exec("ALTER TABLE tasks ADD COLUMN cache_creation_tokens INTEGER DEFAULT 0");
  }
  if (!colNames.has("cache_read_tokens")) {
    db.exec("ALTER TABLE tasks ADD COLUMN cache_read_tokens INTEGER DEFAULT 0");
  }
  if (!colNames.has("estimated_cost_usd")) {
    db.exec("ALTER TABLE tasks ADD COLUMN estimated_cost_usd REAL DEFAULT 0");
  }
  if (!colNames.has("github_pr_url")) {
    db.exec("ALTER TABLE tasks ADD COLUMN github_pr_url TEXT");
  }

  // Add error_type column to task_logs for error classification
  const logCols = db.prepare("PRAGMA table_info(task_logs)").all() as { name: string }[];
  const logColNames = new Set(logCols.map((c: { name: string }) => c.name));
  if (!logColNames.has("error_type")) {
    db.exec("ALTER TABLE task_logs ADD COLUMN error_type TEXT");
  }
}

/** Migration v3: Add personas and persona_directives tables. */
function migrateToV3(db: any): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      emoji TEXT,
      color TEXT,
      short_label TEXT,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 0,
      skills TEXT,
      risk_level TEXT DEFAULT 'medium',
      keyword_pattern TEXT,
      label_shortcuts TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS persona_directives (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      persona_id TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      filename TEXT,
      content TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      change_summary TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_persona_directives_persona ON persona_directives(persona_id, type, is_active);
  `);
}

/** Migration v4: Add directive_usage + memory tables for Phase 6. */
function migrateToV4(db: any): void {
  db.exec(`
    -- Directive usage tracking
    CREATE TABLE IF NOT EXISTS directive_usage (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      task_id TEXT NOT NULL,
      directive_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      type TEXT NOT NULL,
      persona_slug TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_directive_usage_task ON directive_usage(task_id);
    CREATE INDEX IF NOT EXISTS idx_directive_usage_directive ON directive_usage(directive_id);

    -- Semantic memory (conventions, patterns, rules)
    CREATE TABLE IF NOT EXISTS semantic_memories (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      repository TEXT,
      scope TEXT NOT NULL DEFAULT 'repository',
      category TEXT NOT NULL DEFAULT 'convention',
      subject TEXT NOT NULL,
      knowledge TEXT NOT NULL,
      confidence REAL DEFAULT 0.5,
      source TEXT DEFAULT 'explicit',
      evidence_count INTEGER DEFAULT 1,
      retrieval_count INTEGER DEFAULT 0,
      last_retrieved_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_semantic_repo ON semantic_memories(repository, scope, category);

    -- Episodic memory (task outcomes, events)
    CREATE TABLE IF NOT EXISTS episodic_memories (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      task_id TEXT,
      repository TEXT,
      event_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      details TEXT,
      outcome TEXT NOT NULL DEFAULT 'success',
      outcome_details TEXT,
      persona TEXT,
      model TEXT,
      retrieval_count INTEGER DEFAULT 0,
      last_retrieved_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_episodic_repo ON episodic_memories(repository, event_type);

    -- Procedural memory (learned skills/procedures)
    CREATE TABLE IF NOT EXISTS procedural_memories (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL,
      slug TEXT UNIQUE,
      description TEXT,
      insight TEXT,
      repository TEXT,
      applicable_to TEXT,
      steps TEXT NOT NULL,
      prerequisites TEXT,
      source_task_id TEXT,
      success_count INTEGER DEFAULT 0,
      failure_count INTEGER DEFAULT 0,
      retrieval_count INTEGER DEFAULT 0,
      last_retrieved_at TEXT,
      last_used_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_procedural_repo ON procedural_memories(repository);
  `);
}

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

  // Try bun:sqlite first (Bun runtime), fall back to better-sqlite3 (Node.js)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Database = require("bun:sqlite").Database;
  } catch {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      Database = require("better-sqlite3");
    } catch {
      throw new Error(
        "No SQLite driver available. Install better-sqlite3: npm install better-sqlite3",
      );
    }
  }

  dbInstance = new Database(DB_PATH);

  // Run schema — all CREATE IF NOT EXISTS, safe to re-run
  dbInstance.exec(SCHEMA_SQL);

  // Track schema version and run migrations
  const existing = dbInstance
    .prepare("SELECT value FROM schema_info WHERE key = 'version'")
    .get() as { value: string } | undefined;
  const currentVersion = existing ? parseInt(existing.value, 10) : 0;

  if (!existing) {
    dbInstance
      .prepare(
        "INSERT INTO schema_info (key, value) VALUES ('version', ?)",
      )
      .run(String(SCHEMA_VERSION));
  }

  // Run incremental migrations
  if (currentVersion < 2) {
    migrateToV2(dbInstance);
    dbInstance
      .prepare(
        "INSERT INTO schema_info (key, value) VALUES ('version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(String(2));
  }

  if (currentVersion < 3) {
    migrateToV3(dbInstance);
    dbInstance
      .prepare(
        "INSERT INTO schema_info (key, value) VALUES ('version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(String(3));
  }

  if (currentVersion < 4) {
    migrateToV4(dbInstance);
    dbInstance
      .prepare(
        "INSERT INTO schema_info (key, value) VALUES ('version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(String(4));
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

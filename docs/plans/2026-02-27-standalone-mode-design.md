# Standalone Mode Design

## Goal

Make the WorkerMill VS Code extension + agent fully operational without the WorkerMill cloud API. Users bring their own LLM API keys, all data stays local. Premium features (cloud dashboard, team collaboration, Jira/Linear sync, analytics, managed compute) are available by connecting to workermill.com.

## Constraints

- **Full orchestration** — open-source gets everything: PRD decomposition, multi-expert epics, boards, coordination, quality gates
- **BYOK** — users provide their own Claude/OpenAI/etc. API keys via local config
- **SQLite embedded** — zero-config local persistence using Bun's built-in `bun:sqlite`
- **Premium = team/cloud** — cloud dashboard, shared boards, Jira/Linear, analytics, managed compute
- **SSE multiplexer compatible** — uses the same wire format and endpoint surface defined in `docs/plans/2026-02-26-unified-sse-multiplexer-design.md`
- **Readable builds** — no minification or mangling; ship source maps and preserve license comments

---

## Architecture

### Backend Abstraction

Introduce a `Backend` interface in the agent. Two implementations:

```
┌─────────────────────┐
│   VS Code Extension │  (unchanged — talks to agent local API)
└─────────┬───────────┘
          │ HTTP (localhost)
┌─────────▼───────────┐
│   Agent Local API   │  (routes to active backend)
│   local-api.ts      │
└─────────┬───────────┘
          │
    ┌─────┴─────┐
    │           │
┌───▼───┐  ┌───▼───┐
│ Cloud │  │ Local │
│Backend│  │Backend│
└───┬───┘  └───┬───┘
    │          │
Cloud API   SQLite + In-Process EventEmitter
(premium)   (standalone / open-source)
```

**Mode selection:** On first run, the agent checks for `~/.workermill/config.json`. If absent or `mode: "standalone"`, it uses `LocalBackend`. If `mode: "cloud"` with an API key, it uses `CloudBackend`. Users can switch modes at any time.

**VS Code extension does not change** — it talks to the agent local API regardless of which backend is active. Same endpoints, same response shapes.

### SSE Multiplexer Compatibility

The unified SSE multiplexer (`docs/plans/2026-02-26-unified-sse-multiplexer-design.md`) defines the endpoint surface and wire format that both backends implement:

| SSE Multiplexer Defines | LocalBackend Implements As |
|-------------------------|---------------------------|
| `GET /api/stream` (unified SSE) | In-process EventEmitter → SSE writer |
| `POST /api/stream/subscribe` | Subscribe to local event channels |
| `POST /api/stream/unsubscribe` | Unsubscribe from local channels |
| `GET /api/backfill/{type}/:taskId` | Query local SQLite |
| Wire format: `{ ch, t, p }` | Same format — VS Code code is identical |
| Composite event IDs: `{counter}:{epoch_ms}` | Same format |
| Channel names: `logs:{taskId}`, `coordination:{taskId}`, etc. | Same names |

**Collision with SSE implementation:** The only overlap is SSE Phase 3 (Tasks 10-13: agent + VS Code migration). Both plans modify `agent/src/local-api.ts`. Resolution: Phase B of this plan wraps existing agent code into `CloudBackend` at the same time SSE Phase 3 adds the unified stream client. The `AgentBackend` interface is the integration point — both changes are additive, not conflicting.

---

## Build System Changes

The agent build (`agent/build.mjs`) currently minifies and mangles all output. For open source, this is counterproductive — makes bug reports unreadable, hides license notices from bundled dependencies, and complicates debugging.

### Changes to `build.mjs` shared config

| Setting | Current | Open-Source | Rationale |
|---------|---------|-------------|-----------|
| `minify` | `true` | `false` | Readable stack traces, debuggable output |
| `mangleProps` | `/_$/` | `undefined` | No property mangling — code is public anyway |
| `sourcemap` | `false` | `true` | Ship source maps for debuggability |
| `legalComments` | `"none"` | `"eof"` | Preserve license headers from bundled deps (MIT/Apache/ISC compliance) |
| `treeShaking` | `true` | `true` | Still remove unused code — optimization, not obfuscation |

**Binary size impact:** Negligible. Bun runtime (~85MB) and inlined npm dependencies dominate. Unminified JS adds ~2-3MB.

The standalone binary bundle (`entry.js`) already disables `mangleProps` (line 143 — broke inlined SDKs). After this change, all bundles are consistent.

Banner comments on worker bundles (`// WorkerMill Worker - minified`) updated to remove "minified".

---

## AgentBackend Interface

```typescript
// agent/src/backends/types.ts

interface StreamEvent {
  ch: string;  // channel name (e.g., "logs:{taskId}")
  t: string;   // event type within channel
  p: unknown;  // payload
}

interface BackfillResponse {
  data: unknown[];
  cursor: string | null;  // ISO timestamp of newest event
}

interface ClaimResult {
  claimed: boolean;
  task?: TaskInfo;
  credentials?: { scmToken?: string };
}

interface AgentBackend {
  readonly mode: "cloud" | "local";

  // Lifecycle
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  // === Real-time stream ===
  onStreamEvent(handler: (event: StreamEvent) => void): void;
  offStreamEvent(handler: (event: StreamEvent) => void): void;
  subscribeChannels(channels: string[]): Promise<void>;
  unsubscribeChannels(channels: string[]): Promise<void>;

  // === Backfill (one-shot reads) ===
  getLogBackfill(taskId: string, limit?: number): Promise<BackfillResponse>;
  getCoordinationBackfill(taskId: string, limit?: number): Promise<BackfillResponse>;
  getCodeBackfill(taskId: string): Promise<BackfillResponse>;

  // === Tasks ===
  getTasks(): Promise<TaskInfo[]>;
  getTask(id: string): Promise<TaskInfo | null>;
  createTask(input: CreateTaskInput): Promise<TaskInfo>;
  cancelTask(id: string): Promise<void>;
  retryTask(id: string): Promise<void>;

  // === Task execution (orchestrator) ===
  pollForWork(): Promise<TaskInfo[]>;
  claimTask(taskId: string): Promise<ClaimResult>;
  reportTaskStarted(taskId: string): Promise<void>;
  reportTaskCompleted(taskId: string, result: TaskResult): Promise<void>;
  reportTaskFailed(taskId: string, error: string): Promise<void>;

  // === Logging ===
  postLog(entry: LogEntry): Promise<void>;
  postLogBatch(entries: LogEntry[]): Promise<void>;

  // === Coordination ===
  postCoordinationMessage(msg: CoordinationMessage): Promise<void>;
  getCoordinationContext(taskId: string): Promise<CoordinationMessage[]>;
  talkToWorker(taskId: string, message: string): Promise<void>;
  respondToBlocker(taskId: string, response: BlockerResponse): Promise<void>;

  // === Code events ===
  postCodeEvent(event: CodeEvent): Promise<void>;

  // === Planning (PRD) ===
  getPrdPrompt(): Promise<string>;
  decomposePrd(input: PrdInput): Promise<Board>;

  // === Boards ===
  getBoards(): Promise<Board[]>;
  getBoard(id: string): Promise<Board | null>;
  createBoard(input: CreateBoardInput): Promise<Board>;
  updateBoard(id: string, input: Partial<Board>): Promise<Board>;
  deleteBoard(id: string): Promise<void>;
  getBoardCards(boardId: string): Promise<Card[]>;
  createCard(boardId: string, input: CreateCardInput): Promise<Card>;
  updateCard(cardId: string, input: Partial<Card>): Promise<Card>;
  moveCard(cardId: string, columnId: string, position: number): Promise<void>;
  runCard(boardId: string, cardId: string): Promise<TaskInfo>;
  runAllCards(boardId: string): Promise<void>;

  // === Config ===
  getSettings(): Promise<AgentSettings>;
  updateSettings(input: Partial<AgentSettings>): Promise<void>;
  getRepos(): Promise<RepoInfo[]>;

  // === Plan approval ===
  approvePlan(taskId: string): Promise<void>;
  rejectPlan(taskId: string, feedback: string): Promise<void>;
}
```

---

## SQLite Schema (LocalBackend)

Stored at `~/.workermill/data.db`. Uses Bun's built-in `bun:sqlite` (zero dependencies). WAL mode enabled for concurrent read/write from multiple worker processes.

```sql
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- Settings (key-value)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Boards (Kanban)
CREATE TABLE boards (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  description TEXT,
  quality_gate_commands TEXT, -- JSON array
  ci_workflow_path TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE board_columns (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  is_done_column INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE cards (
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

CREATE TABLE card_dependencies (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  depends_on_card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE
);

-- Tasks
CREATE TABLE tasks (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  board_id TEXT REFERENCES boards(id),
  card_id TEXT REFERENCES cards(id),
  summary TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  execution_plan TEXT, -- JSON (stories array)
  github_repo TEXT,
  scm_provider TEXT,
  worker_model TEXT,
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
CREATE TABLE task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  type TEXT NOT NULL DEFAULT 'execution',
  message TEXT NOT NULL,
  severity TEXT DEFAULT 'info',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_task_logs_task_id ON task_logs(task_id, created_at);

-- Coordination
CREATE TABLE coordination_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_task_id TEXT NOT NULL,
  task_id TEXT,
  message_type TEXT NOT NULL,
  content TEXT NOT NULL, -- JSON
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_coord_parent ON coordination_messages(parent_task_id, created_at);

-- Code events
CREATE TABLE code_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  file_path TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  expert TEXT,
  metadata TEXT, -- JSON
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_code_events_task ON code_events(task_id, created_at);
```

**Intentionally omitted (premium/cloud only):** organizations, users, auth, billing, quotas, Jira/Linear, codebase indexing/RAG, remote agent registration, token usage tracking, analytics.

---

## Local Event Bus

In standalone mode, there is no Redis. An in-process `EventEmitter` handles real-time event delivery, using the same wire format as the SSE multiplexer:

```typescript
// agent/src/backends/local/event-bus.ts
import { EventEmitter } from "events";

const bus = new EventEmitter();
bus.setMaxListeners(100);

export function emitStreamEvent(channel: string, type: string, payload: unknown): void {
  bus.emit("stream-event", { ch: channel, t: type, p: payload });
}

export function onStreamEvent(handler: (event: StreamEvent) => void): void {
  bus.on("stream-event", handler);
}

export function offStreamEvent(handler: (event: StreamEvent) => void): void {
  bus.off("stream-event", handler);
}
```

When `LocalBackend.postLog()` writes to SQLite, it also calls `emitStreamEvent("logs:{taskId}", "log", {...})`. The agent local API's `GET /api/stream` endpoint listens and writes events to the SSE response — identical to how `CloudBackend` re-broadcasts cloud events.

---

## Local Orchestration

In standalone mode, the agent IS the orchestrator. No separate service, no polling loop — task pickup is event-driven via direct function calls.

### Task Execution Flow

```
User clicks "Run" on a card in VS Code
  → Extension POST /api/boards/:boardId/cards/:cardId/run (agent local API)
  → LocalBackend creates task in SQLite (status: queued)
  → Emits stream event on tasks channel
  → Local orchestrator claims task (atomic UPDATE...WHERE status = 'queued')
  → Spawns worker process (self-invocation: process.execPath with __WORKERMILL_MODE=worker)
  → Worker posts logs/coordination/code events to agent local API (localhost)
  → Agent writes to SQLite + emits stream events
  → VS Code extension receives via SSE, updates UI
```

### Local Orchestrator

```typescript
// agent/src/backends/local/orchestrator.ts

async function processQueuedTask(taskId: string): Promise<void> {
  const db = getDb();

  // Atomic claim
  const claimed = db.run(
    `UPDATE tasks SET status = 'executing', started_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ? AND status = 'queued'`, taskId
  );
  if (claimed.changes === 0) return; // Already claimed or status changed

  // Check concurrency limit
  const { count } = db.get(`SELECT COUNT(*) as count FROM tasks WHERE status = 'executing'`);
  const maxParallel = getSettingInt("max_parallel_experts", 4);
  if (count > maxParallel) {
    db.run(`UPDATE tasks SET status = 'queued', started_at = NULL WHERE id = ?`, taskId);
    return;
  }

  emitStreamEvent("org:local:tasks", "task_state", { taskId, status: "executing" });

  await spawnLocalWorker(claimed);
}
```

### Worker Environment (Standalone)

Workers are self-invocations (`process.execPath` with `__WORKERMILL_MODE=worker`), identical to the current remote agent native spawner. The only difference is where they POST results:

| Data Flow | Cloud Mode | Standalone Mode |
|-----------|-----------|----------------|
| Log posting | `POST https://workermill.com/api/...` | `POST http://localhost:{port}/api/...` |
| Coordination | Cloud API | Agent local API |
| Code events | Cloud API | Agent local API |
| SCM tokens | From org credentials (claim response) | From `~/.workermill/config.json` |
| LLM API key | From org settings | From `~/.workermill/config.json` |

Workers don't know or care which mode they're in — same endpoints, same payloads.

### Multi-Expert Epics

Same as the remote agent's `spawner.ts` — the execution plan has stories, the orchestrator spawns one worker per story (up to `max_parallel_experts`), coordination happens via SQLite `coordination_messages` table + event bus.

### Board Execution Engine

Simplified version of the cloud's `board-execution.ts`. When a card's task completes:

1. Query `card_dependencies` for cards depending on the completed card
2. For each dependent: check if ALL its dependencies are now complete
3. If yes, create a task (status: queued) and trigger the orchestrator
4. Local orchestrator claims and spawns the worker

### Stale Task Detection

Periodic sweep (every 60s) checks for tasks in `executing` status where the worker PID is no longer running (`kill(pid, 0)` check). Marks them as failed with "Worker process exited unexpectedly."

---

## Planning Flow (Standalone)

Planning already runs locally in the agent (`agent/src/planner.ts`). In standalone mode:

1. Agent has the PRD prompt bundled (already exists as fallback in `local-api.ts`)
2. Planner clones the target repo, runs Claude CLI with the PRD prompt
3. Critic validates the plan (threshold: 85/100)
4. On approval, LocalBackend creates child tasks in SQLite from the execution plan
5. Local orchestrator picks them up and spawns workers

No cloud dependency — the only external call is to the LLM API using the user's own key.

---

## Configuration & Onboarding

### Config File

Sensitive config (API keys, tokens) lives in `~/.workermill/config.json`, not SQLite:

```json
{
  "mode": "standalone",
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "apiKey": "sk-ant-..."
  },
  "scm": {
    "provider": "github",
    "token": "ghp_..."
  },
  "defaultRepo": "https://github.com/user/myapp",
  "settings": {
    "maxParallelExperts": 4,
    "maxStories": 8
  }
}
```

### VS Code Onboarding

First-run panel in VS Code when no config exists:

1. **Mode selection** — "Run Standalone" or "Connect to WorkerMill Cloud"
2. **Standalone setup** — LLM provider + API key, default repo, SCM token (optional)
3. Agent initializes SQLite, creates default board columns (Backlog, In Progress, Done)
4. Extension sidebar shows the empty board — ready to go

### Premium Upgrade Path

At any time, a standalone user can connect to workermill.com:

1. Click "Connect to WorkerMill Cloud" in extension settings
2. GitHub OAuth flow → creates WorkerMill account
3. Agent switches from `LocalBackend` to `CloudBackend`
4. Local data stays — SQLite is not deleted, user can switch back
5. Cloud features activate

Switching back to standalone restores local data from SQLite.

---

## Feature Matrix

| Feature | Standalone (Free) | Cloud (Premium) |
|---------|-------------------|-----------------|
| Board/Kanban management | Local SQLite | Cloud, shareable |
| PRD decomposition | Local Claude CLI | Local Claude CLI |
| Multi-expert execution | Local processes | Local or cloud ECS |
| Real-time logs/code view | Local SSE | Cloud SSE + web dashboard |
| Quality gates | Pre-commit + CI polling | Same |
| Planning + critic | Local | Local |
| Web dashboard | None (VS Code only) | workermill.com/boards |
| Team collaboration | None (single user) | Shared boards, multi-user |
| Jira/Linear sync | None | Bi-directional sync |
| Analytics/cost tracking | None | Full dashboard |
| Multiple orgs | None | Multi-org support |
| Managed compute (ECS) | None (local only) | Cloud workers |

---

## CLI Standalone Mode (Headless)

The agent binary works without VS Code:

```bash
workermill-agent init --standalone    # Interactive setup
workermill-agent run --repo <url> --task "Add user auth"  # Run a task
workermill-agent prd --repo <url> --file prd.md           # Decompose a PRD
```

Works because the agent local API serves the same endpoints regardless of whether VS Code is connected.

---

## Implementation Phases

### Phase A: Build System + Backend Abstraction + LocalBackend Foundation

Greenfield files — zero collision with SSE multiplexer.

1. **Open-source build config** — remove minification/mangling from `build.mjs`, add source maps, preserve license comments
2. **AgentBackend interface** — `agent/src/backends/types.ts`
3. **SQLite database layer** — `agent/src/backends/local/db.ts` (schema init, migrations, query helpers)
4. **Local event bus** — `agent/src/backends/local/event-bus.ts`
5. **LocalBackend implementation** — `agent/src/backends/local/index.ts` (tasks, logs, coordination, code events, boards, settings)
6. **Config management** — `agent/src/backends/local/config.ts` (reads `~/.workermill/config.json`, merges with SQLite settings)
7. **Local orchestrator** — `agent/src/backends/local/orchestrator.ts` (claim, spawn workers, dependency cascade, stale task sweep)

### Phase B: CloudBackend Wrapper (Coordinates with SSE Phase 3)

Wraps existing agent code behind the AgentBackend interface.

8. **CloudBackend implementation** — `agent/src/backends/cloud/index.ts` (wraps `api.ts`, `poller.ts`, `unified-stream.ts`)
9. **Backend selector** — `agent/src/backends/selector.ts` (reads config, returns CloudBackend or LocalBackend)
10. **Refactor local-api.ts** — delegate all handlers to the active backend

### Phase C: Agent Local API Endpoints for Standalone

Endpoints that LocalBackend serves — same surface the VS Code extension already calls.

11. **Board management** — CRUD for boards, columns, cards, run/run-all
12. **Task management** — create, cancel, retry, list, detail
13. **Worker ingestion** — logs, coordination, code events (workers POST to these)
14. **Settings + repos** — GET/PATCH settings, list repos
15. **Backfill** — `GET /api/backfill/{logs,coordination,code}/:taskId`
16. **Stream** — `GET /api/stream` (local SSE from event bus)

### Phase D: VS Code Extension Onboarding

17. **Standalone onboarding webview** — mode selection, LLM key, repo, SCM token
18. **Mode indicator** — status bar shows "Standalone" vs "Cloud"
19. **Standalone settings panel** — LLM provider/model/key, SCM config

### Phase E: PRD & Planning in Standalone

20. **Bundle PRD prompt as primary** — not fallback, in standalone mode
21. **Local PRD decomposition** — `POST /api/prd/build` creates board + cards in SQLite
22. **Board execution engine** — dependency cascade on task completion

### Phase F: CLI Standalone Commands

23. **`workermill-agent init --standalone`** — interactive setup
24. **`workermill-agent run`** — run a task from CLI
25. **`workermill-agent prd`** — decompose a PRD from CLI

### Phase Dependency Map

```
Phase A (LocalBackend)  ████████░░░░░░░░░░  ← start immediately, zero collision
Phase B (CloudBackend)  ░░░░████████░░░░░░  ← coordinates with SSE Phase 3
Phase C (Local API)     ░░░░░░░░████████░░  ← depends on Phase A
Phase D (VS Code)       ░░░░░░░░░░████████  ← depends on Phase C
Phase E (PRD/Planning)  ░░░░░░░░████████░░  ← depends on Phase A, parallel with C
Phase F (CLI)           ░░░░░░░░░░░░████░░  ← depends on Phase C

SSE Multiplexer (parallel):
Phase 0-2 (Server+Dash) ████████████░░░░░░  ← zero collision
Phase 3 (Agent+VSCode)  ░░░░░░░░░░████████  ← converges with Phase B
Phase 4-6 (Worker+Infra)░░░░░░░░████████░░  ← independent
```

---

## File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `agent/src/backends/types.ts` | AgentBackend interface + shared types |
| `agent/src/backends/selector.ts` | Mode detection, returns correct backend |
| `agent/src/backends/local/index.ts` | LocalBackend implementation |
| `agent/src/backends/local/db.ts` | SQLite schema, migrations, query helpers |
| `agent/src/backends/local/event-bus.ts` | In-process EventEmitter (SSE wire format) |
| `agent/src/backends/local/config.ts` | Config file management |
| `agent/src/backends/local/orchestrator.ts` | Local task orchestration |
| `agent/src/backends/local/board-engine.ts` | Dependency cascade on completion |
| `agent/src/backends/cloud/index.ts` | CloudBackend wrapping existing code |

### Modified Files

| File | Change | Risk |
|------|--------|------|
| `agent/build.mjs` | Drop minify/mangle, add sourcemap, preserve licenses | Low |
| `agent/src/index.ts` | Add backend selector, pass to local-api | Low |
| `agent/src/local-api.ts` | Delegate handlers to backend | Medium |
| `agent/src/spawner.ts` | Use backend for task reporting | Low |
| `packages/vscode-workermill/src/` | Add onboarding panel, mode indicator | Low |

### Unchanged

`api/`, `frontend/`, `worker/epic/`, `infrastructure/` — no changes.

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| SQLite concurrent write contention | Medium | WAL mode allows concurrent reads during writes. Workers write to different tables. Single-writer semantics are fine for local use. |
| PRD prompt drift between cloud and standalone | Medium | Standalone bundles prompt at build time with version. Users update by updating the agent binary. |
| User loses SQLite file | Low | `~/.workermill/data.db` — standard location. Data is recreatable (boards/tasks). Suggest backups in docs. |
| Workers crash, tasks stuck in executing | Medium | 60s periodic sweep checks worker PID liveness. Marks dead workers' tasks as failed. |
| Bun SQLite edge cases | Low | Simple query patterns (no complex JOINs). WAL mode is well-tested in Bun. |
| Binary size increase | Negligible | SQLite is built into Bun (0 bytes added). Unminified JS adds ~2-3MB to ~90MB binary. |
| License compliance for bundled deps | Medium | `legalComments: "eof"` preserves all license headers. Was previously stripping them with `"none"`. |

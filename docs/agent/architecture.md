# Architecture

## Key Models (`api/src/models/`)

Core models that require context to use correctly. Discover others by browsing the directory.

| Model | Purpose | Notes |
|-------|---------|-------|
| `WorkerTask` | Task state, cost tracking, git info | Central entity — use atomic `UPDATE...WHERE` for status changes (see Common Pitfalls) |
| `WorkerTaskLog` | Terminal log storage for SSE streaming | Worker POSTs to `/api/tasks/:taskId/logs`, SSE streams from DB every 500ms |
| `Organization` | Multi-tenant org (settings, API keys, billing) | All settings keyed per-org; `apiKey` used by workers |
| `RemoteAgent` | Agent registration and heartbeat | `last_heartbeat_at` MUST always update (see Heartbeat pitfall) |
| `KbBoard`, `KbColumn`, `KbCard` | Kanban boards (Trello-like, visible on dashboard) | **This is the user-facing board system** |
| `Project`, `BoardColumn`, `InternalTask` | Jira-like project system | **Separate from Kanban boards** — NOT visible in Boards UI. See "Two Board Systems" pitfall below |
| `Persona`, `PersonaDirective` | Worker personas and role-specific directives | 14 roles in `worker/directives/` |
| `WorkerCommand` | Worker-to-worker and user-to-worker messaging | Talk button → `POST /api/coordination/commands` |

## Key API Routes (`api/src/routes/`)

Core routes that you'll touch most often. Some are directories with sub-route files (marked with `/`). Discover others by browsing the directory.

| Route | Purpose | Auth |
|-------|---------|------|
| `webhooks/` | Jira, GitHub, GitLab, BitBucket, Linear, email receivers | API key / webhook secret |
| `control-center/` | Task management, log streaming SSE, dashboard, search | JWT (dashboard) |
| `tasks/` | Task CRUD, worker log ingestion (directory with sub-routes) | Mixed (JWT + API key) |
| `orchestrator.ts` | Poll loop, system control (start/stop/status) | JWT |
| `boards.ts` | Kanban boards CRUD — cards, columns, labels, checklists | JWT |
| `remote-agent.ts` | Agent registration, heartbeat, task claim/result | API key |
| `worker-decisions.ts` | Worker decision engine (error classification, quality gates) | API key |
| `coordination.ts` | Multi-worker file locking and task communication | API key |
| `auth.ts` | Cognito, GitHub/Google/Microsoft OAuth, SSO config | Public + JWT |
| `settings/` | Organization settings CRUD (general, integrations, models) | JWT |

## Task Flow (Four Execution Paths)

**Path 1 — Standalone Agent (VS Code, no cloud):**
```
VS Code (Run Task / Run Issue) ──→ Agent local API creates task in SQLite
                                          ↓
                                   Local orchestrator picks up immediately (event-driven)
                                          ↓
                                   Agent runs planner (Claude CLI)
                                          ↓
                                   Critic validates plan (score >= 85/100, max 3 iterations)
                                          ↓
                                   Spawns native worker process
                                   (__WORKERMILL_MODE=worker, self-invocation of agent binary)
                                          ↓
                                   Worker runs Epic Coordinator → experts in parallel
                                          ↓
                                   Worker reports result → agent updates SQLite
```

**Path 2 — Cloud Agent (production, team workflows):**
```
Jira/GitHub webhook ──────┐
VS Code (Run Issue) ──────┤→ Cloud API creates task (status: planning)
Dashboard (Run Task) ─────┘       ↓
                           Agent polls /api/agent/poll
                                  ↓
                           Agent claims task → runs planner (Claude CLI)
                                  ↓
                           Critic validates plan (score >= 85/100, max 3 iterations)
                                  ↓
                           Agent posts plan → API sets status: queued
                                  ↓
                           Agent claims queued task → spawns native worker process
                           (__WORKERMILL_MODE=worker, self-invocation of agent binary)
                                  ↓
                           Worker runs Epic Coordinator → experts in parallel
                                  ↓
                           Worker posts ::result:: marker → API updates status
```

**Path 3 — Local WorkerMill Docker (API development, NO planning):**
```
Dashboard (localhost:5173) → Local API creates task (status: queued, skips planning)
                                  ↓
                           Local orchestrator polls DB → claims task
                                  ↓
                           local-epic-spawner.ts → Docker container
                           (workermill-worker:local image)
                                  ↓
                           Container runs Epic Coordinator → experts
                                  ↓
                           Worker posts ::result:: → API updates status
```

**Path 4 — Cloud Container (legacy, requires cloud agent for planning):**
```
Task created (status: planning) → Cloud agent plans → status: queued
                                  ↓
                           Cloud orchestrator claims → container task
                                  ↓
                           Container runs Epic Coordinator
```

**VS Code works with Path 1 (standalone) and Path 2 (cloud agent).** In both cases the extension connects to the agent's local HTTP API — it never talks to the cloud API directly. For Path 3 (local Docker dev), use the web dashboard at localhost:5173, or run the cloud agent pointed at `http://localhost:3001`.

## Backend Abstraction Layer

The agent uses a pluggable backend to support standalone and cloud modes:

```
agent/src/backends/
  types.ts          — AgentBackend interface (27+ methods)
  selector.ts       — Reads config, returns CloudBackend or LocalBackend
  cloud/index.ts    — CloudBackend (wraps cloud API + poller)
  local/
    config.ts       — StandaloneConfig, resolveApiKey, isCloudMode
    db.ts           — SQLite via better-sqlite3 (WAL mode)
    event-bus.ts    — In-process EventEmitter (replaces Redis pub/sub)
    orchestrator.ts — Event-driven task dispatch, worker process management
    index.ts        — LocalBackend (full AgentBackend implementation)
```

The `LocalBackend` stores everything in SQLite (`~/.workermill/data.db`): tasks, logs, coordination messages, code events, boards, personas, directives, and memories. The event bus replaces Redis pub/sub for real-time SSE streaming to VS Code.

## Worker System

Directives in `worker/directives/` define role-specific behavior (14 roles):
- `architect/`, `backend_developer/`, `frontend_developer/`, `mobile_developer/`
- `devops_engineer/`, `data_ml_engineer/`, `security_engineer/`, `qa_engineer/`
- `tech_writer/`, `tech_lead/`, `project_manager/`, `manager/`, `support_agent/`
- `common/` (shared directives used across roles)

See `worker/AGENTS.md` for comprehensive worker instructions.

> **IMPORTANT:** `worker/AGENTS.md` contains instructions for AI workers that execute tasks on **target repositories**. These workers run as native processes (standalone/cloud agent) or inside Docker containers and use execution scripts in `/app/execution-compiled/`. This is **NOT** relevant when working on the WorkerMill codebase itself.

## Worker Decision Service

Worker decision logic (error classification, quality gates, review parsing, question routing, provider routing) is served at `/api/worker-decisions/`. Core logic lives in `api/src/services/worker-decision-engine.ts`. In standalone mode, the same code runs inside the agent binary directly. Workers call via `DecisionClient` (`worker/epic/decision-client.ts`) with 5-retry, circuit breaker, and safe fallbacks.

## Frontend Architecture

React 19 + Vite + TailwindCSS + Zustand. Routing via React Router v7 (`App.tsx`). Auth via `useAuthStore` (Zustand) — backend uses Cognito, frontend stores JWT in localStorage. Forms via React Hook Form + Zod.

## Multi-Provider Support

**AI Providers:** `anthropic` (default), `openai`, `google`, `ollama` — all production. Models discoverable in org settings (cloud) or `~/.workermill/config.json` (standalone).

**SCM Providers:** `github` (Bearer token), `gitlab` (PRIVATE-TOKEN), `bitbucket` (Repository Access Token). Each needs credentials in Settings > Integrations (cloud) or in the standalone config.

---

## Execution Modes

There are four ways tasks are executed, depending on where the worker runs:

| Environment | Worker runs as | Planning | Docker needed? |
|-------------|---------------|----------|----------------|
| **Standalone Agent** (default) | Native process (self-invocation of agent binary) | Yes (agent planner) | **No** |
| **Cloud Agent** (production) | Native process (self-invocation of agent binary) | Yes (agent planner) | **No** |
| **Local WorkerMill** (API development) | Docker container (`workermill-worker:local`) | No (skipped) | **Yes** |
| **Cloud Container** (legacy) | Container task | Yes (agent planner, separate step) | Yes |

### Epic Mode (Anthropic provider)

Planning Agent decomposes task → Epic Coordinator runs → Claude CLI expert subprocesses work in parallel via git worktrees → Coordination feed for collaboration → Consolidated PR.

**Components:** `worker/epic/coordinator.ts`, `executor.ts`, `experts.ts`, `coordination-client.ts`, `decision-client.ts`, `blocker-manager.ts`, `auto-fix-agent.ts`, `inline-reviewer.ts`, `inline-deployer.ts`, `inline-improver.ts`, `git-ops.ts`, `memory-client.ts`, `ticket-ops.ts`
- In agent: compiled into the agent binary at build time (esbuild bundles from TS source)
- In Docker: compiled by `tsc` during Docker build

### Multi-Provider Mode (non-Anthropic)

Planning Agent decomposes task → Multi-Expert Coordinator → Vercel AI SDK expert calls work in parallel, each persona routed to configured provider → Coordination feed → Consolidated PR.

**Components:** `worker/multi-expert/index.ts`, `coordination-client.ts`, `worker/agents/ai-sdk-executor.js`

### Standard SDK Mode (add `sdk` label)

Single-task execution via Claude Agent SDK (no story decomposition). Useful for smaller tasks that don't need multi-expert parallel execution.

### Blocker Handling & Task Communication

Errors auto-retry (up to `blockerMaxAutoRetries`), then escalate to VS Code or the dashboard with retry/skip/abort options. Key files: `worker/epic/blocker-manager.ts`, `worker/epic/auto-fix-agent.ts`, `api/src/routes/coordination.ts`. Error classification and quality gates are served by the Worker Decision Service (`api/src/services/worker-decision-engine.ts`).

**Task-Scoped Communication:** Talk button sends messages via `POST /api/coordination/commands`. Worker polls `/api/coordination/commands/:taskId/pending`.

---

## Memory System

The agent tracks learning across tasks via three memory types stored in SQLite (standalone) or PostgreSQL (cloud):

- **Semantic memories** — Factual knowledge about repos, patterns, and conventions
- **Episodic memories** — Task-specific outcomes and decisions
- **Procedural memories** — Learned workflows and processes

Related tables: `directive_usage`, `semantic_memories`, `episodic_memories`, `procedural_memories`. Directive effectiveness tracking via `POST /api/directives/usage`.

---

## RAG / Codebase Indexing

Vector-based code search using Ollama embeddings (`nomic-embed-text`, 768 dims) + pgvector. Available in cloud mode only (requires PostgreSQL with pgvector). Must be enabled per org (`codebase_indexing_enabled`). Key files in `api/src/services/`: `embedding.ts`, `code-chunker.ts`, `codebase-indexer.ts`, `codebase-retriever.ts`, `skill-injector.ts`. Ollama URL: org setting `ollamaBaseUrl` → env `OLLAMA_HOST` → `http://localhost:11434`.

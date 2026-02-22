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

## Task Flow (Three Execution Paths)

**Path 1 — Remote Agent (production + VS Code):**
```
Jira/GitHub webhook ──────┐
VS Code (Run Issue) ──────┤→ Cloud API creates task (status: planning)
Dashboard (Run Task) ─────┘       ↓
                           Remote agent polls /api/agent/poll
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

**Path 2 — Local WorkerMill Docker (development, NO planning):**
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

**Path 3 — Cloud ECS (legacy, requires remote agent for planning):**
```
Task created (status: planning) → Remote agent plans → status: queued
                                  ↓
                           Cloud orchestrator claims → ECS Fargate task
                                  ↓
                           Container runs Epic Coordinator
```

**CRITICAL:** VS Code extension ONLY works with Path 1 (remote agent). It does NOT connect to the local API directly. If you want VS Code + local dev, run the remote agent pointed at `http://localhost:3001`.

## Worker System

Directives in `worker/directives/` define role-specific behavior (14 roles):
- `architect/`, `backend_developer/`, `frontend_developer/`, `mobile_developer/`
- `devops_engineer/`, `data_ml_engineer/`, `security_engineer/`, `qa_engineer/`
- `tech_writer/`, `tech_lead/`, `project_manager/`, `manager/`, `support_agent/`
- `common/` (shared directives used across roles)

See `worker/AGENTS.md` for comprehensive worker instructions.

> **IMPORTANT:** `worker/AGENTS.md` contains instructions for AI workers that execute tasks on **target repositories** (e.g., oncallshift). These workers run inside ECS containers and use execution scripts in `/app/execution-compiled/`. This is **NOT** relevant when Claude Code is working on the WorkerMill codebase itself - those instructions are for the spawned worker containers, not for development work on this repository.

## Worker Decision Service (IP Protection)

Worker decision logic (error classification, quality gates, review parsing, question routing, provider routing) is served by the API at `/api/worker-decisions/`. All IP lives in `api/src/services/worker-decision-engine.ts`. Workers call via `DecisionClient` (`worker/epic/decision-client.ts`) with 5-retry, circuit breaker, and safe fallbacks.

## Frontend Architecture

React 19 + Vite + TailwindCSS + Zustand. Routing via React Router v7 (`App.tsx`). Auth via `useAuthStore` (Zustand) — backend uses Cognito, frontend stores JWT in localStorage. Forms via React Hook Form + Zod.

## Multi-Provider Support

**AI Providers:** `anthropic` (default), `openai`, `google`, `ollama` — all production. Models discoverable in org settings.

**SCM Providers:** `github` (Bearer token), `gitlab` (PRIVATE-TOKEN), `bitbucket` (Repository Access Token). Each needs credentials in Settings > Integrations. **oncallshift uses Bitbucket.** See Critical Rules for Bitbucket auth details.

---

## Execution Modes

There are three ways tasks are executed, depending on where the worker runs:

| Environment | Worker runs as | Planning | Docker needed? |
|-------------|---------------|----------|----------------|
| **Remote Agent** (production) | Native process (self-invocation of agent binary) | Yes (agent planner) | **No** |
| **Local WorkerMill** (development) | Docker container (`workermill-worker:local`) | No (skipped) | **Yes** |
| **Cloud ECS** (legacy) | ECS Fargate task | Yes (agent planner, separate step) | Yes (ECR image) |

### Epic Mode (Anthropic provider)

Planning Agent decomposes task → Epic Coordinator runs → Claude CLI expert subprocesses work in parallel via git worktrees → Coordination feed for collaboration → Consolidated PR.

**Components:** `worker/epic/coordinator.ts`, `executor.ts`, `experts.ts`, `coordination-client.ts`, `decision-client.ts`, `blocker-manager.ts`, `auto-fix-agent.ts`, `inline-reviewer.ts`, `inline-deployer.ts`, `inline-improver.ts`, `git-ops.ts`, `memory-client.ts`, `ticket-ops.ts`
- In remote agent: compiled into the agent binary at build time (esbuild bundles from TS source)
- In Docker/ECS: compiled by `tsc` during Docker build

### Multi-Provider Mode (non-Anthropic)

Planning Agent decomposes task → Multi-Expert Coordinator → Vercel AI SDK expert calls work in parallel, each persona routed to configured provider → Coordination feed → Consolidated PR.

**Components:** `worker/multi-expert/index.ts`, `coordination-client.ts`, `worker/agents/ai-sdk-executor.js`

### Standard SDK Mode (add `sdk` label)

Single-task execution via Claude Agent SDK (no story decomposition).

### Blocker Handling & Task Communication

Errors auto-retry (up to `blockerMaxAutoRetries`), then escalate to the dashboard (`BlockerAlert` component) with retry/skip/abort options. Key files: `worker/epic/blocker-manager.ts`, `worker/epic/auto-fix-agent.ts`, `api/src/routes/coordination.ts`. Error classification and quality gates are now served by the Worker Decision Service (`api/src/services/worker-decision-engine.ts`).

**Task-Scoped Communication:** Talk button sends messages via `POST /api/coordination/commands`. Worker polls `/api/coordination/commands/:taskId/pending`.

---

## RAG / Codebase Indexing

Vector-based code search using Ollama embeddings (`nomic-embed-text`, 768 dims) + pgvector. Must be enabled per org (`codebase_indexing_enabled`). Key files in `api/src/services/`: `embedding.ts`, `code-chunker.ts`, `codebase-indexer.ts`, `codebase-retriever.ts`, `skill-injector.ts`. Ollama URL: org setting `ollamaBaseUrl` → env `OLLAMA_HOST` → `http://localhost:11434`.

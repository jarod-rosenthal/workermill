***REMOVED*** CLAUDE.md

***REMOVED******REMOVED*** Project Overview

WorkerMill: the open-source operations layer for AI coding agents. Deployed at https://workermill.com.

**Stack:** Express+TypeORM+PostgreSQL (`api/`), React 19+Vite (`frontend/`), standalone binary agent (`agent/`), VS Code extension (`packages/vscode-workermill/`), worker Docker images (`worker/`).

**Key directories:** `api/`, `frontend/`, `worker/`, `agent/`, `packages/vscode-workermill/`, `packages/workermill-mcp/`

---

***REMOVED******REMOVED*** Quick Reference

**Ports:** API: 3001, Frontend: 5173, Local DB: 5433, Local Redis: 6379

| Task | Command |
|------|---------|
| Start local dev | `./bin/local-workermill start` |
| Stop local dev | `./bin/local-workermill stop` |
| Type check API | `cd api && npm run typecheck` |
| Type check frontend | `cd frontend && npx tsc -b` |
| Run API tests | `cd api && npm run test` |
| Create migration | `cd api && npm run migrate:create NAME` (register in `connection.ts`) |
| Build agent | `cd agent && npm run build:binary` |
| Build worker | `./bin/local-workermill build-worker` |

**Git:** Work on `main`.

---

***REMOVED******REMOVED*** Detailed Reference

- **Local dev**: `docs/claude/local-dev.md`
- **Agent + VS Code**: `docs/claude/agent-and-vscode.md`
- **Architecture** (models, routes, task flow): `docs/claude/architecture.md`
- **Integrations**: `docs/claude/integrations.md`
- **Infrastructure**: `docs/claude/infrastructure.md`
- **Troubleshooting**: `docs/claude/troubleshooting.md`
- **Testing**: `docs/claude/testing.md`

---

***REMOVED******REMOVED*** Key Architecture Notes

***REMOVED******REMOVED******REMOVED*** Worker Rebuild Matrix
| Path | Where code lives | Rebuild |
|------|-----------------|---------|
| Remote agent native | Bundled in agent binary | Release new agent binary |
| Remote agent Docker sandbox | Docker image | Agent release CI pushes automatically |
| Local Docker | Docker image via `tsc` | `./bin/local-workermill build-worker` |
| Cloud ECS | ECR image | `./deploy.sh --worker` |

***REMOVED******REMOVED******REMOVED*** Four Spawners
`agent/src/spawner.ts` (remote native), `agent/src/docker-spawner.ts` (remote Docker sandbox), `api/src/services/local-epic-spawner.ts` (local), `api/src/services/ecs-task-runner.ts` (cloud ECS). Always ask which environment before changes.

***REMOVED******REMOVED******REMOVED*** Two Board Systems
- **Boards** (`/api/boards`, `KbBoard`/`KbCard`) = Kanban. **This is what the user sees.**
- **Projects** (`/api/projects`, `Project`/`InternalTask`) = internal. NOT visible in UI.

***REMOVED******REMOVED******REMOVED*** Working Patterns (do not change without discussion)
- Log streaming: PostgreSQL + SSE
- Task orchestration: DB polling + atomic claim
- Worker entrypoint: `post_log()`
- Coordination: SSE via Redis pub/sub
- Code events: stateless API + client accumulation
- Quality gates: two-gate system (pre-commit + post-push CI)

***REMOVED******REMOVED******REMOVED*** Common Pitfalls
- **TypeORM `.save()`** clobbers concurrent changes — use atomic `UPDATE...WHERE` for status transitions.
- **Express route ordering**: `router.use(middleware)` applies to ALL routes defined after it.
- **Org credentials**: In `org_credentials` table (NOT Secrets Manager). Access via `getOrgSecretFromDb()`.
- **Agent edits locally do NOTHING** to remote agents — release a new binary.
- **Docker Desktop socket**: Don't gate mounts on `fs.existsSync()`. `isDockerDesktop()` must include `win32`.
- **Planner**: Single-agent + repo clone. Critic threshold 85/100. Don't change without asking.
- **Hardcoded fallbacks**: `?? <value>` and `|| "<value>"` patterns hide bugs. Org settings come from DB — pass through without fallbacks.

***REMOVED******REMOVED******REMOVED*** Quality Gates
Gate 1: pre-commit shell commands from `quality_gate_commands` board column. Gate 2: post-push CI polling (GitHub Actions or Bitbucket Pipelines). Standard toolchain only. PRD prompt is source of truth (`api/src/services/prd-decomposer.ts`). See `worker/epic/executor.ts` for details.

***REMOVED******REMOVED******REMOVED*** Orchestrator
Modules in `api/src/services/`: `orchestrator.ts` (hub), `task-claimer.ts`, `worker-spawner.ts`, `task-dispatch.ts`, `task-monitor.ts`, `task-cleanup.ts`, `planning-workflow.ts`, `manager-workflow.ts`. Stateless — all state in DB. Cron jobs use Redis SETNX locks.

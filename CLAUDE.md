# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WorkerMill: the open-source operations layer for AI coding agents. Deployed at https://workermill.com.

**Stack:** Express+TypeORM+PostgreSQL (`api/`), React 19+Vite (`frontend/`), standalone binary agent (`agent/`), VS Code extension (`packages/vscode-workermill/`), worker Docker images (`worker/`).

**Key directories:** `api/`, `frontend/`, `worker/`, `agent/`, `packages/vscode-workermill/`, `packages/workermill-mcp/`

---

## Quick Reference

**Ports:** API: 3001, Frontend: 5173, Local DB: 5433, Local Redis: 6379

| Task | Command |
|------|---------|
| Start local dev | `./bin/local-workermill start` |
| Stop local dev | `./bin/local-workermill stop` |
| Type check API | `cd api && npm run typecheck` |
| Type check frontend | `cd frontend && npx tsc -b` |
| Type check agent | `cd agent && npm run typecheck` |
| Type check worker | `cd worker && npm run typecheck` |
| Lint API | `cd api && npm run lint` |
| Lint frontend | `cd frontend && npm run lint` |
| Run API tests | `cd api && npm run test` |
| Run single API test | `cd api && npx vitest run src/routes/some.test.ts` |
| Run API integration tests | `cd api && npm run test:integration` |
| Run E2E tests | `cd frontend && npm run test:e2e` |
| Run single E2E test | `cd frontend && npx playwright test e2e/some-test.spec.ts` |
| Create migration | `cd api && npm run migrate:create NAME` (register in `api/src/db/connection.ts`) |
| Build agent | `cd agent && npm run build:binary` |
| Build worker | `./bin/local-workermill build-worker` |
| Package VS Code ext | `cd packages/vscode-workermill && npm run package` (bump version first) |
| Deploy (cloud) | `./deploy.sh --api`, `--frontend`, `--worker`, or `--all` |
| Connect to prod DB | `./bin/bastion start` (prints connection string) |
| Disconnect prod DB | `./bin/bastion stop` |

**Git:** Work on `main`. No automatic CI on push — workflows are manual (`workflow_dispatch`).

---

## Detailed Reference

- **Local dev**: `docs/agent/local-dev.md`
- **Agent + VS Code**: `docs/agent/agent-and-vscode.md`
- **Architecture** (models, routes, task flow): `docs/agent/architecture.md`
- **Integrations**: `docs/agent/integrations.md`
- **Infrastructure**: `docs/agent/infrastructure.md`
- **Troubleshooting**: `docs/agent/troubleshooting.md`
- **Testing**: `docs/agent/testing.md`

---

## Key Architecture Notes

### Worker Rebuild Matrix
| Path | Where code lives | Rebuild |
|------|-----------------|---------|
| Remote agent native | Bundled in agent binary | Release new agent binary |
| Remote agent Docker sandbox | Docker image | Agent release CI pushes automatically |
| Local Docker | Docker image via `tsc` | `./bin/local-workermill build-worker` |
| Cloud ECS | Container image | `./deploy.sh --worker` |

### Four Spawners
`agent/src/spawner.ts` (remote native), `agent/src/docker-spawner.ts` (remote Docker sandbox), `api/src/services/local-epic-spawner.ts` (local), `api/src/services/ecs-task-runner.ts` (cloud container). Always ask which environment before changes.

### Two Board Systems
- **Boards** (`/api/boards`, `KbBoard`/`KbCard`) = Kanban. **This is what the user sees.**
- **Projects** (`/api/projects`, `Project`/`InternalTask`) = internal. NOT visible in UI.

### Working Patterns (do not change without discussion)
- Log streaming: PostgreSQL + SSE
- Task orchestration: DB polling + atomic claim
- Worker entrypoint: `post_log()`
- Coordination: SSE via Redis pub/sub
- Code events: stateless API + client accumulation
- Quality gates: two-gate system (pre-commit + post-push CI)

### Git Rules
- **NEVER override `.gitignore`** — do not use `git add -f`, `git add -A`, or `git add .` to stage files. Always add specific files by name. If a file is gitignored, it stays gitignored. If you think it should be tracked, ask first.

### Common Pitfalls
- **TypeORM `.save()`** clobbers concurrent changes — use atomic `UPDATE...WHERE` for status transitions.
- **Express route ordering**: `router.use(middleware)` applies to ALL routes defined after it.
- **Org credentials**: In `org_credentials` table (NOT Secrets Manager). Access via `getOrgSecretFromDb()`.
- **Agent edits locally do NOTHING** to remote agents — release a new binary.
- **Docker Desktop socket**: Don't gate mounts on `fs.existsSync()`. `isDockerDesktop()` must include `win32`.
- **Planner**: Single-agent + repo clone. Critic threshold 85/100. Don't change without asking.
- **Hardcoded fallbacks**: `?? <value>` and `|| "<value>"` patterns hide bugs. Org settings come from DB — pass through without fallbacks.

### Quality Gates
Gate 1: pre-commit shell commands from `quality_gate_commands` board column. Gate 2: post-push CI polling (GitHub Actions or Bitbucket Pipelines). Standard toolchain only. PRD prompt is source of truth (`api/src/services/prd-decomposer.ts`). See `worker/epic/executor.ts` for details.

### Orchestrator
Modules in `api/src/services/`: `orchestrator.ts` (hub), `task-claimer.ts`, `worker-spawner.ts`, `task-dispatch.ts`, `task-monitor.ts`, `task-cleanup.ts`, `planning-workflow.ts`, `manager-workflow.ts`. Stateless — all state in DB. Cron jobs use Redis SETNX locks.

### Four Execution Paths
1. **Standalone Agent** (default, VS Code): Agent runs locally with SQLite, event-driven orchestration. No cloud dependency.
2. **Cloud Agent** (production, team workflows): Agent polls cloud API → plans → spawns native worker process.
3. **Local Docker** (API development): API creates task (skips planning) → local orchestrator → Docker container.
4. **Cloud Container** (legacy): Agent plans → cloud orchestrator → container task.

See `docs/agent/architecture.md` for full flow diagrams.

### Release Tags
- **Agent**: Bump `agent/package.json` → `git tag agent-v<version>` → push tag → CI builds 4 platform binaries + Docker sandbox image.
- **VS Code**: Bump `packages/vscode-workermill/package.json` → `git tag vscode-v<version>` → push tag → CI publishes to Marketplace.

### Multi-Provider Support
AI providers: `anthropic` (default, Claude CLI experts), `openai`, `google`, `ollama` (all via Vercel AI SDK). SCM providers: `github`, `gitlab`, `bitbucket`. Worker decision logic (error classification, quality gates) served by API at `/api/worker-decisions/` — IP lives in `api/src/services/worker-decision-engine.ts`.

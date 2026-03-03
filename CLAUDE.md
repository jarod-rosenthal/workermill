# CLAUDE.md

## ABSOLUTE RULES

**NEVER** change `EXECUTION_MODE`, kill dev processes, restart services, add the `workermill` label, trigger worker tasks, or bypass auth. The ONLY way to start/stop dev env is `./bin/local-workermill start|stop` — run by the USER. If auth is in the way, ASK THE USER.

**NEVER** create board cards by bypassing the normal process. Provide card details as TEXT OUTPUT for the user to create through the dashboard UI.

## Critical Rules

### DO NOT CHANGE Working Patterns
Log streaming (PostgreSQL+SSE), task orchestration (DB polling+atomic claim), worker entrypoint (`post_log()`), LLM models, coordination SSE (Redis pub/sub), code events (stateless API+client accumulation), quality gates (two-gate system). **ASK FIRST before "improving" any of these.**

### DO NOT Hardcode Timeouts/Thresholds/Limits
Never add timeouts, rate limits, retry counts, or numeric constraints without approval. `?? <value>` and `|| "<value>"` fallback patterns hide bugs. Org settings come from DB — pass through without fallbacks.

### DO NOT Touch the Local Database
Never run `DROP DATABASE`, `DROP SCHEMA`, `TRUNCATE`, or destructive SQL without approval. The local Docker PostgreSQL may contain data that doesn't exist anywhere else. Read-only queries only for debugging.

### DO NOT Directly INSERT Board Cards
Use the boards API: `POST /api/boards/:boardId/cards`. Never raw SQL INSERT into `kb_cards`.

### DO NOT Relax Security
Never change auth middleware, relax role checks, add "temporary" bypasses, or disable auth on endpoints. Forbidden: `NODE_TLS_REJECT_UNAUTHORIZED=0`, hardcoded credentials, `Resource: "*"` with destructive IAM actions, 0.0.0.0/0 for non-public services.

### DO NOT Modify Infrastructure Outside Terraform
Terraform is the ONLY source of truth. Never create AWS resources via console/CLI. Always: edit `.tf` files -> `terraform plan` -> `terraform apply` (full, NOT targeted) -> confirm zero drift. Known drift: ECS task defs cycle because `deploy.sh` pins image digests vs Terraform's `:latest`.

### Other Critical Rules
- **Jira labels**: Create tickets with NO LABELS. The `workermill` label auto-triggers workers.
- **Stale tasks**: Don't bulk-process stuck tasks. Fix bugs for future tasks only.
- **Bitbucket auth**: Use `Bearer <token>` for API, `x-token-auth:<token>` for git (NOT app passwords).
- **Communication**: Explain changes before making them. Wait for explicit deploy approval.
- **Screenshots**: WSL2 — translate `C:\Users\...` to `/mnt/c/Users/...` and read directly.
- **Deploy target**: Always prod (`./deploy.sh --api/--frontend/--worker`), NOT dev.
- **Agent releases**: Always bump `agent/package.json` version first. Tag `agent-v<version>` -> push to `upstream`.
- **Landing page**: Public — only Showcase, How It Works, Pricing, Docs, Sign in, Get Started. No auth-required links.

---

## Quick Reference

**Ports:** API: 3001, Frontend: 5173, Local DB: 5433, Local Redis: 6379

| Task | Command |
|------|---------|
| Type check API/frontend/agent/worker | `cd <dir> && npm run typecheck` (frontend: `npx tsc -b`) |
| Deploy (prod) | `./deploy.sh --api`, `--frontend`, `--worker`, `--all` |
| Create migration | `cd api && npm run migrate:create NAME` (register in `connection.ts`) |
| Tail API logs | `MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-dev/api" --follow --region us-east-1` |
| Build agent | `cd agent && npm run build:binary` |
| Release agent | Bump version -> `git tag agent-v<version>` -> push to `upstream` ONLY |

**Git:** Work on `main`. Push to both: `git push origin main && git push upstream main`. `origin` = dev (jarod-rosenthal), `upstream` = prod (workermill).

---

## Project Overview

WorkerMill: mission control for autonomous AI coding agents. Deployed at https://workermill.com.

**Stack:** Express+TypeORM+PostgreSQL (`api/`), React 19+Vite (`frontend/`), standalone binary agent (`agent/`), VS Code extension (`packages/vscode-workermill/`), Terraform->AWS (`infrastructure/`), worker Docker images (`worker/`).

**Key directories:** `api/`, `frontend/`, `worker/`, `agent/`, `packages/vscode-workermill/`, `packages/workermill-mcp/`, `infrastructure/`

---

## Detailed Reference (read on demand)

- **Local dev**: `docs/claude/local-dev.md`
- **Agent + VS Code**: `docs/claude/agent-and-vscode.md`
- **Architecture** (models, routes, task flow): `docs/claude/architecture.md`
- **Integrations**: `docs/claude/integrations.md`
- **Infrastructure**: `docs/claude/infrastructure.md`
- **Troubleshooting**: `docs/claude/troubleshooting.md`
- **Testing**: `docs/claude/testing.md`

---

## Key Architecture Notes

### Worker Rebuild Matrix
| Path | Where code lives | Rebuild |
|------|-----------------|---------|
| Remote agent native | Bundled in agent binary | Release new agent binary |
| Remote agent Docker sandbox | `ghcr.io/workermill/worker:latest` | Agent release CI pushes automatically |
| Local Docker | Docker image via `tsc` | `./bin/local-workermill build-worker` |
| Cloud ECS | ECR image | `./deploy.sh --worker` |

### Four Spawners
`agent/src/spawner.ts` (remote native), `agent/src/docker-spawner.ts` (remote Docker sandbox), `api/src/services/local-epic-spawner.ts` (local), `api/src/services/ecs-task-runner.ts` (cloud ECS). Always ask which environment before changes.

### Two Board Systems
- **Boards** (`/api/boards`, `KbBoard`/`KbCard`) = Kanban. **This is what the user sees.**
- **Projects** (`/api/projects`, `Project`/`InternalTask`) = internal. NOT visible in UI.

### Common Pitfalls
- **TypeORM `.save()`** clobbers concurrent changes — use atomic `UPDATE...WHERE` for status transitions.
- **Express route ordering**: `router.use(middleware)` applies to ALL routes defined after it.
- **Org credentials**: In `org_credentials` table (NOT Secrets Manager). Access via `getOrgSecretFromDb()`.
- **Agent edits locally do NOTHING** to remote agents — release a new binary.
- **Docker Desktop socket**: Don't gate mounts on `fs.existsSync()`. `isDockerDesktop()` must include `win32`.
- **Planner**: Single-agent + repo clone. Critic threshold 85/100. Don't change without asking.

### Quality Gates (read `worker/epic/executor.ts` for details)
Gate 1: pre-commit shell commands from `quality_gate_commands` board column. Gate 2: post-push CI polling (GitHub Actions or Bitbucket Pipelines). Standard toolchain only. PRD prompt is source of truth (`api/src/services/prd-decomposer.ts`).

### Orchestrator
Modules in `api/src/services/`: `orchestrator.ts` (hub), `task-claimer.ts`, `worker-spawner.ts`, `task-dispatch.ts`, `task-monitor.ts`, `task-cleanup.ts`, `planning-workflow.ts`, `manager-workflow.ts`. Stateless — all state in DB. Cron jobs use Redis SETNX locks.

---

## Recent Changes (max 5)

- 2026-03-03: Docker-in-Docker fix for Windows Docker Desktop — `isDockerDesktop()` detects `win32`, socket mount bypasses `fs.existsSync()` on Docker Desktop.
- 2026-02-27: Quality gates — first-class board columns, SCM-aware CI polling, standard toolchain restriction, install-tools.sh re-run before gates.
- 2026-02-27: CLAUDE.md -> AGENTS.md — worker instructions now create provider-agnostic `AGENTS.md`.
- 2026-02-23: Redis pub/sub for real-time coordination. CloudFront origin timeouts increased.
- 2026-02-22: Multi-org support, multi-type coordination filtering.

---

## Hooks & Skills

**Auto-formatting:** Prettier runs on Write/Edit to `.ts`/`.tsx`/`.js`/`.jsx` files.

**`/val-imp [plan-file]`**: Enforces strict plan adherence with independent validator agent.

## MCP Tools

MCP servers: `workermill`, `github`, `jira`, `ollama`, `oncallshift`. Codebase RAG: `workermill_codebase_search` (use `multiQuery: true`).

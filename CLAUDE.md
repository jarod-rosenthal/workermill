# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🚨🚨🚨 ABSOLUTE RULE — NEVER BYPASS PROCESSES 🚨🚨🚨

**NEVER change `EXECUTION_MODE`, kill dev environment processes, restart services, add the `workermill` label, trigger worker tasks, or bypass authentication to hit the API directly. NEVER use `EXECUTION_MODE=local` to skip Cognito auth. NEVER kill processes on ports 3001/5173/5433 without explicit user approval. NEVER add the `workermill` label to a card — it auto-triggers a worker task. The ONLY way to start/stop/restart the dev environment is `./bin/local-workermill start|stop` — run by the USER, not by Claude. If you need to interact with the boards API and auth is in the way, ASK THE USER. Do not work around it.**

**NEVER create board cards by bypassing the normal process. Claude does NOT have auth to use the boards API directly. If the user asks to create a card, provide the card details as TEXT OUTPUT for the user to create through the dashboard UI. Do not attempt to curl the API, change auth modes, or work around authentication in any way.**

## ⛔ Critical Rules - READ FIRST

### DO NOT CHANGE Working Patterns

**These working solutions must NOT be changed without explicit user request:**

| Pattern | Implementation | Why It's Sacred |
|---------|----------------|-----------------|
| **Log streaming** | PostgreSQL + SSE, NOT CloudWatch | Took a week to get working. Worker posts to `/api/tasks/:taskId/logs`, SSE streams from database every 500ms. |
| **Task orchestration** | Database polling with atomic claim | Polls for queued tasks, claims via UPDATE...WHERE, spawns ECS |
| **Worker entrypoint** | `post_log()` shell function | Posts terminal output to API in real-time |
| **LLM Models** | NEVER change without approval | No default model changes, no provider switches, no model name changes in code/env/config |
| **Coordination SSE** | Redis pub/sub with DB polling fallback | SSE endpoint subscribes to Redis for instant push. If Redis is down, falls back to 5s DB polling transparently. Fire-and-forget publishes never block writes. |
| **Code events (Live Code View)** | Stateless API + client-side accumulation | API stores raw immutable events only. Clients (dashboard + VS Code) reconstruct file state. See "Code Events Architecture" below. |
| **Quality gates** | Two-gate system (pre-commit + post-push CI) | Commands baked into board at PRD decomposition. Standard toolchain only — no third-party tools. See "Quality Gate Architecture" below. |

**If you think something could be "better" (CloudWatch, WebSockets, etc.), ASK FIRST.**

### DO NOT Hardcode Timeouts, Thresholds, or Limits Without Asking

**NEVER add hardcoded timeouts, rate limits, retry counts, token limits, or any numeric constraint without explicit user approval.** These cause silent failures in production that are extremely hard to debug. A 60-second HTTP timeout killed a multi-minute LLM decomposition flow. A hardcoded retry limit can cause permanent task failures.

- **Timeouts:** If you need a timeout, ASK what value to use. When in doubt, use a very large value or no timeout at all.
- **Thresholds/limits:** File count caps, token limits, score thresholds — all must be approved before adding.
- **Fallback defaults:** `?? <value>` and `|| "<value>"` patterns hide bugs. See "DO NOT Add Hardcoded Fallbacks for Org Settings" below.
- **If you see an existing hardcoded value that seems wrong, flag it** — don't silently change it.

### DO NOT Touch the Local Database

**On 2026-02-16, Claude dropped the local PostgreSQL database (`DROP DATABASE workermill`) without permission while debugging a "loading logs" issue. The data only existed locally and was permanently destroyed. This must NEVER happen again.**

- **NEVER** run `DROP DATABASE`, `DROP SCHEMA`, or `TRUNCATE` on any database without explicit user approval
- **NEVER** run destructive SQL commands as a "debugging step" — read-only queries only
- **NEVER** assume a database is empty or broken just because a query returns no results — verify from multiple angles first
- **NEVER** recreate, reset, or wipe a database to "fix" a migration issue — ask the user first
- If the database appears empty or broken, **STOP and ask the user** before taking any action
- The local Docker PostgreSQL (`workermill-local-db` on port 5433) may contain data that does NOT exist anywhere else — treat it as production-critical

### DO NOT Directly INSERT into the Database to Create Board Cards

**NEVER use raw SQL INSERT to create `kb_cards` rows.** The API assigns `card_number` auto-incrementing per board — raw INSERTs skip this and produce cards with no number.

- **ALWAYS** use the boards API: `POST /api/boards/:boardId/cards`
- If authentication is required, obtain a valid JWT token first (e.g., via Cognito or a test login endpoint)
- If the API is not accessible, **ask the user** rather than bypassing it with raw SQL

### DO NOT Relax Security

**NEVER, under ANY circumstances, relax, bypass, or weaken security checks:**

- **NEVER** change auth middleware to skip validation
- **NEVER** relax role checks (e.g., `supportAdmin` → `admin || supportAdmin`)
- **NEVER** add "temporary" security bypasses - they WILL ship to production
- **NEVER** disable authentication on endpoints, even for testing

**If you need elevated access:** Set the proper flag/role via migration, not by weakening checks.

**Forbidden patterns:**
- `NODE_TLS_REJECT_UNAUTHORIZED=0`
- Hardcoded credentials
- `Resource: "*"` with destructive IAM actions
- 0.0.0.0/0 security groups for non-public services

### DO NOT Add Hardcoded Fallbacks for Org Settings

**The Organization model in the database is the SINGLE SOURCE OF TRUTH for all org settings.** Every column has a DB-level default. NEVER add `?? <value>` or `|| "<value>"` fallbacks in spawners, API routes, workers, or frontend code when passing org settings through.

- **WRONG:** `String(org.maxParallelExperts ?? 4)` — silently overrides the DB default and masks bugs
- **RIGHT:** `String(org.maxParallelExperts)` — uses whatever the DB has
- **Worker env fallbacks** (`process.env.X || "3"`) are acceptable ONLY because the env var might not be set in local dev; the fallback MUST match the DB column default exactly
- When adding a new org setting: add the column with a DEFAULT in the migration, and pass the value through without fallbacks

### DO NOT Expose Authenticated Features on Public Pages

**The landing/home page (`LandingV0.tsx`, `Home/v0/Header.tsx`) is PUBLIC — visible to unauthenticated users.** NEVER add links to authenticated features (Docs, Dashboard, Settings, etc.) on public pages.

- **Docs** (`/docs`) are public — accessible without authentication. Linked from landing page nav.
- **Landing page nav** should only contain: Showcase, How It Works, Pricing, Docs, Sign in, Get Started
- If a feature requires login, its link belongs behind auth (sidebar, profile dropdown, dashboard)

### DO NOT Modify Infrastructure Outside Terraform

**Terraform is the ONLY source of truth. NEVER:**
- Create AWS resources via console or CLI (`aws ecs register-task-definition`, `aws ecr create-repository`, etc.) — ALWAYS add to Terraform first, then apply
- Manually modify ECS task definitions — `deploy.sh` handles image updates; Terraform owns the task definition structure
- Push Docker images without using `deploy.sh`
- Change security groups, IAM roles, or networking outside Terraform
- Use `terraform apply -target` without **explicit user approval** — targeted applies cause state drift that compounds over time and creates dangerous surprises on the next full apply
- Reference third-party Docker Hub images directly in task definitions — copy them to private ECR first to avoid rate limits
- Leave Terraform in a dirty state — after ANY infrastructure change, run `terraform plan` and confirm zero drift before considering the work done. If drift remains, fix it or explain why it's expected.
- Run `terraform apply` without first running `terraform plan` and reviewing the output

**Terraform workflow:**
1. Make changes in `.tf` files
2. `terraform plan` — review ALL changes
3. `terraform apply` — full apply, NOT targeted
4. `terraform plan` again — confirm **zero drift**
5. Commit `.tf` changes to git

**Remaining known drift:** ECS task definitions cycle because `deploy.sh` registers new revisions with pinned image digests, while Terraform uses `:latest`. This is expected — `deploy.sh` owns image deployments, Terraform owns the task definition structure. Do NOT chase this drift with repeated applies.

### DO NOT Add Labels When Creating Jira Tickets

**Create tickets with NO LABELS.** The `workermill` label triggers automatic AI worker deployment. Adding labels without explicit permission has caused production incidents.

**Only add labels AFTER ticket creation, with explicit user approval.**

### DO NOT Auto-Process Stale Tasks

When fixing orchestrator bugs:
- Do NOT add code that bulk-processes stuck tasks
- Add staleness checks (skip tasks older than 1 hour)
- Fix the bug for future tasks, leave existing stuck tasks alone
- User controls task execution via dashboard UI

### DO NOT Use Outdated Bitbucket Auth

**Bitbucket uses Repository Access Tokens, NOT app passwords (deprecated).**

| Use Case | Correct Method |
|----------|----------------|
| REST API | `Authorization: Bearer <token>` |
| Git URLs | `https://x-token-auth:<token>@bitbucket.org/...` |

**WRONG:** `Basic auth with username:app_password` - this is deprecated
**RIGHT:** `Bearer token` for API, `x-token-auth` for git

### DO NOT Make Changes Without Communicating

- **Before any code change**: Explain what you're about to modify
- **When instructions are unclear**: Ask, don't assume
- **Before deploying**: Wait for explicit approval ("go", "yes", "deploy")
- **Keep changes minimal**: Only do what was asked, nothing extra
- **No silent deployments**: Always state what's being deployed

### DO NOT Fail to Read Screenshots

**This is a WSL2 environment. Windows paths work via `/mnt/c/`.** When the user shares a screenshot path like `C:\Users\jarod\Pictures\...\file.png`, ALWAYS translate it to `/mnt/c/Users/jarod/Pictures/.../file.png` and read it. NEVER say you can't access Windows paths or ask the user to copy the file. Try `/mnt/c/` first — it will work.

### DO NOT Deploy to Dev Environment

**The dev environment (dev.workermill.com) is NOT RUNNING.** Always deploy to prod:
- Use `./deploy.sh --api` (NOT `--env dev`)
- Use `./deploy.sh --frontend` (NOT `--env dev`)
- Use `./deploy.sh --worker` (NOT `--env dev`)

### DO NOT Release Agent Without Bumping Version

**Always bump `agent/package.json` version before releasing.** The version is embedded at compile time via esbuild `define`. To release: bump version → `git tag agent-v<version>` → `git push --tags` → GitHub Actions builds binaries. npm publish is still supported as a fallback: `cd agent && npm run build && npm publish --access public`.

### Rebuild After worker/ Changes

Worker code (`worker/epic/*.ts`) is used in TWO places — the Docker image AND the agent binary. Changes to worker code require rebuilding the right artifact depending on which execution path you use.

| Execution path | Where worker code lives | How to rebuild |
|----------------|------------------------|----------------|
| **Remote agent native** (no sandbox) | Bundled into agent binary at build time (esbuild) | Release new agent binary: bump version → `git tag agent-v<version>` → push |
| **Remote agent Docker sandbox** | GHCR image `ghcr.io/workermill/worker:latest` | Agent release CI pushes to GHCR automatically (same `agent-v*` tag trigger) |
| **Local WorkerMill Docker** | Docker image compiled by `tsc` | `./bin/local-workermill build-worker` |
| **Cloud ECS** | ECR Docker image | `./deploy.sh --worker` |

**Docker sandbox image:** VS Code extension sandbox mode (`agent/src/docker-spawner.ts`) pulls `ghcr.io/workermill/worker:latest`. This image is built and pushed by the `agent-release.yml` CI workflow on `workermill/workermill` when an `agent-v*` tag is pushed. So releasing a new agent binary also updates the sandbox Docker image. The agent re-pulls `:latest` periodically (30-minute interval).

| What you want to change | Where to edit | Then what |
|--------------------------|---------------|-----------|
| Worker runtime code | `worker/epic/*.ts` | Rebuild agent binary AND/OR Docker image (see above) |
| Container env vars (local mode) | `api/src/services/local-epic-spawner.ts` (`buildEnvArgs`) | Restart API |
| API-side orchestration | `api/src/services/orchestrator.ts` and modules | Restart API |

---

## Recent Changes (keep updated — max 10 entries, archive older to `docs/claude/changelog.md`)

- 2026-03-03: Docker-in-Docker fix for Windows Docker Desktop — `isDockerDesktop()` now detects `win32`, Docker socket mount bypasses `fs.existsSync()` on Docker Desktop (Docker translates `/var/run/docker.sock` internally to its named pipe). Workers can now spin up sibling containers (DBs, caches) in sandbox mode on Windows.
- 2026-02-27: Quality gates — first-class board columns (`quality_gate_commands`, `ci_workflow_path`), SCM-aware CI polling (GitHub Actions + Bitbucket Pipelines), standard toolchain restriction in PRD prompt, gofmt `./...` regex safety net, install-tools.sh re-run before gates.
- 2026-02-27: CLAUDE.md → AGENTS.md — worker instructions now create provider-agnostic `AGENTS.md` in target repos (legacy `CLAUDE.md` still recognized as fallback).
- 2026-02-23: Redis pub/sub for real-time coordination — ElastiCache `cache.t4g.micro`, SSE pushes instantly via Redis subscribe, falls back to 5s DB polling if Redis unavailable. Workers use SSE subscriber with event-driven coordinator loop.
- 2026-02-23: bcrypt → bcryptjs (pure JS, no native deps) — eliminates Docker build warnings and `python3 make g++` from Dockerfile.
- 2026-02-23: CloudFront origin timeouts increased (read 30→60s, keepalive 5→30s) to prevent 504s during coordination.
- 2026-02-22: Multi-type server-side filtering for coordination API (`messageTypes` query param) — root cause fix for poll timeouts on large epics.
- 2026-02-22: Multi-org support — VS Code extension + web dashboard org switcher (`dc82abc`).
- 2026-02-21: Billing tiers renamed: Free/Pro/Enterprise → **Pro/Max/Enterprise** (`e8928aa`).
- 2026-02-21: Docker sandbox mode for remote agent workers (`agent/src/docker-spawner.ts`). Opt-in via VS Code settings. Four spawners now (see Agent Pitfalls).

---

## Detailed Reference (read on demand)

- **Local dev setup**: `docs/claude/local-dev.md`
- **Remote agent + VS Code extension**: `docs/claude/agent-and-vscode.md`
- **Architecture** (models, routes, task flow, execution modes): `docs/claude/architecture.md`
- **Jira/webhook integrations**: `docs/claude/integrations.md`
- **Infrastructure** (Terraform, SES): `docs/claude/infrastructure.md`
- **Troubleshooting**: `docs/claude/troubleshooting.md`
- **Testing + CI/CD**: `docs/claude/testing.md`

---

## Quick Reference

**Ports:** API: 3001, Frontend: 5173, Local DB: 5433, Local Redis: 6379

**Environment variables:** See `.env.local` setup in `docs/claude/local-dev.md`. Key vars: `DATABASE_URL`, `EXECUTION_MODE` (local/remote), `TARGET_REPO_PATH`.

| Task | Command |
|------|---------|
| Install API deps | `cd api && npm ci` |
| Install frontend deps | `cd frontend && npm ci` |
| Install agent deps | `cd agent && npm install` |
| Install worker deps | `cd worker && npm install` |
| Type check API | `cd api && npm run typecheck` |
| Type check frontend | `cd frontend && npx tsc -b` |
| Type check agent | `cd agent && npm run typecheck` |
| Type check worker | `cd worker && npm run typecheck` |
| Deploy all (prod) | `./deploy.sh --all` |
| Deploy API (prod) | `./deploy.sh --api` |
| Deploy frontend | `./deploy.sh --frontend` |
| Deploy worker | `./deploy.sh --worker` |
| Create migration | `cd api && npm run migrate:create NAME` |
| Tail API logs | `MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-dev/api" --follow --region us-east-1` |
| Build worker code | `cd worker && npm run build` |
| Lint API | `cd api && npm run lint` |
| Fix lint (API) | `cd api && npm run lint -- --fix` |
| Lint frontend | `cd frontend && npm run lint` |
| Fix lint (frontend) | `cd frontend && npm run lint -- --fix` |
| Run API tests (Vitest) | `cd api && npm run test` |
| Run single API test | `cd api && npx vitest run src/routes/tasks.test.ts` |
| Run integration tests | `cd api && npm run test:integration` |
| Run E2E tests (Playwright) | `cd frontend && npm run test:e2e` |
| Run single E2E test | `cd frontend && npx playwright test e2e/some-test.spec.ts` |
| Seed database | `cd api && npm run seed` |
| **Validated implementation** | `/val-imp [plan-file]` |
| **Start remote agent** | `workermill-agent start` |
| **Install remote agent** | `curl -fsSL https://workermill.com/install.sh \| bash` |
| **Build agent (shortcut)** | `cd agent && npm run build:binary` |
| **Release agent binary** | Bump version → `git tag agent-v<version>` → push tag to `upstream` (workermill/workermill) ONLY |

---

## Project Overview

WorkerMill is mission control for autonomous AI coding agents - a real-time monitoring and orchestration system for AI workers that execute coding tasks ("htop for AI workers"). Deployed at https://workermill.com.

**Stack:**
- **Backend API**: Express + TypeScript + TypeORM + PostgreSQL (`api/`)
- **Frontend**: React 19 + Vite + TailwindCSS + Zustand (`frontend/`)
- **Remote Agent**: Standalone binary CLI + local HTTP API (`agent/`)
- **VS Code Extension**: IDE companion — sidebar tree, activity feed, log terminals (`packages/vscode-workermill/`)
- **Infrastructure**: Terraform → AWS (ECS Fargate, RDS, S3, CloudFront) in us-east-1
- **Worker Containers**: Docker images with Claude Code for task execution (`worker/`)
- **Testing**: Vitest (API unit/integration), Playwright (E2E)

**Requirements:** Node.js >= 20.0.0 (for API/frontend development; the remote agent binary has no Node.js dependency)

**Current Development Phase:** Production deployment testing with **oncallshift** repositories (Bitbucket). Jira tickets from the **OCS** project trigger AI worker tasks against the split repos: `oncallshift-api`, `oncallshift-web`, `oncallshift-mobile`.

### WorkerMill vs Target Repositories

| Component | Repository | Platform | Purpose |
|-----------|------------|----------|---------|
| **WorkerMill** | `workermill/` (this repo) | GitHub | Orchestration platform - API, dashboard, worker containers |
| **oncallshift-api** | `oncallshift/oncallshift-api` | Bitbucket | Backend API, infrastructure, packages, e2e tests |
| **oncallshift-web** | `oncallshift/oncallshift-web` | Bitbucket | React frontend |
| **oncallshift-mobile** | `oncallshift/oncallshift-mobile` | Bitbucket | React Native mobile app |

- **WorkerMill** is the control plane that spawns and monitors AI workers
- **oncallshift** repos are the applications being built by AI workers
- AI workers execute tasks on oncallshift repos, NOT on WorkerMill itself
- Jira project **OCS** = oncallshift development, **WM** = WorkerMill platform

### Codebase Structure

Focus on these directories (production services):
- `api/` - Backend API deployed to ECS
- `frontend/` - React dashboard deployed to CloudFront
- `worker/` - Worker container images
- `agent/` - Remote agent CLI (standalone binary, published to npm as fallback)
- `packages/vscode-workermill/` - VS Code extension (IDE companion for remote agent)
- `packages/workermill-mcp/` - WorkerMill MCP server (published to npm)
- `packages/oncallshift-mcp/` - OncallShift MCP server (published to npm)

Supporting directories:
- `bin/` - CLI scripts (`local-workermill`, `bastion`)
- `docker/` - Docker configurations for local development
- `data/dumps/` - Database backup dumps (local dev)
- `scripts/` - Utility scripts
- `infrastructure/` - Terraform IaC (AWS ECS, RDS, S3, CloudFront)

User-facing documentation is at https://workermill.com/docs (overview, quick start, integrations, task lifecycle, personas, epics, analytics, MCP, advanced).

---

## Deployment

**ALWAYS use `deploy.sh` for ALL deployments.** Never manually build/push Docker images. Run `./deploy.sh --frontend` after UI changes.

**Additional deploy.sh flags:** `--skip-build`, `--db-check`, `--check-migrations`, `--snapshot` (RDS snapshot before deploy), `--wait` (wait for ECS stability), `--no-bastion-stop`, `--publish-agent`.

### Worker Image Registry

Worker Docker images are used ONLY by **cloud ECS tasks** and **local WorkerMill Docker mode**. The **remote agent does NOT use Docker** — worker code is bundled into the agent binary.

- `--worker` pushes to private ECR (`AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/workermill-dev/worker:latest`)
- To update **remote agent** workers: release a new agent binary
- To update **local WorkerMill** workers: `./bin/local-workermill build-worker`

### Database Migrations

**Migrations run automatically on API startup.**

1. `cd api && npm run migrate:create AddMyNewColumn`
2. Edit the generated file in `api/src/db/migrations/`
3. **CRITICAL:** Register in `api/src/db/connection.ts` (import + add to `migrations` array)
4. Deploy: `./deploy.sh --api`

**Rules:**
- Always use `IF NOT EXISTS` / `IF EXISTS` for idempotency
- Deploy script validates all migrations are registered

---

## Git Workflow

**Always work directly on `main` branch.** Do NOT create feature branches.

**Why:** Multiple Claude Code terminals may work simultaneously. Working on `main` ensures all agents see changes immediately.

| Change Type | Visibility |
|-------------|------------|
| Uncommitted file edits | Instant (shared filesystem) |
| Committed changes | Requires `git pull` in other terminals |

**Before changes:** `git pull`
**After changes:** Commit and push to both remotes: `git push origin main && git push upstream main`

**Git remotes:** `origin` = `jarod-rosenthal/workermill` (dev, public), `upstream` = `workermill/workermill` (prod, private).

**Note:** AI workers use git worktrees for parallel expert execution (`worker/epic/git-ops.ts`). This is separate from the development workflow — workers create temporary worktrees within the target repo clone, not within this repository.

---

## Common Pitfalls

### TypeORM `.save()` Clobbers Concurrent Changes

TypeORM `.save(entity)` writes ALL columns, not just changed ones. If you read an entity, do async work, then `.save()`, you'll overwrite any changes made by other processes during that async work. **Use atomic `UPDATE...WHERE` for status transitions after async work:**

```typescript
// WRONG — clobbers concurrent changes
const task = await repo.findOneBy({ id });
task.status = "running";
await repo.save(task); // writes ALL columns from stale read

// RIGHT — atomic update
await repo.update({ id, status: "queued" }, { status: "running" });
```

### Express Route Ordering with Middleware

`router.use(middleware)` runs for ALL routes defined AFTER it, not just routes in the same file section. If you add a global `router.use(authenticateApiKey)` in a route file, any route defined below it will require API key auth — even if you intended it for JWT/dashboard auth. **Always check route ordering when mixing auth strategies.**

### Org Credentials Are in the Database, NOT Secrets Manager

All org integration credentials (SCM tokens, API keys, Jira, Linear, AWS) are stored in the **`org_credentials` table** (encrypted at rest via TypeORM subscriber). Access via `getOrgSecretFromDb(orgId, key)` in `api/src/utils/org-secret-store.ts`. **We do NOT use AWS Secrets Manager for org credentials.** Many code comments still say "Secrets Manager" — these are stale and should be updated when touched. The only remaining Secrets Manager usage is for ECS task definition env vars (GitHub OAuth client secret, database URL) managed by Terraform.

### Agent Pitfalls

- **Editing `agent/src/` locally does NOTHING to remote agents** — release a new binary. For local development: `cd agent && npm run build && npm link` then restart the agent.
- **Polyglot binary:** Single binary serves CLI/worker/manager via `__WORKERMILL_MODE` env var
- **Remote agent workers** run as native process self-invocations by default, OR inside Docker sandbox (`agent/src/docker-spawner.ts`) when enabled in VS Code settings
- **Four spawners:** `agent/src/spawner.ts` (remote agent native), `agent/src/docker-spawner.ts` (remote agent Docker sandbox), `api/src/services/local-epic-spawner.ts` (local Docker), `api/src/services/ecs-task-runner.ts` (cloud ECS) — always ask which environment before changes
- **Docker Desktop socket mount:** On Windows/macOS/WSL, Docker Desktop translates `/var/run/docker.sock` to its internal named pipe — do NOT gate the mount on `fs.existsSync()`. Always mount unconditionally on Docker Desktop platforms. `isDockerDesktop()` must include `win32`.
- **VS Code extension REQUIRES the remote agent** — it cannot connect to the local WorkerMill API directly
- **Planning runs ONLY in the remote agent** — local WorkerMill Docker mode and cloud ECS skip planning
- **`dotenv/config` type error is intentional** — optional dependency, do not "fix" by removing or adding to deps

### Two Board Systems (CRITICAL)

There are TWO separate board/project systems — do NOT confuse them:
- **Boards** (`/api/boards`, `KbBoard`/`KbCard`) = Trello-like Kanban. **This is what the user sees** on the dashboard at `/boards`.
- **Projects** (`/api/projects`, `Project`/`InternalTask`) = Jira-like epic/story system. Frontend redirects `/projects` → `/boards` — **Projects are NOT visible in the Boards UI.**

**ALWAYS use `/api/boards` to create items the user will see.**

### Board Execution Engine

`api/src/services/board-execution.ts` handles dependency-ordered card execution. When a card completes, it cascade-triggers dependent cards (`KbCardDependency` model). PRD decomposition (`POST /api/prd/decompose`) creates boards with dependency-ordered cards that execute via this engine. Run-all and cancel-all endpoints operate on entire boards.

### Quality Gate Architecture (CRITICAL)

Quality gates enforce code quality at two checkpoints during worker execution. Both are in `worker/epic/executor.ts`.

**Gate 1 — Pre-Commit (SCM-agnostic):** Runs shell commands before every commit. Commands come from `quality_gate_commands` column on `kb_boards` (JSONB), populated at PRD decomposition time. Each gate has a `name`, `trigger` glob, and `commands` array. The executor matches changed files against trigger globs and runs matching gate commands.

**Gate 2 — Post-Push CI Verification (SCM-aware):** After pushing a branch, polls the CI provider API to verify the pipeline passes. Dispatches by `SCM_PROVIDER` env var:
- `github` → `pollGitHubActionsCI()` — uses `gh api` to check GitHub Actions workflow runs
- `bitbucket` → `pollBitbucketPipelinesCI()` — uses Bitbucket Pipelines REST API with Bearer token auth
- Other providers → skips CI polling gracefully

**Quality gate commands are baked into the board at PRD decomposition time** and cannot be changed mid-run. If the PRD prompt generates bad commands (e.g., tools not installed), you must cancel the run, fix the prompt, and re-decompose.

**PRD prompt is the single source of truth** for what commands the LLM generates. The canonical prompt lives in `api/src/services/prd-decomposer.ts` and is served to agents via `GET /api/agent/prd-prompt`. The agent fallback prompt in `agent/src/local-api.ts` must stay in sync.

**Standard toolchain restriction:** Quality gate commands run in a minimal container. Only use tools from the standard toolchain:
- **Go:** `go vet ./...`, `go test ./... -v -count=1 -race`, `go build ./...`, `gofmt -w .` (NOT `gofmt ./...` — gofmt doesn't support `...`)
- **Node.js:** `npm run lint`, `npm run test`, `npm run build`
- **TypeScript:** `npx tsc --noEmit`
- **SvelteKit:** `npx svelte-check`
- **Python:** `python -m pytest`, `python -m mypy .`
- Do NOT use `golangci-lint`, `staticcheck`, or other third-party tools — they may not be installed

**Tool installation timing issue:** `worker/install-tools.sh` runs at container startup when the repo is bare (no go.mod yet). By the time experts create Go code, the installer has already finished. The executor re-runs `install-tools.sh` against the worktree before quality gates execute to pick up newly-created project files.

**Key files:**
- `worker/epic/executor.ts` — `runPreCommitGate()`, `runPostPushCIGate()`, `pollGitHubActionsCI()`, `pollBitbucketPipelinesCI()`
- `api/src/services/prd-decomposer.ts` — PRD prompt + validation (canonical source)
- `agent/src/local-api.ts` — Agent fallback PRD prompt (must match API prompt)
- `api/src/routes/prd.ts` — Writes `quality_gate_commands` and `ci_workflow_path` to board

### Orchestrator Module Architecture

The orchestrator is decomposed into focused modules in `api/src/services/`: `orchestrator.ts` (entry point — poll loop + lifecycle), `task-claimer.ts`, `worker-spawner.ts`, `task-dispatch.ts`, `task-monitor.ts`, `task-cleanup.ts`, `planning-workflow.ts`, `manager-workflow.ts`, `orchestrator-utils.ts`. Edit the relevant module — `orchestrator.ts` is just the coordination hub.

### Orchestrator is Multi-Instance Ready

The orchestrator is **stateless** — all state lives in the database, and every mutation uses atomic `UPDATE...WHERE`. Multiple orchestrator instances can run safely:

- **Task claiming**: `claimTask()` uses atomic `UPDATE...WHERE status = 'queued'` — two instances competing never double-claim.
- **Task monitoring**: `monitorExecutingTasks()` queries DB for all executing tasks — any instance can monitor any task.
- **Cleanup**: All cleanup functions are DB-driven and idempotent.
- **Cron jobs**: Periodic jobs (stale coordination cleanup, orphaned task detection, warm pools, trial reminders, marketing agent, hourly cleanup) are guarded by Redis `SETNX` distributed locks so only one instance runs each job per interval. If Redis is down, all instances run (graceful degradation to old behavior).

**Lock keys** (in `orchestrator.ts` and `task-cleanup.ts`): `orchestrator:lock:stale-coordination` (55s), `orchestrator:lock:board-cascade-sweep` (55s), `orchestrator:lock:orphaned-tasks` (280s), `orchestrator:lock:warm-pools` (25s), `orchestrator:lock:trial-reminders` (1h), `orchestrator:lock:marketing-agent` (configurable), `orchestrator:lock:hourly-cleanup` (~1h).

**In-memory state** (`orchestrator-utils.ts`): `state` (running/poll counters — local bookkeeping only), `activeOps` (in-flight promise cap of 10 per instance — prevents one instance from over-spawning). Neither requires cross-instance coordination.

### Planner Architecture (v0.8.0)

Single-agent planning + repo clone in `agent/src/planner.ts`. Critic threshold **85**/100, max 3 iterations, dynamic file cap per story (5/6/8). **Do NOT change** critic threshold, stdin prompt delivery, or `--verbose` flag without asking. See MEMORY.md for full details.

### Heartbeat Must Always Update

The agent heartbeat endpoint must ALWAYS update `remote_agents.last_heartbeat_at` even when there are 0 active tasks. Otherwise the orchestrator thinks the agent is offline and starts claiming tasks itself.

### Code Events Architecture (Live Code View)

The API is **stateless** for code events — it stores raw immutable events and does NOT maintain cumulative file state. Clients reconstruct file snapshots themselves.

**Flow:** Worker → `POST /api/control-center/code-events` → stored as `WorkerTaskLog` (type `code_event`) → SSE broadcast via in-memory EventEmitter → clients poll/stream and accumulate state.

**What the API stores per event:**
- `toolName`: "Write" or "Edit"
- `filePath`, `expert`
- `metadata.newStr` (both Write and Edit), `metadata.oldStr` (Edit only)
- Truncated at 50KB for DB persistence, 100KB for SSE

**Client-side state accumulation** (dashboard `MainDashboard.tsx` + VS Code `live-diff-manager.ts`):
- **Write event:** `before=""`, `after=content` (new file — all-green diff)
- **Edit event (first):** `before=oldStr`, `after=newStr` (freeze `before`)
- **Edit event (subsequent):** `before` stays frozen, `after=newStr` (only latest diff shown)
- VS Code polls incrementally via `?since=timestamp`, dashboard uses SSE

**Key files:**
- `api/src/routes/control-center/code-events.ts` — POST/GET endpoints
- `api/src/services/code-events.ts` — EventEmitter for real-time SSE
- `worker/epic/executor.ts` — `postCodeEvent()` (fire-and-forget)
- `frontend/src/components/DiffView.tsx` — syntax-highlighted diff renderer
- `frontend/src/components/LiveCodeViewer.tsx` — `DiffFile` interface, file sidebar + diff view
- `packages/vscode-workermill/src/live-diff-manager.ts` — native diff editor with polling

**Do NOT:** Add server-side file state accumulation, pre-computed snapshots, or "current file content" endpoints. The stateless design scales because the API never stores "what should the file look like right now."

---

## Hooks & Skills

**Auto-formatting:** Prettier runs automatically after Write/Edit to `.ts`/`.tsx`/`.js`/`.jsx` files.

### /val-imp

Enforces strict plan adherence: extracts requirements, implements one at a time, spawns independent validator agent after each.

**Usage:** `/val-imp docs/my-feature-plan.md`

---

## MCP Tools Available

MCP servers: `workermill` (task management, orchestrator, codebase RAG), `github`, `jira`, `ollama`, `oncallshift`. Tools are auto-discoverable.

**Codebase RAG** (WorkerMill MCP): `workermill_codebase_search` (semantic search, use `multiQuery: true` for broader recall), `workermill_codebase_symbol`, `workermill_codebase_file`, `workermill_codebase_index`, `workermill_codebase_status`. Requires Ollama + `nomic-embed-text` + `codebaseIndexingEnabled: true` in org settings.

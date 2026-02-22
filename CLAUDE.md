***REMOVED*** CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

***REMOVED******REMOVED*** 🚨🚨🚨 ABSOLUTE RULE — NEVER BYPASS PROCESSES 🚨🚨🚨

**NEVER change `EXECUTION_MODE`, kill dev environment processes, restart services, add the `workermill` label, trigger worker tasks, or bypass authentication to hit the API directly. NEVER use `EXECUTION_MODE=local` to skip Cognito auth. NEVER kill processes on ports 3001/5173/5433 without explicit user approval. NEVER add the `workermill` label to a card — it auto-triggers a worker task. The ONLY way to start/stop/restart the dev environment is `./bin/local-workermill start|stop` — run by the USER, not by Claude. If you need to interact with the boards API and auth is in the way, ASK THE USER. Do not work around it.**

**NEVER create board cards by bypassing the normal process. Claude does NOT have auth to use the boards API directly. If the user asks to create a card, provide the card details as TEXT OUTPUT for the user to create through the dashboard UI. Do not attempt to curl the API, change auth modes, or work around authentication in any way.**

***REMOVED******REMOVED*** ⛔ Critical Rules - READ FIRST

***REMOVED******REMOVED******REMOVED*** DO NOT CHANGE Working Patterns

**These working solutions must NOT be changed without explicit user request:**

| Pattern | Implementation | Why It's Sacred |
|---------|----------------|-----------------|
| **Log streaming** | PostgreSQL + SSE, NOT CloudWatch | Took a week to get working. Worker posts to `/api/tasks/:taskId/logs`, SSE streams from database every 500ms. |
| **Task orchestration** | Database polling with atomic claim | Polls for queued tasks, claims via UPDATE...WHERE, spawns ECS |
| **Worker entrypoint** | `post_log()` shell function | Posts terminal output to API in real-time |
| **LLM Models** | NEVER change without approval | No default model changes, no provider switches, no model name changes in code/env/config |

**If you think something could be "better" (CloudWatch, WebSockets, etc.), ASK FIRST.**

***REMOVED******REMOVED******REMOVED*** DO NOT Touch the Local Database

**On 2026-02-16, Claude dropped the local PostgreSQL database (`DROP DATABASE workermill`) without permission while debugging a "loading logs" issue. The data only existed locally and was permanently destroyed. This must NEVER happen again.**

- **NEVER** run `DROP DATABASE`, `DROP SCHEMA`, or `TRUNCATE` on any database without explicit user approval
- **NEVER** run destructive SQL commands as a "debugging step" — read-only queries only
- **NEVER** assume a database is empty or broken just because a query returns no results — verify from multiple angles first
- **NEVER** recreate, reset, or wipe a database to "fix" a migration issue — ask the user first
- If the database appears empty or broken, **STOP and ask the user** before taking any action
- The local Docker PostgreSQL (`workermill-local-db` on port 5433) may contain data that does NOT exist anywhere else — treat it as production-critical

***REMOVED******REMOVED******REMOVED*** DO NOT Directly INSERT into the Database to Create Board Cards

**NEVER use raw SQL INSERT to create `kb_cards` rows.** The API assigns `card_number` auto-incrementing per board — raw INSERTs skip this and produce cards with no number.

- **ALWAYS** use the boards API: `POST /api/boards/:boardId/cards`
- If authentication is required, obtain a valid JWT token first (e.g., via Cognito or a test login endpoint)
- If the API is not accessible, **ask the user** rather than bypassing it with raw SQL

***REMOVED******REMOVED******REMOVED*** DO NOT Relax Security

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

***REMOVED******REMOVED******REMOVED*** DO NOT Expose Authenticated Features on Public Pages

**The landing/home page (`LandingV0.tsx`, `Home/v0/Header.tsx`) is PUBLIC — visible to unauthenticated users.** NEVER add links to authenticated features (Docs, Dashboard, Settings, etc.) on public pages.

- **Docs** (`/docs`) are public — accessible without authentication. Linked from landing page nav.
- **Landing page nav** should only contain: Showcase, How It Works, Pricing, Docs, Sign in, Get Started
- If a feature requires login, its link belongs behind auth (sidebar, profile dropdown, dashboard)

***REMOVED******REMOVED******REMOVED*** DO NOT Modify Infrastructure Outside Terraform

**Terraform is the ONLY source of truth. NEVER:**
- Create AWS resources via console
- Manually modify ECS task definitions
- Push Docker images without using `deploy.sh`
- Change security groups, IAM roles, or networking outside Terraform
- Use `terraform apply -target` without **explicit user approval** — targeted applies cause state drift that compounds over time and creates dangerous surprises on the next full apply

***REMOVED******REMOVED******REMOVED*** DO NOT Add Labels When Creating Jira Tickets

**Create tickets with NO LABELS.** The `workermill` label triggers automatic AI worker deployment. Adding labels without explicit permission has caused production incidents.

**Only add labels AFTER ticket creation, with explicit user approval.**

***REMOVED******REMOVED******REMOVED*** DO NOT Auto-Process Stale Tasks

When fixing orchestrator bugs:
- Do NOT add code that bulk-processes stuck tasks
- Add staleness checks (skip tasks older than 1 hour)
- Fix the bug for future tasks, leave existing stuck tasks alone
- User controls task execution via dashboard UI

***REMOVED******REMOVED******REMOVED*** DO NOT Use Outdated Bitbucket Auth

**Bitbucket uses Repository Access Tokens, NOT app passwords (deprecated).**

| Use Case | Correct Method |
|----------|----------------|
| REST API | `Authorization: Bearer <token>` |
| Git URLs | `https://x-token-auth:<token>@bitbucket.org/...` |

**WRONG:** `Basic auth with username:app_password` - this is deprecated
**RIGHT:** `Bearer token` for API, `x-token-auth` for git

***REMOVED******REMOVED******REMOVED*** DO NOT Make Changes Without Communicating

- **Before any code change**: Explain what you're about to modify
- **When instructions are unclear**: Ask, don't assume
- **Before deploying**: Wait for explicit approval ("go", "yes", "deploy")
- **Keep changes minimal**: Only do what was asked, nothing extra
- **No silent deployments**: Always state what's being deployed

***REMOVED******REMOVED******REMOVED*** DO NOT Deploy to Dev Environment

**The dev environment (dev.workermill.com) is NOT RUNNING.** Always deploy to prod:
- Use `./deploy.sh --api` (NOT `--env dev`)
- Use `./deploy.sh --frontend` (NOT `--env dev`)
- Use `./deploy.sh --worker` (NOT `--env dev`)

***REMOVED******REMOVED******REMOVED*** DO NOT Release Agent Without Bumping Version

**Always bump `agent/package.json` version before releasing.** The version is embedded at compile time via esbuild `define`. To release: bump version → `git tag agent-v<version>` → `git push --tags` → GitHub Actions builds binaries. npm publish is still supported as a fallback: `cd agent && npm run build && npm publish --access public`.

***REMOVED******REMOVED******REMOVED*** Rebuild After worker/ Changes

Worker code (`worker/epic/*.ts`) is used in TWO places — the Docker image AND the agent binary. Changes to worker code require rebuilding the right artifact depending on which execution path you use.

| Execution path | Where worker code lives | How to rebuild |
|----------------|------------------------|----------------|
| **Remote agent** (production) | Bundled into agent binary at build time (esbuild) | Release new agent binary: bump version → `git tag agent-v<version>` → push |
| **Local WorkerMill Docker** | Docker image compiled by `tsc` | `./bin/local-workermill build-worker` |
| **Cloud ECS** | ECR Docker image | `./deploy.sh --worker` |

| What you want to change | Where to edit | Then what |
|--------------------------|---------------|-----------|
| Worker runtime code | `worker/epic/*.ts` | Rebuild agent binary AND/OR Docker image (see above) |
| Container env vars (local mode) | `api/src/services/local-epic-spawner.ts` (`buildEnvArgs`) | Restart API |
| API-side orchestration | `api/src/services/orchestrator.ts` and modules | Restart API |

---

***REMOVED******REMOVED*** Recent Changes (keep updated)

- 2026-02-15: Worker Decision Service extracted from worker to API (`api/src/services/worker-decision-engine.ts`). Workers call via `DecisionClient` (`worker/epic/decision-client.ts`).
- 2026-02-16: v0.8.0 planner — single-agent planning + repo clone replaced 3-analyst team planning. Critic threshold 85/100.
- 2026-02-16: `error-classifier.ts` and `quality-gate.ts` removed from worker — logic moved to decision service and `auto-fix-agent.ts`.

---

***REMOVED******REMOVED*** Detailed Reference (read on demand)

- **Local dev setup**: `docs/claude/local-dev.md`
- **Remote agent + VS Code extension**: `docs/claude/agent-and-vscode.md`
- **Architecture** (models, routes, task flow, execution modes): `docs/claude/architecture.md`
- **Jira/webhook integrations**: `docs/claude/integrations.md`
- **Infrastructure** (Terraform, SES): `docs/claude/infrastructure.md`
- **Troubleshooting**: `docs/claude/troubleshooting.md`
- **Testing + CI/CD**: `docs/claude/testing.md`

---

***REMOVED******REMOVED*** Quick Reference

**Ports:** API: 3001, Frontend: 5173, Local DB: 5433

| Task | Command |
|------|---------|
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

***REMOVED******REMOVED*** Project Overview

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

***REMOVED******REMOVED******REMOVED*** WorkerMill vs Target Repositories

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

***REMOVED******REMOVED******REMOVED*** Codebase Structure

Focus on these directories (production services):
- `api/` - Backend API deployed to ECS
- `frontend/` - React dashboard deployed to CloudFront
- `worker/` - Worker container images
- `agent/` - Remote agent CLI (standalone binary, published to npm as fallback)
- `packages/vscode-workermill/` - VS Code extension (IDE companion for remote agent)
- `packages/workermill-mcp/` - WorkerMill MCP server (published to npm)
- `packages/oncallshift-mcp/` - OncallShift MCP server (published to npm)

Ignore other `packages/*` directories - original modular architecture, not actively deployed.

User-facing documentation is at https://workermill.com/docs (overview, quick start, integrations, task lifecycle, personas, epics, analytics, MCP, advanced).

---

***REMOVED******REMOVED*** Deployment

**ALWAYS use `deploy.sh` for ALL deployments.** Never manually build/push Docker images. Run `./deploy.sh --frontend` after UI changes.

**Additional deploy.sh flags:** `--skip-build`, `--db-check`, `--check-migrations`, `--snapshot` (RDS snapshot before deploy), `--wait` (wait for ECS stability), `--no-bastion-stop`, `--publish-agent`.

***REMOVED******REMOVED******REMOVED*** Worker Image Registry

Worker Docker images are used ONLY by **cloud ECS tasks** and **local WorkerMill Docker mode**. The **remote agent does NOT use Docker** — worker code is bundled into the agent binary.

- `--worker` pushes to private ECR (`AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/workermill-dev/worker:latest`)
- To update **remote agent** workers: release a new agent binary
- To update **local WorkerMill** workers: `./bin/local-workermill build-worker`

***REMOVED******REMOVED******REMOVED*** Database Migrations

**Migrations run automatically on API startup.**

1. `cd api && npm run migrate:create AddMyNewColumn`
2. Edit the generated file in `api/src/db/migrations/`
3. **CRITICAL:** Register in `api/src/db/connection.ts` (import + add to `migrations` array)
4. Deploy: `./deploy.sh --api`

**Rules:**
- Always use `IF NOT EXISTS` / `IF EXISTS` for idempotency
- Deploy script validates all migrations are registered

---

***REMOVED******REMOVED*** Git Workflow

**Always work directly on `main` branch.** Do NOT create feature branches.

**Why:** Multiple Claude Code terminals may work simultaneously. Working on `main` ensures all agents see changes immediately.

| Change Type | Visibility |
|-------------|------------|
| Uncommitted file edits | Instant (shared filesystem) |
| Committed changes | Requires `git pull` in other terminals |

**Before changes:** `git pull`
**After changes:** Commit and push promptly

**Note:** AI workers use git worktrees for parallel expert execution (`worker/epic/git-ops.ts`). This is separate from the development workflow — workers create temporary worktrees within the target repo clone, not within this repository.

---

***REMOVED******REMOVED*** Common Pitfalls

***REMOVED******REMOVED******REMOVED*** TypeORM `.save()` Clobbers Concurrent Changes

TypeORM `.save(entity)` writes ALL columns, not just changed ones. If you read an entity, do async work, then `.save()`, you'll overwrite any changes made by other processes during that async work. **Use atomic `UPDATE...WHERE` for status transitions after async work:**

```typescript
// WRONG — clobbers concurrent changes
const task = await repo.findOneBy({ id });
task.status = "running";
await repo.save(task); // writes ALL columns from stale read

// RIGHT — atomic update
await repo.update({ id, status: "queued" }, { status: "running" });
```

***REMOVED******REMOVED******REMOVED*** Express Route Ordering with Middleware

`router.use(middleware)` runs for ALL routes defined AFTER it, not just routes in the same file section. If you add a global `router.use(authenticateApiKey)` in a route file, any route defined below it will require API key auth — even if you intended it for JWT/dashboard auth. **Always check route ordering when mixing auth strategies.**

***REMOVED******REMOVED******REMOVED*** Agent Pitfalls

- **Editing `agent/src/` locally does NOTHING to remote agents** — release a new binary. For local development: `cd agent && npm run build && npm link` then restart the agent.
- **Polyglot binary:** Single binary serves CLI/worker/manager via `__WORKERMILL_MODE` env var
- **Remote agent does NOT use Docker** — workers are native process self-invocations of the agent binary
- **Three spawners:** `agent/src/spawner.ts` (remote agent), `api/src/services/local-epic-spawner.ts` (local Docker), `api/src/services/ecs-task-runner.ts` (cloud ECS) — always ask which environment before changes
- **VS Code extension REQUIRES the remote agent** — it cannot connect to the local WorkerMill API directly
- **Planning runs ONLY in the remote agent** — local WorkerMill Docker mode and cloud ECS skip planning
- **`dotenv/config` type error is intentional** — optional dependency, do not "fix" by removing or adding to deps

***REMOVED******REMOVED******REMOVED*** Two Board Systems (CRITICAL)

There are TWO separate board/project systems — do NOT confuse them:
- **Boards** (`/api/boards`, `KbBoard`/`KbCard`) = Trello-like Kanban. **This is what the user sees** on the dashboard at `/boards`.
- **Projects** (`/api/projects`, `Project`/`InternalTask`) = Jira-like epic/story system. Frontend redirects `/projects` → `/boards` — **Projects are NOT visible in the Boards UI.**

**ALWAYS use `/api/boards` to create items the user will see.**

***REMOVED******REMOVED******REMOVED*** Orchestrator Module Architecture

The orchestrator is decomposed into focused modules in `api/src/services/`: `orchestrator.ts` (entry point — poll loop + lifecycle), `task-claimer.ts`, `worker-spawner.ts`, `task-dispatch.ts`, `task-monitor.ts`, `task-cleanup.ts`, `planning-workflow.ts`, `manager-workflow.ts`, `orchestrator-utils.ts`. Edit the relevant module — `orchestrator.ts` is just the coordination hub.

***REMOVED******REMOVED******REMOVED*** Planner Architecture (v0.8.0)

Single-agent planning + repo clone in `agent/src/planner.ts`. Critic threshold **85**/100, max 3 iterations, dynamic file cap per story (5/6/8). **Do NOT change** critic threshold, stdin prompt delivery, or `--verbose` flag without asking. See MEMORY.md for full details.

***REMOVED******REMOVED******REMOVED*** Heartbeat Must Always Update

The agent heartbeat endpoint must ALWAYS update `remote_agents.last_heartbeat_at` even when there are 0 active tasks. Otherwise the orchestrator thinks the agent is offline and starts claiming tasks itself.

---

***REMOVED******REMOVED*** Hooks & Skills

**Auto-formatting:** Prettier runs automatically after Write/Edit to `.ts`/`.tsx`/`.js`/`.jsx` files.

***REMOVED******REMOVED******REMOVED*** /val-imp

Enforces strict plan adherence: extracts requirements, implements one at a time, spawns independent validator agent after each.

**Usage:** `/val-imp docs/my-feature-plan.md`

---

***REMOVED******REMOVED*** MCP Tools Available

MCP servers: `workermill` (task management, orchestrator, codebase RAG), `github`, `jira`, `ollama`, `oncallshift`. Tools are auto-discoverable.

**Codebase RAG** (WorkerMill MCP): `workermill_codebase_search` (semantic search, use `multiQuery: true` for broader recall), `workermill_codebase_symbol`, `workermill_codebase_file`, `workermill_codebase_index`, `workermill_codebase_status`. Requires Ollama + `nomic-embed-text` + `codebaseIndexingEnabled: true` in org settings.

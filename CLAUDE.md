# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WorkerMill: the open-source operations layer for AI coding agents. Deployed at https://workermill.com.

**Stack:** Express+TypeORM+PostgreSQL (`api/`), React 19+Vite (`frontend/`), standalone binary agent (`agent/`), VS Code extension (`packages/vscode-workermill/`), worker Docker images (`worker/`).

**Key directories:** `api/`, `frontend/`, `worker/`, `agent/`, `packages/vscode-workermill/`, `packages/workermill-mcp/`

---

## Quick Reference

**Ports:** API: 3001, Frontend: 5173, Local dev DB: 5432, Bastion tunnel: 5433, Redis: 6379

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

### Three Execution Modes
1. **Full Cloud**: Everything on ECS. Anthropic API keys. Cognito auth. Workers run as ECS tasks.
2. **VS Code + Local Worker**: Agent binary runs on user's machine, spawns workers locally in Docker. Talks to cloud API or local dev API.
3. **Local Dev**: `./bin/local-workermill start` — API runs natively via `npm run dev`, `EXECUTION_MODE=local` bypasses Cognito auth and billing. Workers spawned by `local-epic-spawner` in Docker.

All three modes use the SAME API code. `EXECUTION_MODE=local` is only for local development — it bypasses auth, billing, and TOS. Any API or DB change must work in all modes.

### Planning: Orchestrator vs Agent
Planning tasks are handled by either the API orchestrator or the agent, depending on whether an agent is connected:
- **Agent connected** (heartbeat active): Orchestrator's `findPlanningTasks()` skips orgs with active agents. Agent polls `/api/agent/poll`, claims planning tasks, runs Claude CLI locally.
- **No agent** (cloud-only or local dev): Orchestrator claims and plans directly via `AiSdkBackend` (API key) or `ClaudeCliBackend` (OAuth in local dev).

### Docker Images (all on ghcr.io/jarod-rosenthal/)
- `worker` — sandbox container for task execution
- `api` — API server
- `frontend` — nginx serving React build
- All three built by agent release CI (`agent-v*` tag), tagged with agent version + `:latest`

### Worker Rebuild Matrix
| Path | Where code lives | Rebuild |
|------|-----------------|---------|
| Remote agent native | Bundled in agent binary | Release new agent binary |
| Remote agent Docker sandbox | GHCR image | `git tag agent-v<version>` → CI builds + pushes to GHCR + updates ECS |
| Local Docker | Docker image via `tsc` | `./bin/local-workermill build-worker` |
| Cloud ECS | GHCR image (via task definition) | Automatic on agent release; manual: `./deploy.sh --worker` |

### Spawners
`agent/src/spawner.ts` (remote native), `agent/src/docker-spawner.ts` (remote Docker sandbox), `api/src/services/local-epic-spawner.ts` (local dev), `api/src/services/ecs-task-runner.ts` (cloud container). Always ask which environment before changes.

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

### Common Pitfalls
- **NEVER override `.gitignore`** — do not use `git add -f`, `git add -A`, or `git add .` to stage files. Always add specific files by name. If a file is gitignored, it stays gitignored. If you think it should be tracked, ask first.
- **TypeORM `.save()`** clobbers concurrent changes — use atomic `UPDATE...WHERE` for status transitions.
- **Express route ordering**: `router.use(middleware)` applies to ALL routes defined after it.
- **Org credentials**: In `org_credentials` table (NOT Secrets Manager). Access via `getOrgSecretFromDb()`.
- **Agent edits locally do NOTHING** to remote agents — release a new binary.
- **Docker Desktop socket**: Don't gate mounts on `fs.existsSync()`. `isDockerDesktop()` must include `win32`.
- **Planner**: Single-agent + repo clone. Critic threshold 85/100 (matches production). Don't change without asking.
- **Hardcoded fallbacks**: `?? <value>` and `|| "<value>"` patterns hide bugs. Org settings come from DB — pass through without fallbacks.
- **Frontend vs VS Code settings**: These are separate codebases that MUST behave identically. Any settings change in one must be mirrored to the other.

### Task Status (22 states)
- **Planning:** `planning`, `pending_plan_approval`
- **Active:** `queued`, `dispatching`, `claimed`, `environment_setup`, `executing`, `running` (legacy), `consolidating`, `integration_check`, `deploying`
- **Waiting:** `blocked`, `pr_created`, `review_requested`, `manager_review`, `revision_needed`, `pr_approved`, `review_approved`, `escalated`
- **Terminal:** `completed`, `deployed`, `failed`, `cancelled`, `review_rejected`
- When no auto-workflow is configured (autoReviewEnabled=false, autoDeployEnabled=false), waiting states `review_requested`, `pr_created`, `pr_approved` transition directly to `completed`.

### Quality Gates
Gate 1: pre-commit shell commands from `quality_gate_commands` board column. Gate 2: post-push CI polling (GitHub Actions, Bitbucket Pipelines, or GitLab CI — all supported via `/api/worker-decisions/ci-status`). Standard toolchain only. PRD prompt is source of truth (`api/src/services/prd-decomposer.ts`). See `worker/epic/executor.ts` for details.

### Orchestrator
Modules in `api/src/services/`: `orchestrator.ts` (hub), `task-claimer.ts`, `worker-spawner.ts`, `task-dispatch.ts`, `task-monitor.ts`, `task-cleanup.ts`, `planning-workflow.ts`, `manager-workflow.ts`. Stateless — all state in DB. Cron jobs use Redis SETNX locks.

### Release Tags
- **Agent**: Bump `agent/package.json` → `git tag agent-v<version>` → push tag → CI builds 4 platform binaries + all 3 Docker images + updates ECS.
- **VS Code**: Bump `packages/vscode-workermill/package.json` → `git tag vscode-v<version>` → push tag → CI publishes to Marketplace.

### Multi-Provider Support
AI providers: `anthropic` (default, Claude Agent SDK), `openai`, `google`, `ollama` (all via Vercel AI SDK). SCM providers: `github`, `gitlab`, `bitbucket`. Worker decision logic (error classification, quality gates, CI status) served by API at `/api/worker-decisions/` — IP lives in `api/src/services/worker-decision-engine.ts`.

### Production Defaults (workermill-examples org)
These are the battle-tested defaults. Use for all new org seeds and settings fallbacks:
- Worker: claude-sonnet-4-6, Planner: claude-opus-4-6, Reviewer: claude-opus-4-6
- maxParallelExperts: 10, maxStories: 10, maxTargetFiles: 20
- maxPerStoryRevisions: 0, maxReviewRevisions: 4, maxFixRetries: 5
- criticApprovalThreshold: 85, planningMode: simplified, prdPlanningMode: strict
- All quality gates enabled, autoFixEnabled: true, autoFixMaxIterations: 3
- selfReviewEnabled: false, autoReviewEnabled: false, pushAfterCommit: true

---

## API Internals

### Authentication Middleware (`api/src/middleware/auth.ts`)
Four strategies — pick the right one when adding routes:
1. **`authenticateUser()`** — Cognito JWT + org context. Sets `req.user`, `req.organization`, `req.orgRole`. Falls back to local admin when `EXECUTION_MODE=local`.
2. **`authenticateApiKey()`** — Org keys (`wm_` prefix, hashed in `organizations.apiKeyHash`) or user keys (`usr_` prefix, in `user_api_keys` table with expiry).
3. **`authenticateUserAllowNoOrg()`** — Same as #1 but allows users without org membership (onboarding flows).
4. **`authenticateCognitoOnly()`** — JWT only, no org lookup (signup flows).

### Rate Limiting
Applied at route mount time in `src/index.ts`, NOT inside route modules. Four tiers:
- `webhookLimiter` (100/min), `authenticatedLimiter` (200/min), `strictLimiter` (10/min), `workerLogLimiter` (1000/min)
- Redis-backed with in-memory fallback. Keyed by `user:${id}` or `org:${id}` (authenticated) or IP (public).

### Entity Encryption
TypeORM subscribers auto-encrypt sensitive fields on INSERT/UPDATE and decrypt on SELECT. Pattern: `@EventSubscriber()` class implements `EntitySubscriberInterface<T>`. Examples: `OrgCredentialEncryptionSubscriber`, `OrganizationEncryptionSubscriber`. Transparent — no manual encrypt/decrypt in business logic.

### Database Registration
New entities must be added to the `entities: [...]` array in `api/src/db/connection.ts`. New migrations must be added to the `migrations: [...]` array in the same file. No glob patterns — explicit imports only.

### Integration Test Pattern
Tests use transaction isolation: `beforeEach` starts a transaction, `afterEach` rolls back. Use `getTestManager()` for the scoped `EntityManager`. Config: `vitest.integration.config.ts` (sequential, 60s timeout, requires `DATABASE_URL`).

### Graceful Shutdown
SIGTERM/SIGINT → stop orchestrator → wait up to 20s for fire-and-forget ops → close HTTP server → force-exit after 25s. ECS `stopTimeout` is 30s, so the 25s force-exit leaves margin.

---

## Agent Binary

### Polyglot Binary (`agent/src/entry.ts`)
Single binary serves multiple roles via `__WORKERMILL_MODE` env var:
- `undefined` (default) → CLI mode (`cli.ts`)
- `"worker"` → worker subprocess (spawns epic executor)
- `"ai-sdk-executor"` → Vercel AI SDK fallback spawner
- `"manager"` → review/manager agent

The agent re-invokes itself with the mode set to spawn child processes.

### Build Pipeline (`agent/build.mjs`)
1. `tsc` → ESM output
2. esbuild → 5 bundles: `cli.js`, `index.js`, `worker.js` (from `worker/epic/remote-bootstrap.ts`), `manager-worker.js` (from `worker/manager/`), `entry.js` (unified, all deps inlined)
3. `bun compile` → 4 platform binaries (linux-x64, darwin-x64, darwin-arm64, win-x64)

Cross-package bundling: agent imports `api/src/services/worker-decision-engine.ts` at build time (esbuild resolves it). Worker code bundled from `worker/` directory, not via npm dependency.

### Agent Config (`agent/src/backends/local/config.ts`)
Config stored at `~/.workermill/config.json`. Type: `AgentConfig` (previously `StandaloneConfig`). Loaded via `loadAgentConfig()`, saved via `saveAgentConfig()`. `isCloudMode()` checks if `config.mode === "cloud"`.

### Local API Server (`agent/src/local-api.ts`)
HTTP+SSE on localhost. Port written to `~/.workermill/agent.port`, bearer token to `~/.workermill/agent.token`. Endpoints: `/status`, `/health`, `/events` (SSE), `/trigger-poll`. Proxies cloud API requests from VS Code extension.

---

## Worker Internals

### AI Client Factory (`worker/ai-clients/index.ts`)
`createAIClient(config)` returns:
- `AnthropicAgentClient` — if provider is `anthropic` and `useAgentSdk !== false`. Spawns Claude CLI subprocess.
- `AISdkClient` — for all other providers (OpenAI, Google, Ollama) or Anthropic with `useAgentSdk=false`. Uses Vercel AI SDK directly.

### Epic Coordinator Flow (`worker/epic/coordinator.ts`)
Coordination loop: claim story → execute (via `StoryExecutor`) → inline review (Tech Lead + DevOps) → quality gates → auto-fix on failure → commit/push → poll for next story. Tracks completed stories for resume. Singleflight pattern prevents duplicate coordination requests. Graceful shutdown cleans up worktrees.

### Worker Docker Build (`worker/Dockerfile`)
Complex multi-module build: compiles execution scripts to CommonJS, creates type stubs for circular deps between `epic` and `multi-expert`, builds `ai-clients` → `epic` → `multi-expert` → `manager` → `standard`, then bundles all via esbuild with tree-shaking. Final image includes Git, GitHub CLI, Docker CLI, Kaniko, Claude CLI, Python 3.

### Entrypoint (`worker/epic-entrypoint.sh`)
1. Hydrate env vars from mounted files (Docker constraint)
2. Configure git (author email from GitHub API, provider-specific credentials)
3. Clone repo (GitHub/GitLab/Bitbucket URL construction)
4. Start heartbeat loop (every 30s, prevents ECS timeout)
5. Pre-install deps (npm ci/yarn/pnpm with frozen lockfile)
6. Spawn executor: `node /app/epic/dist/index.js`

---

## Frontend Internals

### State Management
Zustand stores (not Redux). Key stores:
- **`auth-store`** — tokens, user, organization, `needsSetup`, `tosRequired`. Persists tokens to localStorage.
- **`coordination-store`** — SSE-driven worker messages (file changes, decisions, blockers). Max 200 in memory, 100 persisted. Deduplicates by (parentTaskId, persona, messageType, content).

### API Client (`frontend/src/lib/api-client.ts`)
Axios with interceptors. Request interceptor adds `Authorization: Bearer`. Response interceptor handles 401 (logout + redirect), 403 with TOS flag. All `/api` calls proxied by Vite dev server to `localhost:3001`. Errors bridged to toast via `ApiToastBridge` component.

### Routing (`frontend/src/App.tsx`)
React Router v7. `ProtectedRoute` wrapper checks auth + TOS acceptance + setup completion. Public routes (Home, Blog, Docs) use `DarkRoute` wrapper for dark theme. OAuth callbacks: `/auth/callback` (Cognito), `/auth/github/callback`, `/auth/microsoft/callback`.

---

## VS Code Extension

### Agent Discovery
Reads `~/.workermill/agent.port` and `~/.workermill/agent.token` to connect to local agent HTTP server. Reconnects with exponential backoff (2s → 30s max, 20 attempts). All communication is HTTP+SSE to `127.0.0.1:{port}`.

### Extension Structure
30+ commands registered in `contributes.commands`. Key components: `agent-client.ts` (HTTP client), `team-tree.ts` (TreeDataProvider for backlog), `feed-view.ts` (coordination feed webview), `live-diff-manager.ts` (VS Code diff editor), `log-terminal.ts` (pseudo-terminal for logs), `settings-panel.ts` (config webview), `mission-control-panel.ts` (orchestrator dashboard).

---

## CI/CD Workflows (`.github/workflows/`)
All manual (`workflow_dispatch`) except `docker-images.yml` which also triggers on push to `main` affecting `api/**` or `frontend/**`.

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `agent-release.yml` | `agent-v*` tag | Builds 4 binaries → S3/CloudFront + GitHub Release. Builds 3 Docker images → GHCR. Updates ECS. |
| `vscode-release.yml` | `vscode-v*` tag | Packages VSIX → VS Code Marketplace + Open VSX + GitHub Release. |
| `ci-cd.yml` | Manual | Type check + lint + test (always). Optional: deploy API/frontend/worker, run E2E/integration tests. |
| `docker-images.yml` | Manual or push to main | Builds API + frontend images → GHCR. Updates ECS task definitions. |
| `e2e-local.yml` | Manual | Spins up local stack with mock workers, runs Playwright E2E tests. |

### Environment Config
`.env.local.example` documents all local dev env vars. Key vars: `DATABASE_URL`, `EXECUTION_MODE=local`, `CLAUDE_CODE_OAUTH_TOKEN`, `MAX_LOCAL_WORKERS`, `TARGET_REPO_PATH`, `WORKTREE_BASE_PATH`.

### Monorepo
NPM workspaces: `packages/*` (VS Code extension, MCP server). Root scripts forward to workspaces: `npm run build/lint/typecheck --workspaces`. API, worker, and agent are NOT workspaces — they have independent `node_modules`.

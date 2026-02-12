***REMOVED*** CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

- **Docs** (`/docs`) is for authenticated users only — accessible via `ProfileDropdown` and `Help.tsx`
- **Landing page nav** should only contain: Showcase, How It Works, Pricing, Sign in, Get Started
- If a feature requires login, its link belongs behind auth (sidebar, profile dropdown, dashboard)

***REMOVED******REMOVED******REMOVED*** DO NOT Modify Infrastructure Outside Terraform

**Terraform is the ONLY source of truth. NEVER:**
- Create AWS resources via console
- Manually modify ECS task definitions
- Push Docker images without using `deploy.sh`
- Change security groups, IAM roles, or networking outside Terraform

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

***REMOVED******REMOVED******REMOVED*** DO NOT Publish Agent Without Bumping Version

npm rejects same-version publishes. **Always bump `agent/package.json` version before `npm publish`.**

***REMOVED******REMOVED******REMOVED*** Rebuild Worker Image After worker/ Changes

The `worker/epic/*.ts` files are **compiled by `tsc`** during the Docker build. The container runs `node dist/index.js` (compiled TypeScript). Three legacy `.js` files (`agent-sdk.js`, `inline-reviewer.js`, `types.js`) exist in the directory but are **dead code** — not used at runtime. Worker containers do NOT auto-reload.

| What you want to change | Where to edit | Then what |
|--------------------------|---------------|-----------|
| Container runtime code (agent behavior) | `worker/epic/*.ts` | `./bin/local-workermill build-worker` |
| Container env vars (tokens, settings) | `api/src/services/local-epic-spawner.ts` (`buildEnvArgs`) | Restart API |
| API-side orchestration | `api/src/services/orchestrator.ts` and modules | Restart API |

---

***REMOVED******REMOVED*** Quick Reference

| Task | Command |
|------|---------|
| Type check API | `cd api && npm run typecheck` |
| Type check frontend | `cd frontend && npx tsc -b` |
| Deploy API (prod) | `./deploy.sh --api` |
| Deploy frontend | `./deploy.sh --frontend` |
| Deploy worker (private ECR) | `./deploy.sh --worker` |
| Deploy worker (both registries) | `./deploy.sh --worker --ecr-public` |
| Create migration | `cd api && npm run migrate:create NAME` |
| Tail API logs | `MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-dev/api" --follow --region us-east-1` |
| Build worker scripts | `cd worker/execution && npm run build` |
| Build workermill-mcp | `cd packages/workermill-mcp && npm run build` |
| Build oncallshift-mcp | `cd packages/oncallshift-mcp && npm run build` |
| Lint API | `cd api && npm run lint` |
| Lint frontend | `cd frontend && npm run lint` |
| Run API tests (Vitest) | `cd api && npm run test` |
| Run single API test | `cd api && npx vitest run src/routes/tasks.test.ts` |
| Run API tests (watch) | `cd api && npm run test:watch` |
| Run API tests (coverage) | `cd api && npm run test:coverage` |
| Run integration tests | `cd api && npm run test:integration` |
| Run E2E tests (Playwright) | `cd frontend && npm run test:e2e` |
| Run E2E tests (headed) | `cd frontend && npm run test:e2e:headed` |
| Run E2E tests (UI mode) | `cd frontend && npm run test:e2e:ui` |
| Seed database | `cd api && npm run seed` |
| Run frontend dev | `cd frontend && npm run dev` |
| Run API dev | `cd api && npm run dev` |
| Install API deps | `cd api && npm install` |
| Install frontend deps | `cd frontend && npm install` |
| Type check agent | `cd agent && npm run typecheck` |
| Agent watch mode | `cd agent && npm run dev` |
| Seed personas only | `cd api && npm run seed:personas` |
| Integration tests (watch) | `cd api && npm run test:integration:watch` |
| **Validated implementation** | `/val-imp [plan-file]` |
| **Start remote agent** | `workermill-agent start` |
| **Publish agent to npm** | `cd agent && npm run build && npm publish --access public` |

**Key files:**
- API routes: `api/src/routes/`
- Models: `api/src/models/`
- Services: `api/src/services/`
- Migrations: `api/src/db/migrations/`
- Worker directives: `worker/directives/`
- Worker execution scripts: `worker/execution/` (TypeScript source)
- Worker AIClient interface: `worker/ai-clients/` (unified execution)
- Worker Epic coordinator: `worker/epic/` (parallel expert execution)
- Frontend pages: `frontend/src/pages/`
- Frontend components: `frontend/src/components/`
- Frontend stores: `frontend/src/stores/`
- Integration tests: `api/src/__tests__/integration/`
- E2E tests: `frontend/e2e/`
- MCP servers: `packages/workermill-mcp/`, `packages/oncallshift-mcp/`
- Local WorkerMill: `bin/local-workermill`, `docker-compose.local.yml`

---

***REMOVED******REMOVED*** Local Development

Local development uses an SSH bastion to tunnel to the production RDS database. The bastion is a t4g.nano Spot instance (~$0.001/hr) that starts on-demand.

***REMOVED******REMOVED******REMOVED*** Starting Local Dev Environment

```bash
***REMOVED*** 1. Start the bastion (auto-detects and whitelists your IP)
./bin/bastion start

***REMOVED*** 2. Wait ~60 seconds for instance to boot, then check status
./bin/bastion status

***REMOVED*** 3. Create SSH tunnel to RDS (keeps running in foreground)
./bin/bastion ssh

***REMOVED*** 4. In another terminal, get the DB password
aws secretsmanager get-secret-value --secret-id workermill/dev/database-url --query 'SecretString' --output text

***REMOVED*** 5. Run the API locally with tunnel
cd api
DATABASE_URL=postgresql://workermill:<password>@localhost:5432/workermill npm run dev
```

***REMOVED******REMOVED******REMOVED*** Bastion Commands

| Command | Description |
|---------|-------------|
| `./bin/bastion start` | Start bastion, whitelist your IP |
| `./bin/bastion stop` | Stop bastion (saves cost) |
| `./bin/bastion status` | Show status, public IP, SSH command |
| `./bin/bastion ssh` | Connect with port forwarding (5432→RDS) |
| `./bin/bastion whitelist` | Update security group with current IP |

***REMOVED******REMOVED******REMOVED*** Direct Database Access

Once SSH tunnel is running (`./bin/bastion ssh`):

```bash
***REMOVED*** Connect via psql
psql -h localhost -p 5432 -U workermill -d workermill

***REMOVED*** Or from the bastion itself (has psql installed)
***REMOVED*** In the SSH session, use the pre-configured alias:
psql-workermill
```

***REMOVED******REMOVED******REMOVED*** SSH Key Location

The bastion SSH key is at `~/.ssh/workermill-bastion` (ED25519, no passphrase).

---

***REMOVED******REMOVED*** Local WorkerMill Mode

Run WorkerMill entirely locally with workers as Claude Code processes (instead of ECS containers). Uses Claude Max subscription OAuth token for authentication.

***REMOVED******REMOVED******REMOVED*** Prerequisites

- Docker (for PostgreSQL)
- Node.js >= 20
- Claude CLI: `npm install -g @anthropic-ai/claude-code`
- Claude Max subscription

***REMOVED******REMOVED******REMOVED*** Setup

```bash
***REMOVED*** 1. Authenticate with Claude (stores token in ~/.claude/.credentials.json)
claude auth login

***REMOVED*** 2. Create .env.local (token is auto-synced from credentials.json)
cat >> .env.local << EOF
DATABASE_URL=postgresql://workermill:localdev@localhost:5433/workermill
EXECUTION_MODE=local
TARGET_REPO_PATH=../oncallshift-api
EOF

***REMOVED*** 3. Build the worker Docker image (first time only)
./bin/local-workermill build-worker

***REMOVED*** 4. Start local WorkerMill
./bin/local-workermill start
```

**OAuth Token Handling:** The OAuth token is automatically synced from `~/.claude/.credentials.json` at API startup. No need to manually copy tokens. If authentication expires, just run `claude auth login` again.

***REMOVED******REMOVED******REMOVED*** Local WorkerMill Commands

| Command | Description |
|---------|-------------|
| `./bin/local-workermill start` | Start PostgreSQL, API, and frontend |
| `./bin/local-workermill stop` | Stop all services |
| `./bin/local-workermill status` | Show status of all services |
| `./bin/local-workermill create-task "title"` | Create a test task |
| `./bin/local-workermill logs` | Tail logs from all services |
| `./bin/local-workermill sync-data` | Sync data from production (requires bastion) |
| `./bin/local-workermill build-worker` | Build the worker Docker image |

***REMOVED******REMOVED******REMOVED*** Start Options

| Option | Default | Description |
|--------|---------|-------------|
| `--workers N` | 4 | Max concurrent workers |
| `--experts N` | 4 | Max parallel experts per task |
| `--skip-db` | false | Don't start PostgreSQL (use existing) |
| `--skip-fe` | false | Don't start frontend |
| `--no-critic` | false | Disable critic agent review |
| `--no-tech-lead` | false | Disable tech lead review |

***REMOVED******REMOVED******REMOVED*** Local vs Production

| Aspect | Production | Local |
|--------|------------|-------|
| Database | RDS PostgreSQL | Docker PostgreSQL |
| Workers | ECS Fargate containers | Docker container (`workermill-worker:local`) |
| Authentication | `ANTHROPIC_API_KEY` | OAuth via `~/.claude/.credentials.json` |
| Worker isolation | Container per task | Worktree per task |
| Cost | Pay-per-token | Claude Max subscription |
| Log streaming | SSE via API | SSE via API (same) |

***REMOVED******REMOVED******REMOVED*** Local Development Filesystem (CRITICAL — READ THIS)

**Always clone and run WorkerMill from the WSL2 native filesystem (`~/github/workermill`), NOT from `/mnt/c/`.**

The Windows mount (`/mnt/c/`) breaks Linux filesystem watchers (inotify), which means Vite HMR and `tsx watch` cannot detect file changes. Running from the WSL2 native filesystem fixes this — **hot module reload works automatically** with no restart needed.

```bash
***REMOVED*** Correct: WSL2 native filesystem (HMR works)
cd ~/github/workermill
./bin/local-workermill start --skip-db

***REMOVED*** Wrong: Windows mount (HMR broken, requires manual restart)
cd /mnt/c/Users/jarod/github/workermill
```

**After cloning, make scripts executable:** `chmod +x bin/local-workermill bin/bastion`

**Use VS Code Remote - WSL:** Open folders with `code .` from the WSL terminal, or `Ctrl+Shift+P` → "WSL: Open Folder in WSL" in VS Code.

***REMOVED******REMOVED******REMOVED*** Restarting API Without Killing Workers

If you need to restart the API (e.g., after changing env vars or config that `tsx watch` doesn't pick up), **do NOT use `./bin/local-workermill stop`** — it kills the database and any running worker containers.

```bash
***REMOVED*** Kill only API and frontend processes
lsof -ti :3001 2>/dev/null | xargs -r kill -9
lsof -ti :5173 -ti :5174 2>/dev/null | xargs -r kill -9

***REMOVED*** Restart with existing database
./bin/local-workermill start --skip-db
```

**Rules:**
- NEVER change ports (5173 for frontend, 3001 for API)
- NEVER restart the API while a worker container is running a task (it will lose its connection and die)
- After restart, verify frontend is on port 5173: `cat .local-workermill/frontend.log`

***REMOVED******REMOVED******REMOVED*** Remote Agent Mode

Run workers locally while using the **cloud** WorkerMill dashboard (workermill.com). A lightweight agent process polls the cloud API for tasks, runs planning via Claude CLI, and spawns Docker worker containers that report logs/status directly to the cloud.

```bash
***REMOVED*** 1. Install the agent CLI globally
npm install -g @workermill/agent

***REMOVED*** 2. Run interactive setup (configures API key, SCM tokens, etc.)
workermill-agent setup

***REMOVED*** 3. Start the remote agent
workermill-agent start
```

| Aspect | Local Mode | Remote Agent Mode |
|--------|------------|-------------------|
| Dashboard | localhost:5173 | workermill.com |
| Database | Local Docker PostgreSQL | Cloud RDS |
| API | Local (tsx watch) | Cloud ECS |
| Workers | Docker (local API) | Docker (cloud API) |
| Planning | Local Claude CLI | Local Claude CLI |
| Cost | Claude Max subscription | Claude Max subscription |

**Key difference:** `API_BASE_URL` in worker containers points to `https://workermill.com` instead of `localhost`, so all logs, coordination, and status updates go to the cloud dashboard.

***REMOVED******REMOVED******REMOVED*** Local Architecture

**What runs where in local mode:**

| Component | How It Runs | Auto-Reload? |
|-----------|-------------|--------------|
| PostgreSQL | Docker container | N/A |
| API | Direct process (`tsx watch`) | ✅ Yes |
| Frontend | Direct process (Vite) | ✅ Yes |
| Worker | Docker container | ❌ No — see "Rebuild Worker Image" in Critical Rules |

---

***REMOVED******REMOVED*** Project Overview

WorkerMill is mission control for autonomous AI coding agents - a real-time monitoring and orchestration system for AI workers that execute coding tasks ("htop for AI workers"). Deployed at https://workermill.com.

**Stack:**
- **Backend API**: Express + TypeScript + TypeORM + PostgreSQL (`api/`)
- **Frontend**: React 19 + Vite + TailwindCSS + Zustand (`frontend/`)
- **Infrastructure**: Terraform → AWS (ECS Fargate, RDS, S3, CloudFront) in us-east-1
- **Worker Containers**: Docker images with Claude Code for task execution (`worker/`)
- **Testing**: Vitest (API unit/integration), Playwright (E2E)

**Requirements:** Node.js >= 20.0.0

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

**oncallshift Repository Structure (Bitbucket):**

| Repo | Contents | URL |
|------|----------|-----|
| `oncallshift-api` | `backend/`, `infrastructure/`, `packages/`, `e2e/`, `docs/` | https://bitbucket.org/oncallshift/oncallshift-api |
| `oncallshift-web` | React frontend (src/, vite.config.ts, etc.) | https://bitbucket.org/oncallshift/oncallshift-web |
| `oncallshift-mobile` | React Native app (src/, app.json, etc.) | https://bitbucket.org/oncallshift/oncallshift-mobile |

Workers clone oncallshift repos, make changes, create PRs, and report status back. Cross-repo OCS tickets create separate PRs per repo.

***REMOVED******REMOVED******REMOVED*** Codebase Structure

Focus on these directories (production services):
- `api/` - Backend API deployed to ECS
- `frontend/` - React dashboard deployed to CloudFront
- `worker/` - Worker container images
- `packages/workermill-mcp/` - WorkerMill MCP server (published to npm)
- `packages/oncallshift-mcp/` - OncallShift MCP server (published to npm)

Ignore other `packages/*` directories - original modular architecture, not actively deployed.

User-facing documentation is at https://workermill.com/docs (overview, quick start, integrations, task lifecycle, personas, epics, analytics, MCP, advanced).

---

***REMOVED******REMOVED*** Deployment

**ALWAYS use `deploy.sh` for ALL deployments.** Never manually build/push Docker images. Commands are in the Quick Reference table above. Run `./deploy.sh --frontend` after UI changes.

***REMOVED******REMOVED******REMOVED*** Worker Image Registries

Only the worker image is published publicly (for remote agent machines to pull). API and frontend images are private.

| Registry | URL | Consumer | Deploy Flag |
|----------|-----|----------|-------------|
| **Private ECR** | `AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/workermill-dev/worker:latest` | Cloud ECS tasks | `--worker` |
| **Public ECR** | `public.ecr.aws/a7k5r0v0/workermill-worker:latest` | Remote agent CLI | `--ecr-public` |

- `--worker` alone pushes to private ECR and updates the ECS task definition
- `--ecr-public` pushes to ECR Public (`--dockerhub` still works as deprecated alias)
- **Always use `--worker --ecr-public` together** when worker changes affect both cloud and remote agent environments
- Remote agent pulls `public.ecr.aws/...` on container spawn; if cached, run `docker pull public.ecr.aws/a7k5r0v0/workermill-worker:latest` on the remote machine

***REMOVED******REMOVED******REMOVED*** Database Migrations

**Migrations run automatically on API startup.**

1. `cd api && npm run migrate:create AddMyNewColumn`
2. Edit the generated file in `api/src/db/migrations/`
3. **CRITICAL:** Register in `api/src/db/connection.ts` (import + add to `migrations` array)
4. Deploy: `./deploy.sh --api`

**Rules:**
- Always use `IF NOT EXISTS` / `IF EXISTS` for idempotency
- Deploy script validates all migrations are registered

***REMOVED******REMOVED******REMOVED*** Worker Execution Scripts

Worker scripts in `worker/execution/` (TypeScript) compile to `worker/execution-compiled/` (JavaScript).

```bash
cd worker/execution && npm run build   ***REMOVED*** Rebuild and commit compiled output
```

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

---

***REMOVED******REMOVED*** Jira Integration

***REMOVED******REMOVED******REMOVED*** Triggering AI Workers

Add the `workermill` label to a Jira or GitHub Issue to trigger an AI worker task. **Linear does NOT support label-change webhooks** — Linear's webhook API does not fire events when labels are added/removed from issues. Linear tasks are created through other mechanisms (e.g., status changes, manual API calls).

| Label | Purpose |
|-------|---------|
| `workermill` | **Required** - Triggers WorkerMill processing |
| `haiku` / `sonnet` / `opus` | Model override (default: org's `defaultWorkerModel`) |
| `deploy` | Auto-merge PR and deploy without human approval |
| `review` | Require manager review before merge |
| `sdk` | Standard SDK Mode (single-task, no story decomposition) |
| `critic` | Enable Planner-Critic validation |

***REMOVED******REMOVED******REMOVED*** Jira Projects

| Project | Key | Purpose | Target Repos |
|---------|-----|---------|--------------|
| oncallshift | OCS | Primary project for AI worker tasks | `oncallshift-api`, `oncallshift-web`, `oncallshift-mobile` (Bitbucket) |
| WorkerMill | WM | Internal platform tracking | `workermill` (GitHub) |

***REMOVED******REMOVED******REMOVED*** Worker Deployment Workflow

**Standard flow (no `deploy` label):**
1. Worker creates PR with code changes
2. Worker outputs `::result::review_requested`
3. Human reviews and approves PR
4. Webhook triggers WorkerMill
5. Worker re-runs to merge PR and deploy

**Auto-deploy flow (with `deploy` label):**
1. Worker creates PR → immediately merges → deploys
2. Worker outputs `::result::deployed`

***REMOVED******REMOVED******REMOVED*** Webhooks

| Platform | Endpoint |
|----------|----------|
| Jira | `https://workermill.com/api/webhooks/jira` |
| Linear | `https://workermill.com/api/webhooks/linear` |
| GitHub Issues | `https://workermill.com/api/webhooks/github-issues` |
| GitHub PR | `https://workermill.com/api/webhooks/github` |
| GitLab MR | `https://workermill.com/api/webhooks/gitlab` |
| BitBucket PR | `https://workermill.com/api/webhooks/bitbucket` |

---

***REMOVED******REMOVED*** Architecture

***REMOVED******REMOVED******REMOVED*** Key Models (`api/src/models/`)

| Model | Purpose |
|-------|---------|
| `WorkerTask` | Task state, cost tracking, git info |
| `WorkerTaskLog` | Terminal log storage for SSE streaming |
| `Organization` | Multi-tenant org support (settings, API keys, billing) |
| `User` | User accounts linked to Cognito |
| `AuditLog` | Security and compliance audit trail |
| `WorkerFileLock` | Multi-worker file locking |
| `WorkerCheckIn` | Worker heartbeat and health tracking |
| `CoordinationFeedItem` | Expert collaboration messages |

***REMOVED******REMOVED******REMOVED*** Key API Routes (`api/src/routes/`)

| Route | Purpose |
|-------|---------|
| `webhooks.ts` | Jira, GitHub, GitLab, BitBucket, Linear receivers |
| `control-center.ts` | Task management and log streaming SSE |
| `tasks.ts` | Worker log ingestion |
| `orchestrator.ts` | Poll loop, system control (start/stop/status) |
| `settings.ts` | Organization settings CRUD |
| `billing.ts` | Stripe billing integration |
| `coordination.ts` | Multi-worker file locking |

***REMOVED******REMOVED******REMOVED*** Task Flow

```
Jira webhook → API receives task → Queue → Claim task → Spawn ECS container → Monitor → Parse output markers (::result::, ::pr_url::) → Update status
```

***REMOVED******REMOVED******REMOVED*** Worker System

Directives in `worker/directives/` define role-specific behavior:
- `backend_developer/`, `frontend_developer/`, `devops_engineer/`
- `security_engineer/`, `qa_engineer/`, `tech_writer/`, `project_manager/`

See `worker/AGENTS.md` for comprehensive worker instructions.

> **IMPORTANT:** `worker/AGENTS.md` contains instructions for AI workers that execute tasks on **target repositories** (e.g., oncallshift). These workers run inside ECS containers and use execution scripts in `/app/execution-compiled/`. This is **NOT** relevant when Claude Code is working on the WorkerMill codebase itself - those instructions are for the spawned worker containers, not for development work on this repository.

***REMOVED******REMOVED******REMOVED*** Unified AIClient Interface

The `worker/ai-clients/` module provides a unified interface for AI execution across different SDKs:

```
AIClient Interface
       │
       ├── AnthropicAgentClient (Claude CLI - used by Epic Mode)
       │   └── Spawns claude process, streams JSON output
       │
       └── AISdkClient (Vercel AI SDK - OpenAI, Google, Ollama)
           └── Uses generateText/streamText with provider routing
```

| File | Purpose |
|------|---------|
| `worker/ai-clients/types.ts` | `AIClient` interface, `AIClientOptions`, `AIClientResult` |
| `worker/ai-clients/anthropic-agent.ts` | Claude CLI wrapper |
| `worker/ai-clients/ai-sdk-client.ts` | Vercel AI SDK wrapper |
| `worker/ai-clients/index.ts` | `createAIClient()` factory function |

***REMOVED******REMOVED******REMOVED*** Frontend Architecture

| Concept | Implementation |
|---------|----------------|
| State management | Zustand stores in `frontend/src/stores/` |
| API calls | Axios with base URL from env, auth interceptors |
| Routing | React Router v7 in `frontend/src/App.tsx` |
| Styling | TailwindCSS with custom config |
| Forms | React Hook Form + Zod validation |
| Auth | Cognito-backed, token stored in localStorage |

**SSE Log Streaming:**
- API: `GET /api/control-center/tasks/:taskId/stream` returns SSE events
- Frontend: `EventSource` in task detail page subscribes to log stream
- Logs polled from PostgreSQL every 500ms and pushed via SSE

***REMOVED******REMOVED******REMOVED*** Multi-Provider AI Support

| Provider | Models | Status |
|----------|--------|--------|
| `anthropic` (default) | claude-haiku-4-5, claude-sonnet-4, claude-opus-4 | Production |
| `openai` | gpt-4o, gpt-5.1-codex, o1, o1-mini | Production |
| `google` | gemini-2.0-flash, gemini-3-pro-preview | Production |
| `ollama` | qwen2.5-coder:32b, deepseek-r1:70b, etc. | Production |

***REMOVED******REMOVED******REMOVED*** Multi-SCM Provider Support

| Provider | Status | Auth Method | Default Repo Field |
|----------|--------|-------------|-------------------|
| `github` (default) | Production | Bearer token | `defaultGithubRepo` |
| `gitlab` | Production | PRIVATE-TOKEN | `defaultGitlabRepo` |
| `bitbucket` | Production | Repository Access Token | `defaultBitbucketRepo` |

**oncallshift uses Bitbucket:** Repositories at `bitbucket.org/oncallshift/`. Workers targeting OCS tickets use Bitbucket provider.

**No cross-provider fallback:** Each SCM provider requires its own credentials. Workers will fail if the configured `scmProvider` doesn't have credentials set up in Settings > Integrations.

Bitbucket auth details are in the Critical Rules section above ("DO NOT Use Outdated Bitbucket Auth").

---

***REMOVED******REMOVED*** Execution Modes

WorkerMill automatically selects execution mode based on org provider settings.

| Condition | Mode |
|-----------|------|
| `primaryProvider` = "anthropic" AND no `providerRouting` | **Epic Mode** (parallel, Agent SDK) |
| Other `primaryProvider` OR `providerRouting` configured | **Multi-Provider Mode** (sequential, AI SDK) |

***REMOVED******REMOVED******REMOVED*** Epic Mode (Anthropic-only, Parallel)

Planning Agent decomposes task → Spawns Epic Coordinator → Expert subagents work in parallel → Coordination feed for collaboration → Consolidated PR.

**Components:** `worker/epic/coordinator.ts`, `executor.ts`, `experts.ts`, `coordination-client.ts` (compiled by `tsc` during Docker build)

***REMOVED******REMOVED******REMOVED*** Multi-Provider Mode (Sequential)

Planning Agent decomposes task → Stories execute sequentially → Each persona routes to configured provider → Coordination feed → Consolidated PR.

**Components:** `worker/multi-expert/index.ts`, `coordination-client.ts`, `worker/agents/ai-sdk-executor.js`

***REMOVED******REMOVED******REMOVED*** Standard SDK Mode (add `sdk` label)

Single-task execution via Claude Agent SDK (no story decomposition).

***REMOVED******REMOVED******REMOVED*** Blocker Handling & Task Communication

When a worker encounters an error it cannot auto-fix, it escalates a **blocker** to the coordination feed:

**Blocker Flow:**
1. Story execution fails → Error classified (typescript, lint, test, build, auth, network, resource)
2. Auto-retry attempted for fixable errors (up to `blockerMaxAutoRetries`)
3. If retries exhausted or error not fixable → Blocker escalated with human-readable summary
4. Task status changes to `escalated` → Dashboard shows `BlockerAlert` component
5. User clicks Retry/Skip/Abort → Resolution posted to coordination feed
6. Worker receives resolution and continues accordingly

**Task-Scoped Communication:** Talk button on running task cards sends messages via `POST /api/coordination/commands`. Worker polls `/api/coordination/commands/:taskId/pending` for user messages.

**Key Components:**
- `worker/epic/blocker-manager.ts` - Blocker detection, escalation, resolution
- `worker/epic/error-classifier.ts` - Error categorization and summary generation
- `frontend/src/components/BlockerAlert.tsx` - Blocker UI with retry/skip/abort
- `api/src/routes/coordination.ts` - `/blocker-response` and `/commands` endpoints

---

***REMOVED******REMOVED*** RAG / Codebase Indexing

Vector-based code search using Ollama embeddings (`nomic-embed-text`, 768 dims) + pgvector. Must be enabled per org (`codebase_indexing_enabled`).

```
Repository → CodeChunker → CodebaseIndexer → Ollama → pgvector
Worker Task ← SkillInjector ← CodebaseRetriever ← cosine similarity search
```

**Key files:** `api/src/services/embedding.ts`, `code-chunker.ts`, `codebase-indexer.ts`, `codebase-retriever.ts`, `skill-injector.ts`. Routes: `api/src/routes/codebase.ts`.

**Ollama URL resolution:** Org setting `ollamaBaseUrl` → env `OLLAMA_HOST` → `http://localhost:11434`

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

***REMOVED******REMOVED******REMOVED*** Agent Package is Published to npm

`@workermill/agent` is published to **npmjs.com** under the `workermill` org. Editing `agent/src/` locally does NOTHING to running agents. To release changes:
1. `cd agent && npm run build && npm publish --access public` (requires npm login + OTP via email)
2. On the remote machine: `npm install -g @workermill/agent` (or `@workermill/agent@latest` to force update)

Three separate spawners exist: (1) `agent/src/spawner.ts` = remote agent CLI, (2) `api/src/services/local-epic-spawner.ts` = local dev, (3) ECS = cloud. **Always ask which environment before making spawner changes.**

***REMOVED******REMOVED******REMOVED*** Agent `dotenv/config` Type Error is Intentional

`agent/src/index.ts` imports `dotenv/config` which produces a TypeScript error (module not in dependencies). This is intentional — dotenv is an optional dependency that may be present on the remote machine. **Do not "fix" this by removing the import or adding dotenv to dependencies.**

***REMOVED******REMOVED******REMOVED*** Orchestrator Module Architecture

The orchestrator was decomposed from a monolith into focused modules:

| Module | Purpose |
|--------|---------|
| `orchestrator.ts` | Poll loop + lifecycle (start/stop/status) — **entry point** |
| `orchestrator-utils.ts` | Shared state, constants, AWS clients, `logTaskEvent()` |
| `task-claimer.ts` | Find queued tasks, atomic claim (concurrency, cooldown, quota) |
| `worker-spawner.ts` | Spawn ECS/local/support workers for claimed tasks |
| `task-dispatch.ts` | Multi-story PRD plan dispatch, PR merging |
| `task-monitor.ts` | ECS completion detection, dependency unblocking, cascading cancellation |
| `task-cleanup.ts` | Hung/orphaned/stale task cleanup loops |
| `planning-workflow.ts` | PRD planning analysis (V2 pipeline planning) |
| `manager-workflow.ts` | Manager review & log analysis spawning |

When making changes, edit the relevant module — `orchestrator.ts` is just the coordination hub that imports and calls them.

***REMOVED******REMOVED******REMOVED*** Team Planning (Multi-Perspective Analysis)

The remote agent (`agent/src/planner.ts`) supports **team planning** — 3 parallel analyst agents analyze the target repo before the planner runs:

| Analyst | Purpose | Needs Tools? |
|---------|---------|-------------|
| **Codebase** | Explores repo structure, frameworks, patterns | Yes (Glob, Read) |
| **Requirements** | Analyzes task description for acceptance criteria, ambiguities | No |
| **Risk** | Searches for affected files, dependencies, test coverage | Yes (Grep, Read) |

**How it works:**
1. Shallow-clones the target repo to `/tmp/workermill-planning-{taskId}/`
2. Spawns 3 Claude CLI processes in parallel (`--print --verbose --output-format stream-json`)
3. Collects reports, retries failed analysts up to 3 times (keeps successful ones)
4. Appends reports to the base planning prompt for the final synthesizer planner
5. Falls back to single-agent planning if all 3 analysts fail after 3 retries
6. Cleans up temp clone after planning completes

**Config:** `teamPlanningEnabled` in `~/.workermill/config.json` (default: `true`). Disable with `teamPlanningEnabled: false` or env `TEAM_PLANNING_ENABLED=false`.

**Key constraints — do NOT change without asking:**
- Analysts use the **same model** as the planner (no downgrading)
- Analyst timeout: **15 minutes** (they use tools to read files, 2 min is NOT enough)
- Analysts pipe prompts via **stdin** (same as `runClaudeCli`), NOT via `-p` CLI arg
- Analyst spawn must include `--verbose` flag (required by Claude CLI for stream-json)
- Critic approval threshold: **80**/100 (applies to both team and single-agent)

**Only implemented for the remote agent.** Local WorkerMill and cloud ECS use different planning paths that do not have team planning yet.

***REMOVED******REMOVED******REMOVED*** Heartbeat Must Always Update

The agent heartbeat endpoint must ALWAYS update `remote_agents.last_heartbeat_at` even when there are 0 active tasks. Otherwise the orchestrator thinks the agent is offline and starts claiming tasks itself.

---

***REMOVED******REMOVED*** Infrastructure

***REMOVED******REMOVED******REMOVED*** Environment Configuration

**Production** (`environments/prod/`) - workermill.com — AWS account AWS_ACCOUNT_ID, us-east-1. ECS cluster is `workermill-dev` (historical naming).

***REMOVED******REMOVED******REMOVED*** Terraform Commands

```bash
***REMOVED*** Production
cd infrastructure/terraform/environments/prod
terraform init -backend-config="bucket=workermill-terraform-state-AWS_ACCOUNT_ID"
terraform plan
terraform apply

***REMOVED*** Development
cd infrastructure/terraform/environments/dev
terraform init -backend-config="bucket=workermill-terraform-state-AWS_ACCOUNT_ID"
terraform plan && terraform apply
```

**Note:** No `-var` flags needed - all variables have defaults in `variables.tf`.

***REMOVED******REMOVED******REMOVED*** SES Email Configuration

**Cross-region:** Outbound email uses **us-east-2** SES (has production sending access). Inbound uses us-east-1. Do not change this. All email templates in `api/src/services/email.ts`.

***REMOVED******REMOVED******REMOVED*** Bastion Host

SSH bastion for local development database access. Runs as a t4g.nano Spot instance on-demand (~$0.001/hr). Lambda (`workermill-dev-bastion-control`) manages start/stop and auto-whitelists your IP. SSH key at `~/.ssh/workermill-bastion`. See Local Development section for commands.

---

***REMOVED******REMOVED*** Troubleshooting

```bash
***REMOVED*** View ECS service status
aws ecs describe-services --cluster workermill-dev --services workermill-dev-api --region us-east-1

***REMOVED*** Tail API logs (use MSYS_NO_PATHCONV=1 in Git Bash)
MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-dev/api" --follow --region us-east-1

***REMOVED*** Tail worker logs
MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-dev/worker" --follow --region us-east-1

***REMOVED*** Database access via bastion (preferred)
./bin/bastion start && sleep 60 && ./bin/bastion ssh
***REMOVED*** Then in SSH session: psql-workermill

***REMOVED*** Alternative: Database access via ECS exec
MSYS_NO_PATHCONV=1 aws ecs list-tasks --cluster workermill-dev --region us-east-1
***REMOVED*** Then: aws ecs execute-command --container api
```

***REMOVED******REMOVED******REMOVED*** Common Issues

| Problem | Check |
|---------|-------|
| Task stuck "running" | `aws ecs list-tasks`, CloudWatch for exit 137 (Spot) or exit 1 |
| Worker not posting logs | Verify org `apiKey` set, check worker logs for POST errors |
| Task not claimed | `GET /api/orchestrator/status`, verify task status is `queued` |
| PR not created | Branch conflicts, token permissions, rate limits |
| Epic not progressing | `GET /api/coordination/feed/:taskId`, verify planning agent completed |
| Bastion SSH timeout | Run `./bin/bastion whitelist` to update SG with current IP |
| Bastion can't reach RDS | Check RDS SG includes bastion SG: `aws ec2 describe-security-groups --group-ids sg-0c7c9a0e3e60d8cab` |
| psql not found on bastion | User data may have failed; run `sudo dnf install -y postgresql16` |

***REMOVED******REMOVED******REMOVED*** Windows/Git Bash

| Issue | Solution |
|-------|----------|
| AWS CLI path conversion | Prefix with `MSYS_NO_PATHCONV=1` |
| AWS CLI Unicode errors | Set `PYTHONIOENCODING=utf-8` |
| Shell parsing errors with `$(...)` | Spawn a Task agent instead of debugging |
| Docker layer caching | deploy.sh uses `--no-cache` - NEVER build with cache |

---

***REMOVED******REMOVED*** Testing

***REMOVED******REMOVED******REMOVED*** E2E Tests (Playwright)

E2E tests run on ephemeral ECS Fargate Spot runners. Location: `frontend/e2e/`. Triggered via GitHub Actions → CI/CD Pipeline → Run workflow (manual checkbox).

***REMOVED******REMOVED******REMOVED*** Integration Tests (Vitest)

Location: `api/src/__tests__/integration/`. Each test runs in a transaction that rolls back after completion. Triggered via GitHub Actions (manual checkbox).

***REMOVED******REMOVED******REMOVED*** CI/CD Workflow

The CI/CD pipeline is **manual-only** (workflow_dispatch). No automatic triggers on push/PR.

---

***REMOVED******REMOVED*** Hooks & Skills

**Auto-formatting:** Prettier runs automatically after Write/Edit to `.ts`/`.tsx`/`.js`/`.jsx` files.

***REMOVED******REMOVED******REMOVED*** /val-imp

Enforces strict plan adherence: extracts requirements, implements one at a time, spawns independent validator agent after each.

**Usage:** `/val-imp docs/my-feature-plan.md`

---

***REMOVED******REMOVED*** MCP Tools Available

Claude Code has access to MCP servers for external integrations. Use `ToolSearch` to load these before calling.

| Server | Tools | Purpose |
|--------|-------|---------|
| `workermill` | Task management, orchestrator control | Manage WorkerMill tasks directly |
| `github` | `create_issue`, `create_pull_request`, `search_code`, etc. | GitHub operations |
| `jira` | `jira_get`, `jira_post`, `jira_put` | Jira API operations |
| `ollama` | `ollama_chat`, `ollama_generate`, `ollama_list` | Local LLM inference |
| `oncallshift` | Incident management, schedules, escalation policies | OncallShift platform operations |

**Usage pattern:**
```
1. ToolSearch query: "github create issue"
2. Call the returned tool (e.g., mcp__github__create_issue)
```

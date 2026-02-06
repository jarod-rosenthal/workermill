# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⛔ Critical Rules - READ FIRST

### DO NOT CHANGE Working Patterns

**These working solutions must NOT be changed without explicit user request:**

| Pattern | Implementation | Why It's Sacred |
|---------|----------------|-----------------|
| **Log streaming** | PostgreSQL + SSE, NOT CloudWatch | Took a week to get working. Worker posts to `/api/tasks/:taskId/logs`, SSE streams from database every 500ms. |
| **Task orchestration** | Database polling with atomic claim | Polls for queued tasks, claims via UPDATE...WHERE, spawns ECS |
| **Worker entrypoint** | `post_log()` shell function | Posts terminal output to API in real-time |
| **LLM Models** | NEVER change without approval | No default model changes, no provider switches, no model name changes in code/env/config |

**If you think something could be "better" (CloudWatch, WebSockets, etc.), ASK FIRST.**

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

### DO NOT Modify Infrastructure Outside Terraform

**Terraform is the ONLY source of truth. NEVER:**
- Create AWS resources via console
- Manually modify ECS task definitions
- Push Docker images without using `deploy.sh`
- Change security groups, IAM roles, or networking outside Terraform

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

See "Bitbucket Authentication" section below for full details.

### DO NOT Make Changes Without Communicating

- **Before any code change**: Explain what you're about to modify
- **When instructions are unclear**: Ask, don't assume
- **Before deploying**: Wait for explicit approval ("go", "yes", "deploy")
- **Keep changes minimal**: Only do what was asked, nothing extra
- **No silent deployments**: Always state what's being deployed

### DO NOT Deploy to Dev Environment

**The dev environment (dev.workermill.com) is NOT RUNNING.** Always deploy to prod:
- Use `./deploy.sh --api` (NOT `--env dev`)
- Use `./deploy.sh --frontend` (NOT `--env dev`)
- Use `./deploy.sh --worker` (NOT `--env dev`)

---

## Quick Reference

| Task | Command |
|------|---------|
| Type check API | `cd api && npm run typecheck` |
| Type check frontend | `cd frontend && npx tsc -b` |
| Deploy API (prod) | `./deploy.sh --api` |
| Deploy frontend | `./deploy.sh --frontend` |
| Deploy worker | `./deploy.sh --worker` |
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
| **Validated implementation** | `/val-imp [plan-file]` |
| **Start bastion** | `./bin/bastion start` |
| **Stop bastion** | `./bin/bastion stop` |
| **Bastion status** | `./bin/bastion status` |
| **SSH to bastion** | `./bin/bastion ssh` |
| **Start remote agent** | `./bin/remote-agent` |

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

## Local Development

Local development uses an SSH bastion to tunnel to the production RDS database. The bastion is a t4g.nano Spot instance (~$0.001/hr) that starts on-demand.

### Starting Local Dev Environment

```bash
# 1. Start the bastion (auto-detects and whitelists your IP)
./bin/bastion start

# 2. Wait ~60 seconds for instance to boot, then check status
./bin/bastion status

# 3. Create SSH tunnel to RDS (keeps running in foreground)
./bin/bastion ssh

# 4. In another terminal, get the DB password
aws secretsmanager get-secret-value --secret-id workermill/dev/database-url --query 'SecretString' --output text

# 5. Run the API locally with tunnel
cd api
DATABASE_URL=postgresql://workermill:<password>@localhost:5432/workermill npm run dev
```

### Bastion Commands

| Command | Description |
|---------|-------------|
| `./bin/bastion start` | Start bastion, whitelist your IP |
| `./bin/bastion stop` | Stop bastion (saves cost) |
| `./bin/bastion status` | Show status, public IP, SSH command |
| `./bin/bastion ssh` | Connect with port forwarding (5432→RDS) |
| `./bin/bastion whitelist` | Update security group with current IP |

### Direct Database Access

Once SSH tunnel is running (`./bin/bastion ssh`):

```bash
# Connect via psql
psql -h localhost -p 5432 -U workermill -d workermill

# Or from the bastion itself (has psql installed)
# In the SSH session, use the pre-configured alias:
psql-workermill
```

### SSH Key Location

The bastion SSH key is at `~/.ssh/workermill-bastion` (ED25519, no passphrase).

---

## Local WorkerMill Mode

Run WorkerMill entirely locally with workers as Claude Code processes (instead of ECS containers). Uses Claude Max subscription OAuth token for authentication.

### Prerequisites

- Docker (for PostgreSQL)
- Node.js >= 20
- Claude CLI: `npm install -g @anthropic-ai/claude-code`
- Claude Max subscription

### Setup

```bash
# 1. Authenticate with Claude (stores token in ~/.claude/.credentials.json)
claude auth login

# 2. Create .env.local (token is auto-synced from credentials.json)
cat >> .env.local << EOF
DATABASE_URL=postgresql://workermill:localdev@localhost:5433/workermill
EXECUTION_MODE=local
TARGET_REPO_PATH=../oncallshift-api
EOF

# 3. Build the worker Docker image (first time only)
./bin/local-workermill build-worker

# 4. Start local WorkerMill
./bin/local-workermill start
```

**OAuth Token Handling:** The OAuth token is automatically synced from `~/.claude/.credentials.json` at API startup. No need to manually copy tokens. If authentication expires, just run `claude auth login` again.

### Local WorkerMill Commands

| Command | Description |
|---------|-------------|
| `./bin/local-workermill start` | Start PostgreSQL, API, and frontend |
| `./bin/local-workermill stop` | Stop all services |
| `./bin/local-workermill status` | Show status of all services |
| `./bin/local-workermill create-task "title"` | Create a test task |
| `./bin/local-workermill logs` | Tail logs from all services |
| `./bin/local-workermill sync-data` | Sync data from production (requires bastion) |
| `./bin/local-workermill build-worker` | Build the worker Docker image |

### Start Options

| Option | Default | Description |
|--------|---------|-------------|
| `--workers N` | 4 | Max concurrent workers |
| `--experts N` | 4 | Max parallel experts per task |
| `--skip-db` | false | Don't start PostgreSQL (use existing) |
| `--skip-fe` | false | Don't start frontend |
| `--no-critic` | false | Disable critic agent review |
| `--no-tech-lead` | false | Disable tech lead review |

### Local vs Production

| Aspect | Production | Local |
|--------|------------|-------|
| Database | RDS PostgreSQL | Docker PostgreSQL |
| Workers | ECS Fargate containers | Docker container (`workermill-worker:local`) |
| Authentication | `ANTHROPIC_API_KEY` | OAuth via `~/.claude/.credentials.json` |
| Worker isolation | Container per task | Worktree per task |
| Cost | Pay-per-token | Claude Max subscription |
| Log streaming | SSE via API | SSE via API (same) |

### Remote Agent Mode

Run workers locally while using the **cloud** WorkerMill dashboard (workermill.com). A lightweight agent process polls the cloud API for tasks, runs planning via Claude CLI, and spawns Docker worker containers that report logs/status directly to the cloud.

```bash
# 1. Copy and configure .env.remote
cp .env.remote.example .env.remote
# Set WORKERMILL_API_URL, WORKERMILL_API_KEY, SCM tokens

# 2. Build worker image (if not already built)
./bin/local-workermill build-worker

# 3. Start the remote agent
./bin/remote-agent
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

### Local Architecture & Rebuilding

**What runs where in local mode:**

| Component | How It Runs | Auto-Reload? | Rebuild Command |
|-----------|-------------|--------------|-----------------|
| PostgreSQL | Docker container | N/A | N/A |
| API | Direct process (`tsx watch`) | ✅ Yes | No rebuild needed |
| Frontend | Direct process (Vite) | ✅ Yes | No rebuild needed |
| Worker | Docker container | ❌ No | `./bin/local-workermill build-worker` |

**When to rebuild the worker image:**

Any changes to files in `worker/` directory require rebuilding:
- `worker/epic/*.ts` (coordinator, executor, types, etc.)
- `worker/ai-clients/*.ts`
- `worker/directives/`
- `worker/Dockerfile`

```bash
# Rebuild worker image after changes
./bin/local-workermill build-worker

# Then restart to use new image
./bin/local-workermill stop
./bin/local-workermill start
```

**API and Frontend changes take effect immediately** due to `tsx watch` and Vite hot reload.

---

## Project Overview

WorkerMill is mission control for autonomous AI coding agents - a real-time monitoring and orchestration system for AI workers that execute coding tasks ("htop for AI workers"). Deployed at https://workermill.com.

**Stack:**
- **Backend API**: Express + TypeScript + TypeORM + PostgreSQL (`api/`)
- **Frontend**: React 19 + Vite + TailwindCSS + Zustand (`frontend/`)
- **Infrastructure**: Terraform → AWS (ECS Fargate, RDS, S3, CloudFront) in us-east-1
- **Worker Containers**: Docker images with Claude Code for task execution (`worker/`)
- **Testing**: Vitest (API unit/integration), Playwright (E2E)

**Requirements:** Node.js >= 20.0.0

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

**oncallshift Repository Structure (Bitbucket):**

| Repo | Contents | URL |
|------|----------|-----|
| `oncallshift-api` | `backend/`, `infrastructure/`, `packages/`, `e2e/`, `docs/` | https://bitbucket.org/oncallshift/oncallshift-api |
| `oncallshift-web` | React frontend (src/, vite.config.ts, etc.) | https://bitbucket.org/oncallshift/oncallshift-web |
| `oncallshift-mobile` | React Native app (src/, app.json, etc.) | https://bitbucket.org/oncallshift/oncallshift-mobile |

When a worker runs on an OCS ticket, it:
1. Determines which repo(s) to modify based on the ticket scope
2. Clones the relevant oncallshift repo(s) from Bitbucket
3. Makes code changes based on the Jira ticket
4. Creates PRs against the appropriate repo
5. Reports status back to WorkerMill

**Cross-repo tickets:** Some OCS tickets may span multiple repos (e.g., API + frontend). Workers should create separate PRs for each repo and link them in the ticket comments.

### Codebase Structure

Focus on these directories (production services):
- `api/` - Backend API deployed to ECS
- `frontend/` - React dashboard deployed to CloudFront
- `worker/` - Worker container images
- `packages/workermill-mcp/` - WorkerMill MCP server (published to npm)
- `packages/oncallshift-mcp/` - OncallShift MCP server (published to npm)

Ignore other `packages/*` directories - original modular architecture, not actively deployed.

### Documentation Pages

Documentation is available at https://workermill.com/docs with these sections:

| Page | Path | Description |
|------|------|-------------|
| Overview | `/docs` | Getting started guide |
| Quick Start | `/docs/quick-start` | 5-minute setup walkthrough |
| Integrations | `/docs/integrations` | Jira, Linear, GitHub, GitLab, Bitbucket setup |
| Task Lifecycle | `/docs/task-lifecycle` | Task states and transitions |
| Personas | `/docs/personas` | Worker role configuration |
| Epics | `/docs/epics` | Epic/PRD workflow |
| Analytics | `/docs/analytics` | Metrics and dashboards |
| MCP | `/docs/mcp` | MCP server integration |
| Advanced | `/docs/advanced` | Power user features |

---

## Deployment

**ALWAYS use `deploy.sh` for ALL deployments.** Never manually build/push Docker images.

```bash
# Production (workermill.com)
./deploy.sh --api                    # Deploy API
./deploy.sh --worker                 # Deploy worker image
./deploy.sh --frontend               # Deploy frontend
./deploy.sh --all                    # Deploy everything

# Options
./deploy.sh --all --skip-build       # Skip rebuilding
./deploy.sh --help                   # Show all options
```

**IMPORTANT:** Run `./deploy.sh --frontend` after UI changes.

### Database Migrations

**Migrations run automatically on API startup.**

1. `cd api && npm run migrate:create AddMyNewColumn`
2. Edit the generated file in `api/src/db/migrations/`
3. **CRITICAL:** Register in `api/src/db/connection.ts` (import + add to `migrations` array)
4. Deploy: `./deploy.sh --api`

**Rules:**
- Always use `IF NOT EXISTS` / `IF EXISTS` for idempotency
- Deploy script validates all migrations are registered

### Worker Execution Scripts

Worker scripts in `worker/execution/` (TypeScript) compile to `worker/execution-compiled/` (JavaScript).

```bash
cd worker/execution && npm run build   # Rebuild and commit compiled output
```

---

## Git Workflow

**Always work directly on `main` branch.** Do NOT create feature branches.

**Why:** Multiple Claude Code terminals may work simultaneously. Working on `main` ensures all agents see changes immediately.

| Change Type | Visibility |
|-------------|------------|
| Uncommitted file edits | Instant (shared filesystem) |
| Committed changes | Requires `git pull` in other terminals |

**Before changes:** `git pull`
**After changes:** Commit and push promptly

---

## Jira Integration

### Triggering AI Workers

Add the `workermill` label to a Jira/Linear/GitHub Issue to trigger an AI worker task.

| Label | Purpose |
|-------|---------|
| `workermill` | **Required** - Triggers WorkerMill processing |
| `haiku` / `sonnet` / `opus` | Model override (default: org's `defaultWorkerModel`) |
| `deploy` | Auto-merge PR and deploy without human approval |
| `review` | Require manager review before merge |
| `sdk` | Standard SDK Mode (single-task, no story decomposition) |
| `phased` | Phased Execution (fresh context per phase) |
| `critic` | Enable Planner-Critic validation |

### Jira Projects

| Project | Key | Purpose | Target Repos |
|---------|-----|---------|--------------|
| oncallshift | OCS | Primary project for AI worker tasks | `oncallshift-api`, `oncallshift-web`, `oncallshift-mobile` (Bitbucket) |
| WorkerMill | WM | Internal platform tracking | `workermill` (GitHub) |

### Worker Deployment Workflow

**Standard flow (no `deploy` label):**
1. Worker creates PR with code changes
2. Worker outputs `::result::review_requested`
3. Human reviews and approves PR
4. Webhook triggers WorkerMill
5. Worker re-runs to merge PR and deploy

**Auto-deploy flow (with `deploy` label):**
1. Worker creates PR → immediately merges → deploys
2. Worker outputs `::result::deployed`

### Webhooks

| Platform | Endpoint |
|----------|----------|
| Jira | `https://workermill.com/api/webhooks/jira` |
| Linear | `https://workermill.com/api/webhooks/linear` |
| GitHub Issues | `https://workermill.com/api/webhooks/github-issues` |
| GitHub PR | `https://workermill.com/api/webhooks/github` |
| GitLab MR | `https://workermill.com/api/webhooks/gitlab` |
| BitBucket PR | `https://workermill.com/api/webhooks/bitbucket` |

---

## Architecture

### Key Models (`api/src/models/`)

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

### Key API Routes (`api/src/routes/`)

| Route | Purpose |
|-------|---------|
| `webhooks.ts` | Jira, GitHub, GitLab, BitBucket, Linear receivers |
| `control-center.ts` | Task management and log streaming SSE |
| `tasks.ts` | Worker log ingestion |
| `orchestrator.ts` | System control (start/stop/status) |
| `settings.ts` | Organization settings CRUD |
| `billing.ts` | Stripe billing integration |
| `coordination.ts` | Multi-worker file locking |

### Task Flow

```
Jira webhook → API receives task → Queue → Claim task → Spawn ECS container → Monitor → Parse output markers (::result::, ::pr_url::) → Update status
```

### Worker System

Directives in `worker/directives/` define role-specific behavior:
- `backend_developer/`, `frontend_developer/`, `devops_engineer/`
- `security_engineer/`, `qa_engineer/`, `tech_writer/`, `project_manager/`

See `worker/AGENTS.md` for comprehensive worker instructions.

> **IMPORTANT:** `worker/AGENTS.md` contains instructions for AI workers that execute tasks on **target repositories** (e.g., oncallshift). These workers run inside ECS containers and use execution scripts in `/app/execution-compiled/`. This is **NOT** relevant when Claude Code is working on the WorkerMill codebase itself - those instructions are for the spawned worker containers, not for development work on this repository.

### Unified AIClient Interface

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

**Usage:**
```typescript
import { createAIClient } from "./ai-clients/index.js";

const client = createAIClient({
  provider: "anthropic",
  apiKeys: { anthropic: process.env.ANTHROPIC_API_KEY },
  apiConfig: { baseUrl: "https://workermill.com/api", orgApiKey },
  useAgentSdk: true,  // Use Claude CLI
  oauthToken: process.env.CLAUDE_CODE_OAUTH_TOKEN,  // For local dev
});

const result = await client.execute({
  prompt: "Implement the feature",
  systemPrompt: "You are a backend developer...",
  persona: "backend_developer",
  model: "claude-sonnet-4-20250514",
  workingDir: "/path/to/repo",
  storyId: "story-123",
  parentTaskId: "task-456",
});
```

### Frontend Architecture

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

### Multi-Provider AI Support

| Provider | Models | Status |
|----------|--------|--------|
| `anthropic` (default) | claude-haiku-4-5, claude-sonnet-4, claude-opus-4 | Production |
| `openai` | gpt-4o, gpt-5.1-codex, o1, o1-mini | Production |
| `google` | gemini-2.0-flash, gemini-3-pro-preview | Production |
| `ollama` | qwen2.5-coder:32b, deepseek-r1:70b, etc. | Production |

### Multi-SCM Provider Support

| Provider | Status | Auth Method | Default Repo Field |
|----------|--------|-------------|-------------------|
| `github` (default) | Production | Bearer token | `defaultGithubRepo` |
| `gitlab` | Production | PRIVATE-TOKEN | `defaultGitlabRepo` |
| `bitbucket` | Production | Repository Access Token | `defaultBitbucketRepo` |

**oncallshift uses Bitbucket:** Repositories at `bitbucket.org/oncallshift/`. Workers targeting OCS tickets use Bitbucket provider.

**No cross-provider fallback:** Each SCM provider requires its own credentials. Workers will fail if the configured `scmProvider` doesn't have credentials set up in Settings > Integrations.

### ⚠️ Bitbucket Authentication (IMPORTANT - READ THIS)

**Bitbucket deprecated app passwords. Use Repository Access Tokens instead.**

| Use Case | Auth Method | Format |
|----------|-------------|--------|
| **REST API calls** | Bearer token | `Authorization: Bearer <token>` |
| **Git clone/push** | x-token-auth | `https://x-token-auth:<token>@bitbucket.org/workspace/repo.git` |

**DO NOT use Basic auth with username:password for Bitbucket API calls.** Repository Access Tokens require Bearer authentication.

**Creating a Repository Access Token:**
1. Go to Repository Settings → Access tokens
2. Create token with scopes: `repository:write`, `pullrequest:write`
3. Store token in WorkerMill Settings → Integrations → Bitbucket
4. The token IS the password; username should be `x-token-auth`

**References:**
- [Bitbucket Repository Access Tokens](https://support.atlassian.com/bitbucket-cloud/docs/repository-access-tokens/)
- [Using Access Tokens](https://support.atlassian.com/bitbucket-cloud/docs/using-access-tokens/)

---

## Execution Modes

WorkerMill automatically selects execution mode based on org provider settings.

| Condition | Mode |
|-----------|------|
| `primaryProvider` = "anthropic" AND no `providerRouting` | **Epic Mode** (parallel, Agent SDK) |
| Other `primaryProvider` OR `providerRouting` configured | **Multi-Provider Mode** (sequential, AI SDK) |

### Epic Mode (Anthropic-only, Parallel)

Planning Agent decomposes task → Spawns Epic Coordinator → Expert subagents work in parallel → Coordination feed for collaboration → Consolidated PR.

**Components:** `worker/epic/coordinator.ts`, `executor.ts`, `experts.ts`, `coordination-client.ts`

### Multi-Provider Mode (Sequential)

Planning Agent decomposes task → Stories execute sequentially → Each persona routes to configured provider → Coordination feed → Consolidated PR.

**Components:** `worker/multi-expert/index.ts`, `coordination-client.ts`, `worker/agents/ai-sdk-executor.js`

### Phased Execution Mode (add `phased` label)

Each story broken into discrete phases with fresh context:
```
ANALYZE → IMPLEMENT (per unit) → INTEGRATE → VERIFY ↔ FIX → COMMIT
```

**Components:** `worker/epic/phased-executor.ts`, `worker/epic/phases/*.ts`

### Standard SDK Mode (add `sdk` label)

Single-task execution via Claude Agent SDK (no story decomposition).

### Blocker Handling & Task Communication

When a worker encounters an error it cannot auto-fix, it escalates a **blocker** to the coordination feed:

**Blocker Flow:**
1. Story execution fails → Error classified (typescript, lint, test, build, auth, network, resource)
2. Auto-retry attempted for fixable errors (up to `blockerMaxAutoRetries`)
3. If retries exhausted or error not fixable → Blocker escalated with human-readable summary
4. Task status changes to `escalated` → Dashboard shows `BlockerAlert` component
5. User clicks Retry/Skip/Abort → Resolution posted to coordination feed
6. Worker receives resolution and continues accordingly

**Blocker Summary Fields:**
- `summary` - Human-readable explanation (what, why, suggested action)
- `errorMessage` - Full technical error output
- `errorCategory` - Classification (typescript, lint, test, etc.)
- `affectedFiles` - Files involved in the error
- `isFixable` - Whether auto-retry is possible

**Task-Scoped Communication:**
- Talk button appears on individual running task cards (not global)
- Messages sent via `POST /api/coordination/commands` with `type: "message"`
- Worker polls `/api/coordination/commands/:taskId/pending` for user messages
- Worker acknowledges messages with `worker_ack` in coordination feed
- User feedback applied to next story execution

**Key Components:**
- `worker/epic/blocker-manager.ts` - Blocker detection, escalation, resolution
- `worker/epic/error-classifier.ts` - Error categorization and summary generation
- `frontend/src/components/BlockerAlert.tsx` - Blocker UI with retry/skip/abort
- `api/src/routes/coordination.ts` - `/blocker-response` and `/commands` endpoints

---

## Infrastructure

### Environment Configuration

**Production** (`environments/prod/`) - workermill.com

| Resource | Value |
|----------|-------|
| AWS Account | 593971626975 |
| AWS Region | us-east-1 |
| ECS Cluster | workermill-dev (historical naming) |
| API Service | workermill-dev-api |
| CloudFront | E15CA3N5TI2ZR2 |
| Cognito User Pool | us-east-1_oHZOtoac8 |
| Cognito Client | 4bpjbr7gu9ne5rgo3v0rjic7hq |
| State Key | `workermill/prod/terraform.tfstate` |

**Development** (`environments/dev/`) - dev.workermill.com

⚠️ **DEV ENVIRONMENT IS NOT RUNNING.** Do not deploy to dev. Always deploy to prod.

### Terraform Commands

```bash
# Production
cd infrastructure/terraform/environments/prod
terraform init -backend-config="bucket=workermill-terraform-state-593971626975"
terraform plan
terraform apply

# Development
cd infrastructure/terraform/environments/dev
terraform init -backend-config="bucket=workermill-terraform-state-593971626975"
terraform plan && terraform apply
```

**Note:** No `-var` flags needed - all variables have defaults in `variables.tf`.

### SES Email Configuration

**Cross-region setup required:** WorkerMill runs in us-east-1, but SES was set up in us-east-2 for production sending access.

| Purpose | Region | Notes |
|---------|--------|-------|
| **Outbound emails** (invites, notifications) | us-east-2 | Has production access, can send to any email |
| **Inbound emails** (receiving) | us-east-1 | Lambda, S3 integration |

**Do not change this configuration.** All outbound email uses us-east-2 SES.

**Email Types:**
| Email | Trigger | Template Location |
|-------|---------|-------------------|
| Welcome email | User signup/invite accepted | `api/src/services/email.ts` |
| Org invite | Admin invites user | `api/src/services/email.ts` |
| Task notifications | Task status changes | `api/src/services/email.ts` |

**Test emails:** Settings page has "Send Test Email" buttons for each template.

### Bastion Host

SSH bastion for local development database access. Runs as a t4g.nano Spot instance on-demand.

| Resource | Value |
|----------|-------|
| Lambda | `workermill-dev-bastion-control` |
| ASG | `workermill-dev-bastion` |
| Security Group | `workermill-dev-bastion` (SSH port 22, dynamic IP whitelisting) |
| SSH Key | `~/.ssh/workermill-bastion` |
| Instance Types | t4g.nano, t4g.micro (ARM), t3a.nano, t3a.micro, t3.nano, t3.micro (x86 fallback) |
| Cost | ~$0.001/hr when running, $0 when stopped |

**Architecture:**
```
Your Machine ──SSH:22──▶ Bastion (public subnet) ──5432──▶ RDS (private subnet)
     │
     └── Lambda (start/stop/whitelist IP)
```

The bastion security group is dynamically updated by the Lambda to whitelist your IP on start.

**Security hardening applied:**
- Egress restricted to PostgreSQL (5432/VPC), HTTPS (443), DNS (53/VPC)
- IMDSv2 required (`http_tokens = required`)
- Lambda validates IP addresses before adding to security group
- CloudWatch Logs IAM scoped to specific log group

**Future improvements (not yet implemented):**
- SSH session logging for audit compliance
- AWS SSM Session Manager as SSH alternative (eliminates port 22 exposure)

---

## Troubleshooting

```bash
# View ECS service status
aws ecs describe-services --cluster workermill-dev --services workermill-dev-api --region us-east-1

# Tail API logs (use MSYS_NO_PATHCONV=1 in Git Bash)
MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-dev/api" --follow --region us-east-1

# Tail worker logs
MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-dev/worker" --follow --region us-east-1

# Database access via bastion (preferred)
./bin/bastion start && sleep 60 && ./bin/bastion ssh
# Then in SSH session: psql-workermill

# Alternative: Database access via ECS exec
MSYS_NO_PATHCONV=1 aws ecs list-tasks --cluster workermill-dev --region us-east-1
# Then: aws ecs execute-command --container api
```

### Common Issues

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

### Windows/Git Bash

| Issue | Solution |
|-------|----------|
| AWS CLI path conversion | Prefix with `MSYS_NO_PATHCONV=1` |
| AWS CLI Unicode errors | Set `PYTHONIOENCODING=utf-8` |
| Shell parsing errors with `$(...)` | Spawn a Task agent instead of debugging |
| Docker layer caching | deploy.sh uses `--no-cache` - NEVER build with cache |

---

## Testing

### E2E Tests (Playwright)

E2E tests run on ephemeral ECS Fargate Spot runners spawned on-demand.

**Location:** `frontend/e2e/`

**Test suites:**
- `auth.spec.ts` - Authentication flows
- `webhook-task.spec.ts` - Jira webhook → task creation
- `orchestration.spec.ts` - Task lifecycle states
- `log-streaming.spec.ts` - SSE log streaming

**Running E2E tests:**
1. Go to GitHub Actions → CI/CD Pipeline → Run workflow
2. Check "Run E2E tests on self-hosted runner"
3. Click "Run workflow"

**Cost:** ~$0.01-0.02 per test run (Fargate Spot)

**How it works:**
```
GitHub workflow_job webhook → API (/api/webhooks/github-runner) →
Get runner token from GitHub API → Start ECS Fargate task →
Runner registers, executes job, terminates
```

### Integration Tests (Vitest)

API integration tests with real database using transaction rollback for isolation.

**Location:** `api/src/__tests__/integration/`

**Test isolation:** Each test runs in a transaction that rolls back after completion. This ensures tests don't affect each other or leave state in the database.

**Running integration tests:**
1. Go to GitHub Actions → CI/CD Pipeline → Run workflow
2. Check "Run integration tests on self-hosted runner"
3. Click "Run workflow"

### CI/CD Workflow

The CI/CD pipeline is **manual-only** (workflow_dispatch). No automatic triggers on push/PR.

| Job | Runner | Trigger |
|-----|--------|---------|
| `api-ci` | ubuntu-latest | Manual |
| `frontend-ci` | ubuntu-latest | Manual |
| `e2e-tests` | self-hosted ECS | Manual (checkbox) |
| `integration-tests` | self-hosted ECS | Manual (checkbox) |
| `deploy-*` | ubuntu-latest | Manual (checkbox) |

---

## Hooks & Skills

**Auto-formatting:** Prettier runs automatically after Write/Edit to `.ts`/`.tsx`/`.js`/`.jsx` files.

### /val-imp

Enforces strict plan adherence: extracts requirements, implements one at a time, spawns independent validator agent after each.

**Usage:** `/val-imp docs/my-feature-plan.md`

---

## MCP Tools Available

Claude Code has access to MCP servers for external integrations. Use `ToolSearch` to load these before calling.

| Server | Tools | Purpose |
|--------|-------|---------|
| `workermill` | Task management, orchestrator control | Manage WorkerMill tasks directly |
| `github` | `create_issue`, `create_pull_request`, `search_code`, etc. | GitHub operations |
| `jira` | `jira_get`, `jira_post`, `jira_put` | Jira API operations |
| `ollama` | `ollama_chat`, `ollama_generate`, `ollama_list` | Local LLM inference |
| `oncallshift` | Incident management, schedules, escalation policies | OncallShift platform operations |
| `browsermcp` | `browser_navigate`, `browser_click`, `browser_screenshot` | Browser automation |

**Usage pattern:**
```
1. ToolSearch query: "github create issue"
2. Call the returned tool (e.g., mcp__github__create_issue)
```

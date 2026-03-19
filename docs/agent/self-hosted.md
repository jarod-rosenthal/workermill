# Self-Hosted Deployment Guide

## Overview

WorkerMill can be self-hosted on your own infrastructure. The self-hosted deployment runs the exact same codebase as the cloud version at workermill.com, with `EXECUTION_MODE=local` set to bypass Cognito authentication, Stripe billing, and Terms of Service enforcement. In this mode:

- **Authentication** is bypassed — a local admin user (`admin@localhost`) is automatically created and used for all requests. No Cognito or SSO setup required.
- **Billing** is bypassed — all operations are allowed without subscription checks.
- **Workers** run as Docker containers on your machine (via the `local-epic-spawner`) instead of AWS ECS Fargate.
- **AI execution** uses Claude CLI with OAuth token authentication (Claude Max/Team subscription) by default. API key-based providers (OpenAI, Google, Ollama) are also supported.

### Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │────▶│   API Server │────▶│  PostgreSQL   │
│  (port 5173) │     │  (port 3001) │     │  (port 5432)  │
└──────────────┘     └──────┬───────┘     └──────────────┘
                            │
                            ├────────────▶┌──────────────┐
                            │             │    Redis      │
                            │             │  (port 6379)  │
                            ▼             └──────────────┘
                     ┌──────────────┐
                     │   Worker     │
                     │  (Docker)    │
                     └──────────────┘
```

The API server is the hub. It manages task state in PostgreSQL, coordinates real-time events via Redis pub/sub, serves the REST API and SSE streams, and spawns worker Docker containers to execute tasks. The frontend is a React SPA that communicates with the API via `/api` proxy.

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Node.js** | 22+ | API and frontend run natively via Node |
| **Docker** | 20+ | For PostgreSQL, Redis, and worker containers |
| **Git** | 2.30+ | Workers use git worktrees |
| **Claude CLI** | Latest | `npm install -g @anthropic-ai/claude-code` — needed for OAuth token |
| **Claude Max or Team subscription** | Active | Provides the OAuth token for AI execution |

**Supported platforms:** Linux (native or WSL2), macOS. Windows requires WSL2.

### Disk space

- ~4 GB for the worker Docker image (includes Node.js, Git, GitHub CLI, Python, Claude CLI)
- ~500 MB for PostgreSQL data (grows with task history)
- Worktree space depends on your target repositories

---

## Quick Start

The fastest path uses the built-in `local-workermill` script, which automates PostgreSQL, Redis, API, and frontend startup.

### 1. Clone the repository

```bash
git clone https://github.com/jarod-rosenthal/workermill.git
cd workermill
```

### 2. Authenticate with Claude

```bash
claude auth login
```

This stores your OAuth token in `~/.claude/.credentials.json`. The API auto-syncs this token at startup — you do not need to copy it manually.

### 3. Install dependencies

```bash
cd api && npm install && cd ..
cd frontend && npm install && cd ..
```

### 4. Create environment file

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and set at minimum:

```bash
DATABASE_URL=postgresql://workermill:localdev@localhost:5432/workermill
EXECUTION_MODE=local
TARGET_REPO_PATH=../your-project  # Path to the repo workers will modify
```

### 5. Build the worker Docker image

```bash
./bin/local-workermill build-worker
```

This builds `workermill-worker:local` from `worker/Dockerfile`. Takes 5-10 minutes on the first build.

### 6. Start WorkerMill

```bash
./bin/local-workermill start
```

This starts PostgreSQL (Docker), Redis (Docker), runs database migrations, initializes worktrees, starts the API server, and starts the frontend dev server.

Once running:

- **Dashboard:** http://localhost:5173 (auto-login, no credentials needed)
- **API:** http://localhost:3001
- **Health check:** http://localhost:3001/health

### 7. Create a task

Either use the dashboard UI or the CLI:

```bash
./bin/local-workermill create-task "Add input validation to the signup form"
```

---

## Manual Setup

For users who want to run services individually or integrate with existing infrastructure.

### PostgreSQL

Any PostgreSQL 14+ instance works. The `docker-compose.local.yml` uses `pgvector/pgvector:pg15` for vector extension support (used by the memory system).

**Option A: Docker Compose (recommended)**

```bash
docker compose -f docker-compose.local.yml up -d postgres
```

This starts PostgreSQL on port 5432 (standard), with credentials `workermill:localdev` and database `workermill`.

**Option B: Existing PostgreSQL**

Create the database and user:

```sql
CREATE USER workermill WITH PASSWORD 'your-password';
CREATE DATABASE workermill OWNER workermill;
```

If you want the memory system (optional), install the pgvector extension:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Set `DATABASE_URL` accordingly:

```bash
DATABASE_URL=postgresql://workermill:your-password@your-host:5432/workermill
```

### Redis

Redis 7+ is used for real-time SSE pub/sub and orchestrator cron locks. If Redis is unavailable, the API falls back to database polling (higher latency for real-time updates but fully functional).

**Option A: Docker Compose**

```bash
docker compose -f docker-compose.local.yml up -d redis
```

**Option B: Existing Redis**

Set `REDIS_URL`:

```bash
REDIS_URL=redis://your-redis-host:6379
```

### API Server

```bash
cd api
npm install

# Set environment
export DATABASE_URL=postgresql://workermill:localdev@localhost:5432/workermill
export EXECUTION_MODE=local
export PORT=3001
export NODE_ENV=development
export REDIS_URL=redis://localhost:6379

# Start (development mode with hot reload)
npm run dev
```

The API server:
1. Connects to PostgreSQL
2. Runs all pending migrations automatically on startup (no manual migration step needed)
3. Seeds a default "Local" organization and `admin@localhost` user (first startup only)
4. Starts the orchestrator (task claiming, worker spawning, monitoring)
5. Syncs the OAuth token from `~/.claude/.credentials.json`

**Verify:** `curl http://localhost:3001/health` should return `200 OK`.

### Frontend

```bash
cd frontend
npm install

# Optional: set local mode for auto-login UI
export VITE_LOCAL_MODE=true

# Start Vite dev server
npx vite --host
```

The frontend proxies `/api` requests to `http://localhost:3001` via the Vite dev server config. Open http://localhost:5173 in your browser.

### Worker Image

Workers run in Docker containers built from `worker/Dockerfile`:

```bash
cd worker
docker build -t workermill-worker:local .
```

Or use the convenience command from the project root:

```bash
./bin/local-workermill build-worker
```

The worker image includes Node.js 22, Git, GitHub CLI, Docker CLI, Kaniko, Claude CLI, and Python 3. Additional dev tools (Go, Terraform, Rust, AWS CLI, etc.) are installed on-demand at runtime via `install-tools.sh`.

---

## Environment Variables

### Required

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://workermill:localdev@localhost:5432/workermill` | PostgreSQL connection string |
| `EXECUTION_MODE` | — | **Must be `local`** for self-hosted. Bypasses Cognito auth, billing, and TOS |
| `CLAUDE_CODE_OAUTH_TOKEN` | *(auto-synced)* | Claude OAuth token. Auto-loaded from `~/.claude/.credentials.json` if not set |

### API Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | API server port |
| `NODE_ENV` | `development` | Node environment (`development` enables SQL logging) |
| `LOG_LEVEL` | `debug` | Log verbosity: `debug`, `info`, `warn`, `error` |
| `JWT_SECRET` | — | JWT signing secret (any random string; only matters if using non-local auth) |
| `REDIS_URL` | — | Redis connection URL. If empty, SSE uses DB polling fallback |
| `CORS_ORIGINS` | `http://localhost:5173,https://workermill.com` | Comma-separated allowed CORS origins |
| `API_BASE_URL` | `https://workermill.com` | Public URL of the API (used in webhook callbacks) |
| `ENCRYPTION_KEY` | — | 64-character hex string (32 bytes) for encrypting sensitive DB fields. Optional in dev (plaintext fallback) |
| `DB_POOL_MAX` | `10` | Maximum PostgreSQL connection pool size |

### Worker Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `TARGET_REPO_PATH` | — | Path to the repository workers will modify |
| `MAX_LOCAL_WORKERS` | `4` | Maximum concurrent worker containers |
| `MAX_PARALLEL_EXPERTS` | `4` | Maximum parallel experts per task (each gets a git worktree) |
| `WORKTREE_BASE_PATH` | `../workermill-workers` | Directory for git worktrees |
| `WORKTREE_POOL_SIZE` | `8` | Number of pre-created worktrees |

### Epic Mode Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_CRITIC_REVIEW` | `true` | Enable planning agent critic review |
| `MAX_CRITIC_ITERATIONS` | `3` | Max iterations for critic plan revisions |
| `AUTO_APPROVAL_THRESHOLD` | `85` | Critic score threshold for auto-approval (0-100) |
| `ENABLE_TECH_LEAD_REVIEW` | `true` | Enable tech lead review of completed work |
| `MAX_REVIEW_REVISIONS` | `3` | Max revision iterations for tech lead review |

### Memory System (Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_MEMORY_SYSTEM` | `false` | Enable semantic/episodic/procedural memory |
| `CODEBASE_INDEXING_ENABLED` | `false` | Enable codebase indexing (requires pgvector) |

### Frontend

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `""` (empty) | API base URL. Leave empty so requests go through the Vite proxy |
| `VITE_LOCAL_MODE` | — | Set to `true` to enable auto-login UI (skips SSO buttons) |

---

## SCM Configuration

Workers need SCM tokens to clone repositories, create branches, and open pull requests. Set these in `.env.local` or via the dashboard Settings page after startup.

### GitHub

```bash
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
```

Create a **Fine-grained Personal Access Token** at https://github.com/settings/tokens with:
- **Repository access:** Select the repos workers should access
- **Permissions:** Contents (read/write), Pull requests (read/write), Metadata (read)

### GitLab

```bash
GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx
```

Create a **Personal Access Token** at your GitLab instance > Settings > Access Tokens with scopes: `api`, `read_repository`, `write_repository`.

### Bitbucket

```bash
BITBUCKET_TOKEN=xxxxxxxxxxxxxxxxxxxx
```

Create a **Repository Access Token** in the repository settings > Access tokens with permissions: Repository (read/write), Pull requests (read/write).

### Setting the SCM Provider

The default SCM provider is GitHub. To change it, update the organization settings via the dashboard (Settings > Integrations) or directly in the database:

```sql
UPDATE organizations SET scm_provider = 'gitlab' WHERE name = 'Local';
-- Valid values: 'github', 'gitlab', 'bitbucket'
```

### Jira Integration (Optional)

For ticket updates when tasks complete:

```bash
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_EMAIL=your-email@example.com
JIRA_API_TOKEN=your-api-token
```

---

## AI Provider Configuration

### Anthropic (Default)

The default provider uses Claude CLI with OAuth authentication. No API key needed — the OAuth token from `claude auth login` is used automatically.

The default models (configured in the seeded organization):
- **Worker model:** claude-sonnet-4-6
- **Planner model:** claude-opus-4-6
- **Reviewer model:** claude-opus-4-6

To use an Anthropic API key instead of OAuth:

```bash
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxx
```

### OpenAI

Set the API key either in `.env.local`:

```bash
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
```

Or configure via the dashboard: Settings > AI Providers > OpenAI.

Then change the worker model in Settings > Execution to an OpenAI model (e.g., `gpt-4o`).

### Google (Gemini)

```bash
GOOGLE_API_KEY=xxxxxxxxxxxxxxxxxxxx
```

Or configure via Settings > AI Providers > Google.

### Ollama (Local Models)

Ollama requires no API key — just a running Ollama server:

```bash
OLLAMA_HOST=http://localhost:11434
```

In WSL2, the host is auto-detected as the Windows gateway IP. You can override with:

```bash
OLLAMA_HOST=http://host.docker.internal:11434
```

### Provider Selection

Change the active provider in Settings > Execution. Each of these can be set independently:
- **Primary provider** — used for task execution (worker model)
- **Planning provider** — used for epic planning and decomposition
- **Manager provider** — used for PR review and log analysis

---

## Running Tasks

### Via the Dashboard

1. Open http://localhost:5173
2. Navigate to a Board (created automatically on first startup)
3. Create a card with a task description
4. Move the card to the appropriate column or click "Start Task"
5. Monitor progress in the live feed view

### Via the CLI

```bash
./bin/local-workermill create-task "Your task description here"
```

### Via the API

```bash
curl -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -H "X-API-Key: any-key-works-in-local-mode" \
  -d '{
    "title": "Add input validation",
    "description": "Add server-side validation to the POST /api/users endpoint",
    "persona": "backend_developer"
  }'
```

In local mode, the `X-API-Key` header is accepted with any value (authentication is bypassed).

### Task Lifecycle

1. **Planning** — The orchestrator decomposes the task into stories using the planning agent
2. **Queued** — Stories are queued for execution
3. **Executing** — A Docker worker container is spawned for each story. The worker clones the target repo, creates a branch, and executes changes using Claude
4. **Quality gates** — Pre-commit checks (type checking, tests, linting) run automatically. Auto-fix retries on failure
5. **PR creation** — If `pushAfterCommit` is enabled (default), the worker pushes and creates a PR
6. **Completed** — Task moves to completed status

### Monitoring

- **Dashboard live feed:** Real-time worker logs, file changes, and decisions at http://localhost:5173
- **CLI logs:** `./bin/local-workermill logs`
- **API logs:** Check `.local-workermill/api.log` in the project root
- **Docker container logs:** `docker logs <container-name>`

---

## Connecting the VS Code Extension

The VS Code extension can connect to a self-hosted WorkerMill instance via the agent binary. The extension never talks to any API directly — all communication goes through the agent.

### Setup

1. **Install the agent binary:**
   ```bash
   curl -fsSL https://workermill.com/install.sh | bash   # Mac/Linux
   irm https://workermill.com/install.ps1 | iex           # Windows (PowerShell)
   ```

2. **Configure the agent to point at your self-hosted API:**
   ```bash
   workermill-agent setup
   ```
   When prompted for the API URL, enter `http://localhost:3001` (or your self-hosted API URL). For the API key, use any value — local mode accepts any key.

   This creates `~/.workermill/config.json`:
   ```json
   {
     "mode": "cloud",
     "apiUrl": "http://localhost:3001",
     "apiKey": "self-hosted"
   }
   ```

3. **Start the agent:**
   ```bash
   workermill-agent start
   ```

4. **Install the VS Code extension** from the VS Code Marketplace (search "WorkerMill") or Open VSX.

5. The extension auto-discovers the agent by reading `~/.workermill/agent.port` and `~/.workermill/agent.token`. No manual configuration needed.

### Verifying the Connection

In VS Code, open the WorkerMill sidebar. If connected, you will see the backlog panel populated with tasks from your self-hosted API.

---

## Updating

### Pulling New Code

```bash
cd workermill
git pull origin main

# Reinstall dependencies (if package.json changed)
cd api && npm install && cd ..
cd frontend && npm install && cd ..

# Rebuild worker image (if worker/ changed)
./bin/local-workermill build-worker

# Restart
./bin/local-workermill stop
./bin/local-workermill start
```

Database migrations run automatically on API startup — no manual migration step is needed. The API checks for pending migrations and applies them before accepting traffic.

### Pulling Pre-Built Docker Images

Instead of building from source, you can use the published images from GHCR:

```bash
docker pull ghcr.io/jarod-rosenthal/worker:latest
docker tag ghcr.io/jarod-rosenthal/worker:latest workermill-worker:local
```

The `local-epic-spawner` looks for the `workermill-worker:local` tag.

---

## Troubleshooting

### OAuth token not found

```
OAuth token not found!
```

Run `claude auth login` to authenticate. The token is stored in `~/.claude/.credentials.json` and auto-loaded by the API.

If the token is expiring frequently, check that your Claude Max/Team subscription is active.

### Worker image not found

```
Worker image 'workermill-worker:local' not found!
```

Build the image: `./bin/local-workermill build-worker`

Or pull from GHCR: `docker pull ghcr.io/jarod-rosenthal/worker:latest && docker tag ghcr.io/jarod-rosenthal/worker:latest workermill-worker:local`

### PostgreSQL connection refused

```
Error connecting to database
```

Check that PostgreSQL is running: `docker ps | grep workermill-local-db`

If using an external PostgreSQL, verify the `DATABASE_URL` is correct and the database exists.

PostgreSQL runs on the standard port 5432. If you changed this in `docker-compose.local.yml`, update `DATABASE_URL` accordingly.

### Frontend shows login screen instead of auto-login

Ensure `VITE_LOCAL_MODE=true` is set when starting the frontend, and `EXECUTION_MODE=local` is set for the API. The `local-workermill start` script sets both automatically.

### Tasks stuck in "executing" status

In local mode, the task orphan detection (`failOrphanedTasks`) is currently skipped. If a worker container crashes without reporting completion, the task stays in "executing" forever.

**Workaround:** Manually fail the task via the API:

```bash
curl -X PATCH http://localhost:3001/api/tasks/<task-id> \
  -H "Content-Type: application/json" \
  -H "X-API-Key: any" \
  -d '{"status": "failed"}'
```

### Docker container cannot reach API (WSL2)

On WSL2 and macOS (Docker Desktop), the worker container uses `host.docker.internal` to reach the API on the host. If this fails:

1. Check Docker Desktop is running (not just the Docker CLI)
2. Verify: `docker run --rm alpine ping host.docker.internal`

On native Linux (Docker Engine, not Desktop), the API URL defaults to `http://localhost:<port>` with `--network=host`. If workers cannot connect, check that the API is listening on `0.0.0.0` (not just `127.0.0.1`).

### Redis connection warnings

```
Redis failed to start — SSE will use DB polling fallback
```

This is non-fatal. Without Redis, real-time coordination SSE events fall back to database polling (slightly higher latency). To fix, start Redis:

```bash
docker compose -f docker-compose.local.yml up -d redis
```

### Worker builds fail (out of memory)

The worker Docker image build compiles multiple TypeScript projects. If it fails with memory errors:

```bash
# Increase Docker memory limit (Docker Desktop: Settings > Resources)
# Or set Node.js memory limit:
docker build --build-arg NODE_OPTIONS="--max-old-space-size=4096" -t workermill-worker:local .
```

### Port 5173 already in use

If a previous frontend process is still running:

```bash
# Find and kill the process
lsof -ti :5173 | xargs kill -9

# Or use the stop command
./bin/local-workermill stop
```

### Encryption warnings at startup

```
ENCRYPTION_KEY not set — token encryption disabled (plaintext pass-through)
```

This is expected in development. For production self-hosted deployments, generate a key:

```bash
# Generate a 32-byte hex key
openssl rand -hex 32
```

Add to `.env.local`:

```bash
ENCRYPTION_KEY=your-64-character-hex-string
```

This encrypts sensitive fields (API keys, SCM tokens) at rest in the database.

---

## Production Self-Hosted Considerations

For running WorkerMill in a production self-hosted environment (not just local development):

1. **Set `ENCRYPTION_KEY`** — Encrypt sensitive database fields at rest
2. **Use a managed PostgreSQL** — RDS, Cloud SQL, or similar with automated backups
3. **Use a managed Redis** — ElastiCache, Memorystore, or similar
4. **Set `NODE_ENV=production`** — Disables SQL query logging and enables production optimizations
5. **Set `JWT_SECRET`** — Use a strong random secret if you plan to add authentication later
6. **Run the API with `node dist/index.js`** instead of `npm run dev` — Build first with `npx tsc` in the `api/` directory
7. **Serve the frontend via nginx** — Build with `npm run build` in `frontend/`, then serve the `dist/` directory. See `frontend/nginx.conf` for the required proxy and SPA routing configuration
8. **Set `DB_POOL_MAX`** — Tune based on your workload (default is 10)
9. **Monitor worker containers** — Tasks can get stuck if containers crash without reporting (see Troubleshooting above)

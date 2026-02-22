# Local Development

## Bastion Tunnel (Production RDS)

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

**Bastion commands:** `start`, `stop`, `status`, `ssh` (port forwarding 5432→RDS), `whitelist`. SSH key: `~/.ssh/workermill-bastion`.

Once tunnel is running, connect via `psql -h localhost -p 5432 -U workermill -d workermill` or `psql-workermill` from the bastion SSH session.

---

## Local WorkerMill Mode (Docker — Dashboard Only, No VS Code Extension)

Run WorkerMill entirely locally with workers as Docker containers. Uses Claude Max subscription OAuth token for authentication. Tasks are managed via the web dashboard at `localhost:5173` — **the VS Code extension does NOT connect to local WorkerMill** (it requires the remote agent).

**To use VS Code with local development**, run the remote agent pointed at `http://localhost:3001` instead — see `docs/claude/agent-and-vscode.md`.

### Prerequisites

- Docker (for PostgreSQL)
- Claude CLI: `curl -fsSL https://claude.ai/install.sh | bash` (or `winget install Anthropic.ClaudeCode` on Windows)
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
| `./bin/local-workermill reset` | Reset local environment |
| `./bin/local-workermill sync-data` | Sync data from production (requires bastion) |
| `./bin/local-workermill build-worker` | Build the worker Docker image |
| `./bin/local-workermill add-account` | Save current Claude credentials to rotation pool |

### Start Options

| Option | Default | Description |
|--------|---------|-------------|
| `--workers N` | 4 | Max concurrent workers |
| `--experts N` | 4 | Max parallel experts per task |
| `--skip-db` | false | Don't start PostgreSQL (use existing) |
| `--skip-fe` | false | Don't start frontend |
| `--no-critic` | false | Disable critic agent review |
| `--no-tech-lead` | false | Disable tech lead review |
| `--local-auth` | false | Skip Cognito, auto-login as local user |
| `--mock-workers` | false | Use fast mock workers instead of Claude CLI (for E2E tests) |

### Local Development Filesystem (CRITICAL — READ THIS)

**Always clone and run WorkerMill from the WSL2 native filesystem (`~/github/workermill`), NOT from `/mnt/c/`.**

The Windows mount (`/mnt/c/`) breaks Linux filesystem watchers (inotify), which means Vite HMR and `tsx watch` cannot detect file changes. Running from the WSL2 native filesystem fixes this — **hot module reload works automatically** with no restart needed.

```bash
# Correct: WSL2 native filesystem (HMR works)
cd ~/github/workermill
./bin/local-workermill start --skip-db

# Wrong: Windows mount (HMR broken, requires manual restart)
cd /mnt/c/Users/jarod/github/workermill
```

**After cloning, make scripts executable:** `chmod +x bin/local-workermill bin/bastion`

**Use VS Code Remote - WSL:** Open folders with `code .` from the WSL terminal, or `Ctrl+Shift+P` → "WSL: Open Folder in WSL" in VS Code.

### Restarting API Without Killing Workers

If you need to restart the API (e.g., after changing env vars or config that `tsx watch` doesn't pick up), **do NOT use `./bin/local-workermill stop`** — it kills the database and any running worker containers.

```bash
# Kill only API and frontend processes
lsof -ti :3001 2>/dev/null | xargs -r kill -9
lsof -ti :5173 -ti :5174 2>/dev/null | xargs -r kill -9

# Restart with existing database
./bin/local-workermill start --skip-db
```

**Rules:**
- NEVER change ports (5173 for frontend, 3001 for API)
- NEVER restart the API while a worker container is running a task (it will lose its connection and die)
- After restart, verify frontend is on port 5173: `cat .local-workermill/frontend.log`

### Local Architecture

API (`tsx watch`) and Frontend (Vite) auto-reload. PostgreSQL and Worker run as Docker containers — **Worker does NOT auto-reload** (see "Rebuild Worker Image" in Critical Rules).

# Local Development

## Local WorkerMill Mode (Docker — API/Dashboard Development)

This mode runs the full WorkerMill API + frontend + PostgreSQL locally, with workers as Docker containers. Used for developing and testing the WorkerMill platform itself. Tasks are managed via the web dashboard at `localhost:5173`.

**For most users** who just want to run AI agents on their code, use the standalone agent instead — see `docs/agent/agent-and-vscode.md`.

**To use VS Code with local API development**, run the cloud agent pointed at `http://localhost:3001` — see `docs/agent/agent-and-vscode.md` (Cloud Mode section).

### Prerequisites

- Docker (for PostgreSQL and worker containers)
- Claude CLI: `curl -fsSL https://claude.ai/install.sh | bash` (or `winget install Anthropic.ClaudeCode` on Windows)
- Claude Max subscription (for OAuth token)

### Setup

```bash
# 1. Authenticate with Claude (stores token in ~/.claude/.credentials.json)
claude auth login

# 2. Create .env.local (token is auto-synced from credentials.json)
cat >> .env.local << EOF
DATABASE_URL=postgresql://workermill:localdev@localhost:5433/workermill
EXECUTION_MODE=local
TARGET_REPO_PATH=../your-target-repo
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
| `--local-auth` | false | Skip Cognito, auto-login as local user |
| `--mock-workers` | false | Use fast mock workers instead of Claude CLI (for E2E tests) |

### WSL2 Development (Windows)

**Always clone and run WorkerMill from the WSL2 native filesystem (`~/github/workermill`), NOT from `/mnt/c/`.**

The Windows mount (`/mnt/c/`) breaks Linux filesystem watchers (inotify), which means Vite HMR and `tsx watch` cannot detect file changes. Running from the WSL2 native filesystem fixes this — **hot module reload works automatically** with no restart needed.

```bash
# Correct: WSL2 native filesystem (HMR works)
cd ~/github/workermill
./bin/local-workermill start --skip-db

# Wrong: Windows mount (HMR broken, requires manual restart)
cd /mnt/c/Users/<your-user>/github/workermill
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

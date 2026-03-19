# WorkerMill Local Development Setup

Run the full WorkerMill stack on your machine — API, dashboard, PostgreSQL, Redis, and AI workers. Tasks are managed via the web dashboard at `localhost:5173` and the VS Code extension.

## Prerequisites

- **Docker Desktop** — [download](https://www.docker.com/products/docker-desktop/)
- **Node.js 20+** — [download](https://nodejs.org/)
- **Claude CLI** — install with:
  - macOS/Linux: `curl -fsSL https://claude.ai/install.sh | bash`
  - Windows: `winget install Anthropic.ClaudeCode`
- **Git**

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/jarod-rosenthal/workermill.git
cd workermill
```

### 2. Authenticate with Claude

```bash
claude auth login
```

This stores your token in `~/.claude/.credentials.json`. WorkerMill reads it automatically.

### 3. Create your local environment file

```bash
cat > .env.local << 'EOF'
DATABASE_URL=postgresql://workermill:localdev@localhost:5433/workermill
EXECUTION_MODE=local
TARGET_REPO_PATH=../your-target-repo
EOF
```

Replace `../your-target-repo` with the path to the repository you want AI workers to operate on.

### 4. Build the worker Docker image

```bash
./bin/local-workermill build-worker
```

This compiles the worker code and builds a Docker image. Only needed once (and after worker code changes).

### 5. Start WorkerMill

```bash
./bin/local-workermill start
```

This starts:
- **PostgreSQL** on port 5433
- **Redis** on port 6379
- **API** on port 3001 (auto-reloads on code changes)
- **Frontend dashboard** on port 5173 (auto-reloads on code changes)

Open **http://localhost:5173** to access the dashboard. In local mode, authentication is bypassed — you're automatically signed in.

### 6. Connect VS Code

Open VS Code and install the [WorkerMill extension](https://marketplace.visualstudio.com/items?itemName=workermill.workermill). In the WorkerMill sidebar, click **Connect to Local Instance**. The extension auto-discovers the local API via `~/.workermill/agent.port`.

## Commands

| Command | Description |
|---------|-------------|
| `./bin/local-workermill start` | Start all services |
| `./bin/local-workermill stop` | Stop all services |
| `./bin/local-workermill status` | Show service status |
| `./bin/local-workermill create-task "title"` | Create a test task |
| `./bin/local-workermill logs` | Tail all service logs |
| `./bin/local-workermill reset` | Reset local environment |
| `./bin/local-workermill build-worker` | Rebuild the worker Docker image |

## Start Options

| Option | Default | Description |
|--------|---------|-------------|
| `--workers N` | 4 | Max concurrent workers |
| `--experts N` | 4 | Max parallel experts per task |
| `--skip-db` | false | Don't start PostgreSQL (use existing) |
| `--skip-fe` | false | Don't start frontend |
| `--no-critic` | false | Disable critic review |
| `--no-tech-lead` | false | Disable tech lead review |
| `--mock-workers` | false | Use mock workers for testing |

## Windows (WSL2)

**Always clone and run from the WSL2 native filesystem** (`~/github/workermill`), not from `/mnt/c/`. The Windows mount breaks filesystem watchers, which means hot reload won't work.

```bash
# Correct
cd ~/github/workermill
./bin/local-workermill start

# Wrong — hot reload broken
cd /mnt/c/Users/you/github/workermill
```

After cloning, make scripts executable: `chmod +x bin/local-workermill`

Use **VS Code Remote - WSL** to open the folder: `Ctrl+Shift+P` → "WSL: Open Folder in WSL".

## Troubleshooting

**Port already in use:** Kill existing processes and restart without the database:
```bash
lsof -ti :3001 | xargs -r kill -9
lsof -ti :5173 | xargs -r kill -9
./bin/local-workermill start --skip-db
```

**Worker not picking up code changes:** Workers run in Docker and don't auto-reload. Rebuild the image: `./bin/local-workermill build-worker`

**Database issues:** Reset everything: `./bin/local-workermill reset && ./bin/local-workermill start`

# WorkerMill Local Development Setup

Run the full WorkerMill stack on your machine — API, dashboard, PostgreSQL, Redis, and AI workers. Tasks are managed via the web dashboard at `localhost:5173` and the VS Code extension.

## Prerequisites

| Requirement | macOS | Windows | Linux |
|-------------|-------|---------|-------|
| **Docker Desktop** | [Download](https://www.docker.com/products/docker-desktop/) | [Download](https://www.docker.com/products/docker-desktop/) | [Download](https://www.docker.com/products/docker-desktop/) |
| **Node.js 20+** | `brew install node` | [Download](https://nodejs.org/) | `nvm install 20` |
| **Git** | `brew install git` | [Download](https://git-scm.com/) | `sudo apt install git` |
| **Claude CLI** | `curl -fsSL https://claude.ai/install.sh \| bash` | `winget install Anthropic.ClaudeCode` | `curl -fsSL https://claude.ai/install.sh \| bash` |

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/jarod-rosenthal/workermill.git
cd workermill
```

### 2. Install dependencies

```bash
cd api && npm install && cd ..
cd frontend && npm install && cd ..
```

### 3. Authenticate with Claude

```bash
claude auth login
```

This stores your OAuth token in `~/.claude/.credentials.json`. WorkerMill reads it automatically — no manual token copying needed.

### 4. Create your local environment file

**macOS / Linux:**
```bash
cat > .env.local << 'EOF'
DATABASE_URL=postgresql://workermill:localdev@localhost:5433/workermill
EXECUTION_MODE=local
TARGET_REPO_PATH=../your-target-repo
EOF
```

**Windows (PowerShell, if not using WSL2):**
```powershell
@"
DATABASE_URL=postgresql://workermill:localdev@localhost:5433/workermill
EXECUTION_MODE=local
TARGET_REPO_PATH=..\your-target-repo
"@ | Set-Content .env.local
```

Replace `../your-target-repo` with the path to the repository you want AI workers to operate on.

### 5. Build the worker Docker image

```bash
./bin/local-workermill build-worker
```

This compiles the worker code and builds a Docker image (~2 GB). Only needed once and after worker code changes.

### 6. Start WorkerMill

```bash
./bin/local-workermill start
```

This starts:
- **PostgreSQL** on port 5433
- **Redis** on port 6379
- **API** on port 3001 (auto-reloads on code changes)
- **Frontend dashboard** on port 5173 (auto-reloads on code changes)

Open **http://localhost:5173** to access the dashboard. By default, authentication is bypassed — you're automatically signed in as a local admin user. No AWS or Cognito setup needed.

> **Cognito SSO (optional):** If you need to test real authentication flows, start with `--cognito-auth`. This requires `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in your `.env.local` (available from AWS Secrets Manager for WorkerMill contributors).

### 7. Connect VS Code (optional)

Install the [WorkerMill extension](https://marketplace.visualstudio.com/items?itemName=workermill.workermill) and click **Connect to Local Instance** in the WorkerMill sidebar. The extension auto-discovers the local API.

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
| `--cognito-auth` | false | Use real Cognito SSO instead of auto-login |
| `--mock-workers` | false | Use mock workers for testing |

## Platform Notes

### macOS

Works out of the box. Docker Desktop for Mac handles the Docker socket automatically.

```bash
git clone https://github.com/jarod-rosenthal/workermill.git
cd workermill
cd api && npm install && cd ../frontend && npm install && cd ..
claude auth login
cat > .env.local << 'EOF'
DATABASE_URL=postgresql://workermill:localdev@localhost:5433/workermill
EXECUTION_MODE=local
TARGET_REPO_PATH=../your-target-repo
EOF
./bin/local-workermill build-worker
./bin/local-workermill start
```

### Windows (WSL2)

**Always clone and run from the WSL2 native filesystem** (`~/github/workermill`), not from `/mnt/c/`. The Windows mount breaks filesystem watchers, which means hot reload won't work.

```bash
# Correct — WSL2 native filesystem (hot reload works)
cd ~/github/workermill
./bin/local-workermill start

# Wrong — Windows mount (hot reload broken)
cd /mnt/c/Users/you/github/workermill
```

After cloning, make scripts executable:
```bash
chmod +x bin/local-workermill
```

Use **VS Code Remote - WSL** to open the folder: `Ctrl+Shift+P` → "WSL: Open Folder in WSL".

Claude CLI credentials are stored on the Windows side (`C:\Users\you\.claude\.credentials.json`). The startup script auto-detects this path from WSL.

### Linux

Same as macOS. Ensure Docker is running:
```bash
sudo systemctl start docker
```

If you get permission errors, add your user to the docker group:
```bash
sudo usermod -aG docker $USER
# Log out and back in for the group change to take effect
```

## Troubleshooting

**Port already in use:** Kill existing processes and restart without the database:
```bash
lsof -ti :3001 | xargs -r kill -9
lsof -ti :5173 | xargs -r kill -9
./bin/local-workermill start --skip-db
```

**Worker not picking up code changes:** Workers run in Docker and don't auto-reload. Rebuild the image:
```bash
./bin/local-workermill build-worker
```

**Database issues:** Reset everything:
```bash
./bin/local-workermill reset && ./bin/local-workermill start
```

**Claude CLI not found:** Make sure you've installed it and it's on your PATH:
```bash
claude --version
```
If not found, reinstall with `curl -fsSL https://claude.ai/install.sh | bash` (macOS/Linux) or `winget install Anthropic.ClaudeCode` (Windows).

**Docker not running:** Start Docker Desktop, or on Linux: `sudo systemctl start docker`.

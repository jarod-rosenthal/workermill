# @workermill/agent

Run WorkerMill AI workers locally. The agent polls the WorkerMill cloud dashboard for tasks, runs planning via Claude CLI, and spawns Docker worker containers on your machine.

## Prerequisites

- **Docker Desktop** — [Install Docker](https://docs.docker.com/get-docker/)
- **Claude Code CLI** — The setup wizard auto-installs this, or install manually:
  - macOS/Linux/WSL: `curl -fsSL https://claude.ai/install.sh | bash`
  - Windows PowerShell: `irm https://claude.ai/install.ps1 | iex`
- **Anthropic API key** — Or, if already signed into Claude CLI, that works too
- **Node.js >= 20** — [Install Node.js](https://nodejs.org/)
- **WorkerMill account** — Sign up at [workermill.com](https://workermill.com)

## Install & Setup

```bash
npm install -g @workermill/agent
```

The setup wizard launches automatically after install. It will:
1. Check all prerequisites (auto-installs Claude CLI if missing)
2. Prompt for your API key (from Settings > Integrations on the dashboard)
3. Validate connectivity to the WorkerMill API
4. Pull the worker Docker image
5. Save configuration to `~/.workermill/config.json`

SCM tokens (GitHub/GitLab/Bitbucket) are managed via **Settings > Integrations** on the dashboard — no local token setup needed.

## Usage

```bash
# Start the agent (background daemon mode, default)
workermill-agent start

# Start in foreground (show logs in terminal)
workermill-agent start --foreground

# Check status
workermill-agent status

# View logs
workermill-agent logs

# Stop the agent
workermill-agent stop

# Pull/update the Docker sandbox image
workermill-agent pull

# Update the agent binary
workermill-agent update
```

## How It Works

1. **Agent polls** the cloud API for tasks assigned to your organization
2. **Planning runs locally** via Claude CLI using your Anthropic API key
3. **Worker containers** spawn locally via Docker, executing code changes
4. **Logs and status** stream back to the cloud dashboard in real-time
5. **PRs are created** on your SCM provider (GitHub/GitLab/Bitbucket)

## Configuration

Config is stored at `~/.workermill/config.json` (created by `workermill-agent setup`):

| Field | Default | Description |
|-------|---------|-------------|
| `apiUrl` | `https://workermill.com` | WorkerMill API URL |
| `apiKey` | — | Organization API key |
| `agentId` | `agent-<hostname>` | Unique agent identifier |
| `maxWorkers` | `2` | Max concurrent worker containers |
| `dockerImage` | GHCR image | Docker image for workers |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "No config found" | Run `workermill-agent setup` |
| Auth failure | Check API key in Settings > Integrations |
| Docker not found | Install Docker Desktop and ensure it's running |
| Claude CLI not found | See install instructions above |
| Image pull fails | Ensure Docker is running. Run `workermill-agent pull` to retry |

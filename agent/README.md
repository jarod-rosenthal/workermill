***REMOVED*** @workermill/agent

Run WorkerMill AI workers locally using your Claude Max subscription. The agent polls the WorkerMill cloud dashboard for tasks, runs planning via Claude CLI, and spawns Docker worker containers on your machine.

***REMOVED******REMOVED*** Prerequisites

- **Docker Desktop** — [Install Docker](https://docs.docker.com/get-docker/)
- **Claude Code CLI** — The setup wizard auto-installs this, or install manually:
  - macOS/Linux/WSL: `curl -fsSL https://claude.ai/install.sh | bash`
  - Windows PowerShell: `irm https://claude.ai/install.ps1 | iex`
- **Claude Max subscription** — Run `claude` and sign in with your Claude account
- **Node.js >= 20** — [Install Node.js](https://nodejs.org/)
- **WorkerMill account** — Sign up at [workermill.com](https://workermill.com)

***REMOVED******REMOVED*** Install & Setup

```bash
npm install -g @workermill/agent
```

The setup wizard launches automatically after install. It will:
1. Check all prerequisites (auto-installs Claude CLI if missing)
2. Prompt for your API key (from Settings > Integrations on the dashboard)
3. Validate connectivity to the WorkerMill API
4. Authenticate to private ECR and pull the worker Docker image
5. Save configuration to `~/.workermill/config.json`

SCM tokens (GitHub/GitLab/Bitbucket) are managed via **Settings > Integrations** on the dashboard — no local token setup needed.

***REMOVED******REMOVED*** Usage

```bash
***REMOVED*** Start the agent (foreground)
workermill-agent start

***REMOVED*** Start in background (daemon mode)
workermill-agent start --detach

***REMOVED*** Check status
workermill-agent status

***REMOVED*** Stop a background agent
workermill-agent stop
```

***REMOVED******REMOVED*** How It Works

1. **Agent polls** the cloud API for tasks assigned to your organization
2. **Planning runs locally** via Claude CLI (using your Claude Max subscription — no per-token API charges)
3. **Worker containers** spawn locally via Docker, executing code changes
4. **Logs and status** stream back to the cloud dashboard in real-time
5. **PRs are created** on your SCM provider (GitHub/GitLab/Bitbucket)

***REMOVED******REMOVED*** Configuration

Config is stored at `~/.workermill/config.json` (created by `workermill-agent setup`):

| Field | Default | Description |
|-------|---------|-------------|
| `apiUrl` | `https://workermill.com` | WorkerMill API URL |
| `apiKey` | — | Organization API key |
| `agentId` | `agent-<hostname>` | Unique agent identifier |
| `maxWorkers` | `2` | Max concurrent worker containers |
| `workerImage` | Private ECR image | Docker image for workers (requires AWS credentials) |

***REMOVED******REMOVED*** Troubleshooting

| Issue | Solution |
|-------|----------|
| "No config found" | Run `workermill-agent setup` |
| Auth failure | Check API key in Settings > Integrations |
| Docker not found | Install Docker Desktop and ensure it's running |
| Claude CLI not found | See install instructions above |
| Image pull fails | Ensure AWS CLI is configured (`aws configure`) with ECR read access |

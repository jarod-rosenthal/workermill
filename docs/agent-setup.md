# Agent Setup

The WorkerMill agent connects the VS Code extension to local Docker workers. It runs as a background process and handles worker lifecycle management.

## Why Use the Agent?

- **Your infrastructure** — Code stays on your machine. Workers run in isolated Docker containers.
- **Cloud dashboard** — Real-time log streaming, task status, and coordination at workermill.com. Also available in VS Code.
- **Bring your own key** — Uses your own API keys (Anthropic, OpenAI, Google, or Ollama). Pay your provider directly.

## System Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| RAM | 16 GB | 32 GB+ |
| CPU | 4 cores | 8 cores+ |
| Disk | 10 GB free | 20 GB+ free |
| OS | macOS (Intel/Apple Silicon), Linux (x64), Windows (x64) | — |
| Network | Stable internet | — |

### Software Prerequisites

- **AI provider API key** — Anthropic, OpenAI, Google, or Ollama
- **Docker** — Workers run in isolated Docker containers
- **Git** — Required for repository operations

The agent is a single binary — no Node.js required. Docker is needed for worker containers. The setup wizard checks all prerequisites and installs Claude CLI automatically if missing.

## Installation

### Step 1 — Install the agent

```bash
curl -fsSL https://workermill.com/install.sh | bash
```

No Node.js required — it's a single binary.

### Step 2 — Run the setup wizard

```bash
workermill-agent setup
```

The interactive wizard validates your environment, installs missing dependencies, and configures the agent. Takes about 3 minutes.

### Step 3 — Start the agent

```bash
workermill-agent start
```

Or as a background daemon:

```bash
workermill-agent start --detach
```

The VS Code extension auto-discovers the agent via `~/.workermill/agent.port`.

## CLI Commands

| Command | Description |
|---------|-------------|
| `workermill-agent setup` | Interactive wizard — checks prerequisites, installs Claude CLI, validates API key, configures SCM tokens |
| `workermill-agent start` | Start in foreground. Connects to cloud API and begins polling for tasks |
| `workermill-agent start --detach` | Start as background daemon. Logs to `~/.workermill/agent.log` |
| `workermill-agent stop` | Stop the background agent process |
| `workermill-agent status` | Show agent status, active worker containers, API connectivity |
| `workermill-agent logs` | Live-tail agent logs (like `tail -f`) |
| `workermill-agent update` | Self-update to latest version from GitHub Releases |

## Troubleshooting

**Authentication failed (401)**
Your API key may be incorrect or expired. Go to Settings → Integrations on the dashboard, copy a fresh key, and re-run `workermill-agent setup`.

**Claude CLI not found after install**
On Windows, winget updates PATH but the current terminal doesn't see it. Close your terminal, open a new one, and try again.

**Worker process killed unexpectedly**
The worker ran out of memory. Ensure your machine has at least 8 GB of RAM available for worker processes.

**Agent shows online but no tasks are picked up**
Check that the dashboard has queued tasks for your organization. The agent only picks up tasks matching your org's API key.

**Worker can't clone repository**
Verify your SCM token has the correct permissions. GitHub tokens need `repo` scope. Bitbucket tokens need `repository:write` and `pullrequest:write`.

## Next Steps

- [VS Code Extension](/docs/vscode-extension) — Monitor tasks and manage workers from your IDE
- [Repositories](/docs/repositories) — Connect your GitHub, GitLab, or Bitbucket repos
- [Task Lifecycle](/docs/task-lifecycle) — Understand how tasks flow through the system

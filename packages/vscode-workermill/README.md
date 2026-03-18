# WorkerMill for VS Code

The open-source operations layer for AI coding agents — plan, execute, review, and ship from your editor.

## What It Does

WorkerMill orchestrates AI coding agents to build features, fix bugs, and complete tasks across your codebase. The extension gives you real-time visibility and control over the entire process.

- **Create tasks** from the sidebar — describe what you want built, or run issues from Jira, Linear, or GitHub Issues
- **Watch AI experts work** — real-time log streaming, live code changes as they happen
- **Multi-persona execution** — specialized AI workers (frontend, backend, DevOps, QA, security) collaborate on complex tasks
- **Quality gates** — pre-commit checks and CI enforcement before any code merges
- **Tech lead review** — AI code review with approval/revision loops
- **Product builds** — decompose a spec (.md file) into a full board of stories, then execute them all

## System Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| **RAM** | 16 GB | 32 GB+ |
| **Docker** | Required | Docker Desktop |
| **Git** | Required | Latest |
| **Claude Code CLI** | Required | Prompted during setup |
| **OS** | Windows, macOS, Linux | — |

All AI workers run inside Docker containers for filesystem and network isolation. Docker must be installed and running.

## Getting Started

### Standalone Mode (recommended)

No account needed. Runs locally with your own AI provider API key.

1. Install the extension
2. Open the WorkerMill sidebar
3. Click **Setup Standalone Mode**
4. Follow the prompts — the extension handles Docker setup, Git/Claude CLI checks, and SCM configuration

### Cloud Mode

For team workflows with Jira/Linear integration.

1. Open the WorkerMill sidebar
2. Click **Get Started with GitHub** or **Sign In**
3. The extension downloads the agent, connects to the cloud API, and you're ready

## Supported Integrations

| Category | Providers |
|----------|-----------|
| **AI Models** | Anthropic (Claude), OpenAI (GPT-4o, o1, o3), Google (Gemini), Ollama (self-hosted) |
| **Source Control** | GitHub, GitLab, Bitbucket |
| **Issue Trackers** | Jira, Linear, GitHub Issues, or built-in internal tracker |

## Commands

| Command | Description |
|---------|-------------|
| **New Task** | Create a task from the sidebar — describe what to build |
| **Run Task** | Run a Jira/Linear/GitHub issue by key |
| **Search Issues** | Search and run issues from a picker |
| **Product Build** | Decompose a .md spec into a board of stories |
| **Run as Task** | Run a .md file as a single worker task |
| **Talk to Worker** | Send a message to an active worker |
| **Show Task Logs** | Open log terminal for an active task |
| **Live Code Changes** | See file changes as workers edit code |
| **Approve Plan** | Approve or reject a pending execution plan |
| **Settings** | Configure models, SCM, trackers, quality gates, and worker behavior |
| **Install/Update Agent** | Download the latest agent binary |
| **Start/Stop/Restart Agent** | Control the agent process |
| **Setup Standalone Mode** | Initialize local-only mode with your API key |

## Links

- [Source Code](https://github.com/jarod-rosenthal/workermill)
- [Documentation](https://github.com/jarod-rosenthal/workermill/tree/main/docs/agent)
- [Report Issues](https://github.com/jarod-rosenthal/workermill/issues)

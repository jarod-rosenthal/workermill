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
| **WorkerMill Agent** | Required | Auto-downloaded during setup |
| **OS** | Windows, macOS, Linux | — |

All AI workers run inside Docker containers for filesystem and network isolation. Docker must be installed and running.

## Getting Started

1. Install the extension
2. Open the WorkerMill sidebar
3. Sign in with **GitHub** or **Google** to connect to WorkerMill Cloud
4. The extension downloads the agent binary, connects to the API, and you're ready

Cloud registration at [workermill.com](https://workermill.com) is coming soon. In the meantime, you can run the full platform locally for development — see [Local Dev Setup](https://github.com/jarod-rosenthal/workermill#getting-started).

## Supported Integrations

| Category | Providers |
|----------|-----------|
| **AI Models** | Anthropic (Claude 4.5/4.6), OpenAI (GPT-5.x), Google (Gemini 3.x), Ollama (local models) |
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

## Links

- [Source Code](https://github.com/jarod-rosenthal/workermill)
- [Documentation](https://github.com/jarod-rosenthal/workermill/tree/main/docs/agent)
- [Report Issues](https://github.com/jarod-rosenthal/workermill/issues)

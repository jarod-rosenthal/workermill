# WorkerMill for VS Code

Monitor tasks, stream logs, manage blockers, and run issues — all without leaving your editor.

> **Prerequisite:** The VS Code extension connects to the [WorkerMill agent](/docs/agent) running on your machine. Install and start the agent first — the extension auto-discovers it via `~/.workermill/agent.port`.

## Features

### Team Sidebar
Tree view with Active Tasks, Backlog (Jira issues), and Recent completions. Click any task to view details and open its log terminal.

### Activity Feed
Real-time expert collaboration feed showing task messages, status updates, and PR links as workers make progress.

### Log Terminals
Pseudoterminal tabs in VS Code's terminal area. Each running task gets its own tab with live-streamed logs.

### Notifications
Toast notifications for task start, completion, and failures. Blocker alerts with Retry / Skip / Abort actions.

### Live Diff
Watch code changes as they happen. The eye icon on each task opens a real-time git diff of worker edits.

### Full Build
Right-click any `.md` file and select "Full Build" to decompose a spec into a board of tasks.

## Installation

### Step 1 — Install the extension

```
ext install workermill.workermill
```

Or search for "WorkerMill" in the VS Code Extensions panel.

### Step 2 — Start the agent

```bash
workermill-agent start
```

Or use the command palette: `WorkerMill: Start Agent`

### Step 3 — Check the status bar

The bottom status bar shows the connection state:

- 🟢 **WorkerMill: Running** — connected to agent
- 🔴 **Waiting for agent** — agent not running or not reachable

## How It Connects

```
WorkerMill Agent (Your Machine)
  └── starts HTTP+SSE server on a random port
  └── writes port to ~/.workermill/agent.port

VS Code Extension (Your Machine)
  └── reads ~/.workermill/agent.port
  └── connects to local API
  └── auto-reconnects with exponential backoff (2–30 seconds)

Cloud API
  └── proxied through the agent
  └── no direct cloud connection from VS Code
```

The extension communicates only with the local agent on `127.0.0.1`. No authentication is needed — the agent proxies requests to the cloud API using your configured API key.

## Sidebar Sections

**Active Tasks**
Running and planning tasks, grouped by persona. Click to open the log terminal and activity feed. Cancel button stops the worker.

**Backlog**
Open and in-progress issues (Jira, GitHub, GitLab). Use the search button to find issues. Click the play button to run any issue as a task.

**Recent**
Recently completed or failed tasks. Click to review logs and output. Entries are automatically cleaned up after 10 minutes.

## Interacting with Workers

**Plan Approval**
When a task finishes planning, a notification pops up with the execution plan. Approve to proceed or reject with feedback.

**Blocker Alerts**
When a worker gets stuck, you see a notification with three actions: **Retry** (try again), **Skip** (skip the blocked story), or **Abort** (cancel the task).

**Talk to Worker**
Send a message to a running worker to provide additional context or redirect its approach. The worker receives it in real time.

## Commands

| Command | Trigger | Description |
|---------|---------|-------------|
| `WorkerMill: Run Issue` | Sidebar play button | Run a Jira issue as an AI worker task |
| `WorkerMill: Search Issues` | Sidebar search button | Search Jira/Linear issues and run them |
| `WorkerMill: Cancel Task` | Sidebar stop button | Stop a running task |
| `WorkerMill: Approve Plan` | Notification action | Approve an execution plan for a task |
| `WorkerMill: Full Build` | `.md` file context menu | Decompose a spec into a board of tasks |
| `WorkerMill: Open Live Diff` | Sidebar eye button | View real-time code changes from a worker |
| `WorkerMill: Install Agent` | Command palette | Run the agent install script |
| `WorkerMill: Start Agent` | Command palette | Start the agent as a background daemon |
| `WorkerMill: Stop Agent` | Command palette | Stop the running agent |

All commands are available via `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS) by typing "WorkerMill".

## Full Build

Turn a product requirements document into a board of actionable tasks — directly from your editor.

1. Open a `.md` file in VS Code
2. Right-click and select **Full Build** (or click the rocket icon in the editor title bar)
3. The agent decomposes the spec using your configured AI provider, streaming progress in real time
4. A board is created on workermill.com with individual cards for each task

Full Build runs entirely on your machine using your API key. The resulting board and cards are synced to the cloud dashboard.

## Troubleshooting

**Status bar shows "Waiting for agent"**
The agent is not running or has crashed. Run `workermill-agent start` in a terminal, or use the command palette: `WorkerMill: Start Agent`.

**Extension connected but sidebar is empty**
No tasks are active or queued. Create a task from the dashboard or run a Jira issue from the sidebar search.

**Log terminal not opening for a task**
Click on the task in the sidebar to manually open its log terminal. The terminal should auto-open when a new task starts.

**Extension not showing after install**
Reload VS Code (`Ctrl+Shift+P` → "Developer: Reload Window"). The extension activates on startup.

## Next Steps

- [Agent Setup](/docs/agent) — Install and configure the WorkerMill agent
- [Task Lifecycle](/docs/task-lifecycle) — Understand how tasks flow through the system
- [Epics & Stories](/docs/epics) — How tasks decompose into parallel expert work
- [Integrations](/docs/integrations) — Connect Jira, Linear, GitHub, and more

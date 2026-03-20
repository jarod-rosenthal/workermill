# Run Your First Task

You're ready to send work to AI agents. There are three ways to create a task:

### From an issue key

1. Click **Run Task** in the sidebar header (or `Cmd+Shift+P` > **WorkerMill: Run Task**)
2. Enter an issue key from your connected tracker (e.g., `ACME-123`, `GH-7`)
3. Optionally select a persona (or let WorkerMill auto-assign)
4. Click **Run Task**

### From a markdown file

1. Right-click any `.md` file in the Explorer
2. Select **WorkerMill: Run as Task**
3. The file content becomes the task description

### From the dashboard

1. Open the [web dashboard](https://workermill.com) (or your local instance)
2. Click **Run Task** in the top bar
3. Enter an issue key or browse your tracker

### What happens next

The planner decomposes your task into stories, assigns persona-matched experts, and executes them in parallel. Watch progress in real time from the **Coordination Feed** in the sidebar.

Each story goes through quality gates (lint, typecheck, tests) before commit. A consolidated PR is created when all stories complete.

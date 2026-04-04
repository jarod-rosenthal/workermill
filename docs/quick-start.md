# Quick Start

Get WorkerMill running in minutes. No account needed for the CLI path.

## Option A: WorkerMill CLI (Recommended)

Open source, runs locally. Works with Ollama, Anthropic, OpenAI, and Google.

**Requires:** Node.js 20+ and an LLM provider (Ollama for free local, or a cloud API key)

```bash
npx workermill
```

The CLI launches an interactive setup wizard on first run. It guides you through:

1. Choosing an AI provider
2. Entering your API key (or configuring Ollama for local models)
3. Pointing at a git repository
4. Running your first task

[See full CLI docs →](/docs/cli)

## Option B: Cloud Platform

Web dashboard with issue tracker webhooks, remote agent, and Docker sandbox workers.

**Requires:** Account at [workermill.com](https://workermill.com) + AI provider API key

### Step 1 — Create an account

Sign up at [workermill.com](https://workermill.com) and create your organization.

### Step 2 — Connect your issue tracker

Go to **Settings → Integrations** and connect Jira, Linear, or GitHub Issues. Add the API token and set the project(s) to monitor.

### Step 3 — Connect your repository

Go to **Settings → Integrations** and add your GitHub, GitLab, or Bitbucket token and default repository.

### Step 4 — Configure your AI provider

Go to **Settings → AI Providers** and enter your API key for Anthropic, OpenAI, Google, or Ollama.

### Step 5 — Create your first task

Label a ticket with `workermill` in your issue tracker. WorkerMill picks it up automatically and begins planning.

Or go to the **Dashboard** and click **New Task** to create one directly.

## Workflow Modes

Control how WorkerMill handles tasks using labels on your tickets:

| Label | Behavior |
|-------|----------|
| `workermill` | Plan, execute, create PR, wait for approval |
| `workermill` + `deploy` | Auto-deploy without human review |
| `workermill` + `review` | Tech Lead AI reviews before deploy |
| `workermill` + `manager` | Self-healing with autonomous error recovery |

## What Happens Next

Once a task is running:

1. WorkerMill plans and decomposes the ticket into stories
2. AI workers execute in parallel on isolated branches
3. A pull request is created with all changes
4. You review and merge (or let the `deploy` mode handle it automatically)

[Task Lifecycle →](/docs/task-lifecycle) | [Integrations →](/docs/integrations) | [Agent Setup →](/docs/agent)

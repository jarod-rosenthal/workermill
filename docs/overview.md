# WorkerMill

AI-powered task automation that turns your Jira, Linear, or GitHub Issues into working code, pull requests, and deployed features.

## Get Started with the CLI

The fastest way to use WorkerMill. No server, no Docker, no account.

```bash
npx workermill
```

[View CLI documentation →](/docs/cli)

## What is WorkerMill?

WorkerMill is an **AI-powered development automation platform** that transforms how engineering teams handle routine development tasks. By connecting your issue tracker (Jira, Linear, or GitHub Issues) with your SCM (GitHub, GitLab, or Bitbucket), WorkerMill automatically plans and decomposes your tasks, then deploys specialized AI workers to execute them autonomously.

Each task is handled by **specialized AI workers** running in isolated environments with access to your codebase, able to read documentation, understand context, write code, run tests, and create pull requests. WorkerMill works with **all major AI providers** including Anthropic Claude, OpenAI GPT, Google Gemini, and self-hosted models via Ollama.

## Key Features

### AI Workers
Specialized AI agents that understand your codebase and execute development tasks autonomously.

### Task Planning
WorkerMill analyzes your task and breaks it into smaller sub-tasks, each handled by a specialized worker.

### PR Creation
Workers automatically create pull requests with well-documented changes and test coverage.

### Quality Assurance
Built-in Tech Lead Reviewer validates all work before completion, ensuring code quality standards.

## How It Works

1. **Create Ticket** — In your issue tracker
2. **Planning** — AI plans and decomposes into sub-tasks
3. **Parallel Execute** — Workers execute in parallel
4. **PR Created** — Review and merge

## Platform Capabilities

- **10+ Worker Personas** — Specialized AI experts for every domain
- **4+ AI Providers** — Anthropic, OpenAI, Google, Ollama
- **3+ Issue Trackers** — Jira, Linear, GitHub Issues

## Learn More

- [Task Lifecycle](/docs/task-lifecycle) — Understand how tasks flow through the system
- [Worker Personas](/docs/personas) — Meet the specialized AI workers
- [Integrations](/docs/integrations) — Connect Jira, Linear, GitHub, and more
- [Quick Start](/docs/quick-start) — Get up and running in minutes

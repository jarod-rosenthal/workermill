# WorkerMill

Mission control for autonomous AI coding agents.

## What is this?

A real-time monitoring and orchestration system for AI agents that execute coding tasks. Think "htop for AI workers" - see what your agents are doing, track costs, and maintain control.

## Features

- **Real-time monitoring** - Live terminal streaming of agent execution
- **Cost tracking** - Per-task and aggregate spend on AI APIs + compute
- **Orchestration controls** - Queue management, worker slots, system on/off
- **Safety guardrails** - Blocked commands, protected files, approval gates
- **Workflow integration** - Jira/Linear → Execution → GitHub PR → Review → Deploy

## Packages

| Package | Description |
|---------|-------------|
| `@workermill/core` | Orchestrator, models, and services |
| `@workermill/api` | Express REST API for control center |
| `@workermill/dashboard` | React web dashboard |
| `@workermill/cli` | Terminal monitoring tool |
| `@workermill/integrations` | Jira, GitHub, AWS (ECS/SQS) adapters |

## Quick Start

### Using Docker Compose (Recommended)

```bash
# Clone the repo
git clone https://github.com/jarod-rosenthal/workermill.git
cd workermill

# Copy environment template
cp .env.example .env
# Edit .env with your API keys

# Start all services
docker-compose up -d

# Dashboard: http://localhost:3000
# API: http://localhost:4000
```

### Local Development

```bash
# Clone the repo
git clone https://github.com/jarod-rosenthal/workermill.git
cd workermill

# Install dependencies
npm install

# Start PostgreSQL (or use Docker)
docker-compose up -d postgres

# Build packages
npm run build

# Start dashboard dev server
cd packages/dashboard && npm run dev
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Dashboard / CLI                         │
│                   (Real-time monitoring)                     │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                      Core API                                │
│              (Task management, SSE streaming)                │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                    Orchestrator                              │
│    (Queue polling, worker spawning, cost tracking)          │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                   Worker Executors                           │
│         (Ephemeral containers running Claude Code)          │
└─────────────────────────────────────────────────────────────┘
```

## Configuration

Environment variables:

```bash
# Required
DATABASE_URL=postgresql://user:pass@host:5432/db
ANTHROPIC_API_KEY=sk-ant-...

# AWS (for ECS orchestration)
AWS_REGION=us-east-1
ECS_CLUSTER_NAME=your-cluster
AI_WORKER_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/...

# Integrations (optional)
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_EMAIL=your@email.com
JIRA_API_TOKEN=...
GITHUB_TOKEN=ghp_...
```

## Status

Early development - Extracting from production system at [OnCallShift](https://oncallshift.com)

## License

MIT

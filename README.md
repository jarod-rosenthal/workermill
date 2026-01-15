# WorkerMill

Mission control for autonomous AI coding agents.

## What is this?

A real-time monitoring and orchestration system for AI agents that execute coding tasks. Think "htop for AI workers" - see what your agents are doing, track costs, and maintain control.

**Live Demo**: [workermill.com](https://workermill.com)

## Features

### Core Platform
- **Real-time monitoring** - Live terminal streaming of agent execution via SSE
- **Cost tracking** - Per-task and aggregate spend on AI APIs + compute
- **Orchestration controls** - Queue management, worker slots, system on/off
- **Safety guardrails** - Blocked commands, protected files, approval gates
- **Workflow integration** - Jira webhook → Execution → GitHub PR → Review → Deploy

### Advanced Capabilities

| Feature | Description |
|---------|-------------|
| **Multi-Provider AI** | Support for Anthropic, OpenAI, Google Gemini, and Ollama |
| **Worker Checkpointing** | Resume tasks after Spot interruptions with S3-backed state |
| **Multi-Worker Coordination** | File locks, heartbeats, and conflict prevention |
| **Ralph Integration** | PRD-to-code execution engine for complex tasks |
| **Escalation Workflow** | Intelligent handoff when tasks need human input |
| **Virtual Manager** | AI-powered PR review and approval |

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Dashboard (React)                            │
│              Real-time monitoring, controls, settings                │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │ SSE / REST
┌─────────────────────────────────▼────────────────────────────────────┐
│                          API Server (Express)                        │
│         Task management, log streaming, webhooks, settings           │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
          ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Orchestrator  │    │  Coordination   │    │  Checkpointing  │
│                 │    │    Service      │    │    Service      │
│ Queue polling   │    │ Worker locks    │    │ S3 state save   │
│ Worker spawning │    │ Heartbeats      │    │ Spot recovery   │
│ Cost tracking   │    │ Conflict detect │    │ Resume logic    │
└────────┬────────┘    └─────────────────┘    └─────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    Worker Containers (ECS Fargate)                   │
│                                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │  Anthropic  │  │   OpenAI    │  │   Gemini    │  │   Ollama    │  │
│  │   Claude    │  │    GPT-4    │  │   Models    │  │   Local     │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                    Optional: Ralph Engine                       │ │
│  │              PRD Generation → Planning → Story Loop             │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

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
# Start PostgreSQL
docker-compose up -d postgres

# API Server
cd api && npm install && npm run dev

# Frontend (separate terminal)
cd frontend && npm install && npm run dev

# Dashboard: http://localhost:5173
# API: http://localhost:4000
```

## Task Workflows

### Standard Workflow

```
Jira Ticket + workermill label
           │
           ▼
      ┌─────────┐
      │ Queued  │
      └────┬────┘
           │
           ▼
     ┌───────────┐
     │ Executing │ ←── Live terminal streaming
     └─────┬─────┘
           │
     ┌─────┴─────┐
     │           │
     ▼           ▼
┌─────────┐  ┌──────────┐
│ Review  │  │ Escalated│ ←── Task needs clarification
│Requested│  └──────────┘
└────┬────┘
     │ PR Approved on GitHub
     ▼
┌──────────┐
│ Approved │
└────┬─────┘
     │ Worker re-runs to deploy
     ▼
┌──────────┐
│ Deployed │ ←── Changes live in production
└──────────┘
```

### With `deploy` Label (Auto-Deploy)

```
Jira Ticket + workermill + deploy
           │
           ▼
      ┌─────────┐
      │ Queued  │
      └────┬────┘
           │
           ▼
     ┌───────────┐
     │ Executing │
     └─────┬─────┘
           │ No PR approval needed
           ▼
      ┌──────────┐
      │ Deployed │
      └──────────┘
```

## Configuration

### Jira Labels

| Label | Purpose |
|-------|---------|
| `workermill` | **Required** - Triggers processing |
| `haiku` / `sonnet` / `opus` | Model selection |
| `deploy` | Auto-deploy without PR approval |
| `review` | Require Virtual Manager review |
| `anthropic` / `openai` / `gemini` / `ollama` | AI provider selection |

### Environment Variables

```bash
# Required
DATABASE_URL=postgresql://user:pass@host:5432/db
ANTHROPIC_API_KEY=sk-ant-...

# AWS (for ECS orchestration)
AWS_REGION=us-east-1
ECS_CLUSTER_NAME=your-cluster

# Optional Provider Keys (in AWS Secrets Manager)
# workermill/dev/openai-api-key
# workermill/dev/google-api-key

# Integrations
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_EMAIL=your@email.com
JIRA_API_TOKEN=...
GITHUB_TOKEN=ghp_...
```

## Documentation

- **[User Guide](docs/USER_GUIDE.md)** - Complete guide to using WorkerMill
- **[Worker Instructions](worker/AGENTS.md)** - How AI workers operate
- **[Infrastructure](infrastructure/terraform/README.md)** - Terraform deployment

## Key Concepts

### Escalation Workflow

When workers can't complete a task (unclear requirements, missing info, security concerns), they **escalate** rather than fail:

1. Worker adds detailed comment explaining the blocker
2. Task enters "Escalated" state
3. Human reviews and provides clarification
4. Task is re-queued for retry

This ensures work is never lost and maintains quality.

### Worker Checkpointing

Tasks running on AWS Spot instances can be interrupted. Checkpointing:

1. Saves worker state to S3 every 60 seconds
2. Catches SIGTERM on Spot reclaim
3. Re-queues task with checkpoint reference
4. New worker resumes from saved state

### Multi-Worker Coordination

When multiple workers target the same repository:

1. Workers check-in when starting
2. Send heartbeats every 30 seconds
3. Declare file manifests before editing
4. Locks prevent conflicting edits
5. Stale workers are cleaned up automatically

## Stack

| Component | Technology |
|-----------|------------|
| **API** | Express + TypeScript + TypeORM |
| **Database** | PostgreSQL |
| **Frontend** | React 19 + Vite + TailwindCSS |
| **State** | Zustand |
| **Infrastructure** | Terraform + AWS (ECS Fargate, RDS, S3, CloudFront) |
| **AI Providers** | Anthropic, OpenAI, Google, Ollama |

## Deployment

```bash
# Deploy everything
./deploy.sh --all

# Deploy specific components
./deploy.sh --api        # API service
./deploy.sh --worker     # Worker container
./deploy.sh --frontend   # React dashboard
```

## Status

Production deployment at [workermill.com](https://workermill.com).

## License

MIT

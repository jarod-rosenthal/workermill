***REMOVED*** WorkerMill

Mission control for autonomous AI coding agents.

***REMOVED******REMOVED*** What is this?

A real-time monitoring and orchestration system for AI agents that execute coding tasks. Think "htop for AI workers" - see what your agents are doing, track costs, and maintain control.

***REMOVED******REMOVED*** Features

- **Real-time monitoring** - Live terminal streaming of agent execution
- **Cost tracking** - Per-task and aggregate spend on AI APIs + compute
- **Orchestration controls** - Queue management, worker slots, system on/off
- **Safety guardrails** - Blocked commands, protected files, approval gates
- **Workflow integration** - Jira/Linear → Execution → GitHub PR → Review → Deploy

***REMOVED******REMOVED*** Packages

| Package | Description |
|---------|-------------|
| `@workermill/core` | Orchestrator, models, and services |
| `@workermill/api` | Express REST API for control center |
| `@workermill/dashboard` | React web dashboard |
| `@workermill/cli` | Terminal monitoring tool |
| `@workermill/integrations` | Jira, GitHub, AWS (ECS/SQS) adapters |

***REMOVED******REMOVED*** Quick Start

***REMOVED******REMOVED******REMOVED*** Using Docker Compose (Recommended)

```bash
***REMOVED*** Clone the repo
git clone https://github.com/jarod-rosenthal/workermill.git
cd workermill

***REMOVED*** Copy environment template
cp .env.example .env
***REMOVED*** Edit .env with your API keys

***REMOVED*** Start all services
docker-compose up -d

***REMOVED*** Dashboard: http://localhost:3000
***REMOVED*** API: http://localhost:4000
```

***REMOVED******REMOVED******REMOVED*** Local Development

```bash
***REMOVED*** Clone the repo
git clone https://github.com/jarod-rosenthal/workermill.git
cd workermill

***REMOVED*** Install dependencies
npm install

***REMOVED*** Start PostgreSQL (or use Docker)
docker-compose up -d postgres

***REMOVED*** Build packages
npm run build

***REMOVED*** Start dashboard dev server
cd packages/dashboard && npm run dev
```

***REMOVED******REMOVED*** Architecture

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

***REMOVED******REMOVED*** Configuration

Environment variables:

```bash
***REMOVED*** Required
DATABASE_URL=postgresql://user:pass@host:5432/db
ANTHROPIC_API_KEY=sk-ant-...

***REMOVED*** AWS (for ECS orchestration)
AWS_REGION=us-east-1
ECS_CLUSTER_NAME=your-cluster
AI_WORKER_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/...

***REMOVED*** Integrations (optional)
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_EMAIL=your@email.com
JIRA_API_TOKEN=...
GITHUB_TOKEN=ghp_...
```

***REMOVED******REMOVED*** Status

Early development - Extracting from production system at [OnCallShift](https://oncallshift.com)

***REMOVED******REMOVED*** License

MIT

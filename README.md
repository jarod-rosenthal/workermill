***REMOVED*** WorkerMill

Mission control for autonomous AI coding agents.

***REMOVED******REMOVED*** What is this?

A real-time monitoring and orchestration system for AI agents that execute coding tasks. Think "htop for AI workers" - see what your agents are doing, track costs, and maintain control.

**Live Demo**: [workermill.com](https://workermill.com)

***REMOVED******REMOVED*** Features

***REMOVED******REMOVED******REMOVED*** Core Platform
- **Real-time monitoring** - Live terminal streaming of agent execution via SSE
- **Cost tracking** - Per-task and aggregate spend on AI APIs + compute
- **Orchestration controls** - Queue management, worker slots, system on/off
- **Safety guardrails** - Blocked commands, protected files, approval gates
- **Workflow integration** - Jira webhook → Execution → GitHub PR → Review → Deploy

***REMOVED******REMOVED******REMOVED*** Advanced Capabilities

| Feature | Description |
|---------|-------------|
| **BYOK (Bring Your Own Key)** | Use your own AI provider API keys with zero markup |
| **Multi-Provider AI** | Support for Anthropic, OpenAI, Google Gemini, and Ollama |
| **Worker Checkpointing** | Resume tasks after Spot interruptions with S3-backed state |
| **Multi-Worker Coordination** | File locks, heartbeats, and conflict prevention |
| **Ralph Integration** | PRD-to-code execution engine for complex tasks |
| **Escalation Workflow** | Intelligent handoff when tasks need human input |
| **Virtual Manager** | AI-powered PR review and approval |

***REMOVED******REMOVED******REMOVED*** BYOK (Bring Your Own Key)

WorkerMill supports a **BYOK model** - use your own AI provider API keys with complete cost transparency:

- **Zero markup** on AI token costs (vs 15-20% markup from competitors)
- **Direct provider relationship** - access the latest models immediately
- **Leverage existing contracts** - use your enterprise Anthropic/OpenAI agreements
- **Full cost visibility** - see exact token costs per task

Supported providers:
- **Anthropic** (Claude Sonnet, Opus, Haiku)
- **OpenAI** (GPT-4, GPT-4o)
- **Google** (Gemini Pro, Gemini Flash)
- **Ollama** (Local models, self-hosted)

***REMOVED******REMOVED*** Architecture

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
***REMOVED*** Start PostgreSQL
docker-compose up -d postgres

***REMOVED*** API Server
cd api && npm install && npm run dev

***REMOVED*** Frontend (separate terminal)
cd frontend && npm install && npm run dev

***REMOVED*** Dashboard: http://localhost:5173
***REMOVED*** API: http://localhost:4000
```

***REMOVED******REMOVED*** Task Workflows

***REMOVED******REMOVED******REMOVED*** Standard Workflow

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

***REMOVED******REMOVED******REMOVED*** With `deploy` Label (Auto-Deploy)

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

***REMOVED******REMOVED*** Integrations

***REMOVED******REMOVED******REMOVED*** Issue Trackers

| Platform | Status | Webhook Endpoint | Notes |
|----------|--------|------------------|-------|
| **Jira** | Production | `/api/webhooks/jira` | Primary integration |
| **Linear** | Production | `/api/webhooks/linear` | Same label workflow |
| **GitHub Issues** | Production | `/api/webhooks/github-issues` | Uses `GH-{number}` as key |
| **Asana** | Coming Soon | `/api/webhooks/asana` | Enterprise project management |
| **ClickUp** | Coming Soon | `/api/webhooks/clickup` | All-in-one productivity |
| **GitLab Issues** | Coming Soon | `/api/webhooks/gitlab` | GitLab-native teams |

All platforms use the same label system - add `workermill` to trigger a worker.

***REMOVED******REMOVED******REMOVED*** Code & Deployment

| Platform | Status | Purpose |
|----------|--------|---------|
| **GitHub** | Production | PR creation, webhooks, branch management |
| **GitLab** | Coming Soon | MR creation, CI/CD integration |

***REMOVED******REMOVED******REMOVED*** Notifications

| Platform | Status | Purpose |
|----------|--------|---------|
| **Slack** | Production | Task notifications, cost alerts |
| **Discord** | Coming Soon | Community/team notifications |
| **Email** | Coming Soon | Digest and real-time notifications |

***REMOVED******REMOVED*** Worker Personas

WorkerMill uses specialized AI personas optimized for different types of work:

***REMOVED******REMOVED******REMOVED*** Production Personas

| Persona | Best For | Skills |
|---------|----------|--------|
| **Backend Developer** | APIs, database, business logic | Node.js, Python, TypeORM, REST/GraphQL |
| **Frontend Developer** | UI components, React, styling | React 19, TypeScript, TailwindCSS, accessibility |
| **DevOps Engineer** | Infrastructure, CI/CD, Docker | Terraform, GitHub Actions, ECS, CloudFormation |
| **Security Engineer** | Vulnerability fixes, auth, audits | OWASP Top 10, Snyk, secrets management |
| **QA Engineer** | Unit tests, E2E tests, automation | Jest, Playwright, Vitest, k6 |
| **Technical Writer** | README, API docs, comments | OpenAPI/Swagger, Markdown, Docusaurus |
| **Project Manager** | Task triage, planning, reports | Jira, estimation, dependency mapping |

***REMOVED******REMOVED******REMOVED*** Coming Soon

| Persona | Best For | Skills |
|---------|----------|--------|
| **Data Engineer** | ETL pipelines, data modeling | dbt, Airflow, Snowflake, BigQuery |
| **ML Engineer** | Training pipelines, model deployment | PyTorch, MLflow, SageMaker |
| **Mobile Developer (iOS)** | iOS app development | Swift, SwiftUI, Xcode |
| **Mobile Developer (Android)** | Android app development | Kotlin, Jetpack Compose |
| **API Developer** | API design, SDK creation | OpenAPI, Postman, GraphQL codegen |
| **Database Administrator** | Schema design, query optimization | PostgreSQL, indexing, migrations |

Personas are auto-assigned based on ticket content or can be manually selected.

**Virtual Manager**: Reviews all PRs, provides feedback, and handles approval workflow.

***REMOVED******REMOVED*** Configuration

***REMOVED******REMOVED******REMOVED*** Control Labels

| Label | Purpose |
|-------|---------|
| `workermill` | **Required** - Triggers processing |
| `haiku` / `sonnet` / `opus` | Model selection |
| `deploy` | Auto-deploy without PR approval |
| `review` | Require Virtual Manager review |
| `anthropic` / `openai` / `gemini` / `ollama` | AI provider selection |

***REMOVED******REMOVED******REMOVED*** Environment Variables

```bash
***REMOVED*** Required
DATABASE_URL=postgresql://user:pass@host:5432/db
ANTHROPIC_API_KEY=sk-ant-...

***REMOVED*** AWS (for ECS orchestration)
AWS_REGION=us-east-1
ECS_CLUSTER_NAME=your-cluster

***REMOVED*** Optional Provider Keys (in AWS Secrets Manager)
***REMOVED*** workermill/dev/openai-api-key
***REMOVED*** workermill/dev/google-api-key

***REMOVED*** Integrations
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_EMAIL=your@email.com
JIRA_API_TOKEN=...
GITHUB_TOKEN=ghp_...
```

***REMOVED******REMOVED*** API Endpoints

***REMOVED******REMOVED******REMOVED*** Webhooks
- `POST /api/webhooks/jira` - Jira issue events
- `POST /api/webhooks/linear` - Linear issue events
- `POST /api/webhooks/github` - GitHub PR reviews
- `POST /api/webhooks/github-issues` - GitHub Issues

***REMOVED******REMOVED******REMOVED*** Billing & Analytics
- `GET /api/billing/status` - Plan and usage info
- `POST /api/billing/checkout` - Stripe checkout session
- `GET /api/analytics/tasks` - Task statistics
- `GET /api/analytics/costs` - Cost breakdown by model/persona

***REMOVED******REMOVED******REMOVED*** Audit (Admin)
- `GET /api/audit/logs` - Query audit logs
- `GET /api/audit/summary` - Activity summary
- `GET /api/audit/export` - JSON export for compliance

***REMOVED******REMOVED*** Documentation

- **[User Guide](docs/USER_GUIDE.md)** - Complete guide to using WorkerMill
- **[Worker Instructions](worker/AGENTS.md)** - How AI workers operate
- **[Infrastructure](infrastructure/terraform/README.md)** - Terraform deployment
- **[In-App Docs](https://workermill.com/docs)** - Interactive documentation including:
  - Task Lifecycle and workflows
  - Worker Personas (all 7 types)
  - Integrations (Jira, Linear, GitHub)
  - Advanced Features (checkpointing, coordination)

***REMOVED******REMOVED*** Key Concepts

***REMOVED******REMOVED******REMOVED*** Escalation Workflow

When workers can't complete a task (unclear requirements, missing info, security concerns), they **escalate** rather than fail:

1. Worker adds detailed comment explaining the blocker
2. Task enters "Escalated" state
3. Human reviews and provides clarification
4. Task is re-queued for retry

This ensures work is never lost and maintains quality.

***REMOVED******REMOVED******REMOVED*** Worker Checkpointing

Tasks running on AWS Spot instances can be interrupted. Checkpointing:

1. Saves worker state to S3 every 60 seconds
2. Catches SIGTERM on Spot reclaim
3. Re-queues task with checkpoint reference
4. New worker resumes from saved state

***REMOVED******REMOVED******REMOVED*** Multi-Worker Coordination

When multiple workers target the same repository:

1. Workers check-in when starting
2. Send heartbeats every 30 seconds
3. Declare file manifests before editing
4. Locks prevent conflicting edits
5. Stale workers are cleaned up automatically

***REMOVED******REMOVED*** Stack

| Component | Technology |
|-----------|------------|
| **API** | Express + TypeScript + TypeORM |
| **Database** | PostgreSQL |
| **Frontend** | React 19 + Vite + TailwindCSS |
| **State** | Zustand |
| **Infrastructure** | Terraform + AWS (ECS Fargate, RDS, S3, CloudFront) |
| **AI Providers** | Anthropic, OpenAI, Google, Ollama |

***REMOVED******REMOVED*** Deployment

```bash
***REMOVED*** Deploy everything
./deploy.sh --all

***REMOVED*** Deploy specific components
./deploy.sh --api        ***REMOVED*** API service
./deploy.sh --worker     ***REMOVED*** Worker container
./deploy.sh --frontend   ***REMOVED*** React dashboard
```

***REMOVED******REMOVED*** Status

Production deployment at [workermill.com](https://workermill.com).

***REMOVED******REMOVED*** Roadmap

***REMOVED******REMOVED******REMOVED*** Current Focus
- Multi-worker coordination with file-level locking
- BYOK support for all 4 AI providers
- Real-time log streaming and cost tracking
- Virtual Manager PR review system

***REMOVED******REMOVED******REMOVED*** Coming Soon
- **Team Collaboration** - Member invites, role-based access, team analytics
- **New Personas** - Data Engineer, ML Engineer, Mobile Developer, DBA
- **More Integrations** - Asana, ClickUp, GitLab, Notion
- **Enhanced Analytics** - Cost forecasting, ROI tracking, provider comparison
- **Enterprise Features** - SSO/SAML, audit logging, custom deployment

See [STRATEGIC_EXPANSION_PLAN.md](STRATEGIC_EXPANSION_PLAN.md) for the full roadmap.

***REMOVED******REMOVED*** License

MIT

***REMOVED*** WorkerMill

Mission control for autonomous AI coding agents.

***REMOVED******REMOVED*** What is this?

A real-time monitoring and orchestration platform for AI agents that execute coding tasks. Think "htop for AI workers" — see what your agents are doing, watch code being written live, track costs, and maintain control.

**Live**: [workermill.com](https://workermill.com) | **Docs**: [workermill.com/docs](https://workermill.com/docs)

***REMOVED******REMOVED*** Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     VS Code Extension                                   │
│         Sidebar tree, activity feed, live diff, log terminals           │
└─────────────────────┬───────────────────────────────────────────────────┘
                      │ localhost (agent local API)
┌─────────────────────▼───────────────────────────────────────────────────┐
│                     Remote Agent (standalone binary)                     │
│           Task polling, planning (Claude CLI), worker spawning          │
│           Native process self-invocation or Docker sandbox              │
└─────────────────────┬───────────────────────────────────────────────────┘
                      │ REST / SSE
┌─────────────────────▼───────────────────────────────────────────────────┐
│                     Cloud API (Express + TypeScript)                     │
│     Task management, log streaming (PostgreSQL + SSE), orchestrator     │
│     Webhooks (Jira, GitHub, Linear, Bitbucket), coordination (Redis)   │
│     Worker decision engine, billing, analytics, board execution         │
├─────────────────────┬───────────────────────────────────────────────────┤
│   PostgreSQL (RDS)  │  Redis (ElastiCache)  │  S3 + CloudFront        │
└─────────────────────┴───────────────────────┴─────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────────────────┐
│                     Dashboard (React 19 + Vite)                         │
│     Real-time monitoring, Kanban boards, live code view (diff),        │
│     cost tracking, orchestration controls, persona studio               │
└─────────────────────────────────────────────────────────────────────────┘
```

***REMOVED******REMOVED******REMOVED*** Execution Paths

| Path | Worker runs as | Planning | When to use |
|------|---------------|----------|-------------|
| **Remote Agent** | Native process (agent binary self-invocation) | Yes (single-agent planner + critic) | Production, VS Code |
| **Remote Agent + Docker Sandbox** | Docker container (`ghcr.io/workermill/worker`) | Yes | Production (sandboxed) |
| **Local WorkerMill** | Docker container (`workermill-worker:local`) | No (skipped) | Local development |
| **Cloud ECS** | ECS Fargate task | Yes (requires remote agent for planning) | Legacy |

***REMOVED******REMOVED******REMOVED*** Task Flow (Remote Agent — Primary)

```
Jira/GitHub/Linear webhook ──┐
VS Code (Run Issue) ─────────┤→ Cloud API creates task (status: planning)
Dashboard (Run Card) ────────┘       │
                                     ▼
                              Remote agent polls /api/agent/poll
                                     │
                              Agent claims → runs planner (Claude CLI)
                                     │
                              Critic validates (score ≥ 85/100, max 3 iterations)
                                     │
                              Agent posts plan → API sets status: queued
                                     │
                              Agent claims → spawns worker (native or Docker sandbox)
                                     │
                              Epic Coordinator → experts in parallel (git worktrees)
                                     │
                              Live logs + code events stream to dashboard & VS Code
                                     │
                              Worker posts result → PR created → review/deploy
```

***REMOVED******REMOVED*** Features

***REMOVED******REMOVED******REMOVED*** Core Platform
- **Real-time log streaming** — PostgreSQL + SSE, live terminal output in dashboard and VS Code
- **Live code view** — Syntax-highlighted diffs as workers write code (unified/split modes)
- **Kanban boards** — Trello-like boards with dependency-ordered cards and cascade execution
- **Cost tracking** — Per-task and aggregate spend on AI APIs + compute
- **Orchestration controls** — Queue management, worker slots, system on/off
- **Safety guardrails** — Blocked commands, protected files, approval gates
- **Multi-org support** — Organization switcher in VS Code and dashboard
- **Billing tiers** — Pro / Max / Enterprise

***REMOVED******REMOVED******REMOVED*** BYOK (Bring Your Own Key)
Use your own AI provider API keys with zero markup on token costs:

- **Anthropic** (Claude Sonnet 4.6, Opus 4.6, Haiku 4.5) — default, Epic mode with parallel experts
- **OpenAI** (GPT-4, GPT-4o) — Multi-Expert mode via Vercel AI SDK
- **Google** (Gemini Pro, Gemini Flash) — Multi-Expert mode
- **Ollama** (local/self-hosted models) — Multi-Expert mode + codebase RAG embeddings

***REMOVED******REMOVED******REMOVED*** Worker System

**Epic Mode (Anthropic):** Planning agent decomposes task → Epic Coordinator → Claude CLI experts work in parallel via git worktrees → coordination feed → consolidated PR.

**Multi-Expert Mode (non-Anthropic):** Planning agent decomposes task → Multi-Expert Coordinator → Vercel AI SDK calls in parallel, each persona routed to configured provider → coordination feed → consolidated PR.

***REMOVED******REMOVED******REMOVED*** Worker Personas (12 roles)

| Persona | Best For |
|---------|----------|
| **Architect** | System design, architecture decisions |
| **Backend Developer** | APIs, database, business logic |
| **Frontend Developer** | UI components, React, styling |
| **Mobile Developer** | React Native, iOS/Android |
| **DevOps Engineer** | Infrastructure, CI/CD, Docker |
| **Data/ML Engineer** | Pipelines, data modeling, ML |
| **Security Engineer** | Vulnerability fixes, auth, audits |
| **QA Engineer** | Unit tests, E2E tests, automation |
| **Tech Writer** | Documentation, API docs |
| **Tech Lead** | Code review, standards enforcement |
| **Project Manager** | Task triage, planning, reports |
| **Support Agent** | Customer-facing issue resolution |

Personas are auto-assigned based on ticket content or manually selected. **Persona Studio** is the single source of truth for all persona data.

***REMOVED******REMOVED******REMOVED*** Integrations

| Platform | Type | Status |
|----------|------|--------|
| **Jira** | Issue tracker | Production |
| **GitHub Issues** | Issue tracker | Production |
| **Linear** | Issue tracker | Production |
| **GitHub** | SCM + PRs | Production |
| **GitLab** | SCM + MRs | Production |
| **Bitbucket** | SCM + PRs | Production |
| **Slack** | Notifications | Production |

All issue trackers use the same pattern — add the `workermill` label to trigger a worker.

***REMOVED******REMOVED******REMOVED*** Advanced Capabilities

| Feature | Description |
|---------|-------------|
| **Full Build (Epic) Decomposition** | PRD → dependency-ordered board cards with cascade execution |
| **Escalation Workflow** | Workers escalate blockers to dashboard for human input, then retry |
| **Virtual Manager** | AI-powered PR review and approval |
| **Rate Limit Detection** | Auto-detects rate limits → blocker escalation → dashboard banner |
| **Real-time Coordination** | Redis pub/sub SSE for instant multi-worker coordination |
| **Worker Decision Engine** | Server-side error classification, quality gates, routing (IP protection) |
| **Codebase RAG** | Vector search via Ollama embeddings (nomic-embed-text) + pgvector |
| **MCP Servers** | WorkerMill + OncallShift MCP servers (published to npm) |

***REMOVED******REMOVED*** Stack

| Component | Technology | Directory |
|-----------|------------|-----------|
| **API** | Express + TypeScript + TypeORM + PostgreSQL | `api/` |
| **Frontend** | React 19 + Vite + TailwindCSS + Zustand | `frontend/` |
| **Remote Agent** | Standalone binary (Bun compile), polyglot CLI/worker/manager | `agent/` |
| **VS Code Extension** | VS Code Marketplace (`workermill`) | `packages/vscode-workermill/` |
| **Worker Containers** | Docker + Claude Code for task execution | `worker/` |
| **MCP Servers** | WorkerMill + OncallShift | `packages/workermill-mcp/`, `packages/oncallshift-mcp/` |
| **Infrastructure** | Terraform → AWS (ECS Fargate, RDS, ElastiCache, S3, CloudFront) | `infrastructure/` |
| **Database** | PostgreSQL (RDS) | — |
| **Cache/Pubsub** | Redis (ElastiCache) | — |

***REMOVED******REMOVED*** Quick Start

***REMOVED******REMOVED******REMOVED*** Local Development

```bash
***REMOVED*** Start local services (PostgreSQL, Redis)
./bin/local-workermill start

***REMOVED*** API Server (auto-reloads via tsx watch)
cd api && npm install && npm run dev
***REMOVED*** → http://localhost:3001

***REMOVED*** Frontend (auto-reloads via Vite HMR)
cd frontend && npm install && npm run dev
***REMOVED*** → http://localhost:5173
```

***REMOVED******REMOVED******REMOVED*** Remote Agent

```bash
***REMOVED*** Install agent binary (Mac/Linux)
curl -fsSL https://workermill.com/install.sh | bash

***REMOVED*** Start agent
workermill-agent start
```

The VS Code extension connects to the remote agent automatically via `~/.workermill/agent.port`.

***REMOVED******REMOVED*** Deployment

```bash
***REMOVED*** Deploy everything to production
./deploy.sh --all

***REMOVED*** Deploy specific components
./deploy.sh --api        ***REMOVED*** API service (ECS)
./deploy.sh --frontend   ***REMOVED*** React dashboard (S3/CloudFront)
./deploy.sh --worker     ***REMOVED*** Worker Docker image (ECR)
```

Additional flags: `--skip-build`, `--db-check`, `--check-migrations`, `--snapshot`, `--wait`, `--publish-agent`.

**Agent release:** Bump `agent/package.json` version → `git tag agent-v<version>` → push tag → CI builds binaries + Docker sandbox image.

**VS Code release:** Bump `packages/vscode-workermill/package.json` version → `git tag vscode-v<version>` → push tag → CI publishes to Marketplace.

***REMOVED******REMOVED*** Documentation

- **[User Docs](https://workermill.com/docs)** — Overview, quick start, integrations, task lifecycle, personas, epics, analytics, MCP, advanced
- **[Architecture](docs/claude/architecture.md)** — Models, routes, task flow, execution modes
- **[Infrastructure](docs/claude/infrastructure.md)** — Terraform, SES, AWS setup
- **[Local Dev](docs/claude/local-dev.md)** — Local development setup
- **[Agent & VS Code](docs/claude/agent-and-vscode.md)** — Remote agent and extension details
- **[Testing](docs/claude/testing.md)** — Vitest (API), Playwright (E2E)
- **[Troubleshooting](docs/claude/troubleshooting.md)** — Common issues and fixes

***REMOVED******REMOVED*** License

MIT

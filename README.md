***REMOVED*** WorkerMill

An open-source orchestration platform for autonomous AI coding agents. Give it a task or an entire product spec — it plans the work, assigns persona-matched experts, executes in parallel, enforces quality gates, and delivers pull requests.

***REMOVED******REMOVED*** Quick Start

***REMOVED******REMOVED******REMOVED*** Install and Run

```bash
***REMOVED*** Install the agent binary (Mac/Linux)
curl -fsSL https://workermill.com/install.sh | bash

***REMOVED*** Initialize standalone mode — auto-detects your repo, GitHub token, and API key
workermill-agent init --standalone

***REMOVED*** Start the agent
workermill-agent start
```

That's it. The agent runs on your machine with your own API keys. No account, no server, no cloud dependency.

Install the [VS Code extension](https://marketplace.visualstudio.com/items?itemName=workermill.workermill) to get a sidebar for managing tasks, real-time log streaming, and live code diffs as workers write.

***REMOVED******REMOVED******REMOVED*** What Happens

1. You create a task (VS Code sidebar, or submit a PRD for a full product build)
2. A planner agent decomposes the task into stories with target files
3. A critic validates the plan (score threshold, up to 3 iterations)
4. Persona-matched experts execute stories in parallel, each in an isolated git worktree
5. Quality gates run before every commit (lint, typecheck, test, build)
6. CI pipeline is polled after push to verify the branch passes
7. A consolidated PR is created with optional tech lead review

***REMOVED******REMOVED******REMOVED*** Configuration

After `init --standalone`, your config lives at `~/.workermill/config.json`:

```jsonc
{
  "mode": "standalone",
  "roles": {
    "planner": { "provider": "anthropic", "model": "claude-opus-4-6" },
    "worker": { "provider": "anthropic", "model": "claude-sonnet-4-6" },
    "techLead": { "provider": "anthropic", "model": "claude-opus-4-6" }
  },
  "scm": { "provider": "github", "token": "ghp_..." },
  "defaultRepo": "owner/repo",
  "settings": { "maxStories": 8 }
}
```

You can use any supported provider per role — mix Anthropic for planning with Ollama for workers, etc.

***REMOVED******REMOVED*** How It Works

WorkerMill has two modes of operation built on the same execution engine.

***REMOVED******REMOVED******REMOVED*** Run as Task

The foundational unit. A single coding task goes through planning, multi-expert execution, quality enforcement, and delivery.

```
Task created
  │
  ▼
PLANNING ─────────── Planner decomposes task into stories with target files.
  │                  Critic validates the plan. Up to 3 planner↔critic rounds.
  ▼
EXECUTION ────────── Coordinator assigns stories to persona-matched experts.
  │                  Each expert works in an isolated git worktree.
  │                  Experts run in parallel, coordinating in real time.
  ▼
QUALITY GATES ────── Pre-commit: lint, typecheck, test, build per file glob.
  │                  Post-push: CI pipeline polled to verify the branch passes.
  │                  Gate failures trigger automatic fix agents.
  ▼
DELIVERY ─────────── Consolidated PR with all expert branches merged.
                     Optional tech lead review, auto-merge, and deployment.
```

***REMOVED******REMOVED******REMOVED*** Full Product Build

Takes a product requirements document (PRD) and produces a working, tested, deployed product. Under the hood, it decomposes the spec into a dependency-ordered board of cards, then executes each card as an individual task through the pipeline above.

```
PRD submitted (text, URL, or file)
  │
  ▼
DECOMPOSITION ────── Analyzes the spec and produces:
  │                  • Kanban board with dependency-ordered cards
  │                  • Quality gate config (lint, test, build commands per language)
  │                  • CI workflow path for post-push verification
  │                  • Persona assignments (backend, frontend, devops, etc.)
  │                  • Dependency graph between cards
  │
  │                  Enforced structure:
  │                  Card 0 = Project Setup & Dev Environment
  │                  Card 1 = CI/CD Pipeline & Quality Gates
  │                  Last card = Production Deploy & Validation
  │                  Each card targets 7–12 deliverables
  ▼
CASCADE EXECUTION ── Cards execute one at a time in dependency order.
                     Each card goes through the full Run as Task lifecycle.
                     When a card completes, the next unblocked card triggers
                     automatically.

  ┌────────┐    ┌────────┐    ┌────────┐    ┌────────┐    ┌────────┐
  │ Card 0 │───▶│ Card 1 │───▶│ Card 2 │───▶│ Card 3 │───▶│ Card N │
  │ Setup  │    │ CI/CD  │    │  Auth  │    │  API   │    │ Deploy │
  └────────┘    └────────┘    └───┬────┘    └────────┘    └────────┘
                                  │              ▲
                                  └──────────────┘
                               (Card 3 also depends on Card 2)
```

***REMOVED******REMOVED******REMOVED*** How the Modes Relate

Full Product Build is not a separate system — it is an orchestration layer that creates and sequences Run as Task executions. The decomposer produces the board, the cascade engine orders the work, and each card uses the same planner, coordinator, experts, quality gates, and delivery pipeline.

```
Full Product Build
 └─ PRD → Board with N dependency-ordered cards
     ├─ Card 0 (Setup)      → Run as Task → planning → experts → gates → PR
     ├─ Card 1 (CI/CD)      → Run as Task → planning → experts → gates → PR
     ├─ Card 2 (Feature A)  → Run as Task → planning → experts → gates → PR
     ├─ Card 3 (Feature B)  → Run as Task → planning → experts → gates → PR
     └─ Card N (Deploy)     → Run as Task → planning → experts → gates → PR
```

| Aspect | Run as Task | Full Product Build |
|--------|-------------|-------------------|
| **Input** | Single task description | Product requirements document (PRD) |
| **Scope** | One feature, bugfix, or deliverable | Entire product or major feature set |
| **Planning** | Planner decomposes task into stories | Decomposer produces cards; each card's planner decomposes it into stories |
| **Execution** | Multi-expert parallel on one task | Serial cards, each with multi-expert parallel execution |
| **Dependencies** | Between stories within a task | Between cards on the board, then between stories within each card |
| **Quality gates** | Pre-commit + post-push CI per task | Same gates, baked into the board at decomposition and applied to every card |
| **Delivery** | One PR per task | One PR per card, each building on the previous card's merged work |

***REMOVED******REMOVED*** Deployment Options

***REMOVED******REMOVED******REMOVED*** Standalone (Default)

The agent binary runs entirely on your machine. All state is stored locally in SQLite. No server infrastructure needed.

```
┌───────────────────────────────────────────────────────────┐
│                    VS Code Extension                       │
│      Sidebar tree, activity feed, live diff, log terms    │
└─────────────────────┬─────────────────────────────────────┘
                      │ localhost
┌─────────────────────▼─────────────────────────────────────┐
│                    Agent Binary                             │
│                                                             │
│  Local API (HTTP + SSE)      SQLite (tasks, boards, logs)  │
│  Event-driven orchestrator   Worker spawner (native/Docker) │
│  Planning (planner + critic) Coordination (in-process)     │
└─────────────────────────────────────────────────────────────┘
```

- **Config**: `~/.workermill/config.json` — per-role model selection, SCM tokens, execution settings
- **Storage**: `~/.workermill/data.db` — tasks, boards, logs, coordination messages
- **Workers**: Native process self-invocation (or Docker sandbox, opt-in)
- **Planning**: Full PRD decomposition and story planning, runs locally
- **No internet required** for execution (only for LLM API calls and SCM push)

***REMOVED******REMOVED******REMOVED*** Self-Hosted (Full Stack)

Run the complete platform yourself — API server, web dashboard, PostgreSQL, Redis. This gives you the web dashboard for monitoring, webhook integrations for Jira/GitHub/Linear, and the ability to run workers on remote infrastructure.

```
┌───────────────────────────────────────────────────────────┐
│                    VS Code Extension                       │
└─────────────────────┬─────────────────────────────────────┘
                      │ localhost
┌─────────────────────▼─────────────────────────────────────┐
│                    Agent Binary                             │
│  Local API, planning, worker spawning, heartbeat           │
└─────────────────────┬─────────────────────────────────────┘
                      │ REST / SSE
┌─────────────────────▼─────────────────────────────────────┐
│                    API Server (Express + TypeScript)        │
│                                                             │
│  Task management    Log streaming (PostgreSQL + SSE)       │
│  Board execution    Coordination (Redis pub/sub)           │
│  Webhooks           Analytics, decision engine             │
├───────────────────────────────────────────────────────────┤
│   PostgreSQL        │  Redis              │  Static files  │
└─────────────────────┴─────────────────────┴───────────────┘
                      │
┌─────────────────────▼─────────────────────────────────────┐
│                    Web Dashboard (React)                    │
│  Real-time monitoring, Kanban boards, live code view,     │
│  cost tracking, orchestration controls, persona studio     │
└───────────────────────────────────────────────────────────┘
```

```bash
***REMOVED*** Start local services (PostgreSQL, Redis)
./bin/local-workermill start

***REMOVED*** API server (auto-reloads)
cd api && npm install && npm run dev    ***REMOVED*** → http://localhost:3001

***REMOVED*** Web dashboard (auto-reloads)
cd frontend && npm install && npm run dev    ***REMOVED*** → http://localhost:5173

***REMOVED*** Agent (connects to local API)
workermill-agent start
```

You can deploy the full stack to AWS (ECS Fargate, RDS, ElastiCache, S3, CloudFront) or run it on any infrastructure that supports Node.js, PostgreSQL, and Redis.

***REMOVED******REMOVED******REMOVED*** Hosted Instance

A hosted instance is available at [workermill.com](https://workermill.com) for those who don't want to manage infrastructure. The agent binary on your machine connects to the hosted API, and you get the web dashboard at workermill.com.

***REMOVED******REMOVED******REMOVED*** Comparison

| | Standalone | Self-Hosted | Hosted |
|---|---|---|---|
| **Infrastructure** | None (single binary) | PostgreSQL + Redis + Node.js | Managed |
| **Task storage** | SQLite (local) | PostgreSQL | PostgreSQL |
| **Workers run on** | Your machine | Your machine or containers | Your machine or cloud containers |
| **Web dashboard** | No (VS Code only) | Yes | Yes |
| **Webhook triggers** | No (VS Code only) | Yes (Jira, GitHub, Linear) | Yes |
| **API keys** | Your own (BYOK) | Your own | Your own or platform-provided |
| **PRD decomposition** | Yes | Yes | Yes |
| **Quality gates** | Yes | Yes | Yes |

***REMOVED******REMOVED*** Features

***REMOVED******REMOVED******REMOVED*** AI Provider Support

Bring your own API keys. The execution pipeline is identical regardless of provider — the only difference is which SDK drives each expert.

- **Anthropic** (Claude Sonnet 4.6, Opus 4.6, Haiku 4.5) — default, experts via Claude CLI
- **OpenAI** (GPT-4, GPT-4o) — experts via Vercel AI SDK
- **Google** (Gemini Pro, Gemini Flash) — experts via Vercel AI SDK
- **Ollama** (local/self-hosted models) — experts via Vercel AI SDK + codebase RAG embeddings

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

Personas are auto-assigned based on task content or manually selected.

***REMOVED******REMOVED******REMOVED*** Integrations (Self-Hosted / Hosted)

| Platform | Type |
|----------|------|
| **Jira** | Issue tracker — add `workermill` label to trigger |
| **GitHub Issues** | Issue tracker |
| **Linear** | Issue tracker |
| **GitHub** | SCM + pull requests |
| **GitLab** | SCM + merge requests |
| **Bitbucket** | SCM + pull requests |
| **Slack** | Notifications |

***REMOVED******REMOVED******REMOVED*** More

- **Real-time log streaming** — Live terminal output in dashboard and VS Code
- **Live code view** — Syntax-highlighted diffs as workers write code
- **Kanban boards** — Dependency-ordered cards with cascade execution
- **Cost tracking** — Per-task and aggregate spend on AI API tokens
- **Safety guardrails** — Blocked commands, protected files, approval gates
- **Escalation workflow** — Workers escalate blockers for human input, then retry
- **Codebase RAG** — Vector search via Ollama embeddings for context-aware workers
- **MCP servers** — Published to npm (`@workermill/mcp`)

***REMOVED******REMOVED*** Project Structure

```
agent/                      Agent binary — CLI, worker, manager (Bun compile)
api/                        API server — Express + TypeScript + TypeORM
frontend/                   Web dashboard — React 19 + Vite + TailwindCSS + Zustand
worker/                     Worker execution engine — planning, coordination, quality gates
packages/
  vscode-workermill/        VS Code extension
  workermill-mcp/           WorkerMill MCP server
  oncallshift-mcp/          OncallShift MCP server
bin/                        CLI scripts (local-workermill, bastion)
docker/                     Docker configs for local development
```

***REMOVED******REMOVED*** Contributing

***REMOVED******REMOVED******REMOVED*** Development Setup

```bash
git clone https://github.com/jarod-rosenthal/workermill.git
cd workermill

***REMOVED*** Start local services (PostgreSQL on :5433, Redis on :6379)
./bin/local-workermill start

***REMOVED*** API server (auto-reloads via tsx watch)
cd api && npm install && npm run dev    ***REMOVED*** → http://localhost:3001

***REMOVED*** Web dashboard (auto-reloads via Vite HMR)
cd frontend && npm install && npm run dev    ***REMOVED*** → http://localhost:5173
```

***REMOVED******REMOVED******REMOVED*** Running Tests

```bash
***REMOVED*** API unit tests (Vitest)
cd api && npm run test

***REMOVED*** Single test file
cd api && npx vitest run src/routes/tasks.test.ts

***REMOVED*** API integration tests
cd api && npm run test:integration

***REMOVED*** Frontend E2E tests (Playwright)
cd frontend && npm run test:e2e
```

***REMOVED******REMOVED******REMOVED*** Type Checking

```bash
cd api && npm run typecheck
cd frontend && npx tsc -b
cd agent && npm run typecheck
cd worker && npm run typecheck
```

***REMOVED******REMOVED******REMOVED*** Building the Agent

```bash
cd agent && npm install && npm run build

***REMOVED*** Build standalone binary
cd agent && npm run build:binary
```

***REMOVED******REMOVED******REMOVED*** Key Architecture Decisions

If you're diving into the codebase, these are the patterns that hold the system together:

- **Log streaming** uses PostgreSQL + SSE, not CloudWatch or WebSockets
- **Task orchestration** uses database polling with atomic `UPDATE...WHERE` claiming — multi-instance safe
- **Real-time coordination** between experts uses Redis pub/sub with database polling as fallback
- **Code events (live code view)** are stateless on the API — clients reconstruct file state from raw immutable events
- **Quality gates** are two-phase: pre-commit shell commands + post-push CI pipeline polling
- **The worker execution engine** (`worker/epic/`) is shared across all deployment options — standalone, self-hosted, and hosted all run the same code

***REMOVED******REMOVED*** Deployment

```bash
***REMOVED*** Deploy everything to production (AWS)
./deploy.sh --all

***REMOVED*** Deploy specific components
./deploy.sh --api        ***REMOVED*** API service (ECS)
./deploy.sh --frontend   ***REMOVED*** Dashboard (S3/CloudFront)
./deploy.sh --worker     ***REMOVED*** Worker Docker image (ECR)
```

Additional flags: `--skip-build`, `--db-check`, `--check-migrations`, `--snapshot`, `--wait`.

**Agent release:** Bump `agent/package.json` version → `git tag agent-v<version>` → push tag → CI builds binaries.

**VS Code release:** Bump `packages/vscode-workermill/package.json` version → `git tag vscode-v<version>` → push tag → CI publishes to Marketplace.

***REMOVED******REMOVED*** Documentation

- **[Docs](https://workermill.com/docs)** — User-facing guides: quick start, integrations, task lifecycle, personas, epics
- **[Architecture](docs/agent/architecture.md)** — Models, routes, task flow, execution modes
- **[Infrastructure](docs/agent/infrastructure.md)** — Terraform, AWS setup
- **[Local Dev](docs/agent/local-dev.md)** — Development environment setup
- **[Agent & VS Code](docs/agent/agent-and-vscode.md)** — Agent internals, extension details
- **[Testing](docs/agent/testing.md)** — Vitest (API), Playwright (E2E)
- **[Troubleshooting](docs/agent/troubleshooting.md)** — Common issues and fixes

***REMOVED******REMOVED*** License

Apache License 2.0 — see [LICENSE](LICENSE) for details.

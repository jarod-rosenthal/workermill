# WorkerMill Open-Source Launch Design

**Date:** 2026-02-27
**Status:** Draft — awaiting approval
**Goal:** Prepare WorkerMill for public open-source release on GitHub, positioning it as the operations layer for AI coding agents and establishing Jarod Rosenthal's professional credibility for Head of AI / VP Engineering roles.

---

## Strategic Context

### Market Position
The AI coding agent market has commoditized at $15-20/month (Devin, Cursor, Copilot, Windsurf, Factory). Competing as another agent at this price point is unwinnable against companies with $100M+ in funding.

The gap: **no one owns the orchestration and operations layer.** Gartner predicts 40% of enterprise apps will run AI agents by 2026. Deloitte identifies the "Command Center" — monitoring, policy enforcement, escalation — as non-negotiable for production deployments. Anthropic's own 2026 report says software development is shifting from writing code to orchestrating agents.

WorkerMill IS that operations layer. Open-sourcing it captures the category.

### Dual Objective
1. **Career positioning:** Establish credibility for Head of AI / VP Eng roles through a high-quality open-source project that demonstrates architectural depth and strategic AI thinking.
2. **Monetization optionality:** Hosted SaaS at workermill.com remains the commercial offering (GitLab/Grafana model). Open source drives adoption; hosted service drives revenue when/if pursued.

### What Goes Public
**Everything.** The entire monorepo under Apache 2.0. The code itself is not the moat — the operational expertise, hosted service, and community are.

---

## Part 1: Security Scrubbing

Before any code goes public, all sensitive data must be removed from tracked files.

### Must Fix (High Priority)

| Finding | What | Where | Action |
|---------|------|-------|--------|
| H1 | AWS Account ID `AWS_ACCOUNT_ID` | 50+ files (deploy.sh, CI workflows, API routes, docs, CLAUDE.md) | Replace with `${AWS_ACCOUNT_ID}` env var or `<AWS_ACCOUNT_ID>` placeholder in docs |
| H2 | CloudFront distribution IDs `CLOUDFRONT_DIST_ID`, `CLOUDFRONT_DIST_ID_2` | deploy.sh, CI workflows, docs | Replace with `${CLOUDFRONT_DISTRIBUTION_ID}` env var |
| H3 | Cognito User Pool ID `COGNITO_POOL_ID` and Client ID `COGNITO_CLIENT_ID` | docs/SSO_SETUP_GUIDE.md, docs/plans/ | Replace with `<COGNITO_USER_POOL_ID>`, `<COGNITO_CLIENT_ID>` |
| H4 | Cognito hosted UI domain `workermill-dev-x0ru7n3p.auth.us-east-1.amazoncognito.com` | docs/SSO_SETUP_GUIDE.md, docs/plans/ | Replace with `<COGNITO_DOMAIN>` |
| H5 | SSH public key for bastion | infrastructure/terraform/environments/prod/variables.tf:137 | Move to terraform.tfvars (gitignored) or accept risk (it's a public key) |

### Should Fix (Medium Priority)

| Finding | What | Where | Action |
|---------|------|-------|--------|
| M1 | Customer emails (`@mevion.com`, `brad.hawkins@`) | 5+ migration files | Anonymize to `user@example.com` or squash migrations |
| M2 | Cognito User UUID in seed data | api/src/db/seed.ts:40 | Replace with generated UUID placeholder |
| M3 | Customer org UUID `00000000-...` | 7 migration files | Anonymize in migration descriptions |
| M4 | Personal email in Terraform | infrastructure/terraform/environments/prod/variables.tf:51 | Change default to `""`, move real value to tfvars |
| M5 | GitHub fork reference | api/src/services/support-agent.ts:119 | Use env var instead of hardcoded `jarod-rosenthal/workermill` |
| M6 | SQS/SNS ARNs in docs | docs/ONCALLSHIFT_REBUILD.md | Replace with `<SQS_QUEUE_URL>` placeholders |
| M7 | IAM role ARN hardcoded | worker/epic/inline-improver.ts:19 | Use env var only, remove hardcoded fallback |

### Already Safe (No Action Needed)
- CI/CD workflows use `${{ secrets.* }}` properly
- Terraform secrets use `PLACEHOLDER_UPDATE_ME` with `ignore_changes`
- No `.env` files committed (solid `.gitignore`)
- No database dumps in git
- No API keys, passwords, or tokens in tracked files
- Pre-commit hook scans for private key patterns
- Local dev passwords in docker-compose are standard practice

### Implementation Approach
1. Create a script (`scripts/scrub-secrets.sh`) that performs all replacements
2. Run it, verify with `git diff`, review every change
3. Add a pre-commit check that greps for the AWS account ID pattern to prevent re-introduction
4. Commit as a single "security: scrub infrastructure identifiers for open-source release"

---

## Part 2: GitHub Profile Overhaul

### Profile Fields

| Field | Current | New |
|-------|---------|-----|
| **Name** | Jarod Rosenthal | Jarod Rosenthal |
| **Bio** | "I'm a meat popsicle." | "DevSecOps Manager building the operations layer for AI coding agents. 30 years in infrastructure, cloud, and automation." |
| **Company** | (empty) | @Eaton |
| **Location** | "Best Place on Earth" | Raleigh, NC |
| **Website** | (empty) | workermill.com |
| **Twitter/X** | (empty) | @jarod_rosenthal |
| **Hireable** | (not set) | true |

### Profile README

Create repo `jarod-rosenthal/jarod-rosenthal` with `README.md`:

```markdown
# Jarod Rosenthal

DevSecOps Manager at Eaton. Building [WorkerMill](https://github.com/workermill/workermill) —
open-source orchestration for autonomous AI coding agents.

## What I'm Working On

**[WorkerMill](https://github.com/workermill/workermill)** — The operations layer for
AI-powered software development. Multi-agent orchestration, quality gates, real-time monitoring,
and cost control for teams using AI coding agents.

- Multi-expert parallel execution via isolated git worktrees
- Two-stage quality gates (pre-commit + CI verification)
- Planning with critic validation loops (score threshold, max iterations)
- Real-time dashboard with live code diffs and coordination messages
- BYOK — bring your own keys for Claude, GPT-4, Gemini, or Ollama

## Background

30 years building infrastructure and automation systems:

- **DevSecOps & Cloud** — AWS Solutions Architect Professional, Terraform, ECS Fargate, CI/CD
- **Lead DevOps** — 3.5 years at SemanticBits/ICF (healthcare/government systems)
- **AI Orchestration** — Multi-agent coordination, LLM integration, autonomous coding workflows

## Find Me

- [WorkerMill](https://workermill.com) — hosted platform
- [X/Twitter](https://x.com/jarod_rosenthal)
- [LinkedIn](https://linkedin.com/in/jarodrosenthal)
```

### Repo Cleanup

| Repo | Stars | Last Updated | Action |
|------|-------|-------------|--------|
| `Adafruit_Python_PlatformDetect` | 0 | 2022 | Archive |
| `AI-on-Jetson-Nano` | 1 | 2022 | Archive |
| `sky-hunter` | 1 | 2022 | Archive |
| `USB-Camera` | 0 | 2022 | Archive |
| `wordpress` | 0 | 2023 | Archive |

After archiving, pin **WorkerMill** as the sole pinned repository on the profile.

---

## Part 3: Repository Preparation

### License Change

Change from MIT to **Apache 2.0**.

**Why Apache 2.0:**
- Industry standard for platforms (Kubernetes, Terraform, Kafka, Airflow)
- Explicit patent grant protects contributors and users
- Requires attribution (your name stays associated with the project)
- Allows commercial use (no friction for adoption)
- More "serious" signal than MIT for enterprise-grade software

**Files to add/update:**
- `LICENSE` — full Apache 2.0 text
- Every source file header (optional but professional — can skip for launch)
- `README.md` — update license badge and section

### README Rewrite

The new README structure, designed for three audiences:
1. **Engineering managers** (first 10 seconds): What is this? Why should I care?
2. **Developers** (next 60 seconds): How does it work? Can I run it?
3. **Contributors** (deeper dive): How do I contribute?

```markdown
<div align="center">

# WorkerMill

**The open-source operations layer for AI coding agents**

Orchestrate, monitor, and enforce quality for autonomous AI workers —
from ticket to deployed code.

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![CI](https://github.com/workermill/workermill/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/workermill/workermill/actions)

[Website](https://workermill.com) |
[Docs](https://workermill.com/docs) |
[Quick Start](#quick-start) |
[Contributing](#contributing)

</div>

---

## The Problem

Engineering teams are adopting AI coding agents (Claude Code, Copilot, Cursor, Devin),
but once you have agents writing code autonomously, you need answers to hard questions:

- **What are they doing?** — No visibility into agent actions across your team
- **Is the code any good?** — No quality enforcement before agents push to your repos
- **What's it costing?** — No cost tracking or budget controls
- **Who approved this?** — No audit trail for compliance

WorkerMill is the control plane that answers all four.

## What It Does

<!-- TODO: Screenshot of dashboard showing live terminal + code diffs + coordination messages -->

**Orchestration** — Decompose work into dependency-ordered stories, execute with parallel
AI experts in isolated git worktrees, coordinate via real-time messaging, consolidate into
a single PR.

**Quality Gates** — Two-stage enforcement: pre-commit gates run lint/test/build before
every commit. Post-push gates poll your CI provider (GitHub Actions, Bitbucket Pipelines)
and block on failure.

**Monitoring** — Real-time dashboard with streaming logs, live code diffs as agents write,
coordination messages between parallel experts, and error categorization.

**Cost Control** — Per-task and aggregate cost tracking, daily/weekly/monthly budget limits,
per-task cost ceilings, and automatic budget enforcement.

**Planning** — Single-agent planner with critic validation loop. Plans are scored
(threshold 85/100), decomposed into stories with file-per-step caps, and approved before
execution begins.

**Integrations** — Jira, GitHub Issues, Linear (issue sources). GitHub, GitLab, Bitbucket
(SCM + PRs). Slack (notifications). Webhooks in, webhooks out.

## Architecture

```text
┌─────────────────────────────────────────────────────────────────────┐
│                     VS Code Extension                               │
│         Sidebar tree, activity feed, live diff, log terminals       │
└─────────────────────┬───────────────────────────────────────────────┘
                      │ localhost (agent local API)
┌─────────────────────▼───────────────────────────────────────────────┐
│                     Remote Agent (standalone binary)                 │
│           Task polling, planning, worker spawning                   │
│           Native process or Docker sandbox                          │
└─────────────────────┬───────────────────────────────────────────────┘
                      │ REST / SSE
┌─────────────────────▼───────────────────────────────────────────────┐
│                     API Server (Express + TypeScript + TypeORM)      │
│     Orchestrator, coordination (Redis pub/sub), quality gates       │
│     Worker decision engine, billing, analytics, board execution     │
├─────────────────────┬───────────────────┬───────────────────────────┤
│   PostgreSQL (RDS)  │  Redis            │  S3 + CloudFront          │
└─────────────────────┴───────────────────┴───────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────────────┐
│                     Dashboard (React 19 + Vite + Tailwind)          │
│     Real-time monitoring, Kanban boards, live code viewer,          │
│     cost tracking, analytics, persona studio                        │
└─────────────────────────────────────────────────────────────────────┘
```text

### Execution Paths

| Path | Worker Runs As | Planning | Use Case |
|------|---------------|----------|----------|
| **Remote Agent** | Native process (binary self-invocation) | Yes | Production, VS Code |
| **Remote Agent + Sandbox** | Docker container | Yes | Production (sandboxed) |
| **Local Docker** | Docker container | No | Local development |
| **Cloud ECS** | ECS Fargate task | Yes | Managed cloud |

### Task Flow

```text
Issue (Jira/GitHub/Linear) ──→ API creates task
         or                          │
Dashboard / VS Code ─────────→ Agent claims task
                                     │
                              Planner decomposes → Critic validates (≥85/100)
                                     │
                              Coordinator spawns parallel experts (git worktrees)
                                     │
                              Pre-commit quality gates (lint, test, build)
                                     │
                              Push → Post-push CI verification
                                     │
                              Tech Lead review → DevOps deploy
                                     │
                              PR merged, ticket updated, costs recorded
```text

## Stack

| Component | Technology | Directory |
|-----------|------------|-----------|
| API | Express, TypeScript, TypeORM, PostgreSQL | `api/` |
| Frontend | React 19, Vite, TailwindCSS, Zustand | `frontend/` |
| Remote Agent | Standalone binary (Bun compile) | `agent/` |
| Worker | Multi-expert coordinator, Claude Code | `worker/` |
| VS Code Extension | VS Code Marketplace | `packages/vscode-workermill/` |
| Infrastructure | Terraform, AWS (ECS, RDS, ElastiCache, S3, CloudFront) | `infrastructure/` |

## Quick Start

### Option 1: Hosted (Fastest)

Sign up at [workermill.com](https://workermill.com) and install the remote agent:

```bash
curl -fsSL https://workermill.com/install.sh | bash
workermill-agent start
```text

### Option 2: Self-Hosted

```bash
# Clone the repo
git clone https://github.com/workermill/workermill.git
cd workermill

# Start local services (PostgreSQL, Redis)
./bin/local-workermill start

# API server (auto-reloads)
cd api && npm install && npm run dev

# Dashboard (auto-reloads)
cd frontend && npm install && npm run dev
```text

API runs on `localhost:3001`, dashboard on `localhost:5173`.

See [Local Development Guide](docs/claude/local-dev.md) for full setup.

### Option 3: VS Code Extension

Install [WorkerMill](https://marketplace.visualstudio.com/items?itemName=workermill.workermill)
from the VS Code Marketplace. Requires the remote agent running locally.

## AI Provider Support (BYOK)

Bring your own API keys — zero markup on token costs:

| Provider | Models | Mode |
|----------|--------|------|
| **Anthropic** | Claude Sonnet 4.6, Opus 4.6, Haiku 4.5 | Epic (parallel experts via Claude CLI) |
| **OpenAI** | GPT-4, GPT-4o | Multi-Expert (Vercel AI SDK) |
| **Google** | Gemini Pro, Gemini Flash | Multi-Expert (Vercel AI SDK) |
| **Ollama** | Any local model | Multi-Expert + codebase RAG embeddings |

## Features

### Orchestration
- PRD decomposition into dependency-ordered stories
- Parallel expert execution in isolated git worktrees
- Real-time coordination between experts (SSE + Redis pub/sub)
- Planning with critic validation loop (configurable threshold)
- Cascade-triggered board execution (card dependencies)

### Quality Enforcement
- Pre-commit gates: lint, test, build before every commit
- Post-push CI verification: polls GitHub Actions / Bitbucket Pipelines
- Auto-fix agent for quality gate failures (up to 5 retries)
- Deferred retry for persistent failures (park and resume later)

### Monitoring & Visibility
- Real-time log streaming (PostgreSQL + SSE)
- Live code viewer with syntax-highlighted diffs
- Coordination message feed between parallel experts
- Error categorization and jump-to-error
- Worker status tracking and heartbeat detection

### Cost & Budget
- Per-token cost tracking by model and provider
- Daily, weekly, monthly budget limits
- Per-task cost ceiling (auto-terminate on breach)
- Credit-based cloud compute billing ($3/hr)
- Cost breakdown analytics by persona and model

### Project Management
- Kanban boards with drag-and-drop
- Spec engineering with quality scoring
- 12 built-in worker personas with auto-inference
- Persona Studio for custom persona creation
- Skill Library (procedural memory from completed tasks)

### Enterprise
- Multi-org support with role-based access
- Audit logging
- CMEK (Customer-Managed Encryption Keys)
- Data residency controls
- SIEM integration (Splunk, Datadog, Sumo Logic)
- SSO support

### Integrations
- **Issue Trackers:** Jira, GitHub Issues, Linear
- **SCM:** GitHub, GitLab, Bitbucket
- **Notifications:** Slack, email (SES)
- **CI/CD:** GitHub Actions, Bitbucket Pipelines
- **Quality:** SonarQube, CodeRabbit, DeepSource

## Documentation

- **[User Docs](https://workermill.com/docs)** — Overview, quick start, integrations, task lifecycle
- **[Architecture](docs/claude/architecture.md)** — Models, routes, execution modes
- **[Local Dev](docs/claude/local-dev.md)** — Development environment setup
- **[Agent & VS Code](docs/claude/agent-and-vscode.md)** — Remote agent and extension
- **[Testing](docs/claude/testing.md)** — Vitest (API), Playwright (E2E)
- **[Infrastructure](docs/claude/infrastructure.md)** — Terraform, AWS

## Contributing

We welcome contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Setup

```bash
# Prerequisites: Node.js >= 20, Docker

# Start local services
./bin/local-workermill start

# Install dependencies
cd api && npm install
cd ../frontend && npm install

# Run API (with auto-reload)
cd api && npm run dev

# Run frontend (with HMR)
cd frontend && npm run dev

# Type checking
cd api && npm run typecheck
cd frontend && npx tsc -b
```text

### Running Tests

```bash
# API unit tests
cd api && npm run test

# API integration tests
cd api && npm run test:integration

# Frontend E2E tests
cd frontend && npm run test:e2e
```text

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.

---

Built by [Jarod Rosenthal](https://github.com/jarod-rosenthal).
```

---

## Part 4: New Files to Create

### CONTRIBUTING.md

```markdown
# Contributing to WorkerMill

Thank you for your interest in contributing to WorkerMill.

## How to Contribute

### Reporting Bugs
Open an issue with:
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node version, browser)

### Feature Requests
Open an issue describing the feature and its use case.

### Pull Requests
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run type checking (`cd api && npm run typecheck && cd ../frontend && npx tsc -b`)
5. Run tests (`cd api && npm run test`)
6. Commit with a clear message
7. Open a PR against `main`

### Development Setup
See the [Quick Start](#quick-start) section in README.md.

## Code Style
- TypeScript throughout (API, frontend, agent, worker)
- Prettier for formatting (runs automatically via hooks)
- ESLint for linting (`npm run lint` in api/ and frontend/)

## Architecture Overview
See [docs/claude/architecture.md](docs/claude/architecture.md) for the full architecture guide.

## Code of Conduct
Be respectful, constructive, and collaborative. We're building something together.
```

### CODE_OF_CONDUCT.md
Standard Contributor Covenant v2.1 (not included here for brevity — use the standard template).

### SECURITY.md

```markdown
# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it responsibly:

**Email:** security@workermill.com

Do NOT open a public GitHub issue for security vulnerabilities.

We will acknowledge receipt within 48 hours and provide a timeline for a fix.

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest on main | Yes |
| Previous releases | Best effort |

## Security Practices

- All secrets loaded from environment variables (never hardcoded)
- Cognito JWT authentication for API access
- API key authentication with bcrypt hashing for worker communication
- Rate limiting on all endpoints
- CORS configured for known origins
- Helmet security headers
- Input validation via express-validator
- Encrypted credential storage (TypeORM subscriber)
```

---

## Part 5: Launch Checklist

### Pre-Launch (Do Before Going Public)

- [ ] **Security scrub** — Run all H1-H5 replacements, verify with grep
- [ ] **Security scrub** — Run all M1-M7 replacements
- [ ] **License** — Replace MIT LICENSE file with Apache 2.0
- [ ] **README** — Replace current README.md with new version
- [ ] **New files** — Add CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md
- [ ] **CLAUDE.md** — Review for any remaining infrastructure references (AWS account ID in ECR registry reference on line 304)
- [ ] **Git history** — Verify no secrets in history (`git log --all -p | grep -c 'AWS_ACCOUNT_ID'` — if found in history, consider `git filter-repo` or accept the risk since the account ID isn't a secret per se)
- [ ] **GitHub repo settings** — Make `workermill/workermill` public (currently private)
- [ ] **GitHub topics** — Add: `ai-agents`, `devops`, `orchestration`, `ai-coding`, `quality-gates`, `multi-agent`, `llm`, `claude`, `typescript`
- [ ] **GitHub description** — "The open-source operations layer for AI coding agents — orchestration, monitoring, quality gates, and cost control"
- [ ] **GitHub website** — Set to `https://workermill.com`
- [ ] **Pin repo** — Pin WorkerMill on the workermill org profile

### Profile Updates (Can Do Anytime)

- [ ] **GitHub bio** — Update to professional version
- [ ] **GitHub fields** — Company, location, website, twitter, hireable
- [ ] **Profile README** — Create `jarod-rosenthal/jarod-rosenthal` repo with README.md
- [ ] **Archive old repos** — Archive all 5 existing public repos
- [ ] **Pin WorkerMill** — Pin on personal profile (once public)
- [ ] **X/Twitter bio** — Align with GitHub bio, link to workermill.com

### Post-Launch (First Week)

- [ ] **Announce on X/Twitter** — Thread: what it is, why open source, what's next
- [ ] **Post on LinkedIn** — Article or post about the journey and the problem being solved
- [ ] **Submit to Hacker News** — "Show HN: WorkerMill — open-source orchestration for AI coding agents"
- [ ] **Post on r/programming, r/devops, r/artificial** — Cross-post announcement
- [ ] **Dev.to article** — "I Built the Missing Operations Layer for AI Coding Agents"
- [ ] **Record demo video** — 2-3 minute walkthrough: ticket → dashboard → deployed code
- [ ] **Screenshot for README** — Capture dashboard with live terminal + code diffs + coordination

### Ongoing (First Month)

- [ ] **Write blog posts** — Lessons from building multi-agent orchestration, quality gates for AI code, cost of AI coding at scale
- [ ] **Engage with issues** — Respond quickly to early adopters
- [ ] **Tag a release** — v1.0.0 with proper release notes
- [ ] **Conference talk proposals** — Submit to DevOpsDays, AI Engineer Summit, local meetups
- [ ] **LinkedIn thought leadership** — Weekly posts about AI agent orchestration trends

---

## Part 6: Timeline

| When | What |
|------|------|
| **This week** | Profile updates (bio, fields, archive repos, profile README) — zero risk, do immediately |
| **Before launch** | Security scrub, license change, README rewrite, new files |
| **Launch day** | Make repo public, pin it, update GitHub topics/description |
| **Launch week** | Social media announcements, HN post, demo video |
| **Month 1** | Blog posts, community engagement, first release tag |
| **Month 2+** | Conference talks, thought leadership, iterate based on community feedback |

---

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Missed secret in codebase | Low (audit was thorough) | Run automated secret scanner (trufflehog/gitleaks) before launch |
| Competitor forks and outbuilds | Medium | First-mover advantage + hosted service + community + your expertise |
| Low initial engagement | High (normal for OSS) | Don't measure success by week 1 stars; focus on content marketing over months |
| AWS account targeted | Low (account ID isn't a credential) | Standard AWS security posture (MFA, least privilege, GuardDuty) |
| Self-hosting reduces SaaS revenue | Low | Setting up the full stack (PostgreSQL, Redis, ECS, Cognito) is nontrivial; most teams will prefer hosted |

---

## Success Metrics

**Career positioning (primary goal):**
- GitHub profile tells a coherent, professional story
- WorkerMill repo demonstrates architectural depth
- Content (posts, talks) establishes thought leadership
- Inbound recruiter interest for Head of AI / VP Eng roles

**Community traction (secondary):**
- 100+ GitHub stars in first month (stretch: 500+)
- 10+ issues/discussions from external users
- 1+ external contributor PR
- HN front page (stretch goal)

**Monetization optionality (tertiary):**
- workermill.com signups increase
- At least 1 paid team within 3 months of launch
- Cloud compute credits purchased by external user

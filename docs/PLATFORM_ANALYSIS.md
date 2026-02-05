# WorkerMill Platform Analysis

> Critical analysis of what WorkerMill solves, what's missing, and the path to widespread adoption.
> Generated February 2026 from a comprehensive codebase audit of 225K lines across 626 TypeScript source files.
> Updated to reflect the hybrid architecture: cloud-hosted intelligence + locally-running workers.

---

## Table of Contents

- [What WorkerMill Is](#what-workermill-is)
- [The Hybrid Architecture](#the-hybrid-architecture)
- [What It Solves Well](#what-it-solves-well)
- [What It Does NOT Solve](#what-it-does-not-solve)
- [Critical Codebase Problems](#critical-codebase-problems)
- [Business Model: Three-Tier Approach](#business-model-three-tier-approach)
- [What's Missing for Adoption](#whats-missing-for-adoption)
- [Competitive Landscape](#competitive-landscape)
- [Adoption Playbook](#adoption-playbook)
- [Infrastructure & Cost Summary](#infrastructure--cost-summary)
- [Codebase Statistics](#codebase-statistics)
- [Strategic Repositioning](#strategic-repositioning)

---

## What WorkerMill Is

WorkerMill ships production-grade software from a spec. Users describe what they want to build; WorkerMill's AI engineering team decomposes it into stories, dispatches parallel expert agents, validates quality, and delivers a production-ready PR with tests, CI/CD, and documentation.

**The architecture is hybrid by design:**
- **Cloud brain** (workermill.com) — Planning agent, Epic coordinator, coordination feed, blocker manager, quality gates, skill/memory system, dashboard
- **Local hands** (user's machine) — Lightweight CLI managing Claude Code CLI processes + git, with separate clones per story for parallel isolation. No Docker required.

The orchestration intelligence never leaves the server. The local CLI is a thin execution client that's useless without the cloud API. This protects IP while giving users full control over where their code is built.

**Core loop:** Description submitted on workermill.com → Planning Agent decomposes into stories → Epic Coordinator dispatches parallel expert agents → Experts run locally on user's machine (or cloud) → Coordination via shared feed → Quality gates validate output → Consolidated PR created → Optional tech lead review → Ship.

**Stack:** Express + TypeScript + TypeORM + PostgreSQL (API), React 19 + Vite + TailwindCSS + Zustand (Frontend), Claude Code CLI workers with separate-clone isolation (Local), ECS Fargate containers (Cloud), Terraform on AWS (Infrastructure).

---

## The Hybrid Architecture

This is the defining architectural decision for WorkerMill's go-to-market.

### Cloud Brain (workermill.com)

Everything that represents WorkerMill's intellectual property runs server-side:

| Component | What It Does | Why It's Server-Side |
|-----------|-------------|---------------------|
| **Planning Agent V3** | Decomposes descriptions into stories with persona assignment, dependency graphs, complexity scoring (4-12 scale), cost estimation | 3,289 lines of prompt engineering and orchestration logic — the core IP |
| **Epic Coordinator** | Parallel expert dispatch, mutex groups, request coalescing, story dependency enforcement | 2,600+ lines of coordination logic |
| **Coordination Feed** | Real-time message bus between experts (20+ message types) | Requires centralized state |
| **Blocker Manager** | Error classification, auto-retry, human escalation | Decision logic that improves over time |
| **Quality Gates** | Lint, types, tests, security scanning, external tool integration | Configurable per org |
| **Skill/Memory System** | Procedural memory extracted from successful executions, semantic search | Cross-task learning requires centralized storage |
| **Dashboard** | Real-time monitoring, log streaming, task management | User-facing control plane |
| **Billing/Usage** | Token tracking, cost ceilings, budget limits | Must be trusted/auditable |

### Local Hands (User's Machine)

The local worker is intentionally thin — a "pair of hands" that executes instructions from the cloud brain. **No Docker required.**

| Component | What It Does | How It's Installed |
|-----------|-------------|-------------------|
| **WorkerMill CLI** | Worker lifecycle, auth, workspace management | `npm install -g @workermill/cli` or binary download |
| **Claude Code CLI** | AI-powered code generation and editing | Auto-installed by WorkerMill CLI if missing |
| **Git** | Clone, branch, commit, push | User's existing installation |

**Parallel Story Isolation: Separate Clones (Not Worktrees)**

Each story gets a fully independent git clone — no shared `.git` directory, no shared state. This was chosen over git worktrees because worktrees share a `.git` index which causes corruption under concurrent git operations, especially on WSL.

```
~/.workermill/workspace/
├── cache/
│   └── repo.git          ← bare reference clone (one-time, shared read-only)
└── task-abc/
    ├── story-0/           ← git clone --reference cache/repo.git (independent)
    ├── story-1/           ← git clone --reference cache/repo.git (independent)
    ├── story-2/           ← git clone --reference cache/repo.git (independent)
    └── story-3/           ← git clone --reference cache/repo.git (independent)
```

Each clone is as independent as two developers on different laptops. `--reference` hardlinks git objects from the cache for near-instant cloning and minimal disk usage. This approach is how every CI system (GitHub Actions, GitLab CI, CircleCI) handles parallel job isolation.

### How They Talk

```
workermill.com                          User's Machine
┌────────────────┐                     ┌──────────────────────┐
│ Planning Agent  │──── prompt ──────▶│                        │
│ Epic Coord.     │──── stories ────▶│  WorkerMill CLI         │
│ Coord. Feed     │◀── logs ────────│  ├── Worker process 1   │
│ Blocker Mgr     │◀── status ──────│  │   └── story-0/ clone │
│ Quality Gates   │◀── artifacts ───│  ├── Worker process 2   │
│ Dashboard       │                    │  │   └── story-1/ clone │
│ Skill/Memory    │                    │  ├── Worker process 3   │
│                 │                    │  │   └── story-2/ clone │
│                 │                    │  └── Worker process 4   │
│                 │                    │      └── story-3/ clone │
└────────────────┘                     └──────────────────────┘
       ▲                                        │
       │          HTTPS (API calls)             │
       └────────────────────────────────────────┘
```

### IP Protection

| Layer | Protection |
|-------|-----------|
| **Planning prompts** | Assembled server-side — worker receives assembled prompt, not templates/rules |
| **Coordination logic** | Runs server-side — worker receives instructions, doesn't make orchestration decisions |
| **Skill/Memory embeddings** | Server-side vector store — worker receives relevant skills injected into prompts |
| **Quality gate configs** | Server-side evaluation — worker reports results, server decides pass/fail |
| **Plan validation** | Server-side — worker returns raw LLM output, server validates and transforms |
| **Local CLI / scripts** | Open by necessity but contains only execution scaffolding, not intelligence |

---

## What It Solves Well

### 1. Multi-Agent Orchestration (the hard problem)

The Epic Mode coordinator (`worker/epic/coordinator.ts`, 2,600+ lines) handles:
- **Parallel expert dispatch** with persona-to-story matching
- **Story dependency graphs** enforcing execution order
- **Mutex groups** preventing file conflicts between parallel experts
- **Request coalescing** (Singleflight pattern) to prevent API overload
- **Blocker escalation** with auto-retry for fixable errors (typescript, lint, test, build) and human escalation for unfixable ones (auth, network, resource)
- **Question routing** between experts (e.g., backend asks security about auth approach)
- **Inline tech lead review** with selective story revision loops
- **Consolidated PR creation** merging all story branches

This is genuinely sophisticated orchestration that no off-the-shelf tool provides. The coordination feed system (`WorkerContext` with 20+ message types) enables real-time collaboration between agents that mirrors how human development teams communicate.

### 2. Multi-Everything Integration

| Dimension | Supported Providers |
|-----------|-------------------|
| **AI Models** | Anthropic (Claude), OpenAI (GPT/Codex/o1), Google (Gemini), Ollama (self-hosted) |
| **Source Control** | GitHub, GitLab, Bitbucket |
| **Issue Trackers** | Jira, Linear, GitHub Issues |
| **Deployment** | ECS, S3+CloudFront, custom via execution scripts |

Each integration is fully wired with webhook receivers, credential management, and provider-specific auth. This is a real competitive moat — most competitors are GitHub-only or Claude-only.

### 3. Human-in-the-Loop Done Right

The blocker system is one of the most thoughtful implementations in the codebase:

1. Story execution fails → Error classified by category
2. If fixable (typescript, lint, test, build): Auto-retry up to N times
3. If retries exhausted or error unfixable: Escalate with human-readable summary
4. Dashboard shows `BlockerAlert` with context (error, affected files, suggested action)
5. User clicks Retry/Skip/Abort → Resolution flows back to worker
6. Worker receives resolution and continues accordingly

Additionally, the "Talk to Worker" feature allows mid-execution feedback:
- User sends message from task card → Worker polls for pending commands
- Worker acknowledges and applies feedback to next story execution
- All communication tracked in coordination feed

### 4. Cost Controls & Quality Gates (AI FinOps)

**Cost controls:**
- Per-task cost ceilings
- Daily/weekly/monthly budget limits per organization
- Real-time token usage tracking per phase (planning, execution, review)
- Overage billing with configurable rates per plan tier
- Fargate Spot instances for 80% compute savings (cloud mode)

**Quality gates:**
- Lint error thresholds
- TypeScript type checking
- Test pass/fail requirements
- Security vulnerability scanning (high/medium/low)
- Minimum quality score thresholds
- External tool integration (SonarQube, CodeRabbit, DeepSource)
- Quality gate bypass label for emergency deployments

### 5. Hybrid Execution: Local Mode + Cloud Mode

The hybrid architecture gives users a choice of where workers run:

| Aspect | Cloud Mode | Local Mode |
|--------|-----------|-----------|
| **Workers run** | ECS Fargate containers (AWS) | Native processes on user's machine (no Docker) |
| **AI auth** | Anthropic API key (pay-per-token) | User's Claude Max subscription ($0 marginal cost) |
| **Code stays** | In AWS infrastructure | On user's machine — never leaves |
| **Story isolation** | Container per task with git worktrees | Separate git clones per story (independent repos) |
| **Execution** | Sequential (dependency-ordered, one story at a time) | Sequential (same — reliable, simple, stable) |
| **Cost to WorkerMill** | Compute + LLM tokens | $0 (user provides compute + AI) |
| **Cost to user** | Credits/subscription | Claude Max ($100/mo, already paid) |
| **Orchestration** | workermill.com (same) | workermill.com (same) |
| **Install** | N/A (cloud-managed) | `npx workermill` (auto-bootstraps everything) |

This is a genuine competitive advantage. No other AI coding platform offers "bring your own compute + your existing AI subscription" with zero Docker dependency.

### 6. Learning & Memory System

**Procedural memory:** Skills automatically extracted from successful task executions, stored with embeddings for semantic search, and injected into future planning agent prompts.

**Episodic memory:** Task histories with outcomes, enabling the system to learn from past successes and failures.

**Skill Library dashboard:** Analytics on skill usage, effectiveness rates, most/least used approaches, with per-persona filtering.

---

## What It Does NOT Solve

### 1. It Doesn't Make AI Agents Smarter

WorkerMill orchestrates Claude/GPT/Gemini but doesn't improve their code generation quality. If Claude writes bad code, WorkerMill catches it at the quality gate but can't fix the fundamental capability gap. The skill/memory system is a start (retrospective learning), but it's not proactive enhancement — there's no code graph, no architectural model, no dependency analysis feeding into the planning agent.

### 2. It Doesn't Solve the "Last Mile" Problem

PRs still need human review. The auto-deploy label exists but most teams won't trust it. The value is "PR created faster" not "code shipped autonomously." This means the bottleneck shifts from *writing* code to *reviewing* AI-generated code, which may not be faster for complex changes.

### 3. Codebase Understanding at Scale

The RAG/indexing feature exists in settings but appears nascent. Large codebases with complex architectural patterns, implicit conventions, and tribal knowledge remain hard for AI workers to navigate. There's no:
- Code dependency graph
- Architectural pattern detection
- Convention inference from existing code
- Cross-file impact analysis

### 4. Multi-Repo Atomic Transactions

Cross-repo tickets (e.g., API + frontend) create separate PRs per repo. There's no atomic "both PRs pass or neither merges" capability. No cross-repo integration testing.

### 5. Non-Coding Development Work

The platform focuses on code generation but doesn't address:
- Design system compliance verification
- Database migration safety analysis
- Performance regression detection
- Accessibility audit automation
- API contract validation between services

---

## Critical Codebase Problems

### Test Coverage is Critically Low

**7 API test files and 5 E2E specs for 225,000 lines of code.**

| Area | Lines of Code | Test Files | Coverage |
|------|--------------|------------|----------|
| Orchestrator service | 6,006 | 0 unit tests | None |
| Billing service | ~1,000 | 0 tests | None |
| Webhook handlers | ~2,900 | 1 (Jira only) | Minimal |
| Coordination system | ~1,300 | 0 tests | None |
| Blocker manager | ~500 | 0 tests | None |
| Error classifier | ~300 | 0 tests | None |
| Settings routes | ~3,500 | 0 tests | None |

This is a production SaaS handling customer code and billing with essentially no safety net.

### God Components

| File | Lines | Problem |
|------|-------|---------|
| `frontend/src/pages/Settings.tsx` | 8,021 | Single React component managing 10+ settings sections |
| `frontend/src/pages/Dashboard.tsx` | 5,059 | Single component for entire control center |
| `api/src/services/orchestrator.ts` | 6,006 | Task claiming, scheduling, lifecycle, ECS spawning all in one |
| `api/src/routes/settings.ts` | ~3,500 | All org configuration in one route file |
| `api/src/routes/webhooks.ts` | ~2,900 | All webhook providers in one file |

These are unmaintainable at scale. A bug in Settings requires understanding 8K lines of context. Refactoring is high-risk without tests.

### No Development Environment

The dev environment is explicitly marked as **"NOT RUNNING"** in CLAUDE.md. All deployments go directly to production. This means:
- No safe place to test database migrations
- No staging for webhook integration testing
- No environment for load testing
- Every deploy is a production deploy

### Bus Factor of 1

- 6 "DO NOT CHANGE" sacred patterns that only the original developer understands
- Working directly on `main` with no PR review process for the platform itself
- No code review workflow for WorkerMill development
- Extensive CLAUDE.md with tribal knowledge that isn't enforced by code

### Monolithic API Architecture

Routes, services, orchestrator, billing, webhooks, and coordination all share one Express app and one database. The orchestrator polls the database on a loop to claim tasks, check quotas, spawn ECS containers, and manage lifecycle. This works at current scale but won't scale to multi-region or high throughput without significant restructuring.

---

## Business Model: Three-Tier Approach

The hybrid architecture unlocks a business model that solves the cold-start problem (no revenue yet, can't subsidize free users) while building toward sustainable revenue.

### Critical Technical Constraint (Validated)

**Claude Max OAuth tokens cannot be used with the Anthropic Messages API.** The `@anthropic-ai/sdk` only accepts API keys, not OAuth tokens. OAuth tokens only work with Claude CLI (`claude --print`), which is a subprocess that handles its own authentication.

This means the server cannot simply call `new Anthropic({ apiKey: userOAuthToken })` for planning. Instead, the architecture splits planning into two steps:

1. **Server assembles the planning prompt** — using templates, stack constraints, org settings, skill/memory (this is the IP)
2. **User's local worker executes the LLM call** — Claude CLI + user's OAuth token on their machine (this costs WorkerMill $0)

The server sends the assembled prompt to the worker, the worker runs it through Claude CLI, and returns the raw output. The server then validates, scores, and resolves dependencies. The intelligence (what to ask, how to validate) stays server-side. The compute (running the LLM) stays user-side.

### Tier 1: Free Plan Preview (~$0.03/preview)

Users can describe what they want to build and see a lightweight plan preview — story count, complexity score, cost estimate — without installing anything.

| What Users Get | What It Costs WorkerMill |
|----------------|------------------------|
| Lightweight plan preview (story count, complexity, cost) | ~$0.03 per preview (Haiku on WorkerMill's API key) |
| Complexity score (4-12 scale) | Included in Haiku call |
| Cost and time estimates | Included in Haiku call |

**Purpose:** Acquisition hook. Works in the browser before the user installs anything. Rate-limited to 5/day on free tier. At 1,000 previews/day this costs $30/day — if you hit 10,000/day you have a scaling problem worth celebrating.

**Why Haiku is safe:** Plan preview uses a lightweight Haiku call (~$0.03) for an approximate breakdown. The full detailed planning with Sonnet/Opus happens during execution (on the user's machine). WorkerMill never pays for expensive model calls.

### Tier 2: Local Mode ($0 to WorkerMill)

Users execute full builds using their own machine and their own Claude Max subscription. **All LLM calls happen locally through Claude CLI.**

| Step | Who Pays for LLM | Who Pays for Compute | Cost to WorkerMill |
|------|-------------------|---------------------|-------------------|
| Full planning (prompt assembly → worker → validate) | User (Claude Max) | User (their machine) | ~$0 |
| Story execution (parallel experts) | User (Claude Max) | User (their machine) | $0 |
| Orchestration (coordination, quality gates, dashboard) | N/A (no LLM calls) | WorkerMill (API server) | Marginal |

**How it works technically:**
1. Server assembles planning prompt using templates, stack config, org settings, skill/memory context
2. Server sends assembled prompt to user's local worker container
3. Worker runs `claude --print --model <model> <prompt>` with user's OAuth token
4. Worker returns raw LLM output to server
5. Server validates plan, scores complexity, resolves dependencies
6. Server dispatches stories → worker executes each via Claude CLI locally

**Purpose:** Acquisition channel. The pitch: *"You're already paying $100/month for Claude Max. WorkerMill turns it into a parallel AI engineering team."*

### Tier 3: Cloud Mode (Revenue)

Users who want hands-off execution or don't have Claude Max use WorkerMill's cloud infrastructure.

| What Users Get | What It Costs WorkerMill |
|----------------|------------------------|
| Everything in Local Mode | - |
| Managed compute (no Docker needed) | ECS Fargate cost |
| No Claude Max subscription required | LLM API token cost |
| Higher concurrency limits | - |

**Revenue models:**
- **BYOK (Bring Your Own Key):** User provides their own Anthropic API key (not OAuth token — actual API key), WorkerMill uses it server-side for planning + execution. User pays for orchestration subscription.
- **Credits:** Pre-purchased token credits at markup
- **Subscription:** Monthly plans with included usage

### The Growth Funnel

```
Free Plan Preview ──▶ Local Mode ──▶ Paid Local ──▶ Cloud Mode
   (acquisition)       (activation)    (retention)     (revenue)

~$0.03/preview        $0/execution    $29/mo           $99/mo+
See the value         Experience it    Unlock limits    Hands-off
Browser only          CLI + Docker     + features       + scale
```

### Why This Works Financially

| User Volume | Plan Preview Cost | Local Mode Cost | Revenue |
|------------|-------------------|-----------------|---------|
| 100 users, 5 previews/day | $15/day | ~$0 | Subscriptions |
| 1,000 users, 5 previews/day | $150/day | ~$0 | Subscriptions |
| 10,000 users | Rate-limit free tier, paid preview | ~$0 | Subscriptions + cloud |

The expensive LLM calls (Sonnet/Opus for detailed planning and execution) always happen on the user's machine in local mode. WorkerMill only pays for Haiku previews (~$0.03 each) and API server costs.

---

## What's Missing for Adoption

### 1. CLI Packaging & Distribution (Critical — Blocks Everything)

The local mode exists but requires manual Docker/Node setup. Users need:
- `npx workermill` — one-command install + start (auto-bootstraps Claude CLI, authenticates, connects)
- No Docker required — native processes with separate git clones for story isolation
- Binary distribution via `brew install workermill` and `curl | sh` for non-Node users

Without this, local mode is a developer tool, not a product.

### 2. Zero-Friction Build Page (Critical)

**Current state:** Getting value requires creating an account, connecting a Jira/Linear instance, connecting a Git provider with tokens, setting up AI provider API keys, and having an actual ticket to test with.

**What's needed:** A `/build` page on workermill.com where users describe what they want, see a plan instantly, then choose how to execute (local or cloud). No Jira, no webhooks, no configuration.

### 3. Starter Projects (Critical)

Curated example projects as the default first experience. These serve as:
- **Proof:** "Here's a SaaS dashboard WorkerMill built from a 3-paragraph description"
- **Templates:** Users can fork and customize rather than starting from scratch
- **Quality bar:** Only projects that showcase WorkerMill's value get featured
- **Natural gating:** The complexity scorer prevents trivial tasks from being the first impression

### 4. GitHub App (High Priority)

One-click install from GitHub Marketplace:
- React to issue labels automatically
- Comment on issues with plan preview and cost estimate
- Open PRs natively
- Marketplace listing for organic discovery

### 5. Slack/Teams Integration (High Priority)

Most development teams live in Slack. Notifications for task progress, blocker alerts, and PR links in-channel would dramatically increase visibility and adoption within teams.

### 6. Published Quality Benchmarks

No published data on PR merge rates, cost per PR, quality comparison across models, or task success rates. The analytics page tracks this internally — publishing anonymized benchmarks would build credibility.

### 7. REST API Documentation & SDK

No REST API docs, no TypeScript/Python SDK, no webhook-out. Teams can't build custom workflows without reverse-engineering the API.

### 8. Open-Source Worker Core (Strategic)

The worker directives and execution scripts could be open-sourced to build community trust. The orchestration intelligence (the actual IP) stays server-side regardless.

---

## Competitive Landscape

The market in 2026 includes: Devin, Cursor Agent Mode, GitHub Copilot Coding Agent, OpenAI Codex, Augment Code, Factory AI, Codeium Windsurf, and others.

### WorkerMill's Differentiation

| Competitor | Where WorkerMill Wins |
|---|---|
| **Devin** | Local mode (use your own compute + Claude Max), multi-provider (not locked to one LLM), multi-SCM, transparent pricing, parallel experts |
| **GitHub Copilot Agents** | Works with Jira/Linear (not just GitHub Issues), Bitbucket/GitLab support, multiple AI providers, quality gates, local execution |
| **Cursor Agent Mode** | Asynchronous background execution, parallel workers, no IDE required, team dashboard, cost controls, local + cloud hybrid |
| **OpenAI Codex** | Multi-provider (not locked to OpenAI), local mode with any AI subscription, epic decomposition with parallel experts |
| **Factory AI** | Open architecture (bring your own LLM), local mode option, customizable personas, user controls where code is built |

### Where Competitors Win

| Competitor | Where They Beat WorkerMill |
|---|---|
| **Devin** | Brand recognition, VC backing, polished UX, autonomous web browsing |
| **GitHub Copilot Agents** | Zero-friction for GitHub users, massive distribution, Microsoft backing |
| **Cursor** | Real-time developer experience, IDE integration, conversation context |
| **Codex** | OpenAI's model ecosystem, sandboxed execution environment |

### The Local Mode Differentiator

No competitor offers what local mode provides:

1. **Code never leaves your machine** — enterprises and security-conscious teams care deeply about this
2. **Use your existing AI subscription** — Claude Max users get a parallel AI engineering team at $0 marginal cost
3. **Cloud intelligence, local execution** — best of both worlds (smart orchestration + data sovereignty)
4. **No vendor lock-in on compute** — switch between local and cloud freely

This is WorkerMill's unique wedge. Devin, Copilot Agents, and Codex all require sending code to their cloud. WorkerMill doesn't.

### Strategic Implication

WorkerMill's moat is **orchestration depth + hybrid execution + multi-provider flexibility + enterprise controls**. The weakness is **distribution and first-use friction**. The CLI package and `/build` page are the highest-leverage fixes.

---

## Adoption Playbook

### Phase 0: Hybrid Foundation (Weeks 1-2)

- [ ] Build `@workermill/cli` npm package (login, start, stop, status)
- [ ] Publish `workermill/worker` Docker image to Docker Hub
- [ ] Implement execution gate: local mode vs BYOK vs cloud mode
- [ ] One-command local setup: `npm i -g @workermill/cli && workermill login && workermill start`

### Phase 1: Build Page & Starter Projects (Weeks 2-4)

- [ ] Create `/build` page on workermill.com (describe → plan → choose execution mode → build)
- [ ] Build 5+ starter project templates (SaaS Dashboard, REST API, E-commerce, etc.)
- [ ] Plain language throughout: "Describe what you want to build" (never "PRD")
- [ ] Free plan preview powered by Haiku (~$0.03/plan)
- [ ] Execution mode selector: Local (Claude Max) / BYOK (your API key) / Cloud (credits)

### Phase 2: Landing Page & Messaging (Weeks 4-5)

- [ ] Rewrite landing page: "Ship production-grade software from a spec"
- [ ] Showcase gallery with real projects built by WorkerMill
- [ ] Public task viewer showing how showcase projects were built
- [ ] Quick Start docs rewritten for the new flow

### Phase 3: Distribution (Weeks 5-10)

- [ ] GitHub App for one-click marketplace installation
- [ ] Slack integration for task notifications and blocker alerts
- [ ] REST API docs (OpenAPI 3.1) + TypeScript SDK
- [ ] Published quality benchmarks with real anonymized data

### Phase 4: Ecosystem (Weeks 10+)

- [ ] Open-source worker directives and execution scripts
- [ ] Plugin system for custom personas and quality gates
- [ ] Cross-org skill sharing (anonymized)
- [ ] Enterprise features: SAML SSO, audit logs, VPC deployment

---

## Infrastructure & Cost Summary

### AWS Resources (Production)

| Resource | Configuration | Monthly Cost |
|----------|--------------|-------------|
| ECS API Service | Fargate, 1 vCPU | ~$20-30 |
| ECS Worker Tasks | Fargate Spot, on-demand (cloud mode only) | ~$10-50 (varies) |
| RDS PostgreSQL | db.t4g.micro, single-AZ, 20GB gp3 | ~$30-35 |
| CloudFront CDN | Standard distribution | ~$5-10 |
| Secrets Manager | ~25 secrets | ~$10 |
| CloudWatch Logs | 14-day retention | ~$2-5 |
| Cognito | MAU-based | ~$2-10 |
| Route53 + ACM | 1 hosted zone | ~$1 |
| Bastion Host | t4g.nano Spot, on-demand | ~$0-2 |
| **Total (excl. LLM costs)** | | **~$100-200/month** |

### Cost Per Execution Mode (Validated)

| Mode | LLM Cost to WorkerMill | Compute Cost to WorkerMill | Cost to User |
|------|----------------------|--------------------------|-------------|
| **Free plan preview** | ~$0.03 (Haiku) | Marginal (API server) | $0 |
| **Full planning (local)** | $0 (user's Claude CLI) | Marginal (prompt assembly) | $0 (Claude Max) |
| **Story execution (local)** | $0 (user's Claude CLI) | Marginal (coordination API) | $0 (Claude Max) |
| **BYOK cloud** | $0 (user's API key) | ~$5-15 (ECS Fargate) | API key + subscription |
| **Full cloud** | LLM token costs | ~$5-15 (ECS Fargate) | Credits/subscription |

**Key insight:** In local mode, ALL LLM calls (planning + execution) run through Claude CLI on the user's machine using their OAuth token. The Anthropic Messages API does not accept OAuth tokens, so Claude CLI subprocess is the required path. This is already implemented in `planning-agent-local.ts`.

### Cost Optimization Applied

1. **Fargate Spot** for all cloud workers (80% savings)
2. **Single-AZ RDS** (no multi-AZ HA overhead)
3. **Container Insights disabled** (monitoring cost savings)
4. **Bastion auto-shutdown** (pay only when developing locally)
5. **Ephemeral test runners** (no always-on CI infrastructure)
6. **ARM instances** (t4g: cheaper than x86 equivalents)
7. **gp3 storage** (cheaper than gp2)
8. **Local mode as default** (shifts compute cost to users)

---

## Codebase Statistics

| Metric | Value |
|--------|-------|
| Total TypeScript files | 626 |
| Total lines of code | 224,674 |
| API routes + services | ~84,713 lines |
| Largest component | Settings.tsx (8,021 lines) |
| Largest service | orchestrator.ts (6,006 lines) |
| API test files | 7 |
| E2E test files | 5 |
| Terraform modules | 15+ |
| Database models | 40 TypeORM entities |
| API endpoints | 100+ across 30 route files |
| Worker personas | 14 (backend, frontend, security, QA, devops, etc.) |
| Webhook providers | 6 (Jira, GitHub, GitLab, Bitbucket, Linear, GitHub PR) |
| Documentation pages | 17 |

---

## Strategic Repositioning

### The Core Insight

WorkerMill's current positioning ("mission control for autonomous AI coding agents" / "htop for AI workers") is abstract, technical, and assumes users already want AI agents. The repositioning targets a concrete, measurable outcome: **describe what you want, get a production-grade codebase with tests, CI/CD, and documentation.**

### Why "MVP/Product Builder" Is the Right Wedge

**1. It eliminates the cold-start problem.** The current pitch requires: existing codebase + Jira project + SCM tokens + AI keys + webhook configuration. The new pitch requires: "describe what you want." That's the difference between a 45-minute setup and a 45-second one.

**2. MVPs are the perfect task for AI agents.** Greenfield code is where LLMs shine — no legacy constraints, no implicit conventions to violate, no existing architecture to misunderstand. Success rate on greenfield will be dramatically higher than on mature codebases.

**3. The Epic Mode architecture was built for this.** Task decomposition into stories, parallel expert execution across personas (backend + frontend + devops + QA), quality gates, consolidated PR — this is literally what building an MVP from a spec looks like.

**4. It's a provable value proposition.** "Describe what you want, get a production-ready codebase in 2 hours" is measurable, demonstrable, and shareable.

### The Growth Path

| Phase | Positioning | User | Revenue Model |
|-------|------------|------|---------------|
| **Land** | "Build production-grade MVPs from a description" | Solo founders, indie hackers, hackathon teams | Free plan preview → local mode |
| **Expand** | "Keep building on what we scaffolded" | Same users, now with a real product | Local mode → BYOK/cloud |
| **Scale** | "Your AI engineering team" | Growing startups, enterprise teams | Cloud credits + team subscriptions |

### The Messaging Shift

**Before (current):** "Mission control for autonomous AI coding agents"
- Problem: Abstract, technical, assumes you already want AI agents

**After (repositioned):** "Ship production-grade software from a spec"
- Subline: "Describe what you want. Our AI engineering team builds it with tests, CI/CD, and documentation. Run locally with your Claude Max subscription, or let us handle it."
- Clarity: Concrete, outcome-oriented, self-explanatory

### What You're Really Selling

Not an AI agent orchestrator. **The output of a competent engineering team, on demand, at a fraction of the cost.**

The comparison isn't WorkerMill vs Cursor or WorkerMill vs Devin. It's WorkerMill vs hiring a contractor or WorkerMill vs spending a weekend hacking. And on that comparison, the value proposition is clear: consistent quality, parallel execution, built-in review, and it works while you sleep.

### "Professional Standards" as the Differentiator

Most AI code generators produce demo-quality code. WorkerMill's quality gates, security scanning, test requirements, and tech lead review mean output is actually deployable. The positioning becomes: **"Other tools generate code. WorkerMill ships products."**

### Local Mode as the Killer Acquisition Channel

The pitch to Claude Max subscribers ($100/month): *"You're already paying for unlimited Claude. WorkerMill turns it into a parallel AI engineering team that builds production-grade software while you sleep. No extra cost."*

This is a zero-risk proposition for the user and a zero-cost acquisition channel for WorkerMill. Once users experience the orchestration value through local mode, upgrading to cloud mode for convenience and scale is a natural progression.

---

## Detailed Implementation Plan

See [docs/IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) for the full phased implementation plan to execute this strategy.

# Changelog

All notable changes to the WorkerMill platform are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Component releases are tracked via git tags:
`git tag -l 'agent-v*'`, `git tag -l 'vscode-v*'`.

---

## [Unreleased]

### Added
- CLI: Test suite — 227 tests across engine and CLI (Vitest 4.1, ~52% CLI line coverage, ~73% engine line coverage)
  - Engine: 113 unit tests covering decisions, model-factory, and all 14 tools
  - CLI: 110 unit tests covering safety, config, memory, session, git-ops, permissions, commands, cost-tracker, orchestrator
  - E2E: 4 tests with real Ollama (single-agent bug fix, glob, read_file, full /ship workflow)
  - WSL-aware Ollama host auto-detection for E2E tests
- CLI: `/ship` command replaces `/build` — multi-expert orchestration (`/build` kept as alias)
- CLI: Architect-led planner — reads codebase deeply, produces `targetFiles`, `referenceFiles`, and `implementationNotes` per story so workers follow existing patterns
- CLI: Planner feasibility gate — rejects tasks that are too vague or contradictory before worker tokens are spent
- CLI: Git branch management ported from WorkerMill platform — feature branch per `/ship`, commits per story, revision delta tracking
- CLI: Completion flow — branch summary, commit count, push & PR creation with task spec + story breakdown + tech lead review in the PR body
- CLI: Reviewer sees revision delta — only what changed since last review, not the full diff again
- CLI: Per-story prior work capture — revision workers see their own previous commits via git log
- CLI: `verify` tool — runs test/build commands, returns structured pass/fail
- CLI: Structured bash output parsing — extracts test results, build errors, service health
- CLI: Docker auto-cleanup — tracks `docker compose up` per story, runs `docker compose down` after completion
- CLI: `.md` file autocomplete after `/ship` command
- CLI: LM Studio provider support + Ollama context window picker in setup wizard
- CLI: Claude Haiku 4.5 added to Anthropic model picker
- CLI: Error classification engine — categorizes failures with targeted fix hints for retry
- CLI: Color-coded model names by role (planner: cyan, workers: yellow, reviewer: magenta)
- CLI: Confirm prompts show typed key before proceeding
- CLI: Setup wizard explains each role and why model choice matters
- CLI: Cost shown as estimate (~$0.12) not exact billing
- CLI: `/retry` command shown in welcome screen
- CLI: Homebrew formula (`brew install workermill`)
- Homepage: dedicated Planner, Reviewer, and Workers documentation sections

### Fixed
- Engine: `EngineAIClient` silently dropped all tool calls — AI SDK v6 renamed `args` to `input` in `onStepFinish` callback; guard check `"args" in tc` always failed
- Engine: `EngineAIClient` missing `contextLength` passthrough — Ollama models ran with default context instead of configured value
- CLI: Reviewer works from the plan (same source of truth as workers), not the raw spec
- CLI: Approval threshold configurable via `/settings review.threshold` (1-10 scale, default 8)
- CLI: Reviewer prompt rewritten for fairness — "be fair" not "bias toward approval"
- CLI: Revision prompt ported from WorkerMill platform — per-story feedback, "What You Did Last Time" from git history, scope enforcement
- CLI: Revision reviews send only the delta — prevents context window overflow on later rounds
- CLI: Revision reviewer breaks deadlocks — persistent issues accepted as best effort
- CLI: Planner failure stops workflow — no more silent fallback to a single story
- CLI: `/setup` clears config and stays in app — user restarts to re-run setup
- CLI: Feature branch named from task description (workermill/scheduled-rollouts) not timestamps
- CLI: edit_file shows actual file content at match location on failure — helps models correct their next attempt
- CLI: Codex models routed to OpenAI Responses API; other models use Chat Completions
- CLI: Google TTS/audio-only models filtered from setup wizard
- CLI: `gofmt -d .` not `gofmt -d ./...` in reviewer instructions
- CLI: Ollama `keepAlive: "-1"` prevents model unload during long tool calls
- CLI: Text repetition detection with fuzzy matching + abort at 10 repeats
- CLI: Worker summary output suppressed after tool calls complete
- CLI: ESC cancel checks at every phase boundary including planner
- CLI: `rm -rf` on relative project paths no longer triggers dangerous command warning
- CLI: Planner minimizes stories — one persona = one story, aims for 5 or fewer
- CLI: All logging goes to cli.log — tool results, tool errors, model output, reviewer output

### Removed
- CLI: Auto-detected quality gates (tsc/lint) — caused cascading failures; workers self-verify
- CLI: Invented agents (inline verifier, integration fixer, review fixer, critic)
- CLI: `::learning::` marker instructions from all personas
- CLI: `sub_agent` tool from planner and reviewer
- CLI: All `totalMs` wall-clock timeouts on AI operations
- CLI: All content truncation

---

## 2026-03-22 — WorkerMill CLI (v0.1.0–v0.8.x)

The open-source CLI — standalone multi-expert orchestration via `npx workermill`.

### Added
- Interactive setup wizard with auto-detected Ollama and multi-provider config
- `/build` slash command — planner + expert personas + tech lead review
- `/config` for runtime provider and model changes
- 13 tools: `read_file`, `write_file`, `edit_file`, `glob`, `grep`, `ls`, `bash`, `sub_agent`, `todo`, `web_search`, `web_fetch`, `image`, `think`
- 13 expert personas matching cloud worker roles
- Topological dependency sorting for story execution order
- Inline Tech Lead review with configurable quality threshold
- Cost tracking with per-model pricing across all providers
- ESC key cancels build in progress
- Selective revision — only re-run affected stories on failure
- Provider support: Anthropic, OpenAI, Google, Ollama (local models)
- Published to npm as `workermill`

---

## 2026-03-18 — GitHub Issues & Bitbucket Integration

### Added
- GitHub Issues as a first-class issue tracker (create parent/child issues from PRDs)
- Bitbucket REST API auth unification
- Linear status sync support
- VS Code: Local Development onboarding flow and Get Started walkthrough

### Changed
- Standalone mode removed entirely — self-hosted uses cloud codebase directly

---

## 2026-03-16 — AI SDK Migration

### Added
- Unified AIClient factory replaces all Claude CLI subprocess spawns
- Direct `generateText()` / `streamText()` calls via Vercel AI SDK
- Multi-provider parity for Epic mode (Anthropic, OpenAI, Google)

### Changed
- Workers use AI SDK directly instead of shelling out to Claude CLI binary
- Feature flag removed — unified AIClient enabled by default

---

## 2026-03-12 — Quality Gates & Multi-Language Support

### Added
- Board-level quality gate commands (lint, typecheck, test, e2e)
- `blockOnE2EFailures` setting — block PR approval on e2e test failures
- Language-aware quality fix agent (Python, Go, Rust, Java)
- Service log capture in integration fixer for debugging
- Sandbox environment verification scripts for Windows

### Fixed
- Infinite fix loop when typecheck tool unavailable
- Python project support: auto-install `uv` and dependencies before gates
- Gate commands use `bash` instead of `sh` (POSIX compatibility)

---

## 2026-03-08 — VS Code Live Diff (v0.2.80+)

### Added
- Sticky live diff — real-time code change visualization during task execution
- File-level diff navigation with syntax highlighting
- Start/stop task controls from VS Code
- Error diagnostics in live diff manager

---

## 2026-03-04 — Self-Hosted Docker Compose

### Added
- Embedded `docker-compose.yml` generation for self-hosted deployments
- Automatic seed defaults for new installations
- SES email configuration for self-hosted auth flows

### Changed
- Self-hosted mode uses identical code paths as cloud — no feature forks

---

## 2026-02-27 — Agent Standalone Mode

### Added
- `workermill-agent init --standalone` for local-only operation
- `run` and `prd` CLI commands for the agent binary
- Specs API client and Zustand store for frontend

---

## 2026-02-24 — Cloud Billing & Language Profiles

### Added
- Cloud compute billing model ($3/hr, per-minute granularity)
- Language profiles for multi-language quality verification
- Persona Studio with seeded execution scripts
- VS Code: error messages in task detail panel
- Syntax-highlighted diffs in live code view (dashboard + VS Code)

### Fixed
- PgBouncer sidecar compatibility (SSL, credential parsing, connection options)
- Unique RedisStore per rate limiter (prevent cross-contamination)
- Worker EBUSY on Windows temp dir cleanup
- Dashboard task disappearance on concurrent SSE updates

---

## 2026-02-21 — Terms of Service & VS Code CI/CD

### Added
- Server-side TOS enforcement with versioned re-acceptance
- VS Code extension CI/CD pipeline (GitHub Actions)
- One-click issue creation from VS Code

### Changed
- Landing page "Get Started" → "Join the Waitlist"

---

## 2026-02-18 — PRD Decomposition from VS Code

### Added
- PRD decomposition via local Claude CLI with SSE streaming
- Dual auth support (API key + OAuth) for VS Code extension
- Image handling in worker prompts (base64 screenshots)
- OnCallShift: waitlist system and product page consolidation

### Fixed
- Git and Claude CLI detection on Windows via registry + known paths
- OAuth token refresh in Docker sandbox

---

## 2026-02-16 — Agent Binary & VS Code Extension

### Added
- **Standalone agent binary** — `tsc` → `esbuild` (5 bundles) → `bun compile`
- Agent local API (HTTP + SSE on localhost)
- **VS Code extension** — Jira backlog, curated logs, live code changes panel
- Simplified planning mode (org-level setting)

### Fixed
- Bracket-matching JSON parsers replace fragile regex across all parsers
- CLAUDECODE env var stripped to prevent nested-session guard
- Node.js ESM compatibility via `createRequire` banner

### Security
- Race condition fixes in concurrent task updates
- XSS prevention in log rendering
- API key hashing for storage

---

## 2026-02-13 — Decision Client & Bastion Access

### Added
- Decision client with retry, circuit breaker, and fallback classification
- Wired into Epic coordinator, multi-expert, agents, and executor
- Production bastion script (`bin/bastion start/stop`)

---

## 2026-02-09 — Agent Self-Update & Terraform

### Added
- Agent self-update system with version tracking
- Startup banner with agent version display
- Terraform infrastructure-as-code for full AWS stack

---

## 2026-02-07 — Self-Hosted Docker Mode

### Added
- Self-hosted deployment via Docker Compose (API + Worker + PostgreSQL + Redis)
- Local worker spawner for single-machine deployments
- AWS credential mounting for terraform/CLI access in worker containers

---

## 2026-02-01 — Showcase & Public Demo

### Added
- Showcase repositories (ShipAPI, CalMill) for demo environments
- Railway deployment integration
- Bitbucket CLI support for worker reviewers
- Request coalescing for coordination client (performance)

### Changed
- Explicit AI SDK clients with org-specific API keys (no shared state)

---

## 2026-01-26 — SSO, Auto-Improve & Persona Customization

### Added
- **Google and Microsoft SSO** via Cognito federation
- Auto-improve toggle — workers learn from review feedback across tasks
- Org-specific persona customization (override system personas)
- Multi-provider support for Epic inline reviewer
- Hung task detection via stale heartbeat monitoring
- Standard SDK Executor (Vercel AI SDK path alongside Claude CLI)

---

## 2026-01-24 — Epic Mode & Multi-Expert Orchestration

### Added
- **Epic mode** — parallel multi-agent execution with expert collaboration
- Real expert-to-expert coordination feed
- Inline Tech Lead review with revision loop (up to 3 revisions)
- Consolidated PR creation merging all expert branches
- Multi-expert mode with Vercel AI SDK integration
- **MCP server** for WorkerMill API access from Claude Desktop
- Tech Lead, Tech Writer, and additional expert personas

### Fixed
- Git identity configuration before committing in containers
- Backtick escaping in PR bodies to prevent shell substitution

---

## 2026-01-22 — Planning Agent V5 & Multi-Repo Deploy

### Added
- Planning V5 with Action Registry and dynamic coverage thresholds
- Story count calibration multiplier (temperature dial for plan sizing)
- Multi-repository deployment support via `.workermill/deploy.json`
- Tech stack decisions passed to workers for coordination
- Planning Agent settings in dashboard UI

### Changed
- Stories distributed proportionally by action count to prevent monolith steps

---

## 2026-01-20 — V2 Planning & User Onboarding

### Added
- V2 multi-phase PRD planning system
- User onboarding flow (org creation/join)
- Settings page redesign with sidebar navigation
- Partial token usage tracking during worker execution
- Semantic dependency auditor for planning agent

### Fixed
- Cancelled tasks no longer auto-restart on webhook trigger

---

## 2026-01-18 — PRD Orchestration & Parallel Workers

### Added
- **PRD orchestration** — multi-agent workflow with sibling coordination
- Parallel worker execution with orchestrator merging
- Dependency graph enforcement during dispatch
- Auto-merge child PRs for PRD workflows
- Dry-run mode with auto-cleanup
- Internal task management system (Kanban board)

### Fixed
- Circular dependency detection in story dispatch
- UUID validation in log stream endpoint (crash prevention)

---

## 2026-01-15 — Multi-Provider & Mission Control

### Added
- **OpenAI GPT-4o provider support** alongside Anthropic Claude
- Persona-to-provider routing for cost optimization
- Role-based dashboards for 10 personas including executive layer
- Mission Control dashboard with system health overview
- Post-agent validation for workflow completion

---

## 2026-01-14 — Checkpointing & Multi-Provider Architecture

### Added
- Worker state checkpointing (save/resume across container restarts)
- Multi-provider execution architecture with LangGraph
- Jira webhook race condition handling for label detection

---

## 2026-01-12 — Docker Builds & Deployment

### Added
- Kaniko Docker builds inside worker containers
- Worker directive for checking Jira attachments
- Spot instance interruption retry logic

### Fixed
- SSL certificate corruption after Kaniko builds
- Infrastructure file protection rules in agent directives

---

## 2026-01-11 — Virtual Manager & Live Streaming

### Added
- Virtual Manager Review workflow (human-in-the-loop approval)
- Real-time log streaming to dashboard (database-backed SSE)
- Cost tracking with log parser
- Auto-collapse terminals for completed tasks

### Fixed
- JSON stream data marker cleanup
- NaN handling in cost display

---

## 2026-01-10 — WorkerMill Monorepo

WorkerMill spun out of OnCallShift as a standalone AI software engineering platform.

### Added
- **WorkerMill monorepo** — API, Frontend, Worker, Infrastructure
- Core orchestrator with pluggable provider interfaces
- AWS integrations (ECS task runner, SQQ job queue)
- React dashboard with task management
- Docker Compose for local development
- 10 specialized worker personas
- Jira and GitHub webhook integrations
- Claude CLI-based worker execution with stream-json output parsing
- Standardized deployment script (`deploy.sh`)
- Worker directives system for persona-specific behavior rules

---

## 2026-01-03 — AI Workers Control Center (OnCallShift)

The AI Workers system was built inside OnCallShift before spinning out as WorkerMill.

### Added
- **Super Admin Control Center** for AI Workers monitoring
- AI Workers system for autonomous Jira task execution
- AI Workers self-recovery system
- Virtual Manager for PR review with identity signatures
- DOE framework with deployment capability
- Intelligent persona routing (keyword scoring)
- Manager autonomous workflow with PR approval
- Event-driven revision retries with circuit breaker
- Cancel button for tasks in pr_created/manager_review status
- Accurate token cost tracking via `log-parser.js`

### Security
- Authentication rate limiting to prevent brute force attacks
- CORS wildcard replaced with explicit allowed origins
- API keys masked in GET responses
- Explicit security headers (HSTS, X-Frame-Options, noSniff)
- Fail-closed Slack webhook signature verification

---

## 2026-01-01 — AI Assistant & Analytics (OnCallShift)

### Added
- AI Assistant with Cloud Investigation capability
- Unified AI Assistant with org-specific API keys
- Runbook Automation with real shell command execution
- Analytics dashboard with dark theme
- Notifications, postmortems, and import/export
- CloudFront S3 architecture for frontend hosting

---

## 2025-12-31 — PagerDuty Migration & Webhook Parity (OnCallShift)

### Added
- PagerDuty/Opsgenie migration compatibility (zero-config key preservation)
- Contact method and notification rule import
- Alert routing rules import
- Heartbeat monitors
- Maintenance window, service dependency, and tag import
- Frontend import wizard
- Complete Webhook API parity with PagerDuty
- SSO implementation guide
- Comprehensive mobile app improvements

---

## 2025-12-30 — Escalation Engine & Mobile (OnCallShift)

### Added
- Multi-target and repeat support for escalation policies
- Weekly on-call calendar on dashboard
- Automatic rotation handoffs via escalation timer worker
- Notification status tracking per channel
- Real shell command execution for runbook actions
- Mobile notification status panel
- OnCallShift brand logo and icons
- CI/CD pipeline with GitHub Actions
- Terraform plan approval workflow

---

## 2025-12-28 — React Frontend (OnCallShift)

### Added
- React frontend with authentication and incident management
- Express backend integration
- Production Dockerfile with frontend integration
- Test server for local development without database

---

## 2025-12-27 — Project Inception (pagerduty-lite)

### Added
- Initial project structure — open-source PagerDuty alternative
- Later renamed to **OnCallShift**, then the AI Workers system spun out as **WorkerMill**

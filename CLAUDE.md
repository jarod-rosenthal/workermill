# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

| Task | Command |
|------|---------|
| Run API locally | `cd api && npm run dev` |
| Run frontend locally | `cd frontend && npm run dev` |
| Type check API | `cd api && npm run typecheck` |
| Type check frontend | `cd frontend && npx tsc -b` |
| Deploy API (prod) | `./deploy.sh --api` |
| Deploy API (dev) | `./deploy.sh --api --env dev` |
| Deploy frontend | `./deploy.sh --frontend` |
| Deploy worker | `./deploy.sh --worker` |
| Create migration | `cd api && npm run migrate:create NAME` |
| Tail API logs (prod) | `MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-dev/api" --follow --region us-east-1` |
| Tail API logs (dev) | `MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-sandbox/api" --follow --region us-east-1` |
| Build worker scripts | `cd worker/execution && npm run build` |
| Lint API | `cd api && npm run lint` |
| Lint frontend | `cd frontend && npm run lint` |
| Seed database | `cd api && npm run seed` |
| **Validated implementation** | `/val-imp [plan-file]` |

**Key files:**
- API routes: `api/src/routes/`
- Models: `api/src/models/`
- Worker directives: `worker/directives/`
- Frontend pages: `frontend/src/pages/`

## Project Overview

WorkerMill is mission control for autonomous AI coding agents - a real-time monitoring and orchestration system for AI workers that execute coding tasks ("htop for AI workers"). It's deployed at https://workermill.com.

**Stack:**
- **Backend API**: Express + TypeScript + TypeORM + PostgreSQL (`api/`)
- **Frontend**: React 19 + Vite + TailwindCSS + Zustand (`frontend/`)
- **Infrastructure**: Terraform → AWS (ECS Fargate, RDS, S3, CloudFront)
- **Worker Containers**: Docker images with Claude Code for task execution (`worker/`)

**Requirements:** Node.js >= 20.0.0

**Current Development Phase:** Production deployment testing with **oncallshift** repository. Jira tickets from the **OCS** project trigger AI worker tasks.

### WorkerMill vs Target Repositories

**IMPORTANT: Understand the distinction between WorkerMill and target repositories.**

| Component | Repository | Purpose |
|-----------|------------|---------|
| **WorkerMill** | `workermill/` (this repo) | Orchestration platform - API, dashboard, worker containers |
| **oncallshift** | `jarod-rosenthal/pagerduty-lite` | Target repository that AI workers modify |

- **WorkerMill** is the control plane that spawns and monitors AI workers
- **oncallshift** (aka pagerduty-lite) is the application being built by AI workers
- AI workers execute tasks on oncallshift, NOT on WorkerMill itself
- Jira project **OCS** contains tickets for oncallshift development
- Jira project **WM** contains tickets for WorkerMill platform development

When a worker runs, it:
1. Clones oncallshift (`jarod-rosenthal/pagerduty-lite`)
2. Makes code changes based on the Jira ticket
3. Creates PRs against oncallshift
4. Reports status back to WorkerMill

### WorkerMill Architecture (Canonical Implementation)

WorkerMill is the authoritative implementation for AI worker orchestration. Key architectural patterns:

| Component | Implementation | Notes |
|-----------|----------------|-------|
| **Log streaming** | PostgreSQL + SSE | Workers POST to `/api/tasks/:taskId/logs`, dashboard streams via SSE at 500ms intervals |
| **Task orchestration** | Database polling | Atomic claim via UPDATE...WHERE, respects persona concurrency and cooldowns |
| **Worker entrypoint** | `post_log()` function | Shell function posts terminal output to API in real-time |
| **Container builds** | Kaniko (daemon-less) | Runs in Fargate via sudo with ECR credential helper |
| **Spot handling** | Auto-retry | Detects Spot interruptions (exit 137) and re-queues up to maxRetries |

### DO NOT CHANGE WORKING PATTERNS

**CRITICAL: These working solutions must NOT be changed without explicit user request:**

- **Log streaming**: Uses PostgreSQL + SSE, NOT CloudWatch. Worker posts to `/api/tasks/:taskId/logs`, SSE streams from database every 500ms. This took a week to get working.
- **Task orchestration**: Polls database for queued tasks, claims atomically, spawns ECS
- **Worker entrypoint**: Posts logs to API during execution via `post_log()` function
- **LLM Models**: NEVER change default models, model configurations, or switch between AI providers without explicit user approval. This includes changes to model names in code, environment variables, or configuration files.

If you think something could be "better" (CloudWatch, WebSockets, etc.), **ASK FIRST**. Do not make architectural changes to proven patterns.

### Task Orchestration Safety Rules

**NEVER automatically re-queue or process stale/old tasks.** When fixing orchestrator bugs:

1. **Do NOT add code that bulk-processes stuck tasks** - If tasks are stuck in a bad state, they should be manually reviewed and re-queued by the user, not automatically kicked off
2. **Add staleness checks** - Any recovery/retry logic must check task age and skip tasks older than a reasonable threshold (e.g., 1 hour)
3. **Fix the bug, don't process the backlog** - When a bug caused tasks to get stuck, fix the bug for future tasks but leave existing stuck tasks alone
4. **User controls task execution** - Only the user should decide when to re-run old tasks via the dashboard UI

This prevents surprise batch executions of old tasks that rack up costs and spam repositories with outdated PRs.

### Local Development Workflow

**Always work directly on `main` branch** for WorkerMill development. Do NOT create feature branches.

**Why:**
- Multiple Claude Code terminals may be working on the codebase simultaneously
- Working on `main` ensures all agents see each other's changes immediately
- Avoids merge conflicts and stale branch issues
- Each commit is atomic and immediately available

**How changes sync between terminals:**
| Change Type | Visibility |
|-------------|------------|
| Uncommitted file edits | Instant (shared filesystem) |
| Committed changes | Requires `git pull` in other terminals |

**Before making changes:** Run `git pull` to get the latest commits from other sessions.

**After making changes:** Commit and push promptly so other agents see your work.

### Codebase Structure

There are **two parallel codebases**:

1. **Production services** (`api/`, `frontend/`, `worker/`) - Deployed to AWS
2. **Monorepo packages** (`packages/*`) - Original modular architecture, not actively deployed

Focus development on `api/`, `frontend/`, and `worker/` directories.

## Build and Development Commands

### API Server (`api/`)
```bash
cd api
npm install
npm run dev          # Development with hot-reload (tsx watch)
npm run build        # Compile TypeScript
npm run typecheck    # Type check without emitting (npx tsc --noEmit)
npm run lint         # ESLint
npm run migrate      # Run database migrations (local dev)
npm run migrate:create NAME  # Create new migration
npm run seed         # Seed database
```

**Note:** No test suite is configured yet. Tests are not available.

### Database Migrations

**Migrations run automatically on API startup.**

**Creating a new migration:**
1. `cd api && npm run migrate:create AddMyNewColumn`
2. Edit the generated file in `api/src/db/migrations/`
3. **CRITICAL:** Register in `api/src/db/connection.ts` (import + add to `migrations` array)
4. Deploy: `./deploy.sh --api`

**Key rules:**
- Always use `IF NOT EXISTS` / `IF EXISTS` for idempotency
- Deploy script validates all migrations are registered before deployment
- See existing migrations for template examples

### Frontend (`frontend/`)
```bash
cd frontend
npm install
npm run dev          # Vite dev server
npm run build        # Build for production (includes tsc)
npm run preview      # Preview production build locally
npm run lint         # ESLint
npx tsc -b           # Type check only
```

**Note:** No test suite is configured yet. Tests are not available.

### Worker Execution Scripts (`worker/`)

Worker scripts in `worker/execution/` (TypeScript) compile to `worker/execution-compiled/` (JavaScript).

```bash
cd worker/execution && npm run build   # After editing, rebuild and commit compiled output
```

### Deployment

**ALWAYS use `deploy.sh` for ALL deployments.** Never manually build/push Docker images.

```bash
# Production (default - workermill.com)
./deploy.sh --api                    # Deploy API to production
./deploy.sh --worker                 # Deploy worker image to production
./deploy.sh --frontend               # Deploy frontend to production
./deploy.sh --all                    # Deploy everything to production

# Development (dev.workermill.com)
./deploy.sh --api --env dev          # Deploy API to development
./deploy.sh --all --env dev          # Deploy everything to development

# Options
./deploy.sh --all --skip-build       # Deploy without rebuilding
./deploy.sh --help                   # Show all options
```

**IMPORTANT:** Run `./deploy.sh --frontend` after UI changes so they're visible at https://workermill.com.

### Infrastructure (Terraform)

**Two environments exist:**

| Environment | Folder | Domain | State Key |
|-------------|--------|--------|-----------|
| **Production** | `environments/prod/` | workermill.com | `workermill/prod/terraform.tfstate` |
| **Development** | `environments/dev/` | dev.workermill.com | `workermill/sandbox/terraform.tfstate` |

```bash
# Production
cd infrastructure/terraform/environments/prod
terraform init -backend-config="bucket=workermill-terraform-state-593971626975"
terraform plan -var="domain_name=workermill.com"
terraform apply -var="domain_name=workermill.com"

# Development
cd infrastructure/terraform/environments/dev
terraform init -backend-config="bucket=workermill-terraform-state-593971626975"
terraform plan
terraform apply
```

**Note on resource naming:** Production resources are named `workermill-dev-*` due to historical naming. The folder structure reflects intent - see `docs/FUTURE_RESOURCE_RENAME_MIGRATION.md` for the future cleanup plan.

## Jira Integration

### Triggering AI Workers

Add the `workermill` label to a Jira ticket to trigger an AI worker task. **Epic mode is the default workflow** - no additional label is needed for Epic execution.

| Label | Purpose |
|-------|---------|
| `workermill` | **Required** - Triggers WorkerMill processing |
| `haiku` / `sonnet` / `opus` | Model selection (default: org's defaultWorkerModel) |
| `deploy` | **Auto-deploy**: Skip PR approval, merge and deploy immediately |
| `review` | Require manager review before merge |
| `standard` or `v1` | **Legacy mode**: Opt-out of V2 pipeline to single-persona execution (deprecated) |
| `sdk` | **Standard SDK Mode**: Use Claude Agent SDK for single-task execution |
| `phased` | **Phased Execution**: Break stories into phases with fresh context windows |
| `critic` | Add Planner-Critic validation before execution |

**Execution Mode Selection (Automatic):**

The execution mode is automatically determined by your organization's provider settings - no labels required:

| Condition | Mode |
|-----------|------|
| `primaryProvider` = "anthropic" AND no `providerRouting` overrides | **Epic Mode** (parallel, Agent SDK) |
| Any other `primaryProvider` OR `providerRouting` configured | **Multi-Provider Mode** (sequential, AI SDK) |

Configure in **Settings → AI Workers → Default AI Provider** and **Provider Routing**.

### Worker Deployment Workflow

**Standard flow (no `deploy` label):**
1. Worker creates PR with code changes
2. Worker outputs `::result::review_requested`
3. Human reviews and approves PR on GitHub
4. GitHub webhook triggers WorkerMill
5. Worker re-runs to merge PR and deploy

**Auto-deploy flow (with `deploy` label):**
1. Worker creates PR with code changes
2. Worker immediately merges PR (no human approval)
3. Worker deploys and outputs `::result::deployed`

**Key distinction:**
- `deploy` label = Skip human PR approval (auto-merge and deploy)
- No `deploy` label = Wait for human PR approval, THEN merge and deploy

**Webhook:** `https://workermill.com/api/webhooks/jira` (JQL: `labels = workermill`)

### Linear Integration

WorkerMill also supports Linear as an issue tracker with the same label-based workflow:

- **Webhook:** `https://workermill.com/api/webhooks/linear`
- **Trigger:** Add `workermill` label to a Linear issue
- Same model/deploy/review labels work identically to Jira

### Creating Jira Tickets via MCP

## ⛔ CRITICAL: NEVER ADD ANY LABELS WHEN CREATING TICKETS ⛔

**When creating Jira tickets, NEVER include the `labels` field. Create tickets with NO LABELS.**

- The `workermill` label triggers automatic AI worker deployment
- Adding labels without explicit permission has caused production incidents
- This is a HARD RULE with NO EXCEPTIONS

**The ONLY time to add labels:**
- User explicitly says "add the workermill label" or "trigger the worker"
- User explicitly requests a specific label be added
- AFTER the ticket is created, as a SEPARATE action, with explicit user approval

**Correct approach:**
1. Create ticket with NO labels
2. Show user the ticket
3. Ask "Ready to add the workermill label to trigger the worker?"
4. Only add label after explicit confirmation

### Jira Projects

| Project | Key | Purpose |
|---------|-----|---------|
| oncallshift | OCS | Primary project for AI worker tasks |
| WorkerMill | WM | Internal platform tracking |

**Key rules:**
- Issue type IDs are project-specific - query with `jira_get path="/rest/api/3/project/OCS" jq="issueTypes[*].{id: id, name: name}"`
- Tickets should include: User Story, Acceptance Criteria (GIVEN/WHEN/THEN), Definition of Done
- After completing: add comment, then transition to Done

### Branch Naming

```
<type>/<ticket-number>-<short-description>
```
Types: `feature/`, `fix/`, `refactor/`, `infra/`, `security/`

## Hooks

Auto-formatting via Prettier runs automatically after Write/Edit to `.ts`/`.tsx`/`.js`/`.jsx` files (configured in `.claude/settings.json`).

## Custom Skills

### /val-imp

Enforces strict plan adherence: extracts requirements, implements one at a time, spawns independent validator agent after each. Prevents drift through external accountability.

**Usage:** `/val-imp docs/my-feature-plan.md`

See `.claude/skills/README.md` for full documentation.

## Windows/Git Bash Environment

**CRITICAL: The Bash tool runs in Git Bash on Windows with shell parsing limitations.** When commands fail with syntax errors involving `$(...)` or variable expansion, spawn a Task agent immediately - don't debug Git Bash quirks.

### Common Issues

| Issue | Solution |
|-------|----------|
| AWS CLI path conversion | Prefix with `MSYS_NO_PATHCONV=1` |
| AWS CLI Unicode errors | Set `PYTHONIOENCODING=utf-8` |
| Terraform not in PATH | Use full path or `terraform.exe` |
| Docker layer caching | deploy.sh uses `--no-cache` - NEVER build with cache or old code silently deploys |

## Architecture Overview

### Key Models (`api/src/models/`)
- `WorkerTask` - Task state, cost tracking, git info
- `WorkerTaskLog` - Terminal log storage for SSE streaming
- `Organization` - Multi-tenant organization support (settings, API keys, billing)
- `User` - User accounts linked to Cognito
- `UserApiKey` - User-scoped API keys for programmatic access
- `AuditLog` - Security and compliance audit trail
- `OrgInvite` - Team member invitation system
- `WorkerFileLock` - Multi-worker file locking for coordination
- `WorkerCheckIn` - Worker heartbeat and health tracking
- `WorkerContext` - Real-time communication between sibling workers (PRD workflows)
- `CoordinationFeedItem` - Expert collaboration messages (decisions, questions, consultations)

### Worker System (`worker/`)
Worker containers execute tasks with Claude Code. Directives in `worker/directives/` define role-specific behavior:
- `backend_developer/`, `frontend_developer/`, `devops_engineer/`
- `security_engineer/`, `qa_engineer/`, `tech_writer/`, `project_manager/`

See `worker/AGENTS.md` for comprehensive worker instructions.

### Multi-Provider AI Support

Workers support multiple AI providers. For single-worker tasks, use Jira labels. For coordinated multi-story tasks, use Multi-Provider Mode with provider routing.

| Provider | Models | Status |
|----------|--------|--------|
| `anthropic` (default) | claude-haiku-4-5, claude-sonnet-4, claude-opus-4 | Production |
| `openai` | gpt-4o, gpt-5.1-codex, o1, o1-mini | Production |
| `google` | gemini-2.0-flash, gemini-3-pro-preview | Production |
| `ollama` | qwen2.5-coder:32b, deepseek-r1:70b, etc. | Production |

**Model selection (via Jira labels):**
- `haiku` / `sonnet` / `opus` labels → Override to specific Anthropic model
- No model label → Uses org default (`defaultWorkerModel` setting)

**Provider routing (automatic):**
- Configure `primaryProvider` in Settings → AI Workers → Default AI Provider
- Configure per-persona overrides in Settings → AI Workers → Provider Routing
- Execution mode is automatically selected based on these settings (see above)

**Ollama Configuration:**
- `OLLAMA_HOST` env var sets the Ollama server URL
- Production uses `https://ollama.therealjarod.com` (configured in secrets)

### Multi-SCM Provider Support

WorkerMill supports multiple Source Code Management providers. Organizations can choose their preferred SCM platform for code operations.

| Provider | Status | Auth Method | Self-Hosted |
|----------|--------|-------------|-------------|
| `github` (default) | Production | Bearer token | Yes (Enterprise) |
| `gitlab` | Production | PRIVATE-TOKEN | Yes |
| `bitbucket` | Production | Basic auth (app password) | Yes |

**Configuration:**
1. Go to Settings → Integrations → Source Control Provider
2. Select provider (GitHub, GitLab, or BitBucket)
3. For self-hosted instances, enter the base URL (e.g., `https://gitlab.company.com`)
4. Configure the corresponding integration credentials below

**Key files:**
- `api/src/scm-providers/` - Provider abstraction layer
- `api/src/scm-providers/types.ts` - `IScmProvider` interface
- `api/src/scm-providers/github-provider.ts` - GitHub implementation
- `api/src/scm-providers/gitlab-provider.ts` - GitLab implementation
- `api/src/scm-providers/bitbucket-provider.ts` - BitBucket implementation

**Webhook endpoints:**
- `/api/webhooks/github` - GitHub PR events
- `/api/webhooks/gitlab` - GitLab MR events
- `/api/webhooks/bitbucket` - BitBucket PR events

**Worker environment variables:**
```bash
SCM_PROVIDER=github|gitlab|bitbucket
SCM_BASE_URL=https://gitlab.example.com  # For self-hosted
SCM_TOKEN=<token>
BITBUCKET_USERNAME=<username>  # BitBucket only
```

### Key API Routes (`api/src/routes/`)
- `webhooks.ts` - Jira, GitHub, GitLab, BitBucket, Linear webhook receivers
- `control-center.ts` - Task management and log streaming SSE
- `tasks.ts` - Worker log ingestion
- `orchestrator.ts` - System control (start/stop/status)
- `settings.ts` - Organization settings CRUD
- `billing.ts` - Stripe billing integration
- `coordination.ts` - Multi-worker file locking and coordination

### Task Flow
Jira webhook → API receives task → Queue message → Claim task → Spawn ECS container → Monitor completion → Parse output markers (`::result::`, `::pr_url::`) → Update status

**Pipeline versions:**
- `v1` (default): Single worker executes task directly
- `v2`: Planning Agent decomposes task into stories, then executes via Epic or Multi-Provider mode

### Advanced Execution Modes

WorkerMill automatically selects the execution mode based on your organization's provider settings. Both Epic and Multi-Provider modes use the V2 pipeline where a Planning Agent first decomposes the task into stories with dependencies.

**Automatic Mode Selection:**
- **Epic Mode**: When `primaryProvider` = "anthropic" (or unset) AND no `providerRouting` overrides
- **Multi-Provider Mode**: When any other provider is default OR `providerRouting` is configured

#### Epic Mode (Anthropic-only, Parallel)

**Trigger:** Automatic when using Anthropic as default provider with no routing overrides

**What it does:**
1. Planning Agent analyzes the ticket and generates an execution plan with multiple stories
2. Each story has: title, description, assigned persona, dependencies, index
3. Spawns a single ECS container running the Epic Coordinator
4. Coordinator dispatches stories to expert subagents who work **in parallel**
5. Experts collaborate via real-time coordination feed (decisions, questions, consultations)
6. Creates consolidated PR when all stories complete

**Key characteristics:**
- **Parallel execution**: Multiple experts work simultaneously on different stories
- **Anthropic-only**: Uses Claude Agent SDK with Claude Code tools
- **Real-time collaboration**: Experts share decisions (DEC-xxx), ask questions (Q-xxx), request consultations
- **Full tool access**: Experts have access to bash, file operations, git, etc.

**Components:**
- `worker/epic/coordinator.ts` - Main coordination loop, story claiming, expert dispatch
- `worker/epic/executor.ts` - Runs individual stories via Claude Agent SDK
- `worker/epic/experts.ts` - Expert persona definitions
- `worker/epic/coordination-client.ts` - API client for coordination feed

#### Multi-Provider Mode (Any Provider, Sequential)

**Trigger:** Automatic when using non-Anthropic provider OR when provider routing is configured

**What it does:**
1. Planning Agent analyzes the ticket and generates an execution plan with multiple stories
2. Spawns a single ECS container running the Multi-Provider Coordinator
3. Stories execute **sequentially**, respecting dependency order
4. Each persona can use a **different AI provider** based on org `providerRouting` settings
5. Experts collaborate via coordination feed with blocking consultations
6. Creates consolidated PR when all stories complete

**Key characteristics:**
- **Sequential execution**: Stories execute one at a time, dependencies respected
- **Multi-provider**: Each persona routes to configured provider (Anthropic, OpenAI, Google, Ollama)
- **Vercel AI SDK**: Uses `ai` package for cross-provider compatibility
- **Provider routing**: Configure in Settings → AI Workers → Provider Routing

**Provider Routing Example:**
```json
{
  "qa_engineer": { "provider": "google", "model": "gemini-2.0-flash" },
  "backend_developer": { "provider": "anthropic", "model": "claude-sonnet-4-5-20250929" }
}
```

**Components:** (directory named `multi-expert/` for historical reasons)
- `worker/multi-expert/index.ts` - Multi-Provider coordinator and entry point
- `worker/multi-expert/coordination-client.ts` - API client for coordination feed
- `worker/agents/ai-sdk-executor.js` - Vercel AI SDK executor

#### Mode Comparison

| Feature | Epic Mode | Multi-Provider Mode |
|---------|-----------|---------------------|
| **Trigger** | Anthropic default, no routing | Non-Anthropic OR routing configured |
| **Execution** | Parallel (simultaneous) | Sequential (one at a time) |
| **AI Provider** | Anthropic only | Per-persona routing |
| **SDK** | Claude Agent SDK | Vercel AI SDK |
| **Tool Access** | Full Claude Code tools | Limited cross-provider tools |
| **Use Case** | Fast parallel execution | Multi-provider flexibility |

#### Phased Execution Mode

**Trigger:** Add `phased` label to a Jira ticket (along with `epic` + `workermill`)

**What it does:**
Each story is broken into discrete phases with fresh context windows:

```
ANALYZE → IMPLEMENT (per unit) → INTEGRATE → VERIFY ↔ FIX → COMMIT
```

**Why use it:**
- Addresses context window degradation in long-running agent sessions
- Each phase runs with ~15-25K tokens instead of 100-200K accumulated
- Checkpoints after each implementation unit (can resume on failure)
- Late-stage reasoning operates on fresh context

**Phase flow:**
1. **ANALYZE**: Read codebase, produce implementation plan with units
2. **IMPLEMENT**: One phase per implementation unit (grouped files)
3. **INTEGRATE**: Coherence check - fix imports, exports, index files
4. **VERIFY**: Run tests, type-check, lint, validate acceptance criteria
5. **FIX**: Address issues (max 3 iterations, always re-verifies)
6. **COMMIT**: Squash checkpoint commits into final commit

**Key concepts:**
- **Implementation units**: Bounded work packages (not per-file)
- **PhaseInputBundle**: Explicit context contract with pre-injected snippets
- **Checkpoint commits**: Git commit after each unit, squashed at end

**Components:**
- `worker/epic/phased-executor.ts` - Main orchestrator
- `worker/epic/phases/*.ts` - Individual phase implementations
- `worker/epic/phased-types.ts` - Type definitions
- `worker/epic/checkpoint-manager.ts` - Git checkpoint management

**See:** `docs/PHASED_EXECUTION_PLAN.md` for detailed architecture

#### Standard SDK Mode

**Trigger:** Add `sdk` label to a Jira ticket (along with `workermill`)

**What it does:**
1. Uses Claude Agent SDK for single-task execution (instead of Claude Code CLI)
2. Supports inline review, deploy, and self-improvement phases
3. Same model/persona selection as standard mode

**Key characteristics:**
- **Single task**: No story decomposition (unlike Epic or Multi-Provider modes)
- **SDK-based**: Uses Claude Agent SDK directly instead of spawning Claude Code CLI
- **Inline phases**: Can run review, deploy, and improvement within the same execution

**Components:**
- `worker/standard/executor.ts` - SDK-based single task executor
- `worker/epic/inline-reviewer.ts` - Shared inline review component
- `worker/epic/inline-deployer.ts` - Shared inline deployment component
- `worker/epic/inline-improver.ts` - Shared self-improvement component

#### Optional Critic Validation

Add `critic` label with `epic` or `multi-provider` to enable Planner-Critic validation before execution.

### Frontend State (`frontend/`)
- Server state: Axios + React hooks
- Auth state: Zustand store (`src/store/`)
- Forms: React Hook Form + Zod validation
- **Main Dashboard**: `frontend/src/pages/Dashboard.tsx` - 3-column layout with collapsible sidebars (Stats left, Virtual Manager right)

## Infrastructure Rules

**Terraform is the ONLY source of truth.** Never make manual AWS Console changes.

1. Run `terraform plan` before any infrastructure discussion to check for drift
2. After `terraform apply`, commit changes to git immediately
3. If resources exist outside Terraform, `terraform import` them immediately

### Environment Configuration

**Production** (`environments/prod/`) - Customer-facing at workermill.com

| Resource | Value | Notes |
|----------|-------|-------|
| AWS Account | 593971626975 | |
| AWS Region | us-east-1 | |
| ECS Cluster | workermill-dev | Historical naming - see migration doc |
| API Service | workermill-dev-api | Historical naming |
| S3 Bucket | workermill-dev-frontend-593971626975 | |
| CloudFront Distribution | E15CA3N5TI2ZR2 | |
| Live URL | https://workermill.com | |
| Cognito User Pool ID | us-east-1_oHZOtoac8 | |
| Cognito Web Client ID | 4bpjbr7gu9ne5rgo3v0rjic7hq | |
| Terraform Folder | `environments/prod/` | |
| State Key | `workermill/prod/terraform.tfstate` | |

**Development** (`environments/dev/`) - For testing at dev.workermill.com

| Resource | Value |
|----------|-------|
| ECS Cluster | workermill-sandbox |
| API Service | workermill-sandbox-api |
| S3 Bucket | workermill-sandbox-frontend-593971626975 |
| CloudFront Distribution | E12RYV9AUPXT90 |
| Live URL | https://dev.workermill.com |
| Cognito User Pool ID | us-east-1_Ps3yuO3KA |
| Cognito Web Client ID | 57dam1feas0q2ir8fkhb6s0v3g |
| RDS Endpoint | workermill-sandbox.cn9wuodq8uyb.us-east-1.rds.amazonaws.com |
| Terraform Folder | `environments/dev/` |
| State Key | `workermill/sandbox/terraform.tfstate` |
| VPC CIDR | 10.2.0.0/16 (isolated from prod) |
| Secrets Prefix | workermill/sandbox/* |

**Note:** Dev environment has separate Cognito user pool - users must register separately for dev.

## Organization Settings

Per-tenant settings stored in `organizations` table. Key settings:
- `maxConcurrentWorkers` (default: 3), `defaultWorkerModel`, `defaultWorkerPersona`
- `logRetentionDays` (default: 30), `taskRetentionDays` (default: 90)
- `costAlertThresholdUsd` - Alert threshold
- `scmProvider` (default: "github") - Source control provider (`github`, `gitlab`, `bitbucket`)
- `scmBaseUrl` - Custom base URL for self-hosted SCM instances

API: `GET /PUT /api/settings`. See Settings page in dashboard for full list.

## Security Requirements

**FORBIDDEN:**
- `NODE_TLS_REJECT_UNAUTHORIZED=0` (never disable TLS)
- Hardcoded credentials in code
- `Resource: "*"` with destructive IAM actions
- Overly permissive security groups (0.0.0.0/0 for non-public services)

**REQUIRED:**
- Use AWS Secrets Manager for credentials (prod: `workermill/dev/*`, sandbox: `workermill/sandbox/*`)
- Scope IAM policies to `arn:aws:*:*:*:workermill-*`
- Use express-validator for all API inputs

## Troubleshooting

```bash
# View ECS service status (Production)
aws ecs describe-services --cluster workermill-dev --services workermill-dev-api --region us-east-1

# View ECS service status (Development)
aws ecs describe-services --cluster workermill-sandbox --services workermill-sandbox-api --region us-east-1

# Tail API logs - Production (use MSYS_NO_PATHCONV=1 in Git Bash)
MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-dev/api" --follow --region us-east-1

# Tail API logs - Development
MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-sandbox/api" --follow --region us-east-1

# Tail worker logs - Production
MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-dev/worker" --follow --region us-east-1

# Tail worker logs - Development
MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-sandbox/worker" --follow --region us-east-1
```

### Database Access via SSM

Use ECS Execute Command to query database from API container. Get task ID first:
```bash
MSYS_NO_PATHCONV=1 aws ecs list-tasks --cluster workermill-dev --region us-east-1
```

Then run queries via `aws ecs execute-command` with `--container api`. Requires `enableExecuteCommand` in Terraform.

### Common Debugging Patterns

| Problem | Check |
|---------|-------|
| Task stuck "running" | `aws ecs list-tasks`, check CloudWatch for exit 137 (Spot) or exit 1 |
| Worker not posting logs | Verify org `apiKey` set, check worker logs for POST errors |
| Task not claimed | `GET /api/orchestrator/status`, verify task status is `queued` |
| PR not created | Check branch conflicts, GITHUB_TOKEN permissions, rate limits |
| Epic/Multi-Provider not progressing | Check coordination feed at `GET /api/coordination/feed/:taskId`, verify planning agent completed |
| Foreign key constraint on coordination | Ensure `taskId` exists in `worker_tasks` before posting to coordination feed |

## Tech Debt

### SES Email Configuration

**Current state:**
- **Outbound emails (sending)**: us-east-2 SES - has production access, can send to any email
- **Inbound emails (receiving)**: us-east-1 SES - for receiving emails (Lambda, S3)

**Important:** All outbound email (invites, notifications, etc.) uses us-east-2 SES. Do not change this configuration.

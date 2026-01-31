# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⛔ Critical Rules - READ FIRST

### DO NOT CHANGE Working Patterns

**These working solutions must NOT be changed without explicit user request:**

| Pattern | Implementation | Why It's Sacred |
|---------|----------------|-----------------|
| **Log streaming** | PostgreSQL + SSE, NOT CloudWatch | Took a week to get working. Worker posts to `/api/tasks/:taskId/logs`, SSE streams from database every 500ms. |
| **Task orchestration** | Database polling with atomic claim | Polls for queued tasks, claims via UPDATE...WHERE, spawns ECS |
| **Worker entrypoint** | `post_log()` shell function | Posts terminal output to API in real-time |
| **LLM Models** | NEVER change without approval | No default model changes, no provider switches, no model name changes in code/env/config |

**If you think something could be "better" (CloudWatch, WebSockets, etc.), ASK FIRST.**

### DO NOT Relax Security

**NEVER, under ANY circumstances, relax, bypass, or weaken security checks:**

- **NEVER** change auth middleware to skip validation
- **NEVER** relax role checks (e.g., `supportAdmin` → `admin || supportAdmin`)
- **NEVER** add "temporary" security bypasses - they WILL ship to production
- **NEVER** disable authentication on endpoints, even for testing

**If you need elevated access:** Set the proper flag/role via migration, not by weakening checks.

**Forbidden patterns:**
- `NODE_TLS_REJECT_UNAUTHORIZED=0`
- Hardcoded credentials
- `Resource: "*"` with destructive IAM actions
- 0.0.0.0/0 security groups for non-public services

### DO NOT Modify Infrastructure Outside Terraform

**Terraform is the ONLY source of truth. NEVER:**
- Create AWS resources via console
- Manually modify ECS task definitions
- Push Docker images without using `deploy.sh`
- Change security groups, IAM roles, or networking outside Terraform

### DO NOT Add Labels When Creating Jira Tickets

**Create tickets with NO LABELS.** The `workermill` label triggers automatic AI worker deployment. Adding labels without explicit permission has caused production incidents.

**Only add labels AFTER ticket creation, with explicit user approval.**

### DO NOT Auto-Process Stale Tasks

When fixing orchestrator bugs:
- Do NOT add code that bulk-processes stuck tasks
- Add staleness checks (skip tasks older than 1 hour)
- Fix the bug for future tasks, leave existing stuck tasks alone
- User controls task execution via dashboard UI

---

## Quick Reference

| Task | Command |
|------|---------|
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
| Preview UI locally | `cd frontend && npm run dev` |
| **Validated implementation** | `/val-imp [plan-file]` |

**Note:** There is NO local development environment. All development is done by deploying to AWS. The only local command is `npm run dev` in frontend for previewing UI changes before deployment.

**Key files:**
- API routes: `api/src/routes/`
- Models: `api/src/models/`
- Worker directives: `worker/directives/`
- Frontend pages: `frontend/src/pages/`

---

## Project Overview

WorkerMill is mission control for autonomous AI coding agents - a real-time monitoring and orchestration system for AI workers that execute coding tasks ("htop for AI workers"). Deployed at https://workermill.com.

**Stack:**
- **Backend API**: Express + TypeScript + TypeORM + PostgreSQL (`api/`)
- **Frontend**: React 19 + Vite + TailwindCSS + Zustand (`frontend/`)
- **Infrastructure**: Terraform → AWS (ECS Fargate, RDS, S3, CloudFront) in us-east-1
- **Worker Containers**: Docker images with Claude Code for task execution (`worker/`)

**Requirements:** Node.js >= 20.0.0

**Current Development Phase:** Production deployment testing with **oncallshift** repositories (Bitbucket). Jira tickets from the **OCS** project trigger AI worker tasks against the split repos: `oncallshift-api`, `oncallshift-web`, `oncallshift-mobile`.

### WorkerMill vs Target Repositories

| Component | Repository | Platform | Purpose |
|-----------|------------|----------|---------|
| **WorkerMill** | `workermill/` (this repo) | GitHub | Orchestration platform - API, dashboard, worker containers |
| **oncallshift-api** | `oncallshift/oncallshift-api` | Bitbucket | Backend API, infrastructure, packages, e2e tests |
| **oncallshift-web** | `oncallshift/oncallshift-web` | Bitbucket | React frontend |
| **oncallshift-mobile** | `oncallshift/oncallshift-mobile` | Bitbucket | React Native mobile app |

- **WorkerMill** is the control plane that spawns and monitors AI workers
- **oncallshift** repos are the applications being built by AI workers
- AI workers execute tasks on oncallshift repos, NOT on WorkerMill itself
- Jira project **OCS** = oncallshift development, **WM** = WorkerMill platform

**oncallshift Repository Structure (Bitbucket):**

| Repo | Contents | URL |
|------|----------|-----|
| `oncallshift-api` | `backend/`, `infrastructure/`, `packages/`, `e2e/`, `docs/` | https://bitbucket.org/oncallshift/oncallshift-api |
| `oncallshift-web` | React frontend (src/, vite.config.ts, etc.) | https://bitbucket.org/oncallshift/oncallshift-web |
| `oncallshift-mobile` | React Native app (src/, app.json, etc.) | https://bitbucket.org/oncallshift/oncallshift-mobile |

When a worker runs on an OCS ticket, it:
1. Determines which repo(s) to modify based on the ticket scope
2. Clones the relevant oncallshift repo(s) from Bitbucket
3. Makes code changes based on the Jira ticket
4. Creates PRs against the appropriate repo
5. Reports status back to WorkerMill

**Cross-repo tickets:** Some OCS tickets may span multiple repos (e.g., API + frontend). Workers should create separate PRs for each repo and link them in the ticket comments.

### Codebase Structure

Focus on these directories (production services):
- `api/` - Backend API deployed to ECS
- `frontend/` - React dashboard deployed to CloudFront
- `worker/` - Worker container images

Ignore `packages/*` - original modular architecture, not actively deployed.

---

## Deployment

**ALWAYS use `deploy.sh` for ALL deployments.** Never manually build/push Docker images.

```bash
# Production (workermill.com)
./deploy.sh --api                    # Deploy API
./deploy.sh --worker                 # Deploy worker image
./deploy.sh --frontend               # Deploy frontend
./deploy.sh --all                    # Deploy everything

# Development (dev.workermill.com)
./deploy.sh --api --env dev          # Deploy API to dev
./deploy.sh --all --env dev          # Deploy everything to dev

# Options
./deploy.sh --all --skip-build       # Skip rebuilding
./deploy.sh --help                   # Show all options
```

**IMPORTANT:** Run `./deploy.sh --frontend` after UI changes.

### Database Migrations

**Migrations run automatically on API startup.**

1. `cd api && npm run migrate:create AddMyNewColumn`
2. Edit the generated file in `api/src/db/migrations/`
3. **CRITICAL:** Register in `api/src/db/connection.ts` (import + add to `migrations` array)
4. Deploy: `./deploy.sh --api`

**Rules:**
- Always use `IF NOT EXISTS` / `IF EXISTS` for idempotency
- Deploy script validates all migrations are registered

### Worker Execution Scripts

Worker scripts in `worker/execution/` (TypeScript) compile to `worker/execution-compiled/` (JavaScript).

```bash
cd worker/execution && npm run build   # Rebuild and commit compiled output
```

---

## Git Workflow

**Always work directly on `main` branch.** Do NOT create feature branches.

**Why:** Multiple Claude Code terminals may work simultaneously. Working on `main` ensures all agents see changes immediately.

| Change Type | Visibility |
|-------------|------------|
| Uncommitted file edits | Instant (shared filesystem) |
| Committed changes | Requires `git pull` in other terminals |

**Before changes:** `git pull`
**After changes:** Commit and push promptly

---

## Jira Integration

### Triggering AI Workers

Add the `workermill` label to a Jira/Linear/GitHub Issue to trigger an AI worker task.

| Label | Purpose |
|-------|---------|
| `workermill` | **Required** - Triggers WorkerMill processing |
| `haiku` / `sonnet` / `opus` | Model override (default: org's `defaultWorkerModel`) |
| `deploy` | Auto-merge PR and deploy without human approval |
| `review` | Require manager review before merge |
| `sdk` | Standard SDK Mode (single-task, no story decomposition) |
| `phased` | Phased Execution (fresh context per phase) |
| `critic` | Enable Planner-Critic validation |

### Jira Projects

| Project | Key | Purpose | Target Repos |
|---------|-----|---------|--------------|
| oncallshift | OCS | Primary project for AI worker tasks | `oncallshift-api`, `oncallshift-web`, `oncallshift-mobile` (Bitbucket) |
| WorkerMill | WM | Internal platform tracking | `workermill` (GitHub) |

### Worker Deployment Workflow

**Standard flow (no `deploy` label):**
1. Worker creates PR with code changes
2. Worker outputs `::result::review_requested`
3. Human reviews and approves PR
4. Webhook triggers WorkerMill
5. Worker re-runs to merge PR and deploy

**Auto-deploy flow (with `deploy` label):**
1. Worker creates PR → immediately merges → deploys
2. Worker outputs `::result::deployed`

### Webhooks

| Platform | Endpoint |
|----------|----------|
| Jira | `https://workermill.com/api/webhooks/jira` |
| Linear | `https://workermill.com/api/webhooks/linear` |
| GitHub Issues | `https://workermill.com/api/webhooks/github-issues` |
| GitHub PR | `https://workermill.com/api/webhooks/github` |
| GitLab MR | `https://workermill.com/api/webhooks/gitlab` |
| BitBucket PR | `https://workermill.com/api/webhooks/bitbucket` |

---

## Architecture

### Key Models (`api/src/models/`)

| Model | Purpose |
|-------|---------|
| `WorkerTask` | Task state, cost tracking, git info |
| `WorkerTaskLog` | Terminal log storage for SSE streaming |
| `Organization` | Multi-tenant org support (settings, API keys, billing) |
| `User` | User accounts linked to Cognito |
| `AuditLog` | Security and compliance audit trail |
| `WorkerFileLock` | Multi-worker file locking |
| `WorkerCheckIn` | Worker heartbeat and health tracking |
| `CoordinationFeedItem` | Expert collaboration messages |

### Key API Routes (`api/src/routes/`)

| Route | Purpose |
|-------|---------|
| `webhooks.ts` | Jira, GitHub, GitLab, BitBucket, Linear receivers |
| `control-center.ts` | Task management and log streaming SSE |
| `tasks.ts` | Worker log ingestion |
| `orchestrator.ts` | System control (start/stop/status) |
| `settings.ts` | Organization settings CRUD |
| `billing.ts` | Stripe billing integration |
| `coordination.ts` | Multi-worker file locking |

### Task Flow

```
Jira webhook → API receives task → Queue → Claim task → Spawn ECS container → Monitor → Parse output markers (::result::, ::pr_url::) → Update status
```

### Worker System

Directives in `worker/directives/` define role-specific behavior:
- `backend_developer/`, `frontend_developer/`, `devops_engineer/`
- `security_engineer/`, `qa_engineer/`, `tech_writer/`, `project_manager/`

See `worker/AGENTS.md` for comprehensive worker instructions.

### Multi-Provider AI Support

| Provider | Models | Status |
|----------|--------|--------|
| `anthropic` (default) | claude-haiku-4-5, claude-sonnet-4, claude-opus-4 | Production |
| `openai` | gpt-4o, gpt-5.1-codex, o1, o1-mini | Production |
| `google` | gemini-2.0-flash, gemini-3-pro-preview | Production |
| `ollama` | qwen2.5-coder:32b, deepseek-r1:70b, etc. | Production |

### Multi-SCM Provider Support

| Provider | Status | Auth Method |
|----------|--------|-------------|
| `github` (default) | Production | Bearer token |
| `gitlab` | Production | PRIVATE-TOKEN |
| `bitbucket` | Production | API token (email:token) |

**oncallshift uses Bitbucket:** Repositories at `bitbucket.org/oncallshift/`. Workers targeting OCS tickets use Bitbucket provider.

---

## Execution Modes

WorkerMill automatically selects execution mode based on org provider settings.

| Condition | Mode |
|-----------|------|
| `primaryProvider` = "anthropic" AND no `providerRouting` | **Epic Mode** (parallel, Agent SDK) |
| Other `primaryProvider` OR `providerRouting` configured | **Multi-Provider Mode** (sequential, AI SDK) |

### Epic Mode (Anthropic-only, Parallel)

Planning Agent decomposes task → Spawns Epic Coordinator → Expert subagents work in parallel → Coordination feed for collaboration → Consolidated PR.

**Components:** `worker/epic/coordinator.ts`, `executor.ts`, `experts.ts`, `coordination-client.ts`

### Multi-Provider Mode (Sequential)

Planning Agent decomposes task → Stories execute sequentially → Each persona routes to configured provider → Coordination feed → Consolidated PR.

**Components:** `worker/multi-expert/index.ts`, `coordination-client.ts`, `worker/agents/ai-sdk-executor.js`

### Phased Execution Mode (add `phased` label)

Each story broken into discrete phases with fresh context:
```
ANALYZE → IMPLEMENT (per unit) → INTEGRATE → VERIFY ↔ FIX → COMMIT
```

**Components:** `worker/epic/phased-executor.ts`, `worker/epic/phases/*.ts`

### Standard SDK Mode (add `sdk` label)

Single-task execution via Claude Agent SDK (no story decomposition).

---

## Infrastructure

### Environment Configuration

**Production** (`environments/prod/`) - workermill.com

| Resource | Value |
|----------|-------|
| AWS Account | AWS_ACCOUNT_ID |
| AWS Region | us-east-1 |
| ECS Cluster | workermill-dev (historical naming) |
| API Service | workermill-dev-api |
| CloudFront | CLOUDFRONT_DIST_ID |
| Cognito User Pool | COGNITO_POOL_ID |
| Cognito Client | COGNITO_CLIENT_ID |
| State Key | `workermill/prod/terraform.tfstate` |

**Development** (`environments/dev/`) - dev.workermill.com

| Resource | Value |
|----------|-------|
| ECS Cluster | workermill-sandbox |
| API Service | workermill-sandbox-api |
| CloudFront | CLOUDFRONT_DIST_ID_2 |
| Cognito User Pool | us-east-1_Ps3yuO3KA |
| Cognito Client | 57dam1feas0q2ir8fkhb6s0v3g |
| VPC CIDR | 10.2.0.0/16 (isolated from prod) |
| State Key | `workermill/sandbox/terraform.tfstate` |

**Note:** Dev has separate Cognito - users must register separately.

### Terraform Commands

```bash
# Production
cd infrastructure/terraform/environments/prod
terraform init -backend-config="bucket=workermill-terraform-state-AWS_ACCOUNT_ID"
terraform plan -var="domain_name=workermill.com"
terraform apply -var="domain_name=workermill.com"

# Development
cd infrastructure/terraform/environments/dev
terraform init -backend-config="bucket=workermill-terraform-state-AWS_ACCOUNT_ID"
terraform plan && terraform apply
```

### SES Email Configuration

**Cross-region setup required:** WorkerMill runs in us-east-1, but SES was set up in us-east-2 for production sending access.

| Purpose | Region | Notes |
|---------|--------|-------|
| **Outbound emails** (invites, notifications) | us-east-2 | Has production access, can send to any email |
| **Inbound emails** (receiving) | us-east-1 | Lambda, S3 integration |

**Do not change this configuration.** All outbound email uses us-east-2 SES.

---

## Troubleshooting

```bash
# View ECS service status
aws ecs describe-services --cluster workermill-dev --services workermill-dev-api --region us-east-1

# Tail API logs (use MSYS_NO_PATHCONV=1 in Git Bash)
MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-dev/api" --follow --region us-east-1

# Tail worker logs
MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-dev/worker" --follow --region us-east-1

# Database access via SSM
MSYS_NO_PATHCONV=1 aws ecs list-tasks --cluster workermill-dev --region us-east-1
# Then: aws ecs execute-command --container api
```

### Common Issues

| Problem | Check |
|---------|-------|
| Task stuck "running" | `aws ecs list-tasks`, CloudWatch for exit 137 (Spot) or exit 1 |
| Worker not posting logs | Verify org `apiKey` set, check worker logs for POST errors |
| Task not claimed | `GET /api/orchestrator/status`, verify task status is `queued` |
| PR not created | Branch conflicts, token permissions, rate limits |
| Epic not progressing | `GET /api/coordination/feed/:taskId`, verify planning agent completed |

### Windows/Git Bash

| Issue | Solution |
|-------|----------|
| AWS CLI path conversion | Prefix with `MSYS_NO_PATHCONV=1` |
| AWS CLI Unicode errors | Set `PYTHONIOENCODING=utf-8` |
| Shell parsing errors with `$(...)` | Spawn a Task agent instead of debugging |
| Docker layer caching | deploy.sh uses `--no-cache` - NEVER build with cache |

---

## Hooks & Skills

**Auto-formatting:** Prettier runs automatically after Write/Edit to `.ts`/`.tsx`/`.js`/`.jsx` files.

### /val-imp

Enforces strict plan adherence: extracts requirements, implements one at a time, spawns independent validator agent after each.

**Usage:** `/val-imp docs/my-feature-plan.md`

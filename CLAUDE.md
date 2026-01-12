# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WorkerMill is mission control for autonomous AI coding agents - a real-time monitoring and orchestration system for AI workers that execute coding tasks ("htop for AI workers"). It's deployed at https://workermill.com.

**Stack:**
- **Backend API**: Express + TypeScript + TypeORM + PostgreSQL (`api/`)
- **Frontend**: React 19 + Vite + TailwindCSS + Zustand (`frontend/`)
- **Infrastructure**: Terraform → AWS (ECS Fargate, RDS, S3, CloudFront)
- **Worker Containers**: Docker images with Claude Code for task execution (`worker/`)

**Current Development Phase:** Testing against the **oncallshift** repository with Jira tickets from the **OCS** project triggering AI worker tasks.

### Reference Repository

The **oncallshift** codebase (local path: `/mnt/c/Users/jarod/github/pagerduty-lite`) contains the original working implementation that WorkerMill is decoupled from. When implementing features, reference that repo for patterns:
- `backend/src/api/routes/ai-worker-webhooks.ts` - Jira/GitHub webhook handling
- `backend/src/workers/ai-worker-orchestrator.ts` - Task orchestration and ECS spawning
- `backend/src/shared/services/ecs-task-runner.ts` - ECS Fargate task runner
- `backend/ai-worker/scripts/log-parser.cjs` - Claude CLI log parsing
- `backend/ai-worker/directives/` - Worker persona directives
- `backend/src/api/routes/super-admin.ts` - Log streaming SSE endpoints (lines 965-1273)
- `frontend/src/pages/SuperAdminControlCenter.tsx` - Terminal log display and SSE handling

**IMPORTANT:** The repo folder is named `pagerduty-lite` but the project is called **oncallshift**.

### DO NOT DEVIATE FROM ONCALLSHIFT PATTERNS

**CRITICAL: The OnCallShift implementation is the source of truth. Do NOT try to "improve" or replace working solutions.**

Working solutions that must NOT be changed without explicit user request:
- **Log streaming**: Uses PostgreSQL + SSE, NOT CloudWatch. Worker posts to `/api/control-center/logs`, SSE streams from database every 1 second. This took a week to get working.
- **Task orchestration**: Polls database for queued tasks, claims atomically, spawns ECS
- **Worker entrypoint**: Posts logs to API during execution via `post_log()` function

If you think something could be "better" (CloudWatch, WebSockets, etc.), **ASK FIRST**. Do not make architectural changes to proven patterns.

### Codebase Structure

There are **two parallel codebases**:

1. **Production services** (`api/`, `frontend/`, `worker/`) - Deployed to AWS
2. **Monorepo packages** (`packages/*`) - Original modular architecture, not actively deployed

Focus development on `api/`, `frontend/`, and `worker/` directories.

## Communication Style

**Be transparent and narrate your work.** Share what you're doing before starting, what you find during exploration, your reasoning on decisions, and summarize what was done after completing work.

**Parallelize your work whenever possible.** Run independent tasks concurrently - for example, build API while updating frontend, or deploy while writing tests. Use background tasks and parallel tool calls to maximize efficiency.

## Build and Development Commands

### API Server (`api/`)
```bash
cd api
npm install
npm run dev          # Development with hot-reload (tsx watch)
npm run build        # Compile TypeScript
npm run typecheck    # Type check without emitting (npx tsc --noEmit)
npm run lint         # ESLint
npm run migrate      # Run database migrations
npm run migrate:create NAME  # Create new migration
npm run seed         # Seed database
```

### Frontend (`frontend/`)
```bash
cd frontend
npm install
npm run dev          # Vite dev server (localhost:5173)
npm run build        # Build for production (includes tsc)
npm run lint         # ESLint
npx tsc -b           # Type check only
```

### Local Development (Docker Compose)
```bash
docker-compose up -d postgres  # Start PostgreSQL only
docker-compose up -d           # Start all services (PostgreSQL, API, Dashboard)
# Dashboard: http://localhost:3000 | API: http://localhost:4000
```

### Deployment

**ALWAYS use `deploy.sh` for ALL deployments.** Never manually build/push Docker images.

```bash
./deploy.sh              # Full deployment
./deploy.sh --api        # Deploy API only
./deploy.sh --frontend   # Deploy frontend only
./deploy.sh --all        # Deploy everything
```

**IMPORTANT:** Run `./deploy.sh --frontend` after UI changes so they're visible at https://workermill.com.

### Infrastructure (Terraform)
```bash
cd infrastructure/terraform/environments/dev
terraform init
terraform plan -var="domain_name=workermill.com"
terraform apply -var="domain_name=workermill.com"
```

## Agent Workflow Guidelines

**Spawn parallel agents for cross-stack work.** This is a full-stack app where API, frontend, and infrastructure work can run concurrently.

| Task | Parallel Approach |
|------|-------------------|
| Add new API endpoint + UI | Agent 1: backend route, Agent 2: frontend page |
| Add new model + routes | Agent 1: TypeORM model + migration, Agent 2: API routes |
| Type checking | Run `npx tsc --noEmit` in api/ and frontend/ in parallel |

### Progress Tracking

For multi-phase implementations, track progress in `.claude/progress/<feature-name>.md` to enable resumption if interrupted.

## Jira Integration

### Triggering AI Workers

Add the `workermill` label to a Jira ticket to trigger an AI worker task. Additional labels control behavior:

| Label | Purpose |
|-------|---------|
| `workermill` | **Required** - Triggers WorkerMill processing |
| `haiku` / `sonnet` / `opus` | Model selection (default: haiku) |
| `deploy` | Enable auto-deployment after PR approval |
| `review` | Require manager review before merge |

**Webhook:** `https://workermill.com/api/webhooks/jira` (JQL: `labels = workermill`)

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

### Jira Projects and Permissions

The MCP Jira tools authenticate as Jarod Rosenthal (rosenthal.jarod@gmail.com). Available projects:

| Project | Key | DELETE_ISSUES | Notes |
|---------|-----|---------------|-------|
| oncallshift | OCS | ✅ Yes | Primary project for AI worker tasks |
| WorkerMill | WM | ✅ Yes | Internal tracking (fixed 2025-01-11) |
| Billing System Dev | SAM1 | Unknown | Example/demo project |

**Permission troubleshooting:** DELETE_ISSUES requires the "Administrators" project role (ID 10002). If deletes fail, add the user to the project's Administrators role:
```
# Check current admins
jira_get path="/rest/api/3/project/{KEY}/role/10002"

# Add user to Administrators role
jira_post path="/rest/api/3/project/{KEY}/role/10002" body={"user": ["ACCOUNT_ID"]}
```

**IMPORTANT: Issue type IDs are project-specific.** Don't use global type IDs. Query the project first:

```
jira_get path="/rest/api/3/project/OCS" jq="issueTypes[*].{id: id, name: name}"
```

**OCS Project Issue Types:**
| Type | ID |
|------|-----|
| Story | 10008 |
| Task | 10009 |
| Bug | 10010 |

### Ticket Structure Standards

Every ticket should include:

1. **User Story**: `As a [role], I want [capability], So that [benefit].`

2. **Acceptance Criteria** (Gherkin format):
   ```
   GIVEN [initial context]
   WHEN [action is taken]
   THEN [expected outcome]
   ```

3. **Definition of Done** (checkbox list of completion criteria)

4. **Technical Notes**: Target file, persona, scope limitations

### Task Completion

After completing a Jira ticket:
1. Add completion comment (what was done, files modified, verification performed)
2. Transition to Done via Jira MCP tools:
   - `jira_post` to `/rest/api/3/issue/{issueKey}/comment`
   - `jira_get` to `/rest/api/3/issue/{issueKey}/transitions`
   - `jira_post` to `/rest/api/3/issue/{issueKey}/transitions`

### Branch Naming

```
<type>/<ticket-number>-<short-description>
```
Types: `feature/`, `fix/`, `refactor/`, `infra/`, `security/`

## Hooks

Auto-formatting via Prettier runs automatically after Write/Edit to `.ts`/`.tsx`/`.js`/`.jsx` files (configured in `.claude/settings.json`).

## Windows/Git Bash Environment

**CRITICAL: The Bash tool runs in Git Bash on Windows with shell parsing limitations.** When commands fail with syntax errors involving `$(...)` or variable expansion, spawn a Task agent immediately - don't debug Git Bash quirks.

### Common Issues

| Issue | Solution |
|-------|----------|
| AWS CLI path conversion | Prefix with `MSYS_NO_PATHCONV=1` |
| AWS CLI Unicode errors | Set `PYTHONIOENCODING=utf-8` |
| Terraform not in PATH | Use full path or `terraform.exe` |
| ECS image caching | Use versioned tags (`:v1`, `:v2`) instead of `:latest` |

## Architecture Overview

### Key Models (`api/src/models/`)
- `WorkerTask` - Task state, cost tracking, git info
- `Organization` - Multi-tenant organization support

### Worker System (`worker/`)
Worker containers execute tasks with Claude Code. Directives in `worker/directives/` define role-specific behavior:
- `backend_developer/`, `frontend_developer/`, `devops_engineer/`
- `security_engineer/`, `qa_engineer/`, `tech_writer/`, `project_manager/`

See `worker/AGENTS.md` for comprehensive worker instructions.

### Task Flow
Jira webhook → API receives task → Queue message → Claim task → Spawn ECS container → Monitor completion → Parse output markers (`::result::`, `::pr_url::`) → Update status

### Real-time Log Streaming

**Worker logs are stored in the database (not CloudWatch)** for faster SSE streaming:

1. Workers post logs to `POST /api/tasks/:taskId/logs` with org API key auth
2. Logs stored in `worker_task_logs` table
3. Dashboard streams via `GET /api/control-center/logs/:taskId/stream` (SSE)
4. Polling interval: 500ms (much faster than CloudWatch's 1s minimum)

**Important:** The org's `apiKey` must be set for workers to authenticate log posts. The migration `1704067200007-GenerateOrgApiKeys.ts` ensures all orgs have keys.

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

### Production Configuration

| Resource | Value |
|----------|-------|
| AWS Account | AWS_ACCOUNT_ID |
| AWS Region | us-east-1 |
| ECS Cluster | workermill-dev |
| API Service | workermill-dev-api |
| S3 Bucket | workermill-dev-frontend-AWS_ACCOUNT_ID |
| CloudFront Distribution | CLOUDFRONT_DIST_ID |
| Live URL | https://workermill.com |
| Cognito User Pool ID | COGNITO_POOL_ID |
| Cognito Web Client ID | COGNITO_CLIENT_ID |

## Organization Settings System

Organization settings are configurable per-tenant and stored in the `organizations` table:

### Data Management Settings
| Setting | Default | Description |
|---------|---------|-------------|
| `logRetentionDays` | 30 | Days to retain task logs before cleanup |
| `taskRetentionDays` | 90 | Days to retain completed tasks |

### Worker Settings
| Setting | Default | Description |
|---------|---------|-------------|
| `maxConcurrentWorkers` | 3 | Max parallel workers per org |
| `defaultMaxRetries` | 3 | Default retry attempts for failed tasks |
| `taskCooldownSeconds` | 30 | Time before a Jira ticket can be re-picked up |
| `defaultWorkerModel` | claude-3-5-haiku-20241022 | Default AI model |
| `defaultWorkerPersona` | backend_developer | Default worker role |

### Cost Settings
| Setting | Default | Description |
|---------|---------|-------------|
| `costAlertThresholdUsd` | null | Alert when costs exceed this amount |

### API Endpoints
- `GET /api/settings` - Get all org settings
- `PUT /api/settings` - Update org settings (admin only)

### Log Cleanup
The orchestrator runs a cleanup loop hourly that removes logs older than `org.logRetentionDays`. This prevents unbounded database growth from terminal log storage.

## Security Requirements

**FORBIDDEN:**
- `NODE_TLS_REJECT_UNAUTHORIZED=0` (never disable TLS)
- Hardcoded credentials in code
- `Resource: "*"` with destructive IAM actions
- Overly permissive security groups (0.0.0.0/0 for non-public services)

**REQUIRED:**
- Use AWS Secrets Manager for credentials (path: `workermill/dev/*`)
- Scope IAM policies to `arn:aws:*:*:*:workermill-*`
- Use express-validator for all API inputs

## Troubleshooting

```bash
# View ECS service status
aws ecs describe-services --cluster workermill-dev --services workermill-dev-api --region us-east-1

# Tail API logs (use MSYS_NO_PATHCONV=1 in Git Bash)
MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-dev/api" --follow --region us-east-1

# Tail worker logs
MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-dev/worker" --follow --region us-east-1
```

### Database Access via SSM

Use ECS Execute Command to run database queries directly from the API container:

```bash
# 1. Get the running API task ID
MSYS_NO_PATHCONV=1 aws ecs list-tasks --cluster workermill-dev --region us-east-1

# 2. Query database (replace TASK_ID with actual task ID)
MSYS_NO_PATHCONV=1 PYTHONIOENCODING=utf-8 aws ecs execute-command \
  --cluster workermill-dev \
  --task "TASK_ID" \
  --container api \
  --command "node -e \"const { AppDataSource } = require('./dist/db/connection.js'); AppDataSource.initialize().then(async ds => { const result = await ds.query('SELECT id, jira_issue_key, status FROM worker_tasks LIMIT 10'); console.log(JSON.stringify(result, null, 2)); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });\"" \
  --interactive \
  --region us-east-1

# 3. Delete tasks by Jira key pattern (example: delete all WM-* tasks)
MSYS_NO_PATHCONV=1 PYTHONIOENCODING=utf-8 aws ecs execute-command \
  --cluster workermill-dev \
  --task "TASK_ID" \
  --container api \
  --command "node -e \"const { AppDataSource } = require('./dist/db/connection.js'); AppDataSource.initialize().then(async ds => { const result = await ds.query(\\\"DELETE FROM worker_tasks WHERE jira_issue_key LIKE 'WM-%' RETURNING id, jira_issue_key\\\"); console.log('Deleted', result.length, 'tasks'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });\"" \
  --interactive \
  --region us-east-1
```

**Note:** SSM Execute Command requires the ECS task to have the `enableExecuteCommand` option enabled (set in Terraform).

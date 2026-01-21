# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

**Migrations run automatically on API startup.** When the API container starts, it checks for pending migrations and runs them before accepting requests. This ensures the database schema is always in sync.

**Creating a new migration:**
1. Create migration file: `cd api && npm run migrate:create AddMyNewColumn`
2. Edit the generated file in `api/src/db/migrations/`
3. **CRITICAL:** Register the migration in `api/src/db/connection.ts`:
   - Add the import at the top
   - Add to the `migrations` array
4. Deploy: `./deploy.sh --api`

**Migration file template:**
```typescript
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMyNewColumn1234567890 implements MigrationInterface {
  name = "AddMyNewColumn1234567890";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE my_table
      ADD COLUMN IF NOT EXISTS my_column VARCHAR(255) DEFAULT 'value'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE my_table
      DROP COLUMN IF EXISTS my_column
    `);
  }
}
```

**IMPORTANT:** Always use `IF NOT EXISTS` / `IF EXISTS` in migrations for idempotency.

**Validation:** The deploy script automatically checks that all migration files are registered before deployment. If you forget to register a migration, the deploy will fail with a clear error message showing which migrations are missing.

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
```bash
cd worker/execution
npm install
npm run build        # Compile TypeScript to execution-compiled/
```

Worker scripts are in `worker/execution/` (TypeScript) and compiled to `worker/execution-compiled/` (JavaScript). Workers call the compiled JS versions at runtime.

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
terraform init -backend-config="bucket=workermill-terraform-state-AWS_ACCOUNT_ID"
terraform plan -var="domain_name=workermill.com"
terraform apply -var="domain_name=workermill.com"

# Development
cd infrastructure/terraform/environments/dev
terraform init -backend-config="bucket=workermill-terraform-state-AWS_ACCOUNT_ID"
terraform plan
terraform apply
```

**Note on resource naming:** Production resources are named `workermill-dev-*` due to historical naming. The folder structure reflects intent - see `docs/FUTURE_RESOURCE_RENAME_MIGRATION.md` for the future cleanup plan.

## Jira Integration

### Triggering AI Workers

Add the `workermill` label to a Jira ticket to trigger an AI worker task. Additional labels control behavior:

| Label | Purpose |
|-------|---------|
| `workermill` | **Required** - Triggers WorkerMill processing |
| `haiku` / `sonnet` / `opus` | Model selection (default: haiku) |
| `deploy` | **Auto-deploy**: Skip PR approval, merge and deploy immediately |
| `review` | Require manager review before merge |

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

The MCP Jira tools authenticate as Jarod Rosenthal (user@example.com). Available projects:

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
| Task | 10041 |
| Bug | 10043 |
| Epic | 10000 |
| Sub-task | 10042 |

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
| deploy.sh JSON parsing error | Build pushes successfully but task definition fails; use terraform directly (see below) |

**deploy.sh JSON Parsing Workaround:**

When `deploy.sh --worker` fails with "Error parsing parameter 'cli-input-json': Invalid JSON received", the Docker image was pushed successfully but the task definition update failed. Work around by applying terraform directly:

```bash
# After deploy.sh fails, get the digest from the output (e.g., sha256:abc123...)
# Then apply terraform with the digest:
cd infrastructure/terraform/environments/dev
terraform apply -auto-approve -var="domain_name=workermill.com" -var="worker_image_digest=sha256:abc123..."
```

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

### Worker System (`worker/`)
Worker containers execute tasks with Claude Code. Directives in `worker/directives/` define role-specific behavior:
- `backend_developer/`, `frontend_developer/`, `devops_engineer/`
- `security_engineer/`, `qa_engineer/`, `tech_writer/`, `project_manager/`

See `worker/AGENTS.md` for comprehensive worker instructions.

### Multi-Provider AI Support

Workers support multiple AI providers via the `WORKER_PROVIDER` environment variable:

| Provider | Tool | Models | Use Case |
|----------|------|--------|----------|
| `anthropic` (default) | Claude Code CLI | claude-haiku-4-5, claude-sonnet-4, claude-opus-4 | Production tasks, complex code changes |
| `ollama` | Aider | qwen3-coder:30b, llama3.1:70b, etc. | Self-hosted, cost-free local models |
| `openai` | Aider | gpt-4o, gpt-4-turbo, etc. | OpenAI-compatible endpoints |

**Triggering different providers via Jira labels:**
- `ollama` label → Uses Ollama provider with Aider
- `haiku` / `sonnet` / `opus` labels → Anthropic models via Claude Code
- No model label → Uses org default (`defaultWorkerModel` setting)

**Ollama Configuration:**
- `OLLAMA_HOST` env var sets the Ollama server URL (default: `http://host.docker.internal:11434`)
- Production uses `https://ollama.therealjarod.com` (configured in secrets)
- Context window is extended to 32768 tokens via `--model-metadata-file`

### Aider Integration Details

Aider provides agentic capabilities for non-Anthropic models. Key configuration:

| Setting | Value | Purpose |
|---------|-------|---------|
| `--edit-format diff` | SEARCH/REPLACE blocks | Structured file editing |
| `--no-auto-commits` | Disabled | WorkerMill manages git commits |
| `--no-pretty` | Disabled | Clean output for log parsing |
| `--map-tokens 4096` | Repo map size | Gives model codebase context |
| `--model-metadata-file` | JSON config | Extended context window (32K tokens) |

**Common Aider Issues and Solutions:**

| Issue | Symptom | Solution |
|-------|---------|----------|
| Model outputs bash commands | "No changes required" even though task needs edits | Updated Aider instructions to explicitly forbid bash commands |
| Context window too small | Model truncates response or misses context | Add `max_input_tokens: 32768` in model metadata file |
| Model can't see files | "Git repo: none" in logs | Use `--no-auto-commits` instead of `--no-git` |
| SEARCH/REPLACE not parsed | Model describes changes but doesn't make them | Use `--edit-format diff` and include examples in prompt |

**Aider Prompt Structure:**
The prompt includes Aider-specific instructions BEFORE the task content:
1. Rules forbidding bash commands
2. SEARCH/REPLACE block format with examples
3. Workflow instructions (understand → identify files → edit → explain)
4. Then the actual task from Jira ticket

These instructions are ONLY added for `ollama` and `openai` providers - Claude Code (anthropic) uses its native capabilities.

### Key API Routes (`api/src/routes/`)
- `webhooks.ts` - Webhook receivers:
  - `POST /api/webhooks/jira` - Jira issue events
  - `POST /api/webhooks/linear` - Linear issue events
  - `POST /api/webhooks/github` - GitHub PR reviews
  - `POST /api/webhooks/github-issues` - GitHub Issues
- `control-center.ts` - Task management and log streaming SSE
- `tasks.ts` - Worker log ingestion (`POST /api/tasks/:taskId/logs`)
- `orchestrator.ts` - System control (start/stop/status)
- `manager.ts` - Virtual manager review endpoints
- `settings.ts` - Organization settings CRUD
- `auth.ts` - Cognito JWT verification
- `billing.ts` - Stripe billing integration:
  - `GET /api/billing/status` - Current plan and usage
  - `POST /api/billing/checkout` - Create Stripe checkout session
  - `POST /api/billing/portal` - Create billing portal session
- `analytics.ts` - Usage analytics:
  - `GET /api/analytics/tasks` - Task statistics
  - `GET /api/analytics/costs` - Cost breakdown by model/persona
  - `GET /api/analytics/workers` - Worker performance stats
- `audit.ts` - Audit logging (admin only):
  - `GET /api/audit/logs` - Query audit logs with filters
  - `GET /api/audit/summary` - Activity summary for dashboard
  - `GET /api/audit/export` - JSON export for compliance
- `coordination.ts` - Multi-worker coordination:
  - `POST /api/coordination/manifest/declare` - Lock files for editing
  - `GET /api/coordination/locks` - View active file locks

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

### Environment Configuration

**Production** (`environments/prod/`) - Customer-facing at workermill.com

| Resource | Value | Notes |
|----------|-------|-------|
| AWS Account | AWS_ACCOUNT_ID | |
| AWS Region | us-east-1 | |
| ECS Cluster | workermill-dev | Historical naming - see migration doc |
| API Service | workermill-dev-api | Historical naming |
| S3 Bucket | workermill-dev-frontend-AWS_ACCOUNT_ID | |
| CloudFront Distribution | CLOUDFRONT_DIST_ID | |
| Live URL | https://workermill.com | |
| Cognito User Pool ID | COGNITO_POOL_ID | |
| Cognito Web Client ID | COGNITO_CLIENT_ID | |
| Terraform Folder | `environments/prod/` | |
| State Key | `workermill/prod/terraform.tfstate` | |

**Development** (`environments/dev/`) - For testing at dev.workermill.com

| Resource | Value |
|----------|-------|
| ECS Cluster | workermill-sandbox |
| API Service | workermill-sandbox-api |
| S3 Bucket | workermill-sandbox-frontend-AWS_ACCOUNT_ID |
| CloudFront Distribution | CLOUDFRONT_DIST_ID_2 |
| Live URL | https://dev.workermill.com |
| Cognito User Pool ID | REDACTED_COGNITO_POOL_ID |
| Cognito Web Client ID | REDACTED_COGNITO_CLIENT_ID |
| RDS Endpoint | REDACTED_RDS_ENDPOINT |
| Terraform Folder | `environments/dev/` |
| State Key | `workermill/sandbox/terraform.tfstate` |
| VPC CIDR | REDACTED_VPC_CIDR (isolated from prod) |
| Secrets Prefix | workermill/sandbox/* |

**Note:** Dev environment has separate Cognito user pool - users must register separately for dev.

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
| `defaultWorkerModel` | claude-haiku-4-5-20251001 | Default AI model |
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

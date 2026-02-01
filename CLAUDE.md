***REMOVED*** CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

***REMOVED******REMOVED*** ⛔ Critical Rules - READ FIRST

***REMOVED******REMOVED******REMOVED*** DO NOT CHANGE Working Patterns

**These working solutions must NOT be changed without explicit user request:**

| Pattern | Implementation | Why It's Sacred |
|---------|----------------|-----------------|
| **Log streaming** | PostgreSQL + SSE, NOT CloudWatch | Took a week to get working. Worker posts to `/api/tasks/:taskId/logs`, SSE streams from database every 500ms. |
| **Task orchestration** | Database polling with atomic claim | Polls for queued tasks, claims via UPDATE...WHERE, spawns ECS |
| **Worker entrypoint** | `post_log()` shell function | Posts terminal output to API in real-time |
| **LLM Models** | NEVER change without approval | No default model changes, no provider switches, no model name changes in code/env/config |

**If you think something could be "better" (CloudWatch, WebSockets, etc.), ASK FIRST.**

***REMOVED******REMOVED******REMOVED*** DO NOT Relax Security

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

***REMOVED******REMOVED******REMOVED*** DO NOT Modify Infrastructure Outside Terraform

**Terraform is the ONLY source of truth. NEVER:**
- Create AWS resources via console
- Manually modify ECS task definitions
- Push Docker images without using `deploy.sh`
- Change security groups, IAM roles, or networking outside Terraform

***REMOVED******REMOVED******REMOVED*** DO NOT Add Labels When Creating Jira Tickets

**Create tickets with NO LABELS.** The `workermill` label triggers automatic AI worker deployment. Adding labels without explicit permission has caused production incidents.

**Only add labels AFTER ticket creation, with explicit user approval.**

***REMOVED******REMOVED******REMOVED*** DO NOT Auto-Process Stale Tasks

When fixing orchestrator bugs:
- Do NOT add code that bulk-processes stuck tasks
- Add staleness checks (skip tasks older than 1 hour)
- Fix the bug for future tasks, leave existing stuck tasks alone
- User controls task execution via dashboard UI

***REMOVED******REMOVED******REMOVED*** DO NOT Use Outdated Bitbucket Auth

**Bitbucket uses Repository Access Tokens, NOT app passwords (deprecated).**

| Use Case | Correct Method |
|----------|----------------|
| REST API | `Authorization: Bearer <token>` |
| Git URLs | `https://x-token-auth:<token>@bitbucket.org/...` |

**WRONG:** `Basic auth with username:app_password` - this is deprecated
**RIGHT:** `Bearer token` for API, `x-token-auth` for git

See "Bitbucket Authentication" section below for full details.

***REMOVED******REMOVED******REMOVED*** DO NOT Make Changes Without Communicating

- **Before any code change**: Explain what you're about to modify
- **When instructions are unclear**: Ask, don't assume
- **Before deploying**: Wait for explicit approval ("go", "yes", "deploy")
- **Keep changes minimal**: Only do what was asked, nothing extra
- **No silent deployments**: Always state what's being deployed

***REMOVED******REMOVED******REMOVED*** DO NOT Deploy to Dev Environment

**The dev environment (dev.workermill.com) is NOT RUNNING.** Always deploy to prod:
- Use `./deploy.sh --api` (NOT `--env dev`)
- Use `./deploy.sh --frontend` (NOT `--env dev`)
- Use `./deploy.sh --worker` (NOT `--env dev`)

---

***REMOVED******REMOVED*** Quick Reference

| Task | Command |
|------|---------|
| Type check API | `cd api && npm run typecheck` |
| Type check frontend | `cd frontend && npx tsc -b` |
| Deploy API (prod) | `./deploy.sh --api` |
| Deploy frontend | `./deploy.sh --frontend` |
| Deploy worker | `./deploy.sh --worker` |
| Create migration | `cd api && npm run migrate:create NAME` |
| Tail API logs | `MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-dev/api" --follow --region us-east-1` |
| Build worker scripts | `cd worker/execution && npm run build` |
| Lint API | `cd api && npm run lint` |
| Lint frontend | `cd frontend && npm run lint` |
| Run API tests (Vitest) | `cd api && npm run test` |
| Run single API test | `cd api && npx vitest run src/routes/tasks.test.ts` |
| Run API tests (watch) | `cd api && npm run test:watch` |
| Run integration tests | `cd api && npm run test:integration` |
| Run E2E tests (Playwright) | `cd frontend && npm run test:e2e` |
| Run E2E tests (headed) | `cd frontend && npm run test:e2e:headed` |
| Run E2E tests (UI mode) | `cd frontend && npm run test:e2e:ui` |
| Seed database | `cd api && npm run seed` |
| Run frontend dev | `cd frontend && npm run dev` |
| Run API dev | `cd api && npm run dev` |
| **Validated implementation** | `/val-imp [plan-file]` |
| **Start bastion** | `./bin/bastion start` |
| **Stop bastion** | `./bin/bastion stop` |
| **Bastion status** | `./bin/bastion status` |
| **SSH to bastion** | `./bin/bastion ssh` |

**Key files:**
- API routes: `api/src/routes/`
- Models: `api/src/models/`
- Services: `api/src/services/`
- Migrations: `api/src/db/migrations/`
- Worker directives: `worker/directives/`
- Frontend pages: `frontend/src/pages/`
- Frontend components: `frontend/src/components/`
- Frontend stores: `frontend/src/stores/`
- Integration tests: `api/src/__tests__/integration/`
- E2E tests: `frontend/e2e/`

---

***REMOVED******REMOVED*** Local Development

Local development uses an SSH bastion to tunnel to the production RDS database. The bastion is a t4g.nano Spot instance (~$0.001/hr) that starts on-demand.

***REMOVED******REMOVED******REMOVED*** Starting Local Dev Environment

```bash
***REMOVED*** 1. Start the bastion (auto-detects and whitelists your IP)
./bin/bastion start

***REMOVED*** 2. Wait ~60 seconds for instance to boot, then check status
./bin/bastion status

***REMOVED*** 3. Create SSH tunnel to RDS (keeps running in foreground)
./bin/bastion ssh

***REMOVED*** 4. In another terminal, get the DB password
aws secretsmanager get-secret-value --secret-id workermill/dev/database-url --query 'SecretString' --output text

***REMOVED*** 5. Run the API locally with tunnel
cd api
DATABASE_URL=postgresql://workermill:<password>@localhost:5432/workermill npm run dev
```

***REMOVED******REMOVED******REMOVED*** Bastion Commands

| Command | Description |
|---------|-------------|
| `./bin/bastion start` | Start bastion, whitelist your IP |
| `./bin/bastion stop` | Stop bastion (saves cost) |
| `./bin/bastion status` | Show status, public IP, SSH command |
| `./bin/bastion ssh` | Connect with port forwarding (5432→RDS) |
| `./bin/bastion whitelist` | Update security group with current IP |

***REMOVED******REMOVED******REMOVED*** Direct Database Access

Once SSH tunnel is running (`./bin/bastion ssh`):

```bash
***REMOVED*** Connect via psql
psql -h localhost -p 5432 -U workermill -d workermill

***REMOVED*** Or from the bastion itself (has psql installed)
***REMOVED*** In the SSH session, use the pre-configured alias:
psql-workermill
```

***REMOVED******REMOVED******REMOVED*** SSH Key Location

The bastion SSH key is at `~/.ssh/workermill-bastion` (ED25519, no passphrase).

---

***REMOVED******REMOVED*** Project Overview

WorkerMill is mission control for autonomous AI coding agents - a real-time monitoring and orchestration system for AI workers that execute coding tasks ("htop for AI workers"). Deployed at https://workermill.com.

**Stack:**
- **Backend API**: Express + TypeScript + TypeORM + PostgreSQL (`api/`)
- **Frontend**: React 19 + Vite + TailwindCSS + Zustand (`frontend/`)
- **Infrastructure**: Terraform → AWS (ECS Fargate, RDS, S3, CloudFront) in us-east-1
- **Worker Containers**: Docker images with Claude Code for task execution (`worker/`)
- **Testing**: Vitest (API unit/integration), Playwright (E2E)

**Requirements:** Node.js >= 20.0.0

**Current Development Phase:** Production deployment testing with **oncallshift** repositories (Bitbucket). Jira tickets from the **OCS** project trigger AI worker tasks against the split repos: `oncallshift-api`, `oncallshift-web`, `oncallshift-mobile`.

***REMOVED******REMOVED******REMOVED*** WorkerMill vs Target Repositories

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

***REMOVED******REMOVED******REMOVED*** Codebase Structure

Focus on these directories (production services):
- `api/` - Backend API deployed to ECS
- `frontend/` - React dashboard deployed to CloudFront
- `worker/` - Worker container images

Ignore `packages/*` - original modular architecture, not actively deployed.

***REMOVED******REMOVED******REMOVED*** Documentation Pages

Documentation is available at https://workermill.com/docs with these sections:

| Page | Path | Description |
|------|------|-------------|
| Overview | `/docs` | Getting started guide |
| Quick Start | `/docs/quick-start` | 5-minute setup walkthrough |
| Integrations | `/docs/integrations` | Jira, Linear, GitHub, GitLab, Bitbucket setup |
| Task Lifecycle | `/docs/task-lifecycle` | Task states and transitions |
| Personas | `/docs/personas` | Worker role configuration |
| Epics | `/docs/epics` | Epic/PRD workflow |
| Analytics | `/docs/analytics` | Metrics and dashboards |
| MCP | `/docs/mcp` | MCP server integration |
| Advanced | `/docs/advanced` | Power user features |

---

***REMOVED******REMOVED*** Deployment

**ALWAYS use `deploy.sh` for ALL deployments.** Never manually build/push Docker images.

```bash
***REMOVED*** Production (workermill.com)
./deploy.sh --api                    ***REMOVED*** Deploy API
./deploy.sh --worker                 ***REMOVED*** Deploy worker image
./deploy.sh --frontend               ***REMOVED*** Deploy frontend
./deploy.sh --all                    ***REMOVED*** Deploy everything

***REMOVED*** Options
./deploy.sh --all --skip-build       ***REMOVED*** Skip rebuilding
./deploy.sh --help                   ***REMOVED*** Show all options
```

**IMPORTANT:** Run `./deploy.sh --frontend` after UI changes.

***REMOVED******REMOVED******REMOVED*** Database Migrations

**Migrations run automatically on API startup.**

1. `cd api && npm run migrate:create AddMyNewColumn`
2. Edit the generated file in `api/src/db/migrations/`
3. **CRITICAL:** Register in `api/src/db/connection.ts` (import + add to `migrations` array)
4. Deploy: `./deploy.sh --api`

**Rules:**
- Always use `IF NOT EXISTS` / `IF EXISTS` for idempotency
- Deploy script validates all migrations are registered

***REMOVED******REMOVED******REMOVED*** Worker Execution Scripts

Worker scripts in `worker/execution/` (TypeScript) compile to `worker/execution-compiled/` (JavaScript).

```bash
cd worker/execution && npm run build   ***REMOVED*** Rebuild and commit compiled output
```

---

***REMOVED******REMOVED*** Git Workflow

**Always work directly on `main` branch.** Do NOT create feature branches.

**Why:** Multiple Claude Code terminals may work simultaneously. Working on `main` ensures all agents see changes immediately.

| Change Type | Visibility |
|-------------|------------|
| Uncommitted file edits | Instant (shared filesystem) |
| Committed changes | Requires `git pull` in other terminals |

**Before changes:** `git pull`
**After changes:** Commit and push promptly

---

***REMOVED******REMOVED*** Jira Integration

***REMOVED******REMOVED******REMOVED*** Triggering AI Workers

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

***REMOVED******REMOVED******REMOVED*** Jira Projects

| Project | Key | Purpose | Target Repos |
|---------|-----|---------|--------------|
| oncallshift | OCS | Primary project for AI worker tasks | `oncallshift-api`, `oncallshift-web`, `oncallshift-mobile` (Bitbucket) |
| WorkerMill | WM | Internal platform tracking | `workermill` (GitHub) |

***REMOVED******REMOVED******REMOVED*** Worker Deployment Workflow

**Standard flow (no `deploy` label):**
1. Worker creates PR with code changes
2. Worker outputs `::result::review_requested`
3. Human reviews and approves PR
4. Webhook triggers WorkerMill
5. Worker re-runs to merge PR and deploy

**Auto-deploy flow (with `deploy` label):**
1. Worker creates PR → immediately merges → deploys
2. Worker outputs `::result::deployed`

***REMOVED******REMOVED******REMOVED*** Webhooks

| Platform | Endpoint |
|----------|----------|
| Jira | `https://workermill.com/api/webhooks/jira` |
| Linear | `https://workermill.com/api/webhooks/linear` |
| GitHub Issues | `https://workermill.com/api/webhooks/github-issues` |
| GitHub PR | `https://workermill.com/api/webhooks/github` |
| GitLab MR | `https://workermill.com/api/webhooks/gitlab` |
| BitBucket PR | `https://workermill.com/api/webhooks/bitbucket` |

---

***REMOVED******REMOVED*** Architecture

***REMOVED******REMOVED******REMOVED*** Key Models (`api/src/models/`)

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

***REMOVED******REMOVED******REMOVED*** Key API Routes (`api/src/routes/`)

| Route | Purpose |
|-------|---------|
| `webhooks.ts` | Jira, GitHub, GitLab, BitBucket, Linear receivers |
| `control-center.ts` | Task management and log streaming SSE |
| `tasks.ts` | Worker log ingestion |
| `orchestrator.ts` | System control (start/stop/status) |
| `settings.ts` | Organization settings CRUD |
| `billing.ts` | Stripe billing integration |
| `coordination.ts` | Multi-worker file locking |

***REMOVED******REMOVED******REMOVED*** Task Flow

```
Jira webhook → API receives task → Queue → Claim task → Spawn ECS container → Monitor → Parse output markers (::result::, ::pr_url::) → Update status
```

***REMOVED******REMOVED******REMOVED*** Worker System

Directives in `worker/directives/` define role-specific behavior:
- `backend_developer/`, `frontend_developer/`, `devops_engineer/`
- `security_engineer/`, `qa_engineer/`, `tech_writer/`, `project_manager/`

See `worker/AGENTS.md` for comprehensive worker instructions.

> **IMPORTANT:** `worker/AGENTS.md` contains instructions for AI workers that execute tasks on **target repositories** (e.g., oncallshift). These workers run inside ECS containers and use execution scripts in `/app/execution-compiled/`. This is **NOT** relevant when Claude Code is working on the WorkerMill codebase itself - those instructions are for the spawned worker containers, not for development work on this repository.

***REMOVED******REMOVED******REMOVED*** Frontend Architecture

| Concept | Implementation |
|---------|----------------|
| State management | Zustand stores in `frontend/src/stores/` |
| API calls | Axios with base URL from env, auth interceptors |
| Routing | React Router v7 in `frontend/src/App.tsx` |
| Styling | TailwindCSS with custom config |
| Forms | React Hook Form + Zod validation |
| Auth | Cognito-backed, token stored in localStorage |

**SSE Log Streaming:**
- API: `GET /api/control-center/tasks/:taskId/stream` returns SSE events
- Frontend: `EventSource` in task detail page subscribes to log stream
- Logs polled from PostgreSQL every 500ms and pushed via SSE

***REMOVED******REMOVED******REMOVED*** Multi-Provider AI Support

| Provider | Models | Status |
|----------|--------|--------|
| `anthropic` (default) | claude-haiku-4-5, claude-sonnet-4, claude-opus-4 | Production |
| `openai` | gpt-4o, gpt-5.1-codex, o1, o1-mini | Production |
| `google` | gemini-2.0-flash, gemini-3-pro-preview | Production |
| `ollama` | qwen2.5-coder:32b, deepseek-r1:70b, etc. | Production |

***REMOVED******REMOVED******REMOVED*** Multi-SCM Provider Support

| Provider | Status | Auth Method | Default Repo Field |
|----------|--------|-------------|-------------------|
| `github` (default) | Production | Bearer token | `defaultGithubRepo` |
| `gitlab` | Production | PRIVATE-TOKEN | `defaultGitlabRepo` |
| `bitbucket` | Production | Repository Access Token | `defaultBitbucketRepo` |

**oncallshift uses Bitbucket:** Repositories at `bitbucket.org/oncallshift/`. Workers targeting OCS tickets use Bitbucket provider.

**No cross-provider fallback:** Each SCM provider requires its own credentials. Workers will fail if the configured `scmProvider` doesn't have credentials set up in Settings > Integrations.

***REMOVED******REMOVED******REMOVED*** ⚠️ Bitbucket Authentication (IMPORTANT - READ THIS)

**Bitbucket deprecated app passwords. Use Repository Access Tokens instead.**

| Use Case | Auth Method | Format |
|----------|-------------|--------|
| **REST API calls** | Bearer token | `Authorization: Bearer <token>` |
| **Git clone/push** | x-token-auth | `https://x-token-auth:<token>@bitbucket.org/workspace/repo.git` |

**DO NOT use Basic auth with username:password for Bitbucket API calls.** Repository Access Tokens require Bearer authentication.

**Creating a Repository Access Token:**
1. Go to Repository Settings → Access tokens
2. Create token with scopes: `repository:write`, `pullrequest:write`
3. Store token in WorkerMill Settings → Integrations → Bitbucket
4. The token IS the password; username should be `x-token-auth`

**References:**
- [Bitbucket Repository Access Tokens](https://support.atlassian.com/bitbucket-cloud/docs/repository-access-tokens/)
- [Using Access Tokens](https://support.atlassian.com/bitbucket-cloud/docs/using-access-tokens/)

---

***REMOVED******REMOVED*** Execution Modes

WorkerMill automatically selects execution mode based on org provider settings.

| Condition | Mode |
|-----------|------|
| `primaryProvider` = "anthropic" AND no `providerRouting` | **Epic Mode** (parallel, Agent SDK) |
| Other `primaryProvider` OR `providerRouting` configured | **Multi-Provider Mode** (sequential, AI SDK) |

***REMOVED******REMOVED******REMOVED*** Epic Mode (Anthropic-only, Parallel)

Planning Agent decomposes task → Spawns Epic Coordinator → Expert subagents work in parallel → Coordination feed for collaboration → Consolidated PR.

**Components:** `worker/epic/coordinator.ts`, `executor.ts`, `experts.ts`, `coordination-client.ts`

***REMOVED******REMOVED******REMOVED*** Multi-Provider Mode (Sequential)

Planning Agent decomposes task → Stories execute sequentially → Each persona routes to configured provider → Coordination feed → Consolidated PR.

**Components:** `worker/multi-expert/index.ts`, `coordination-client.ts`, `worker/agents/ai-sdk-executor.js`

***REMOVED******REMOVED******REMOVED*** Phased Execution Mode (add `phased` label)

Each story broken into discrete phases with fresh context:
```
ANALYZE → IMPLEMENT (per unit) → INTEGRATE → VERIFY ↔ FIX → COMMIT
```

**Components:** `worker/epic/phased-executor.ts`, `worker/epic/phases/*.ts`

***REMOVED******REMOVED******REMOVED*** Standard SDK Mode (add `sdk` label)

Single-task execution via Claude Agent SDK (no story decomposition).

---

***REMOVED******REMOVED*** Infrastructure

***REMOVED******REMOVED******REMOVED*** Environment Configuration

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

⚠️ **DEV ENVIRONMENT IS NOT RUNNING.** Do not deploy to dev. Always deploy to prod.

***REMOVED******REMOVED******REMOVED*** Terraform Commands

```bash
***REMOVED*** Production
cd infrastructure/terraform/environments/prod
terraform init -backend-config="bucket=workermill-terraform-state-AWS_ACCOUNT_ID"
terraform plan
terraform apply

***REMOVED*** Development
cd infrastructure/terraform/environments/dev
terraform init -backend-config="bucket=workermill-terraform-state-AWS_ACCOUNT_ID"
terraform plan && terraform apply
```

**Note:** No `-var` flags needed - all variables have defaults in `variables.tf`.

***REMOVED******REMOVED******REMOVED*** SES Email Configuration

**Cross-region setup required:** WorkerMill runs in us-east-1, but SES was set up in us-east-2 for production sending access.

| Purpose | Region | Notes |
|---------|--------|-------|
| **Outbound emails** (invites, notifications) | us-east-2 | Has production access, can send to any email |
| **Inbound emails** (receiving) | us-east-1 | Lambda, S3 integration |

**Do not change this configuration.** All outbound email uses us-east-2 SES.

**Email Types:**
| Email | Trigger | Template Location |
|-------|---------|-------------------|
| Welcome email | User signup/invite accepted | `api/src/services/email.ts` |
| Org invite | Admin invites user | `api/src/services/email.ts` |
| Task notifications | Task status changes | `api/src/services/email.ts` |

**Test emails:** Settings page has "Send Test Email" buttons for each template.

***REMOVED******REMOVED******REMOVED*** Bastion Host

SSH bastion for local development database access. Runs as a t4g.nano Spot instance on-demand.

| Resource | Value |
|----------|-------|
| Lambda | `workermill-dev-bastion-control` |
| ASG | `workermill-dev-bastion` |
| Security Group | `workermill-dev-bastion` (SSH port 22, dynamic IP whitelisting) |
| SSH Key | `~/.ssh/workermill-bastion` |
| Instance Types | t4g.nano, t4g.micro (ARM), t3a.nano, t3a.micro, t3.nano, t3.micro (x86 fallback) |
| Cost | ~$0.001/hr when running, $0 when stopped |

**Architecture:**
```
Your Machine ──SSH:22──▶ Bastion (public subnet) ──5432──▶ RDS (private subnet)
     │
     └── Lambda (start/stop/whitelist IP)
```

The bastion security group is dynamically updated by the Lambda to whitelist your IP on start.

**Security hardening applied:**
- Egress restricted to PostgreSQL (5432/VPC), HTTPS (443), DNS (53/VPC)
- IMDSv2 required (`http_tokens = required`)
- Lambda validates IP addresses before adding to security group
- CloudWatch Logs IAM scoped to specific log group

**Future improvements (not yet implemented):**
- SSH session logging for audit compliance
- AWS SSM Session Manager as SSH alternative (eliminates port 22 exposure)

---

***REMOVED******REMOVED*** Troubleshooting

```bash
***REMOVED*** View ECS service status
aws ecs describe-services --cluster workermill-dev --services workermill-dev-api --region us-east-1

***REMOVED*** Tail API logs (use MSYS_NO_PATHCONV=1 in Git Bash)
MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-dev/api" --follow --region us-east-1

***REMOVED*** Tail worker logs
MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-dev/worker" --follow --region us-east-1

***REMOVED*** Database access via bastion (preferred)
./bin/bastion start && sleep 60 && ./bin/bastion ssh
***REMOVED*** Then in SSH session: psql-workermill

***REMOVED*** Alternative: Database access via ECS exec
MSYS_NO_PATHCONV=1 aws ecs list-tasks --cluster workermill-dev --region us-east-1
***REMOVED*** Then: aws ecs execute-command --container api
```

***REMOVED******REMOVED******REMOVED*** Common Issues

| Problem | Check |
|---------|-------|
| Task stuck "running" | `aws ecs list-tasks`, CloudWatch for exit 137 (Spot) or exit 1 |
| Worker not posting logs | Verify org `apiKey` set, check worker logs for POST errors |
| Task not claimed | `GET /api/orchestrator/status`, verify task status is `queued` |
| PR not created | Branch conflicts, token permissions, rate limits |
| Epic not progressing | `GET /api/coordination/feed/:taskId`, verify planning agent completed |
| Bastion SSH timeout | Run `./bin/bastion whitelist` to update SG with current IP |
| Bastion can't reach RDS | Check RDS SG includes bastion SG: `aws ec2 describe-security-groups --group-ids sg-0c7c9a0e3e60d8cab` |
| psql not found on bastion | User data may have failed; run `sudo dnf install -y postgresql16` |

***REMOVED******REMOVED******REMOVED*** Windows/Git Bash

| Issue | Solution |
|-------|----------|
| AWS CLI path conversion | Prefix with `MSYS_NO_PATHCONV=1` |
| AWS CLI Unicode errors | Set `PYTHONIOENCODING=utf-8` |
| Shell parsing errors with `$(...)` | Spawn a Task agent instead of debugging |
| Docker layer caching | deploy.sh uses `--no-cache` - NEVER build with cache |

---

***REMOVED******REMOVED*** Testing

***REMOVED******REMOVED******REMOVED*** E2E Tests (Playwright)

E2E tests run on ephemeral ECS Fargate Spot runners spawned on-demand.

**Location:** `frontend/e2e/`

**Test suites:**
- `auth.spec.ts` - Authentication flows
- `webhook-task.spec.ts` - Jira webhook → task creation
- `orchestration.spec.ts` - Task lifecycle states
- `log-streaming.spec.ts` - SSE log streaming

**Running E2E tests:**
1. Go to GitHub Actions → CI/CD Pipeline → Run workflow
2. Check "Run E2E tests on self-hosted runner"
3. Click "Run workflow"

**Cost:** ~$0.01-0.02 per test run (Fargate Spot)

**How it works:**
```
GitHub workflow_job webhook → API (/api/webhooks/github-runner) →
Get runner token from GitHub API → Start ECS Fargate task →
Runner registers, executes job, terminates
```

***REMOVED******REMOVED******REMOVED*** Integration Tests (Vitest)

API integration tests with real database using transaction rollback for isolation.

**Location:** `api/src/__tests__/integration/`

**Running integration tests:**
1. Go to GitHub Actions → CI/CD Pipeline → Run workflow
2. Check "Run integration tests on self-hosted runner"
3. Click "Run workflow"

***REMOVED******REMOVED******REMOVED*** CI/CD Workflow

The CI/CD pipeline is **manual-only** (workflow_dispatch). No automatic triggers on push/PR.

| Job | Runner | Trigger |
|-----|--------|---------|
| `api-ci` | ubuntu-latest | Manual |
| `frontend-ci` | ubuntu-latest | Manual |
| `e2e-tests` | self-hosted ECS | Manual (checkbox) |
| `integration-tests` | self-hosted ECS | Manual (checkbox) |
| `deploy-*` | ubuntu-latest | Manual (checkbox) |

---

***REMOVED******REMOVED*** Hooks & Skills

**Auto-formatting:** Prettier runs automatically after Write/Edit to `.ts`/`.tsx`/`.js`/`.jsx` files.

***REMOVED******REMOVED******REMOVED*** /val-imp

Enforces strict plan adherence: extracts requirements, implements one at a time, spawns independent validator agent after each.

**Usage:** `/val-imp docs/my-feature-plan.md`

---

***REMOVED******REMOVED*** MCP Tools Available

Claude Code has access to MCP servers for external integrations. Use `ToolSearch` to load these before calling.

| Server | Tools | Purpose |
|--------|-------|---------|
| `workermill` | Task management, orchestrator control | Manage WorkerMill tasks directly |
| `github` | `create_issue`, `create_pull_request`, `search_code`, etc. | GitHub operations |
| `jira` | `jira_get`, `jira_post`, `jira_put` | Jira API operations |
| `ollama` | `ollama_chat`, `ollama_generate`, `ollama_list` | Local LLM inference |
| `oncallshift` | Incident management, schedules, escalation policies | OncallShift platform operations |
| `browsermcp` | `browser_navigate`, `browser_click`, `browser_screenshot` | Browser automation |

**Usage pattern:**
```
1. ToolSearch query: "github create issue"
2. Call the returned tool (e.g., mcp__github__create_issue)
```

***REMOVED*** Agent Instructions

> This file provides context to Claude Code when executing AI Worker tasks.

You operate within a 3-layer architecture that separates concerns:

***REMOVED******REMOVED*** Layer 1: Directive (What to do)
- SOPs in `directives/` defining goals, steps, edge cases
- Read the relevant directive FIRST before doing anything
- Directives are organized by persona: `backend_developer/`, `frontend_developer/`, etc.
- **ALWAYS check for image attachments** - see `directives/common/check_attachments.md`

***REMOVED******REMOVED*** Layer 2: Orchestration (You)
- Your job: read directives, call execution scripts, handle errors
- You're the decision-maker, not the implementer
- DO NOT write shell commands directly - use scripts from `execution/`
- **IMPORTANT:** Never use the Read tool on a directory path - use Glob or `ls` first to list files, then read specific files

***REMOVED******REMOVED*** Layer 3: Execution (Tools)
- Pre-compiled JavaScript scripts in `/app/execution-compiled/`
- Call these with `node` instead of running commands yourself
- Scripts output JSON so you can parse results

**Running execution scripts:**
```bash
***REMOVED*** Use the compiled JavaScript versions (NOT the .ts files)
node /app/execution-compiled/git/commit_changes.js
node /app/execution-compiled/git/create_pr.js
node /app/execution-compiled/ticket/add_comment.js
```

***REMOVED******REMOVED*** Execution Scripts Reference

All scripts are in `/app/execution-compiled/`. Set environment variables before calling.

***REMOVED******REMOVED******REMOVED*** Git Scripts

***REMOVED******REMOVED******REMOVED******REMOVED*** `git/commit_changes.js`
Stage and commit all changes with a message.
```bash
COMMIT_MESSAGE="feat: add user authentication" \
REPO_PATH="/workspace/repo" \
  node /app/execution-compiled/git/commit_changes.js
```
| Env Var | Required | Description |
|---------|----------|-------------|
| `COMMIT_MESSAGE` | Yes | The commit message |
| `REPO_PATH` | No | Path to repo (defaults to cwd) |

***REMOVED******REMOVED******REMOVED******REMOVED*** `git/create_pr.js`
Push branch and create a GitHub pull request. Automatically rebases onto main.
```bash
TICKET_KEY="OCS-123" \
TICKET_SUMMARY="Add login button" \
DESCRIPTION="Adds OAuth login support" \
BASE_BRANCH="main" \
DRAFT="false" \
TICKET_BASE_URL="https://company.atlassian.net/browse" \
  node /app/execution-compiled/git/create_pr.js
```
| Env Var | Required | Description |
|---------|----------|-------------|
| `TICKET_KEY` | Yes | Jira ticket key |
| `TICKET_SUMMARY` | Yes | Ticket summary for PR title |
| `DESCRIPTION` | No | Additional PR description |
| `BASE_BRANCH` | No | Target branch (default: main) |
| `DRAFT` | No | "true" for draft PR |
| `TICKET_BASE_URL` | No | Base URL for ticket links |

**Output:** `{ success, prUrl, prNumber, branch, wasRebased, error }`

***REMOVED******REMOVED******REMOVED******REMOVED*** `git/rebase_on_main.js`
Rebase current branch onto origin/main. Called automatically by create_pr.
```bash
REPO_PATH="/workspace/repo" \
BASE_BRANCH="main" \
  node /app/execution-compiled/git/rebase_on_main.js
```

***REMOVED******REMOVED******REMOVED*** Ticket Scripts

***REMOVED******REMOVED******REMOVED******REMOVED*** `ticket/add_comment.js`
Add a comment to a Jira ticket.
```bash
TICKET_KEY="OCS-123" \
COMMENT="Starting work on authentication feature" \
  node /app/execution-compiled/ticket/add_comment.js
```
| Env Var | Required | Description |
|---------|----------|-------------|
| `TICKET_KEY` | Yes | Jira ticket key |
| `COMMENT` | Yes | Comment text to add |

***REMOVED******REMOVED******REMOVED******REMOVED*** `ticket/transition_issue.js`
Transition a Jira ticket to a new status.
```bash
TICKET_KEY="OCS-123" \
TRANSITION_NAME="Done" \
  node /app/execution-compiled/ticket/transition_issue.js
```
| Env Var | Required | Description |
|---------|----------|-------------|
| `TICKET_KEY` | Yes | Jira ticket key |
| `TRANSITION_NAME` | Yes | Target status name |

***REMOVED******REMOVED******REMOVED******REMOVED*** `ticket/fetch_attachments.js`
Download all attachments from a Jira ticket. Use this to view screenshots and images.
```bash
TICKET_KEY="OCS-123" \
OUTPUT_DIR="/tmp/attachments" \
  node /app/execution-compiled/ticket/fetch_attachments.js
```
| Env Var | Required | Description |
|---------|----------|-------------|
| `TICKET_KEY` | Yes | Jira ticket key |
| `OUTPUT_DIR` | No | Where to save files (default: /tmp/attachments) |

**Output:** `{ success, attachments: [{filename, path, mimeType, size}], outputDir, error }`

After fetching, view images with Claude Code's image reading capability.

***REMOVED******REMOVED******REMOVED*** Deploy Scripts

***REMOVED******REMOVED******REMOVED******REMOVED*** `deploy/build_container.js`
Build and push a container image using Kaniko (daemon-less, works in Fargate).
```bash
IMAGE_NAME="AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/oncallshift-dev/backend:v1" \
DOCKERFILE_PATH="./Dockerfile" \
CONTEXT_DIR="." \
BUILD_ARGS="NODE_ENV=production,VERSION=1.0.0" \
AWS_REGION="us-east-1" \
CACHE_REPO="AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/oncallshift-cache" \
  node /app/execution-compiled/deploy/build_container.js
```
| Env Var | Required | Description |
|---------|----------|-------------|
| `IMAGE_NAME` | Yes | Full ECR image name with tag |
| `DOCKERFILE_PATH` | No | Path to Dockerfile (default: ./Dockerfile) |
| `CONTEXT_DIR` | No | Build context directory (default: .) |
| `BUILD_ARGS` | No | Comma-separated build args |
| `AWS_REGION` | No | AWS region (default: us-east-1) |
| `CACHE_REPO` | No | ECR repo for layer caching |

**Output:** `{ success, imageName, digest, error }`

***REMOVED******REMOVED******REMOVED******REMOVED*** `deploy/deploy_frontend.js`
Deploy frontend to S3 and invalidate CloudFront cache.

**⚠️ CRITICAL: Always provide CLOUDFRONT_DISTRIBUTION_ID! Without cache invalidation, users won't see changes for up to 24 hours.**

```bash
BUILD_DIR="./dist" \
S3_BUCKET="oncallshift-dev-web" \
CLOUDFRONT_DISTRIBUTION_ID="E7BQGD7BWAB8B" \
AWS_REGION="us-east-1" \
  node /app/execution-compiled/deploy/deploy_frontend.js
```
| Env Var | Required | Description |
|---------|----------|-------------|
| `BUILD_DIR` | Yes | Path to built frontend (e.g., ./dist) |
| `S3_BUCKET` | Yes | Target S3 bucket name |
| `CLOUDFRONT_DISTRIBUTION_ID` | **Yes*** | CloudFront distribution ID (*skip only for non-CloudFront deployments) |
| `AWS_REGION` | No | AWS region (default: us-east-1) |

**Output:** `{ success, filesUploaded, s3Bucket, cloudfrontInvalidationId, error }`

***REMOVED******REMOVED******REMOVED******REMOVED*** `deploy/deploy_ecs.js`
Deploy a new container image to an ECS service.
```bash
CLUSTER_NAME="oncallshift-dev" \
SERVICE_NAME="oncallshift-dev-backend" \
IMAGE_URI="AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/oncallshift-dev/backend:v1" \
AWS_REGION="us-east-1" \
  node /app/execution-compiled/deploy/deploy_ecs.js
```
| Env Var | Required | Description |
|---------|----------|-------------|
| `CLUSTER_NAME` | Yes | ECS cluster name |
| `SERVICE_NAME` | Yes | ECS service name |
| `IMAGE_URI` | Yes | Full image URI to deploy |
| `AWS_REGION` | No | AWS region (default: us-east-1) |

***REMOVED******REMOVED******REMOVED******REMOVED*** `deploy/check_health.js`
Check health endpoint after deployment.
```bash
HEALTH_URL="https://api.oncallshift.com/health" \
TIMEOUT_SECONDS="60" \
  node /app/execution-compiled/deploy/check_health.js
```
| Env Var | Required | Description |
|---------|----------|-------------|
| `HEALTH_URL` | Yes | URL to health endpoint |
| `TIMEOUT_SECONDS` | No | Max wait time (default: 60) |

***REMOVED******REMOVED******REMOVED******REMOVED*** `deploy/rollback.js`
Roll back an ECS service to its previous task definition.
```bash
CLUSTER_NAME="oncallshift-dev" \
SERVICE_NAME="oncallshift-dev-backend" \
AWS_REGION="us-east-1" \
  node /app/execution-compiled/deploy/rollback.js
```

***REMOVED******REMOVED******REMOVED******REMOVED*** `deploy/full_deploy.js` (RECOMMENDED)
**Unified deployment script for full-stack changes.** This is the preferred way to deploy oncallshift.

```bash
***REMOVED*** Deploy everything (auto-detects what changed)
node /app/execution-compiled/deploy/full_deploy.js

***REMOVED*** Deploy backend only
node /app/execution-compiled/deploy/full_deploy.js --backend

***REMOVED*** Deploy frontend only
node /app/execution-compiled/deploy/full_deploy.js --frontend

***REMOVED*** Deploy both explicitly
node /app/execution-compiled/deploy/full_deploy.js --all

***REMOVED*** Dry run - preview what would be deployed
node /app/execution-compiled/deploy/full_deploy.js --dry-run

***REMOVED*** Skip build step (use existing container)
node /app/execution-compiled/deploy/full_deploy.js --backend --skip-build

***REMOVED*** Skip waiting for ECS stabilization
node /app/execution-compiled/deploy/full_deploy.js --all --skip-wait
```

| Flag | Alias | Description |
|------|-------|-------------|
| `--backend` | `-b` | Deploy backend only (build container, update ECS) |
| `--frontend` | `-f` | Deploy frontend only (sync S3, invalidate CloudFront) |
| `--all` | `-a` | Deploy both backend and frontend |
| `--auto` | | Auto-detect what changed via git diff (default) |
| `--skip-build` | | Skip container build (use existing image) |
| `--skip-wait` | | Don't wait for ECS service to stabilize |
| `--dry-run` | `-n` | Preview what would be deployed without deploying |

**Auto-detection logic:**
- Scans `git diff HEAD~1` for changed files
- Backend patterns: `src/`, `api/`, `Dockerfile`, `package.json`
- Frontend patterns: `frontend/`, `web/`, `public/`
- If both are detected, deploys both in correct order

**Deployment order:** Backend first, then frontend. This ensures new API endpoints are available before the UI tries to call them.

**Output:** JSON with results for each deployment step.

***REMOVED******REMOVED******REMOVED*** Full-Stack Deployment Requirements

**CRITICAL: Many tasks require BOTH backend AND frontend deployments.**

Before completing any task with a `deploy` label, ask yourself:

| Changed | What to Deploy |
|---------|----------------|
| Backend code only (API routes, models, services) | Deploy ECS only |
| Frontend code only (React components, pages, styles) | Deploy to S3 + **invalidate CloudFront** |
| **Both backend AND frontend** | Deploy ECS first, **then** deploy to S3 + **invalidate CloudFront** |

**Common scenarios that require BOTH deployments:**

1. **New API endpoint + UI to use it** - Backend serves data, frontend displays it
2. **Database schema change + UI update** - Migration runs on backend, UI shows new fields
3. **User-facing feature** (like "display last login timestamp") - Almost always touches both

**How to identify full-stack tasks:**

- Does the task mention "display", "show", "page", "UI", "component", "button", "form"? → **Frontend deployment needed**
- Does the task mention "API", "endpoint", "database", "model", "migration"? → **Backend deployment needed**
- Most user-facing features need **BOTH**

**Deployment order for full-stack changes:**

1. Deploy backend first (ECS) - New API endpoints must be available
2. Wait for backend to stabilize
3. Deploy frontend (S3 + CloudFront invalidation) - UI can now call new APIs

**Never skip CloudFront invalidation for frontend changes!** Users will see stale cached content for up to 24 hours without invalidation.

***REMOVED******REMOVED******REMOVED*** Test Scripts

***REMOVED******REMOVED******REMOVED******REMOVED*** `test/run_typecheck.js`
Run TypeScript type checking.
```bash
PROJECT_PATH="/workspace/repo" \
  node /app/execution-compiled/test/run_typecheck.js
```

***REMOVED******REMOVED******REMOVED******REMOVED*** `test/run_tests.js`
Run test suite (Jest, Vitest, or npm test).
```bash
PROJECT_PATH="/workspace/repo" \
TEST_COMMAND="npm test" \
  node /app/execution-compiled/test/run_tests.js
```

***REMOVED******REMOVED******REMOVED*** Metrics Scripts

***REMOVED******REMOVED******REMOVED******REMOVED*** `metrics/record_task_metrics.js`
Record task completion metrics for MTTA/MTTR analysis.
```bash
TASK_ID="abc123" \
TICKET_KEY="OCS-123" \
OUTCOME="completed" \
STARTED_AT="2024-01-01T10:00:00Z" \
COMPLETED_AT="2024-01-01T11:30:00Z" \
  node /app/execution-compiled/metrics/record_task_metrics.js
```
| Env Var | Required | Description |
|---------|----------|-------------|
| `TASK_ID` | Yes | Unique task identifier |
| `TICKET_KEY` | Yes | Jira ticket key |
| `OUTCOME` | No | completed, blocked, escalated, no_changes, deployed (default: completed) |
| `STARTED_AT` | No | ISO timestamp when task started |
| `COMPLETED_AT` | No | ISO timestamp when completed (default: now) |
| `SEVERITY` | No | P1-P5 severity classification |
| `WORKER_PERSONA` | No | The persona that executed the task |

---

***REMOVED******REMOVED*** Task Severity Classification

Severity guides urgency and expected response time. Check the task's severity label.

| Severity | Definition | Expected Start | Expected Resolution |
|----------|-----------|----------------|---------------------|
| **P1 - Critical** | Production down, data loss risk | Immediate | < 1 hour |
| **P2 - High** | Major feature broken, workaround exists | < 30 min | < 4 hours |
| **P3 - Medium** | Feature degraded, non-blocking | < 2 hours | < 1 day |
| **P4 - Low** | Minor issue, enhancement | < 1 day | < 1 week |
| **P5 - Trivial** | Nice-to-have, backlog | When available | No SLA |

***REMOVED******REMOVED******REMOVED*** Severity-Based Behavior

**P1-P2 Tasks (Critical/High):**
- Prioritize speed over perfection
- Skip comprehensive testing if blocking production fix
- Create minimal fix first, follow-up ticket for proper solution if needed
- Document shortcuts taken for later cleanup
- Notify stakeholders on completion

**P3-P5 Tasks (Medium/Low/Trivial):**
- Follow full testing protocol
- Take time for proper, maintainable solution
- Include refactoring if it improves the codebase
- Write comprehensive tests

---

***REMOVED******REMOVED*** Definition of Done (Required)

**Every task is complete when ALL applicable items are met:**

- [ ] Code follows existing patterns in the codebase
- [ ] No security vulnerabilities introduced (OWASP Top 10 compliance)
- [ ] For Terraform: State remains synchronized (ran `terraform plan` to verify)
- [ ] For database changes: Migrations are reversible
- [ ] For API changes: Changes are backwards compatible
- [ ] PR created with Summary and Test Plan sections
- [ ] Completion comment added to ticket tracking system
- [ ] Ticket transitioned to Done

---

***REMOVED******REMOVED*** MANDATORY: Document Your Work

**You MUST add comments to the ticket to document your analysis and work.** This is critical for team visibility and learning.

***REMOVED******REMOVED******REMOVED*** Before Starting Work

Add a brief comment explaining your approach. Use your persona name (from WORKER_PERSONA env var) in the header:
```
[Backend Developer Analysis]  <!-- Use your actual persona: Frontend Developer, QA Engineer, etc. -->

I will:
1. [First step you plan to take]
2. [Second step]
...

Files I expect to modify:
- path/to/file1.ts
- path/to/file2.ts
```

Use the execution script:
```bash
TICKET_KEY=$TICKET_KEY COMMENT="Your analysis message" node /app/execution-compiled/ticket/add_comment.js
```

***REMOVED******REMOVED******REMOVED*** After Completing Work

**CRITICAL: Always add a completion comment before transitioning to Done.**

Your completion comment MUST include:

1. **What was done** - Brief summary of changes made
2. **PR link** - **CRITICAL: Always include the PR URL** (e.g., "PR: https://github.com/owner/repo/pull/123")
3. **Files modified** - List key files changed (not every file, just important ones)
4. **New artifacts** - Any new files, migrations, or resources created
5. **Verification performed** - How you verified the changes work
6. **Blockers encountered** - Issues faced and how they were resolved
7. **Follow-up needed** - Any related work discovered that needs separate tickets

Example completion comment (use your actual persona name):
```
[Backend Developer Completion Report]  <!-- Use your persona: Frontend Developer, QA Engineer, etc. -->

***REMOVED******REMOVED*** Summary
Added user authentication to the /api/users endpoint.

***REMOVED******REMOVED*** Files Modified
- src/routes/users.ts (added auth middleware)
- src/middleware/auth.ts (new file)

***REMOVED******REMOVED*** Verification
- Ran unit tests - all passing
- Manual testing with curl commands
- TypeScript compiles without errors

***REMOVED******REMOVED*** Blockers
- None encountered

***REMOVED******REMOVED*** Follow-up
- Consider adding rate limiting (created ticket PROJ-456)
```

---

***REMOVED******REMOVED*** MANDATORY: Transition Ticket to Done

**CRITICAL: After creating a PR (or completing work with no code changes), you MUST transition the ticket to Done.**

Use the execution script:
```bash
TICKET_KEY=$TICKET_KEY TRANSITION_NAME="Done" node /app/execution-compiled/ticket/transition_issue.js
```

**Never leave a completed task in "In Progress" status. This is a hard requirement.**

---

***REMOVED******REMOVED*** Escalation Policy

***REMOVED******REMOVED******REMOVED*** When to Escalate (Use `::result::escalated`)

**You MUST escalate when you cannot complete the requested work.** Never mark a task as Done when you didn't actually do the work.

Escalate immediately when:
- **Unclear requirements** - ticket description doesn't clearly specify what to do
- **Missing critical information** - attachments failed to download or don't exist
- **Cannot understand the task** - even after reading ticket, attachments, and codebase
- **Have `deploy` label but cannot deploy** - blocked from deploying for any reason
- **Blocked > 15 minutes** on environment/access issues
- **Security concern** found during work that needs human decision
- **Breaking change** required but not authorized
- **Production impact** risk identified
- **Cannot reproduce** the reported issue

***REMOVED******REMOVED******REMOVED*** How to Escalate

1. Add a detailed ticket comment explaining:
   - What you've tried and discovered
   - What's blocking you from completing the task
   - What specific information or clarification you need

2. Output the escalation marker:
   ```
   ::result::escalated
   ```

3. The entrypoint will add a comment to the ticket noting escalation. The ticket stays in "In Progress" for visibility.

**IMPORTANT: Do NOT manually call `transition_issue.js` with "Escalated"** - just output the marker and let the entrypoint handle it.

***REMOVED******REMOVED******REMOVED*** CRITICAL: When NOT to Use `::result::completed` or `::result::no_changes`

**NEVER use these markers when:**
- You didn't actually complete the requested work
- You're uncertain about what was requested
- You only analyzed the code but couldn't implement changes
- Attachments contained critical info you couldn't access
- You have a `deploy` label but didn't deploy
- You're guessing about what the ticket wants

**These markers mean the work is DONE. If the work isn't done, use `::result::escalated`.**

***REMOVED******REMOVED******REMOVED*** Escalation Tiers

| Tier | Who | When |
|------|-----|------|
| 1 | Product Owner | Task needs clarification on requirements |
| 2 | Tech Lead | Technical decision needed |
| 3 | On-Call Engineer | Production impact risk |
| 4 | Security Team | Security vulnerability found |

---

***REMOVED******REMOVED*** Deployment Workflows

**CRITICAL: There is NO CI/CD pipeline. There are NO GitHub Actions. Merging a PR does NOT trigger automatic deployment.**

When you have the `deploy` label, YOU are responsible for deploying. Don't assume "the deployment will happen through normal merge process" or "CI/CD will handle it" - there is no such automation. You must run the deployment scripts yourself.

There are two main workflows based on whether the ticket has a `deploy` label.

---

***REMOVED******REMOVED******REMOVED*** WORKFLOW 1: WITH `deploy` label (Full Autonomy)

When the ticket has a `deploy` label, you have full autonomy to deploy and merge:

1. Make code changes
2. Commit changes to your branch
3. **Deploy changes** (use execution scripts for your platform)
4. **Verify deployment succeeded** (check health endpoints)
5. Create PR with summary
6. **Merge the PR** (unless ticket also has `review` label - then wait for approval)
7. Add completion comment noting deployment and merge status
8. Transition ticket to Done

**Key point:** You deploy BEFORE creating the PR to verify changes work.

---

***REMOVED******REMOVED******REMOVED*** WORKFLOW 2: WITHOUT `deploy` label (Gated - Default)

When the ticket does NOT have a `deploy` label, you create a PR and wait for approval:

**First Run (Initial Execution):**
1. Make code changes
2. Commit and push to your branch
3. Create a PR with summary and test plan
4. Add completion comment
5. Transition ticket to "Review Requested"
6. **STOP** - Your work is done for now

The ticket will sit in "Review Requested" status waiting for:
- A human to approve the PR on GitHub, OR
- A Virtual Manager to review (if `review` label is added)

**Second Run (After PR Approved):**

When your PR is approved, the system will:
1. Transition the ticket from "Review Requested" → "PR Approved"
2. Re-queue the task for you to pick up again

You'll start back up with `TASK_NOTES` indicating this is a deployment run. When you see this:

1. Check that PR exists and is approved
2. Pull latest changes from your branch
3. **Deploy the approved changes**
4. **Verify deployment succeeded**
5. **Merge the PR**
6. Add completion comment noting deployment completed
7. Transition ticket to Done

---

***REMOVED******REMOVED******REMOVED*** How to Detect Which Run You're On

Check the `TASK_NOTES` environment variable:

- If `TASK_NOTES` contains "DEPLOYMENT_RUN" or "PR_APPROVED":
  - This is the second run - deploy and merge
  - PR already exists and is approved

- If `TASK_NOTES` is empty or contains the original ticket description:
  - This is the first run - make changes and create PR

You can also check if a PR already exists for your branch:
```bash
gh pr list --head "ai/${TICKET_KEY}" --state open
```

---

***REMOVED******REMOVED******REMOVED*** Workflow Decision Tree

```
START: Agent picks up task
  |
  v
Does ticket have 'deploy' label?
  |
  +-- YES --> Deploy + Create PR + Merge --> Done
  |
  +-- NO --> Is this a deployment run? (check TASK_NOTES)
              |
              +-- YES (PR already approved) --> Deploy + Merge --> Done
              |
              +-- NO (first run) --> Create PR --> "Review Requested" --> STOP
```

---

***REMOVED******REMOVED******REMOVED*** The `review` Label

The `review` label enables Virtual Manager review:

- **With `review` label:** After you create a PR, the Virtual Manager will automatically review it. If approved, you'll be re-queued for deployment.

- **Without `review` label:** A human must approve the PR on GitHub. When they do, you'll be re-queued for deployment.

**Note:** The `review` label can be combined with `deploy` label. In this case:
- You deploy first (because of `deploy` label)
- But you DON'T auto-merge (wait for Manager review)
- After approval, you merge

---

***REMOVED******REMOVED*** Security Requirements

**Security is NOT optional. Never compromise on security best practices.**

***REMOVED******REMOVED******REMOVED*** ABSOLUTELY FORBIDDEN - Never Do These

**Infrastructure Files (DO NOT MODIFY):**
- **NEVER modify `Dockerfile` or `Dockerfile.*`** - These are shared infrastructure; changes affect all deployments
- **NEVER modify `.gitignore`** - Changes affect what gets committed for all developers
- **NEVER modify `deploy.sh` or `deploy/*.sh`** - Deployment scripts are maintained separately
- **NEVER modify `docker-compose*.yml`** - Infrastructure configuration files
- **NEVER modify `.github/workflows/*`** - CI/CD pipelines (even if they don't exist yet)
- **NEVER modify `terraform/*` or `*.tf`** - Infrastructure as code
- **NEVER modify `kubernetes/*` or `k8s/*`** - K8s manifests

**If deployment fails due to infrastructure issues:**
1. DO NOT attempt to fix the infrastructure - you don't have full context
2. Add a detailed comment to the Jira ticket explaining the error
3. Create the PR anyway with your code changes
4. Output `::result::review_requested` - let humans handle deployment
5. Escalate if the issue blocks your actual code changes

**CI/CD (DOES NOT EXIST):**
- **There is NO CI/CD pipeline** - Merging a PR does NOT automatically deploy. You must deploy yourself.
- **NEVER create or modify GitHub Actions workflows** - GitHub Actions integration is not ready. Do not create `.github/workflows/` files or suggest CI/CD automation via Actions.
- **NEVER assume CI/CD will deploy for you** - If you have a `deploy` label, YOU must run the deployment scripts.

**Deployment:**
- **NEVER push to `main` branch** - Always create a feature branch and PR
- **NEVER merge PRs without human review** unless ticket explicitly says no review needed
- **NEVER run destructive CI/CD commands** without explicit authorization

**Destructive Operations:**
- **NEVER run `terraform destroy`** - Destructive infrastructure changes require human approval
- **NEVER drop database tables** - Data loss is unrecoverable
- **NEVER delete storage buckets** - Data loss is unrecoverable
- **NEVER force push** (`git push --force`) - This rewrites history
- **NEVER run `rm -rf` on directories you didn't create**

**Security:**
- `NODE_TLS_REJECT_UNAUTHORIZED=0` - Never disable TLS validation
- Hardcoded credentials in code or scripts
- Overly permissive security groups (0.0.0.0/0 for non-public services)
- `Resource: "*"` in IAM policies with destructive actions
- Committing secrets to git

***REMOVED******REMOVED******REMOVED*** Required Practices
- Use secrets management for all credentials
- Scope IAM/RBAC policies to specific resources
- Validate all API inputs
- Use HMAC signatures for webhook verification
- Log security-relevant events

---

***REMOVED******REMOVED*** Directive Maturity Levels

Directives evolve through maturity levels. Help improve them.

| Level | Name | Characteristics |
|-------|------|-----------------|
| **L0** | Ad-hoc | No documented process, relies on human judgment |
| **L1** | Documented | Written steps exist but require interpretation |
| **L2** | Repeatable | Steps are clear enough for consistent execution |
| **L3** | Automated | Most steps have execution scripts |
| **L4** | Self-Healing | System learns from failures and improves itself |

***REMOVED******REMOVED******REMOVED*** Improvement Workflow

After each task:
1. Assess the directive's maturity level
2. If L0-L1: Add clear, actionable steps
3. If L2: Identify steps that can become scripts
4. If L3: Add self-annealing logic
5. Document improvements in Self-Annealing Notes section

---

***REMOVED******REMOVED*** No Code Changes Needed

Sometimes after investigation, you'll find that **no code changes are required**. This is a valid outcome **only when you fully understood the request and determined no changes were needed**.

**IMPORTANT: "No changes needed" is NOT the same as "I don't understand the request":**
- ✅ Use `::result::no_changes` when you **understood** the task and correctly determined no changes are needed
- ❌ Use `::result::escalated` when you **didn't understand** what was being asked

When no code changes are truly needed:

1. **DO NOT create empty commits** - Never run `git commit --allow-empty`
2. **DO NOT create a PR** - A PR with no meaningful changes wastes reviewer time
3. **DO add a ticket comment** explaining your findings:
   - What you investigated
   - Why no changes are needed
   - Any recommended next steps
4. **Output `::result::no_changes`** - The orchestrator will mark the task as completed

**Example scenarios where no code changes are needed:**
- The fix is already in the codebase but not deployed
- The issue is a configuration problem, not a code problem
- The reported bug cannot be reproduced **AND you understand what was being reported**
- The requested feature already exists

**Example scenarios that require ESCALATION instead:**
- The ticket says "fix the thing" but doesn't specify what thing
- Attachments show what to do but failed to download
- You analyzed the code but couldn't figure out what changes were wanted

---

***REMOVED******REMOVED*** Self-Annealing Protocol

When an execution script fails:

1. **Read the error** - Understand what went wrong
2. **Fix the script** - Modify the code in `execution/`
3. **Test it works** - Run the script again with same inputs
4. **Update the directive** - Add what you learned to the "Self-Annealing Notes" section
5. **Continue** - The system is now stronger

**Important:** Self-annealing improvements should be committed to a separate branch (`self-anneal/*`) and create a PR for human review.

---

***REMOVED******REMOVED*** Metrics Tracking

At the end of each task, record metrics for analysis:

```bash
node /app/execution-compiled/metrics/record_task_metrics.js
```

Metrics captured:
- **Time to First Action (MTTA)** - How quickly work started
- **Time to Resolution (MTTR)** - Total time to complete
- **Phases** - Time spent in analysis, implementation, testing, PR creation
- **Outcome** - completed, blocked, escalated

This data enables:
- Team performance dashboards
- Bottleneck identification
- Process improvement insights

---

***REMOVED******REMOVED*** Key Principle

> "90% accuracy per step = 59% success over 5 steps. Push complexity into deterministic code."

When you find yourself writing the same command multiple times, that's a sign it should be an execution script.

---

***REMOVED******REMOVED*** Oncallshift Deployment Configuration

**RECOMMENDED: Use the unified deployment script for simplicity:**
```bash
***REMOVED*** Auto-detect and deploy what changed
node /app/execution-compiled/deploy/full_deploy.js

***REMOVED*** Or be explicit about what to deploy
node /app/execution-compiled/deploy/full_deploy.js --all  ***REMOVED*** Both
node /app/execution-compiled/deploy/full_deploy.js --backend  ***REMOVED*** ECS only
node /app/execution-compiled/deploy/full_deploy.js --frontend  ***REMOVED*** S3+CloudFront only
```

**Manual configuration** (if you need granular control):

***REMOVED******REMOVED******REMOVED*** Backend (ECS)
```bash
CLUSTER_NAME="pagerduty-lite-dev" \
SERVICE_NAME="pagerduty-lite-dev-api" \
AWS_REGION="us-east-1" \
  node /app/execution-compiled/deploy/deploy_ecs.js
```

***REMOVED******REMOVED******REMOVED*** Frontend (S3 + CloudFront)
```bash
BUILD_DIR="./frontend/dist" \
S3_BUCKET="oncallshift-dev-web" \
CLOUDFRONT_DISTRIBUTION_ID="E7BQGD7BWAB8B" \
AWS_REGION="us-east-1" \
  node /app/execution-compiled/deploy/deploy_frontend.js
```

**To find the CloudFront distribution ID:**
```bash
aws cloudfront list-distributions --query "DistributionList.Items[?contains(Aliases.Items, 'oncallshift') || contains(Origins.Items[].DomainName, 'pagerduty-lite')].{Id:Id,Domain:DomainName}" --output table
```

***REMOVED******REMOVED******REMOVED*** Container Build (for backend changes)
```bash
***REMOVED*** Note: oncallshift uses Dockerfile.api, not Dockerfile
IMAGE_NAME="AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/pagerduty-lite-dev-api:$(git rev-parse --short HEAD)" \
DOCKERFILE_PATH="./Dockerfile.api" \
CONTEXT_DIR="." \
AWS_REGION="us-east-1" \
  node /app/execution-compiled/deploy/build_container.js
```

**Note:** The unified `full_deploy.js` script auto-detects the Dockerfile name, so you don't need to specify it manually if using that script.

---

***REMOVED******REMOVED*** Current Task

Your task details are provided in the environment:
- `TICKET_KEY`: The ticket you're working on
- `TICKET_SUMMARY`: Issue summary
- `TICKET_DESCRIPTION`: Full issue description
- `TASK_NOTES`: Additional notes that may clarify or modify the deliverable
- `WORKER_PERSONA`: Your role (backend_developer, frontend_developer, etc.)

**IMPORTANT:** Always read both TICKET_DESCRIPTION and TASK_NOTES. The task notes may contain critical information that changes the requirements.

---

***REMOVED******REMOVED*** Workflow Summary

**⚠️ CRITICAL REMINDER: You MUST do THREE things before finishing:**
1. Add completion comment with PR link
2. Transition ticket to Done using `transition_issue.js`
3. Never leave ticket in "In Progress"

**Full workflow:**
1. Read `directives/common/git_workflow.md` to understand the PR process
2. Find and read the directive that matches your task type
3. **Add analysis comment** explaining your approach
4. Follow the directive step by step
5. Create a PR for human review (unless deploy-enabled)
6. **Add completion comment** with PR link and summary
7. **⚠️ TRANSITION THE TICKET TO DONE** - Run: `TICKET_KEY=$TICKET_KEY TRANSITION_NAME="Done" node /app/execution-compiled/ticket/transition_issue.js`
8. **Record metrics** for the task

**FAILURE TO TRANSITION = INCOMPLETE WORK. The task is NOT done until the ticket is transitioned.**

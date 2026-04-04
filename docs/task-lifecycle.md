# Task Lifecycle

WorkerMill supports multiple execution workflows depending on how you label your tickets. Each workflow controls how much human involvement is required.

## Workflow Modes

Control behavior with issue tracker labels:

| Labels | Mode | Description |
|--------|------|-------------|
| `workermill` | Default | Plan, execute, create PR, wait for human approval |
| `workermill` + `deploy` | Auto-Deploy | Execute, PR, auto-merge, deploy — no human review |
| `workermill` + `review` | Auto Review | Tech Lead AI reviews, approves, and deploys automatically |
| `workermill` + `manager` | Self-Healing | Autonomous error detection and recovery |

---

## Default Workflow

### 1. Task Created
A ticket is assigned to WorkerMill and a task is created.
- Ticket detected via webhook or polling
- Task record created with ticket metadata
- Worker persona selected based on task type

### 2. Worker Executes (5–30 minutes)
AI worker analyzes, implements, and iterates until the task is complete.
- Worker clones repository and reads codebase
- Implements required changes based on ticket
- Runs tests and type checks to verify work
- Iterates automatically if tests fail

### 3. PR Created
Once everything works, worker creates a pull request with all changes.
- All changes committed to feature branch
- Pull request opened with summary
- Includes test results

### 4. Human Review
You review and approve (or request changes) on the PR.

### 5. Deployed
After merge, the ticket is updated and metrics recorded.

---

## Auto-Deploy Workflow (`deploy` label)

Same as default, but:
- PR is created and **merged automatically**
- Worker deploys changes to verify they work
- No human review required
- Best for trusted, automated pipelines

---

## Auto Review Workflow (`review` label)

Full agent autonomy:

1. Worker executes and creates PR
2. **Tech Lead Reviewer** (AI) reviews code quality and correctness
3. Tech Lead can approve or request revisions (up to 3 revisions)
4. After approval, deploys and merges automatically

---

## Self-Healing Workflow (`manager` label)

Autonomous error detection and recovery:

1. Worker executes
2. Manager agent monitors execution, analyzes logs for failures
3. Automatically fixes environment issues
4. Resumes task after repair

---

## Review Flow (with human)

When the `review` label is NOT used, workers create PRs and pause — waiting for human review:

1. Task created
2. Worker executes
3. PR created with "review requested" status
4. **Tech Lead Reviewer or Human reviews**
5. Review approved → webhook fires
6. WorkerMill receives approval, auto-deploys and merges

---

## Escalation Flow

When a worker encounters a blocker it cannot resolve autonomously:

1. Worker executing
2. Worker outputs `::result::escalated` with detailed comment explaining the blocker
3. Human reviews escalation, updates ticket with clarification
4. Task is re-queued: remove and re-add `workermill` label (or use dashboard re-queue button)
5. Worker resumes with new context

**Common escalation triggers:**
- Unclear requirements in ticket description
- Missing attachments or referenced files
- Security concern requiring human decision
- Breaking change needing explicit authorization

---

## Failure States

| Status | Meaning |
|--------|---------|
| `escalated` | Worker understood the task but needs human input to proceed |
| `failed` | Task could not be completed after maximum retries |
| `cancelled` | Task was manually cancelled by an operator |

---

## All Task Statuses

**Planning:** `planning`, `pending_plan_approval`

**Active:** `queued`, `dispatching`, `claimed`, `environment_setup`, `executing`, `consolidating`, `integration_check`, `deploying`

**Waiting:** `blocked`, `pr_created`, `review_requested`, `manager_review`, `revision_needed`, `pr_approved`, `review_approved`, `escalated`

**Terminal:** `completed`, `deployed`, `failed`, `cancelled`, `review_rejected`

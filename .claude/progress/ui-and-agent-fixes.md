# UI and Agent Fixes Progress

## Tasks

### 1. UI Changes
- [x] Rename "Recently Completed" to "All Tasks"
- [x] Add timestamps column to All Tasks table
- [x] Make Jira ticket names clickable (link to Jira ticket)

### 2. Agent Permission Investigation (OCS-172)
- [x] Check worker logs for OCS-172 to identify issues
- [x] Identify any permission problems (Jira API, Git, etc.)
- [x] Fix environment/permissions for future runs

### 3. Jira Integration
- [x] Add Jira transition to "In Progress" when worker starts
- [x] Add completion comment when worker finishes
- [x] Transition to "Done" on successful completion

### 4. Documentation
- [x] Update CLAUDE.md with WorkerMill context

---

## Progress Log

### 2026-01-11 07:25 - Starting investigation

**Current Status:** Investigating why OCS-172 agent didn't update/transition the Jira ticket.

**Worker Details:**
- Task ID: `6cb2dcf6-de62-407a-ad35-460e542ff4d6`
- ECS Task ID: `b8fe0f27a87445088fa4b72165f0388f`
- Persona: devops_engineer
- Model: haiku

### 2026-01-11 07:30 - Root cause identified

**Issues Found:**

1. **Worker analyzed correct repo** - Organization's `defaultGithubRepo` is correctly set to `jarod-rosenthal/pagerduty-lite` (WorkerMill tests against OnCallShift)

2. **No Jira update functionality** - The worker entrypoint (`worker/entrypoint.sh`) didn't:
   - Transition Jira tickets to different states
   - Add comments to Jira tickets

### 2026-01-11 - Fixes Applied

**UI Changes (Dashboard.tsx):**
- Renamed "Recently Completed" section to "All Tasks"
- Added `formatTimestamp()` function for proper date formatting
- Added Time column with createdAt timestamp
- Made Jira keys clickable with external link to `https://oncallshift.atlassian.net/browse/{key}`
- Added Persona column showing worker persona
- Combined Logs and PR into single Links column
- Added Retries column

**API Changes (control-center.ts):**
- Added `createdAt`, `workerPersona`, `retryCount` fields to recentCompleted response
- Increased limit from 10 to 50 tasks

**Worker Changes (entrypoint.sh):**
- Added Jira transition to "In Progress" before Claude runs
- Added completion comment on success/failure
- Added Jira transition to "Done" on successful completion

**Documentation (CLAUDE.md):**
- Added "Origin and Purpose" section explaining WorkerMill is a standalone decoupling from OnCallShift
- Added "Relationship to OnCallShift" section for reference

### Files Modified

- `frontend/src/pages/Dashboard.tsx` - UI changes
- `api/src/routes/control-center.ts` - API field additions
- `worker/entrypoint.sh` - Jira transition/comment logic
- `CLAUDE.md` - Context documentation

---

### 2026-01-11 - Workflow Implementation

**Workflows Implemented:**

1. **WITH deploy label:**
   - Task created → Agent works → deploys → creates PR → merges PR
   - Final state: `deployed`

2. **WITHOUT deploy label:**
   - Task created → Agent works → creates PR → `review_requested`
   - (Approval happens) → `pr_approved`
   - Agent restarts → deploys → merges PR
   - Final state: `deployed`

**Worker Entrypoint (entrypoint.sh):**
- Added deployment run detection via `TASK_NOTES` env var
- Different prompts for first run vs deployment run
- Result markers: `::result::deployed`, `::result::review_requested`, `::result::no_changes`
- Jira transitions: "Done" for deployed, "Review Requested" for review_requested

**API Changes:**
- `api/src/routes/webhooks.ts` - Added GitHub webhook handler for PR approvals
- `api/src/models/Organization.ts` - Added `githubWebhookSecret` field
- `api/src/models/WorkerTask.ts` - Added workflow statuses and columns

**Database Migration:**
- `api/src/db/migrations/1704067200005-AddWorkflowColumns.ts`
  - `github_approved_by` - who approved the PR
  - `deployment_enabled` - true if ticket has 'deploy' label
  - `skip_manager_review` - true if ticket does NOT have 'review' label
  - `task_notes` - notes passed to agent (e.g., "DEPLOYMENT_RUN")
  - `github_webhook_secret` - for organizations

**Documentation:**
- `worker/AGENTS.md` - Complete workflow documentation with decision tree

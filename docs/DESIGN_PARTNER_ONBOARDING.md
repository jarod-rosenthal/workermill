# WorkerMill Design Partner Onboarding

Welcome to the WorkerMill pilot program! This guide will get you up and running in under 30 minutes.

---

## What You'll Need

Before starting, ensure you have:

- [ ] **Jira or Linear workspace** with admin access
- [ ] **GitHub repository** where you want AI workers to make changes
- [ ] **30 minutes** for initial setup

---

## Step 1: Accept Your Invitation (2 min)

1. Check your email for the WorkerMill invitation
2. Click the link to create your account
3. Sign in at [workermill.com](https://workermill.com)

---

## Step 2: Connect Your Issue Tracker (10 min)

### For Jira

1. Go to **Project Settings > Automation** (or Webhooks in older Jira)
2. Create a new automation rule:
   - **Trigger**: When issue updated
   - **Condition**: Issue matches JQL `labels = workermill`
   - **Action**: Send web request
     - **URL**: `https://workermill.com/api/webhooks/jira`
     - **Method**: POST
     - **Headers**: Add `Content-Type: application/json`

3. In WorkerMill Settings, add your **Jira Webhook Secret** (we'll provide this)

### For Linear

1. Go to **Settings > API > Webhooks**
2. Add webhook URL: `https://workermill.com/api/webhooks/linear`
3. Select events: Issue created, Issue updated
4. Create the `workermill` label in your workspace
5. In WorkerMill Settings, add your **Linear Webhook Secret**

---

## Step 3: Connect Your GitHub Repository (5 min)

1. In WorkerMill **Settings > GitHub**, click "Connect Repository"
2. Authorize the WorkerMill GitHub App
3. Select the repository(s) you want workers to access
4. Workers will create branches and PRs in your repository

**Note:** Workers need write access to create branches and PRs.

---

## Step 4: Run Your First Task (10 min)

Let's run a simple test task to verify everything works.

### Create a Test Ticket

In your Jira or Linear project, create a new ticket:

**Title:** `Add current year to footer copyright`

**Description:**
```
Update the footer component to show the current year instead of a hardcoded year.

Files to modify:
- Look for footer component (likely in src/components/)

Acceptance criteria:
- Footer shows "© 2026" (or current year)
- Year updates automatically (use JavaScript Date)
```

**Labels:** `workermill`

### Watch the Magic

1. Open the WorkerMill dashboard at [workermill.com](https://workermill.com)
2. Your task should appear within 10 seconds
3. Watch the real-time terminal output as the worker:
   - Clones your repository
   - Analyzes the codebase
   - Makes the changes
   - Creates a pull request

### Review the PR

Once the task reaches "Review Requested":
1. Click the PR link in the dashboard
2. Review the changes on GitHub
3. Approve or request changes

---

## Step 5: Understand the Labels

Labels control how workers behave:

| Label | What It Does |
|-------|--------------|
| `workermill` | **Required** - Triggers WorkerMill |
| `haiku` | Use Claude Haiku (fastest, cheapest) |
| `sonnet` | Use Claude Sonnet (balanced) |
| `opus` | Use Claude Opus (most capable) |
| `deploy` | Auto-merge and deploy (skip PR review) |
| `review` | Virtual Manager reviews PR before you |
| `backend` | Force backend developer persona |
| `frontend` | Force frontend developer persona |

**Default:** If no model label, uses Haiku. If no persona label, auto-detects from ticket content.

---

## Writing Effective Tickets

Workers perform best with clear, specific tickets.

### Good Ticket Example

```
Title: Add rate limiting to login endpoint

Description:
Implement rate limiting on POST /api/auth/login to prevent brute force attacks.

Requirements:
- Limit to 5 attempts per IP per minute
- Return 429 status when limit exceeded
- Add X-RateLimit-Remaining header

Technical notes:
- Use existing Redis connection from src/lib/redis.ts
- Follow pattern in src/middleware/cors.ts

Acceptance criteria:
- Rate limit works correctly
- Tests pass
- No breaking changes to existing auth flow
```

### Tips for Better Results

1. **Be specific** - "Update the header" is vague; "Change header background from blue to #1a1a1a" is specific
2. **Reference existing files** - Workers understand your codebase better with context
3. **Include acceptance criteria** - Clear success conditions help workers validate their work
4. **Keep scope reasonable** - One feature per ticket, not "rebuild the entire auth system"

---

## Dashboard Overview

### Task States

| Status | Meaning |
|--------|---------|
| **Queued** | Waiting for a worker |
| **Executing** | Worker is implementing |
| **Review Requested** | PR created, waiting for you |
| **Deployed** | Merged and deployed |
| **Failed** | Error occurred (check logs) |
| **Escalated** | Worker needs clarification |

### Handling Escalations

When a worker can't complete a task, it escalates with a comment explaining why. Common reasons:

- Unclear requirements
- Missing dependencies
- Conflicting instructions
- Security concerns

**To resolve:** Update your ticket with the missing information, then remove and re-add the `workermill` label.

---

## Your Pilot Program

As a design partner, you receive:

| Benefit | Details |
|---------|---------|
| **30 days free** | Full platform access |
| **5 PRD workflows** | Multi-story orchestration included |
| **Weekly check-in** | 30-min call with our team |
| **Priority support** | Slack channel access |

### What We Ask

- Provide honest feedback on what works and what doesn't
- Participate in a case study if the pilot is successful
- Share usage metrics for our analytics

---

## Pricing (After Pilot)

| Plan | Price | Tasks/mo | Best For |
|------|-------|----------|----------|
| **Starter** | $99/mo | 100 | Small teams, individual devs |
| **Pro** | $299/mo | 500 | Growing teams, regular usage |
| **Scale** | $999/mo | 2000 | High-volume, enterprise |

Pilot partners receive **50% off the first 3 months** when converting.

---

## Getting Help

- **Dashboard issues?** Refresh the page or check browser console
- **Worker stuck?** Click the task to see logs, then retry
- **Need human help?** Message us in your Slack channel or email support@workermill.com

---

## Next Steps

1. [ ] Complete Steps 1-4 above
2. [ ] Run your first real ticket (not just a test)
3. [ ] Schedule your first weekly check-in
4. [ ] Explore the [full documentation](https://workermill.com/docs)

**Questions?** Reply to your welcome email or ping us on Slack.

Welcome aboard!

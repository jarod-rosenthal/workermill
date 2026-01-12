# WorkerMill Executive Demo Setup

**Created:** 2026-01-11
**Demo Target:** Executive presentation (20 minutes)

## Quick Start Tomorrow

1. Open WorkerMill dashboard: https://workermill.com
2. Open Jira tickets (see below)
3. When ready to trigger a demo task, add the `workermill` label to a ticket
4. Watch the magic happen in real-time

---

## Pre-Demo Checklist

- [x] Stable rollback branch created
- [x] GitHub Actions disabled (won't auto-deploy)
- [x] Demo tickets created (NO labels)
- [ ] Test run each ticket before demo
- [ ] Pre-record backup video

---

## Rollback Branch

**Branch:** `stable/pre-demo-2026-01-11`
**Commit:** `468122c`
**Repo:** oncallshift (pagerduty-lite)

This branch is a frozen snapshot of main. After demo, reset main to this branch to undo all changes.

### To Rollback After Demo:
```bash
cd /mnt/c/Users/jarod/github/pagerduty-lite
git checkout main
git reset --hard stable/pre-demo-2026-01-11
git push -f origin main
# Then re-enable GitHub Actions and redeploy
```

---

## GitHub Actions Status

All workflows are **DISABLED** to prevent auto-deploys during demo:

| Workflow | Status |
|----------|--------|
| Backend (API + Workers) | disabled_manually |
| Frontend (S3 + CloudFront) | disabled_manually |
| Infrastructure (Terraform) | disabled_manually |
| Mobile OTA Updates | disabled_manually |
| Mobile (Expo EAS) | disabled_manually |
| API Integration Tests | disabled_manually |
| E2E Tests (Playwright) | disabled_manually |
| Deploy Pipeline | disabled_manually |
| Test Pipeline | disabled_manually |

### To Re-enable After Demo:
```bash
cd /mnt/c/Users/jarod/github/pagerduty-lite
gh workflow enable "Deploy Pipeline"
gh workflow enable "Test Pipeline"
gh workflow enable "Backend (API + Workers)"
gh workflow enable "Frontend (S3 + CloudFront)"
gh workflow enable "Infrastructure (Terraform)"
gh workflow enable "Mobile OTA Updates"
gh workflow enable "Mobile (Expo EAS)"
gh workflow enable "API Integration Tests"
gh workflow enable "E2E Tests (Playwright)"
```

---

## Demo Tickets (Ready to Trigger)

All tickets are in OCS project with **NO LABELS**. Add `workermill` label to trigger.

| Ticket | Summary | Type | Estimated Time | Demo Purpose |
|--------|---------|------|----------------|--------------|
| [OCS-207](https://oncallshift.atlassian.net/browse/OCS-207) | Fix: Add null check for optional user preferences | Bug | 5-7 min | Quick win opener |
| [OCS-208](https://oncallshift.atlassian.net/browse/OCS-208) | Add: Display last login timestamp on user profile | Story | 10-12 min | Feature showcase |
| [OCS-209](https://oncallshift.atlassian.net/browse/OCS-209) | Security: Add input validation to user search endpoint | Task | 6-8 min | OWASP/Security demo |
| [OCS-210](https://oncallshift.atlassian.net/browse/OCS-210) | Docs: Add API documentation for authentication routes | Task | 4-5 min | Quick backup option |

### To Trigger a Ticket:
1. Open ticket in Jira
2. Add label: `workermill`
3. Optionally add model label: `haiku` (fast/cheap) or `sonnet` (smarter)
4. WorkerMill webhook fires automatically
5. Watch dashboard at https://workermill.com

### Recommended Demo Order:
1. **OCS-207** (Bug fix) - Fast win, shows instant value
2. **OCS-208** (Feature) - Main showcase, more complex
3. **OCS-209** (Security) - Only if time permits, shows OWASP compliance

---

## Demo Script Reference

Full demo script with talking points is at:
`/home/user/.claude/plans/executive-demo-plan.md`

### Key Numbers to Remember:
- WorkerMill cost per bug fix: **$0.15-0.30**
- Offshore equivalent: **$50-100** (1-2 hours)
- Cost savings: **99%+**
- Average task completion: **15 minutes**
- Offshore turnaround: **2-5 days**

### Core Message:
> "WorkerMill transforms a handful of senior engineers into a 24/7 development factory—at 1/100th the cost of offshore development."

---

## URLs

| Resource | URL |
|----------|-----|
| WorkerMill Dashboard | https://workermill.com |
| Jira (OCS Project) | https://oncallshift.atlassian.net/browse/OCS |
| oncallshift GitHub | https://github.com/jarod-rosenthal/pagerduty-lite |

---

## Troubleshooting

### Task not appearing in WorkerMill?
1. Check the `workermill` label is on the ticket
2. Check orchestrator is running (dashboard shows status)
3. Check CloudWatch logs: `/ecs/workermill-dev/api`

### Task stuck or failing?
1. Cancel from WorkerMill dashboard
2. Check worker logs in CloudWatch: `/ecs/workermill-dev/worker`
3. Remove `workermill` label to prevent retry

### Need to cancel a running task?
1. Go to WorkerMill dashboard
2. Find the task
3. Click Cancel button

---

## Post-Demo Cleanup

1. **Remove labels** from any triggered tickets
2. **Rollback oncallshift** to stable branch (see above)
3. **Re-enable GitHub Actions** (see above)
4. **Delete AI branches** if needed:
   ```bash
   git push origin --delete ai/OCS-207
   git push origin --delete ai/OCS-208
   # etc.
   ```
5. **Close/delete demo PRs** in GitHub

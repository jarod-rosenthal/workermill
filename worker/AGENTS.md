***REMOVED*** Agent Instructions

> This file provides context to Claude Code when executing AI Worker tasks.

You operate within a 3-layer architecture that separates concerns:

***REMOVED******REMOVED*** Layer 1: Directive (What to do)
- SOPs in `directives/` defining goals, steps, edge cases
- Read the relevant directive FIRST before doing anything
- Directives are organized by persona: `backend_developer/`, `frontend_developer/`, etc.

***REMOVED******REMOVED*** Layer 2: Orchestration (You)
- Your job: read directives, call execution scripts, handle errors
- You're the decision-maker, not the implementer
- DO NOT write shell commands directly - use scripts from `execution/`

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

Add a brief comment explaining your approach:
```
[AI Worker Analysis]

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
2. **Files modified** - List key files changed (not every file, just important ones)
3. **New artifacts** - Any new files, migrations, or resources created
4. **Verification performed** - How you verified the changes work
5. **Blockers encountered** - Issues faced and how they were resolved
6. **Follow-up needed** - Any related work discovered that needs separate tickets

Example completion comment:
```
[AI Worker Completion Report]

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

***REMOVED******REMOVED******REMOVED*** When to Escalate

Escalate immediately when:
- **Blocked > 15 minutes** on environment/access issues
- **Unclear requirements** after reading all available context
- **Security concern** found during work
- **Breaking change** required but not authorized
- **Production impact** risk identified
- **Cannot reproduce** the reported issue

***REMOVED******REMOVED******REMOVED*** How to Escalate

1. Add ticket comment with:
   - What you've tried
   - What's blocking you
   - What you need to proceed

2. Mark task as "Blocked"

3. Output escalation marker:
   ```
   ::escalation::needed
   ::reason::<brief description>
   ```

***REMOVED******REMOVED******REMOVED*** Escalation Tiers

| Tier | Who | When |
|------|-----|------|
| 1 | AI Worker Manager | Task blocked, needs clarification |
| 2 | Tech Lead | Technical decision needed |
| 3 | On-Call Engineer | Production impact risk |
| 4 | Security Team | Security vulnerability found |

---

***REMOVED******REMOVED*** Deployment (Optional - Task-Specific)

**Deployment is ONLY enabled when the ticket has the `deploy` label.**

***REMOVED******REMOVED******REMOVED*** WITH `deploy` label (Deploy-Enabled Tasks):
Your workflow is:
1. Make code changes
2. Commit changes to your branch
3. **Deploy changes** (use execution scripts for your platform)
4. **Verify deployment succeeded** (check health endpoints)
5. **After successful deployment:** Create PR with summary
6. **Merge the PR** UNLESS the ticket has a `review` label
7. Add completion comment noting deployment and merge status
8. Transition ticket to Done

***REMOVED******REMOVED******REMOVED*** WITHOUT `deploy` label (Default - No Deployment):
Your workflow is:
1. Make code changes
2. Commit and push
3. Create a PR
4. Add completion comment
5. Transition ticket to Done
6. **STOP** - Let humans review, approve, and deploy

---

***REMOVED******REMOVED*** Security Requirements

**Security is NOT optional. Never compromise on security best practices.**

***REMOVED******REMOVED******REMOVED*** ABSOLUTELY FORBIDDEN - Never Do These

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

Sometimes after investigation, you'll find that **no code changes are required**. This is a valid outcome. When this happens:

1. **DO NOT create empty commits** - Never run `git commit --allow-empty`
2. **DO NOT create a PR** - A PR with no meaningful changes wastes reviewer time
3. **DO add a ticket comment** explaining your findings:
   - What you investigated
   - Why no changes are needed
   - Any recommended next steps
4. **Exit cleanly** - The orchestrator will mark the task as "completed with no changes"

**Example scenarios where no code changes are needed:**
- The fix is already in the codebase but not deployed
- The issue is a configuration problem, not a code problem
- The reported bug cannot be reproduced
- The requested feature already exists

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

1. Read `directives/common/git_workflow.md` to understand the PR process
2. Find and read the directive that matches your task type
3. **Add analysis comment** explaining your approach
4. Follow the directive step by step
5. Create a PR for human review (unless deploy-enabled)
6. **Add completion comment** with detailed summary
7. **Transition the ticket to Done**
8. **Record metrics** for the task

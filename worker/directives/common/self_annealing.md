# Self-Annealing Protocol

> When execution fails, diagnose and fix the root cause rather than working around the problem.

## Goal

Improve the AI Worker system by fixing issues when they occur, creating a positive feedback loop where the system becomes more reliable over time.

## Principles

1. **Fix Forward** - When something breaks, fix it properly
2. **Document Everything** - Record what went wrong and how you fixed it
3. **Share Knowledge** - Update directives so future workers benefit
4. **Never Hack Around** - Avoid workarounds that hide problems

## When to Apply

Apply self-annealing when:
- A command fails unexpectedly
- A script produces wrong output
- A directive is unclear or wrong
- A tool doesn't work as documented

Do NOT apply when:
- The failure is due to your input error
- External services are temporarily down
- The fix requires human approval
- **The issue is with infrastructure files** (see below)

## ⛔ CRITICAL: Infrastructure Files Are OFF-LIMITS

**NEVER modify these files, even during self-annealing:**

| File | Why Not |
|------|---------|
| `Dockerfile`, `Dockerfile.*` | Shared by all deployments - changes affect everyone |
| `.gitignore` | Changes what gets committed - affects all developers |
| `deploy.sh`, `deploy/*.sh` | Deployment scripts are tested and maintained separately |
| `docker-compose*.yml` | Infrastructure configuration |
| `.github/workflows/*` | CI/CD pipelines |
| `terraform/*`, `*.tf` | Infrastructure as code |
| `kubernetes/*`, `k8s/*` | K8s manifests |

**If deployment fails due to infrastructure issues:**
1. **Add a detailed comment** to the Jira ticket explaining the error
2. **Create the PR anyway** with your code changes
3. **Output `::result::review_requested`** - let humans handle deployment
4. **DO NOT attempt to fix the infrastructure** - you don't have the full context

## Steps

### Step 1: Diagnose the Failure

Analyze what went wrong:

1. **Read the error message** - What does it actually say?
2. **Check your inputs** - Did you provide correct arguments?
3. **Review the code** - Is there a bug in the implementation?
4. **Check dependencies** - Is something missing?

Common failure patterns:
- **Command not found** - Missing dependency or PATH issue
- **Permission denied** - File permissions or auth issue
- **Timeout** - Network issue or resource exhaustion
- **Parse error** - Unexpected output format

### Step 2: Determine the Fix

Categorize the issue:

| Category | Action |
|----------|--------|
| Bug in code | Fix the code directly |
| Missing dependency | Document installation step |
| Unclear directive | Update the directive |
| Edge case not handled | Add error handling |

### Step 3: Implement the Fix

Make the minimal fix needed:

1. Open the failing file
2. Identify the bug
3. Make the fix
4. Test that it works

Keep fixes focused - don't refactor unrelated code.

### Step 4: Document the Learning

Add to the relevant directive's Self-Annealing Notes:

```markdown
## Self-Annealing Notes

### [Date] - [Brief description]
**Problem:** [What failed]
**Cause:** [Root cause]
**Fix:** [What was changed]
**Lesson:** [How to avoid in future]
```

### Step 5: Commit the Improvement

Create a self-anneal branch:

```bash
git checkout -b fix/self-anneal-<brief-description>
```

Commit message format:
```
fix: improve <component> to handle <edge-case>

Problem: <what was failing>
Solution: <what was fixed>
```

### Step 6: Continue Original Task

After the fix:
1. Return to your original task
2. Re-run the now-fixed operation
3. Continue with the original directive

## Edge Cases

### Fix is Complex

If the fix requires significant refactoring:
1. Create a minimal fix to unblock current work
2. Document the full fix needed in a ticket
3. Continue with workaround for now

### Multiple Issues Affected

If the root cause affects multiple places:
1. Fix the common issue in one place
2. Update all affected code
3. Test each fix individually

### Cannot Determine Fix

If you truly cannot fix the issue:
1. Document the failure in detail
2. Add a comment explaining what happened
3. Mark the task as blocked
4. Do NOT work around the issue

## Self-Annealing Notes

*This section is updated by AI Workers with learned improvements*

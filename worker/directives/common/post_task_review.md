# Post-Task Review

> Blameless analysis after each completed task to identify improvements.

## Goal

Learn from each task to improve the AI Worker system. This creates a positive feedback loop where the system becomes more reliable and efficient over time.

## When to Apply

**Always apply** after:
- P1-P2 (Critical/High) severity tasks
- Any task that took longer than expected
- Any task that required multiple attempts
- Any task that revealed missing documentation
- Any task that uncovered codebase issues

**Optional** for:
- P4-P5 tasks that completed smoothly
- Tasks that followed established patterns exactly

## Review Questions

Work through these questions after completing a task:

### 1. Root Cause Analysis

- **What was the actual root cause?**
  - Was it what we initially thought?
  - Was there a deeper underlying issue?
  - Could this have been prevented?

- **Where did the issue originate?**
  - Code logic error?
  - Missing validation?
  - Configuration problem?
  - External dependency?

### 2. Efficiency Analysis

- **What slowed us down?**
  - Missing documentation?
  - Unclear requirements?
  - Technical debt?
  - Environment issues?
  - Waiting for dependencies?

- **How much time was spent on each phase?**
  - Understanding the problem
  - Finding relevant code
  - Implementing the fix
  - Testing and verification
  - Creating the PR

### 3. Knowledge Gaps

- **What would have helped?**
  - Better error messages in the code?
  - More comprehensive tests?
  - Clearer runbooks/directives?
  - Different tooling?
  - More context in the ticket?

- **What did we learn?**
  - New patterns discovered?
  - Edge cases identified?
  - Better approaches found?

### 4. Improvement Actions

- **What should we improve?**
  - Update directives?
  - Add execution scripts?
  - Fix root cause issues?
  - Create follow-up tickets?
  - Add missing tests?

## Output Actions

### 1. Update Self-Annealing Notes

Add findings to the relevant directive's Self-Annealing Notes section:

```markdown
## Self-Annealing Notes

### [Date] - [Brief description]
**Problem:** [What failed or was slow]
**Cause:** [Root cause identified]
**Fix:** [What was changed or should be changed]
**Lesson:** [How to avoid in future]
```

### 2. Create Follow-up Tickets

For significant findings that need separate work:

```bash
TITLE="[IMPROVEMENT] Brief description" \
DESCRIPTION="Found during task PROJ-XXX. Details..." \
node /app/execution-compiled/ticket/create_issue.js
```

Common follow-up ticket types:
- `[TECH-DEBT]` - Code quality issues to address
- `[DOCS]` - Missing documentation to add
- `[TEST]` - Missing test coverage
- `[DIRECTIVE]` - Directive improvements needed

### 3. Update Metrics

Record the review findings:

```bash
TASK_ID=$TICKET_KEY \
REVIEW_NOTES="Brief summary of findings" \
node /app/execution-compiled/metrics/record_review.js
```

## Review Templates

### Template: Bug Fix Review

```markdown
## Post-Task Review: PROJ-XXX

### Root Cause
The bug was caused by [specific cause].
Initial assumption was [what we thought], but actual cause was [reality].

### Time Breakdown
- Understanding: X min
- Finding code: X min
- Implementing fix: X min
- Testing: X min
- PR creation: X min
- Total: X min

### What Helped
- [Tool/doc/pattern that was useful]

### What Would Have Helped
- [Missing thing that would have sped this up]

### Improvements Made
- Updated [directive/script] with [learning]
- Created follow-up ticket PROJ-YYY for [issue]
```

### Template: Feature Implementation Review

```markdown
## Post-Task Review: PROJ-XXX

### Implementation Summary
Implemented [feature] using [approach/patterns].

### Decisions Made
1. [Decision]: Chose [option A] over [option B] because [reason]
2. [Decision]: ...

### Challenges
- [Challenge 1]: Solved by [approach]
- [Challenge 2]: ...

### What Went Well
- [Positive pattern/approach worth repeating]

### What Could Improve
- [Area for improvement]

### Follow-ups Created
- PROJ-YYY: [related work identified]
```

## Edge Cases

### Task Was Blocked

If the task was blocked rather than completed:
1. Document what blocked you
2. Document what would have unblocked you
3. Create ticket for the blocker if not already tracked
4. Note in metrics as "blocked" outcome

### Multiple Issues Found

If you discovered multiple problems during the task:
1. Fix the primary issue first
2. Create separate tickets for other issues
3. Note all discoveries in the review
4. Prioritize follow-ups appropriately

### No Issues Found

If everything went smoothly:
1. Still record the success pattern
2. Note what made it smooth
3. Consider if this pattern can be replicated
4. Keep review brief but document the positive

## Self-Annealing Notes

*This section is updated by AI Workers with learned improvements*

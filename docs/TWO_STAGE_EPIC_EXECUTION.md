# Two-Stage Epic Execution Implementation Plan

## Overview

Implement two-stage worker execution for Epic workflows where:
- **Stage 1 (Planning)**: Claude explores codebase and creates implementation plan
- **Stage 2 (Execution)**: Fresh Claude context receives ONLY the plan, executes it

This provides true context isolation - the execution phase doesn't see exploration artifacts, giving Claude a clean context window focused purely on implementation.

## Why Two-Stage?

**Current Problem:**
- Claude's context accumulates exploration tokens during planning
- By execution time, context is polluted with exploration artifacts
- No clean separation between "what to do" and "doing it"

**Solution:**
- Stage 1: Claude explores, reasons, and produces a structured plan
- Context clears between stages
- Stage 2: Fresh Claude receives only the plan and directives

## Trigger

- Jira tickets with `epic` label (existing V2 pipeline trigger)
- New env var `TWO_STAGE_EXECUTION=true` passed to worker

---

## Files to Modify

### 1. `api/src/services/orchestrator-v2.ts`

**Location**: Line ~880 (inside `executeStep()` function)

**Change**: Add `TWO_STAGE_EXECUTION` to additionalEnv when spawning worker

```typescript
// Current (line 880):
const result = await runner.runWorkerTask(task, credentials);

// Change to:
const result = await runner.runWorkerTask(task, credentials, {
  additionalEnv: {
    TWO_STAGE_EXECUTION: "true",
  },
});
```

### 2. `worker/entrypoint.sh`

**Location**: After line 1984 (after V2 pipeline processing, before standard prompt building)

**Change**: Add new two-stage execution block (~200 lines)

---

## Planning Stage Prompt Template

```markdown
You are an AI Worker in PLANNING MODE. Your job is to EXPLORE and PLAN, not implement.

## Task Information
- **Ticket**: ${JIRA_ISSUE_KEY}
- **Summary**: ${JIRA_SUMMARY}
- **Persona**: ${WORKER_PERSONA}

## Task Description
${JIRA_DESCRIPTION}

## Your Role (${WORKER_PERSONA})
${DIRECTIVE_CONTENT}

## PLANNING PHASE INSTRUCTIONS

Your goal is to create a detailed implementation plan. You should:

1. **Explore the codebase** to understand:
   - Existing patterns and conventions
   - Related code that will inform your approach
   - Dependencies and imports used
   - Testing patterns in use

2. **Identify files to modify/create**
   - Be specific about file paths
   - Note what changes each file needs

3. **Create a step-by-step plan**
   - Each step should be atomic and verifiable
   - Include code snippets where helpful
   - Consider error handling and edge cases

4. **Consider testing strategy**
   - What tests should be written/updated
   - How to verify the implementation works

## OUTPUT FORMAT

At the END of your response, output the implementation plan in this EXACT format:

\`\`\`
::plan_start::
# Implementation Plan for ${JIRA_ISSUE_KEY}

## Summary
[One paragraph describing what will be built]

## Files to Modify
[List existing files that need changes, with brief description of changes]

## Files to Create
[List new files to create, with brief description]

## Implementation Steps
1. **[Step Title]**: [Detailed description]
   - [Subtask]
   - [Subtask]
2. **[Step Title]**: [Description]
[Continue for all steps]

## Dependencies & Imports
[List any new packages or imports needed]

## Testing Strategy
[How to verify the implementation]

## Risks & Considerations
[Anything the execution phase should watch out for]
::plan_end::
\`\`\`

IMPORTANT: The plan between ::plan_start:: and ::plan_end:: will be passed to a FRESH Claude context for execution. Include all context needed - the execution phase will NOT see your exploration.

Now explore the codebase and create your plan.
```

---

## Execution Stage Prompt Template

```markdown
You are an AI Worker in EXECUTION MODE. You have a clear implementation plan to follow.

## Task Information
- **Ticket**: ${JIRA_ISSUE_KEY}
- **Summary**: ${JIRA_SUMMARY}
- **Persona**: ${WORKER_PERSONA}
- **Branch**: ${BRANCH_NAME}

## Your Role (${WORKER_PERSONA})
${DIRECTIVE_CONTENT}

## Common Guidelines
${COMMON_DIRECTIVE_CONTENT}

## EXECUTION PHASE INSTRUCTIONS

A planning phase has already been completed. Below is the implementation plan you must follow.
Your job is to EXECUTE this plan, not re-explore or re-plan.

IMPORTANT RULES:
1. Follow the plan step-by-step
2. Do not deviate from the plan unless absolutely necessary
3. If you encounter a blocker, document it and proceed with what you can do
4. Commit your changes when complete
5. Create a PR to the target branch

---

## IMPLEMENTATION PLAN

${EXTRACTED_PLAN}

---

## Execution Checklist

[ ] Read the plan above carefully
[ ] Execute each step in order
[ ] Verify each step works before proceeding
[ ] Run any tests mentioned in the Testing Strategy
[ ] Commit changes with descriptive message: [${JIRA_ISSUE_KEY}] <summary>
[ ] Create PR (unless PRD_CHILD_TASK=true, then merge directly)

## Output Markers

When complete, output:
- \`::result::review_requested\` (if PR created for review)
- \`::result::deployed\` (if auto-merged/deployed)
- \`::result::failed\` (if execution failed)
- \`::pr_url::<url>\` (the PR URL)

Begin execution now.
```

---

## Execution Flow

```
TWO_STAGE_EXECUTION=true?
    │
    ▼
┌─────────────────────────────────────────┐
│ Stage 1: PLANNING                       │
│ - Load directives                       │
│ - Build planning prompt                 │
│ - Invoke Claude (stream to dashboard)   │
│ - Parse token usage                     │
└─────────────────────────────────────────┘
    │
    ▼
Extract plan (::plan_start:: to ::plan_end::)
    │
    ├── Plan not found? → Exit with ::result::failed
    │
    ▼
┌─────────────────────────────────────────┐
│ Stage 2: EXECUTION (Fresh Context)      │
│ - Build execution prompt with plan      │
│ - Invoke Claude (stream to dashboard)   │
│ - Parse token usage                     │
└─────────────────────────────────────────┘
    │
    ▼
Standard post-processing (PR creation, markers)
```

---

## Plan Format Specification

```markdown
# Implementation Plan for [JIRA_KEY]

## Summary
One-paragraph description of what will be built.

## Files to Modify
- path/to/file1.ts - Create new component
- path/to/file2.ts - Add method X

## Files to Create
- path/to/new/file.ts - New service for Y

## Implementation Steps
1. **Step 1 Title**: Detailed description of what to do
   - Subtask a
   - Subtask b
2. **Step 2 Title**: Description
   ...

## Dependencies & Imports
List of packages/imports needed.

## Testing Strategy
How to verify the implementation works.

## Risks & Considerations
Anything the execution stage should watch out for.
```

---

## Token Tracking

- Track each stage separately via existing log-parser.cjs
- Sum totals: `TOTAL = PLANNING_TOKENS + EXECUTION_TOKENS`
- Output combined `::input_tokens::` and `::output_tokens::` markers

```bash
# In entrypoint.sh after both stages complete
TOTAL_INPUT=$((PLANNING_INPUT_TOKENS + EXECUTION_INPUT_TOKENS))
TOTAL_OUTPUT=$((PLANNING_OUTPUT_TOKENS + EXECUTION_OUTPUT_TOKENS))
echo "::input_tokens::${TOTAL_INPUT}"
echo "::output_tokens::${TOTAL_OUTPUT}"
```

---

## Error Handling

| Stage | Error | Action |
|-------|-------|--------|
| Planning | Exit code != 0 | Abort with `::result::failed`, `::step_error::Planning phase failed` |
| Planning | No plan markers found | Abort with `::step_error::No valid plan produced` |
| Execution | Exit code != 0 | Normal post-processing (may create partial PR) |
| Execution | Success | Create PR, output result markers |

---

## Log Streaming

Both stages stream to dashboard via existing `log-parser.cjs` pipeline:
```bash
claude ... | tee "${OUTPUT_FILE}" | ${LOG_PARSER_CMD}
```

Stage prefixes in logs distinguish phases:
- `[Stage 1/2] Starting PLANNING phase...`
- `[Stage 1/2] Plan extracted (1234 bytes)`
- `[Stage 2/2] Starting EXECUTION phase with fresh context...`

---

## Verification Steps

1. Create Jira ticket with `epic` + `workermill` labels
2. Watch dashboard for `[Stage 1/2] Starting PLANNING phase...`
3. Verify plan extraction message appears with byte count
4. Watch for `[Stage 2/2] Starting EXECUTION phase...`
5. Confirm execution logs do NOT reference explored files (only files in plan)
6. Verify PR is created with correct changes
7. Check token counts reflect both stages

---

## Future Enhancements (Not in scope for initial implementation)

1. **Model differentiation**: Use Haiku for planning (cheaper) and Sonnet for execution
2. **Interactive plan approval**: Pause between stages for human review (org setting)
3. **Plan caching**: Cache plans for retry scenarios without re-planning
4. **Plan quality scoring**: Critic agent validates plan before execution stage

---

## Key Code Locations

| Component | File | Line |
|-----------|------|------|
| Worker spawn | `orchestrator-v2.ts` | 880 |
| additionalEnv pattern | `orchestrator-v2.ts` | 415, 551 |
| V2 processing end | `entrypoint.sh` | 1984 |
| Standard prompt build | `entrypoint.sh` | 1986+ |
| Claude invocation | `entrypoint.sh` | 2496-2503 |
| Log parser | `log-parser.cjs` | 1-589 |

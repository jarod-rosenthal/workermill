# Skill Integration with WorkerMill Workers

Research document exploring how Claude Code skills (like `/val-imp`) can be integrated with WorkerMill's AI worker agents.

## Current Architecture

### Prompt Construction Flow

```
Jira Ticket (with workermill label)
    ↓
webhooks.ts (creates task in database)
    ↓
orchestrator.ts (polls for queued tasks, claims task)
    ↓
ecs-task-runner.ts (builds 50+ env vars, spawns ECS task)
    ↓
ECS Fargate Container Starts
    ↓
entrypoint.sh (builds prompt from directives + ticket)
    ↓
claude --dangerously-skip-permissions < prompt.md
    ↓
log-parser.cjs (streams output to dashboard)
```

### Key Files

| File | Role | Lines |
|------|------|-------|
| `api/src/services/ecs-task-runner.ts` | Spawns ECS tasks, constructs environment variables | 686 |
| `api/src/services/orchestrator.ts` | Polls for queued tasks, enforces concurrency/cooldown | 5044 |
| `worker/entrypoint.sh` | Main worker orchestrator: directives, prompt building, Claude invocation | 2984 |
| `worker/scripts/log-parser.cjs` | Converts Claude stream-json to dashboard logs | 350+ |
| `worker/directives/{persona}/README.md` | Persona-specific behavior guidelines | varies |
| `worker/directives/common/*.md` | Shared directives across all personas | varies |

### How Claude Code Receives the Prompt Today

```bash
claude \
    --print \
    --dangerously-skip-permissions \
    --model "${CLAUDE_MODEL}" \
    --output-format stream-json \
    < "${PROMPT_FILE}"   # Prompt piped via stdin
```

The prompt file contains (in order):
1. Persona directives (500-2000 lines from `worker/directives/{persona}/README.md`)
2. Common directives (from `worker/directives/common/*.md`)
3. AGENTS.md system instructions
4. Sibling context (for PRD multi-worker workflows)
5. Task description (Jira ticket content)

### Prompt Construction Location

`worker/entrypoint.sh` lines 1987-2271 builds the prompt as a multi-section markdown document.

## Why Skills Don't Work Today

1. **No `.claude/skills/` in target repo** - Workers clone the target repo (e.g., oncallshift), which doesn't have skills defined
2. **No skills in worker container** - The Docker image doesn't include a `.claude/skills/` directory
3. **Prompt is piped via stdin** - Not interactive, so `/val-imp` as a slash command wouldn't trigger Claude Code's skill loading mechanism

## Integration Options

### Option A: Copy Skills into Cloned Repo

Bundle skills in the worker Docker image and copy them to the cloned repo before Claude invocation.

**Implementation:**

1. Add skills to worker image at `/app/skills/`
2. In `entrypoint.sh` after `git clone` (around line 1050):

```bash
mkdir -p /app/repo/.claude/skills
cp -r /app/skills/* /app/repo/.claude/skills/
```

**Pros:**
- Uses Claude Code's native skill loading
- Skills can use all skill features (TaskCreate, validator agents, etc.)

**Cons:**
- Requires Docker image rebuild when skills change
- Skills must be compatible with target repo context

### Option B: Invoke Skill in Prompt Prefix

Prefix the prompt with a skill invocation command.

**Implementation:**

In `entrypoint.sh` lines 1987-2271, instead of:
```markdown
## Task Information
{ticket content}
```

Prefix with:
```markdown
/val-imp

Use the following Jira ticket as your plan:

## Task Information
{ticket content}
```

**Pros:**
- Minimal changes required
- Works with existing skill definitions

**Cons:**
- Depends on Claude Code recognizing `/skill` in stdin prompt
- May not trigger full skill loading mechanism

### Option C: Embed Skill Instructions Inline (Recommended)

Include skill instructions directly in the prompt, similar to how directives work. This doesn't rely on Claude Code's skill loading mechanism.

**Implementation:**

1. Create `worker/directives/common/validated_implementation.md` with skill instructions
2. Detect Jira label and include the directive conditionally
3. Add workflow trigger prefix to prompt

**Pros:**
- Most reliable - doesn't depend on skill loading mechanism
- Consistent with existing directive pattern
- Easy to modify without Docker rebuilds

**Cons:**
- Skill instructions duplicated (in `.claude/skills/` and `worker/directives/`)
- Loses some skill-specific features (though validator agents can still be spawned)

## Recommended Implementation: Option B + C Hybrid

Combine inline skill instructions with prompt prefix for maximum reliability.

### Changes Required

| Change | Location | Purpose |
|--------|----------|---------|
| Add skill directive | `worker/directives/common/validated_implementation.md` | Skill instructions for workers |
| Jira label detection | `api/src/routes/webhooks.ts` | Detect `val-imp` label |
| Task field | `api/src/models/WorkerTask.ts` | Add `useSkill` field |
| Env var | `api/src/services/ecs-task-runner.ts` | Pass `USE_SKILL` to container |
| Conditional include | `worker/entrypoint.sh` ~line 1987 | Include skill directive when flag set |
| Prompt prefix | `worker/entrypoint.sh` ~line 2100 | Add `/val-imp` before task content |

### Environment Variable Flow

```
Jira label: val-imp
    ↓
webhooks.ts: detects label, sets task.useSkill = "val-imp"
    ↓
ecs-task-runner.ts: passes USE_SKILL="val-imp" env var
    ↓
entrypoint.sh: if USE_SKILL set:
    1. Include validated_implementation.md directive
    2. Prefix prompt with skill invocation
```

### Example Prompt Structure with Skill

```markdown
# Validated Implementation Mode

[Contents of validated_implementation.md - the skill instructions]

---

/val-imp

Use the following Jira ticket as your implementation plan:

## Task Information
- **Ticket**: OCS-123
- **Summary**: Add user preferences endpoint
- **Persona**: backend_developer

## Description
[Jira ticket description]

## Instructions
Follow the validated implementation workflow defined above.
Extract requirements, implement one at a time, validate each with an independent agent.
```

## Skill-Specific Considerations

### Validator Agent Spawning

The `/val-imp` skill spawns independent validator agents using Claude Code's `Task` tool. For this to work in workers:

1. Workers must have the `Task` tool available (they do via Claude Code CLI)
2. Validator agents run in the same container context
3. Validators have access to the same files and git state

### Task Tracking

The skill uses `TaskCreate`/`TaskUpdate` for requirement tracking. In worker context:

1. These create local task state within Claude Code
2. Tasks are NOT synced to WorkerMill's database
3. For full integration, would need API endpoints for worker task tracking

### Multi-Worker Coordination

For PRD workflows where multiple workers collaborate:

1. Each worker could run `/val-imp` independently
2. Validators would only see their own worker's implementation
3. Cross-worker validation would require additional coordination

## Future Enhancements

### Skill Registry API

Create an API endpoint for skill definitions:

```
GET /api/skills/{skill-name}/bundle
```

Returns skill instructions that entrypoint can fetch dynamically, similar to directive bundles.

### Skill Results Reporting

Add API endpoints for workers to report skill execution results:

```
POST /api/tasks/{taskId}/skill-results
{
  "skill": "val-imp",
  "requirementsExtracted": 5,
  "requirementsPassed": 4,
  "requirementsFailed": 1,
  "gaps": ["REQ-3: Missing validation on email field"]
}
```

### Dashboard Integration

Show skill execution status in the WorkerMill dashboard:

- Requirements extracted and their status
- Validation pass/fail for each requirement
- Gaps and deviations from plan

## Related Documentation

- `worker/AGENTS.md` - Worker agent system instructions
- `worker/directives/README.md` - Directive system overview
- `.claude/skills/val-imp/instructions.md` - The val-imp skill definition
- `.claude/skills/README.md` - Skills documentation

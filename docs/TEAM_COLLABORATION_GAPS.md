# Team Collaboration: Implementation Gaps

This document tracks incomplete features in the multi-worker collaboration system.

---

## Summary

The team collaboration directive (`worker/directives/common/team_collaboration.md`) defines a protocol for workers to share decisions, ask questions, and answer each other. However, several pieces are missing or incomplete.

| Feature | Status | Blocking Issue |
|---------|--------|----------------|
| Post decisions | Working | - |
| Post questions | Working | - |
| Dashboard sees questions | Working | - |
| Dashboard submits answers | Broken | Missing API endpoint |
| Workers answer siblings | Broken | No continuous polling |
| Expert spawning | Not started | Phase 2 feature |
| Decision Log / ADRs | Not started | Decisions are ephemeral |
| Dependency graph | Working | Already implemented via `storyDependencies` |

---

## Gap 1: Missing `/api/coordination/answer` Endpoint

**Priority: High**

### Problem

The Dashboard's `handleAnswerQuestion()` calls `POST /api/coordination/answer`, but this endpoint doesn't exist.

**Frontend code** (`frontend/src/pages/Dashboard.tsx:1078-1092`):
```typescript
const handleAnswerQuestion = async (messageId: string, answer: string) => {
  await fetch(`${API_BASE}/api/coordination/answer`, {
    method: "POST",
    headers: { ... },
    body: JSON.stringify({ messageId, answer }),
  });
};
```

**API routes** (`api/src/routes/coordination.ts`): No `/answer` endpoint defined.

### Impact

- Human operators cannot answer worker questions from the dashboard
- Workers timeout waiting for answers and proceed with TENTATIVE decisions
- The "Answer" button in CoordinationFeed does nothing

### Solution

Add endpoint to `api/src/routes/coordination.ts`:

```typescript
/**
 * POST /api/coordination/answer
 *
 * Submit an answer to a worker's question.
 * Creates an 'answer' context message with metadata linking to the question.
 */
router.post(
  "/answer",
  authenticateRequest, // Allow JWT (dashboard) authentication
  [
    body("messageId").isUUID().withMessage("messageId must be a valid UUID"),
    body("answer").isString().trim().notEmpty().withMessage("answer is required"),
  ],
  async (req: Request, res: Response) => {
    // 1. Look up the original question message by messageId
    // 2. Extract parentTaskId, persona info from question
    // 3. Create 'answer' context message with metadata.questionId = messageId
    // 4. Worker's wait_for_answer() will find it via polling
  }
);
```

### Files to Modify

- `api/src/routes/coordination.ts` - Add endpoint
- Possibly update `wait_for_answer()` in `worker/entrypoint.sh` if answer format changes

---

## Gap 2: Workers Don't Continuously Poll for Sibling Questions

**Priority: Medium**

### Problem

The directive instructs:
> At task start → `check_sibling_questions` and answer if you can

Workers only check **once** at startup. Questions asked after startup are never seen.

### Timeline Example

```
T=0s   Worker A (frontend) starts, calls check_sibling_questions() → no questions
T=0s   Worker B (security) starts, calls check_sibling_questions() → no questions
T=30s  Worker A asks: "Is localStorage OK for JWT?"
T=30s  Question posted to coordination context
...    Worker B never sees it (already did its check)
T=330s Worker A times out, proceeds with TENTATIVE decision
```

### Impact

- Inter-worker Q&A only works if questions are asked before other workers start
- Most questions go unanswered by siblings
- Relies entirely on human dashboard intervention

### Solution Options

**Option A: Background polling loop in worker**

Add to `worker/entrypoint.sh`:
```bash
# Start background question checker
(
  while true; do
    sleep 30
    questions=$(check_sibling_questions 2>/dev/null)
    if [ -n "$questions" ]; then
      echo "$questions" >> /tmp/sibling_questions.log
      # Could notify Claude via a marker file
    fi
  done
) &
QUESTION_POLLER_PID=$!
```

**Option B: Push notifications via SSE**

Workers subscribe to SSE stream and get notified of new questions in real-time.

**Option C: Accept that siblings won't answer**

Rely on dashboard/human answers only. Simplifies architecture but reduces autonomy.

### Files to Modify

- `worker/entrypoint.sh` - Add polling loop
- Directive may need update to explain async question arrival

---

## Gap 3: Expert Spawning Not Implemented

**Priority: Low (Phase 2)**

### Problem

The plan mentions:
> Phase 2 (Future): Expert request capability - spawn specialist workers mid-task.

This is not implemented. Workers cannot request a specialist (e.g., security engineer) to be spawned to answer a question.

### Desired Flow

```
Worker A (frontend): "Need security review for auth token storage"
       ↓
System spawns security_engineer worker
       ↓
Security worker reviews, posts answer
       ↓
Worker A receives answer, continues
```

### Design Decisions (from plan)

- Expert wait behavior: Block and wait
- Expert scope: Full worker (can modify files)

### Implementation Approach

1. New shell function: `request_expert "security_engineer" "Review JWT storage approach"`
2. API endpoint to spawn single-task worker with expert prompt
3. Parent worker blocks until expert completes or times out
4. Expert posts answer via `answer_sibling()`

### Files to Create/Modify

- `api/src/routes/coordination.ts` - Add expert spawn endpoint
- `worker/entrypoint.sh` - Add `request_expert()` function
- Orchestrator logic to spawn expert workers

---

## Gap 4: Answer Format Mismatch (Potential)

**Priority: Low**

### Problem

The `wait_for_answer()` function looks for answers with:
```bash
answer=$(echo "$response" | jq -r ".contexts[] | select(.metadata.questionId == \"${question_id}\") | .content")
```

It expects `metadata.questionId` to match the question's context ID.

### Verification Needed

When implementing Gap 1, ensure the answer endpoint sets:
```json
{
  "messageType": "answer",
  "metadata": {
    "questionId": "<original-question-context-id>"
  }
}
```

---

## Gap 5: Decision Log / ADRs Not Persisted

**Priority: Medium**

### Problem

The team collaboration directive defines a `DEC-###` format for architectural decisions, but these decisions are:
- Ephemeral (stored in `WorkerContext` table, cleaned up after retention period)
- Scattered in the coordination feed
- Not consolidated into a durable, searchable artifact
- Lost when task cleanup runs

For multi-agent scaling (Mission-Squad pattern), cross-cutting decisions need to be:
- Persisted in the repository
- Discoverable by future workers and humans
- Formatted as Architecture Decision Records (ADRs)

### Current State

```
Worker posts: post_context "decision" "DEC-001: Using bcrypt with cost=12..."
       ↓
Stored in WorkerContext table
       ↓
Streamed to dashboard feed
       ↓
Cleaned up after logRetentionDays (default 30)
       ↓
Decision is lost
```

### Desired State

```
Worker posts: post_context "decision" "DEC-001: Using bcrypt with cost=12..."
       ↓
Stored in WorkerContext table (real-time streaming)
       ↓
Also written to architecture/DECISIONS.md in repo
       ↓
Persisted permanently, searchable, version-controlled
```

### ADR Format

Each decision should be recorded as:
```markdown
## DEC-001: Password Hashing Algorithm

**Date:** 2025-01-23
**Status:** Accepted
**Persona:** backend_developer
**Task:** OCS-123

### Context
Need to hash user passwords securely for the auth system.

### Decision
Using bcrypt with cost factor 12.

### Rationale
- Industry standard, well-audited
- Cost=12 provides good security/performance balance (~250ms per hash)
- Native support in Node.js via bcryptjs

### Consequences
- All password-related code must use the shared hashPassword() utility
- Password reset tokens use the same hashing approach
```

### Solution Options

**Option A: Worker writes ADR file directly**

Update directive to have workers append to `architecture/DECISIONS.md`:
```bash
# When making a decision
post_context "decision" "DEC-001: Using bcrypt..."

# Also persist to repo
cat >> architecture/DECISIONS.md << EOF
## DEC-001: Password Hashing
...
EOF
```

Pros: Simple, immediate
Cons: File conflicts if multiple workers decide simultaneously

**Option B: Post-task ADR generation**

After parent task completes, generate `DECISIONS.md` from all decision-type context messages:
```typescript
// In task completion handler
const decisions = await contextRepo.find({
  where: { parentTaskId, messageType: "decision" },
  order: { createdAt: "ASC" }
});

// Format as markdown and commit
const adrContent = formatAsADR(decisions);
await commitToRepo("architecture/DECISIONS.md", adrContent);
```

Pros: No conflicts, consistent formatting
Cons: Decisions not visible in repo until task completes

**Option C: Constraints message for frozen decisions**

Use the existing `constraints` message type for Mission Lead to post frozen decisions before workers spawn:
```bash
# Mission Lead posts at start
post_context "constraints" "DECISIONS:
- AUTH: bcrypt cost=12, JWT in httpOnly cookie
- API: REST with JSON:API format
- DB: PostgreSQL with TypeORM"
```

Workers read constraints at startup and treat as immutable.

Pros: Workers have decisions upfront
Cons: Doesn't capture decisions made during execution

**Option D: Hybrid approach**

1. Mission Lead posts `constraints` with upfront decisions
2. Workers post `decision` for runtime choices
3. Post-task hook consolidates all into `DECISIONS.md`

### Files to Modify

- `worker/directives/common/team_collaboration.md` - Add ADR writing instructions
- `worker/entrypoint.sh` - Add `write_adr()` helper function (Option A)
- `api/src/services/orchestrator.ts` - Add post-task ADR generation (Option B)
- New file: `architecture/DECISIONS.md` template in target repos

### Related: Existing `constraints` Message Type

The `constraints` message type already exists in `WorkerContext` for PRD-level constraints posted before workers spawn. This could be extended for frozen decisions.

---

## Implementation Order

1. **Gap 1** - Add `/api/coordination/answer` endpoint (enables human answers)
2. **Gap 2** - Add background polling (enables sibling answers)
3. **Gap 4** - Verify answer format during Gap 1 implementation
4. **Gap 5** - Decision Log / ADRs (enables durable architectural record)
5. **Gap 3** - Expert spawning (future phase)

---

## Testing Plan

### Gap 1 Test

1. Start a multi-persona task
2. Worker posts a question
3. See question in dashboard CoordinationFeed
4. Click "Answer" and submit
5. Verify worker receives answer and logs it

### Gap 2 Test

1. Start Worker A
2. Wait 60 seconds
3. Start Worker B
4. Worker B asks a question
5. Verify Worker A sees it (in logs or via answer)

### Gap 5 Test

1. Start a multi-persona task
2. Workers post several decisions (DEC-001, DEC-002, etc.)
3. Task completes
4. Verify `architecture/DECISIONS.md` exists in repo
5. Verify all decisions are formatted as ADRs
6. Verify decisions persist after WorkerContext cleanup

---

## Related Files

| File | Purpose |
|------|---------|
| `worker/directives/common/team_collaboration.md` | Collaboration protocol |
| `worker/entrypoint.sh` | Shell functions (`ask_siblings`, etc.) |
| `api/src/routes/coordination.ts` | Coordination API endpoints |
| `frontend/src/components/CoordinationFeed.tsx` | Feed UI with answer buttons |
| `frontend/src/pages/Dashboard.tsx` | `handleAnswerQuestion()` |

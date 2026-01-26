# Multi-Expert Mode Alignment Plan

## Executive Summary

This plan documents all changes needed to align multi-expert mode with Epic mode's clean output and real-time collaboration capabilities. It also includes findings from the previous ticket (OCS-714/OCS-715) where the Anthropic provider tool schema validation error was fixed.

---

## Part 1: Previous Ticket Findings (inputSchema Fix)

### Problem
When testing multi-expert mode with Anthropic and Google providers, Anthropic calls failed with:
```
tools.0.custom.input_schema.type: Field required
```

Google (Gemini) calls succeeded while Anthropic calls failed.

### Root Cause
The `worker/agents/ai-sdk-executor.js` was using the old AI SDK v4 syntax (`parameters:`) instead of the v5+ syntax (`inputSchema:`) for tool definitions. The packages are v6 but were using deprecated syntax.

### Fix Applied
Changed all 6 tool definitions in `worker/agents/ai-sdk-executor.js`:

| Line | Tool | Change |
|------|------|--------|
| 196 | bash | `parameters:` → `inputSchema:` |
| 213 | read_file | `parameters:` → `inputSchema:` |
| 226 | write_file | `parameters:` → `inputSchema:` |
| 240 | edit_file | `parameters:` → `inputSchema:` |
| 259 | glob | `parameters:` → `inputSchema:` |
| 279 | grep | `parameters:` → `inputSchema:` |

### Verification
OCS-715 test run completed successfully:
- Story 0 (backend_developer - Anthropic): ✅
- Story 1 (frontend_developer - Anthropic): ✅
- Story 2 (qa_engineer - Google): ✅

---

## Part 2: Current Issues with Multi-Expert Mode

### Issue 1: Duplicate Persona Labels in Terminal Output

**Symptom:**
```
[⚙️ backend_developer 🤖] [⚙️ backend_developer 🤖] Tool: read_file
[⚙️ backend_developer 🤖] [⚙️ backend_developer 🤖] Tool result received
```

**Root Cause:**
Two separate locations add prefixes:

1. `worker/agents/ai-sdk-executor.js` (lines 115-120):
```javascript
const LOG_PREFIX = persona
  ? `[${PERSONA_EMOJIS[persona] || "🤖"} ${persona} ${PROVIDER_ICONS[provider] || "🤖"}]`
  : `[Agent]`;
// ...
console.log(`${LOG_PREFIX} ${message}`);  // First prefix added here
```

2. `worker/multi-expert/index.ts` (lines 361-370):
```typescript
child.stdout.on("data", (data) => {
  const text = data.toString();
  for (const line of text.split("\n")) {
    if (line.trim()) {
      console.log(line);  // Already has prefix from executor
      this.postLog(line, story.persona, provider).catch(() => {});  // Adds ANOTHER prefix
    }
  }
});
```

And `postLog()` (lines 189-203):
```typescript
private async postLog(message: string, persona?: string, provider?: string): Promise<void> {
  const prefix = persona && provider ? getLogPrefix(persona, provider) : "[Multi-Expert]";
  console.log(`${prefix} ${message}`);  // SECOND prefix added here!
  // ...
}
```

**Impact:** Messy, unprofessional terminal output that's hard to read.

---

### Issue 2: Communication Feed Not Real-Time

**Symptom:**
The communication/coordination feed only updates after a stage completes, not during execution. This prevents real-time expert collaboration.

**Root Cause:**
Multi-expert coordinator only posts completion messages:

`worker/multi-expert/index.ts` (lines 418-431):
```typescript
private async completeStory(...): Promise<void> {
  // Only called AFTER story execution completes
  await this.api.post("/api/coordination/context", {
    // ...
    messageType: "completion",
    // ...
  });
}
```

Compare to Epic mode which posts real-time during execution:
- `postDecision()` - When making architectural decisions
- `postProgress()` - During implementation steps
- `postBlocker()` - When encountering issues
- `postQuestion()` - When needing clarification

**Impact:**
- Experts cannot see each other's real-time thoughts
- No collaboration during execution
- Dashboard shows stale information
- Defeats the purpose of multi-expert collaboration

---

### Issue 3: Missing Jira Integration

**Symptom:**
Multi-expert mode doesn't update Jira tickets during execution.

**Missing Features:**
1. No work log entries posted to Jira
2. No status transitions (e.g., "In Progress" → "In Review")
3. No comments with execution summary
4. No attachment of PR links

**Epic mode has full Jira integration** via `worker/epic/jira-client.ts`:
- Posts work logs with time spent
- Transitions ticket status
- Adds comments with results
- Links PRs to tickets

**Impact:** Jira tickets remain stale, no visibility into AI work.

---

### Issue 4: Missing Thought Sharing Between Experts

**Symptom:**
Experts work in isolation without sharing decisions or context.

**Missing Context Types:**
| Type | Purpose | Present in Epic | Present in Multi-Expert |
|------|---------|-----------------|------------------------|
| `decision` | Share architectural choices | ✅ | ❌ |
| `progress` | Report implementation steps | ✅ | ❌ |
| `question` | Ask for clarification | ✅ | ❌ |
| `blocker` | Report blocking issues | ✅ | ❌ |
| `file_modified` | Track file changes | ✅ | ❌ |
| `completion` | Report story done | ✅ | ✅ (only one) |

**Impact:**
- No collaboration between experts
- Duplicate work possible
- No conflict detection
- No shared decision history

---

### Issue 5: Missing Dependency Checking

**Symptom:**
Stories execute without verifying dependencies are complete.

**Current Code** (`worker/multi-expert/index.ts` lines 462-463):
```typescript
// Filters stories without dependencies, but doesn't check if deps are COMPLETE
const unclaimedStories = stories.filter((s) => !s.dependencies?.length);
```

**Should check:**
1. Fetch completed story indices
2. Verify all `story.dependencies` are in completed set
3. Only then allow story execution

**Impact:** Stories may execute before their dependencies finish.

---

### Issue 6: Missing Heartbeat Mechanism

**Symptom:**
No periodic health checks during long-running story execution.

**Epic mode has heartbeats** to:
- Indicate worker is still alive
- Update dashboard with activity
- Prevent stale task detection

**Impact:** Dashboard can't distinguish between slow execution and stuck workers.

---

## Part 3: MCP Integration Issues (Documented)

During testing, the following WorkerMill MCP issues were encountered:

| Tool | Issue | Details |
|------|-------|---------|
| `workermill_create_task` | Silent failure | Returns `{"success": false, "error": "Failed to create task"}` |
| `workermill_get_task` | Wrong response type | Returns HTML error page instead of JSON |
| `workermill_list_tasks` | Output too large | Exceeds token limits (121,366 characters) |

These need separate investigation but are documented here for completeness.

---

## Part 4: Implementation TODO List

### Phase 1: Fix Terminal Output (Duplicate Labels)

- [ ] **Task 1.1**: Remove prefix from ai-sdk-executor.js stdout
  - File: `worker/agents/ai-sdk-executor.js`
  - Lines: 115-120 (LOG_PREFIX definition) and all console.log calls
  - Change: Output raw messages without prefix, let coordinator add prefix
  - OR: Strip existing prefix in coordinator before adding new one

- [ ] **Task 1.2**: Fix postLog() to not double-prefix
  - File: `worker/multi-expert/index.ts`
  - Lines: 361-370 (stdout handler) and 189-203 (postLog)
  - Change: Detect if message already has prefix, skip adding another

- [ ] **Task 1.3**: Match Epic mode output format
  - Reference: `worker/epic/executor.ts` lines 76-79, 313-336
  - Pattern: Single prefix generation, consistent formatting

### Phase 2: Implement Real-Time Communication Feed

- [ ] **Task 2.1**: Create coordination client for multi-expert
  - File: NEW `worker/multi-expert/coordination-client.ts`
  - Copy from: `worker/epic/coordination-client.ts`
  - Adapt for multi-expert context

- [ ] **Task 2.2**: Add real-time context posting during execution
  - File: `worker/multi-expert/index.ts`
  - Add: `postDecision()`, `postProgress()`, `postBlocker()` calls
  - When: During story execution, not just at completion

- [ ] **Task 2.3**: Pass coordination context to ai-sdk-executor
  - File: `worker/agents/ai-sdk-executor.js`
  - Add: Callback mechanism or API posting for real-time updates
  - Alternative: Use environment variables to pass API endpoint

- [ ] **Task 2.4**: Post tool usage as progress updates
  - When tool is called → post "progress" context
  - When tool completes → post result summary

### Phase 3: Add Jira Integration

- [ ] **Task 3.1**: Create Jira client for multi-expert
  - File: NEW `worker/multi-expert/jira-client.ts`
  - Copy from: `worker/epic/jira-client.ts`
  - Methods: `postWorkLog()`, `transitionIssue()`, `addComment()`

- [ ] **Task 3.2**: Post work log at story start/end
  - File: `worker/multi-expert/index.ts`
  - Add: Work log entry when story starts
  - Add: Work log update when story completes

- [ ] **Task 3.3**: Transition Jira ticket status
  - When all stories start: Transition to "In Progress"
  - When all stories complete: Transition to "In Review" or "Done"

- [ ] **Task 3.4**: Add completion comment with PR link
  - After PR creation, post comment to Jira with link
  - Include summary of changes made

### Phase 4: Implement Thought Sharing

- [ ] **Task 4.1**: Expose context posting to ai-sdk-executor
  - Add API endpoint or callback mechanism
  - Allow executor to post decisions/thoughts during execution

- [ ] **Task 4.2**: Parse executor output for decision markers
  - Pattern: Lines starting with "Decision:" or similar
  - Post these as `decision` type context messages

- [ ] **Task 4.3**: Share context between stories
  - Before story starts, fetch recent context from siblings
  - Inject into story prompt as background

- [ ] **Task 4.4**: Add file modification tracking
  - When `write_file` or `edit_file` tools used
  - Post `file_modified` context with path and summary

### Phase 5: Implement Dependency Checking

- [ ] **Task 5.1**: Fetch completed story indices
  - Before processing unclaimed stories
  - Query coordination API for completion messages

- [ ] **Task 5.2**: Filter stories by dependency satisfaction
  - Check each story's `dependencies` array
  - Only include if ALL dependencies are in completed set

- [ ] **Task 5.3**: Add retry loop for blocked stories
  - If story blocked by dependencies, wait and retry
  - Configurable timeout before giving up

### Phase 6: Add Heartbeat Mechanism

- [ ] **Task 6.1**: Implement periodic heartbeat during execution
  - File: `worker/multi-expert/index.ts`
  - Interval: Every 30 seconds during story execution
  - Post to: `/api/coordination/heartbeat` or similar

- [ ] **Task 6.2**: Add heartbeat handling in dashboard
  - Display "last seen" timestamp
  - Highlight stale workers (no heartbeat in 60+ seconds)

---

## Part 5: Code Change Summary

### Files to Modify

| File | Changes |
|------|---------|
| `worker/agents/ai-sdk-executor.js` | Remove duplicate prefix, add context posting |
| `worker/multi-expert/index.ts` | Fix postLog, add real-time posting, deps checking, heartbeat |

### Files to Create

| File | Purpose |
|------|---------|
| `worker/multi-expert/coordination-client.ts` | Real-time context posting client |
| `worker/multi-expert/jira-client.ts` | Jira integration client |

### Reference Files (Read-Only)

| File | What to Copy |
|------|--------------|
| `worker/epic/executor.ts` | Output formatting, message handling patterns |
| `worker/epic/coordination-client.ts` | Context posting methods |
| `worker/epic/jira-client.ts` | Jira API integration |

---

## Part 6: Testing Plan

### Test 1: Clean Terminal Output
1. Create test Jira ticket with multi-expert label
2. Verify no duplicate persona prefixes in terminal
3. Compare visually with Epic mode output

### Test 2: Real-Time Communication Feed
1. Watch dashboard communication feed during execution
2. Verify updates appear immediately (not batched)
3. Verify all context types appear (decision, progress, etc.)

### Test 3: Jira Integration
1. Check Jira ticket for work log entries
2. Verify status transitions occurred
3. Verify completion comment with PR link

### Test 4: Expert Collaboration
1. Create multi-story task with dependencies
2. Verify Story 1 context visible to Story 2
3. Verify file modification tracking

### Test 5: Dependency Ordering
1. Create stories with explicit dependencies
2. Verify Story 2 waits for Story 1 completion
3. Verify no out-of-order execution

---

## Appendix: Related Documentation

- `worker/AGENTS.md` - Worker agent instructions
- `worker/epic/README.md` - Epic mode documentation (if exists)
- `CLAUDE.md` - Project overview and guidelines
- `api/src/routes/coordination.ts` - Backend coordination API

---

*Plan created: 2026-01-25*
*Status: Ready for implementation*

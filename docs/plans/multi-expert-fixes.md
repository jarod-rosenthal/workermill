# Multi-Expert Workflow: Critical Issues and Fixes

This document outlines critical issues found in the multi-expert coordination workflow and proposed fixes. Created for collaborative implementation.

## Overview

The multi-expert workflow enables multiple AI agents to work on different stories from a PRD simultaneously. Each story can be assigned to a different persona (backend_developer, frontend_developer, etc.) and potentially use different AI providers.

**Key files:**
- `worker/multi-expert/index.ts` - Coordinator entry point
- `worker/multi-expert/coordination-client.ts` - API client for coordination
- `api/src/routes/coordination.ts` - Coordination API endpoints

---

## Critical Issues

### Issue 1: Race Condition in Story Claiming (CRITICAL)

**Location:** `api/src/routes/coordination.ts:690-751`

**Problem:** The `/api/coordination/claim` endpoint uses a non-atomic check-then-act pattern:

```typescript
// Step 1: Query for existing claims
const existingClaim = await contextRepo.findOne({
  where: { parentTaskId, orgId, messageType: "story_claimed" }
});

// Step 2: Check all claims for matching storyIndex
if (existingClaim) {
  const allClaims = await contextRepo.find({ ... });
  const alreadyClaimed = allClaims.find(c => c.metadata?.storyIndex === storyIndex);
}

// Step 3: Create new claim (NOT ATOMIC with steps 1-2)
const claimedContext = contextRepo.create(claimedContextData);
await contextRepo.save(claimedContext);
```

**Impact:** Two coordinators can both pass the check and both claim the same story, causing:
- Duplicate work on the same story
- Conflicting code changes
- Merge conflicts in PRs

---

### Issue 2: Two Separate API Calls for Story State (HIGH)

**Location:** `worker/multi-expert/index.ts:265-278`

**Problem:** `fetchStories()` makes two separate GET requests:

```typescript
const readyResponse = await this.api.get(`/api/coordination/context/${this.config.parentTaskId}`, {
  params: { messageType: "story_ready" },
});
const claimedResponse = await this.api.get(`/api/coordination/context/${this.config.parentTaskId}`, {
  params: { messageType: "story_claimed" },
});
```

**Impact:** Between these two calls, another coordinator can claim a story that this coordinator is about to try and claim.

---

### Issue 3: No Circular Dependency Detection (HIGH)

**Location:** `worker/multi-expert/index.ts:652-674`

**Problem:** If Story A depends on Story B, and Story B depends on Story A, both stay blocked forever. The system just waits 10 iterations (50 seconds) then abandons all uncompleted stories with no explicit error.

```typescript
while (noProgressIterations < MAX_NO_PROGRESS_ITERATIONS) {
  // ... filter to ready stories
  if (readyStories.length === 0) {
    noProgressIterations++;
    if (noProgressIterations >= MAX_NO_PROGRESS_ITERATIONS) {
      // Just gives up - no cycle detection
      await this.postLog(`No progress for ${MAX_NO_PROGRESS_ITERATIONS} iterations...`);
      break;
    }
  }
}
```

**Impact:** Silent failure with `::result::review_requested` despite incomplete work.

---

### Issue 4: Silent Failures in Coordination Posts (HIGH)

**Location:** `worker/multi-expert/index.ts:343-375`

**Problem:** Critical coordination messages use fire-and-forget:

```typescript
this.coordination.postDecision(...).catch(() => {});  // Silently ignored!
this.coordination.postQuestion(...).catch(() => {});  // Silently ignored!
```

**Impact:** Sibling workers never see decisions/questions. Subsequent work based on false assumptions causes conflicts.

---

### Issue 5: No Timeout on Story Execution (MEDIUM)

**Location:** `worker/multi-expert/index.ts:451-583`

**Problem:** The `executeStory()` method spawns a child process with no timeout:

```typescript
const child = spawn("node", args, { ... });
// NO TIMEOUT - if executor hangs, story never completes
```

**Impact:**
- Story never completes
- Dependent stories stay blocked forever
- Coordinator waits indefinitely

---

### Issue 6: Silent Claim Failure (MEDIUM)

**Location:** `worker/multi-expert/index.ts:684-688`

**Problem:** When claiming fails, the code silently continues:

```typescript
const claimed = await this.claimStory(story.id, story.persona);
if (!claimed) {
  continue;  // NO LOGGING, NO NOTIFICATION
}
```

**Impact:** No visibility into why stories were skipped.

---

### Issue 7: API Errors Return Empty Array (MEDIUM)

**Location:** `worker/multi-expert/index.ts:306-309`

**Problem:** `fetchStories()` returns empty array on API error:

```typescript
} catch (error) {
  console.error("[Multi-Expert] Failed to fetch stories:", error);
  return [];  // Coordinator thinks all stories are done!
}
```

**Impact:** Network hiccup causes coordinator to exit early with `::result::review_requested`, abandoning work.

---

### Issue 8: Unbounded Memory in Context Fetching (LOW)

**Location:** `coordination-client.ts:218-232`

**Problem:** `getCompletedStoryIndices()` loads ALL context messages:

```typescript
async getCompletedStoryIndices(): Promise<Set<number>> {
  const contexts = await this.getAllContexts();  // Gets ALL contexts!
  // ... filter for completions
}
```

**Impact:** For large PRDs with many stories and coordination messages, this causes unbounded memory allocation.

---

## Proposed Fixes

### Fix 1: Atomic Story Claiming

**Type:** Database + API change

**Implementation:**

1. Add migration for partial unique index:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_story_claim
ON worker_context (parent_task_id, org_id, (metadata->>'storyIndex'))
WHERE message_type = 'story_claimed';
```

2. Update `/api/coordination/claim` to use atomic INSERT:
```sql
INSERT INTO worker_context (...)
SELECT $1, $2, $3, ...
WHERE NOT EXISTS (
  SELECT 1 FROM worker_context
  WHERE parent_task_id = $2
    AND org_id = $4
    AND message_type = 'story_claimed'
    AND metadata->>'storyIndex' = $8
)
RETURNING *;
```

3. Return `{ success: false, alreadyClaimed: true }` if INSERT returns no rows.

**Files to modify:**
- New migration in `api/src/db/migrations/`
- `api/src/routes/coordination.ts` - Update claim endpoint

---

### Fix 2: Consolidated Story Fetch Endpoint

**Type:** New API endpoint

**Implementation:**

Add `GET /api/coordination/stories/:parentTaskId` that returns all stories with their current status in a single atomic read:

```json
{
  "stories": [
    {
      "id": "uuid",
      "storyIndex": 0,
      "status": "ready",
      "claimedBy": null,
      "persona": "backend_developer",
      "title": "Implement API endpoint",
      "dependencies": [1, 2],
      "completed": false
    }
  ]
}
```

**Files to modify:**
- `api/src/routes/coordination.ts` - Add new endpoint
- `worker/multi-expert/index.ts` - Update `fetchStories()` to use new endpoint

---

### Fix 3: Circular Dependency Detection

**Type:** Worker logic

**Implementation:**

Add cycle detection function in `index.ts`:

```typescript
private detectCircularDependencies(stories: Story[]): string[] {
  const visited = new Set<number>();
  const recursionStack = new Set<number>();
  const cycles: string[] = [];

  const dfs = (storyIndex: number, path: number[]): boolean => {
    if (recursionStack.has(storyIndex)) {
      const cycleStart = path.indexOf(storyIndex);
      cycles.push(path.slice(cycleStart).join(' -> ') + ` -> ${storyIndex}`);
      return true;
    }
    if (visited.has(storyIndex)) return false;

    visited.add(storyIndex);
    recursionStack.add(storyIndex);

    const story = stories.find(s => s.storyIndex === storyIndex);
    if (story) {
      for (const dep of story.dependencies) {
        dfs(dep, [...path, storyIndex]);
      }
    }

    recursionStack.delete(storyIndex);
    return false;
  };

  for (const story of stories) {
    if (!visited.has(story.storyIndex)) {
      dfs(story.storyIndex, []);
    }
  }

  return cycles;
}
```

Call early in `start()` and fail fast if cycles detected.

**Files to modify:**
- `worker/multi-expert/index.ts`

---

### Fix 4: Retry Logic for Coordination Posts

**Type:** Client logic

**Implementation:**

Add retry wrapper in `coordination-client.ts`:

```typescript
private async postWithRetry(
  messageType: ContextMessageType,
  content: string,
  persona: string,
  metadata?: Record<string, unknown>,
  maxRetries: number = 3
): Promise<ContextMessage | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await this.postContext(messageType, content, persona, metadata);
    } catch (error) {
      if (attempt === maxRetries) {
        console.error(`[CoordinationClient] Failed to post ${messageType} after ${maxRetries} attempts`);
        return null;
      }
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
  }
  return null;
}
```

Update `postDecision()`, `postCompletion()`, and `postBlocker()` to use retry.

**Files to modify:**
- `worker/multi-expert/coordination-client.ts`

---

### Fix 5: Story Execution Timeout

**Type:** Worker logic

**Implementation:**

Add timeout in `executeStory()`:

```typescript
const STORY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

const timeoutId = setTimeout(() => {
  child.kill('SIGTERM');
  setTimeout(() => {
    if (!child.killed) child.kill('SIGKILL');
  }, 10000);
}, STORY_TIMEOUT_MS);

child.on("close", async (code) => {
  clearTimeout(timeoutId);

  if (code === null) {
    // Process was killed (timeout)
    error = `Story ${story.storyIndex} timed out after ${STORY_TIMEOUT_MS / 60000} minutes`;
  }
  // ... existing logic
});
```

**Files to modify:**
- `worker/multi-expert/index.ts`

---

### Fix 6: Logging for Claim Failures

**Type:** Worker logic

**Implementation:**

Update the claim failure handling:

```typescript
const claimed = await this.claimStory(story.id, story.persona);
if (!claimed) {
  await this.postLog(
    `Failed to claim Story ${story.storyIndex} (likely claimed by another coordinator)`,
    story.persona,
    provider
  );
  continue;
}
```

**Files to modify:**
- `worker/multi-expert/index.ts`

---

### Fix 7: Distinguish API Errors from Empty Results

**Type:** Worker logic

**Implementation:**

Update `fetchStories()` return type:

```typescript
private async fetchStories(): Promise<{ stories: Story[]; error?: string }> {
  try {
    // ... existing fetch logic
    return { stories };
  } catch (error) {
    return {
      stories: [],
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}
```

Update caller in `start()`:

```typescript
const { stories, error } = await this.fetchStories();
if (error) {
  await this.postLog(`API error fetching stories: ${error}. Retrying in 5s...`);
  await new Promise(r => setTimeout(r, 5000));
  continue; // Retry instead of exiting
}
```

**Files to modify:**
- `worker/multi-expert/index.ts`

---

### Fix 8: Bounded Context Fetching (Optional)

**Type:** New API endpoint

**Implementation:**

Add `GET /api/coordination/stories/:parentTaskId/completed` that returns just completed indices:

```json
{
  "completedIndices": [0, 1, 3, 5]
}
```

**Files to modify:**
- `api/src/routes/coordination.ts`
- `worker/multi-expert/coordination-client.ts`

---

## Implementation Order

| Priority | Fix | Severity | Effort |
|----------|-----|----------|--------|
| 1 | Atomic story claiming (Fix 1) | CRITICAL | Medium |
| 2 | Circular dependency detection (Fix 3) | HIGH | Low |
| 3 | Story execution timeout (Fix 5) | MEDIUM | Low |
| 4 | Retry logic for coordination (Fix 4) | HIGH | Low |
| 5 | Logging for claim failures (Fix 6) | MEDIUM | Trivial |
| 6 | Distinguish API errors (Fix 7) | MEDIUM | Low |
| 7 | Consolidated story fetch (Fix 2) | HIGH | Medium |
| 8 | Bounded context fetching (Fix 8) | LOW | Low |

---

## Testing Plan

After implementation, test with:

1. **Race condition test:** Spawn 3+ coordinators simultaneously claiming same stories
2. **Circular dependency test:** Create stories with A->B->C->A dependency
3. **Timeout test:** Create story that hangs indefinitely
4. **Network failure test:** Simulate API failures during coordination posts
5. **Integration test:** Run full multi-expert workflow with 5+ stories

---

## Notes for Implementation

- All changes to `coordination.ts` require API deployment: `./deploy.sh --api`
- Worker changes require: `./deploy.sh --worker`
- Database migrations run automatically on API startup
- Test locally before deploying: `cd api && npm run dev`

---

## Gemini 3 Pro Technical Review

The following analysis was obtained from Gemini 3 Pro via Abacus.ai ChatLLM for an independent architectural review.

### Architecture Overview

The Multi-Expert Coordinator implements a **Coordinator-Worker** pattern with four distinct layers:

| Layer | Component | Responsibility |
|-------|-----------|----------------|
| **Orchestration** | `orchestrator-v2.ts` | Task lifecycle, story publishing, worker spawning |
| **Coordination** | `coordination.ts` | REST + SSE API for story claiming, context sharing |
| **Execution** | `index.ts` (coordinator) | Story selection, dependency resolution, child process management |
| **Provider** | `ai-sdk-executor.js` | Universal model factory, tool execution, streaming |

### Universal Provider Support

The `ai-sdk-executor.js` implements a **dynamic provider factory** using Vercel AI SDK:

```javascript
function createModel(provider, modelName) {
  switch (provider) {
    case 'anthropic': return anthropic(modelName);
    case 'openai': return openai(modelName);
    case 'google':
    case 'gemini': return google(modelName);
    case 'ollama': {
      const ollamaClient = createOpenAI({
        baseURL: `${ollamaHost}/v1`,
        apiKey: 'ollama',
      });
      return ollamaClient(modelName);
    }
  }
}
```

**Key capabilities:**
- **Persona-based routing**: JSON config maps personas to specific providers/models
- **Credential injection**: Environment variables per provider (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`)
- **Ollama support**: Uses OpenAI-compatible endpoint with local/remote Ollama servers
- **Unified tool interface**: 6 tools (bash, read_file, write_file, edit_file, glob, grep) work identically across all providers

### Coordination Mechanism

**Hybrid REST + SSE approach:**
- **REST endpoints**: Story claiming (`POST /claim`), context posting, story status
- **SSE stream**: Real-time updates for sibling awareness (decisions, progress, blockers)

**Story lifecycle:**
1. `story_ready` - Published by orchestrator when dependencies met
2. `story_claimed` - Coordinator claims exclusive ownership
3. `completion` - Story finished, unblocks dependents

### Strengths Identified

1. **Heterogeneous Intelligence**: Different stories can use best-fit models (Opus for complex architecture, Haiku for simple CRUD)
2. **Agentic Tooling**: 6 tools with `maxSteps=100` enables deep autonomous exploration
3. **Decoupled Execution**: Child process isolation prevents one story from crashing others
4. **Real-time Context**: SSE enables sibling awareness for conflict avoidance

### Weaknesses and Recommendations

| Weakness | Severity | Recommendation |
|----------|----------|----------------|
| **TOCTOU race condition** in story claiming | CRITICAL | Use database-level atomic INSERT with unique constraint |
| **Broken dependency chain** - stories with deps never published when deps complete | CRITICAL | Add `publishDependentStories()` triggered by completion events |
| **Silent coordination failures** - fire-and-forget posts | HIGH | Implement retry with exponential backoff |
| **No circular dependency detection** | HIGH | Add DFS-based cycle detection at startup |
| **Unbounded execution** - no story timeout | MEDIUM | Add 15-minute timeout with SIGTERM/SIGKILL escalation |
| **Two API calls for story state** | MEDIUM | Consolidate to single atomic endpoint |

### Critical Blocking Issue

**Dependent stories are never published.** The `publishStoriesReady()` function in `orchestrator-v2.ts` only publishes stories with no dependencies:

```typescript
if (dependencies.length > 0) {
  logger.info("Skipping story with dependencies", {...});
  continue;  // NEVER PUBLISHED LATER
}
```

When a dependency completes, there is no code to re-evaluate and publish newly-unblocked stories. This means any PRD with story dependencies will leave dependent stories orphaned.

**Required fix:** Add a `checkAndPublishUnblockedStories()` function triggered when any `completion` message is posted.

---

## Additional Files Reference

| File | Lines | Purpose |
|------|-------|---------|
| `worker/multi-expert/index.ts` | ~767 | Main coordinator entry point |
| `worker/multi-expert/coordination-client.ts` | 274 | API client for coordination |
| `worker/agents/ai-sdk-executor.js` | ~825 | Universal provider factory + tool execution |
| `api/src/routes/coordination.ts` | ~1117 | Coordination REST API endpoints |
| `api/src/services/orchestrator-v2.ts` | ~500 | Task lifecycle, story publishing |

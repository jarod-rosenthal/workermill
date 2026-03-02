# Implementation Plan: Decomposer-Planned Stories

**Design doc:** `docs/plans/2026-03-02-decomposer-planned-stories-design.md`

## Steps

### Step 1: New decomposer prompt and function

**File:** `api/src/services/prd-decomposer.ts`

Add alongside existing code (no modifications to existing functions):

1. Add `PreComputedStory` interface and extend `DecomposedCard` with optional `stories?: PreComputedStory[]`
2. Add `SYSTEM_PROMPT_WITH_STORIES` constant — extends existing `SYSTEM_PROMPT` with story-level planning instructions and modified output format (cards include `stories[]` array with `targetFilePatterns`)
3. Add `decomposePrdWithStories()` function — same signature as `decomposePrd()`, uses new prompt, returns `DecomposedPrd` where cards have `stories[]` populated
4. Add `decomposePrdWithStoriesStreaming()` function — same pattern as `decomposePrdStreaming()`, uses new prompt
5. Update `validateDecomposedPrd()` to optionally validate `stories[]` when present (story deps are DAG, personas valid, no overlapping targetFilePatterns within a card)

**Validation:** `cd api && npm run typecheck`

### Step 2: Route branching in prd.ts

**File:** `api/src/routes/prd.ts`

In the decompose endpoint:

1. Read `org.planningMode` (already available via `req.organization`)
2. If `planningMode === "decomposer_planned"`, call `decomposePrdWithStories()` (or streaming variant) instead of `decomposePrd()`
3. When creating `WorkerTask` records for cards (existing transaction block), if card has `stories[]`, store them in `jiraFields.preComputedStories`
4. Card description remains the same (prose) — `preComputedStories` is machine-readable data in jiraFields

No changes to the board/column/dependency creation logic.

**Validation:** `cd api && npm run typecheck`

### Step 3: Planning prompt passthrough

**File:** `api/src/routes/remote-agent.ts`

In the `GET /planning-prompt` handler:

1. Check `task.jiraFields.preComputedStories`
2. If present, include in response: `preComputedStories: task.jiraFields.preComputedStories`
3. Also include `planningMode: org.planningMode` (already partially done — just ensure the value flows)

**File:** `api/src/services/planning-agent-local.ts`

1. Add `buildGroundingPrompt(input: PlanningInput & { preComputedStories: PreComputedStory[] }): string` — short prompt that tells the LLM to resolve `targetFilePatterns` against the repo and emit `ExecutionPlan` JSON
2. Keep existing `buildPlanningPrompt()` untouched

**Validation:** `cd api && npm run typecheck`

### Step 4: Agent grounding pass

**File:** `agent/src/planner.ts`

In `planTask()`:

1. After fetching planning prompt (line ~853), check if response includes `preComputedStories` array
2. If present and non-empty, branch to grounding pass:
   a. Clone repo (same as today — reuse existing `cloneTargetRepo()`)
   b. Build grounding prompt using the pre-computed stories + repo cwd
   c. Single `runClaudeCli()` call with repo tools (same pattern as iteration 1)
   d. Parse output as `ExecutionPlan` (same `parseExecutionPlan()`)
   e. Apply guardrails: `applyFileCap()`, `applyStoryCap()`, `resolveFileOverlaps()`, `fixInvalidPersonas()`
   f. Post plan via `postValidatedPlan()` (same path as today)
   g. **No critic loop** — skip directly to posting
3. On any failure (parse error, LLM error), log warning and **fall back to full planner-critic loop** (existing code continues from the `for` loop)
4. If `preComputedStories` is absent/empty, existing code runs unchanged

**Validation:** `cd agent && npm run typecheck`

### Step 5: Agent local-api passthrough

**File:** `agent/src/local-api.ts`

In the `/api/agent/planning-prompt` stub handler:

1. If the task's jiraFields contain `preComputedStories`, forward them in the response
2. This enables the standalone agent (no cloud API) to also use the grounding path

**Validation:** `cd agent && npm run typecheck`

### Step 6: Type checks and test

Run full type checks across all packages:

```bash
cd api && npm run typecheck
cd agent && npm run typecheck
```

Manual test plan:
1. Set org `planningMode` to `"decomposer_planned"` via DB update
2. Submit a PRD through the dashboard
3. Verify decomposer output includes stories per card (check API logs)
4. Verify cards enter planning and use grounding pass (check agent logs for "grounding" messages)
5. Verify workers receive valid `ExecutionPlan` and execute normally
6. Set `planningMode` back to `"strict"`, run another PRD — verify full planner-critic loop runs (unchanged)

### Step 7: Deploy

Push commits and deploy API + agent:

```bash
git push origin main && git push upstream main
./deploy.sh --api
```

Agent changes require a new agent binary release (bump version, tag, push).

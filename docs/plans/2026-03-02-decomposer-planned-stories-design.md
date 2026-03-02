# Design: Decomposer-Planned Stories

**Date:** 2026-03-02
**Status:** Draft
**Author:** Claude (with user direction)

## Problem

Every card runs a full planner-critic loop: clone repo → explore with tools (60-180s) → critic validation (30-60s) → possible re-plan (×3) → refinement pass. For a 4-card full-spec build, that's 8-20 minutes and 500K-2M tokens of planning before any code is written.

The root cause: the decomposer knows the project architecture from the PRD but can't ground file paths (no repo access). The planner has repo access but re-discovers the architecture from scratch — independently per card.

## Solution

Add a new planning mode `"decomposer_planned"` where:

1. **Decomposer** outputs cards with pre-computed story breakdowns (including path patterns for `targetFiles`)
2. **Planner** detects pre-computed stories and runs a fast **grounding pass** instead of the full planner-critic loop — clone repo once, resolve path patterns against real files, emit `ExecutionPlan`

The existing `"strict"` and `"simplified"` modes are untouched. Toggle via `org.planningMode`.

## Architecture

### Data flow

```
PRD text
  │
  ▼
decomposePrdWithStories()          ← NEW function (alongside existing decomposePrd)
  │  Uses SYSTEM_PROMPT_WITH_STORIES (new prompt)
  │  Output: DecomposedPrd with cards[].stories[]
  │
  ▼
prd.ts route
  │  Stores stories in card description (structured section)
  │  AND in WorkerTask.jiraFields.preComputedStories (machine-readable)
  │
  ▼
runCardAsWorkerTask()
  │  Writes preComputedStories into jiraFields alongside qualityGates
  │
  ▼
Agent: GET /api/agent/planning-prompt
  │  Server detects preComputedStories in task.jiraFields
  │  Returns { ..., preComputedStories: [...], planningMode: "decomposer_planned" }
  │
  ▼
Agent: planTask()
  │  Detects preComputedStories in prompt response
  │  BRANCH: grounding pass (not full planner-critic)
  │    1. Clone repo (same as today)
  │    2. Single LLM call: "Here are pre-planned stories with path patterns.
  │       Resolve against this repo. Output ExecutionPlan JSON."
  │    3. Apply same guardrails (fileCap, storyCap, overlapResolve, personaFix)
  │    4. Post plan to API (same postValidatedPlan path)
  │
  ▼
publishStoriesReady()              ← NO CHANGE — consumes ExecutionPlan as before
```

### What changes per file

| File | Type | Change |
|------|------|--------|
| `api/src/services/prd-decomposer.ts` | New code | `SYSTEM_PROMPT_WITH_STORIES` + `decomposePrdWithStories()` |
| `api/src/routes/prd.ts` | Branch | If `decomposer_planned`, call new function, store stories in jiraFields |
| `api/src/routes/remote-agent.ts` | Branch | `/planning-prompt` passes `preComputedStories` from jiraFields to agent |
| `api/src/services/planning-agent-local.ts` | New code | `buildGroundingPrompt()` alongside existing `buildPlanningPrompt()` |
| `agent/src/planner.ts` | Branch | If `preComputedStories` present, run grounding pass instead of full loop |
| `agent/src/local-api.ts` | Pass-through | Forward `preComputedStories` in planning prompt response |

| File | Type | Change |
|------|------|--------|
| `api/src/services/board-execution.ts` | None | — |
| `api/src/services/pipeline-executor.ts` | None | — |
| `api/src/routes/boards.ts` | None | jiraFields already flexible |
| Worker code | None | — |
| Coordinator | None | — |
| Frontend | None | — |

### Pre-computed story format

The decomposer outputs stories per card in this shape (embedded in `DecomposedCard`):

```typescript
interface PreComputedStory {
  id: string;              // "story-0", "story-1", ...
  title: string;
  description: string;     // scope label (2-3 lines)
  persona: string;         // from valid personas
  priority: number;
  estimatedEffort: "small" | "medium" | "large";
  dependencies: string[];  // inter-story within card: ["story-0"]
  targetFilePatterns: string[];  // glob patterns: ["api/handlers/*.go", "api/models/flag.go"]
}
```

The grounding pass resolves `targetFilePatterns` → `targetFiles` (exact paths). For new files (patterns that don't match existing files), the grounding LLM infers the intended path from the pattern + story context.

### Decomposer prompt additions

The new `SYSTEM_PROMPT_WITH_STORIES` extends the existing prompt with:

- Story breakdown instructions per card (same rules as the planner prompt: no overlapping targetFiles, maximize parallelism via persona diversity, no circular deps)
- `targetFilePatterns` instead of `targetFiles` — the decomposer has no repo access, so it outputs patterns based on PRD context (e.g., the PRD says "Go+Fiber backend in `api/`" → patterns like `api/handlers/*.go`)
- Output format includes `stories[]` array per card

### Grounding prompt

Short prompt (~2K tokens) that tells the LLM:

> Here are pre-planned stories for a coding task. Each story has `targetFilePatterns` (glob patterns).
> Use your tools to explore the repository and resolve these patterns to exact file paths.
> For patterns matching existing files, use those paths.
> For patterns indicating new files, infer the exact path from the pattern and story context.
> Output the ExecutionPlan JSON with resolved `targetFiles`.

This runs with repo tool access (`cwd` set to clone), takes ~10-30s, uses ~10-20K tokens.

### Guardrails

The same post-generation guardrails apply to the grounding pass output:
- `applyFileCap()` — max files per story
- `applyStoryCap()` — max stories
- `resolveFileOverlaps()` — no two stories share a targetFile
- `fixInvalidPersonas()` — replace invalid personas

### No critic needed

The decomposer's output is already validated by `validateDecomposedPrd()`. The grounding pass only resolves file paths — it doesn't redesign the plan. Critic validation would add cost for minimal value.

If the grounding pass produces invalid JSON or fails to parse, fallback to the full planner-critic loop (same as today's error recovery).

## Rollback

Set `org.planningMode` back to `"strict"` or `"simplified"`. New code paths are never entered. No schema changes required (varchar column, no enum).

## Token/time savings estimate

| Metric | Current (strict) | New (decomposer_planned) |
|--------|------------------|--------------------------|
| Decomposer call | ~20K tokens | ~30-40K tokens (+story detail) |
| Per-card planning | 80-500K tokens | 10-20K tokens (grounding only) |
| Per-card wall time | 2-12 min | 15-45s |
| 4-card build total | 340-2020K tokens | 70-120K tokens |
| 4-card planning time | 8-48 min | 2-4 min |

## Risks

1. **Decomposer story quality** — the decomposer has never done story-level planning. May need prompt iteration.
   - Mitigation: fallback to full planner on parse failure; toggle back to `strict` if quality is unacceptable.

2. **Path pattern accuracy** — patterns from PRD context may not match repo reality.
   - Mitigation: grounding pass resolves patterns; if too many fail, grounding LLM can flag issues.

3. **Single-card mode** — per-task runs (no PRD decomposition) don't go through the decomposer.
   - Mitigation: for single cards without PRD, the planner checks if `preComputedStories` exists. If not, falls back to full planner. Could later add a "fast story extraction from card description" path.

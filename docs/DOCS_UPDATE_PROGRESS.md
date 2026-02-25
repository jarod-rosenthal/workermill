# Docs Update Progress Tracker

## Goal
Update public-facing docs to accurately reflect the current codebase. Key changes:
1. Remove hardcoded "11 AI Experts" — use dynamic count from API (already done in DocsOverview.tsx, but label still says "AI Experts" with a number)
2. Update "Platform Capabilities" section — don't hardcode persona count
3. Rewrite "Workflow Modes" in TaskLifecycle.tsx — currently uses internal jargon ("Epic Planning", "sdk mode")
4. Update TaskLifecycle.tsx to reflect current architecture
5. Update Epics.tsx to match current board/card system
6. Update DocsOverview.tsx for accuracy
7. Update AdvancedFeatures.tsx for accuracy

## Codebase Findings (Source of Truth)

### Two Main Ways to Run Workloads

**1. Full Build (Build from Spec)**
- Frontend: "Full Build" button on boards, VS Code context menu
- API: `POST /api/prd/decompose` — accepts PRD from text/file/url/repo
- Decomposer: `api/src/services/prd-decomposer.ts` — uses AI to break PRD into cards
- Creates a KbBoard with dependency-ordered KbCards
- Each card = one epic (vertical slice / architectural layer)
- Cards have dependency tracking via `KbCardDependency`
- Cascade execution: `api/src/services/board-execution.ts` — `processUnblockedCards()`
  - Serial execution: only one card runs at a time per board
  - When a card completes, cascade triggers the next unblocked card
  - Respects dependency graph
- Auto-run configurable per org: `org.prdAutoRun`
- Each card, when run, goes through the same planning + execution as a regular task

**2. Run as Task (Individual Card/Ticket)**
- From board: `POST /api/boards/:boardId/cards/:cardId/run` → `runCardAsWorkerTask()`
- From issue tracker: Jira/Linear/GitHub webhook creates a WorkerTask
- Each task goes through planning → decomposition into stories → execution
- Planning: `api/src/services/planning-workflow.ts` handles planning phase
  - V1/V2/V3 planners available, routed by config
  - Critic validation optional (critic label)
  - Planning Agent analyzes ticket + codebase, creates stories
- Dispatch: `api/src/services/task-dispatch.ts` — creates child tasks from plan
- Execution: stories execute via workers (ECS, local Docker, or remote agent)

### Execution Modes (from WorkerTask model)
- `single` — default, single worker
- `sequential` — V2 pipeline, tasks in sequence
- `parallel` — Epic mode (Anthropic only), multiple experts in parallel
- `multi-expert` — Multi-provider mode, any provider

### Workflow Labels (from codebase, NOT docs)
- `workermill` — triggers task (required)
- `deploy` — auto-deploy after completion
- `review` — Tech Lead Reviewer AI reviews PR
- `manager` — self-healing mode (auto-repair environment issues)
- `critic` — planner-critic validation before execution
- `improve` — self-learning mode
- `sdk` — standard SDK mode (single worker, no decomposition)
- Model labels: `haiku`, `sonnet`, `opus`
- Provider labels: `openai`, `gemini`, `ollama`

### Planning Flow (for both Full Build cards and individual tasks)
1. Task enters "planning" status
2. Planning Agent analyzes ticket + clones/reads codebase
3. Decomposes into stories with dependencies
4. Critic validates plan (if critic label present, or if threshold not met)
5. Stories dispatched as child tasks
6. Workers execute stories (parallel or sequential based on mode)
7. Results aggregated, PR created

### Personas
- Fetched dynamically from `/api/personas/public`
- DocsOverview.tsx already fetches count dynamically (good!)
- Personas page fetches list dynamically (good!)
- Current count: 12 (per CLAUDE.md: "Personas consolidated from 16 to 12")
- NOT hardcoded as "11" anywhere — the "11" text was the old hardcoded stat

### Key Terms to Avoid (Internal Jargon)
- "Epic Planning" → use "Task Planning" or just "Planning"
- "Epic mode" → just describe what happens (task decomposition)
- "sdk mode" → "Single Worker Mode" or similar
- "multi-expert" → "Multi-Provider" or describe the behavior

## Files to Update

### 1. DocsOverview.tsx (/docs)
- [x] ANALYZED
- Stats section "Platform Capabilities": persona count already dynamic, but label is "AI Experts" — could just say "Specialized Workers" or "Worker Personas"
- "Epic Planning" mentioned in features and description — reword
- "How It Works" steps reference "stories" which is internal jargon

### 2. TaskLifecycle.tsx (/docs/task-lifecycle) — LARGEST CHANGE
- [x] ANALYZED
- "Workflow Modes" section (lines 281-353) needs complete rewrite
  - Currently presents 4 modes: Epic Planning (Default), Auto-Deploy, Auto Review, Self-Healing
  - Jargon-heavy ("Epic Planning", "sdk", "Standard SDK Mode")
  - The `sdk` label reference and "Critic Validation" in the label table
- "Label Reference" table (lines 356-369) needs cleanup
- "Advanced Features" section at bottom references "Epic Planning"
- Autopilot flow is mostly fine (accurate task lifecycle)
- Review flow is accurate

### 3. Epics.tsx (/docs/epics)
- [x] ANALYZED
- Content is decent but uses "Epic" terminology throughout
- Could rename to "Boards & Cards" or similar
- Running an epic = "Run All" on a board — accurate
- Story terminology could be softened

### 4. AdvancedFeatures.tsx (/docs/advanced-features)
- [x] ANALYZED (first 100 lines)
- "Epic Planning stages" comment and data — uses team planning terminology
- References "Epic Planning" explicitly
- Coordination endpoints listed — fine, these are real

### 5. DocsLayout.tsx (sidebar navigation)
- [x] ANALYZED
- Nav item: "Epics & Stories" — could be updated to match new terminology

## Implementation Order
1. DocsOverview.tsx — quick fixes (terminology, stats label)
2. TaskLifecycle.tsx — major rewrite of Workflow Modes section
3. Epics.tsx — terminology updates
4. AdvancedFeatures.tsx — terminology updates
5. DocsLayout.tsx — sidebar label if needed

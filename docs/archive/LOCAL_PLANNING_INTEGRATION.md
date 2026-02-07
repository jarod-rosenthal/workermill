# Local Planning System Integration

**Created:** 2026-02-04
**Status:** ✅ Implementation Complete (Option A)
**Related Branch:** feature/local-workermill

## Problem Statement

Local execution mode (`EXECUTION_MODE=local`) uses a simplified planning agent that bypasses the sophisticated cloud planning system. This causes:

1. **No dependency tracking** - Stories run in parallel without respecting dependencies
2. **No mutex groups** - Stories touching the same files can conflict
3. **No complexity scoring** - Story count is arbitrary rather than calculated
4. **No validation** - Forward dependencies, phase ordering issues go unchecked

### Observed Bug (2026-02-04)

When running a local Epic task, stories executed in parallel despite needing sequential execution:

```
[🗺️ planning_agent 🤖] Generated 17 stories for execution
[👨‍💼 tech_lead 🤖] Story 0: Repository Setup and Project Foundation
[👨‍💼 tech_lead 🤖] Story 16: Prisma Schema
```

Story 16 (Prisma Schema) ran simultaneously with Story 0 (Repository Setup) because:
1. `publishStoriesReady()` wasn't called before spawning local container
2. Stories with dependencies were being skipped entirely
3. Field name mismatch: `dependsOn` vs `dependencies`
4. Planning prompt example showed only empty `"dependencies": []`

---

## Existing Cloud Planning Infrastructure

### File Locations

| File | Purpose |
|------|---------|
| `api/src/services/planning-inventory.ts` | PRD inventory extraction |
| `api/src/services/planning-scoring.ts` | Dual scoring (Scope + Risk) |
| `api/src/services/planning-validation.ts` | Validation rules + mutex groups |
| `api/src/services/planning-types.ts` | Type definitions (ExecutionPlanV2, PlannedStoryV2) |
| `api/src/services/planning-themes.ts` | Theme extraction |
| `api/src/services/planning-agent.ts` | Main planning orchestration |
| `api/src/services/planning-agent-local.ts` | **Simplified local version (the problem)** |

### Inventory Extraction (`planning-inventory.ts`)

Extracts structured data from PRD:

```typescript
interface PRDInventory {
  journeys: Journey[];           // User flows
  uiSurfaces: UISurface[];       // UI components
  apiEndpoints: APIEndpoint[];   // Backend endpoints
  entities: Entity[];            // Data models
  integrations: Integration[];   // External services
  migrations: Migration[];       // Data/schema migrations
  nonFunctionals: NFR[];         // Security, performance, compliance
  unknowns: Unknown[];           // Blocking unknowns need spikes
  subsystems: Subsystem[];       // For mutex group detection
  complexityFlags?: string[];    // "Small but hard" patterns
}
```

### Dual Scoring System (`planning-scoring.ts`)

#### Scope Weights
```typescript
const SCOPE_WEIGHTS = {
  journeys: 8,        // Each journey is significant work
  uiSurfaces: 5,      // UI components require design + implementation
  apiEndpoints: 3,    // Endpoints are usually well-defined
  entities: 5,        // Data models need design + migration
  integrations: 8,    // External integrations are complex
  migrations: 10,     // Migrations are risky and need careful handling
  nonFunctionals: 4,  // NFRs require cross-cutting implementation
};
```

#### Complexity Multipliers
```typescript
const COMPLEXITY_MULTIPLIERS = {
  simple: 1.0,   // Baseline effort
  medium: 1.4,   // 40% more effort
  hard: 1.9,     // 90% more effort
};
```

#### Risk Scoring
- Blocking unknowns: 15 pts each
- High-risk migrations: 12 pts each
- External integrations: 8 pts each
- Security requirements: 10 pts each
- Performance requirements: 7 pts each
- Subsystem coordination penalty: 4 pts per subsystem beyond 2

#### Key Functions
```typescript
// Main scoring function
function calculateDualScore(inventory: PRDInventory): DualScore {
  // Returns: scope, risk, shouldDecompose, targetStories, mandatoryStories
}

// Mandatory story allocations (cannot be skipped)
interface MandatoryStoryBuckets {
  spikeStories: number;       // 1 per 2 blocking unknowns (capped at 3)
  migrationStories: number;   // 1 per migration + 1 for high-risk
  integrationStories: number; // 2 for new integrations
  nfrStories: number;         // Security/compliance/performance
}

// Trivial ticket detection (fast-path to single story)
function detectTrivialTicket(inventory, scopeRaw, riskRaw): TrivialTicketResult
```

### Validation System (`planning-validation.ts`)

#### Validation Rules
1. `foundation_exists` - Plan must have foundation theme
2. `story_zero_foundation` - Story 0 must be foundation phase
3. `phase_ordering` - Stories follow phase sequence (foundation → core → integration → testing)
4. `forward_dependencies` - No story depends on a later story
5. `testing_dependencies` - Test stories depend on what they test
6. `valid_personas` - All personas are coding personas
7. `story_sizing` - Story points ≤ 3, target files ≤ 5

#### Auto-Fix Functions
```typescript
// Add foundation theme if missing
autoFixAddFoundationTheme(themes, stories)

// Reorder stories by phase
autoFixPhaseOrdering(themes, stories)

// Remove forward dependencies
autoFixForwardDependencies(stories)

// Cap story points at 3
autoFixStorySizing(stories)
```

#### Mutex Groups (Concurrency Control)
```typescript
interface PlannedStoryV2 {
  mutexGroups?: string[];  // e.g., ["subsystem:database", "subsystem:api"]
}

interface ExecutionPlanV2 {
  mutexGroups?: Record<string, number[]>;  // Maps group name to story indices
}

// Stories in the same mutex group cannot execute in parallel
// This prevents merge conflicts without fake dependencies
```

### Type Definitions (`planning-types.ts`)

#### Theme Categories (Execution Phases)
```typescript
type ThemeCategory = "foundation" | "core" | "integration" | "testing" | "polish";

const THEME_CATEGORY_ORDER = {
  foundation: 1,  // Docs, architecture, data models - ALWAYS FIRST
  core: 2,        // Backend APIs, frontend components
  integration: 3, // API-UI wiring, external services
  testing: 4,     // E2E tests, QA validation
  polish: 5,      // Optimizations (optional)
};
```

#### PlannedStoryV2 Structure
```typescript
interface PlannedStoryV2 {
  index: number;
  title: string;
  persona: string;
  scope: string;
  acceptanceCriteria: string[];
  dependencies: number[];        // Story indices this depends on
  storyPoints: number;           // Max 3
  targetFiles: string[];
  themeId: string;
  phase: ThemeCategory;
  canonicalOrder: number;        // Global execution order
  mutexGroups?: string[];        // Concurrency control
  providesEntities?: string[];   // Entities created by this story
  requiresEntities?: string[];   // Entities needed by this story
}
```

---

## Current Local Planning Agent (`planning-agent-local.ts`)

### What It Does
1. Builds a simple prompt with task title/description
2. Calls Claude CLI (or AI SDK for other providers)
3. Parses JSON output into `ExecutionPlan`
4. Returns stories with basic fields

### What It's Missing
- No inventory extraction
- No dual scoring
- No mandatory story buckets
- No validation
- No mutex groups
- No phase ordering enforcement
- Prompt example shows only empty dependencies

### Current Prompt Example (The Problem)
```json
{
  "stories": [
    {
      "id": "story-1",
      "dependencies": [],  // LLM copies this pattern!
      ...
    }
  ]
}
```

### Fixed Prompt Example (Already Applied)
```json
{
  "stories": [
    {
      "id": "story-1",
      "title": "Set up project foundation",
      "dependencies": [],
      ...
    },
    {
      "id": "story-2",
      "title": "Implement core feature",
      "dependencies": ["story-1"],  // Shows dependency usage
      ...
    },
    {
      "id": "story-3",
      "title": "Add frontend integration",
      "dependencies": ["story-2"],  // Chains dependencies
      ...
    }
  ]
}
```

---

## Integration Options

### Option A: Minimal (Recommended First Step) - ✅ IMPLEMENTED

Add validation after LLM output, keep existing prompt flow.

**Implementation Status (2026-02-04):**

| Component | Status | Files Modified |
|-----------|--------|----------------|
| Validation in planning-agent-local.ts | ✅ Complete | `planning-agent-local.ts` |
| Mutex groups in story_ready metadata | ✅ Complete | `orchestrator-v2.ts` |
| Mutex groups in ReadyStory interface | ✅ Complete | `worker/epic/types.ts` |
| Extract mutex groups in coordination client | ✅ Complete | `worker/epic/coordination-client.ts` |
| Mutex conflict checking in coordinator | ✅ Complete | `worker/epic/coordinator.ts` |
| Track running stories with mutex groups | ✅ Complete | `worker/epic/coordinator.ts` |

**How Mutex Groups Work:**

1. **Planning phase** - `planning-agent-local.ts` derives mutex groups from `targetFiles` directories
2. **Publishing** - `orchestrator-v2.ts` includes mutex groups in story_ready metadata
3. **Fetching** - `coordination-client.ts` extracts mutex groups into ReadyStory
4. **Dispatch** - `coordinator.ts` tracks running stories and blocks dispatch if mutex conflict exists

**Key Methods Added to coordinator.ts:**
```typescript
private hasMutexConflict(story: ReadyStory): boolean
private registerRunningStory(storyIndex: number, mutexGroups: string[]): void
private unregisterRunningStory(storyIndex: number): void
```

### Option B: Full Integration

Replace local planning with full V2 pipeline.

**Changes Required:**

1. **`planning-agent-local.ts`** - Complete rewrite
   ```typescript
   import { extractPRDInventory } from "./planning-inventory.js";
   import { calculateDualScore } from "./planning-scoring.js";
   import { extractThemes } from "./planning-themes.js";
   import { decomposeStories } from "./planning-agent.js";
   import { validatePlan } from "./planning-validation.js";

   export async function runLocalPlanningAgent(input: PlanningInput): Promise<ExecutionPlanV2> {
     // 1. Extract inventory
     const inventory = await extractPRDInventory(input.description);

     // 2. Calculate dual score
     const dualScore = calculateDualScore(inventory);

     // 3. Extract themes (LLM call)
     const themes = await extractThemes(input, inventory);

     // 4. Decompose stories per theme (LLM calls)
     const stories = await decomposeStories(themes, input, inventory);

     // 5. Validate and auto-fix
     const validated = validatePlan(themes, stories, true);

     // 6. Build mutex groups from subsystems
     const mutexGroups = buildMutexGroups(stories, inventory.subsystems);

     return { version: 2, themes, stories, mutexGroups, dualScore, ... };
   }
   ```

2. **Coordinator changes** - Respect ExecutionPlanV2 structure

3. **Multiple LLM calls** - Inventory → Themes → Stories (per theme) → Validation

**Effort:** ~8-16 hours
**Risk:** Medium (more moving parts, multiple LLM calls)

---

## Bugs Fixed (2026-02-04)

### 1. Missing `publishStoriesReady()` call in local mode
**File:** `api/src/services/orchestrator.ts`
```typescript
// CRITICAL: Publish story_ready messages BEFORE spawning container
if (task.executionPlanV2?.steps?.length) {
  await publishStoriesReady(task);
  logger.info("Published story_ready messages for local Epic mode", {
    taskId: task.id,
    storyCount: task.executionPlanV2.steps.length,
  });
}
```

### 2. Stories with dependencies were skipped
**File:** `api/src/services/orchestrator-v2.ts`
- Removed skip logic that prevented publishing stories with dependencies

### 3. Field name mismatch (`dependsOn` vs `dependencies`)
**File:** `api/src/services/orchestrator-v2.ts`
```typescript
// Check both field names
const stepWithDeps = step as PlannedStepV2 & { dependsOn?: number[]; dependencies?: number[] };
const dependencies = stepWithDeps.dependsOn || stepWithDeps.dependencies || [];
```

### 4. Cancel button not stopping local containers
**Files:** `api/src/routes/tasks.ts`, `api/src/routes/projects.ts`
```typescript
import { localEpicSpawner } from "../services/local-epic-spawner.js";

// After setting status to cancelled:
if (localEpicSpawner.isLocalMode()) {
  await localEpicSpawner.stopTask(task.id);
}
```

### 5. Planning prompt showed empty dependencies
**File:** `api/src/services/planning-agent-local.ts`
- Updated example to show stories with actual dependencies

---

## Testing Checklist

Before merging to main, verify:

- [ ] Stories with dependencies wait for dependencies to complete
- [ ] Cancel button stops local Docker container
- [ ] Story 0 (foundation) runs first and alone
- [ ] Mutex groups prevent parallel execution of conflicting stories
- [ ] Dual score correctly calculates target story count
- [ ] Validation auto-fixes ordering issues
- [ ] Local mode produces same quality output as cloud mode

---

## Related Files Quick Reference

```
api/src/services/
├── planning-agent.ts          # Main cloud planning
├── planning-agent-local.ts    # Simplified local (needs work)
├── planning-inventory.ts      # PRD inventory extraction
├── planning-scoring.ts        # Dual scoring system
├── planning-validation.ts     # Validation + mutex groups
├── planning-types.ts          # Type definitions
├── planning-themes.ts         # Theme extraction
├── orchestrator.ts            # Task spawning (fixed)
├── orchestrator-v2.ts         # V2 pipeline (fixed)
└── local-epic-spawner.ts      # Local Docker management

worker/epic/
├── coordinator.ts             # Story dispatch (respects dependencies)
├── executor.ts                # Story execution
└── experts.ts                 # Expert agents
```

---

## Next Steps

1. ~~**Implement Option A** - Add validation to local planning~~ ✅ Complete (2026-02-04)
2. **Test with OCS ticket** - Verify dependencies are respected
3. **Test mutex groups** - Verify stories targeting same directory run sequentially
4. **Monitor execution** - Watch for parallel conflicts
5. **Evaluate Option B** - If Option A isn't sufficient, plan full integration

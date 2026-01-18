# Story Point Guidelines — Implementation Plan

**Purpose:** Changes required to implement story point guidelines in the PRD orchestration system.
**Related:** `docs/story-point-guidelines.md`

---

## Current State Analysis

### What Already Exists

The planning agent (`api/src/services/planning-agent.ts`) already has:

| Feature | Implementation | Location |
|---------|---------------|----------|
| Complexity scoring | `calculateComplexity()` — deterministic scoring (0-40+ points) | Lines 108-290 |
| Story complexity field | `estimatedComplexity: "small" \| "medium" \| "large"` | Line 58 |
| Max stories constraint | Based on complexity score thresholds | Lines 252-272 |
| Plan validation | Ensures plan matches complexity constraints | Lines 643-692 |
| Complexity factors | AC count, API endpoints, UI views, file types, integrations | Lines 77-85 |
| Complexity multipliers | Responsive, upload, auth, database, realtime | Lines 86-91 |

### What's Missing

| Feature | Gap | Impact |
|---------|-----|--------|
| Story points (1-13 scale) | Only has "small/medium/large" | Can't map to model selection |
| Model selection per story | All stories use same model | Can't optimize cost/accuracy |
| Target file tracking | Not in story schema | Can't enforce file limits |
| Per-story point validation | No max 8 points per story check | Risk of over-scoped stories |
| Automatic model assignment | Manual via Jira labels only | No intelligence in selection |

---

## Required Changes

### Change 1: Add Story Points to PlannedStory Interface

**File:** `api/src/services/planning-agent.ts`

**Current:**
```typescript
export interface PlannedStory {
  index: number;
  title: string;
  persona: string;
  scope: string;
  acceptanceCriteria: string[];
  dependencies: number[];
  estimatedComplexity: "small" | "medium" | "large";
}
```

**Proposed:**
```typescript
export interface PlannedStory {
  index: number;
  title: string;
  persona: string;
  scope: string;
  acceptanceCriteria: string[];
  dependencies: number[];
  estimatedComplexity: "small" | "medium" | "large";
  // NEW FIELDS
  storyPoints: number;           // 1-13 scale
  recommendedModel: string;      // claude-haiku-4-5, claude-sonnet-4, claude-opus-4
  targetFiles: string[];         // Files to modify
  referenceFiles?: string[];     // Files to read for context
}
```

---

### Change 2: Add Complexity-to-Points Mapping

**File:** `api/src/services/planning-agent.ts`

**Add new function:**
```typescript
/**
 * Map estimated complexity to story points
 *
 * small = 1-3 points (Haiku)
 * medium = 3-8 points (Sonnet)
 * large = 8-13 points (Opus)
 */
export function complexityToStoryPoints(
  complexity: "small" | "medium" | "large",
  factors: {
    targetFileCount: number;
    hasArchitecturalDecision: boolean;
    hasCrossSystemChanges: boolean;
  }
): number {
  // Base points from complexity
  let basePoints: number;
  switch (complexity) {
    case "small":
      basePoints = 2;
      break;
    case "medium":
      basePoints = 5;
      break;
    case "large":
      basePoints = 10;
      break;
  }

  // Adjust based on factors
  if (factors.targetFileCount > 5) basePoints += 2;
  if (factors.targetFileCount > 10) basePoints += 2;
  if (factors.hasArchitecturalDecision) basePoints += 2;
  if (factors.hasCrossSystemChanges) basePoints += 1;

  // Cap at 13 (max for single story)
  return Math.min(basePoints, 13);
}
```

---

### Change 3: Add Model Selection Function

**File:** `api/src/services/planning-agent.ts`

**Add new function:**
```typescript
/**
 * Select optimal model based on story points
 *
 * Following the guidelines:
 * - 1-3 points → Haiku (90%+ accuracy target)
 * - 3-8 points → Sonnet (85%+ accuracy target)
 * - 8-13 points → Opus (80%+ accuracy target)
 */
export function selectModelForStoryPoints(storyPoints: number): string {
  if (storyPoints <= 3) {
    return "claude-haiku-4-5-20251001";
  } else if (storyPoints <= 8) {
    return "claude-sonnet-4-20250514";
  } else {
    return "claude-opus-4-20250514";
  }
}

/**
 * Get model tier name for display
 */
export function getModelTier(storyPoints: number): "haiku" | "sonnet" | "opus" {
  if (storyPoints <= 3) return "haiku";
  if (storyPoints <= 8) return "sonnet";
  return "opus";
}
```

---

### Change 4: Update Planning Prompt

**File:** `api/src/services/planning-agent.ts`

**Update PLANNING_PROMPT to request new fields:**

Add to the prompt's "Story Sizing" section:
```markdown
## Story Sizing (CRITICAL)

Each story MUST include:
- **storyPoints**: Integer 1-13 based on complexity
  - 1-3: Single file, clear instructions, pattern exists
  - 3-8: Multi-file feature, bounded decisions
  - 8-13: Cross-cutting changes, architectural decisions
- **targetFiles**: Array of file paths to modify (max 5 for small, 8 for medium, 12 for large)
- **referenceFiles**: Array of file paths to read for context/patterns

**CONSTRAINT: No single story may exceed 8 points.**
If a story would be 9+ points, split it into smaller stories.

Model assignment (automatic, for reference):
- 1-3 points → Haiku
- 3-8 points → Sonnet
- 8-13 points → Opus
```

Update JSON output format:
```json
{
  "stories": [
    {
      "index": 0,
      "title": "Story title",
      "persona": "persona_name",
      "scope": "What this story covers",
      "acceptanceCriteria": ["criterion 1"],
      "dependencies": [],
      "estimatedComplexity": "small" | "medium" | "large",
      "storyPoints": 5,
      "targetFiles": ["src/routes/auth.ts", "src/middleware/jwt.ts"],
      "referenceFiles": ["src/routes/tasks.ts"]
    }
  ]
}
```

---

### Change 5: Add Story Point Validation

**File:** `api/src/services/planning-agent.ts`

**Update `validatePlan()` function:**
```typescript
function validatePlan(plan: ExecutionPlan): void {
  // ... existing validation ...

  if (plan.strategy === "multi" && plan.stories) {
    for (const story of plan.stories) {
      // ... existing story validation ...

      // NEW: Validate story points
      if (typeof story.storyPoints !== "number" || story.storyPoints < 1 || story.storyPoints > 13) {
        // Default based on estimatedComplexity if missing
        story.storyPoints = story.estimatedComplexity === "small" ? 2
          : story.estimatedComplexity === "medium" ? 5
          : 10;
        logger.warn("Story missing valid storyPoints, defaulted", {
          storyIndex: story.index,
          defaultedTo: story.storyPoints,
        });
      }

      // NEW: Warn if story exceeds 8 points (should be split)
      if (story.storyPoints > 8) {
        logger.warn("Story exceeds recommended 8 point max", {
          storyIndex: story.index,
          storyPoints: story.storyPoints,
          title: story.title,
        });
      }

      // NEW: Validate target files count
      if (!story.targetFiles || !Array.isArray(story.targetFiles)) {
        story.targetFiles = [];
      }
      const maxFiles = story.storyPoints <= 3 ? 5 : story.storyPoints <= 8 ? 10 : 15;
      if (story.targetFiles.length > maxFiles) {
        logger.warn("Story target files exceed recommended max", {
          storyIndex: story.index,
          fileCount: story.targetFiles.length,
          maxRecommended: maxFiles,
        });
      }

      // NEW: Assign recommended model
      story.recommendedModel = selectModelForStoryPoints(story.storyPoints);
    }
  }
}
```

---

### Change 6: Update WorkerTask Model

**File:** `api/src/models/WorkerTask.ts`

**Add fields to store per-task model recommendation:**
```typescript
@Column({ type: "int", nullable: true })
storyPoints?: number;

@Column({ type: "varchar", length: 50, nullable: true })
recommendedModel?: string;

@Column({ type: "jsonb", nullable: true })
targetFiles?: string[];
```

---

### Change 7: Update Child Task Creation

**File:** `api/src/services/orchestrator.ts` (or wherever child tasks are created)

**When creating child tasks from approved plan:**
```typescript
async function createChildTasksFromPlan(parentTask: WorkerTask): Promise<WorkerTask[]> {
  const plan = parentTask.planJson as ExecutionPlan;
  const children: WorkerTask[] = [];

  for (const story of plan.stories || []) {
    const child = taskRepo.create({
      // ... existing fields ...

      // NEW: Story point fields
      storyPoints: story.storyPoints,
      recommendedModel: story.recommendedModel || selectModelForStoryPoints(story.storyPoints),
      targetFiles: story.targetFiles,

      // Use recommended model instead of parent's model
      model: story.recommendedModel || selectModelForStoryPoints(story.storyPoints),
    });

    children.push(await taskRepo.save(child));
  }

  return children;
}
```

---

### Change 8: Update Worker Spawning

**File:** `api/src/services/orchestrator.ts`

**In `spawnWorkerContainer()` or equivalent:**
```typescript
// Use task's recommendedModel if set, otherwise fall back to org default
const modelToUse = task.recommendedModel
  || task.model
  || org.defaultWorkerModel
  || "claude-haiku-4-5-20251001";

// Log the model selection
logger.info("Spawning worker with model", {
  taskId: task.id,
  storyPoints: task.storyPoints,
  recommendedModel: task.recommendedModel,
  actualModel: modelToUse,
});
```

---

### Change 9: Add Dashboard Display

**File:** `frontend/src/pages/Orchestration/` components

**Show story points and model in plan review UI:**
```tsx
{plan.stories?.map((story) => (
  <div key={story.index} className="story-card">
    <h4>{story.title}</h4>
    <div className="story-meta">
      <span className="story-points">{story.storyPoints} pts</span>
      <span className="model-badge">{getModelTier(story.storyPoints)}</span>
      <span className="persona">{story.persona}</span>
    </div>
    <div className="target-files">
      {story.targetFiles?.map(f => <code key={f}>{f}</code>)}
    </div>
  </div>
))}
```

---

### Change 10: Migration for New Fields

**File:** `api/src/db/migrations/TIMESTAMP-AddStoryPointFields.ts`

```typescript
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStoryPointFields1705500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS story_points INTEGER,
      ADD COLUMN IF NOT EXISTS recommended_model VARCHAR(50),
      ADD COLUMN IF NOT EXISTS target_files JSONB
    `);

    // Add index for querying by story points
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_tasks_story_points
      ON worker_tasks(story_points)
      WHERE story_points IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_worker_tasks_story_points;
      ALTER TABLE worker_tasks
      DROP COLUMN IF EXISTS story_points,
      DROP COLUMN IF EXISTS recommended_model,
      DROP COLUMN IF EXISTS target_files
    `);
  }
}
```

---

## Implementation Order

| Priority | Change | Effort | Dependencies |
|----------|--------|--------|--------------|
| 1 | Migration (Change 10) | Small | None |
| 2 | WorkerTask model (Change 6) | Small | Migration |
| 3 | PlannedStory interface (Change 1) | Small | None |
| 4 | Mapping functions (Changes 2, 3) | Small | None |
| 5 | Planning prompt update (Change 4) | Medium | Interface change |
| 6 | Plan validation (Change 5) | Medium | Mapping functions |
| 7 | Child task creation (Change 7) | Medium | Model, validation |
| 8 | Worker spawning (Change 8) | Small | Child task creation |
| 9 | Dashboard display (Change 9) | Medium | All backend changes |

**Estimated total effort:** 1-2 days

---

## Testing Plan

### Unit Tests
- [ ] `complexityToStoryPoints()` returns correct values for all inputs
- [ ] `selectModelForStoryPoints()` returns correct model for each tier
- [ ] Plan validation catches stories >13 points
- [ ] Plan validation warns on stories >8 points

### Integration Tests
- [ ] Planning agent includes storyPoints in output
- [ ] Child tasks created with correct recommendedModel
- [ ] Workers spawn with per-story model (not parent model)

### E2E Tests
- [ ] Create PRD → Plan shows story points → Approve → Children use correct models
- [ ] 3-point story uses Haiku
- [ ] 5-point story uses Sonnet
- [ ] 10-point story uses Opus

---

## Rollback Plan

If issues arise:
1. Story points field is nullable — no breaking change
2. Model selection falls back to org default if recommendedModel is null
3. Planning prompt changes can be reverted without data migration
4. Frontend can hide story points UI with feature flag

---

## Future Enhancements

### Phase 2: Context Budget Tracking
- Track tokens consumed per story during execution
- Alert when approaching context limits
- Auto-escalate to higher model if context budget exceeded

### Phase 3: Accuracy Feedback Loop
- Track first-attempt success rate per model/point combination
- Adjust model selection thresholds based on actual accuracy
- Suggest point re-estimation for frequently failing patterns

### Phase 4: Cost Optimization
- Calculate estimated cost per story before execution
- Suggest point adjustments to minimize cost while meeting accuracy targets
- Report actual vs estimated cost for plan improvement

# Story Point Guidelines — Implementation Plan (Cost-First)

**Purpose:** Implement cost-optimized story point system that defaults to Haiku and forces aggressive task decomposition.
**Philosophy:** Size tasks to fit Haiku, don't escalate models to fit tasks.
**Related:** `docs/story-point-guidelines.md`

---

## Cost Analysis

### Model Pricing (as of 2025)

| Model | Input (per 1M tokens) | Output (per 1M tokens) | Relative Cost |
|-------|----------------------|------------------------|---------------|
| Haiku | $0.80 | $4.00 | **1x (baseline)** |
| Sonnet | $3.00 | $15.00 | ~4x |
| Opus | $15.00 | $75.00 | ~19x |

### Cost Impact of Strategy

| Scenario | Auto-Select Approach | Cost-First Approach | Savings |
|----------|---------------------|---------------------|---------|
| 5-point feature | 1 Sonnet task ($2) | 2 Haiku tasks ($1) | **50%** |
| 10-point feature | 1 Opus task ($10) | 4 Haiku tasks ($2) | **80%** |
| Mixed PRD (20 pts) | Sonnet+Opus ($15) | 7 Haiku tasks ($3.50) | **77%** |

**Conclusion:** Aggressive decomposition + Haiku-only saves 50-80% on typical workloads.

---

## Strategy: Haiku-First

### Core Principles

| Principle | Implementation |
|-----------|---------------|
| **Default model** | Always Haiku |
| **Sonnet** | Opt-in only via `sonnet` label |
| **Opus** | Disabled by default, requires org setting + label |
| **Max story points** | 3 (forces decomposition to fit Haiku) |
| **Auto-escalation** | Disabled |

### When Users Should Opt Into Sonnet

Add `sonnet` label when:
- Previous Haiku attempt failed on the same task
- Task requires understanding large context (10+ files)
- Complex refactoring where coherence across files matters
- Time-sensitive and decomposition overhead not worth it

### When Users Should Request Opus

Add `opus` label (if org allows) when:
- Debugging unknown root causes
- Architectural decisions requiring deep analysis
- Security-critical code review
- One-off complex tasks where cost is explicitly acceptable

---

## Current State Analysis

### What Already Exists

The planning agent (`api/src/services/planning-agent.ts`) already has:

| Feature | Implementation | Location |
|---------|---------------|----------|
| Complexity scoring | `calculateComplexity()` — deterministic (0-40+ points) | Lines 108-290 |
| Story complexity field | `estimatedComplexity: "small" \| "medium" \| "large"` | Line 58 |
| Max stories constraint | Based on complexity score thresholds | Lines 252-272 |
| Plan validation | Ensures plan matches complexity constraints | Lines 643-692 |

### What's Missing

| Feature | Gap | Cost-First Solution |
|---------|-----|---------------------|
| Story points (1-3 scale) | Only "small/medium/large" | Add `storyPoints` capped at 3 |
| Model control per org | No org settings | Add `allowSonnet`, `allowOpus`, `maxStoryPoints` |
| Aggressive decomposition | Max 8 pts per story | Change to max 3 pts per story |
| Label-based model override | Partial (exists for model names) | Enforce org permissions |

---

## Required Changes

### Change 1: Add Org Settings for Model Control

**File:** `api/src/models/Organization.ts`

**Add columns:**
```typescript
@Column({ type: "boolean", default: true })
allowSonnet: boolean;  // Can workers use Sonnet? (opt-in via label)

@Column({ type: "boolean", default: false })
allowOpus: boolean;  // Can workers use Opus? (default OFF)

@Column({ type: "int", default: 3 })
maxStoryPoints: number;  // Max points per story (forces decomposition)
```

**Migration:**
```typescript
export class AddModelControlSettings1705500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS allow_sonnet BOOLEAN DEFAULT true,
      ADD COLUMN IF NOT EXISTS allow_opus BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS max_story_points INTEGER DEFAULT 3
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS allow_sonnet,
      DROP COLUMN IF EXISTS allow_opus,
      DROP COLUMN IF EXISTS max_story_points
    `);
  }
}
```

---

### Change 2: Add Cost-First Model Selection

**File:** `api/src/services/planning-agent.ts`

**Add new function:**
```typescript
/**
 * Cost-optimized model selection
 *
 * Strategy: Default to Haiku. Only escalate if user explicitly opts in via label.
 * Opus is disabled by default and requires org permission.
 */
export function selectModelForTask(
  labels: string[],
  org: { allowSonnet: boolean; allowOpus: boolean }
): { model: string; tier: "haiku" | "sonnet" | "opus"; reason: string } {
  const normalizedLabels = labels.map(l => l.toLowerCase());

  // Check for explicit Opus request
  if (normalizedLabels.includes("opus")) {
    if (org.allowOpus) {
      return {
        model: "claude-opus-4-20250514",
        tier: "opus",
        reason: "User requested Opus via label (org permits)",
      };
    } else {
      // Org doesn't allow Opus, fall back to Sonnet if allowed
      if (org.allowSonnet) {
        return {
          model: "claude-sonnet-4-20250514",
          tier: "sonnet",
          reason: "User requested Opus but org disallows; falling back to Sonnet",
        };
      }
    }
  }

  // Check for explicit Sonnet request
  if (normalizedLabels.includes("sonnet")) {
    if (org.allowSonnet) {
      return {
        model: "claude-sonnet-4-20250514",
        tier: "sonnet",
        reason: "User requested Sonnet via label",
      };
    } else {
      return {
        model: "claude-haiku-4-5-20251001",
        tier: "haiku",
        reason: "User requested Sonnet but org disallows; using Haiku",
      };
    }
  }

  // Default: Always Haiku (cost-optimized)
  return {
    model: "claude-haiku-4-5-20251001",
    tier: "haiku",
    reason: "Default model (cost-optimized)",
  };
}
```

---

### Change 3: Update PlannedStory Interface

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
  // NEW FIELDS (cost-first)
  storyPoints: number;           // 1-3 scale (Haiku-friendly)
  targetFiles: string[];         // Files to modify (max 3 for Haiku)
  referenceFiles?: string[];     // Files to read for context
}
```

**Note:** `recommendedModel` is NOT stored per-story. Model is determined at execution time based on labels + org settings.

---

### Change 4: Update Planning Prompt for Aggressive Decomposition

**File:** `api/src/services/planning-agent.ts`

**Replace Story Sizing section in PLANNING_PROMPT:**
```markdown
## Story Sizing (CRITICAL - COST OPTIMIZATION)

**CONSTRAINT: Maximum 3 story points per story.**

All stories will execute on Haiku (cheapest model). To ensure high accuracy:
- Each story MUST be ≤3 points
- Each story should modify ≤3 files
- Each story should have clear, unambiguous acceptance criteria

If work would exceed 3 points, SPLIT IT into multiple stories.

### Point Scale (Haiku-Optimized)

| Points | Scope | Files | Example |
|--------|-------|-------|---------|
| 1 | Single file, trivial change | 1 | Fix typo, add field |
| 2 | Single file, clear logic | 1-2 | Add validation, simple endpoint |
| 3 | Multi-file, clear pattern | 2-3 | Feature with model + route |

### Decomposition Examples

❌ BAD: "Add user authentication" (8+ points)
✅ GOOD: Split into:
  - Story 1: Add User model and migration (2 pts)
  - Story 2: Add login endpoint (2 pts)
  - Story 3: Add logout endpoint (1 pt)
  - Story 4: Add JWT middleware (2 pts)
  - Story 5: Add auth to protected routes (2 pts)

❌ BAD: "Build settings page with API" (6+ points)
✅ GOOD: Split into:
  - Story 1: Add settings GET endpoint (2 pts)
  - Story 2: Add settings PUT endpoint (2 pts)
  - Story 3: Add settings UI component (3 pts)

### Output Fields

Each story MUST include:
- **storyPoints**: Integer 1-3 (NEVER exceed 3)
- **targetFiles**: Array of file paths to modify (max 3 files)
- **referenceFiles**: Array of file paths to read for patterns (optional)
```

**Update JSON output format:**
```json
{
  "stories": [
    {
      "index": 0,
      "title": "Add User model and migration",
      "persona": "backend_developer",
      "scope": "Create User entity with email, password hash, timestamps",
      "acceptanceCriteria": [
        "User model exists with required fields",
        "Migration creates users table",
        "Model is registered in connection.ts"
      ],
      "dependencies": [],
      "estimatedComplexity": "small",
      "storyPoints": 2,
      "targetFiles": ["src/models/User.ts", "src/db/migrations/AddUser.ts"],
      "referenceFiles": ["src/models/Organization.ts"]
    }
  ]
}
```

---

### Change 5: Update Plan Validation for Cost-First

**File:** `api/src/services/planning-agent.ts`

**Update `validatePlan()` function:**
```typescript
function validatePlan(plan: ExecutionPlan, maxStoryPoints: number = 3): void {
  // ... existing validation ...

  if (plan.strategy === "multi" && plan.stories) {
    for (const story of plan.stories) {
      // ... existing story validation ...

      // COST-FIRST: Validate story points (max 3 for Haiku)
      if (typeof story.storyPoints !== "number" || story.storyPoints < 1) {
        // Default to 2 if missing
        story.storyPoints = 2;
        logger.warn("Story missing storyPoints, defaulted to 2", {
          storyIndex: story.index,
        });
      }

      // COST-FIRST: Enforce max story points (default 3)
      if (story.storyPoints > maxStoryPoints) {
        logger.warn("Story exceeds max points, needs further decomposition", {
          storyIndex: story.index,
          storyPoints: story.storyPoints,
          maxAllowed: maxStoryPoints,
          title: story.title,
        });
        // Cap at max (will log warning but not fail)
        story.storyPoints = maxStoryPoints;
      }

      // COST-FIRST: Validate target files count (max 3 for Haiku)
      if (!story.targetFiles || !Array.isArray(story.targetFiles)) {
        story.targetFiles = [];
      }
      const maxFiles = Math.max(story.storyPoints, 3);  // At least 3, scales with points
      if (story.targetFiles.length > maxFiles) {
        logger.warn("Story targets too many files for Haiku accuracy", {
          storyIndex: story.index,
          fileCount: story.targetFiles.length,
          maxRecommended: maxFiles,
        });
      }
    }
  }
}
```

---

### Change 6: Update Worker Spawning for Cost-First Model Selection

**File:** `api/src/services/orchestrator.ts`

**Update model selection in `spawnWorkerContainer()` or equivalent:**
```typescript
async function getModelForTask(
  task: WorkerTask,
  org: Organization
): Promise<{ model: string; tier: string; reason: string }> {
  const labels = (task.jiraFields?.labels as string[]) || [];

  // Cost-first model selection
  const selection = selectModelForTask(labels, {
    allowSonnet: org.allowSonnet ?? true,
    allowOpus: org.allowOpus ?? false,
  });

  logger.info("Model selected for task", {
    taskId: task.id,
    storyPoints: task.storyPoints,
    labels: labels.filter(l => ["haiku", "sonnet", "opus"].includes(l.toLowerCase())),
    selectedModel: selection.model,
    tier: selection.tier,
    reason: selection.reason,
  });

  return selection;
}

// In spawnWorkerContainer():
const { model: modelToUse, tier, reason } = await getModelForTask(task, org);

// Log for cost tracking
logger.info("Spawning worker", {
  taskId: task.id,
  model: modelToUse,
  tier,
  reason,
  estimatedCostMultiplier: tier === "haiku" ? 1 : tier === "sonnet" ? 4 : 19,
});
```

---

### Change 7: Update WorkerTask Model

**File:** `api/src/models/WorkerTask.ts`

**Add fields:**
```typescript
@Column({ type: "int", nullable: true })
storyPoints?: number;

@Column({ type: "jsonb", nullable: true })
targetFiles?: string[];

// Note: recommendedModel is NOT stored - determined at runtime from labels
```

**Migration:**
```typescript
export class AddStoryPointFields1705500001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS story_points INTEGER,
      ADD COLUMN IF NOT EXISTS target_files JSONB
    `);

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
      DROP COLUMN IF EXISTS target_files
    `);
  }
}
```

---

### Change 8: Update Child Task Creation

**File:** `api/src/services/orchestrator.ts`

**When creating child tasks from approved plan:**
```typescript
async function createChildTasksFromPlan(parentTask: WorkerTask): Promise<WorkerTask[]> {
  const plan = parentTask.planJson as ExecutionPlan;
  const children: WorkerTask[] = [];

  for (const story of plan.stories || []) {
    const child = taskRepo.create({
      // ... existing fields from parent ...
      organizationId: parentTask.organizationId,
      parentTaskId: parentTask.id,
      storyIndex: story.index + 1,
      status: story.dependencies?.length ? "blocked" : "queued",
      dependencies: story.dependencies || [],

      // Story-specific fields
      title: story.title,
      description: story.scope,
      persona: story.persona,

      // COST-FIRST: Story point fields
      storyPoints: story.storyPoints,
      targetFiles: story.targetFiles,

      // COST-FIRST: Model determined at execution time, not stored
      // Labels from parent flow through, allowing user to add sonnet/opus
      jiraFields: parentTask.jiraFields,
    });

    children.push(await taskRepo.save(child));
  }

  return children;
}
```

---

### Change 9: Add Settings UI for Model Control

**File:** `frontend/src/pages/Settings.tsx`

**Add model control section:**
```tsx
<section className="settings-section">
  <h3>Cost Controls</h3>

  <div className="setting-row">
    <label>
      <input
        type="checkbox"
        checked={settings.allowSonnet}
        onChange={(e) => updateSetting("allowSonnet", e.target.checked)}
      />
      Allow Sonnet (via label)
    </label>
    <p className="setting-description">
      When enabled, users can add the "sonnet" label to tasks to use Claude Sonnet (~4x cost).
    </p>
  </div>

  <div className="setting-row">
    <label>
      <input
        type="checkbox"
        checked={settings.allowOpus}
        onChange={(e) => updateSetting("allowOpus", e.target.checked)}
      />
      Allow Opus (via label)
    </label>
    <p className="setting-description">
      When enabled, users can add the "opus" label to tasks to use Claude Opus (~19x cost).
      <strong> Not recommended for normal use.</strong>
    </p>
  </div>

  <div className="setting-row">
    <label>Max Story Points</label>
    <select
      value={settings.maxStoryPoints}
      onChange={(e) => updateSetting("maxStoryPoints", parseInt(e.target.value))}
    >
      <option value={3}>3 (Haiku-optimized, recommended)</option>
      <option value={5}>5 (Allow medium complexity)</option>
      <option value={8}>8 (Allow large stories)</option>
    </select>
    <p className="setting-description">
      Maximum points per story. Lower values force more decomposition, improving Haiku accuracy.
    </p>
  </div>
</section>
```

---

### Change 10: Update Dashboard to Show Model Tier

**File:** `frontend/src/pages/Orchestration/` components

**Show which model will be used:**
```tsx
function StoryCard({ story, parentLabels }: { story: PlannedStory; parentLabels: string[] }) {
  const modelTier = getModelTierFromLabels(parentLabels);

  return (
    <div className="story-card">
      <div className="story-header">
        <h4>{story.title}</h4>
        <span className={`model-badge model-${modelTier}`}>
          {modelTier}
        </span>
      </div>

      <div className="story-meta">
        <span className="story-points">{story.storyPoints} pts</span>
        <span className="persona">{story.persona}</span>
      </div>

      {story.targetFiles?.length > 0 && (
        <div className="target-files">
          <strong>Files:</strong>
          {story.targetFiles.map(f => <code key={f}>{f}</code>)}
        </div>
      )}
    </div>
  );
}

function getModelTierFromLabels(labels: string[]): "haiku" | "sonnet" | "opus" {
  const normalized = labels.map(l => l.toLowerCase());
  if (normalized.includes("opus")) return "opus";
  if (normalized.includes("sonnet")) return "sonnet";
  return "haiku";
}
```

---

## Implementation Order

| Priority | Change | Effort | Dependencies |
|----------|--------|--------|--------------|
| 1 | Org settings migration (Change 1) | Small | None |
| 2 | Organization model update (Change 1) | Small | Migration |
| 3 | Model selection function (Change 2) | Small | None |
| 4 | WorkerTask migration (Change 7) | Small | None |
| 5 | WorkerTask model update (Change 7) | Small | Migration |
| 6 | PlannedStory interface (Change 3) | Small | None |
| 7 | Planning prompt update (Change 4) | Medium | Interface |
| 8 | Plan validation (Change 5) | Medium | Org settings |
| 9 | Worker spawning (Change 6) | Small | Model selection |
| 10 | Child task creation (Change 8) | Medium | All model changes |
| 11 | Settings UI (Change 9) | Medium | Org settings |
| 12 | Dashboard display (Change 10) | Small | Frontend changes |

**Estimated total effort:** 1-2 days

---

## Testing Plan

### Unit Tests
- [ ] `selectModelForTask()` returns Haiku by default
- [ ] `selectModelForTask()` returns Sonnet only when label present AND org allows
- [ ] `selectModelForTask()` returns Opus only when label present AND org allows
- [ ] `selectModelForTask()` falls back correctly when org disallows
- [ ] Plan validation enforces max 3 story points
- [ ] Plan validation warns on >3 files per story

### Integration Tests
- [ ] Planning agent creates stories with ≤3 points each
- [ ] Task without labels spawns with Haiku
- [ ] Task with `sonnet` label spawns with Sonnet (if org allows)
- [ ] Task with `sonnet` label spawns with Haiku (if org disallows)
- [ ] Task with `opus` label spawns with Haiku (default org settings)

### Cost Verification
- [ ] 10-point PRD decomposes into 4+ stories
- [ ] All stories execute on Haiku (unless labeled)
- [ ] Cost tracking shows Haiku rates

---

## Rollback Plan

If issues arise:
1. Org settings default to permissive (`allowSonnet: true`) — existing behavior preserved
2. Story points field is nullable — no breaking change
3. Model selection falls back to Haiku if any error
4. Planning prompt changes can be reverted without migration

---

## Future Enhancements

### Phase 2: Cost Tracking Dashboard
- Show actual cost per task (model × tokens)
- Compare Haiku vs hypothetical Sonnet/Opus cost
- Monthly cost breakdown by model tier

### Phase 3: Automatic Retry Escalation
- If Haiku fails twice on same task, suggest Sonnet
- User must explicitly approve escalation (no auto-escalation)
- Track escalation patterns to improve decomposition

### Phase 4: Decomposition Quality Metrics
- Track success rate by story point count
- Identify "problem patterns" that need better decomposition
- Suggest decomposition improvements based on failure data

# Planning Agent V4 Improvements

> Reviewed with Gemini 3 Pro on Abacus.AI (2026-01-21)

## Problem Statement

The V3 planning agent has three critical issues:

1. **Missing/Incorrect Dependencies** - Stories often have broken dependency chains because `extractProvides/extractRequires` uses fuzzy text matching ("User table" vs "Users model")
2. **Theme Duplication** - Multiple themes claim ownership of the same entities, leading to duplicate work
3. **Inconsistent Scoring** - Dual scoring (0-100) varies across similar PRDs due to LLM "vibe check" nature

## Improvement Patterns (from Gemini 3 Review)

### Pattern 1: Canonical ID Pattern
**Problem:** LLM invents different names for the same entity
**Solution:** Force LLM to reference inventory entity IDs (`ENT-01`, `ENT-02`)

```typescript
// Before: Fuzzy text matching
provides: ["User model", "Auth API"]
requires: ["Database connection", "User model"]

// After: Canonical ID references
providesEntities: ["ENT-01", "ENT-03"]
requiresEntities: ["ENT-01"]
```

### Pattern 2: Draft Pick Pattern
**Problem:** Entity "User" appears in both Auth and Profile themes
**Solution:** Force exclusive entity ownership - each entity assigned to exactly ONE theme

```typescript
// Before: Themes list related entities
{ name: "Auth", entities: ["User", "Session"] }
{ name: "Profile", entities: ["User", "Avatar"] }

// After: Themes own specific entity indices
{ name: "Auth", ownedEntityIndices: [0, 1] }  // User, Session
{ name: "Profile", ownedEntityIndices: [2] }   // Avatar only
```

### Pattern 3: Owner vs. Contributor Model
**Problem:** Multiple themes need to modify the same entity
**Solution:** Only owner can `create`, contributors can only `update`

```
Theme A (Core): Story 1 "Create User Schema" (action: "create", provides: ENT-User)
Theme B (Auth): Story 2 "Add Password Hashing" (action: "update", requires: ENT-User) → Depends on Story 1
Theme C (Profile): Story 3 "Add Avatar URL" (action: "update", requires: ENT-User) → Depends on Story 1
```

### Pattern 4: Hybrid Rubric Scoring
**Problem:** LLM scores 0-100 inconsistently
**Solution:** LLM scores discrete variables (1-5), code does deterministic math

```typescript
// Before: LLM outputs holistic score
{ scope: 67, risk: 42 }  // Varies between runs

// After: LLM outputs rubric variables
{ technicalComplexity: 3, ambiguityLevel: 2, integrationRisk: 4 }
// Code calculates: risk = (ambiguity * 10) + (integration * 10) = 60
```

### Pattern 5: Hallucination Guard
**Problem:** LLM invents entity IDs that don't exist
**Solution:** Post-processor validates all IDs against inventory

```typescript
function validateAndSanitizeStories(stories, inventory) {
  const validIds = new Set(inventory.entities.map(e => e.id));
  return stories.map(story => ({
    ...story,
    providesEntities: story.providesEntities.filter(id => validIds.has(id)),
    requiresEntities: story.requiresEntities.filter(id => validIds.has(id)),
  }));
}
```

### Pattern 6: Cycle Detection with Header Extraction
**Problem:** Circular dependencies (A → B → C → A)
**Solution:** Extract shared interface as new "Header Story"

```typescript
if (detectCycle(storyA, storyB)) {
  const headerStory = createHeaderStory(findSharedEntity(storyA, storyB));
  // Both A and B now depend on Header instead of each other
  storyA.dependencies.push(headerStory.id);
  storyB.dependencies.push(headerStory.id);
  removeDependency(storyA, storyB);
}
```

---

## Implementation Phases

### Phase 1: Quick Wins (Low Risk, High Impact) ✅ IN PROGRESS

**Files to modify:**
- `api/src/services/planning-types.ts` - Add canonical ID fields
- `api/src/services/planning-dependency-auditor.ts` - Switch to ID-based matching
- `api/src/services/planning-themes.ts` - Update decomposition prompts
- `api/src/services/planning-agent.ts` - Add hallucination guard

**Changes:**

1. **Add Canonical ID fields to PlannedStoryV2:**
```typescript
interface PlannedStoryV2 {
  // ... existing fields ...

  /** Entity IDs this story creates or modifies (from inventory) */
  providesEntities: string[];

  /** Entity IDs this story requires to exist (from inventory) */
  requiresEntities: string[];

  /** Action type: create (owner only) or update (contributors) */
  entityAction?: "create" | "update";
}
```

2. **Update dependency auditor to match on IDs:**
```typescript
// Build provider map: EntityID -> StoryIndex
const providerMap = new Map<string, number>();
stories.forEach((story, index) => {
  story.providesEntities.forEach(entityId => {
    providerMap.set(entityId, index);
  });
});

// Find missing dependencies by matching requires -> provides
stories.forEach((story, index) => {
  story.requiresEntities.forEach(reqId => {
    const providerIndex = providerMap.get(reqId);
    if (providerIndex !== undefined && !story.dependencies.includes(providerIndex)) {
      // Add missing dependency
    }
  });
});
```

3. **Add Hallucination Guard:**
```typescript
function sanitizeEntityReferences(
  stories: PlannedStoryV2[],
  inventory: PRDInventory
): PlannedStoryV2[] {
  const validIds = new Set(inventory.entities.map(e => e.id || `ENT-${e.name}`));

  return stories.map(story => ({
    ...story,
    providesEntities: (story.providesEntities || []).filter(id => {
      if (validIds.has(id)) return true;
      logger.warn(`Dropped invalid entity ID: ${id}`);
      return false;
    }),
    requiresEntities: (story.requiresEntities || []).filter(id => {
      if (validIds.has(id)) return true;
      logger.warn(`Dropped invalid entity ID: ${id}`);
      return false;
    }),
  }));
}
```

4. **Update decomposition prompts:**
```
AVAILABLE ENTITIES (you MUST reference these IDs):
[ENT-01] User: The main user entity
[ENT-02] Session: Authentication session
...

For each story, output:
- providesEntities: IDs of entities this story CREATES
- requiresEntities: IDs of entities this story READS/DEPENDS ON
```

---

### Phase 2: Core Architecture (Medium Risk)

**Files to modify:**
- `api/src/services/planning-themes.ts` - Add Draft Pick pattern
- `api/src/services/planning-inventory.ts` - Add entity IDs to inventory

**Changes:**

1. **Update extractThemesFromInventory to enforce exclusive ownership:**
```typescript
const prompt = `
You are a Technical Architect. Assign each entity to EXACTLY ONE theme.

RULES:
1. Every entity must be assigned to exactly one theme (Primary Owner)
2. A theme can READ other entities but can only CREATE its assigned entities

Entities to Assign:
${inventory.entities.map((e, i) => `[ENT-${i}] ${e.name}`).join('\n')}

Output: { themes: [{ name, ownedEntityIndices: number[] }] }
`;
```

2. **Add post-validation:**
```typescript
function validateEntityOwnership(themes: Theme[], entityCount: number): boolean {
  const assigned = new Set<number>();
  for (const theme of themes) {
    for (const idx of theme.ownedEntityIndices) {
      if (assigned.has(idx)) return false; // Duplicate!
      assigned.add(idx);
    }
  }
  return assigned.size === entityCount; // All assigned exactly once
}
```

---

### Phase 3: Advanced (Higher Complexity)

**Files to modify:**
- `api/src/services/planning-scoring.ts` - Hybrid rubric scoring
- `api/src/services/planning-agent.ts` - Cycle detection

**Changes:**

1. **Hybrid Rubric Scoring:**
```typescript
interface ScoringRubric {
  technicalComplexity: 1 | 2 | 3 | 4 | 5;
  ambiguityLevel: 1 | 2 | 3 | 4 | 5;
  integrationRisk: 1 | 2 | 3 | 4 | 5;
}

function calculateDualScore(rubric: ScoringRubric, inventory: PRDInventory) {
  const risk = (rubric.ambiguityLevel * 10) + (rubric.integrationRisk * 10);
  const baseScope = inventory.entities.length * 5 + inventory.actions.length * 2;
  const multiplier = 1 + (rubric.technicalComplexity * 0.2);
  const scope = Math.min(100, baseScope * multiplier);
  return { scope, risk };
}
```

2. **Cycle Detection with Header Extraction:**
```typescript
function breakCycles(stories: PlannedStoryV2[]): PlannedStoryV2[] {
  const cycles = detectCycles(stories);
  for (const cycle of cycles) {
    const sharedEntity = findSharedEntity(cycle);
    const headerStory = createHeaderStory(sharedEntity);
    // Insert header and rewire dependencies
  }
  return stories;
}
```

---

## Migration Strategy

1. **Phase 1** - Deploy behind feature flag, shadow mode first
2. **Phase 2** - Enable for new plans, monitor metrics
3. **Phase 3** - Enable cycle detection only when cycles detected in production

## Success Metrics

- **Dependency accuracy**: % of plans requiring manual dependency fixes → Target: <5%
- **Theme overlap**: % of entities assigned to multiple themes → Target: 0%
- **Score consistency**: Variance of scores across similar PRDs → Target: <10%

## Rollback Plan

All changes are feature-flagged:
- `PLANNING_CANONICAL_IDS_ENABLED` - Phase 1
- `PLANNING_DRAFT_PICK_ENABLED` - Phase 2
- `PLANNING_HYBRID_SCORING_ENABLED` - Phase 3

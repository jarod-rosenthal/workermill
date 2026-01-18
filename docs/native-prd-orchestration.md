# Native PRD Orchestration Implementation Plan

**Date:** January 2026
**Status:** Planning
**Replaces:** Ralph-based orchestration (removed due to complexity/reliability issues)

## Overview

Enable WorkerMill to orchestrate multi-persona prototypes from a single Jira ticket. A PRD-style ticket defines stories with persona assignments, and WorkerMill spawns parallel workers for each story.

**Key principle:** No external dependencies. All orchestration logic lives in WorkerMill's API and worker.

## Architecture

```
Jira Ticket (PRD Format)
"Build user auth with API and UI"
├── Story 1: @persona:backend_developer - Create auth API
├── Story 2: @persona:frontend_developer - Build login form
└── Story 3: @persona:qa_engineer - Write E2E tests
           ↓
    WorkerMill Orchestrator
    (parses stories, creates child tasks)
           ↓
┌──────────┼──────────┐
↓          ↓          ↓
Child 1    Child 2    Child 3
backend    frontend   qa_engineer
Opus       Haiku      Ollama Qwen
(parallel) (parallel) (parallel)
           ↓
    All children complete → Parent complete
```

## Jira Ticket Format (PRD Style)

### Description Field

```markdown
## Overview
Brief description of the feature being built.

## Stories

### Story 1: Create authentication API endpoints
@persona: backend_developer
@model: opus (optional, uses org default if omitted)

**Acceptance Criteria:**
- POST /api/auth/login returns JWT token
- POST /api/auth/register creates new user
- Token validation middleware protects routes

### Story 2: Build login and registration forms
@persona: frontend_developer
@depends: Story 1 (optional dependency)

**Acceptance Criteria:**
- Login form with email/password fields
- Registration form with validation
- Error handling for failed auth

### Story 3: Write authentication E2E tests
@persona: qa_engineer
@depends: Story 1, Story 2

**Acceptance Criteria:**
- Test successful login flow
- Test registration with validation errors
- Test protected route access
```

### Supported Annotations

| Annotation | Required | Description |
|------------|----------|-------------|
| `@persona: <name>` | Yes | Which persona executes this story |
| `@model: <model>` | No | Override model for this story |
| `@depends: Story N` | No | Execute after specified stories complete |

## Implementation Phases

### Phase 1: Database Schema

**File:** `api/src/db/migrations/TIMESTAMP-AddStoryOrchestration.ts`

```typescript
// WorkerTask additions
parentTaskId: UUID | null      // Links child to parent task
storyIndex: number | null      // 0-indexed story number
storyTitle: string | null      // "Create auth API endpoints"
childTaskIds: UUID[] | null    // Parent tracks all children
storyDependencies: number[] | null  // Story indices this depends on
```

**Why:** Enables parent-child relationships and dependency tracking without external tools.

---

### Phase 2: WorkerTask Model

**File:** `api/src/models/WorkerTask.ts`

Add columns matching migration. Add helper methods:

```typescript
isParentTask(): boolean {
  return this.childTaskIds !== null && this.childTaskIds.length > 0;
}

isChildTask(): boolean {
  return this.parentTaskId !== null;
}

isTerminal(): boolean {
  return ['deployed', 'failed', 'cancelled'].includes(this.status);
}
```

---

### Phase 3: PRD Parser Service

**File:** `api/src/services/prd-parser.ts` (new)

Parses Jira description field into structured stories:

```typescript
interface ParsedStory {
  index: number;
  title: string;
  persona: string;
  model?: string;
  acceptanceCriteria: string;
  dependencies: number[];  // Story indices
}

interface ParsedPRD {
  overview: string;
  stories: ParsedStory[];
}

function parsePRD(jiraDescription: string): ParsedPRD | null {
  // Returns null if description doesn't match PRD format
  // (fallback to single-task execution)
}
```

**Parsing logic:**
1. Split by `### Story N:` headers
2. Extract `@persona:`, `@model:`, `@depends:` annotations
3. Capture acceptance criteria text
4. Return structured array

---

### Phase 4: Story Task Converter Service

**File:** `api/src/services/story-task-converter.ts` (new)

Creates child WorkerTask records from parsed stories:

```typescript
async function createChildTasks(
  parentTask: WorkerTask,
  stories: ParsedStory[],
  org: Organization
): Promise<WorkerTask[]> {
  const children: WorkerTask[] = [];

  for (const story of stories) {
    // Determine provider/model from:
    // 1. Story @model annotation
    // 2. Org providerRouting[persona]
    // 3. Org defaults
    const { provider, model } = resolveProviderModel(story, org);

    const child = new WorkerTask();
    child.parentTaskId = parentTask.id;
    child.storyIndex = story.index;
    child.storyTitle = story.title;
    child.persona = story.persona;
    child.workerProvider = provider;
    child.workerModel = model;
    child.storyDependencies = story.dependencies;
    child.status = story.dependencies.length > 0 ? 'blocked' : 'queued';

    // Inherit from parent
    child.jiraIssueKey = `${parentTask.jiraIssueKey}-S${story.index + 1}`;
    child.gitRepo = parentTask.gitRepo;
    child.gitBranch = `${parentTask.gitBranch}-story-${story.index + 1}`;
    child.organizationId = parentTask.organizationId;

    // Task prompt = story acceptance criteria
    child.taskNotes = story.acceptanceCriteria;

    children.push(await taskRepo.save(child));
  }

  parentTask.childTaskIds = children.map(c => c.id);
  parentTask.status = 'dispatching';
  await taskRepo.save(parentTask);

  return children;
}
```

---

### Phase 5: Orchestrator Integration

**File:** `api/src/services/orchestrator.ts`

**5a. Detect PRD format in webhook handler:**

When a new task is created from Jira webhook:

```typescript
async function handleNewTask(task: WorkerTask) {
  const prd = parsePRD(task.jiraDescription);

  if (prd && prd.stories.length > 1) {
    // Multi-story PRD - create child tasks
    await createChildTasks(task, prd.stories, task.organization);
    logger.info(`Created ${prd.stories.length} child tasks for ${task.jiraIssueKey}`);
  } else {
    // Single task - proceed normally
    task.status = 'queued';
    await taskRepo.save(task);
  }
}
```

**5b. Unblock dependent stories:**

When a child task completes:

```typescript
async function handleChildCompletion(childTask: WorkerTask) {
  if (!childTask.parentTaskId) return;

  // Find siblings blocked on this story
  const siblings = await taskRepo.find({
    where: {
      parentTaskId: childTask.parentTaskId,
      status: 'blocked'
    }
  });

  for (const sibling of siblings) {
    if (sibling.storyDependencies?.includes(childTask.storyIndex)) {
      // Check if ALL dependencies are now complete
      const deps = await taskRepo.find({
        where: {
          parentTaskId: childTask.parentTaskId,
          storyIndex: In(sibling.storyDependencies)
        }
      });

      if (deps.every(d => d.status === 'deployed')) {
        sibling.status = 'queued';
        await taskRepo.save(sibling);
      }
    }
  }
}
```

**5c. Monitor parent completion:**

```typescript
async function checkParentCompletion(parentTask: WorkerTask) {
  if (!parentTask.childTaskIds?.length) return;

  const children = await taskRepo.find({
    where: { id: In(parentTask.childTaskIds) }
  });

  const allComplete = children.every(t => t.isTerminal());

  if (allComplete) {
    const anyFailed = children.some(t => t.status === 'failed');
    parentTask.status = anyFailed ? 'failed' : 'deployed';
    await taskRepo.save(parentTask);

    // Update Jira parent ticket
    await updateJiraStatus(parentTask);
  }
}
```

---

### Phase 6: Worker Branch Strategy

Child tasks work on story-specific branches that get merged into the parent branch:

```
main
  └── ai/OCS-123 (parent branch)
        ├── ai/OCS-123-story-1 (backend work)
        ├── ai/OCS-123-story-2 (frontend work)
        └── ai/OCS-123-story-3 (QA work)
```

**Merge strategy options:**
1. **Auto-merge to parent:** Each child merges to parent branch on completion
2. **Single PR:** Parent creates PR after all children merge
3. **Multiple PRs:** Each child creates separate PR (current behavior)

Recommend option 1 initially for simplicity.

---

### Phase 7: Dashboard Updates

**File:** `frontend/src/pages/Dashboard.tsx`

Display parent-child hierarchy:

```
┌─────────────────────────────────────────┐
│ OCS-123: Build user authentication      │
│ Status: Dispatching (2/3 complete)      │
│                                         │
│ ├─ Story 1: Auth API [backend] ✅       │
│ ├─ Story 2: Login form [frontend] ⏳    │
│ └─ Story 3: E2E tests [qa] ⏸️ blocked   │
└─────────────────────────────────────────┘
```

---

## Concurrency Model

Leverages existing persona concurrency controls:

| Scenario | Behavior |
|----------|----------|
| Same persona stories | Sequential (slot occupied) |
| Different persona stories | Parallel (different slots) |
| Blocked stories | Wait for dependencies |
| Org limit reached | Queue until slot frees |

Example with `maxConcurrentWorkers: 3`:
```
Story 1 (backend)  → Slot 1 → RUNNING
Story 2 (frontend) → Slot 2 → RUNNING
Story 3 (qa)       → Blocked on 1,2 → WAITING
```

---

## Provider Routing

Uses existing `providerRouting` from Organization settings:

```json
{
  "backend_developer": { "provider": "anthropic", "model": "claude-opus-4" },
  "frontend_developer": { "provider": "anthropic", "model": "claude-haiku-4-5" },
  "qa_engineer": { "provider": "ollama", "model": "qwen2.5-coder:32b" }
}
```

Story `@model:` annotation overrides org defaults.

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `api/src/db/migrations/TIMESTAMP-AddStoryOrchestration.ts` | Create | Schema for parent-child tasks |
| `api/src/models/WorkerTask.ts` | Modify | Add story columns and helpers |
| `api/src/services/prd-parser.ts` | Create | Parse Jira PRD format |
| `api/src/services/story-task-converter.ts` | Create | Create child tasks from stories |
| `api/src/services/orchestrator.ts` | Modify | PRD detection, dependency unblocking, completion tracking |
| `api/src/routes/webhooks.ts` | Modify | Call PRD parser on new tasks |
| `frontend/src/pages/Dashboard.tsx` | Modify | Display task hierarchy |

---

## Implementation Order

1. **Database migration** - Schema foundation
2. **WorkerTask model** - Add columns and helpers
3. **PRD parser** - Parse Jira description
4. **Story task converter** - Create child tasks
5. **Orchestrator: PRD detection** - Trigger multi-story flow
6. **Orchestrator: Dependency tracking** - Unblock stories
7. **Orchestrator: Completion** - Finalize parent
8. **Dashboard** - Visual hierarchy (can defer)

---

## Backward Compatibility

- Single-story tickets work unchanged (PRD parser returns null)
- No feature flag needed - PRD format is opt-in via ticket structure
- Existing tasks unaffected (nullable columns with defaults)

---

## Verification Plan

1. **Unit test:** PRD parser handles various formats
2. **Unit test:** Story converter creates correct child tasks
3. **Integration test:** Create PRD ticket, verify child tasks spawn
4. **E2E test:**
   - Create ticket with 3 stories, different personas
   - Verify parallel execution of independent stories
   - Verify dependency blocking works
   - Verify parent completes when all children complete
5. **Dashboard test:** Verify hierarchy displays correctly

---

## Example PRD Ticket

**Jira Summary:** `Implement user profile page with avatar upload`

**Jira Description:**
```markdown
## Overview
Add a user profile page where users can view and edit their profile information, including uploading a profile avatar.

## Stories

### Story 1: Create profile API endpoints
@persona: backend_developer

**Acceptance Criteria:**
- GET /api/profile returns current user profile
- PUT /api/profile updates profile fields
- POST /api/profile/avatar uploads and stores avatar image
- Avatar stored in S3 with CDN URL returned

### Story 2: Build profile page UI
@persona: frontend_developer
@depends: Story 1

**Acceptance Criteria:**
- Profile page at /profile route
- Display user name, email, bio
- Edit mode with form validation
- Avatar upload with preview
- Loading and error states

### Story 3: Add profile E2E tests
@persona: qa_engineer
@depends: Story 1, Story 2

**Acceptance Criteria:**
- Test profile view renders correctly
- Test profile edit saves changes
- Test avatar upload and display
- Test validation error handling
```

This ticket would spawn 3 child tasks:
- `OCS-456-S1`: backend_developer (runs immediately)
- `OCS-456-S2`: frontend_developer (blocked until S1 completes)
- `OCS-456-S3`: qa_engineer (blocked until S1 and S2 complete)

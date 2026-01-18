# Dynamic PRD Planning System

**Date:** January 2026
**Status:** Design Discussion
**Purpose:** Intelligent decomposition of PRD tickets into persona-specific tasks

## Core Concept

When a PRD ticket arrives, a **Planning Agent** analyzes it and makes intelligent decisions about execution strategy:

```
┌─────────────────────────────────────────────────────────────┐
│                    PRD Ticket Arrives                       │
│              (Jira webhook with workermill label)           │
└─────────────────────────┬───────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                    PLANNING PHASE                           │
│                                                             │
│  Planning Agent (fast model - Haiku) analyzes:              │
│  • Tech stack requirements                                  │
│  • Scope and complexity                                     │
│  • Natural work boundaries                                  │
│  • Persona expertise needed                                 │
│                                                             │
│  Output: Execution Plan (JSON)                              │
└─────────────────────────┬───────────────────────────────────┘
                          ↓
              ┌───────────┴───────────┐
              ↓                       ↓
     ┌────────────────┐      ┌────────────────────┐
     │  SIMPLE TASK   │      │   COMPLEX PROJECT  │
     │  (1 persona)   │      │   (N personas)     │
     └───────┬────────┘      └─────────┬──────────┘
             ↓                         ↓
     Execute directly          Create child tasks
     with best-fit persona     with dependencies
```

## Planning Agent

### Role

A lightweight, fast AI call (Haiku-class) that reads the PRD and outputs a structured execution plan. This is NOT the worker that does the coding - it's a quick triage step.

### Input

```typescript
interface PlanningInput {
  jiraKey: string;
  summary: string;
  description: string;  // Full PRD text
  labels: string[];
  repo: string;
  org: Organization;    // For persona/provider routing config
}
```

### Output

```typescript
interface ExecutionPlan {
  // Decision
  strategy: 'single' | 'multi';
  reasoning: string;  // Why this decision was made

  // For single-persona execution
  primaryPersona?: string;

  // For multi-persona execution
  stories?: PlannedStory[];

  // Quality requirements
  qualityGates: string[];
}

interface PlannedStory {
  index: number;
  title: string;
  persona: string;
  scope: string;           // What this story covers
  acceptanceCriteria: string[];
  dependencies: number[];  // Story indices this depends on
  estimatedComplexity: 'small' | 'medium' | 'large';
}
```

### Planning Prompt

```markdown
You are a technical planning agent for WorkerMill. Analyze this PRD and determine
the optimal execution strategy.

## Available Personas

| Persona | Expertise | Use When |
|---------|-----------|----------|
| backend_developer | APIs, databases, server logic, auth | Creating/modifying backend services |
| frontend_developer | UI, components, styling, client JS | Building user interfaces |
| devops_engineer | Infrastructure, CI/CD, deployment | Infrastructure changes |
| qa_engineer | Testing, E2E, test automation | Dedicated testing phase needed |
| security_engineer | Auth, encryption, vulnerability fixes | Security-critical features |
| tech_writer | Documentation, READMEs, API docs | Documentation deliverables |

## Decision Criteria

**Choose SINGLE persona when:**
- Work is contained to one layer (frontend-only OR backend-only)
- Scope is < 1 day of focused work
- No clear handoff points between specialties
- Tech stack is homogeneous

**Choose MULTI persona when:**
- Work spans multiple layers (frontend + backend + infra)
- Clear boundaries exist between specialties
- Dependencies create natural sequencing
- Scope is > 1 day or involves multiple components
- Quality requirements demand dedicated testing

## PRD to Analyze

{{PRD_CONTENT}}

## Output Format

Respond with a JSON execution plan:

{
  "strategy": "single" | "multi",
  "reasoning": "Brief explanation of decision",
  "primaryPersona": "persona_name",  // if single
  "stories": [...],                   // if multi
  "qualityGates": ["gate1", "gate2"]
}
```

---

## Decision Logic (Detailed)

### Complexity Signals

| Signal | Points Toward |
|--------|---------------|
| Pure HTML/CSS/JS, no backend | Single (frontend_developer) |
| API endpoints mentioned | Multi (needs backend + frontend) |
| Database schema changes | Multi (backend first, then consumers) |
| "Build X with Y and Z" (multiple components) | Multi |
| Infrastructure/deployment mentioned | Multi (include devops) |
| Security-critical (auth, encryption) | Multi (include security_engineer) |
| Explicit testing requirements | Multi (include qa_engineer) |
| Documentation deliverable | Multi (include tech_writer) |

### Tech Stack Detection

```typescript
function detectTechStack(prd: string): TechStack {
  return {
    hasBackend: /api|endpoint|database|server|auth/i.test(prd),
    hasFrontend: /ui|component|page|form|css|html/i.test(prd),
    hasInfra: /deploy|terraform|docker|ci\/cd|pipeline/i.test(prd),
    hasTests: /test|e2e|integration test|qa/i.test(prd),
    hasSecurity: /auth|jwt|encryption|oauth|permission/i.test(prd),
    hasDocs: /document|readme|api doc/i.test(prd),
  };
}

function countLayers(stack: TechStack): number {
  return Object.values(stack).filter(Boolean).length;
}

// Rule of thumb: > 1 layer suggests multi-persona
```

### Persona Selection Matrix

| PRD Contains | Primary Persona | Supporting Personas |
|--------------|-----------------|---------------------|
| Frontend only | frontend_developer | - |
| Backend only | backend_developer | - |
| Frontend + Backend | backend_developer | frontend_developer (depends on backend) |
| Frontend + Backend + Tests | backend_developer | frontend_developer, qa_engineer |
| Any + Infrastructure | devops_engineer (first) | Others depend on infra |
| Security-critical feature | security_engineer (first) | Others implement after review |

---

## Story Decomposition Rules

### Boundaries

Stories should have **clear boundaries** - where one persona's work ends and another's begins:

```
Good Boundaries:
├── Story 1: "Create /api/gallery endpoints" (backend)
├── Story 2: "Build gallery grid component" (frontend, depends on 1)
└── Story 3: "E2E tests for gallery" (qa, depends on 1 & 2)

Bad Boundaries:
├── Story 1: "Create API and half the UI" (mixed!)
└── Story 2: "Finish UI and write tests" (mixed!)
```

### Dependency Rules

1. **Backend before Frontend** - UI can't integrate with APIs that don't exist
2. **Implementation before Testing** - QA tests completed features
3. **Security review before implementation** - For security-critical features
4. **Infrastructure before services** - Can't deploy what doesn't have a target

```
Typical dependency graph:

    ┌─────────────┐
    │   devops    │  (if infra needed)
    └──────┬──────┘
           ↓
    ┌─────────────┐
    │  security   │  (if auth/security)
    └──────┬──────┘
           ↓
    ┌─────────────┐
    │   backend   │
    └──────┬──────┘
           ↓
    ┌─────────────┐
    │  frontend   │
    └──────┬──────┘
           ↓
    ┌─────────────┐
    │     qa      │
    └─────────────┘
```

### Story Sizing

Each story should be:
- **Completable in one worker session** (< 2 hours of AI work)
- **Independently verifiable** (has own acceptance criteria)
- **Produces a working increment** (not half-done code)

If a story is too large, split within the same persona:
```
Too large:
├── Story 1: "Build entire backend" (backend_developer)

Better:
├── Story 1: "Create user model and auth endpoints" (backend_developer)
├── Story 2: "Create gallery CRUD endpoints" (backend_developer, depends on 1)
```

---

## Quality Gates

### Per-Persona Standards

| Persona | Quality Gates |
|---------|---------------|
| backend_developer | API responds correctly, error handling, no security vulnerabilities |
| frontend_developer | Responsive design, accessibility basics, no console errors |
| devops_engineer | Infrastructure deploys successfully, health checks pass |
| qa_engineer | All tests pass, edge cases covered, no regressions |
| security_engineer | No OWASP top 10 vulnerabilities, auth works correctly |
| tech_writer | Documentation is accurate, examples work |

### Cross-Story Quality

- **Integration points verified** - Frontend actually calls backend APIs
- **No orphaned code** - Everything connects to something
- **Consistent patterns** - Stories follow same conventions

---

## Example: OCS-387 Astrofog Gallery

### PRD Summary
- Build dark-themed astrophotography gallery
- Pure HTML/CSS/JS (no frameworks)
- Features: grid view, lightbox, upload, delete
- APIs provided (not creating new ones)

### Planning Agent Analysis

```json
{
  "strategy": "single",
  "reasoning": "Pure frontend project (HTML/CSS/JS). No backend development needed - APIs already exist. All work is contained to frontend layer. Scope is moderate but homogeneous.",
  "primaryPersona": "frontend_developer",
  "qualityGates": [
    "Responsive design works on mobile and desktop",
    "Lightbox supports keyboard navigation (ESC, arrows)",
    "Upload shows progress indicator",
    "Delete has confirmation dialog",
    "Dark theme is consistent throughout",
    "No JavaScript errors in console"
  ]
}
```

### Execution
Single task assigned to `frontend_developer`, no decomposition needed.

---

## Example: Hypothetical Auth System

### PRD Summary
- Build user authentication for oncallshift
- Backend: JWT tokens, login/register endpoints, password hashing
- Frontend: Login form, registration form, protected routes
- Testing: E2E tests for auth flows

### Planning Agent Analysis

```json
{
  "strategy": "multi",
  "reasoning": "Spans backend (API creation) and frontend (UI) layers. Security-critical feature benefits from dedicated attention. Clear handoff point: frontend depends on backend APIs existing. Testing should be separate to ensure thorough coverage.",
  "stories": [
    {
      "index": 0,
      "title": "Implement authentication API",
      "persona": "backend_developer",
      "scope": "Create auth endpoints, JWT handling, password hashing",
      "acceptanceCriteria": [
        "POST /api/auth/register creates user with hashed password",
        "POST /api/auth/login returns JWT token",
        "GET /api/auth/me returns current user (requires valid token)",
        "Invalid credentials return 401",
        "Passwords are bcrypt hashed (cost factor 12+)"
      ],
      "dependencies": [],
      "estimatedComplexity": "medium"
    },
    {
      "index": 1,
      "title": "Build authentication UI",
      "persona": "frontend_developer",
      "scope": "Login form, registration form, auth state management",
      "acceptanceCriteria": [
        "Login form at /login with email/password fields",
        "Registration form at /register with validation",
        "JWT stored securely (httpOnly cookie or secure storage)",
        "Protected routes redirect to login if unauthenticated",
        "Loading and error states handled"
      ],
      "dependencies": [0],
      "estimatedComplexity": "medium"
    },
    {
      "index": 2,
      "title": "Authentication E2E tests",
      "persona": "qa_engineer",
      "scope": "End-to-end testing of auth flows",
      "acceptanceCriteria": [
        "Test successful registration flow",
        "Test successful login flow",
        "Test invalid credentials handling",
        "Test protected route access",
        "Test logout functionality"
      ],
      "dependencies": [0, 1],
      "estimatedComplexity": "small"
    }
  ],
  "qualityGates": [
    "No plaintext passwords stored or logged",
    "JWT expiration is reasonable (< 24h)",
    "All auth endpoints have rate limiting"
  ]
}
```

### Execution

```
backend_developer → Slot 1 → RUNNING
frontend_developer → BLOCKED (waiting on story 0)
qa_engineer → BLOCKED (waiting on stories 0, 1)

[Story 0 completes]

backend_developer → Done
frontend_developer → Slot 1 → RUNNING (unblocked)
qa_engineer → BLOCKED (waiting on story 1)

[Story 1 completes]

frontend_developer → Done
qa_engineer → Slot 1 → RUNNING (unblocked)

[Story 2 completes]

All done → Parent task marked complete
```

---

## Implementation Architecture

### New Components

```
api/src/services/
├── planning-agent.ts      # Calls AI to analyze PRD
├── execution-planner.ts   # Converts plan to tasks
└── story-task-converter.ts # Creates child WorkerTasks
```

### Flow

```typescript
// In webhooks.ts or orchestrator.ts

async function handleNewPRDTask(task: WorkerTask) {
  // 1. Call planning agent (fast, cheap - Haiku)
  const plan = await planningAgent.analyze({
    jiraKey: task.jiraIssueKey,
    summary: task.jiraSummary,
    description: task.jiraDescription,
    repo: task.gitRepo,
    org: task.organization,
  });

  // 2. Log the decision for transparency
  await logTaskEvent(task, 'planning_complete', plan);

  // 3. Execute based on strategy
  if (plan.strategy === 'single') {
    // Assign persona and queue directly
    task.persona = plan.primaryPersona;
    task.status = 'queued';
    task.planningNotes = plan.reasoning;
    await taskRepo.save(task);
  } else {
    // Create child tasks from stories
    await createChildTasks(task, plan.stories, plan.qualityGates);
    task.status = 'dispatching';
    await taskRepo.save(task);
  }
}
```

### Planning Agent Call

```typescript
// planning-agent.ts

async function analyze(input: PlanningInput): Promise<ExecutionPlan> {
  const prompt = buildPlanningPrompt(input);

  // Use fast model for planning (cost-effective, quick)
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  // Parse JSON from response
  const plan = parseExecutionPlan(response.content);

  // Validate plan
  validatePlan(plan, input.org);

  return plan;
}
```

---

## Configuration Options

### Organization Settings

```typescript
// Organization model additions

// Enable/disable planning phase
usePRDPlanning: boolean = true;

// Override planning decisions
defaultStrategy: 'auto' | 'single' | 'multi' = 'auto';

// Minimum complexity for multi-persona
multiPersonaThreshold: 'low' | 'medium' | 'high' = 'medium';

// Planning model override
planningModel: string = 'claude-haiku-4-5-20251001';
```

### Per-Ticket Override

Jira labels can override planning:

| Label | Effect |
|-------|--------|
| `single-persona` | Force single-persona execution |
| `multi-persona` | Force multi-persona planning |
| `skip-planning` | Skip planning, use default persona |
| `persona:backend` | Force specific persona (single) |

---

## Observability

### Dashboard Visibility

```
┌─────────────────────────────────────────────────────────────┐
│ OCS-387: Build astrophotography gallery                     │
│                                                             │
│ Planning: Single persona (frontend_developer)               │
│ Reasoning: "Pure frontend project, APIs already exist"      │
│                                                             │
│ Status: Executing                                           │
│ Worker: claude-haiku-4-5 @ frontend_developer               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ OCS-400: Implement user authentication                      │
│                                                             │
│ Planning: Multi persona (3 stories)                         │
│ Reasoning: "Spans backend + frontend, security-critical"    │
│                                                             │
│ Stories:                                                    │
│ ├─ [0] Auth API (backend_developer) ✅ Complete             │
│ ├─ [1] Auth UI (frontend_developer) ⏳ Running              │
│ └─ [2] E2E Tests (qa_engineer) ⏸️ Blocked on [0,1]          │
│                                                             │
│ Progress: 1/3 stories complete                              │
└─────────────────────────────────────────────────────────────┘
```

### Logging

```typescript
// All planning decisions logged
{
  event: 'planning_complete',
  taskId: 'uuid',
  jiraKey: 'OCS-387',
  strategy: 'single',
  reasoning: '...',
  selectedPersona: 'frontend_developer',
  planningDurationMs: 1250,
  planningModel: 'claude-haiku-4-5-20251001',
  planningTokens: { input: 800, output: 150 }
}
```

---

## Cost Analysis

### Planning Phase Cost

Using Haiku for planning (~1000 input tokens, ~200 output tokens per PRD):

| Volume | Planning Cost |
|--------|---------------|
| 10 PRDs/day | ~$0.03/day |
| 100 PRDs/day | ~$0.30/day |
| 1000 PRDs/day | ~$3.00/day |

Negligible compared to execution costs.

### Efficiency Gains

Multi-persona parallelization can significantly reduce total time:

```
Sequential (without planning):
├── Backend: 30 min
├── Frontend: 30 min (waits for backend)
├── Testing: 20 min (waits for frontend)
└── Total: 80 minutes

Parallel (with planning):
├── Backend: 30 min ─────────────────┐
├── Frontend: 30 min (starts after)──┼── 50 min overlap
└── Testing: 20 min (starts after)───┘
    Total: ~50 minutes (37% faster)
```

---

---

## Plan Review & Approval Flow

Plans require human approval before execution. This gives visibility into the AI's decision-making and allows course correction.

### Flow

```
PRD Ticket arrives
       ↓
Planning Agent analyzes
       ↓
Plan created (status: "pending_approval")
       ↓
Dashboard shows plan for review
       ↓
┌──────┴──────┐
↓             ↓
Approve       Request Changes
↓             ↓
Execute       Back to Planning Agent
              with feedback
```

### Dashboard Plan Review UI

```
┌─────────────────────────────────────────────────────────────────┐
│ OCS-387: Build astrophotography gallery         [Pending Review]│
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ PLANNING DECISION                                               │
│ ━━━━━━━━━━━━━━━━━                                               │
│ Strategy: Single Persona                                        │
│                                                                 │
│ Reasoning:                                                      │
│ "Pure frontend project (HTML/CSS/JS). No backend development    │
│  needed - APIs already exist. All work is contained to the      │
│  frontend layer. Scope is moderate but homogeneous."            │
│                                                                 │
│ Assigned: frontend_developer                                    │
│ Model: claude-haiku-4-5 (org default)                           │
│                                                                 │
│ Quality Gates:                                                  │
│ ☐ Responsive design works on mobile and desktop                 │
│ ☐ Lightbox supports keyboard navigation                         │
│ ☐ Upload shows progress indicator                               │
│ ☐ Dark theme is consistent throughout                           │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ [✓ Approve & Execute]  [✎ Request Changes]  [✗ Cancel]          │
└─────────────────────────────────────────────────────────────────┘
```

### Request Changes Flow

When user clicks "Request Changes":

```
┌─────────────────────────────────────────────────────────────────┐
│ Request Changes to Plan                                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ What would you like changed?                                    │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ I think this needs backend work too - the API for deleting  │ │
│ │ images doesn't exist yet. Please add a backend story.       │ │
│ │                                                             │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ [Submit Feedback]  [Cancel]                                     │
└─────────────────────────────────────────────────────────────────┘
```

The planning agent re-runs with the original PRD + user feedback appended.

### Database Schema for Plan Review

```typescript
// WorkerTask additions
planJson: object | null;           // The execution plan JSON
planStatus: 'pending_approval' | 'approved' | 'changes_requested' | null;
planFeedback: string | null;       // User feedback if changes requested
planApprovedAt: Date | null;
planApprovedBy: string | null;     // User ID
```

---

## Story Sizing & Splitting

Large stories get split into smaller chunks, even within the same persona.

### Sizing Thresholds

| Size | Criteria | Action |
|------|----------|--------|
| Small | < 3 files, < 200 lines of changes | Execute as-is |
| Medium | 3-8 files, 200-500 lines | Execute as-is |
| Large | > 8 files OR > 500 lines | Split into sub-stories |

### Splitting Rules

```
Too large (single backend story):
├── Story 1: "Build entire user management system" (backend_developer)
    - User model, auth endpoints, profile endpoints, settings endpoints

Better (split same persona):
├── Story 1a: "Create User model and auth endpoints" (backend_developer)
├── Story 1b: "Create profile endpoints" (backend_developer, depends on 1a)
├── Story 1c: "Create settings endpoints" (backend_developer, depends on 1a)
```

### Parallel vs Sequential (Same Persona)

**Sequential** (has dependencies):
- Story 1b depends on model from 1a
- Must wait for 1a to complete

**Parallel** (independent):
- Two features with no shared code
- Can run simultaneously on different branches
- Merge both to parent branch when done

```
Independent parallel work (same persona):

Parent Branch: ai/OCS-400
    ├── ai/OCS-400-story-1 (feature A)  ──┐
    │                                     ├── Both merge to parent
    └── ai/OCS-400-story-2 (feature B)  ──┘
```

---

## Multi-Agent Real-Time Communication

When multiple agents work in parallel, they need awareness of each other.

### The Challenge

Workers are ephemeral ECS containers that can't directly communicate. They need a coordination layer.

### Existing Infrastructure (Already Built)

Your codebase already has:

| Component | Purpose |
|-----------|---------|
| `WorkerCheckIn` | Track active workers, current file, files modified |
| `WorkerFileLock` | Prevent concurrent file edits |
| Manifest System | Declare intent before editing |
| Heartbeat | Liveness updates |

### New Component: Shared Context

Add a **shared context** system where workers can post updates and read sibling updates.

```typescript
// New model: WorkerContext
@Entity("worker_contexts")
export class WorkerContext {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "parent_task_id", type: "uuid" })
  parentTaskId: string;  // Links all sibling workers

  @Column({ name: "task_id", type: "uuid" })
  taskId: string;  // Which worker posted this

  @Column({ type: "varchar", length: 50 })
  persona: string;

  @Column({ type: "varchar", length: 50 })
  messageType: ContextMessageType;

  @Column({ type: "text" })
  content: string;

  @Column({ type: "jsonb", nullable: true })
  metadata: Record<string, unknown>;

  @Column({ name: "created_at", type: "timestamp" })
  createdAt: Date;
}

type ContextMessageType =
  | 'file_created'      // "I created src/services/AuthService.ts"
  | 'file_modified'     // "I modified src/models/User.ts"
  | 'decision'          // "I'm using bcrypt for password hashing"
  | 'dependency'        // "I need frontend to import AuthService from..."
  | 'question'          // "Should I use JWT or session-based auth?"
  | 'answer'            // Response to a sibling's question
  | 'completion'        // "Story 1 complete, auth API ready at /api/auth/*"
  | 'blocker'           // "Waiting for backend API to be ready"
  | 'warning';          // "The User model schema changed, update your imports"
```

### API Endpoints

```typescript
// POST /api/coordination/context
// Worker posts an update for siblings to see
router.post("/context", async (req, res) => {
  const { taskId, messageType, content, metadata } = req.body;
  // Save to worker_contexts table
  // Notify SSE subscribers
});

// GET /api/coordination/context/stream/:parentTaskId
// SSE stream of sibling updates
router.get("/context/stream/:parentTaskId", async (req, res) => {
  // SSE stream that pushes new context messages in real-time
});

// GET /api/coordination/context/:parentTaskId
// Get all context messages for a parent task (for initial load)
router.get("/context/:parentTaskId", async (req, res) => {
  // Return all messages, optionally filtered by type
});
```

### Worker Integration

Workers subscribe to sibling updates and incorporate them into their context:

```bash
# In worker entrypoint, for child tasks:

if [ -n "$PARENT_TASK_ID" ]; then
  # Start background process to receive sibling updates
  start_sibling_listener "$PARENT_TASK_ID" &
  SIBLING_LISTENER_PID=$!
fi

# Function to post context updates
post_context() {
  local message_type="$1"
  local content="$2"
  curl -s -X POST "${API_BASE}/api/coordination/context" \
    -H "Authorization: Bearer ${ORG_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"taskId\": \"${TASK_ID}\", \"messageType\": \"${message_type}\", \"content\": \"${content}\"}"
}

# Examples of posting context:
post_context "file_created" "Created src/services/AuthService.ts with login() and register() methods"
post_context "decision" "Using bcrypt with cost factor 12 for password hashing"
post_context "completion" "Auth API complete. Endpoints: POST /api/auth/login, POST /api/auth/register"
```

### Claude Code Integration

Workers inject sibling context into their prompt:

```typescript
// In worker prompt construction:

function buildPromptWithSiblingContext(
  basePrompt: string,
  siblingMessages: WorkerContext[]
): string {
  if (siblingMessages.length === 0) return basePrompt;

  const contextSection = `
## Sibling Worker Updates

Other workers are working on related stories in parallel. Here's what they've shared:

${siblingMessages.map(msg => `
**${msg.persona}** (${msg.messageType}):
${msg.content}
`).join('\n')}

Consider this context when making decisions. If you create files or APIs that siblings might need, post an update.
`;

  return basePrompt + contextSection;
}
```

### Real-Time Update Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Backend Worker │     │     API         │     │ Frontend Worker │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │ POST /context         │                       │
         │ "Created AuthService" │                       │
         │──────────────────────>│                       │
         │                       │                       │
         │                       │ SSE push              │
         │                       │──────────────────────>│
         │                       │                       │
         │                       │              Frontend sees:
         │                       │              "Backend created
         │                       │               AuthService, I can
         │                       │               now import it"
         │                       │                       │
         │                       │         POST /context │
         │                       │<──────────────────────│
         │                       │ "Using AuthService    │
         │                       │  for login form"      │
         │                       │                       │
         │ SSE push              │                       │
         │<──────────────────────│                       │
         │                       │                       │
Backend sees:                    │                       │
"Frontend using my              │                       │
 AuthService - good"            │                       │
```

### Conflict Prevention

The existing file lock system prevents actual conflicts. The context system adds **awareness**:

```
Without context awareness:
├── Backend creates UserModel.ts
├── Frontend creates UserModel.ts (different file, same name - confusing!)

With context awareness:
├── Backend posts: "Created src/models/UserModel.ts"
├── Frontend sees this, uses the existing model instead of creating a duplicate
```

### Git Branch Strategy for Parallel Workers

```
Parent Task: OCS-400 "Build auth system"
Branch: ai/OCS-400

Story 1 (backend): ai/OCS-400-s1
Story 2 (frontend): ai/OCS-400-s2
Story 3 (QA): ai/OCS-400-s3

Merge order:
1. Backend completes → merges to ai/OCS-400
2. Frontend completes → merges to ai/OCS-400 (has backend changes)
3. QA completes → merges to ai/OCS-400 (has both)
4. Final PR: ai/OCS-400 → main
```

Workers pull from parent branch periodically to get sibling changes:

```bash
# Periodic sync in worker (every 5 minutes)
git fetch origin "$PARENT_BRANCH"
git merge "origin/$PARENT_BRANCH" --no-edit || {
  # Conflict - post to context for human review
  post_context "blocker" "Merge conflict with sibling changes. Files: $(git diff --name-only --diff-filter=U)"
}
```

---

## Human Intervention & Course Correction

Workers need to handle unexpected situations and humans need to inject guidance in real-time.

### Bidirectional Communication

```
┌─────────────────────────────────────────────────────────────────┐
│                      DASHBOARD                                  │
│                                                                 │
│  [View Progress]  [Send Message]  [Pause]  [Resume]  [Cancel]   │
│                                                                 │
│  Messages to Worker:                                            │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ "Use the existing UserService instead of creating a new   │  │
│  │  one - it's in src/services/UserService.ts"               │  │
│  └───────────────────────────────────────────────────────────┘  │
│  [Send to Worker]                                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓ SSE / Polling
┌─────────────────────────────────────────────────────────────────┐
│                       WORKER                                    │
│                                                                 │
│  Receives human guidance → Incorporates into next action        │
│  Detects blocker → Posts question → Waits for response          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Worker Commands (Human → Worker)

```typescript
// New model: WorkerCommand
@Entity("worker_commands")
export class WorkerCommand {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "task_id", type: "uuid" })
  taskId: string;

  @Column({ type: "varchar", length: 50 })
  commandType: WorkerCommandType;

  @Column({ type: "text", nullable: true })
  payload: string;

  @Column({ name: "created_by", type: "uuid" })
  createdBy: string;  // User ID

  @Column({ name: "created_at", type: "timestamp" })
  createdAt: Date;

  @Column({ name: "acknowledged_at", type: "timestamp", nullable: true })
  acknowledgedAt: Date | null;

  @Column({ type: "varchar", length: 50, default: "pending" })
  status: "pending" | "acknowledged" | "completed" | "ignored";
}

type WorkerCommandType =
  | 'message'           // Human sends guidance/clarification
  | 'pause'             // Pause execution (finish current step, then wait)
  | 'resume'            // Resume paused execution
  | 'cancel'            // Cancel the task
  | 'redirect'          // Change approach ("use X instead of Y")
  | 'answer'            // Answer a worker's question
  | 'extend_scope'      // Add requirements mid-execution
  | 'reduce_scope'      // Remove requirements mid-execution
  | 'force_complete';   // Mark as complete despite issues
```

### API Endpoints

```typescript
// POST /api/tasks/:taskId/command
// Human sends a command to a running worker
router.post("/tasks/:taskId/command", async (req, res) => {
  const { commandType, payload } = req.body;
  const command = await createWorkerCommand(taskId, commandType, payload, req.user.id);
  // Worker will pick this up on next poll or via SSE
});

// GET /api/tasks/:taskId/commands/pending
// Worker checks for pending commands
router.get("/tasks/:taskId/commands/pending", async (req, res) => {
  const commands = await getPendingCommands(taskId);
  return commands;
});

// POST /api/tasks/:taskId/commands/:commandId/ack
// Worker acknowledges receipt of command
router.post("/tasks/:taskId/commands/:commandId/ack", async (req, res) => {
  await acknowledgeCommand(commandId);
});
```

### Worker Command Processing

```bash
# In worker entrypoint - check for commands periodically

check_for_commands() {
  local response=$(curl -s "${API_BASE}/api/tasks/${TASK_ID}/commands/pending" \
    -H "Authorization: Bearer ${ORG_API_KEY}")

  echo "$response" | jq -c '.commands[]' | while read -r cmd; do
    local cmd_type=$(echo "$cmd" | jq -r '.commandType')
    local cmd_id=$(echo "$cmd" | jq -r '.id')
    local payload=$(echo "$cmd" | jq -r '.payload')

    case "$cmd_type" in
      "pause")
        post_log "system" "⏸️ Received PAUSE command from user"
        acknowledge_command "$cmd_id"
        # Set flag for Claude Code to see
        echo "PAUSED" > /tmp/worker_state
        wait_for_resume
        ;;
      "resume")
        post_log "system" "▶️ Received RESUME command"
        acknowledge_command "$cmd_id"
        echo "RUNNING" > /tmp/worker_state
        ;;
      "message")
        post_log "system" "💬 Human guidance: $payload"
        acknowledge_command "$cmd_id"
        # Append to context for next Claude iteration
        echo "$payload" >> /tmp/human_guidance.txt
        ;;
      "cancel")
        post_log "system" "🛑 Received CANCEL command"
        acknowledge_command "$cmd_id"
        cleanup_and_exit
        ;;
      "answer")
        post_log "system" "📝 Human answered: $payload"
        acknowledge_command "$cmd_id"
        # Store answer for blocker resolution
        echo "$payload" > /tmp/blocker_answer.txt
        ;;
    esac
  done
}

# Run command check every 30 seconds in background
(while true; do
  check_for_commands
  sleep 30
done) &
COMMAND_CHECK_PID=$!
```

### Blocker Detection & Escalation

Workers detect blockers and escalate to humans:

```typescript
// In worker prompt:
`
If you encounter a situation where you cannot proceed, you MUST:
1. Post a 'blocker' context message explaining the issue
2. Post a 'question' context message asking for guidance
3. Output the marker: ::blocker::<description>

Example blockers:
- "The API endpoint specified in the PRD doesn't exist"
- "Conflicting requirements: PRD says X but existing code does Y"
- "Missing credentials/configuration needed for this task"
- "Ambiguous requirement: unclear if this should be A or B"

After posting a blocker, WAIT for human guidance before proceeding.
`
```

### Blocker Flow

```
┌─────────────────┐
│     Worker      │
└────────┬────────┘
         │
         │ Detects ambiguity
         │
         ↓
┌─────────────────────────────────────────┐
│ POST /api/coordination/context          │
│ type: "blocker"                         │
│ content: "PRD says use existing auth    │
│  but I can't find any auth code"        │
└─────────────────┬───────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────┐
│           Dashboard Alert               │
│                                         │
│ ⚠️ Worker blocked on OCS-400-S1         │
│                                         │
│ "PRD says use existing auth but I       │
│  can't find any auth code"              │
│                                         │
│ [Provide Guidance]  [Cancel Task]       │
└─────────────────┬───────────────────────┘
                  │
                  │ Human provides answer
                  ↓
┌─────────────────────────────────────────┐
│ POST /api/tasks/:id/command             │
│ type: "answer"                          │
│ payload: "There is no existing auth -   │
│  you need to create it from scratch"    │
└─────────────────┬───────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────┐
│     Worker receives answer              │
│     Continues with new information      │
└─────────────────────────────────────────┘
```

### Automatic Course Correction

Some situations can be handled automatically:

| Situation | Auto-Correction |
|-----------|-----------------|
| File conflict with sibling | Wait for sibling to release lock, retry |
| API rate limit | Exponential backoff, retry |
| Test failure | Attempt fix, retry up to 3 times |
| Merge conflict (simple) | Auto-resolve if no semantic conflict |
| Missing dependency | Check if sibling is creating it, wait |

```typescript
// Automatic retry logic
const autoCorrectableErrors = [
  { pattern: /rate limit/i, action: 'backoff_retry', maxRetries: 5 },
  { pattern: /lock.*held by/i, action: 'wait_and_retry', maxRetries: 10 },
  { pattern: /test.*failed/i, action: 'fix_and_retry', maxRetries: 3 },
  { pattern: /merge conflict/i, action: 'attempt_auto_merge', maxRetries: 1 },
];

// Escalate to human if auto-correction fails
const escalateToHuman = [
  { pattern: /ambiguous/i, reason: 'Needs clarification' },
  { pattern: /missing.*credential/i, reason: 'Needs configuration' },
  { pattern: /conflicting.*requirement/i, reason: 'PRD inconsistency' },
  { pattern: /cannot find/i, reason: 'Missing dependency or context' },
];
```

### Pause/Resume Flow

```
User clicks [Pause]
       ↓
API creates pause command
       ↓
Worker receives on next poll
       ↓
Worker finishes current atomic operation
(don't leave repo in broken state)
       ↓
Worker enters wait loop
       ↓
Dashboard shows: "Paused - Worker waiting"
       ↓
User reviews, refines requirements, updates Jira
       ↓
User clicks [Resume]
       ↓
Worker receives resume command
       ↓
Worker reloads context (gets updated requirements)
       ↓
Continues execution
```

### Mid-Execution Requirement Changes

When requirements change while workers are running:

```typescript
// POST /api/tasks/:taskId/command
{
  "commandType": "extend_scope",
  "payload": {
    "addition": "Also add password reset functionality",
    "affectedStories": [0, 1],  // Backend and frontend stories
    "priority": "high"
  }
}
```

Worker receives this and:
1. Logs the scope change
2. Incorporates into remaining work
3. Posts acknowledgment
4. May request re-planning if change is significant

### Dashboard UI for Intervention

```
┌─────────────────────────────────────────────────────────────────┐
│ OCS-400: Build auth system                    [Multi-Persona]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Stories:                                                        │
│ ├─ [S1] Auth API (backend)      ⚠️ BLOCKED                      │
│ │       "Can't find existing user model referenced in PRD"      │
│ │       [Answer Question]  [Cancel Story]                       │
│ │                                                               │
│ ├─ [S2] Auth UI (frontend)      ⏳ Running                       │
│ │       Currently editing: src/components/LoginForm.tsx         │
│ │       [Pause]  [Send Message]  [Cancel]                       │
│ │                                                               │
│ └─ [S3] E2E Tests (qa)          ⏸️ Waiting (blocked by S1, S2)   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ Quick Actions:                                                  │
│ [Pause All]  [Resume All]  [Cancel All]  [Send to All]          │
├─────────────────────────────────────────────────────────────────┤
│ Message to S2 (frontend):                                       │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │                                                             │ │
│ └─────────────────────────────────────────────────────────────┘ │
│ [Send]                                                          │
└─────────────────────────────────────────────────────────────────┘
```

### Timeout & Stale Detection

Workers that go silent get flagged:

```typescript
// In orchestrator monitoring loop
async function checkForStaleWorkers() {
  const staleThreshold = 10 * 60 * 1000; // 10 minutes

  const staleWorkers = await db.query(`
    SELECT * FROM worker_check_ins
    WHERE heartbeat_at < NOW() - INTERVAL '10 minutes'
    AND status NOT IN ('completed', 'failed', 'cancelled')
  `);

  for (const worker of staleWorkers) {
    // Notify dashboard
    await createAlert({
      type: 'worker_stale',
      taskId: worker.taskId,
      message: `Worker hasn't responded in ${staleThreshold/60000} minutes`,
      actions: ['ping', 'cancel', 'restart']
    });
  }
}
```

---

## Override Mechanism (Jira Labels)

| Label | Effect |
|-------|--------|
| `single-persona` | Force single-persona execution, skip multi-persona planning |
| `multi-persona` | Force multi-persona planning even for simple PRDs |
| `skip-planning` | Skip planning entirely, use persona from ticket or default |
| `persona:backend` | Force specific persona (implies single) |
| `persona:frontend` | Force specific persona |
| `no-parallel` | Execute all stories sequentially, even if independent |
| `auto-approve` | Skip plan review, execute immediately (dangerous) |

---

## Open Questions

1. **Planning model choice** - Haiku is fast/cheap but is it accurate enough for complex PRDs?

2. **Plan revision on failure** - If a story fails, should the planner re-evaluate remaining stories?

3. **Feedback loop** - Should completed task outcomes inform future planning decisions?

4. **Context retention** - How long to keep sibling context? Clear on parent completion?

5. **Branch merge conflicts** - Auto-resolve, or escalate to human?

---

## Implementation Phases

### Phase 1: Foundation
1. Database migration for parent-child tasks + plan fields
2. WorkerTask model updates
3. Plan review status tracking

### Phase 2: Planning Agent
4. Planning agent service (analyzes PRD, outputs plan)
5. Plan review API endpoints
6. Dashboard plan review UI

### Phase 3: Story Execution
7. Story task converter (creates child tasks)
8. Orchestrator: PRD detection + child task creation
9. Orchestrator: Dependency tracking + unblocking
10. Orchestrator: Parent completion tracking

### Phase 4: Multi-Agent Communication
11. WorkerContext model + migration
12. Context API endpoints (post, stream, get)
13. Worker entrypoint: context posting
14. Worker prompt: sibling context injection
15. Git sync for parallel branches

### Phase 5: Polish
16. Dashboard story hierarchy view
17. Context message visualization
18. Override labels support
19. Metrics and observability

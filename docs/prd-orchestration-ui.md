# PRD Orchestration UI Design

This document defines the UI architecture for visualizing and controlling parallel AI worker execution during PRD (Product Requirements Document) orchestration.

## Design Philosophy

### Core Principle: Autonomous-First with Optional Supervision

WorkerMill is designed for **autonomous execution** - AI workers should complete complex multi-story PRDs without requiring human intervention. However, we provide optional supervision for users who want to watch and occasionally guide execution.

**Two Operating Modes:**

| Mode | Human Required | Worker Behavior | Use Case |
|------|----------------|-----------------|----------|
| **Autonomous** | No | Makes reasonable decisions, queues blockers for async review | Overnight runs, batch processing, trusted workflows |
| **Supervised** | Yes (watching) | Pauses on ambiguity, allows real-time intervention | New workflows, debugging, critical tasks |

### Secondary Principle: Orchestration Overview + Drill-Down

Rather than cramming all workers into a single terminal (chaotic) or requiring users to switch between separate pages (disconnected), we use a **hierarchical visualization** that shows:

1. **Workflow-level progress** - The big picture of all stories
2. **Worker-level activity** - What each persona is doing right now
3. **Coordination feed** - Inter-worker communication in real-time
4. **Terminal drill-down** - Full logs when you need the details

---

## Autonomous vs. Supervised Mode

### Mode Selection

When a user approves a PRD plan, they choose the execution mode:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ✅ Plan Approved - Choose Execution Mode                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ○ Autonomous Mode (Recommended)                                           │
│    Workers make reasonable decisions when blocked. Blockers queued for     │
│    async review. Best for overnight runs or trusted workflows.             │
│                                                                             │
│  ○ Supervised Mode                                                         │
│    Workers pause on ambiguity and wait for your input. Requires you to     │
│    be present during execution. Best for new or critical workflows.        │
│                                                                             │
│                                              [Start Execution]              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Autonomous Mode Behavior

When a worker encounters ambiguity or a potential blocker:

1. **Assess severity** - Is this a "can't proceed" blocker or a "could go either way" decision?
2. **Make reasonable choice** - For low-stakes decisions, pick a sensible default and document it
3. **Queue for review** - For blockers, add to async review queue and move to next available story
4. **Continue execution** - Don't stop the workflow; maximize parallel progress

**Worker Decision Framework:**

| Situation | Action | Example |
|-----------|--------|---------|
| Minor ambiguity | Decide + document | "PRD says 'nice UI' - using TailwindCSS defaults" |
| Missing detail | Use convention | "No auth method specified - using JWT (industry standard)" |
| Conflicting requirements | Flag + proceed with safer option | "PRD says 'fast' and 'thorough' - prioritizing correctness" |
| True blocker | Queue + skip | "Need API key for Stripe - queued for human, moving to next story" |
| Dependency not ready | Wait with timeout | "Story 2 needs Story 1's API - waiting up to 10min then queuing" |

**Async Review Queue:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 📋 REVIEW QUEUE (3 items)                                    [Mark All Read] │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ ⚠️ Story 3 [backend_developer] - DECISION MADE                    2h ago   │
│    "Database schema: chose PostgreSQL JSONB over separate tables           │
│     for user preferences. Can revisit if this causes issues."              │
│    [Acknowledge] [Request Change]                                          │
│                                                                             │
│ 🔒 Story 5 [devops_engineer] - BLOCKED                           45m ago   │
│    "Need AWS credentials for deployment. Skipped deployment story,         │
│     PR created with code changes only."                                    │
│    [Provide Credentials] [Skip Story]                                      │
│                                                                             │
│ ❓ Story 4 [qa_engineer] - NEEDS CLARIFICATION                   12m ago   │
│    "Should E2E tests cover mobile viewports? PRD unclear.                  │
│     Proceeded with desktop-only. Add mobile if needed."                    │
│    [Acknowledge] [Add Mobile Tests]                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Supervised Mode Behavior

When a worker encounters ambiguity:

1. **Post blocker** - Immediately surface to dashboard
2. **Pause execution** - Stop this story's worker (other stories continue)
3. **Wait for human** - Show intervention modal
4. **Resume on input** - Continue once human provides guidance

**Key difference:** Workers actively WAIT rather than deciding autonomously.

---

## Should Humans Refine Requirements Mid-Execution?

**Short answer: Generally NO, with exceptions.**

### The Problem with Mid-Execution Refinement

| Issue | Why It's Problematic |
|-------|---------------------|
| **Partial state** | Story 2 may have already built on Story 1's decisions. Changing Story 1's requirements creates inconsistency. |
| **Wasted work** | Worker has written 500 lines based on original requirements. Changing direction wastes that effort and money. |
| **Scope creep** | "While you're at it, also add X" turns a focused task into an ever-expanding project. |
| **Coordination chaos** | Siblings received context "Story 1 using JWT" then you say "actually use sessions" - other stories now have wrong assumptions. |
| **Unpredictable outcomes** | Harder to reason about what the system will produce when requirements are a moving target. |

### When Refinement IS Appropriate

| Scenario | Appropriate Action |
|----------|-------------------|
| **Clarifying ambiguity** | Worker asks "JWT or sessions?" → You answer. This isn't changing requirements, it's filling a gap. |
| **Correcting misunderstanding** | Worker interpreted PRD wrong → Redirect before more work is done. |
| **Critical bug discovered** | Worker's approach has security flaw → Stop and correct immediately. |
| **Scope REDUCTION** | "Skip the mobile tests, we only need desktop" → Removing work is safer than adding. |

### When Refinement is NOT Appropriate

| Scenario | Better Alternative |
|----------|-------------------|
| **Adding features** | Create a follow-up PRD after this one completes |
| **Major direction change** | Cancel workflow, create new PRD with correct direction |
| **"While you're at it"** | Resist. File a new ticket. |
| **Changing completed stories** | The work is done. Create a new story to modify it. |

### Refinement Rules (Enforced by System)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ REFINEMENT POLICY                                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ ✅ ALLOWED                                                                  │
│    • Answer worker questions (clarification)                               │
│    • Provide missing credentials/context                                   │
│    • Reduce scope (remove stories, simplify requirements)                  │
│    • Cancel in-progress stories (with confirmation)                        │
│    • Redirect BEFORE significant work done (<2 min into story)            │
│                                                                             │
│ ⚠️ REQUIRES CONFIRMATION                                                    │
│    • Redirect after >2 min of work ("Worker has written 127 lines.        │
│      Redirecting will discard this. Continue?")                           │
│    • Modify requirements for stories with dependents                       │
│                                                                             │
│ ❌ NOT ALLOWED (system prevents)                                            │
│    • Modify completed stories (create new story instead)                   │
│    • Add stories mid-execution (wait for workflow to complete)             │
│    • Change requirements for blocked stories (they haven't started)        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Human-to-Worker Communication

### Message Types (When Supervision IS Needed)

| Message Type | Purpose | When to Use |
|--------------|---------|-------------|
| **Answer** | Respond to worker's question | Worker asked a clarifying question |
| **Clarify** | Provide additional context | Worker seems confused about requirements |
| **Redirect** | Change approach | Worker is going down wrong path, early in story |
| **Pause** | Temporarily halt | Need to investigate something, will resume |
| **Cancel** | Stop this story | Requirements were wrong, don't want this work |
| **Reduce Scope** | Simplify requirements | Original ask was too ambitious |

### Message Flow

```
Human types message in dashboard
        │
        ▼
POST /api/tasks/:taskId/commands
{
  type: "clarify",
  content: "Use bcrypt for password hashing, not argon2"
}
        │
        ▼
Stored in worker_commands table
        │
        ▼
Worker polls GET /api/tasks/:taskId/commands/pending
(every 30 seconds during execution)
        │
        ▼
Worker receives command, incorporates into next action
        │
        ▼
Worker posts acknowledgment via context message
{
  type: "answer",
  content: "Understood, switching to bcrypt"
}
```

### Command Delivery Timing

**Critical insight:** Workers can only receive commands at natural breakpoints:

- Between tool calls (read file → [check commands] → edit file)
- After completing a logical unit of work
- NOT mid-generation (can't interrupt Claude mid-response)

This means:
- Commands are "best effort" delivery
- Worker may complete some work before seeing your message
- For urgent stops, use **Cancel** which terminates the container

---

## Notification System (For Autonomous Mode)

Since humans aren't watching in autonomous mode, we need async notifications:

### Notification Triggers

| Event | Notification | Channel |
|-------|--------------|---------|
| Workflow complete | "OCS-45 completed: 5/5 stories, 2 PRs created" | Email, Slack |
| Story blocked | "Story 3 blocked: needs AWS credentials" | Email, Slack |
| Worker made decision | "Story 2: chose PostgreSQL over MySQL" | Dashboard only |
| Workflow failed | "OCS-45 failed: Story 4 crashed after 3 retries" | Email, Slack, SMS |
| Cost threshold | "Workflow cost exceeded $5.00" | Email, Slack |

### Notification Preferences

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ NOTIFICATION SETTINGS                                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ Email: jarod@example.com                                                   │
│ Slack: #workermill-alerts (connected)                                      │
│                                                                             │
│ ┌─────────────────────────────────────────────────────────────────────┐    │
│ │ Event                    │ Dashboard │ Email │ Slack │ SMS │        │    │
│ ├──────────────────────────┼───────────┼───────┼───────┼─────┤        │    │
│ │ Workflow complete        │    ✓      │   ✓   │   ✓   │     │        │    │
│ │ Workflow failed          │    ✓      │   ✓   │   ✓   │  ✓  │        │    │
│ │ Story blocked            │    ✓      │   ✓   │   ✓   │     │        │    │
│ │ Decision made            │    ✓      │       │       │     │        │    │
│ │ Cost threshold           │    ✓      │   ✓   │   ✓   │     │        │    │
│ └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## UI Components

### 1. Workflow Header

Shows the parent PRD task with aggregate status.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 📋 OCS-45: Implement User Authentication System                             │
│                                                                             │
│ ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐                     │
│ │ Stories  │  │ Progress │  │ Duration │  │ Est Cost │                     │
│ │   3/5    │  │   60%    │  │  12m 34s │  │  $0.42   │                     │
│ └──────────┘  └──────────┘  └──────────┘  └──────────┘                     │
│                                                                             │
│ Status: 2 Running • 1 Blocked • 2 Complete          [Pause All] [Cancel]   │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Data displayed:**
- Parent Jira key and summary
- Stories completed vs total
- Overall progress percentage
- Elapsed duration
- Aggregate estimated cost
- Quick status counts
- Global actions (pause all, cancel workflow)

### 2. Story Lane View

Horizontal swim lanes showing each story's status with mini-progress indicators.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ STORIES                                                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ✅ Story 1: Backend API Endpoints          [backend_developer]    COMPLETE │
│     └─ Created AuthService, UserController, JWT middleware                  │
│                                                                             │
│  ▶️ Story 2: Frontend Login Components      [frontend_developer]   RUNNING  │
│     └─ Working on LoginForm.tsx (47 lines written)                         │
│     ├─ 📄 src/components/LoginForm.tsx                                     │
│     └─ 💬 "Using AuthService API from Story 1"                             │
│                                                                             │
│  ▶️ Story 3: Database Schema & Migrations   [backend_developer]    RUNNING  │
│     └─ Creating user_sessions table migration                               │
│     └─ 📄 src/migrations/20250117_sessions.ts                              │
│                                                                             │
│  🔒 Story 4: E2E Authentication Tests       [qa_engineer]          BLOCKED  │
│     └─ Waiting for: Story 1, Story 2                                       │
│                                                                             │
│  ⏳ Story 5: Security Audit                 [security_engineer]    QUEUED   │
│     └─ Waiting for: Story 1, Story 3, Story 4                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Story States:**
| Icon | State | Description |
|------|-------|-------------|
| ⏳ | `queued` | Ready to run, waiting for worker slot |
| 🔒 | `blocked` | Dependencies not yet complete |
| ▶️ | `running` | Worker actively executing |
| ⏸️ | `paused` | User paused execution |
| ✅ | `complete` | Successfully finished |
| ❌ | `failed` | Failed after retries |
| 🔄 | `retrying` | Failed, attempting retry |

**Interactions:**
- Click story row to expand terminal view
- Hover for quick actions (pause, cancel, retry)
- Dependency links are clickable to jump to blocking story

### 3. Active Worker Panels (Expanded View)

When a story is expanded, shows the full worker terminal with controls.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ▼ Story 2: Frontend Login Components                                        │
│   [frontend_developer] • claude-sonnet-4 • Running 3m 42s • $0.08          │
│                                                           [Pause] [Cancel]  │
├─────────────────────────────────────────────────────────────────────────────┤
│ TERMINAL                                                          [Search]  │
│ ────────────────────────────────────────────────────────────────────────── │
│ $ claude --model claude-sonnet-4                                           │
│                                                                             │
│ ╭─ Task ────────────────────────────────────────────────────────────────╮  │
│ │ Implement login form component with email/password fields,            │  │
│ │ form validation, and integration with AuthService from Story 1        │  │
│ ╰───────────────────────────────────────────────────────────────────────╯  │
│                                                                             │
│ I'll create a login form component that integrates with the                │
│ AuthService. Based on the sibling context, I can see that Story 1         │
│ created the auth API at /api/auth/login.                                   │
│                                                                             │
│ Let me first read the AuthService to understand the interface...           │
│                                                                             │
│ Read src/services/AuthService.ts                                           │
│                                                                             │
│ Now I'll create the LoginForm component:                                   │
│                                                                             │
│ Write src/components/LoginForm.tsx                                         │
│ ───────────────────────────────────────────────────────────────────────── │
│ + import { useState } from 'react';                                        │
│ + import { AuthService } from '../services/AuthService';                   │
│ +                                                                          │
│ + export function LoginForm() {                                            │
│ +   const [email, setEmail] = useState('');                                │
│ +   const [password, setPassword] = useState('');                          │
│ █                                                                          │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ FILES MODIFIED                                                              │
│ ├─ 📄 src/components/LoginForm.tsx (new, 47 lines)                         │
│ ├─ 📄 src/components/index.ts (+1 line)                                    │
│ └─ 📄 src/pages/LoginPage.tsx (+12 lines)                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Panel Sections:**
1. **Header** - Story info, persona, model, duration, cost, actions
2. **Terminal** - Live-streaming logs (SSE, 500ms updates)
3. **Files Modified** - Real-time list of file changes

### 4. Coordination Feed (Sidebar)

Real-time feed of inter-worker messages, showing how workers are coordinating.

```
┌────────────────────────────────────────┐
│ 🔗 COORDINATION FEED                   │
├────────────────────────────────────────┤
│                                        │
│ 12:34:56 [backend_developer]           │
│ ✅ completion                          │
│ "Auth API ready at /api/auth/*"        │
│ Story 1 → All siblings                 │
│                                        │
│ 12:35:12 [frontend_developer]          │
│ 📄 file_created                        │
│ src/components/LoginForm.tsx           │
│ Story 2                                │
│                                        │
│ 12:35:28 [frontend_developer]          │
│ 💡 decision                            │
│ "Using react-hook-form for validation" │
│ Story 2                                │
│                                        │
│ 12:35:45 [backend_developer]           │
│ 📄 file_created                        │
│ src/migrations/20250117_sessions.ts    │
│ Story 3                                │
│                                        │
│ 12:36:01 [qa_engineer]                 │
│ ⏳ blocker                             │
│ "Waiting for login endpoint"           │
│ Story 4 → Dashboard alert              │
│                                        │
│ [Show earlier messages...]             │
│                                        │
└────────────────────────────────────────┘
```

**Message Types with Icons:**
| Icon | Type | Description |
|------|------|-------------|
| 📄 | `file_created` | New file created |
| ✏️ | `file_modified` | Existing file changed |
| 💡 | `decision` | Architectural decision made |
| 🔗 | `dependency` | Dependency declared for siblings |
| ❓ | `question` | Worker asking for clarification |
| 💬 | `answer` | Response to question |
| ✅ | `completion` | Story milestone complete |
| ⏳ | `blocker` | Worker is blocked |
| ⚠️ | `warning` | Important notice for siblings |
| 📊 | `progress` | General progress update |

### 5. Dependency Graph (Optional Visualization)

Visual DAG showing story dependencies and flow.

```
┌─────────────────────────────────────────────────────────────────┐
│ DEPENDENCY GRAPH                                                │
│                                                                 │
│                    ┌─────────┐                                  │
│                    │ Story 1 │ ✅                               │
│                    │ Backend │                                  │
│                    └────┬────┘                                  │
│               ┌─────────┼─────────┐                             │
│               ▼         ▼         │                             │
│          ┌─────────┐ ┌─────────┐  │                             │
│          │ Story 2 │ │ Story 3 │  │                             │
│          │Frontend │ │Database │  │                             │
│          │   ▶️    │ │   ▶️    │  │                             │
│          └────┬────┘ └────┬────┘  │                             │
│               └─────┬─────┘       │                             │
│                     ▼             │                             │
│                ┌─────────┐        │                             │
│                │ Story 4 │        │                             │
│                │   QA    │ 🔒     │                             │
│                └────┬────┘        │                             │
│                     │      ┌──────┘                             │
│                     ▼      ▼                                    │
│                ┌─────────────┐                                  │
│                │   Story 5   │                                  │
│                │  Security   │ ⏳                               │
│                └─────────────┘                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Features:**
- Nodes show story number, persona, and status icon
- Edges show dependency direction
- Click node to expand that story's terminal
- Completed nodes are greyed/muted
- Running nodes have animated border

### 6. Human Intervention Panel

When a worker posts a `blocker` or `question`, an alert appears for human intervention.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ⚠️ WORKER NEEDS INPUT                                               [Dismiss] │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ Story 4 [qa_engineer] asked:                                               │
│                                                                             │
│ "The login endpoint returns 401 for valid credentials. Should I:           │
│  A) Wait for backend to fix the bug                                        │
│  B) Create a mock endpoint for testing                                     │
│  C) Skip auth tests for now"                                               │
│                                                                             │
│ ┌─────────────────────────────────────────────────────────────────────┐    │
│ │ Your response:                                                      │    │
│ │ Wait for backend - I'll check Story 1's implementation             █│    │
│ └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│                                              [Send Answer] [Pause Worker]   │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Worker Commands Available:**
| Command | Action |
|---------|--------|
| Send Answer | Sends response to worker, resumes execution |
| Pause Worker | Pauses this story's execution |
| Redirect | Change worker's approach |
| Extend Scope | Add requirements |
| Reduce Scope | Remove requirements |
| Cancel | Cancel this story |

## Layout Options

### Option A: Split View (Recommended for Desktop)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           WORKFLOW HEADER                                   │
├──────────────────────────────────────────────────────────┬──────────────────┤
│                                                          │                  │
│                    STORY LANES                           │  COORDINATION    │
│                                                          │     FEED         │
│  ┌─────────────────────────────────────────────────┐    │                  │
│  │ ✅ Story 1: Backend API            [COMPLETE]   │    │  12:34 backend   │
│  └─────────────────────────────────────────────────┘    │  ✅ Auth ready   │
│                                                          │                  │
│  ┌─────────────────────────────────────────────────┐    │  12:35 frontend  │
│  │ ▼ Story 2: Frontend Login          [RUNNING]    │    │  📄 LoginForm    │
│  │   ┌────────────────────────────────────────┐    │    │                  │
│  │   │          TERMINAL OUTPUT               │    │    │  12:36 backend   │
│  │   │  $ claude --model claude-sonnet-4      │    │    │  📄 migration    │
│  │   │  Creating LoginForm component...       │    │    │                  │
│  │   │  █                                     │    │    │  12:37 qa        │
│  │   └────────────────────────────────────────┘    │    │  ⏳ blocked      │
│  │   FILES: LoginForm.tsx, index.ts               │    │                  │
│  └─────────────────────────────────────────────────┘    │                  │
│                                                          │                  │
│  ┌─────────────────────────────────────────────────┐    │                  │
│  │ ▶ Story 3: Database Schema         [RUNNING]    │    │                  │
│  └─────────────────────────────────────────────────┘    │                  │
│                                                          │                  │
│  ┌─────────────────────────────────────────────────┐    │                  │
│  │ 🔒 Story 4: E2E Tests              [BLOCKED]    │    │                  │
│  └─────────────────────────────────────────────────┘    │                  │
│                                                          │                  │
└──────────────────────────────────────────────────────────┴──────────────────┘
```

**Pros:**
- All information visible at once
- Coordination feed always visible
- Easy to expand/collapse story terminals

### Option B: Tab-Based View (Mobile/Narrow Screens)

```
┌─────────────────────────────────────────┐
│           WORKFLOW HEADER               │
├─────────────────────────────────────────┤
│ [Stories] [Graph] [Feed] [Commands]     │
├─────────────────────────────────────────┤
│                                         │
│  Stories tab content...                 │
│                                         │
└─────────────────────────────────────────┘
```

### Option C: Grid View (Many Stories)

For PRDs with 6+ stories, use a card grid instead of lanes.

```
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│ Story 1 ✅    │ │ Story 2 ▶️    │ │ Story 3 ▶️    │
│ Backend       │ │ Frontend      │ │ Database      │
│ 2m 34s $0.12  │ │ 1m 02s $0.04  │ │ 0m 45s $0.02  │
│ [View Logs]   │ │ [View Logs]   │ │ [View Logs]   │
└───────────────┘ └───────────────┘ └───────────────┘
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│ Story 4 🔒    │ │ Story 5 ⏳    │ │ Story 6 ⏳    │
│ QA            │ │ Security      │ │ Docs          │
│ Blocked       │ │ Queued        │ │ Queued        │
│ Deps: 1, 2    │ │ Deps: 1-5     │ │ Deps: 1-5     │
└───────────────┘ └───────────────┘ └───────────────┘
```

## Terminal Streaming Architecture

### Data Flow

```
Worker Container                     API                        Frontend
      │                               │                             │
      │  POST /api/tasks/:id/logs     │                             │
      ├──────────────────────────────►│                             │
      │  { message, type, severity }  │                             │
      │                               │                             │
      │                               │  INSERT worker_task_logs    │
      │                               │                             │
      │                               │  GET /control-center/       │
      │                               │      logs/:id/stream (SSE)  │
      │                               │◄────────────────────────────┤
      │                               │                             │
      │                               │  event: log                 │
      │                               │  data: { logs: [...] }      │
      │                               ├────────────────────────────►│
      │                               │                             │
      │  POST /api/coordination/      │                             │
      │        context                │                             │
      ├──────────────────────────────►│                             │
      │  { type, message, metadata }  │                             │
      │                               │                             │
      │                               │  GET /coordination/         │
      │                               │      context/:parentId/     │
      │                               │      stream (SSE)           │
      │                               │◄────────────────────────────┤
      │                               │                             │
      │                               │  event: context             │
      │                               │  data: { messages: [...] }  │
      │                               ├────────────────────────────►│
```

### Frontend Subscriptions

For a PRD workflow with 3 running stories, the frontend maintains:

| Subscription | Endpoint | Purpose |
|--------------|----------|---------|
| Story 1 logs | `GET /logs/task-1-id/stream` | Terminal output |
| Story 2 logs | `GET /logs/task-2-id/stream` | Terminal output |
| Story 3 logs | `GET /logs/task-3-id/stream` | Terminal output |
| Coordination | `GET /context/parent-id/stream` | Inter-worker messages |

### Performance Considerations

1. **Lazy Terminal Loading** - Only subscribe to log streams for expanded stories
2. **Virtualized Log Display** - Only render visible log lines (react-window)
3. **Debounced Updates** - Batch UI updates every 100ms to prevent thrashing
4. **Connection Pooling** - Reuse SSE connections where possible
5. **Automatic Cleanup** - Unsubscribe when story completes or user collapses panel

## State Management

### Zustand Store Structure

```typescript
interface OrchestrationStore {
  // Workflow state
  parentTask: ParentTask | null;
  childTasks: Map<string, ChildTask>;

  // UI state
  expandedStories: Set<string>;
  activeTab: 'stories' | 'graph' | 'feed';

  // Coordination
  contextMessages: ContextMessage[];

  // Actions
  expandStory: (taskId: string) => void;
  collapseStory: (taskId: string) => void;
  pauseWorker: (taskId: string) => void;
  cancelWorker: (taskId: string) => void;
  sendCommand: (taskId: string, command: WorkerCommand) => void;
}

interface ChildTask {
  id: string;
  storyIndex: number;
  storyTitle: string;
  persona: string;
  status: TaskStatus;
  dependencies: number[];
  logs: LogEntry[];
  modifiedFiles: string[];
  currentActivity: string;
  duration: number;
  cost: number;
}
```

## API Endpoints Required

### New Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/tasks/:parentId/children` | Get all child tasks for a PRD |
| GET | `/api/tasks/:parentId/status` | Aggregate workflow status |
| POST | `/api/tasks/:taskId/commands` | Send command to worker |
| GET | `/api/tasks/:taskId/commands/pending` | Check for pending commands |

### Existing Endpoints (Reused)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/control-center/logs/:taskId/stream` | Log streaming (SSE) |
| GET | `/api/coordination/context/:parentId/stream` | Context streaming (SSE) |
| POST | `/api/coordination/context` | Post context message |

## Component Hierarchy

```
<OrchestrationView>
  <WorkflowHeader parentTask={task} />

  <SplitPane>
    <StoryLanes>
      {stories.map(story => (
        <StoryLane
          key={story.id}
          story={story}
          expanded={expandedStories.has(story.id)}
        >
          {expanded && (
            <WorkerTerminal
              taskId={story.id}
              onFileChange={...}
            />
          )}
        </StoryLane>
      ))}
    </StoryLanes>

    <CoordinationFeed
      parentTaskId={parentTask.id}
      messages={contextMessages}
    />
  </SplitPane>

  {interventionNeeded && (
    <InterventionModal
      worker={blockedWorker}
      onSendAnswer={...}
      onPause={...}
    />
  )}
</OrchestrationView>
```

## Responsive Breakpoints

| Breakpoint | Layout |
|------------|--------|
| Desktop (≥1280px) | Split view with coordination sidebar |
| Tablet (768-1279px) | Stacked view, collapsible feed |
| Mobile (<768px) | Tab-based navigation |

## Accessibility

- Keyboard navigation for story expansion/collapse
- ARIA live regions for log updates
- Screen reader announcements for status changes
- High contrast mode support
- Focus management when modals appear

## Future Enhancements

1. **Story Timeline** - Visual timeline showing when each story started/ended
2. **Cost Breakdown** - Per-story cost visualization
3. **Replay Mode** - Play back completed workflow execution
4. **Comparison View** - Compare parallel branches side-by-side
5. **AI Summary** - LLM-generated summary of workflow progress
6. **Notifications** - Browser notifications for blockers/completions
7. **Sharing** - Shareable workflow status links

## Implementation Priority

### Phase 1: Core Visualization
- [ ] WorkflowHeader component
- [ ] StoryLane component with expand/collapse
- [ ] WorkerTerminal with log streaming
- [ ] Basic status indicators

### Phase 2: Coordination Features
- [ ] CoordinationFeed component
- [ ] Context message SSE subscription
- [ ] File change tracking display

### Phase 3: Human Intervention
- [ ] InterventionModal component
- [ ] Worker command API integration
- [ ] Blocker detection and alerting

### Phase 4: Advanced Features
- [ ] Dependency graph visualization
- [ ] Grid view for many stories
- [ ] Mobile responsive layout

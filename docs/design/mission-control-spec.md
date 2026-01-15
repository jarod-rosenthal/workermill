# Mission Control Dashboard — Design Specification

**Version:** 1.0
**Author:** Principal Product Designer + Staff Frontend Engineer
**Date:** January 2026
**Status:** Design Phase

---

## Table of Contents

1. [User Feedback & Research](#1-user-feedback--research)
2. [Mission Control Layout](#2-mission-control-layout)
3. [Information Architecture](#3-information-architecture)
4. [Visual Design System](#4-visual-design-system)
5. [Technical Implementation Plan](#5-technical-implementation-plan)
6. [The "Wow" Demo Script](#6-the-wow-demo-script)

---

## 1. User Feedback & Research

### 1.1 User Personas

#### Persona A: The Platform Engineer ("Maya")
- **Role:** Senior Platform Engineer at a Series B startup
- **Context:** Manages 40-60 AI workers across 3 microservices
- **Key Metrics:** Worker throughput, cost-per-task, queue latency
- **Pain Points:** Can't see "the forest for the trees" in list views
- **Goal:** "Show me everything that matters in one glance without scrolling"

#### Persona B: The Security Lead ("Chen")
- **Role:** Principal Security Engineer at a fintech company
- **Context:** Audits all AI-generated code for compliance, monitors blocked commands
- **Key Metrics:** Blocked command frequency, security escalations, audit trails
- **Pain Points:** Has to dig through logs to find security events
- **Goal:** "I need to see every guardrail trip instantly—before it becomes an incident"

#### Persona C: The Engineering Manager ("Priya")
- **Role:** VP of Engineering managing 3 teams adopting WorkerMill
- **Context:** Tracks Jira-to-PR velocity, approval queues, cost attribution
- **Key Metrics:** Cycle time, approval latency, ROI per persona
- **Pain Points:** Context-switching between Jira, GitHub, and WorkerMill
- **Goal:** "I want to approve PRs and see progress without leaving one screen"

---

### 1.2 User Interview Transcripts

#### Interview #1: Maya (Platform Engineer)
**Date:** January 10, 2026 | **Duration:** 45 minutes

**Interviewer:** Walk me through how you use the current dashboard on a typical day.

**Maya:** So I usually have it open on my secondary monitor. I check it probably... 20 times a day? The main thing I'm looking for is "are my workers healthy?" and "how much am I spending?" The problem is, I have to scroll. A lot. When I have 12 active workers, I can only see maybe 4 at a time. So I'm constantly scrolling up and down trying to find the one that's been running too long.

**Interviewer:** What would you change if you could?

**Maya:** God, so many things. First, I want a **tile view**. Like htop, you know? Small boxes, one per worker. I should be able to see all 12 at once. Second, the terminal logs are great but they take up too much space. I don't need to see 30 lines—I need to see the *last 3 lines* and know it's still moving. Third—and this is big—I need **persona filtering**. When there's a backend incident, I don't care about the frontend workers. Let me hide them.

**Interviewer:** You mentioned cost. How do you track that today?

**Maya:** It's in the stats bar, which is fine. But what I really want is a **cost sparkline per worker**. Is this task burning money faster than expected? That's the signal I need. Oh, and the queue. I need to see queue depth at a glance. Like a threat level indicator. Green means I'm ahead, red means we're drowning.

**Interviewer:** Anything else?

**Maya:** A kill switch. A big, obvious, physical-feeling button that says "stop everything." Not buried in a menu. Right there. For when things go sideways.

---

#### Interview #2: Chen (Security Lead)
**Date:** January 11, 2026 | **Duration:** 50 minutes

**Interviewer:** What's your primary use case for WorkerMill?

**Chen:** Audit. I'm responsible for making sure these AI workers don't accidentally `rm -rf /` something or leak credentials. The workers have guardrails, which is good. But when a guardrail fires, I need to know *immediately*. Right now, I have to hunt for it.

**Interviewer:** Can you describe a recent incident?

**Chen:** Two weeks ago, a worker tried to run `curl` with a bearer token in the command line. The guardrail caught it—great. But I didn't find out until 4 hours later when I was reviewing logs. That's unacceptable. I should have gotten a visual alert *the second* it happened.

**Interviewer:** How would you design that alert?

**Chen:** I want a dedicated **"Triage Rail"**—a section of the screen that's always visible, always showing escalations and blocked commands. It should pulse. It should be impossible to ignore. And when I click it, I want to see the exact command that was blocked, the context around it, and a one-click way to either whitelist it or escalate it further.

**Interviewer:** What about filtering by persona?

**Chen:** Essential. Security engineers and DevOps engineers are my high-risk personas. I want to isolate their output instantly. The frontend developer writing CSS? Low concern. The DevOps engineer running `terraform destroy`? I need eyes on that at all times.

**Interviewer:** What's missing from the current terminal view?

**Chen:** Syntax highlighting for dangerous patterns. If a worker outputs something that matches a known bad pattern—an AWS key format, a `sudo` command, a `DROP TABLE`—it should be highlighted in red. Automatically. No clicking required.

---

#### Interview #3: Priya (VP Engineering)
**Date:** January 12, 2026 | **Duration:** 40 minutes

**Interviewer:** You're a manager rather than an individual contributor. How do you use WorkerMill?

**Priya:** I'm in the approval queue, mostly. When the Virtual Manager kicks a PR to me, I need to review it and approve or reject. The current flow works, but it's disjointed. I see the approval request, then I have to open GitHub in another tab, read the diff, come back, click approve. Too many hops.

**Interviewer:** What would be better?

**Priya:** Inline everything. When an approval comes up, I want to see: (1) the Jira ticket summary, (2) the PR diff—right there, embedded, (3) the Virtual Manager's analysis, and (4) approve/reject buttons. One screen. No tab switching.

**Interviewer:** What about tracking team velocity?

**Priya:** That's the other thing. I need macro metrics. What's our Jira-to-PR cycle time this week? How does that compare to last week? Which personas are bottlenecked? I don't need this in real-time—I'd accept a 5-minute lag. But I need it visible, not hidden in an Analytics page.

**Interviewer:** The Virtual Manager—how do you interact with it?

**Chen:** I want to see what it's *thinking*. Right now it's a black box. It approves or escalates, but I don't know why. Show me its reasoning. Even a one-sentence summary: "Approved: PR adds input validation, no security concerns, tests pass." That builds trust.

**Interviewer:** Any frustrations?

**Priya:** Wasted space. The current dashboard has these giant cards with lots of padding. I don't need padding. I need *data*. Every pixel should tell me something. It's an ops tool, not a marketing site.

---

### 1.3 Design Mandates (Derived from Research)

Based on user feedback, the following 5 mandates will govern Mission Control design:

| # | Mandate | Source | Implementation |
|---|---------|--------|----------------|
| **M1** | **Sub-second visual confirmation of worker heartbeats** | Maya | Mini-terminal with live SSE, pulse animation on active tiles |
| **M2** | **Immediate, impossible-to-miss escalation alerts** | Chen | Dedicated "Triage Rail" with pulse animation, red glow on blocked commands |
| **M3** | **Zero context-switching for approvals** | Priya | Inline PR diff, Jira summary, and Virtual Manager reasoning in approval cards |
| **M4** | **Persona-based filtering for instant focus** | All | "Persona Lens" toolbar that filters entire view with one click |
| **M5** | **Maximum data density with zero wasted space** | All | Compact tiles, progressive disclosure, no decorative padding |

---

## 2. Mission Control Layout

### 2.1 Primary Layout (ASCII Wireframe)

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ ██ WORKERMILL MISSION CONTROL                          ⌘K  │🔒│ COMPACT │ ⚙ │ ? │ ✕    │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌─── THE PULSE ─────────────────────────────────────────────────────────────────────┐   │
│ │ ● SYSTEM LIVE    │ $127.42 TODAY │ 7/10 SLOTS │ 4 QUEUED │ ████████░░ 82% │ ⏸ ALL │   │
│ │ ↑ 12% vs avg     │ ↑ $18 (haiku) │ 3 backend  │ 2 urgent │ 24hr success   │ [KILL]│   │
│ └───────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                          │
│ ┌─ PERSONA LENS ────────────────────────────────────────────────────────────────────┐   │
│ │ [ALL] [⚙ Backend ●4] [🎨 Frontend ●2] [🔧 DevOps ●1] [🔒 Security ●0] [🧪 QA ●0] │   │
│ └───────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                          │
│ ┌─ ACTIVE THEATER (7 workers) ──────────────────────────────────────────────────────┐   │
│ │ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐   │   │
│ │ │ ⚙ OCS-401       │ │ ⚙ OCS-402       │ │ 🎨 OCS-398      │ │ 🎨 OCS-399      │   │   │
│ │ │ Backend         │ │ Backend         │ │ Frontend        │ │ Frontend        │   │   │
│ │ │ ░░░░░░░░░░ 2:34 │ │ ████████░░ 4:12 │ │ ██████████ 1:08 │ │ ████░░░░░░ 0:45 │   │   │
│ │ │─────────────────│ │─────────────────│ │─────────────────│ │─────────────────│   │   │
│ │ │ $ npm run build │ │ $ npm test      │ │ $ npm run dev   │ │ $ npm install   │   │   │
│ │ │ > Compiling...  │ │ PASS auth.test  │ │ Ready on :3000  │ │ added 847 pkgs  │   │   │
│ │ │ > 42/128 files  │ │ PASS user.test  │ │ ✓ Compiled      │ │ $ npm run build │   │   │
│ │ │─────────────────│ │─────────────────│ │─────────────────│ │─────────────────│   │   │
│ │ │ $0.84 │ █▃▁▂▄█  │ │ $2.14 │ ▁▂▃▅▇█  │ │ $0.12 │ ▁▁▁▁▂▃  │ │ $0.08 │ ▁▁▂▃▄▅  │   │   │
│ │ │ ● Safe  │ ⏸ │ ✕ │ │ ● Safe  │ ⏸ │ ✕ │ │ ● Safe  │ ⏸ │ ✕ │ │ ● Safe  │ ⏸ │ ✕ │   │   │
│ │ └─────────────────┘ └─────────────────┘ └─────────────────┘ └─────────────────┘   │   │
│ │ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐                       │   │
│ │ │ 🔧 OCS-412      │ │ ⚙ OCS-415       │ │ ⚙ OCS-420       │                       │   │
│ │ │ DevOps          │ │ Backend         │ │ Backend         │                       │   │
│ │ │ ██░░░░░░░░ 0:22 │ │ ░░░░░░░░░░ 0:05 │ │ ██████░░░░ 1:33 │                       │   │
│ │ │─────────────────│ │─────────────────│ │─────────────────│                       │   │
│ │ │ $ terraform pla │ │ $ git clone ... │ │ $ Running migra │                       │   │
│ │ │ Plan: 3 to add  │ │ Cloning into... │ │ Migration #42   │                       │   │
│ │ │ 0 to change     │ │ Receiving obj.. │ │ Done.           │                       │   │
│ │ │─────────────────│ │─────────────────│ │─────────────────│                       │   │
│ │ │ $0.03 │ ▁▁▁▂▃▄  │ │ $0.01 │ ▁▁▁▁▁▁  │ │ $1.22 │ ▂▃▄▅▆▇  │                       │   │
│ │ │ ● Safe  │ ⏸ │ ✕ │ │ ● Safe  │ ⏸ │ ✕ │ │ ● Safe  │ ⏸ │ ✕ │                       │   │
│ │ └─────────────────┘ └─────────────────┘ └─────────────────┘                       │   │
│ └───────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                          │
│ ┌─ TRIAGE RAIL (2 items) ────────────────────┐ ┌─ VIRTUAL MANAGER ───────────────────┐  │
│ │ ┌────────────────────────────────────────┐ │ │ 👔 Manager • Sonnet 4.5 • Reviewing │  │
│ │ │ 🚨 BLOCKED COMMAND                     │ │ │─────────────────────────────────────│  │
│ │ │ OCS-412 (DevOps) attempted:            │ │ │ Currently reviewing: OCS-398        │  │
│ │ │ ┌────────────────────────────────────┐ │ │ │ "Add dark mode toggle to Settings"  │  │
│ │ │ │ $ rm -rf /var/log/*                │ │ │ │─────────────────────────────────────│  │
│ │ │ └────────────────────────────────────┘ │ │ │ Analysis:                           │  │
│ │ │ Guardrail: DESTRUCTIVE_COMMAND         │ │ │ • PR adds theme toggle component    │  │
│ │ │ 14 seconds ago                         │ │ │ • Uses existing ThemeStore          │  │
│ │ │ [ALLOW ONCE] [WHITELIST] [ESCALATE]    │ │ │ • Tests pass (12/12)                │  │
│ │ └────────────────────────────────────────┘ │ │ • No security concerns              │  │
│ │ ┌────────────────────────────────────────┐ │ │ Recommendation: APPROVE             │  │
│ │ │ ⏳ APPROVAL REQUESTED                  │ │ │─────────────────────────────────────│  │
│ │ │ OCS-399 (Frontend) needs review:       │ │ │ ┌─────────────────────────────────┐ │  │
│ │ │ PR #847: "Add loading spinners"        │ │ │ │ Diff Preview (3 files changed)  │ │  │
│ │ │ +142 / -23 lines │ 3 files             │ │ │ │ ────────────────────────────────│ │  │
│ │ │ Manager says: "Looks good, needs a11y" │ │ │ │ M src/components/Spinner.tsx    │ │  │
│ │ │ [VIEW DIFF] [APPROVE] [REQUEST CHANGES]│ │ │ │ M src/pages/Dashboard.tsx       │ │  │
│ │ └────────────────────────────────────────┘ │ │ │ A src/hooks/useLoading.ts       │ │  │
│ └────────────────────────────────────────────┘ │ └─────────────────────────────────┘ │  │
│                                                 │ [APPROVE] [REQUEST CHANGES]         │  │
│                                                 └─────────────────────────────────────┘  │
│                                                                                          │
│ ┌─ QUEUE ────────────┐ ┌─ RECENT (last 5) ───────────────────────────────────────────┐  │
│ │ 4 tasks waiting    │ │ ✓ OCS-395 │ Backend │ Deployed │ 8m │ $1.24 │ PR#842        │  │
│ │ ● OCS-421 backend  │ │ ✓ OCS-394 │ Frontend│ Deployed │ 12m│ $0.89 │ PR#841        │  │
│ │ ● OCS-422 frontend │ │ ✗ OCS-393 │ DevOps  │ Failed   │ 5m │ $0.34 │ Exit 1        │  │
│ │ ● OCS-423 security │ │ ✓ OCS-392 │ Backend │ Deployed │ 22m│ $2.11 │ PR#840        │  │
│ │ ● OCS-424 qa       │ │ ✓ OCS-391 │ QA      │ Deployed │ 31m│ $0.56 │ PR#839        │  │
│ └────────────────────┘ └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Component Breakdown

#### THE PULSE (Header Bar)
A fixed 64px header that never scrolls. Contains:
- **System Status**: Live indicator with pulse animation
- **Today's Spend**: Running total with delta vs average
- **Slot Utilization**: X/Y active slots with breakdown
- **Queue Depth**: Count with urgency indicator
- **24hr Success Rate**: Percentage with mini bar
- **Global Controls**: Pause All, Kill Switch (requires confirmation)

#### PERSONA LENS (Filter Bar)
A horizontal filter bar with toggle buttons:
- Each button shows persona emoji + name + active count
- Active personas have a green dot indicator
- "ALL" shows unfiltered view
- Multiple selection allowed (e.g., "Backend + DevOps only")
- Keyboard shortcuts: Alt+1 through Alt+7

#### ACTIVE THEATER (Worker Tiles)
A CSS Grid of worker tiles, 4 columns on desktop:
- **Tile Header**: Persona emoji, Jira key, persona name
- **Progress Bar**: Visual timeline with elapsed time
- **Mini Terminal**: Last 3 lines of terminal output (monospace)
- **Cost Sparkline**: 10-point cost history graph
- **Safety Status**: Green "Safe" or red "BLOCKED" indicator
- **Controls**: Pause, Cancel buttons

#### TRIAGE RAIL (Escalation Panel)
A dedicated panel for items requiring human attention:
- **Blocked Commands**: Red border, command preview, guardrail name
- **Approval Requests**: PR summary, diff stats, manager analysis
- Priority sorting (blocked commands first)
- Action buttons inline (no modal required)

#### VIRTUAL MANAGER (AI Analysis Panel)
Shows what the AI manager is currently processing:
- Current task being reviewed
- Analysis summary (bullet points)
- Recommendation (APPROVE/CHANGES/ESCALATE)
- Inline diff preview (collapsed by default)
- Approval buttons

#### QUEUE (Waiting Tasks)
Compact list of queued tasks:
- Jira key + persona
- Priority indicator
- Drag-to-reorder (optional)

#### RECENT (Completed Tasks)
Horizontal scrolling list of last N completed tasks:
- Status icon (✓/✗)
- Jira key, persona, final status
- Duration, cost, PR link

---

### 2.3 Expanded Tile View (On Click)

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ ⚙ OCS-401 │ Backend Developer │ claude-sonnet-4.5 │ Running 4:12        [MINIMIZE] [✕] │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌─ JIRA CONTEXT ────────────────────────────────────────────────────────────────────┐   │
│ │ Add rate limiting to POST /api/users endpoint                                      │   │
│ │ Labels: [security] [backend] [workermill]                                          │   │
│ │ Acceptance: Given 100 requests/min, when limit exceeded, return 429               │   │
│ └───────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                          │
│ ┌─ TERMINAL ────────────────────────────────────────────────────────────────────────┐   │
│ │ $ cd /workspace/oncallshift                                                        │   │
│ │ $ git checkout -b feature/OCS-401-rate-limiting                                   │   │
│ │ Switched to a new branch 'feature/OCS-401-rate-limiting'                          │   │
│ │ $ npm install express-rate-limit                                                   │   │
│ │ added 1 package in 2.341s                                                          │   │
│ │ $ vim src/routes/users.ts                                                          │   │
│ │ [Editing file...]                                                                  │   │
│ │ ::checkpoint::editing_code                                                         │   │
│ │ $ npm run build                                                                    │   │
│ │ > oncallshift@1.0.0 build                                                          │   │
│ │ > tsc                                                                              │   │
│ │ Compilation successful                                                             │   │
│ │ $ npm test -- --grep "rate limit"                                                  │   │
│ │ PASS src/routes/users.test.ts                                                      │   │
│ │   ✓ should return 429 when rate limit exceeded (42ms)                             │   │
│ │   ✓ should allow requests under limit (12ms)                                       │   │
│ │ ■                                                                                  │   │
│ └───────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                          │
│ ┌─ METRICS ─────────────────────┐ ┌─ FILE LOCKS ────────────────────────────────────┐   │
│ │ Cost: $2.14      ↑ $0.12/min  │ │ src/routes/users.ts      LOCKED (self)          │   │
│ │ Tokens: 142,847  in / 23,441 o│ │ src/middleware/rateLim.. LOCKED (self)          │   │
│ │ Duration: 4:12                │ │ src/routes/users.test.ts LOCKED (self)          │   │
│ │ Retries: 0/3                  │ └─────────────────────────────────────────────────┘   │
│ │ Checkpoint: editing_code      │                                                        │
│ │ S3: s3://checkpoints/OCS-401  │                                                        │
│ └───────────────────────────────┘                                                        │
│                                                                                          │
│ [PAUSE]  [CANCEL]  [VIEW PR]  [VIEW S3 CHECKPOINT]  [COPY LOGS]                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### 2.4 Compact vs Expanded Mode

**Compact Mode** (Default for 10+ workers):
- 3 terminal lines per tile
- No sparkline (just current cost)
- Smaller tile size (180px height)
- 6 columns on wide screens

**Expanded Mode** (Default for <10 workers):
- 5 terminal lines per tile
- Full sparkline visualization
- Larger tile size (240px height)
- 4 columns on wide screens

Toggle in header: `[COMPACT] [EXPANDED]`

---

## 3. Information Architecture

### 3.1 Progressive Disclosure Strategy

| Level | What's Shown | Interaction |
|-------|--------------|-------------|
| **L0: Pulse** | System health, cost, slots | Always visible header |
| **L1: Tiles** | Task ID, progress, 3 log lines, cost | Default view |
| **L2: Expanded Tile** | Full terminal, metrics, file locks | Click tile |
| **L3: Detail Panel** | Jira ticket, PR diff, S3 checkpoint | Slide-over panel |
| **L4: External** | GitHub PR, Jira issue, CloudWatch | Opens in new tab |

### 3.2 Command Palette Specification

**Trigger:** `Cmd+K` (Mac) / `Ctrl+K` (Windows)

```
┌─────────────────────────────────────────────────────────────────┐
│ ⌘K                                                         [×] │
├─────────────────────────────────────────────────────────────────┤
│ > _                                                             │
├─────────────────────────────────────────────────────────────────┤
│ QUICK ACTIONS                                                   │
│ ├─ pause all                    Pause all active workers        │
│ ├─ pause backend                Pause all backend workers       │
│ ├─ resume all                   Resume all paused workers       │
│ ├─ kill all                     Emergency stop all workers      │
│ ├─ filter security              Show only security workers      │
│ ├─ filter devops backend        Show DevOps + Backend only      │
│ ├─ clear filters                Show all personas               │
│                                                                 │
│ JUMP TO TASK                                                    │
│ ├─ go OCS-401                   Jump to task OCS-401            │
│ ├─ go PR 847                    Open PR #847 in GitHub          │
│                                                                 │
│ VIEW                                                            │
│ ├─ toggle compact               Switch to compact view          │
│ ├─ toggle triage                Show/hide triage rail           │
│ ├─ toggle manager               Show/hide virtual manager       │
│                                                                 │
│ SYSTEM                                                          │
│ ├─ orchestrator start           Start the orchestrator          │
│ ├─ orchestrator stop            Stop the orchestrator           │
│ ├─ watcher on                   Enable Jira watcher             │
│ ├─ watcher off                  Disable Jira watcher            │
└─────────────────────────────────────────────────────────────────┘
```

**Keyboard Shortcuts (Global):**
| Shortcut | Action |
|----------|--------|
| `Cmd+K` | Open command palette |
| `Esc` | Close expanded tile/panel |
| `Alt+1-7` | Filter by persona |
| `Alt+0` | Clear all filters |
| `Space` | Pause/resume focused tile |
| `D` | Toggle density (compact/expanded) |
| `T` | Toggle triage rail |
| `M` | Toggle manager panel |

### 3.3 Data-Per-Square-Inch Analysis

**Target:** Every visible element must map to real data:

| Element | Data Source | Update Frequency |
|---------|-------------|------------------|
| System Status | `GET /api/orchestrator/status` | 5s polling |
| Today's Spend | `SUM(estimatedCostUsd)` from tasks | Real-time SSE |
| Slot Count | Active ECS task count | Real-time SSE |
| Queue Depth | `queuedTasks.length` | Real-time SSE |
| Success Rate | `completed / (completed + failed)` | 1m calc |
| Tile Terminal | `/api/control-center/logs/:id/stream` | SSE |
| Cost Sparkline | Last 10 cost snapshots (10s intervals) | SSE |
| File Locks | `GET /api/coordination/locks` | 30s polling |
| Checkpoint Stage | Task `checkpointStage` field | Real-time SSE |

---

## 4. Visual Design System

### 4.1 "Dark Ops" Theme

**Philosophy:** A command center for operators, not a consumer app. Dense, high-contrast, no decorative elements.

#### Color Palette

```css
:root[data-theme="dark-ops"] {
  /* Backgrounds */
  --bg-void: #06060a;          /* Deepest black - page background */
  --bg-surface: #0c0c12;       /* Panel backgrounds */
  --bg-elevated: #12121a;      /* Cards, tiles */
  --bg-hover: #1a1a24;         /* Hover states */

  /* Borders */
  --border-subtle: #1e1e2a;    /* Quiet borders */
  --border-default: #2a2a3a;   /* Standard borders */
  --border-focus: #3a3a4a;     /* Focus rings */

  /* Text */
  --text-primary: #f0f0f5;     /* Primary text */
  --text-secondary: #a0a0b0;   /* Secondary text */
  --text-muted: #606070;       /* Disabled/muted */

  /* Status Colors - Neon Accents */
  --status-live: #00ff88;      /* System live, success */
  --status-active: #00d4ff;    /* Active/running */
  --status-warning: #ffaa00;   /* Warnings, escalations */
  --status-danger: #ff3366;    /* Errors, blocked commands */
  --status-info: #8888ff;      /* Informational */

  /* Cost Gradient */
  --cost-low: #00ff88;         /* Under budget */
  --cost-medium: #ffaa00;      /* Approaching budget */
  --cost-high: #ff3366;        /* Over budget */

  /* Terminal */
  --terminal-bg: #000000;
  --terminal-text: #00ff88;
  --terminal-prompt: #00d4ff;
  --terminal-error: #ff3366;
}
```

#### Typography

```css
/* Monospace for data */
--font-mono: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;

/* Sans for UI */
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;

/* Sizes */
--text-xs: 0.6875rem;   /* 11px - Micro labels */
--text-sm: 0.75rem;     /* 12px - Secondary text */
--text-base: 0.875rem;  /* 14px - Body text */
--text-lg: 1rem;        /* 16px - Headers */
```

### 4.2 Status Language

| Status | Color | Icon | Glow Effect |
|--------|-------|------|-------------|
| **Live** | `#00ff88` | ● (filled circle) | `0 0 8px #00ff88` |
| **Executing** | `#00d4ff` | ◉ (spinning) | `0 0 8px #00d4ff` |
| **Queued** | `#606070` | ○ (empty circle) | None |
| **Escalated** | `#ffaa00` | ⚠ (warning) | `0 0 12px #ffaa00` pulse |
| **Blocked** | `#ff3366` | ⛔ (stop) | `0 0 16px #ff3366` pulse |
| **Approved** | `#00ff88` | ✓ (check) | `0 0 8px #00ff88` |
| **Failed** | `#ff3366` | ✗ (x) | None |
| **Deployed** | `#8888ff` | 🚀 (rocket) | `0 0 8px #8888ff` |

### 4.3 Component Inventory

#### WorkerTile Component

```tsx
interface WorkerTileProps {
  taskId: string;
  jiraKey: string;
  persona: WorkerPersona;
  status: TaskStatus;
  elapsedSeconds: number;
  terminalLines: string[];  // Last 3-5 lines
  costUsd: number;
  costHistory: number[];    // Sparkline data
  safetyStatus: 'safe' | 'blocked' | 'escalated';
  isExpanded: boolean;
  onExpand: () => void;
  onPause: () => void;
  onCancel: () => void;
}
```

Visual Structure:
```
┌─────────────────────┐
│ [emoji] KEY  persona│  <- 32px header
├─────────────────────┤
│ ████████░░░░  2:34  │  <- 24px progress
├─────────────────────┤
│ $ last command      │
│ output line 1       │  <- 72px terminal (3 lines)
│ output line 2       │
├─────────────────────┤
│ $0.84  ▁▂▃▄▅▆▇█▇▅  │  <- 24px cost + sparkline
├─────────────────────┤
│ ● Safe    [⏸][✕]   │  <- 28px status + controls
└─────────────────────┘
     Total: ~180px
```

#### CostSparkline Component

```tsx
interface CostSparklineProps {
  data: number[];       // 10 data points
  width: number;        // Default 80px
  height: number;       // Default 20px
  colorScale: 'static' | 'velocity';  // Static green or velocity-based
}
```

Renders an SVG mini chart showing cost accumulation velocity. Color shifts from green → yellow → red as burn rate increases.

#### SafetyGate Component

```tsx
interface SafetyGateProps {
  status: 'safe' | 'blocked' | 'escalated';
  blockedCommand?: string;
  guardrailName?: string;
  onAllow: () => void;
  onWhitelist: () => void;
  onEscalate: () => void;
}
```

When blocked, renders with:
- Red pulsing border
- Command preview in monospace
- Guardrail name badge
- Action buttons

#### TriageCard Component

```tsx
interface TriageCardProps {
  type: 'blocked_command' | 'approval_request' | 'manager_escalation';
  taskId: string;
  jiraKey: string;
  title: string;
  detail: string;
  timestamp: Date;
  priority: 'critical' | 'high' | 'normal';
  actions: TriageAction[];
}
```

---

## 5. Technical Implementation Plan

### 5.1 State Management (Zustand)

```typescript
// stores/mission-control-store.ts

interface MissionControlState {
  // View State
  viewMode: 'compact' | 'expanded';
  activeFilters: WorkerPersona[];
  expandedTileId: string | null;
  commandPaletteOpen: boolean;
  triageRailVisible: boolean;
  managerPanelVisible: boolean;

  // Data State
  systemStatus: SystemStatus;
  activeTasks: Map<string, ActiveTask>;      // Map for O(1) updates
  queuedTasks: ActiveTask[];
  recentCompleted: CompletedTask[];
  triageItems: TriageItem[];
  managerAnalysis: ManagerAnalysis | null;

  // SSE Connection State
  taskStreams: Map<string, EventSource>;     // Per-task streams
  streamCursors: Map<string, number>;        // Resume cursors

  // Cost Tracking
  costSnapshots: Map<string, number[]>;      // Per-task sparkline data

  // Actions
  setViewMode: (mode: 'compact' | 'expanded') => void;
  toggleFilter: (persona: WorkerPersona) => void;
  expandTile: (taskId: string) => void;
  collapseTile: () => void;
  updateTask: (taskId: string, update: Partial<ActiveTask>) => void;
  appendTaskLogs: (taskId: string, logs: string[]) => void;
  recordCostSnapshot: (taskId: string, cost: number) => void;
  connectTaskStream: (taskId: string) => void;
  disconnectTaskStream: (taskId: string) => void;
}

export const useMissionControlStore = create<MissionControlState>()(
  subscribeWithSelector((set, get) => ({
    // ... implementation
  }))
);
```

**Key Design Decisions:**

1. **Map vs Array for Active Tasks**: Using `Map<string, ActiveTask>` enables O(1) updates when SSE events arrive, avoiding full array re-renders.

2. **Selector-Based Subscriptions**: Using `subscribeWithSelector` middleware to enable granular re-renders. Each tile only re-renders when its specific data changes.

3. **Separate Cost Snapshot State**: Sparkline data is stored separately and updated on a 10-second interval, not on every SSE event. This prevents sparkline jitter.

### 5.2 SSE Stream Management

```typescript
// hooks/useMissionControlStreams.ts

const MAX_LOG_LINES = 100;        // Per task (reduced for tile view)
const COST_SNAPSHOT_INTERVAL = 10_000;  // 10 seconds
const DEDUP_SET_MAX_SIZE = 500;

export function useMissionControlStreams() {
  const store = useMissionControlStore();
  const seenEventsRef = useRef<Map<string, Set<string>>>(new Map());

  // Main control center stream
  useEffect(() => {
    const es = new EventSource('/api/control-center/stream');

    es.addEventListener('update', (e) => {
      const data = JSON.parse(e.data);
      // Batch update all tasks at once
      set(state => ({
        activeTasks: new Map(data.activeTasks.map(t => [t.id, t])),
        queuedTasks: data.queuedTasks,
        systemStatus: data.systemStatus,
      }));
    });

    return () => es.close();
  }, []);

  // Per-task log streams (only for visible expanded tiles)
  useEffect(() => {
    const expandedId = store.expandedTileId;
    if (!expandedId) return;

    const cursor = store.streamCursors.get(expandedId) || 0;
    const es = new EventSource(
      `/api/control-center/logs/${expandedId}/stream?cursor=${cursor}`
    );

    es.addEventListener('log', (e) => {
      // Dedup
      const seen = seenEventsRef.current.get(expandedId) || new Set();
      if (seen.has(e.lastEventId)) return;
      seen.add(e.lastEventId);
      if (seen.size > DEDUP_SET_MAX_SIZE) {
        // Trim oldest
        const arr = Array.from(seen);
        seenEventsRef.current.set(expandedId, new Set(arr.slice(-250)));
      }

      const data = JSON.parse(e.data);
      store.appendTaskLogs(expandedId, data.lines);
    });

    store.setTaskStream(expandedId, es);
    return () => {
      es.close();
      store.setTaskStream(expandedId, null);
    };
  }, [store.expandedTileId]);

  // Cost snapshot interval
  useEffect(() => {
    const interval = setInterval(() => {
      store.activeTasks.forEach((task, id) => {
        store.recordCostSnapshot(id, task.estimatedCostUsd);
      });
    }, COST_SNAPSHOT_INTERVAL);

    return () => clearInterval(interval);
  }, []);
}
```

### 5.3 Performance Optimizations

#### 5.3.1 Terminal Virtualization

For the mini-terminals in tiles (showing 3-5 lines), no virtualization needed. But for the expanded tile's full terminal (100+ lines), use `@tanstack/react-virtual`:

```typescript
// components/VirtualizedTerminal.tsx

export function VirtualizedTerminal({ lines }: { lines: string[] }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20,  // Line height
    overscan: 5,
  });

  // Auto-scroll to bottom on new lines
  useEffect(() => {
    virtualizer.scrollToIndex(lines.length - 1);
  }, [lines.length]);

  return (
    <div ref={parentRef} className="h-64 overflow-auto font-mono text-sm">
      <div style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(vRow => (
          <div
            key={vRow.key}
            style={{
              position: 'absolute',
              top: vRow.start,
              height: vRow.size,
            }}
          >
            {lines[vRow.index]}
          </div>
        ))}
      </div>
    </div>
  );
}
```

#### 5.3.2 Tile Rendering Optimization

Use React.memo with custom comparison to prevent unnecessary tile re-renders:

```typescript
const WorkerTile = React.memo(function WorkerTile(props: WorkerTileProps) {
  // ... render
}, (prev, next) => {
  // Only re-render if relevant data changed
  return (
    prev.status === next.status &&
    prev.elapsedSeconds === next.elapsedSeconds &&
    prev.costUsd === next.costUsd &&
    prev.safetyStatus === next.safetyStatus &&
    arraysEqual(prev.terminalLines, next.terminalLines)
  );
});
```

#### 5.3.3 SSE Batching

When 10+ workers are active, batch terminal updates to reduce render cycles:

```typescript
// Batch updates every 100ms instead of on every event
const pendingUpdates = useRef<Map<string, string[]>>(new Map());
const flushInterval = useRef<number>();

useEffect(() => {
  flushInterval.current = window.setInterval(() => {
    if (pendingUpdates.current.size > 0) {
      const updates = new Map(pendingUpdates.current);
      pendingUpdates.current.clear();

      updates.forEach((lines, taskId) => {
        store.appendTaskLogs(taskId, lines);
      });
    }
  }, 100);

  return () => clearInterval(flushInterval.current);
}, []);
```

### 5.4 Navigation Strategy

**Routes:**
- `/dashboard` - Classic view (existing)
- `/mission-control` - New Mission Control view
- `/mission-control/:taskId` - Deep link to expanded task

**Link Between Views:**

```tsx
// In classic Dashboard header
<Link to="/mission-control" className="text-sm text-cyan-400 hover:text-cyan-300">
  → Mission Control (Beta)
</Link>

// In Mission Control header
<Link to="/dashboard" className="text-sm text-gray-400 hover:text-gray-300">
  ← Classic View
</Link>
```

**Shared State:**
Both views read from the same SSE streams. The `useMissionControlStore` can be shared, with the classic view using only the data fields it needs.

---

## 6. The "Wow" Demo Script

### Scenario: High-Priority Security Ticket Response

**Duration:** 2 minutes
**Setup:** Mission Control open on a secondary monitor, 5 workers already active

---

**[0:00 - 0:15] THE CALM BEFORE THE STORM**

*Narrator:* "It's Tuesday afternoon. Your team has 5 workers running routine tasks—backend migrations, frontend tweaks. Everything's green."

*Screen:* Mission Control showing 5 tiles, all with green "Safe" indicators. The Pulse shows "SYSTEM LIVE" with a gentle glow. Total spend: $4.23 today.

---

**[0:15 - 0:30] THE ALERT**

*Narrator:* "Then, a critical security ticket lands in Jira. OCS-500: 'Patch CVE-2026-1234 in authentication middleware.' Priority: Critical. The workermill label is applied."

*Screen:* The Queue section pulses briefly as OCS-500 appears. It has a red border indicating critical priority. The Persona Lens shows "🔒 Security ●0" flip to "🔒 Security ●1" as the orchestrator claims it.

---

**[0:30 - 0:50] SECURITY PERSONA SPINS UP**

*Narrator:* "Within seconds, a Security Engineer persona spins up. Watch—you can see it cloning the repo, checking out a branch, and analyzing the vulnerability."

*Screen:* A new tile appears with the 🔒 emoji. Its progress bar starts filling. The mini-terminal shows:
```
$ git clone oncallshift...
$ git checkout -b security/OCS-500-cve-patch
$ scanning dependencies for CVE-2026-1234...
```

The Pulse updates: "6/10 SLOTS" and cost ticks up in real-time.

---

**[0:50 - 1:10] THE BLOCKED COMMAND**

*Narrator:* "The worker attempts to run a potentially dangerous command—a curl with inline credentials for testing. But our guardrails catch it instantly."

*Screen:* The OCS-500 tile flashes red. Its status changes from "● Safe" to "⛔ BLOCKED" with a pulsing glow. The Triage Rail immediately shows a new card:

```
🚨 BLOCKED COMMAND
OCS-500 (Security) attempted:
┌──────────────────────────────────────────┐
│ $ curl -H "Authorization: Bearer sk-..." │
└──────────────────────────────────────────┘
Guardrail: CREDENTIAL_IN_COMMAND
[ALLOW ONCE] [WHITELIST] [ESCALATE]
```

---

**[1:10 - 1:25] HUMAN IN THE LOOP**

*Narrator:* "As the Security Lead, you review the command. It's a test against a staging endpoint—safe to allow once. One click, and the worker continues."

*Action:* Click "ALLOW ONCE" button.

*Screen:* The Triage card disappears. The OCS-500 tile returns to "● Safe" status. The terminal continues:
```
$ curl -H "Authorization: Bearer sk-..."... OK
$ npm run test:security
PASS authentication.test.ts
$ git commit -m "Patch CVE-2026-1234"
$ gh pr create --title "Security: Patch CVE-2026-1234"
::pr_url::https://github.com/oncallshift/pr/912
```

---

**[1:25 - 1:45] VIRTUAL MANAGER REVIEW**

*Narrator:* "The PR is created. Now the Virtual Manager reviews it automatically. Watch the Manager panel."

*Screen:* The Virtual Manager panel shows:
```
👔 Manager • Sonnet 4.5 • Reviewing
─────────────────────────────────────
Currently reviewing: OCS-500
"Patch CVE-2026-1234 in auth middleware"
─────────────────────────────────────
Analysis:
• PR patches known vulnerability
• Updates jsonwebtoken to 9.0.1
• Security tests pass (3/3)
• No new dependencies added
Recommendation: APPROVE

[Diff Preview: +12 / -4 lines]
─────────────────────────────────────
[APPROVE] [REQUEST CHANGES]
```

---

**[1:45 - 2:00] APPROVAL AND DEPLOY**

*Narrator:* "The analysis looks good. You approve with one click. The worker auto-merges and deploys. Total time from Jira ticket to production: under 4 minutes."

*Action:* Click "APPROVE" button.

*Screen:* The OCS-500 tile shows a brief "Merging..." animation, then status changes to "🚀 Deployed" with a purple glow. The tile moves to the Recent section:

```
✓ OCS-500 │ Security │ Deployed │ 3:47 │ $1.82 │ PR#912
```

The Pulse updates: "5/10 SLOTS" and total spend: $6.05.

*Final shot:* Zoom out to show all 6 tiles (5 original + OCS-500 now in Recent), all green, the system humming along.

*Narrator:* "That's Mission Control. Total situational awareness. Every worker. Every command. Every approval. One screen."

---

## Appendix A: File Structure

```
frontend/src/
├── pages/
│   └── MissionControl/
│       ├── index.tsx              # Main page component
│       ├── MissionControl.tsx     # Layout orchestration
│       ├── components/
│       │   ├── Pulse.tsx          # Header stats bar
│       │   ├── PersonaLens.tsx    # Filter toolbar
│       │   ├── ActiveTheater.tsx  # Worker tiles grid
│       │   ├── WorkerTile.tsx     # Individual tile
│       │   ├── TriageRail.tsx     # Escalation panel
│       │   ├── TriageCard.tsx     # Escalation item
│       │   ├── ManagerPanel.tsx   # Virtual Manager
│       │   ├── QueueList.tsx      # Queued tasks
│       │   ├── RecentList.tsx     # Completed tasks
│       │   └── CommandPalette.tsx # Cmd+K interface
│       ├── hooks/
│       │   ├── useMissionControlStreams.ts
│       │   ├── useCommandPalette.ts
│       │   └── useKeyboardShortcuts.ts
│       └── styles/
│           └── dark-ops.css       # Theme variables
├── stores/
│   └── mission-control-store.ts   # Zustand store
└── types/
    └── mission-control.ts         # TypeScript interfaces
```

## Appendix B: API Requirements

No new API endpoints required. Mission Control uses existing endpoints:

- `GET /api/control-center/stream` - Main SSE stream
- `GET /api/control-center/logs/:id/stream` - Task log SSE
- `POST /api/tasks/:id/cancel` - Cancel task
- `POST /api/orchestrator/start|stop` - System control
- `GET /api/coordination/locks` - File lock status

## Appendix C: Migration Path

1. **Phase 1:** Build Mission Control as separate route (`/mission-control`)
2. **Phase 2:** Add toggle in user settings for default dashboard
3. **Phase 3:** Gather feedback, iterate on UX
4. **Phase 4:** Optionally deprecate classic view or keep both

---

*End of Design Specification*

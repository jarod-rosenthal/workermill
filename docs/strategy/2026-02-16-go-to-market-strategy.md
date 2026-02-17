# WorkerMill Go-to-Market Strategy

**Date:** 2026-02-16
**Status:** Draft — Active Discussion

---

## Target Buyer: Solo Developer

A developer who already pays for Claude Max ($100-200/mo). Uses Claude Code or Cursor daily. Has a side project, freelance client, or day job backlog they want to accelerate. Technically sophisticated enough to run a CLI tool.

**What they want to hear:** "You're already paying for Claude. WorkerMill turns that subscription into an AI engineering team that ships tickets while you sleep."

---

## Core Value Propositions (Ranked)

### 1. "Turn Claude Max into an engineering team" (Primary — $0 entry)

You already pay for Claude. Install WorkerMill in 30 seconds. Label a ticket. Review a PR tomorrow. $0 additional cost.

- No new subscription, no credit card, no procurement
- Claude Max is sunk cost — WorkerMill turns it into a team
- The "free" angle eliminates all adoption friction

### 2. "Watch AI experts build your project" (Key Differentiator)

Observable multi-agent collaboration is what separates WorkerMill from every other AI coding tool. The user watches:

- Planning Agent decompose their ticket into stories
- Multiple experts work in parallel (separate git worktrees)
- Experts ask each other questions routed by specialty
- Security engineer flag vulnerabilities proactively
- Tech lead review the PR and request revisions
- Clean PR appear with tests

**Why this matters:**
- Copilot = autocomplete you accept/reject (tool)
- Cursor = chat that suggests changes (assistant)
- Devin = black box that outputs a PR (agent)
- WorkerMill = a team you watch work (experience)

No competitor can show this because no competitor does this. The verb "watch" implies transparency, "experts" implies a team, "your project" implies real code.

### 3. Custom Expert Personas (Retention + Viral Loop)

The built-in 14 personas cover standard engineering. But custom personas are the game-changer:

- User creates `unity_game_dev` or `shopify_expert` or `terraform_aws_specialist`
- Custom expert collaborates with built-in security/QA/devops experts
- Per-persona model routing (cheap model for docs, expensive for security)
- `ExpertPersona` is `string` (not enum) — system is already extensible
- Feels like character creation in an RPG — name, expertise, model, specialties

**The viral moment:** User shares a screenshot of their dashboard showing 5 custom experts collaborating on a feature, coordination feed showing questions asked and answered between experts. That tweet sells itself.

**Persona Studio = App Store for AI Workers** — without anyone having to build apps.

### 4. "Your code never leaves your machine" (Trust)

Workers run as local processes. Code stays local. Only orchestration metadata touches the cloud.

- SOC2/HIPAA/IP-sensitive orgs can use it
- No "send your codebase to a third party" objection
- Local execution + cloud orchestration is architecturally unique

### 5. Human-in-the-Loop Done Right (Talk + Blockers)

You're not babysitting. You're not prompting. You're a manager who gets pinged when there's a real decision:

- **Talk button**: Send messages to running workers mid-execution
- **Blocker escalation**: Worker tried 3 times, classified the error, asks "I'm stuck on auth — here's what I tried, what should I do?"
- **Plan approval**: Review and edit the decomposed plan before execution begins
- **Question routing**: Experts ask domain-specific questions routed to the right specialist

The correct division of labor: AI does the work, human makes the decisions.

---

## The Belief Chain (Discovery → Install)

A solo dev needs to believe these things, in this sequence:

### 1. "This is different from what I already use."

Every dev has Claude/Cursor/Copilot. They've seen AI write code. The first 3 seconds must break the pattern.

**Wrong openers:**
- "AI-powered coding platform" (sounds like everything else)
- "Autonomous AI engineering team" (sounds like Devin marketing)

**Right opener:** Show, don't tell. A 15-second animation of the dashboard showing experts collaborating — planning agent decomposes, experts work in parallel, one asks another a question, security flags an issue, tech lead reviews, PR created.

### 2. "I already have everything I need to try this."

> Already have Claude Max? Install in 30 seconds. Your first task runs free.

```bash
curl -fsSL https://workermill.com/install.sh | bash
```

No credit card. No new subscription. No Docker. No AWS.

### 3. "The collaboration is real, not theater."

Skeptical devs will think multi-expert is a gimmick. Prove the collaboration is structural:

- Experts work in **separate git worktrees** (isolated code, real parallel execution)
- Questions **routed by specialty** (security questions → security expert)
- File conflicts **prevented at scheduler level** (mutex groups, live worktree scanning)
- Critic **rejects bad plans** before code runs (85/100 threshold)
- Tech lead **actually reviews** and requests revisions (up to 3 cycles)

This isn't "we split the prompt." This is a scheduler, conflict resolver, review pipeline, and communication protocol.

### 4. "I can make it mine."

Custom personas are the retention hook. Once a user creates experts with specific directives about their project's architecture and routes them to preferred models — switching costs go up. The team feels like *their* team.

---

## The One-Liner

**Primary:** "Watch AI experts build your project."

**Supporting:** "Custom AI experts collaborate on your tickets — locally, with Claude Max, for $0."

**Alternatives considered:**

| Candidate | Verdict |
|-----------|---------|
| "Autonomous AI engineering team" | What Devin says. Not differentiated. |
| "Ship your backlog overnight" | Good but doesn't explain how it's different |
| "Turn Claude Max into an AI dev team" | Explains value, assumes Claude Max context |
| "Watch AI experts build your project" | **Winner** — differentiates via transparency |
| "Your AI dev team, on your machine" | Good secondary — combines local-first + team |

---

## Landing Page Structure (Single Page)

### Hero
Live dashboard replay (animation, not screenshot) showing expert collaboration in action.

- **Headline:** "Watch AI experts build your project."
- **Sub:** "Custom AI experts collaborate on your tickets. Run locally with Claude Max. $0 to start."
- **CTA:** `curl -fsSL https://workermill.com/install.sh | bash`

### Section 1: "Not another Copilot."
3-column spectrum: Copilot (autocompletes a line) → Cursor (suggests changes in chat) → WorkerMill (a team that ships PRs).

Visual metaphor: tool → assistant → team.

### Section 2: "Build your team."
Persona system showcase:
- Default experts (backend, frontend, security, devops, QA)
- Custom experts (user-defined)
- Per-expert model routing
- Visual: "team roster" with avatars, specialties, model badges

### Section 3: "Watch them work."
The coordination feed — real sequence:
- Question asked → answer given → blocker escalated → user responds → execution continues
- Visual: actual dashboard comms panel with real messages

### Section 4: "Your code, your machine."
Local execution diagram:
- Binary install, Claude Max auth
- Code stays local, orchestration metadata in cloud
- Visual: laptop with dashboard, code stays local

### Section 5: Showcase
One real project built by WorkerMill (TeamBoard or OnCallShift):
- Cost, time, stories, quality scores
- "Build replay" link
- Visual: WORKERMILL.md build log

### CTA (bottom)
```bash
curl -fsSL https://workermill.com/install.sh | bash
```
"Already have Claude Max? Your first task is free."

---

## Conversion Funnel

1. **Discover** — "I use Claude for coding, but I still do all the coordination, planning, PR creation manually"
2. **Try** — Install locally, connect to a repo, label a ticket, watch it execute → $0
3. **Stick** — See plan decomposition, parallel execution, tech lead review, PR with tests → "this is better than prompting myself"
4. **Customize** — Create custom personas, configure model routing → invested in the system
5. **Upgrade** — Hit concurrency limits (1 worker), want cloud execution, want multiple providers → Pro at $14.50/mo
6. **Evangelize** — Share build log / dashboard screenshot from their own project → brings in peers

---

## Competitive Positioning

### vs. Copilot
"Copilot autocompletes. WorkerMill completes tickets. Different category."

### vs. Cursor
"Cursor is a smarter editor. WorkerMill is a team that doesn't need an editor."

### vs. Devin ($500/seat/mo)
"Devin is a black box. WorkerMill is a glass box. And it's free with Claude Max."

### The real competition
The real competition is **doing it yourself with Claude Code**. The value prop isn't "AI writes code" (they already have that). It's **"AI manages the entire workflow"** — planning, decomposition, parallel execution, review, PR creation, deployment. Selling orchestration, not generation.

---

## Strengths Evaluation (Tiered)

### Tier 1: "Why people will pay"
- **Observable multi-expert collaboration** — the killer feature, solves the trust problem
- **Custom personas with collaboration** — retention hook, viral loop, feels like "your team"
- **Talk button + blocker escalation** — human-in-the-loop done right
- **$0 with Claude Max** — eliminates all adoption friction

### Tier 2: "Why people will stay"
- **Planner-Critic quality gate** — plans validated before code runs (85/100 threshold)
- **Real-time log streaming + cost tracking** — engineers love dashboards
- **Per-persona model routing** — cheap model for docs, expensive for security
- **Build logs as artifacts** — WORKERMILL.md shows stories, cost, time, quality

### Tier 3: "Why enterprises will eventually care"
- **Local-first execution** — SOC2/HIPAA/IP compliance
- **Multi-SCM + multi-tracker** — GitHub/GitLab/Bitbucket + Jira/Linear/GitHub Issues
- **Decision service (thin worker)** — update routing/classification server-side, no image rebuild
- **Multi-provider** — Anthropic/OpenAI/Google/Ollama

### Honest Gaps
- **~85% first-run success rate** — good but not magical; blocker escalation mitigates
- **Setup requires Claude CLI** — dependency on Anthropic's install flow
- **No IDE integration** — solo devs live in VS Code; WorkerMill is a separate browser tab
- **No dashboard replay / shareable build logs** — narrative leans on "watch" but no way to share recordings
- **Persona Studio UX** — custom personas work technically but need polished creation flow

---

## Key Technical Architecture (Backing the Narrative)

### Why the collaboration is real (not theater)
- Experts in **separate git worktrees** (real isolation)
- **File-level conflict prevention** at planning time (file cap, overlap resolution) AND execution time (live worktree scanning, mutex groups)
- **3-tier question routing**: explicit target → keyword specialty match → first idle non-ineligible expert
- **Coordination feed** with typed messages (question, answer, decision, blocker, constraint, completion)
- **Live bidirectional comms** via `.workermill-message.md` written into active worktrees

### Why quality is built in
- **Planner-Critic loop**: plan scored 0-100, threshold 85, max 3 iterations
- **Post-processing passes**: file cap, story cap, file overlap resolution — all deterministic
- **Tech lead review**: up to 3 revision cycles per story
- **Decision service**: error classification (80+ regex patterns), quality gates, review parsing — all server-side

### Install path (v0.10.0 + standalone binary)
- **Before (v0.9.0):** Node.js + npm + Docker + AWS credentials + ECR access
- **After:** `curl | bash` + `workermill-agent setup` + Claude Max login
- Same UX as Claude Code itself — no prerequisites beyond what they already have

---

## VS Code Integration — The Agent as Local Backend

### The Problem

Solo devs live in VS Code. WorkerMill is a separate browser tab. That's a context switch — they leave their editor to check on their team, and over time they forget or only use WorkerMill for large tasks worth the switch.

### The Insight

The remote agent already runs on the user's machine as a long-running process. It already:
- Polls the cloud API for tasks
- Spawns and manages worker child processes
- Tracks all active state (processes, task IDs, expert status, logs)
- Has all credentials (Claude OAuth, SCM tokens, org API key)

A VS Code extension needs exactly the same things. **They're the same process.** The extension is just a UI layer on top of the agent.

### Architecture

```
Cloud API (workermill.com)
     ↑ polls/posts
     |
Agent (local process) ←——→ VS Code Extension (local IPC)
     |
     ↓ spawns
Worker processes (child procs)
```

The agent gets a small local API server. The VS Code extension connects to it. Three frontends for one system:

```
┌──────────────────────────────────────────────────────┐
│               Agent (local process)                  │
│  - Polls cloud API for tasks                         │
│  - Spawns/manages worker child processes             │
│  - Serves local API on unix socket / localhost port  │
│  - Buffers state for all connected clients           │
├──────────┬───────────────────┬───────────────────────┤
│          │                   │                       │
│  VS Code Extension    Cloud Dashboard         CLI/Terminal  │
│  (local socket)     (workermill.com)       (agent logs)    │
│  Zero latency.      Works from any         For terminal    │
│  Works offline.     browser/device.        users.          │
│                                                      │
│  All three show the same state.                      │
│  All three can send commands.                        │
└──────────────────────────────────────────────────────┘
```

### Why Local API, Not Embedded Dashboard WebView

A WebView approach (embed the React dashboard in VS Code) talks to the **cloud API**. That means:

| | WebView (cloud) | Local API (agent) |
|---|---|---|
| Log latency | worker → agent → cloud → WebView | worker → agent → extension |
| Offline | Broken | Works (agent buffers) |
| Agent-specific data | Not available | Process memory, worktree paths, local file links |
| Feels like | A browser tab in VS Code | A native VS Code experience |

### Agent Local API Surface

The agent exposes a lightweight HTTP + SSE server on localhost (Unix socket preferred, TCP port fallback). Discovery via well-known file `~/.workermill/agent.sock` or `~/.workermill/agent.port`.

#### Endpoints

**State & Discovery**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/status` | Agent status: version, uptime, connected org, cloud API URL |
| `GET` | `/api/tasks` | All active + recent tasks with expert states, costs, story progress |
| `GET` | `/api/tasks/:id` | Single task detail: stories, experts, file ownership, worktree paths |

**Live Streams (SSE)**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/stream/tasks` | Real-time task state changes (new task, status change, expert start/stop, cost update) |
| `GET` | `/api/stream/logs/:taskId` | Live log stream for a task (same format as cloud SSE, zero latency) |
| `GET` | `/api/stream/coordination/:taskId` | Coordination feed: expert messages, questions, answers, blockers |

**Commands**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/tasks/run` | Create a new task (from VS Code command palette) |
| `POST` | `/api/tasks/:id/talk` | Send message to running worker |
| `POST` | `/api/tasks/:id/blocker` | Respond to blocker (retry/skip/abort + guidance) |
| `POST` | `/api/tasks/:id/plan/approve` | Approve execution plan |
| `POST` | `/api/tasks/:id/plan/reject` | Reject plan with feedback |
| `POST` | `/api/tasks/:id/cancel` | Cancel a running task |

**Personas**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/personas` | List available personas (built-in + custom) |
| `GET` | `/api/personas/:name` | Persona detail: specialties, model routing, directive |

#### Authentication

Local-only traffic, no auth needed. The socket file has user-only permissions (0600). TCP fallback binds to 127.0.0.1 only.

#### Implementation Notes

- Built on Node.js `http` module (no Express dependency — agent is a standalone binary)
- SSE streams wrap existing agent state: `activeProcesses` Map, stdout/stderr buffers
- State changes emit to all connected SSE clients via a simple EventEmitter
- Agent already tracks everything needed — the API is a thin projection, not new logic

### VS Code Extension Design

#### Sidebar: Team Panel

A tree view in the Activity Bar showing the live state of your AI team:

```
WORKERMILL
├── Active Tasks (2)
│   ├── OCS-142: Add dark mode
│   │   ├── Story 1/3: Theme context ✓
│   │   ├── Story 2/3: Settings toggle ⟳ (frontend_developer)
│   │   └── Story 3/3: LocalStorage persist (waiting)
│   └── OCS-143: Fix auth redirect
│       └── Story 1/1: OAuth callback ⟳ (backend_developer)
├── Experts (4 active)
│   ├── frontend_developer — working on OCS-142 S2
│   ├── backend_developer — working on OCS-143 S1
│   ├── security_engineer — idle
│   └── qa_engineer — idle
└── Recent (5)
    ├── OCS-140: API rate limiting ✓ $0.38
    └── ...
```

Clicking a task expands inline details. Clicking an expert shows their current file and recent activity.

#### Status Bar

Always visible at the bottom of VS Code:

```
$(rocket) WorkerMill: 2 tasks · 4 experts · $1.23  |  ⚠ 1 blocker
```

- Click the rocket icon → open Team Panel
- Click the blocker warning → jump to blocker detail
- Color-coded: green when experts are working, yellow for blockers, gray when idle

#### Notifications

VS Code native notifications for high-priority events:

- **Blocker escalated**: "Backend Expert is stuck on OCS-142: auth token expired. [Retry] [Skip] [View]"
- **Expert question**: "Security Engineer asks: Should we use PKCE for the OAuth flow? [Answer] [View]"
- **PR created**: "OCS-142 PR ready for review. [Open PR] [View Diff]"
- **Plan ready**: "Planning Agent finished OCS-143. 3 stories, est. $0.45. [Approve] [Edit] [View]"

Actions are inline — respond to a blocker without opening any panel.

#### Command Palette

```
> WorkerMill: Run Task...          (create from ticket key or description)
> WorkerMill: Talk to Worker...    (send message to active task)
> WorkerMill: Show Team Panel
> WorkerMill: Show Task Logs       (open terminal with live log stream)
> WorkerMill: Approve Plan         (for pending plans)
> WorkerMill: Create Custom Expert (open persona studio)
```

#### Context Menu Integration

Right-click in the editor or explorer:

- **On a file**: "Ask WorkerMill Expert About This File" → routes to relevant persona
- **On selected code**: "Send to WorkerMill: Fix This" / "Send to WorkerMill: Write Tests" / "Send to WorkerMill: Review"
- **On a folder**: "Run WorkerMill Task on This Module"

#### Coordination Feed Panel

A chat-like WebView panel (similar to GitHub Copilot Chat) showing the coordination feed for the selected task:

```
┌─────────────────────────────────────────┐
│ OCS-142: Add dark mode  [Story 2/3]     │
├─────────────────────────────────────────┤
│ 🎨 frontend_developer                   │
│ Created ThemeContext with light/dark     │
│ modes. Need API shape for user prefs.   │
│                                         │
│ → 💻 backend_developer                  │
│   GET /api/user/preferences returns     │
│   { theme: "light" | "dark", ... }      │
│                                         │
│ 🔒 security_engineer                    │
│ ⚠ Theme preference endpoint should      │
│ require auth. Adding to review notes.   │
│                                         │
│ 👔 tech_lead                            │
│ Approved with note: add CSS variables   │
│ for theming instead of inline styles.   │
├─────────────────────────────────────────┤
│ [Type a message to your team...]    Send│
└─────────────────────────────────────────┘
```

#### File Decorations (Level 2 — Future)

Files being actively modified by experts get decorations:

- Explorer: file icon badge showing which expert is working on it
- Editor tab: subtle indicator "Backend Expert is editing this file"
- Gutter: inline annotations from tech lead review comments
- Source Control: WorkerMill PRs appear alongside your own changes

### Install Flow

**Path A: CLI-first (current users)**
1. User already has `workermill-agent` installed
2. Installs VS Code extension from marketplace
3. Extension discovers agent via `~/.workermill/agent.sock`
4. Connected — team panel populates

**Path B: VS Code-first (new users)**
1. User installs "WorkerMill" extension from VS Code marketplace
2. Extension checks for agent binary — not found
3. Shows welcome view: "Install WorkerMill Agent" button
4. One-click install: extension runs `curl | bash` in integrated terminal
5. Extension runs `workermill-agent setup` in terminal (user enters org API key)
6. Agent starts, extension connects — first task ready

**Path C: Standalone binary installer**
```bash
curl -fsSL https://workermill.com/install.sh | bash
# Installer detects VS Code → prompts: "Install VS Code extension? [Y/n]"
# If yes: runs `code --install-extension workermill.workermill`
```

### Critical Behavior: Tasks Survive VS Code Restarts

The agent is an independent process, NOT embedded in the VS Code extension host. This means:

- Close VS Code → agent keeps running → experts keep working
- Reopen VS Code → extension reconnects → see current progress
- VS Code crashes → no work lost → agent didn't notice

This is impossible if the agent logic runs inside the extension. The separation is architecturally important.

### Future Clients (Enabled by Agent Local API)

Once the agent has a local API, other clients become trivial:

| Client | Effort | Value |
|--------|--------|-------|
| **JetBrains plugin** | Medium — same API, different UI framework | Captures IntelliJ/WebStorm users |
| **Raycast extension** | Small — status + quick actions | macOS power users |
| **Menubar app** | Small — Electron/Tauri tray icon with status | Always-visible team status |
| **Mobile companion** | Medium — React Native, talks to cloud API | Check on team from phone |
| **Neovim plugin** | Small — Lua plugin, same local API | Terminal-native devs |

---

## Implementation Priority & Dependencies

```
                    ┌──────────────────────┐
                    │ 1. Standalone Binary  │  ← Gating item for everything
                    │    (agent/build.mjs)  │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │ 2. Agent Local API    │  ← Keystone: unlocks all clients
                    │    (agent/src/server) │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
   ┌──────────▼──────┐  ┌─────▼──────┐  ┌──────▼───────┐
   │ 3. VS Code Ext  │  │ 4. Persona │  │ 5. Landing   │
   │   (new repo)    │  │   Studio   │  │   Page Redo  │
   └─────────────────┘  └────────────┘  └──────────────┘
                                              │
                                        ┌─────▼──────┐
                                        │ 6. Hero    │
                                        │  Animation │
                                        └────────────┘
```

### Phase 1: Foundation (enables everything else)
1. **Ship standalone binary** — `curl | bash` install, no Node.js prerequisite
2. **Agent local API** — HTTP + SSE server in the agent, state projection from existing `activeProcesses`

### Phase 2: VS Code + Persona Studio (the product differentiators)
3. **VS Code extension** — sidebar tree, status bar, notifications, coordination feed panel
4. **Persona Studio UX** — first-class creation flow in dashboard (and later in VS Code)

### Phase 3: Narrative (drives adoption)
5. **Landing page consolidation** — single page, single narrative, hero animation
6. **Dashboard replay / shareable build logs** — the viral loop asset
7. **Hero animation** — 15-second collaboration sequence for landing page

---

## Open Questions

1. **Extension marketplace name**: `workermill` or `workermill-ai`? Need to check availability.
2. **Agent auto-start**: Should the VS Code extension auto-start the agent on activation, or require explicit `workermill-agent start`?
3. **Persona Studio location**: Dashboard-only first, or ship in VS Code extension from day one?
4. **WebView vs native**: Coordination feed as WebView (richer, easier to style) or native VS Code chat API (if available)?
5. **JetBrains timing**: Ship alongside VS Code, or wait for VS Code traction first?

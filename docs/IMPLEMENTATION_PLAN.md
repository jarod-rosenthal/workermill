# Implementation Plan: Hybrid Architecture & "Ship From a Spec"

> WorkerMill repositioning from "AI agent orchestrator" to "describe what you want, get production-grade software."
> Built on the hybrid architecture: cloud-hosted intelligence (workermill.com) + locally-running workers (user's machine).

---

## Executive Summary

**The backend intelligence already exists.** The planning agent (3,289 lines) decomposes descriptions into stories. The Epic coordinator dispatches parallel experts. Quality gates validate output. The skill/memory system learns over time.

**What's new is the architecture and the front door:**
1. **Hybrid architecture** — Cloud brain orchestrates, local workers execute. User's code never leaves their machine. WorkerMill's IP never leaves the server.
2. **CLI distribution** — `npx workermill` → auto-bootstraps everything. One command to turn a Claude Max subscription into an AI engineering team.
3. **Build page** — Describe what you want on workermill.com, see a plan preview for free (~$0.03 Haiku), choose how to execute (local/BYOK/cloud).
4. **Three-tier model** — Free plan preview ($0.03 acquisition hook) → Pro ($19/mo, local execution) → Max ($39/mo, cloud execution) → Enterprise (custom).

**Scope:** 5 phases over ~10-14 weeks. Phase 0 (hybrid foundation) is the architectural prerequisite. Phase 1 (build page) is the highest-impact user-facing change.

### Critical Technical Constraint (Validated)

**Claude Max OAuth tokens cannot be used with the Anthropic Messages API (`@anthropic-ai/sdk`).** The SDK only accepts API keys. OAuth tokens only work with Claude CLI, which handles authentication internally as a subprocess.

**Impact on architecture:** All LLM calls in local mode must go through Claude CLI on the user's machine. The planning agent cannot make LLM calls server-side using a user's Claude Max token. Instead:

1. **Server assembles the planning prompt** (templates, stack config, skill/memory — the IP)
2. **Server sends assembled prompt to user's local worker**
3. **Worker runs `claude --print --model <model> <prompt>`** with user's OAuth token
4. **Worker returns raw LLM output** to server
5. **Server validates, scores, resolves dependencies** (the other half of the IP)

This is actually better than the original proposal — the user's OAuth token never leaves their machine, and WorkerMill pays $0 for LLM calls. The only WorkerMill-paid LLM call is the lightweight Haiku plan preview (~$0.03), which runs server-side before the user installs anything.

**Evidence:** `api/src/services/planning-agent-local.ts` already implements this pattern via `runWithClaudeCli()` (line 276), which spawns Claude CLI with the user's OAuth token from environment variables. The `@anthropic-ai/sdk` (v0.71.2) and `@ai-sdk/anthropic` (v3.0.0) both only accept `apiKey` parameters — confirmed by auditing all instantiation sites across the codebase.

---

## Architecture: Cloud Brain + Local Hands

```
┌─────────────────────────────────────────────────────────────────────┐
│                    workermill.com (CLOUD BRAIN)                      │
│                                                                      │
│  Plan Preview       ─── Haiku (~$0.03, WorkerMill's API key)        │
│  Prompt Assembly    ─── templates, stack config, skill/memory, org   │
│  Plan Validation    ─── validatePlan(), autoFixDependencies()        │
│  Complexity Scoring ─── calculateComplexityV3() (4-12 scale)        │
│  Epic Coordinator   ─── story dispatch (sequential local, parallel cloud) │
│  Quality Gates      ─── lint, types, tests, security scanning       │
│  Blocker Manager    ─── error classification, escalation            │
│  Skill/Memory       ─── procedural memory, semantic search          │
│  Dashboard          ─── real-time monitoring, log streaming, SSE    │
│  Billing/Usage      ─── cost tracking, budget limits                │
│                                                                      │
│  API Endpoints:                                                      │
│    POST /api/build/preview   ─── quick plan preview (Haiku, $0.03)  │
│    POST /api/build/execute   ─── start execution (local or cloud)   │
│    GET  /api/worker/plan     ─── worker gets assembled prompt       │
│    POST /api/worker/plan-result ── worker returns raw LLM output    │
│    GET  /api/worker/stories  ─── worker pulls next story            │
│    POST /api/worker/status   ─── worker reports progress            │
│    POST /api/tasks/:id/logs  ─── worker streams terminal output     │
│    GET  /api/control-center/tasks/:id/stream ── SSE to dashboard    │
│    GET  /api/worker/commands ─── worker polls for user messages     │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ HTTPS
                           │
┌──────────────────────────▼──────────────────────────────────────────┐
│                    User's Machine (LOCAL HANDS)                      │
│                                                                      │
│  WorkerMill CLI (npx workermill / npm install -g @workermill/cli)   │
│    ├── workermill login     ─── authenticate with workermill.com     │
│    ├── workermill start     ─── auto-install deps, start workers     │
│    ├── workermill stop      ─── stop worker processes                │
│    ├── workermill status    ─── show current task, dashboard link    │
│    └── workermill logs      ─── tail worker output                   │
│                                                                      │
│  Worker Process (native, no Docker)                                  │
│    ├── Claude Code CLI      ─── ALL LLM calls (planning + stories)  │
│    │   └── Uses user's OAuth token from ~/.claude/.credentials.json │
│    ├── Git                  ─── clone, branch, commit, push          │
│    └── Execution scripts    ─── log posting, status reporting        │
│                                                                      │
│  Workspace: ~/.workermill/workspace/ (Linux-native FS)               │
│    ├── cache/repo.git       ─── bare reference clone (shared, r/o)   │
│    └── task-abc/                                                     │
│        └── story-N/         ─── separate clone per story             │
│            (independent .git, independent branch, zero shared state) │
└─────────────────────────────────────────────────────────────────────┘

No Docker. No worktrees. Each story gets a fully independent git clone.
```

### Planning Flow: Split Execution (Validated)

The Anthropic Messages API (`@anthropic-ai/sdk`) does NOT accept OAuth tokens — only API keys. Claude CLI handles OAuth internally. This means all LLM calls in local mode must go through Claude CLI on the user's machine.

**Plan Preview (browser, no CLI needed):**
```
User describes project → Server calls Haiku (~$0.03, WorkerMill's API key)
                       → Returns: story count, complexity, cost estimate
                       → Purpose: acquisition hook, zero friction
```

**Full Planning (requires CLI running):**
```
1. Server assembles planning prompt (templates + stack config + skills + org settings)
2. Server sends assembled prompt to user's local worker via API
3. Worker runs: claude --print --model sonnet --prompt <assembled>
4. Worker returns raw LLM output to server
5. Server validates, scores complexity, resolves dependencies, builds final plan
6. Server dispatches stories to worker for execution
```

**Why this protects IP:**
- The assembled prompt is the *output* of intelligence, not the intelligence itself
- Prompt assembly logic (what templates to use, how to inject skills) = server-side
- Plan validation (dependency resolution, phase ordering, mutex detection) = server-side
- The prompt changes every time — extracting one doesn't give you the system

### What Goes Where

| Component | Location | Why |
|-----------|---------|-----|
| Plan preview (Haiku) | Cloud (WorkerMill's key) | Acquisition hook, works before CLI install |
| Prompt assembly | Cloud | Core IP — templates, stack config, skill injection |
| Planning LLM call | **Local** (user's Claude CLI) | OAuth tokens only work with CLI, not Messages API |
| Plan validation + scoring | Cloud | Core IP — dependency resolution, complexity scoring |
| Epic Coordinator | Cloud | Orchestration intelligence — story dispatch, dependency graphs |
| Coordination Feed | Cloud | Centralized state — experts need a shared message bus |
| Blocker Manager | Cloud | Decision logic — auto-retry vs escalate |
| Quality Gates | Cloud | Trust boundary — user can't bypass |
| Skill/Memory | Cloud | Cross-task learning — needs centralized vector store |
| Dashboard/UI | Cloud | User-facing SaaS |
| Story execution LLM calls | **Local** (user's Claude CLI) | Same constraint — OAuth only works with CLI |
| Git operations | Local | Code stays on user's machine, separate clone per story |
| Test execution | Local | Runs against local code in story clone |

### Story Isolation: Separate Clones (Validated)

**Why not git worktrees?** The current Docker-based local mode uses worktrees inside the container, which works because Docker provides a native Linux filesystem. Without Docker, worktrees on WSL cause git index corruption due to shared `.git` directory + NTFS path translation. This was discovered through painful experience.

**Why separate clones?** Each story gets a fully independent `git clone`. Zero shared mutable state between stories. This is how GitHub Actions, GitLab CI, and every CI system handles parallel job isolation. It's battle-tested.

**How cloning is fast:** `git clone --reference ~/.workermill/cache/repo.git --depth 1` hardlinks git objects from a cached bare clone. Cloning a 500MB repo takes ~1 second. For new projects (the primary use case), repos are tiny — cloning is instant.

**Workspace layout:**
```
~/.workermill/workspace/
├── cache/
│   └── repo.git              ← bare reference clone (once per repo, read-only)
└── task-abc/
    ├── story-0/              ← independent clone (own .git, own branch)
    ├── story-1/              ← independent clone (own .git, own branch)
    └── story-2/              ← independent clone (own .git, own branch)
```

**Stories execute sequentially in dependency order** — one at a time. The separate clones exist to provide clean per-story state, not for parallelism. Each story starts from a clean clone, works on its branch, commits, pushes, and the next story begins. This eliminates all concurrency issues while maintaining a clean workspace per story.

### Planning Agent: No Changes Required

The planning agent does NOT need modification for sequential execution. Here's why:

**The dependency graph still works.** The planner outputs stories with dependencies like `S5 → [S3, S4]` meaning "S5 needs S3 and S4 to finish first." In parallel mode, this determines what can run concurrently. In sequential mode, it determines the topological sort order — which story runs next. Same data, different interpretation.

**Mutex groups are kept in the plan.** The planner generates mutex groups identifying which stories touch the same files. In sequential mode they're not needed for concurrency control (only one story runs at a time), but they remain valuable metadata — they help the coordinator order stories intelligently and help users understand file overlap when reviewing the plan.

**Sequential is actually better for code quality.** In parallel mode, stories are designed to be independent — S3 (API endpoints) and S4 (auth) both branch from S2 (models) but can't see each other's work. In sequential mode, S4 starts after S3 is committed, so it can see and build on S3's code. Later stories have more context, which means fewer integration issues.

**What the coordinator changes (not the planner):**

| Component | Parallel (Cloud) | Sequential (Local) |
|-----------|-----------------|-------------------|
| Planning Agent | Generates stories + dependency graph | **Same — no change** |
| Story dispatch | Multiple stories dispatched concurrently | Stories dispatched one at a time in topological order |
| Mutex groups | Enforced to prevent file conflicts | Kept in plan (useful metadata), not enforced at runtime |
| Story branches | Each branches from main independently | Each branches from previous story's committed code |
| Coordination feed | Real-time multi-expert messaging | Simplified — single expert, no cross-talk needed |

The planning agent is execution-mode agnostic. The coordinator interprets the same plan differently based on whether it's running locally (sequential) or in the cloud (parallel). This means one plan works for both modes — a user could preview on local mode and later re-run the same plan on cloud mode with parallelism.

### IP Protection

| What | Protection |
|------|-----------|
| Prompt assembly logic | Server-side — worker receives assembled prompt, not the templates/rules |
| Plan validation algorithms | Server-side — worker returns raw output, server validates and transforms |
| Coordinator dispatch logic | Server-side — worker receives "do this story" not "figure out what to do" |
| Skill/memory embeddings | Server-side vector store — relevant skills injected into prompts server-side |
| Quality gate evaluation | Server-side — worker reports results, server decides pass/fail |
| Assembled planning prompt | Sent to worker — but changes every time, is the output not the source |
| Local CLI / scripts | Open by necessity but contains only execution scaffolding, not intelligence |

---

## Phase 0: Hybrid Foundation (Weeks 1-2)

**Goal:** Users can install the CLI, authenticate, and run workers locally. This is the architectural prerequisite for everything else.

### 0.1 WorkerMill CLI: `@workermill/cli`

**Directory:** `packages/workermill-cli/` (new package)

A lightweight CLI that manages worker processes natively — no Docker required. Auto-bootstraps all dependencies.

**First-run experience (from the /build page):**
```
$ npx workermill

  Checking dependencies...
    ✓ git (2.43.0)
    ✗ Claude CLI not found
      → Installing @anthropic-ai/claude-code...
      → Run 'claude auth login' to authenticate with Claude Max
      → [browser opens for Claude OAuth]
      → ✓ Claude CLI authenticated

  WorkerMill authentication...
    → Opening workermill.com/auth/cli...
    → [browser opens for WorkerMill OAuth]
    → ✓ Authenticated as jarod@example.com (org: acme-inc)

  Configuration:
    Workspace: ~/.workermill/workspace/
    ⚠ Using Linux-native filesystem for stability

  Worker ready. Waiting for tasks...
  Dashboard: https://workermill.com/dashboard
```

**Subsequent runs:**
```
$ npx workermill
  ✓ All dependencies found
  ✓ Already authenticated
  Worker ready. Dashboard: https://workermill.com/dashboard
```

**CLI Commands:**

| Command | Description |
|---------|-------------|
| `npx workermill` | One-command start (auto-installs deps, authenticates, connects) |
| `workermill login` | Re-authenticate with workermill.com |
| `workermill stop` | Stop the worker process |
| `workermill status` | Show current task, story progress, dashboard link |
| `workermill logs` | Tail worker output (local mirror of what dashboard shows) |
| `workermill config` | Set defaults (workspace path, etc.) |

**Implementation (~500 lines):**
- Commander.js for CLI framework
- `child_process` to manage Claude CLI subprocesses
- `simple-git` for clone/branch/push operations
- OAuth device flow for authentication (opens browser, polls for token)
- Config stored in `~/.workermill/config.json`
- Workspace managed in `~/.workermill/workspace/`

**Package structure:**
```
packages/workermill-cli/
  ├── package.json         # @workermill/cli, bin: { workermill: "./dist/cli.js" }
  ├── tsconfig.json
  └── src/
      ├── cli.ts           # Entry point, Commander setup
      ├── auth.ts          # OAuth device flow (WorkerMill + Claude)
      ├── worker.ts        # Worker process lifecycle (claim story, execute, report)
      ├── workspace.ts     # Separate clone management (create, cleanup)
      ├── deps.ts          # Dependency checking (git, Claude CLI auto-install)
      ├── config.ts        # ~/.workermill/ config management
      └── api-client.ts    # HTTPS client for workermill.com API
```

**Compiled for distribution:**
- Published to npm as `@workermill/cli` (works via `npx` or global install)
- Also compiled with Bun for standalone binary download (`brew install workermill`, `curl | sh`)
- TypeScript source, team consistency with the rest of the codebase

### 0.2 Workspace Manager (Separate Clones)

**File:** `packages/workermill-cli/src/workspace.ts` (~150 lines)

Manages the separate-clone workspace for story isolation:

```typescript
class WorkspaceManager {
  private cacheDir = "~/.workermill/cache";
  private workDir = "~/.workermill/workspace";

  /**
   * Ensure bare reference clone exists for the target repo.
   * First time: full clone. Subsequent: git fetch to update.
   */
  async ensureReferenceClone(repoUrl: string): Promise<string>;

  /**
   * Create an isolated clone for a story.
   * Uses --reference for near-instant clone with hardlinked objects.
   * Returns the absolute path to the story workspace.
   */
  async createStoryClone(taskId: string, storyIndex: number, branch: string): Promise<string>;

  /**
   * Clean up story clone after completion.
   */
  async cleanupStoryClone(taskId: string, storyIndex: number): Promise<void>;

  /**
   * Clean up all clones for a completed task.
   */
  async cleanupTask(taskId: string): Promise<void>;
}
```

**Critical WSL rule:** All workspace paths use the Linux-native filesystem (`~/`), never `/mnt/c/`. This avoids the NTFS path translation and file locking issues that caused worktree failures on WSL.

**Why separate clones, not worktrees:** Git worktrees share a `.git` directory. Concurrent git operations on shared indexes cause corruption, especially on WSL where Windows/Linux filesystem boundaries add path translation issues. Separate clones have zero shared mutable state — each is as independent as two developers on different machines. This is the same isolation model used by GitHub Actions, GitLab CI, and every major CI system.

### 0.3 Worker API Endpoints

New API endpoints that workers call to receive instructions and report back:

**File:** `api/src/routes/worker-api.ts` (new, ~400 lines)

| Endpoint | Direction | Purpose |
|----------|-----------|---------|
| `GET /api/worker/plan` | Cloud → Worker | **Get assembled planning prompt** (server builds prompt, worker executes LLM call) |
| `POST /api/worker/plan-result` | Worker → Cloud | **Return raw LLM output** for server-side validation and scoring |
| `GET /api/worker/claim` | Cloud → Worker | Worker claims next available story |
| `GET /api/worker/stories/:id` | Cloud → Worker | Get story details, persona, constraints |
| `POST /api/worker/status` | Worker → Cloud | Report story progress/completion |
| `POST /api/worker/logs` | Worker → Cloud | **Stream terminal output** (see Log Streaming below) |
| `GET /api/worker/commands/:taskId` | Cloud → Worker | Poll for user messages (existing) |
| `POST /api/worker/blocker` | Worker → Cloud | Escalate blocker to dashboard |
| `GET /api/worker/skills/:persona` | Cloud → Worker | Get relevant skills for current story |

**Planning endpoints are critical:** `GET /api/worker/plan` returns an assembled prompt (not a plan). The worker runs `claude --print --model <model> <prompt>` locally and posts the raw output back via `POST /api/worker/plan-result`. The server then validates, scores, and builds the final `ExecutionPlan`. This keeps the IP (prompt assembly + validation) server-side while the LLM cost stays user-side.

These endpoints are authenticated with the worker's session token (issued during `workermill start`).

### 0.3.1 Log Streaming: Local → Cloud Dashboard

**This is the most important data flow in local mode.** The terminal output view is the core product experience. Without it, workermill.com is just a build trigger — the real-time visibility IS the product.

**Architecture:**

```
User's Machine                                    workermill.com
┌──────────────────────────┐                     ┌──────────────────────┐
│ Claude CLI (child proc)  │                     │                      │
│   stdout ──┬──▶ terminal │  batch POST/500ms   │ POST /api/tasks/     │
│            │   (raw text)│ ──────────────────▶ │   :taskId/logs       │
│            │             │                     │   │                  │
│            └──▶ buffer[] │                     │   ▼                  │
│                          │                     │ WorkerTaskLog table  │
│ WorkerMill CLI           │                     │   │                  │
│   captures, tees, batches│                     │   ▼ SSE (500ms)     │
└──────────────────────────┘                     │ GET /api/control-    │
                                                 │   center/tasks/      │
                                                 │   :taskId/stream     │
                                                 │   │                  │
                                                 │   ▼                  │
                                                 │ Dashboard browser    │
                                                 │ (organized, enriched)│
                                                 └──────────────────────┘
```

**How it works:**

1. CLI spawns Claude CLI as a child process with stdout piped
2. As stdout lines arrive, CLI does two things simultaneously:
   - **Tee to terminal**: Print raw line to user's terminal (immediate, local)
   - **Buffer for cloud**: Append line to an in-memory buffer
3. Every 500ms (configurable), CLI flushes the buffer as a batch POST to `workermill.com/api/tasks/:taskId/logs`
4. The cloud API writes logs to PostgreSQL (`WorkerTaskLog` table) — **existing table, existing schema**
5. The cloud dashboard SSE endpoint (`/api/control-center/tasks/:taskId/stream`) polls the table and pushes new logs — **existing endpoint, existing SSE**
6. Dashboard renders the rich, organized view with per-story filtering, quality metrics, coordination feed, etc.

**What already exists (no changes needed):**
- `POST /api/tasks/:taskId/logs` — Log ingestion endpoint (used by ECS workers today)
- `WorkerTaskLog` model — PostgreSQL table for log storage
- `GET /api/control-center/tasks/:taskId/stream` — SSE streaming endpoint
- Dashboard log viewer component with real-time updates

**What's new:**
- CLI log capture and batching logic (~50 lines in `packages/workermill-cli/src/worker.ts`)
- Retry queue for transient network failures (~30 lines)
- "Worker offline" indicator on dashboard when no logs received for 10s (~10 lines frontend)

**The two-layer experience:**

| What the user sees locally (terminal) | What the user sees on workermill.com (dashboard) |
|---|---|
| Raw Claude CLI stdout — unstructured text | Stories organized by dependency phase |
| All output mixed in one stream | Per-story, per-expert filtered views |
| No controls | Blocker alerts with Retry / Skip / Abort |
| No metrics | Quality scores, cost tracking, progress bars |
| No coordination context | Coordination feed showing expert decisions |
| Equivalent to running `claude` manually | **This is the product** |

**Why this preserves IP:** The raw terminal output has zero WorkerMill intelligence in it — it's Claude CLI's stdout, identical to what any developer gets running `claude --print`. The entire product value is in how the cloud dashboard organizes, correlates, enriches, and makes that output actionable. The dashboard is never shipped locally. Users must visit workermill.com to get the organized view.

**Offline handling:** If the CLI loses internet temporarily, logs buffer locally (up to 10MB, ~30min of output). When connectivity resumes, buffered logs flush in order. Terminal output is never affected — it's local. Dashboard shows a "worker reconnecting..." indicator.

**Bandwidth:** Claude CLI output is ~1-5 KB/s typical. Batching at 500ms means ~2 POSTs/second at 500B-2.5KB each. This is negligible — less than streaming a video thumbnail.

### 0.4 Execution Mode Gate

**File:** `api/src/services/execution-gate.ts` (new, ~150 lines)

When a user clicks "Build It" on the build page, the system routes to the correct execution path:

```typescript
type ExecutionMode = "local" | "byok" | "cloud";

function resolveExecutionMode(org: Organization, userChoice?: string): ExecutionMode {
  // 1. If user has running local workers → "local"
  // 2. If user selected BYOK and has API key configured → "byok"
  // 3. If user selected cloud and has credits/subscription → "cloud"
  // 4. Default: prompt user to choose
}
```

| Mode | What Happens |
|------|-------------|
| **Local** | Task queued → user's local workers claim stories → execute on user's machine |
| **BYOK** | Task queued → cloud workers spawn → use user's API key for LLM calls |
| **Cloud** | Task queued → cloud workers spawn → use WorkerMill's API key → charge credits |

### 0.5 Files Created/Modified Summary (Phase 0)

| Action | File | Lines (est.) |
|--------|------|-------------|
| **Create** | `packages/workermill-cli/src/cli.ts` | ~100 |
| **Create** | `packages/workermill-cli/src/auth.ts` | ~80 |
| **Create** | `packages/workermill-cli/src/worker.ts` | ~200 (includes log capture + batching) |
| **Create** | `packages/workermill-cli/src/workspace.ts` | ~150 |
| **Create** | `packages/workermill-cli/src/deps.ts` | ~80 |
| **Create** | `packages/workermill-cli/src/config.ts` | ~50 |
| **Create** | `packages/workermill-cli/src/api-client.ts` | ~80 (includes log POST + retry queue) |
| **Create** | `api/src/routes/worker-api.ts` | ~400 |
| **Create** | `api/src/services/execution-gate.ts` | ~150 |
| **Modify** | `api/src/index.ts` | +5 lines (router registration) |
| **Modify** | `frontend/src/components/TaskDetail.tsx` (or equivalent) | +10 lines ("worker offline" indicator) |
| **Total** | | ~1,310 lines new code |

**Note on log streaming:** The log ingestion endpoint (`POST /api/tasks/:taskId/logs`), database table (`WorkerTaskLog`), and SSE streaming endpoint (`GET /api/control-center/tasks/:taskId/stream`) already exist and are production-tested with ECS workers. No backend changes needed for log infrastructure — the CLI just needs to POST to the existing endpoint.

---

## Phase 1: The Build Page (Weeks 2-4)

**Goal:** A user can describe what they want to build on workermill.com, see a plan for free, then choose how to execute it.

### 1.1 New Page: `/build`

**File:** `frontend/src/pages/Build.tsx` (new)

**UI Layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│  Describe what you want to build.                                │
│  Our AI engineering team handles the rest.                       │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                                                          │    │
│  │  [Large textarea - 20+ lines visible]                    │    │
│  │                                                          │    │
│  │  Describe your project in plain English. Include         │    │
│  │  features, user types, and any technical preferences.    │    │
│  │                                                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Stack: [ Next.js + Prisma ▼ ]     Repo: [ owner/repo ▼ ]       │
│                                                                  │
│  [ See the Plan (free) ]                                         │
│                                                                  │
│  ─── After planning ───                                          │
│                                                                  │
│  Plan Preview:                                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 8 stories | Est. $12.40 | ~45 min | Complexity: 7/12      │  │
│  │                                                            │  │
│  │ S1: Set up project scaffolding (devops)                    │  │
│  │ S2: Create database models (backend)                       │  │
│  │ S3: Implement API endpoints (backend) [→S2]                │  │
│  │ S4: Build auth flow (backend) [→S2]                        │  │
│  │ S5: Create dashboard UI (frontend) [→S3]                   │  │
│  │ S6: Add form validation (frontend) [→S3,S4]                │  │
│  │ S7: Write integration tests (qa) [→S3,S4]                  │  │
│  │ S8: Configure CI/CD (devops) [→S1]                         │  │
│  │                                                            │  │
│  │ Stack: TypeScript, Next.js, Prisma, Tailwind, Vitest       │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  [ Edit Plan ]                                                   │
│                                                                  │
│  How do you want to build this?                                  │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐       │
│  │ ● Local Mode  │  │   BYOK Mode   │  │  Cloud Mode   │       │
│  │               │  │               │  │               │       │
│  │ Use your own  │  │ Your API key, │  │ We handle     │       │
│  │ machine +     │  │ our compute   │  │ everything    │       │
│  │ Claude Max    │  │               │  │               │       │
│  │               │  │ Est: $12.40   │  │ Est: $18.60   │       │
│  │ $0 extra      │  │ (your tokens) │  │ (credits)     │       │
│  └───────────────┘  └───────────────┘  └───────────────┘       │
│                                                                  │
│  [ Build It → ]                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Key behaviors:**
- "See the Plan" calls `POST /api/build/preview` — free, ~$0.03 Haiku, works in browser
- Preview shows approximate story count, personas, cost estimate, complexity score
- This is NOT the full detailed plan — it's a lightweight preview to hook the user
- Execution mode selector: Local / BYOK / Cloud with cost comparison
- Local mode shows "Requires: `npm i -g @workermill/cli` running" with setup link
- "Build It" calls `POST /api/build/execute` → redirects to dashboard
- For local mode: full planning runs on user's machine (Sonnet/Opus via Claude CLI)
- Full detailed plan (with dependency graph, story descriptions) appears on dashboard after worker completes planning
- User can edit plan on dashboard before confirming execution
- Starter project templates available via dropdown for first-time users

**Language rules:**
- NEVER use "PRD" anywhere in the UI
- Use: "Describe what you want to build", "your description", "project spec"
- Use: "stories" not "tickets" or "issues" (we're building, not filing)

### 1.2 New API: Build Endpoints

**File:** `api/src/routes/build.ts` (new, ~350 lines)

#### `POST /api/build/preview` (Free, No CLI Required)

Lightweight plan preview powered by Haiku (~$0.03). Works in the browser before the user installs anything. This is the acquisition hook.

```typescript
// Request
{
  description: string,       // What the user wants to build (required)
  title: string,             // Project title (required)
  stackTemplate?: string,    // "nextjs-prisma" | "django-react" | etc.
}

// Response
{
  preview: {
    storyCount: number,       // Approximate number of stories
    personas: string[],       // Which expert types will be involved
    techStack: string[],      // Inferred technology list
    reasoning: string,        // Brief explanation of the approach
  },
  complexity: {
    score: number,           // 4-12
    dimensions: { features, layers, files, clarity },
  },
  estimatedCost: {
    local: 0,                // Always $0 for local mode
    byok: number,            // Token cost estimate
    cloud: number,           // Token + compute cost
  },
  estimatedDuration: number, // Minutes
}
```

**Implementation:** Uses Haiku (WorkerMill's API key, ~$0.03/call) for a lightweight breakdown. NOT a full plan — no detailed story descriptions, no dependency graph. Just enough to show the user the value of WorkerMill's planning intelligence. Rate-limited to 5/day on the Pro tier.

**Why Haiku, not Sonnet:** The preview is an acquisition cost. At $0.03 per call, it's sustainable at scale. The detailed planning (Sonnet/Opus) happens during execution on the user's machine.

#### `POST /api/build/execute` (Requires CLI for Local Mode)

Creates the task and starts execution. For local mode, this triggers the full planning flow where the user's worker runs the LLM call.

```typescript
// Request
{
  description: string,
  title: string,
  executionMode: "local" | "byok" | "cloud",
  stackTemplate?: string,
  targetRepo: string,        // Required at execution time
}

// Response
{
  taskId: string,
  status: "planning",        // Full planning happens first
  executionMode: string,
  dashboardUrl: string,      // Direct link to task on dashboard
}
```

**Implementation by execution mode:**

**Local mode:**
1. Create `WorkerTask` with `status: "planning"`, `executionMode: "local"`
2. Server assembles full planning prompt (templates, stack config, skills, org settings)
3. User's local worker pulls prompt via `GET /api/worker/plan`
4. Worker runs `claude --print --model sonnet <prompt>` using OAuth token
5. Worker posts raw output via `POST /api/worker/plan-result`
6. Server validates, scores, resolves dependencies → builds `ExecutionPlan`
7. User sees full plan on dashboard, can edit stories
8. User confirms → server dispatches stories → local workers execute

**BYOK mode:**
1. Create `WorkerTask` with `status: "planning"`, `executionMode: "byok"`
2. Server runs full planning using user's API key via `@anthropic-ai/sdk` (API keys work directly)
3. Plan shown on dashboard → user confirms → cloud workers execute with user's key

**Cloud mode:**
1. Same as BYOK but using WorkerMill's API key
2. Cost charged to user's credits/subscription

### 1.3 Planning Adapter (Two Modes)

**File:** `api/src/services/build-planner.ts` (new, ~250 lines)

Two functions for the two planning modes:

```typescript
/**
 * Lightweight preview using Haiku (WorkerMill's API key).
 * Returns approximate story count, personas, tech stack — NOT a full plan.
 * Cost: ~$0.03 per call.
 */
export async function previewPlan(
  description: string,
  title: string,
  org: Organization,
  stackTemplate?: StackTemplate
): Promise<PlanPreview> {
  // 1. Build lightweight preview prompt
  // 2. Call Haiku via @anthropic-ai/sdk (WorkerMill's API key)
  // 3. Parse approximate story count, personas, tech stack
  // 4. Calculate complexity score via calculateComplexityV3()
  // 5. Estimate costs per execution mode
}

/**
 * Assemble full planning prompt for local worker execution.
 * Returns the assembled prompt — NOT a plan. The worker runs the LLM call.
 * Cost to WorkerMill: $0.
 */
export async function assembleFullPlanningPrompt(
  description: string,
  title: string,
  org: Organization,
  stackTemplate?: StackTemplate
): Promise<AssembledPrompt> {
  // 1. Build the full planning system prompt (from planning-agent.ts templates)
  // 2. Inject stack template constraints
  // 3. Inject relevant skills from memory system
  // 4. Inject org-specific quality gate config
  // 5. Return { systemPrompt, userPrompt, model } — worker runs the LLM call
}

/**
 * Validate raw LLM output from worker and build final plan.
 * Called after worker posts plan-result.
 */
export async function validateAndBuildPlan(
  rawOutput: string,
  taskId: string
): Promise<ExecutionPlan> {
  // 1. Parse raw LLM output into stories
  // 2. validatePlan() — check structure, required fields
  // 3. autoFixForwardDependencies() — resolve dependency issues
  // 4. autoFixPhaseOrdering() — ensure correct phase sequence
  // 5. calculateComplexityV3() — score final plan
  // 6. Return validated ExecutionPlan
}
```

**Key insight:** The planning intelligence is split across `assembleFullPlanningPrompt()` (what to ask) and `validateAndBuildPlan()` (what to do with the answer). The expensive LLM call between them runs on the user's machine.

### 1.4 Stack Templates

**File:** `api/src/config/stack-templates.ts` (new, ~200 lines)

Pre-defined configurations that constrain the planning agent:

```typescript
export const STACK_TEMPLATES: StackTemplate[] = [
  {
    id: "nextjs-prisma",
    name: "Next.js + Prisma + Tailwind",
    description: "Full-stack TypeScript with Next.js App Router, Prisma ORM, TailwindCSS",
    techStack: { language: "typescript", framework: "next.js", styling: "tailwindcss",
                 database: "postgresql", testing: "vitest", rationale: "Modern full-stack TypeScript" },
    defaultPersonas: ["backend_developer", "frontend_developer", "devops_engineer", "qa_engineer"],
    qualityThresholds: { minQualityScore: 70, blockOnTypeErrors: true },
  },
  { id: "django-react", name: "Django + React + PostgreSQL", /* ... */ },
  { id: "fastapi-react", name: "FastAPI + React + SQLAlchemy", /* ... */ },
  { id: "express-react", name: "Express + React + TypeORM", /* ... */ },
  { id: "rails-react", name: "Rails + React + PostgreSQL", /* ... */ },
  // More: flask-htmx, spring-boot-react, go-htmx, etc.
];
```

### 1.5 Starter Projects

**File:** `api/src/config/starter-projects.ts` (new, ~150 lines)

Curated example descriptions that users can select as their first project:

```typescript
export const STARTER_PROJECTS: StarterProject[] = [
  {
    id: "saas-dashboard",
    title: "SaaS Analytics Dashboard",
    description: "Build a multi-tenant analytics dashboard with user authentication, ...",
    stackTemplate: "nextjs-prisma",
    complexity: "medium",
    estimatedStories: 8,
    tags: ["saas", "dashboard", "auth", "charts"],
  },
  {
    id: "rest-api",
    title: "REST API with Auth & Docs",
    description: "Build a production REST API with JWT authentication, ...",
    stackTemplate: "fastapi-react",
    complexity: "simple",
    estimatedStories: 6,
    tags: ["api", "auth", "docs"],
  },
  // More: e-commerce, blog platform, real-time chat, CLI tool, etc.
];
```

**Purpose:** First-time users pick a starter project → see the plan → experience the value. This prevents trivial tasks ("fix this typo") from being the first impression.

### 1.6 Navigation & Routing

| File | Change |
|------|--------|
| `frontend/src/App.tsx` | Add `/build` route |
| `frontend/src/components/Navbar.tsx` | Add "Build" nav item (prominent, primary button style) |
| `api/src/index.ts` | Register `buildRouter` at `/api/build` |

### 1.7 Files Created/Modified Summary (Phase 1)

| Action | File | Lines (est.) |
|--------|------|-------------|
| **Create** | `frontend/src/pages/Build.tsx` | ~700 |
| **Create** | `api/src/routes/build.ts` | ~300 |
| **Create** | `api/src/services/build-planner.ts` | ~150 |
| **Create** | `api/src/config/stack-templates.ts` | ~200 |
| **Create** | `api/src/config/starter-projects.ts` | ~150 |
| **Modify** | `frontend/src/App.tsx` | +5 lines |
| **Modify** | `frontend/src/components/Navbar.tsx` | +10 lines |
| **Modify** | `api/src/index.ts` | +3 lines |
| **Total** | | ~1,520 lines new code |

---

## Phase 2: Landing Page & Messaging (Weeks 4-5)

**Goal:** First-time visitors immediately understand the value proposition and see proof it works.

### 2.1 Landing Page Hero Rewrite

**File:** `frontend/src/pages/Landing*.tsx` (modify existing)

**Current hero:** "Mission control for autonomous AI coding agents"

**New hero:**
```
Ship production-grade software from a spec.

Describe what you want to build. Our AI engineering team
builds it with tests, CI/CD, and documentation.

Run locally with Claude Max, or let us handle it.

[ Start Building (free) → ]    [ See Examples ]
```

### 2.2 "How It Works" Section

```
1. DESCRIBE           2. REVIEW PLAN         3. CHOOSE HOW         4. WATCH IT BUILD
Describe what you  →  See decomposed      →  Local: Your machine  →  Parallel AI experts
want in plain          stories, cost          + Claude Max ($0)      work in real-time
English                estimate, edit it      Cloud: We handle it    on your dashboard
```

### 2.3 "Why WorkerMill?" Section

```
Your code, your machine.
Workers run locally — code never leaves your computer.
Orchestration intelligence lives in the cloud.

Use your existing AI subscription.
Already paying for Claude Max? WorkerMill turns it into
a parallel AI engineering team at $0 extra cost.

Professional standards, not prototype quality.
Quality gates, security scanning, test requirements,
and tech lead review mean output is actually deployable.

Works with your stack.
GitHub, GitLab, Bitbucket. Jira, Linear, GitHub Issues.
Claude, GPT, Gemini, or self-hosted Ollama.
```

### 2.4 Showcase Gallery

**File:** `frontend/src/components/ShowcaseGallery.tsx` (new)

Display 3-5 example projects built by WorkerMill:

```
Built with WorkerMill:

┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ SaaS Dashboard│  │ REST API     │  │ E-commerce   │
│              │  │              │  │              │
│ Next.js      │  │ FastAPI      │  │ Rails        │
│ 12 stories   │  │ 8 stories    │  │ 15 stories   │
│ $18.20       │  │ $9.40        │  │ $24.60       │
│ 52 min       │  │ 31 min       │  │ 68 min       │
│              │  │              │  │              │
│ [View repo]  │  │ [View repo]  │  │ [View repo]  │
│ [View how]   │  │ [View how]   │  │ [View how]   │
└──────────────┘  └──────────────┘  └──────────────┘
```

Each links to a public GitHub repo AND the WorkerMill task log showing coordination feed, quality metrics, cost breakdown.

### 2.5 Competitive Comparison

```
| Feature                | WorkerMill | Devin | Copilot Agents | Cursor |
|------------------------|------------|-------|----------------|--------|
| Runs on your machine   |     ✓      |   ✗   |       ✗        |   ✓    |
| Parallel AI experts    |     ✓      |   ✗   |       ✗        |   ✗    |
| Multi-provider LLMs    |     ✓      |   ✗   |       ✗        |   ✗    |
| Quality gates          |     ✓      |   ✗   |       ✗        |   ✗    |
| Cost controls          |     ✓      |   ~   |       ✗        |   ✗    |
| GitHub/GitLab/BB       |     ✓      |   ~   |   GitHub only  |   ✗    |
| Real-time dashboard    |     ✓      |   ✓   |       ✗        |   ✗    |
```

### 2.6 Updated Docs Quick Start

**File:** `frontend/src/pages/Docs/QuickStart.tsx` (rewrite)

```
Quick Start (5 minutes)

Option A: Local Mode (recommended)
  1. npm install -g @workermill/cli
  2. workermill login
  3. workermill start
  4. Go to workermill.com/build
  5. Describe what you want to build
  6. Click "See the Plan" (free)
  7. Click "Build It" → workers start on your machine

Option B: Cloud Mode
  1. Sign up at workermill.com
  2. Add your API key (Settings > AI Provider)
  3. Go to /build
  4. Describe, plan, build
```

### 2.7 Files Created/Modified Summary (Phase 2)

| Action | File | Scope |
|--------|------|-------|
| **Modify** | `frontend/src/pages/Landing*.tsx` | Hero, How It Works, Why, Showcase, Comparison |
| **Modify** | `frontend/src/pages/Docs/QuickStart.tsx` | Rewrite for local-first flow |
| **Create** | `frontend/src/components/ShowcaseGallery.tsx` | ~300 lines |

---

## Phase 3: Showcase & Proof (Weeks 5-7)

**Goal:** Build real projects with WorkerMill and publish them as proof that the system works.

### 3.1 Build 5-10 Showcase Projects

Use WorkerMill itself to build these, then publish repos AND task logs:

| Project | Stack | Complexity | Purpose |
|---------|-------|-----------|---------|
| **Task Manager SaaS** | Next.js + Prisma + Tailwind | Medium | Classic CRUD + auth |
| **REST API Starter** | FastAPI + SQLAlchemy + Alembic | Simple | Backend-only showcase |
| **E-commerce Store** | Rails + React + Stripe | Complex | Full-stack with payments |
| **Blog Platform** | Django + HTMX + Tailwind | Medium | Server-rendered |
| **Real-time Chat** | Express + React + Socket.io | Medium | WebSocket showcase |
| **CLI Tool** | Go + Cobra | Simple | Non-web showcase |
| **Developer Portfolio** | Next.js + MDX | Simple | Static site |

For each, publish:
- GitHub repo (public, under `workermill-examples` org)
- Task coordination log (showing story decomposition and expert collaboration)
- Cost breakdown (exact token usage and dollars)
- Quality metrics (lint, types, tests, security)
- Time to completion

### 3.2 Showcase API & Data Model

**File:** `api/src/routes/showcase.ts` (new, ~150 lines)

Public endpoint (no auth required):

```typescript
GET /api/showcase/projects          // List all showcase projects
GET /api/showcase/projects/:id      // Full detail + coordination feed + metrics
```

**File:** `api/src/models/ShowcaseProject.ts` (new, ~50 lines)

### 3.3 Public Task Viewer

**File:** `frontend/src/pages/ShowcaseViewer.tsx` (new, ~400 lines)

Read-only version of the dashboard showing how a showcase project was built:
- Story decomposition timeline
- Coordination feed (decisions, questions, completions)
- Quality metrics
- Cost breakdown by story
- Links to code in GitHub

**Route:** `/showcase/:projectId` (public, no auth)

### 3.4 Files Summary (Phase 3)

| Action | File | Lines (est.) |
|--------|------|-------------|
| **Create** | `api/src/routes/showcase.ts` | ~150 |
| **Create** | `api/src/models/ShowcaseProject.ts` | ~50 |
| **Create** | `frontend/src/pages/ShowcaseViewer.tsx` | ~400 |
| **Create** | Migration for showcase_projects table | ~40 |
| **Modify** | `frontend/src/App.tsx` | +5 lines |

---

## Phase 4: Distribution & Growth (Weeks 7-12)

**Goal:** Meet developers where they are.

### 4.1 GitHub App (Weeks 7-9)

One-click install from GitHub Marketplace:
- React to issue labels (`workermill`) automatically
- Comment on issues with plan preview and cost estimate
- Open PRs with WorkerMill branding
- Marketplace listing for organic discovery

**Files:**

| File | Purpose | Lines |
|------|---------|-------|
| `api/src/routes/github-app.ts` | Webhook handler + installation flow | ~400 |
| `api/src/services/github-app.ts` | Installation management, token exchange | ~300 |
| `api/src/models/GitHubAppInstallation.ts` | Track installations per org | ~40 |

### 4.2 Slack Integration (Weeks 8-10)

Notifications for task progress, blocker alerts, PR links. Interactive buttons for retry/skip/abort on blockers. Slash command `/workermill build <description>`.

**Files:**

| File | Purpose | Lines |
|------|---------|-------|
| `api/src/routes/slack.ts` | OAuth, events, interactions | ~350 |
| `api/src/services/slack-notifier.ts` | Send notifications | ~250 |
| `api/src/models/SlackInstallation.ts` | Track workspace connections | ~30 |

### 4.3 REST API Documentation (Week 10)

OpenAPI 3.1 spec auto-generated from routes. Interactive docs at `/docs/api`. TypeScript SDK published to npm as `@workermill/sdk`.

### 4.4 Published Benchmarks (Week 11)

Anonymized data from showcase projects and internal usage:
- PR merge rate by stack/complexity
- Average cost per successfully merged PR
- Quality comparison across models
- Time-to-completion distributions

---

## Phase 5: Ecosystem & Monetization (Weeks 12+)

### 5.1 Open-Source Worker Core

Open-source the worker directives and execution scripts:
- Build community trust ("I can see what the AI does to my code")
- Enable customization without forking
- Create contributor ecosystem for personas

The orchestration intelligence (planning agent, coordinator, blocker manager, quality gates) stays closed-source and server-side.

### 5.2 Pricing & Feature Gating

Revenue comes from usage limits and feature gating, not from LLM costs (which are user-paid in local mode).

| | Pro ($19/mo) | Max ($39/mo) | Team ($99/mo) | Enterprise |
|---|---|---|---|---|
| **Plan previews** | 5/day | Unlimited | Unlimited | Unlimited |
| **Builds (local mode)** | Unlimited | Unlimited | Unlimited | Unlimited |
| **Concurrent workers** | 1 | 5 | 8 | Custom |
| **Stories per build** | 8 max | Unlimited | Unlimited | Unlimited |
| **Tech lead review** | No | Yes | Yes | Yes |
| **Skill/memory system** | No | Yes | Yes | Yes |
| **Advanced quality gates** | Basic only | Full | Full | Full |
| **Team dashboard** | No | No | Yes | Yes |
| **Cloud mode credits** | None | $25 included | $100 included | Custom |
| **Priority support** | No | Email | Priority | Dedicated |
| **SSO/SAML** | No | No | No | Yes |
| **Audit logs** | No | No | Basic | Full |

**Key insight:** Pro tier users can build real projects with 1 worker and up to 8 stories per build. The limits push power users to Max. Teams need the team dashboard. Enterprise needs SSO and audit logs.

**Cloud mode** is an add-on for users who don't want to run Docker locally. Cloud credits cover LLM + compute costs. BYOK users pay only for compute.

### 5.3 Enterprise Features

- SAML SSO
- Enhanced audit logs
- VPC deployment (dedicated cloud workers)
- SLA guarantees
- Priority support

---

## Technical Debt to Address in Parallel

### Priority 1: Test Coverage (Ongoing)

| Test File | Covers | Priority |
|-----------|--------|----------|
| `api/src/routes/build.test.ts` | New build endpoints | Immediate |
| `api/src/services/build-planner.test.ts` | Planning adapter | Immediate |
| `api/src/services/orchestrator.test.ts` | Task claiming, lifecycle | High |
| `api/src/routes/billing.test.ts` | Checkout, usage, webhooks | High |
| `api/src/routes/webhooks.test.ts` | All webhook providers | Medium |

### Priority 2: Component Decomposition

| Component | Target |
|-----------|--------|
| `Settings.tsx` (8,021 lines) | Split into `SettingsAI`, `SettingsSCM`, `SettingsBudget`, `SettingsQuality`, `SettingsTeam` |
| `Dashboard.tsx` (5,059 lines) | Split into `ActiveTasks`, `CompletedTasks`, `TaskDetail`, `DashboardStats` |

### Priority 3: Dev Environment

Activate the existing `dev` Terraform environment for testing migrations and webhooks.

---

## Success Metrics

### Phase 0 (Hybrid Foundation)

| Metric | Target |
|--------|--------|
| `npx workermill` → worker ready | < 2 minutes (first run, including Claude CLI install) |
| Subsequent `npx workermill` → worker ready | < 10 seconds |
| Story clone creation (from reference) | < 3 seconds |
| Worker → cloud API latency | < 100ms p95 |
| Zero Docker dependency | ✓ |

### Phase 1 (Build Page)

| Metric | Target |
|--------|--------|
| Description → plan preview | < 60 seconds |
| Plan preview → first story executing | < 3 minutes |
| Plan-to-PR time (medium complexity) | < 2 hours |
| Build page conversion (plan → execute) | > 50% |

### Phase 2 (Messaging)

| Metric | Target |
|--------|--------|
| Landing page bounce rate | < 50% |
| Signup conversion rate | > 5% of visitors |
| CLI installs per week | > 50 |

### Phase 3 (Showcase)

| Metric | Target |
|--------|--------|
| Showcase projects published | 5+ |
| Average quality score | > 80/100 |
| Showcase page views per week | > 500 |

### Phase 4 (Distribution)

| Metric | Target |
|--------|--------|
| GitHub App installations | > 50 in first month |
| Slack connections | > 20 in first month |
| npm CLI weekly downloads | > 200 |

---

## Implementation Order

```
Week 1:  CLI package scaffolding + workspace manager + worker API endpoints
Week 2:  Execution mode gate + CLI auth flow + end-to-end local execution
Week 3:  Stack templates + build planner adapter + build API endpoints
Week 4:  Build.tsx page + plan preview UI + execution mode selector
Week 5:  Landing page rewrite + Quick Start docs + showcase gallery component
Week 6:  Build 3-5 showcase projects using local mode
Week 7:  Showcase API + public task viewer + publish showcases
Week 8:  GitHub App scaffolding + installation flow
Week 9:  Slack integration + notifications
Week 10: REST API docs + TypeScript SDK
Week 11: Published benchmarks + additional showcases
Week 12: Cloud credits system + component decomposition
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| **Anthropic changes Claude Max OAuth** | BYOK (API key) mode as fallback; OAuth is used only via Claude CLI which Anthropic maintains; monitor Claude CLI changelog |
| **Anthropic blocks OAuth for this use case** | BYOK mode works with API keys via standard SDK; local mode becomes BYOK-only; $0 cost model still works for BYOK users |
| **Claude CLI subprocess is too slow for planning** | Planning runs once per build, not per-second; 30-60s is acceptable; parallelize with plan preview (Haiku shows quick estimate while full planning runs) |
| User doesn't have git or Node.js | CLI checks dependencies on startup; git is near-universal; Claude CLI needs Node.js which is auto-detected |
| Planning agent produces poor plans from vague descriptions | Stack templates constrain decisions; starter projects guide first experience; plan preview lets users edit |
| Workers fail on greenfield repos | Scaffolding story runs first; templates include known-good configs |
| Local worker connectivity issues | Retry logic on API calls; offline queue for transient failures; clear error messages |
| Cost of free plan previews at scale | Haiku at $0.03/preview; rate limit to 5/day for Pro tier; cache identical descriptions |
| IP extracted from Docker image | Image contains only execution scripts; all intelligence is server-side API calls |
| **Assembled planning prompt leaked from worker** | Prompt is disposable output, changes every time; the IP is the assembly logic + validation, not the prompt text itself; accepted risk |
| **Separate clones use too much disk** | `--reference` hardlinks objects from cached bare clone; for new projects repos are tiny; `cleanupTask()` deletes clones on completion |
| **WSL filesystem issues** | Workspace always on Linux-native FS (`~/`), never `/mnt/c/`; separate clones avoid shared `.git` corruption that plagued worktrees |

---

## What We're NOT Doing (Intentional Scope Cuts)

- **No local dashboard** — The dashboard lives exclusively on workermill.com. Local workers stream logs to the cloud API. Users see raw terminal output locally and the rich, organized dashboard view on workermill.com. Shipping the dashboard locally would give the product away.
- **No Docker requirement for local mode** — Separate git clones provide story isolation without Docker. Worktrees were tried and caused corruption on WSL. Docker remains used for cloud mode (ECS) where it works fine.
- **No parallel story execution in local mode** — Stories execute sequentially in dependency order. Separate clones provide clean per-story state, not parallelism. This eliminates all concurrency issues and is simpler to debug. Cloud mode retains parallelism via ECS containers.
- **No server-side OAuth LLM calls** — Anthropic SDK doesn't support OAuth tokens; all local-mode LLM calls go through Claude CLI on user's machine. This is validated and intentional, not a workaround.
- **No GitHub repo creation from WorkerMill** — user provides repo (avoids org/permissions complexity)
- **No mobile app** — web-only dashboard + CLI
- **No IDE plugin** — the dashboard IS the interface; CLI handles local execution
- **No multi-repo builds** — one repo per build execution for now
- **No offline/air-gapped mode** — workers always need workermill.com for orchestration (including log streaming, story dispatch, and quality gates)
- **No self-hosted cloud brain** — enterprise VPC deployment is Phase 5+

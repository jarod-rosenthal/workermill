# Execution Showcase Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an auto-playing animated step-through component that shows the full PRD → epics → execution → PR lifecycle on the landing page.

**Architecture:** Single `ExecutionShowcase.tsx` component with hardcoded frame data, a `useEffect` timer cycling through 7 frames, and sub-components for the VS Code shell, sidebar epic tree, and main content area. Placed in `LandingV0.tsx` after the BuildTerminal section.

**Tech Stack:** React 19, TailwindCSS, lucide-react icons, CSS transitions

---

### Task 1: Create the frame data and types

**Files:**
- Create: `frontend/src/components/ExecutionShowcase.tsx`

**Step 1: Create the file with types and frame data**

```tsx
import { useState, useEffect, useRef } from "react";
import {
  Lock,
  CheckCircle,
  Play,
  Shield,
  GitPullRequest,
  FileText,
  Terminal,
  Users,
  Loader2,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Epic {
  name: string;
  persona: string;
  status: "locked" | "active" | "planning" | "executing" | "review" | "done";
}

interface Frame {
  epics: Epic[];
  content: React.ReactNode;
  caption: string;
  duration: number;
}

// ─── Epic data (ShipAPI example) ────────────────────────────────────────────

const EPIC_NAMES = [
  { name: "Project Setup & Dev Environment", persona: "devops_engineer" },
  { name: "AWS Infrastructure via Terraform", persona: "devops_engineer" },
  { name: "CI/CD Pipelines (GitHub Actions)", persona: "devops_engineer" },
  { name: "Authentication System (JWT + API Key)", persona: "backend_developer" },
  { name: "Category & Product CRUD", persona: "backend_developer" },
  { name: "Stock Management & Audit Logging", persona: "backend_developer" },
];

export default function ExecutionShowcase() {
  return null; // placeholder
}
```

**Step 2: Verify type check**

Run: `cd /home/user/github/workermill/frontend && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add frontend/src/components/ExecutionShowcase.tsx
git commit -m "feat(showcase): scaffold ExecutionShowcase with types and epic data"
```

---

### Task 2: Build the VS Code shell and sidebar

**Files:**
- Modify: `frontend/src/components/ExecutionShowcase.tsx`

**Step 1: Add the VSCodeShell and EpicSidebar sub-components**

Replace the placeholder `export default` with these components and the main export. Add all of this code to the file, keeping the existing imports/types/data above:

```tsx
// ─── Persona colors ─────────────────────────────────────────────────────────

const PERSONA_COLORS: Record<string, string> = {
  devops_engineer: "text-emerald-400",
  backend_developer: "text-blue-400",
  frontend_developer: "text-violet-400",
  qa_engineer: "text-amber-400",
};

// ─── EpicSidebar ────────────────────────────────────────────────────────────

function EpicSidebar({ epics }: { epics: Epic[] }) {
  return (
    <div className="w-full lg:w-[35%] bg-[#252526] border-r border-white/5 p-3 flex flex-col gap-1 overflow-hidden">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 px-2 py-1">
        Epics
      </div>
      {epics.map((epic, i) => (
        <div
          key={i}
          className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-all duration-500 ${
            epic.status === "active" || epic.status === "planning" || epic.status === "executing" || epic.status === "review"
              ? "bg-blue-500/10 text-white"
              : epic.status === "done"
                ? "text-slate-500"
                : "text-slate-600"
          }`}
        >
          {/* Status icon */}
          <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
            {epic.status === "locked" && (
              <Lock className="w-3 h-3 text-orange-400/70" />
            )}
            {epic.status === "done" && (
              <CheckCircle className="w-3 h-3 text-emerald-500" />
            )}
            {(epic.status === "active" || epic.status === "planning") && (
              <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
            )}
            {epic.status === "executing" && (
              <Play className="w-3 h-3 text-blue-400 fill-blue-400" />
            )}
            {epic.status === "review" && (
              <Shield className="w-3 h-3 text-violet-400" />
            )}
          </div>

          {/* Epic name (truncated) */}
          <span className="truncate">{epic.name}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main component (placeholder content area) ─────────────────────────────

export default function ExecutionShowcase() {
  const epics: Epic[] = EPIC_NAMES.map((e, i) => ({
    ...e,
    status: i === 0 ? "executing" : i < 3 ? "done" : "locked",
  }));

  return (
    <section className="py-20 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-blue-950/5 to-transparent" />

      <div className="relative container mx-auto px-6 lg:px-8">
        {/* Section header */}
        <div className="max-w-3xl mx-auto text-center mb-12">
          <p className="text-sm font-medium text-blue-400 mb-3 tracking-wide">
            FROM PRD TO PR
          </p>
          <h2 className="text-3xl lg:text-4xl font-bold tracking-tight text-white mb-4 text-balance">
            One document in.{" "}
            <span className="bg-gradient-to-r from-blue-400 to-teal-400 bg-clip-text text-transparent">
              Production code out.
            </span>
          </h2>
          <p className="text-lg text-slate-400 leading-relaxed">
            Drop a PRD, walk away. WorkerMill decomposes it into epics, sequences
            the work, and executes each one &mdash; planned, coded, tested, and
            reviewed.
          </p>
        </div>

        {/* VS Code frame */}
        <div className="max-w-5xl mx-auto">
          <div className="relative">
            {/* Glow */}
            <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/20 via-violet-500/10 to-blue-500/20 rounded-2xl blur-xl opacity-60" />

            {/* VS Code chrome */}
            <div className="relative bg-[#1e1e1e] rounded-xl border border-white/10 overflow-hidden shadow-2xl">
              {/* Title bar */}
              <div className="flex items-center gap-2 px-4 py-2.5 bg-[#323233] border-b border-white/5">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500/80" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                  <div className="w-3 h-3 rounded-full bg-green-500/80" />
                </div>
                <div className="flex-1 ml-3 flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.583 2.603L12.2 7.28l-4.041-3.06L2 7.38v9.24l6.16 3.16 4.04-3.06 5.382 4.677L24 18.24V5.76l-6.417-3.157zM8.16 15.38L4.4 13.2V10.8l3.76-2.18v6.76zm9.44-.54l-3.76 2.18V7.18l3.76-2.18v9.84z" />
                  </svg>
                  <span className="text-xs text-slate-400">
                    ShipAPI &mdash; Visual Studio Code
                  </span>
                </div>
              </div>

              {/* Body: sidebar + content */}
              <div className="flex min-h-[320px] lg:min-h-[380px]">
                <EpicSidebar epics={epics} />
                <div className="flex-1 p-4 flex items-center justify-center text-slate-500 text-sm">
                  Content area — will be replaced in Task 3
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
```

**Step 2: Verify type check**

Run: `cd /home/user/github/workermill/frontend && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add frontend/src/components/ExecutionShowcase.tsx
git commit -m "feat(showcase): add VS Code shell, epic sidebar with status icons"
```

---

### Task 3: Build the 7 frame content renderers

**Files:**
- Modify: `frontend/src/components/ExecutionShowcase.tsx`

**Step 1: Add frame content components**

Add these components above the main `ExecutionShowcase` export. These render the right-side content for each frame:

```tsx
// ─── Frame content renderers ────────────────────────────────────────────────

function ContextMenuContent() {
  return (
    <div className="flex-1 p-4 relative">
      {/* Fake file content (blurred) */}
      <div className="space-y-2 opacity-30">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex gap-2">
            <div className="h-3 bg-slate-700 rounded" style={{ width: `${60 + Math.random() * 120}px` }} />
            <div className="h-3 bg-slate-700/50 rounded" style={{ width: `${40 + Math.random() * 80}px` }} />
          </div>
        ))}
      </div>

      {/* Context menu overlay */}
      <div className="absolute top-8 left-1/3 bg-[#2d2d30] border border-white/10 rounded-lg shadow-2xl py-1 w-64 z-10">
        {["Open Preview", "Copy Path", "Reveal in Explorer"].map((item) => (
          <div key={item} className="px-4 py-1.5 text-xs text-slate-400 hover:bg-white/5">
            {item}
          </div>
        ))}
        <div className="border-t border-white/10 my-1" />
        <div className="px-4 py-1.5 text-xs text-blue-400 bg-blue-500/10 font-medium flex items-center gap-2">
          <Play className="w-3 h-3" />
          WorkerMill: Build from PRD
        </div>
        <div className="px-4 py-1.5 text-xs text-slate-400 hover:bg-white/5">
          Find File References
        </div>
      </div>
    </div>
  );
}

function DecomposingContent() {
  return (
    <div className="flex-1 p-4 font-mono text-xs space-y-1.5 overflow-hidden">
      <div className="text-slate-500">$ workermill build --from-prd SHIPAPI_PRD.md</div>
      <div className="text-blue-400">Decomposing PRD into epics...</div>
      <div className="text-slate-400">  Analyzing requirements and dependencies</div>
      <div className="text-slate-400">  Identifying scope boundaries</div>
      <div className="text-emerald-400">Found 6 epics with sequential dependencies</div>
      <div className="text-slate-400">  1. Project Setup & Dev Environment</div>
      <div className="text-slate-400">  2. AWS Infrastructure via Terraform</div>
      <div className="text-slate-400">  3. CI/CD Pipelines (GitHub Actions)</div>
      <div className="text-slate-400">  4. Authentication System (JWT + API Key)</div>
      <div className="text-slate-400">  5. Category & Product CRUD</div>
      <div className="text-slate-400">  6. Stock Management & Audit Logging</div>
      <div className="text-blue-400">Creating board: ShipAPI - Full Build & Deployment</div>
      <div className="text-emerald-400">Queued epic 1 of 6 — starting execution</div>
    </div>
  );
}

function PlanningContent() {
  return (
    <div className="flex-1 p-4 font-mono text-xs space-y-1.5 overflow-hidden">
      <div className="flex items-center gap-2 text-blue-400 mb-2">
        <Loader2 className="w-3 h-3 animate-spin" />
        Planning: Project Setup & Dev Environment
      </div>
      <div className="text-slate-400">Decomposing into stories...</div>
      <div className="text-slate-500 mt-2">Stories:</div>
      <div className="text-slate-400 pl-2">1. Initialize FastAPI project with uv</div>
      <div className="text-slate-400 pl-2">2. Docker Compose for PostgreSQL + Redis</div>
      <div className="text-slate-400 pl-2">3. Alembic migration setup</div>
      <div className="text-slate-400 pl-2">4. Health check + base config</div>
      <div className="text-emerald-400 mt-2">Plan approved (score: 92/100)</div>
      <div className="text-blue-400">Starting parallel execution...</div>
    </div>
  );
}

function ExecutingContent() {
  const stories = [
    { name: "Initialize FastAPI project", persona: "devops_engineer", progress: 100 },
    { name: "Docker Compose setup", persona: "devops_engineer", progress: 85 },
    { name: "Alembic migration setup", persona: "backend_developer", progress: 60 },
    { name: "Health check + base config", persona: "backend_developer", progress: 30 },
  ];

  return (
    <div className="flex-1 p-4 space-y-3 overflow-hidden">
      <div className="flex items-center gap-2 text-xs text-blue-400 font-medium">
        <Users className="w-3 h-3" />
        Parallel expert execution
      </div>
      {stories.map((story, i) => (
        <div key={i} className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-300 truncate mr-2">{story.name}</span>
            <span className={`text-[10px] ${PERSONA_COLORS[story.persona] || "text-slate-400"}`}>
              {story.persona.replace("_", " ")}
            </span>
          </div>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-1000"
              style={{ width: `${story.progress}%` }}
            />
          </div>
        </div>
      ))}
      <div className="font-mono text-[10px] text-slate-600 mt-2 space-y-0.5">
        <div>devops_engineer: Created Dockerfile with multi-stage build</div>
        <div>backend_developer: Added SQLAlchemy models for base tables</div>
      </div>
    </div>
  );
}

function ReviewContent() {
  return (
    <div className="flex-1 p-4 space-y-3 overflow-hidden">
      <div className="flex items-center gap-2 text-xs text-violet-400 font-medium">
        <Shield className="w-3 h-3" />
        Tech Lead Review
      </div>
      <div className="bg-violet-500/10 border border-violet-500/20 rounded-lg p-3 text-xs">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-3 h-3 text-violet-400" />
          <span className="font-medium text-violet-300">Tech Lead</span>
          <span className="text-[10px] text-slate-500">Agent</span>
        </div>
        <p className="text-slate-400 leading-relaxed">
          "Clean implementation. Docker setup is correct, Alembic config follows
          project conventions. All 4 stories passing tests. Approving."
        </p>
      </div>
      <div className="flex items-center gap-2 text-emerald-400 text-xs font-medium">
        <CheckCircle className="w-3 h-3" />
        Approved — epic 1 complete. Unlocking epic 2.
      </div>
    </div>
  );
}

function MontageContent() {
  return (
    <div className="flex-1 p-4 font-mono text-xs space-y-1.5 overflow-hidden">
      <div className="text-emerald-400">Epic 2: AWS Infrastructure via Terraform — complete</div>
      <div className="text-emerald-400">Epic 3: CI/CD Pipelines (GitHub Actions) — complete</div>
      <div className="text-emerald-400">Epic 4: Authentication System — complete</div>
      <div className="text-blue-400 flex items-center gap-2">
        <Loader2 className="w-3 h-3 animate-spin" />
        Epic 5: Category & Product CRUD — executing...
      </div>
      <div className="text-slate-600">Epic 6: Stock Management — queued</div>
      <div className="mt-3 text-slate-500 border-t border-white/5 pt-2">
        Elapsed: 4h 12m &middot; 6 epics &middot; 23 stories &middot; $301 API cost
      </div>
    </div>
  );
}

function CompleteContent() {
  return (
    <div className="flex-1 p-4 space-y-3 overflow-hidden flex flex-col items-center justify-center">
      <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center mb-2">
        <GitPullRequest className="w-6 h-6 text-emerald-400" />
      </div>
      <div className="text-lg font-semibold text-white">Build complete</div>
      <div className="text-sm text-slate-400 text-center">
        6 epics &middot; 23 stories &middot; All tests passing
      </div>
      <div className="mt-2 flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
        <GitPullRequest className="w-4 h-4 text-emerald-400" />
        <span className="text-sm text-emerald-400 font-medium">PR #42 ready for review</span>
      </div>
      <div className="text-xs text-slate-600 mt-1">
        github.com/acme/shipapi/pull/42
      </div>
    </div>
  );
}
```

**Step 2: Verify type check**

Run: `cd /home/user/github/workermill/frontend && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add frontend/src/components/ExecutionShowcase.tsx
git commit -m "feat(showcase): add 7 frame content renderers"
```

---

### Task 4: Wire up the frame timer and transitions

**Files:**
- Modify: `frontend/src/components/ExecutionShowcase.tsx`

**Step 1: Replace the main export with the frame cycling logic**

Replace the existing `export default function ExecutionShowcase()` and everything in it with:

```tsx
// ─── Frame definitions ──────────────────────────────────────────────────────

function buildFrames(): Frame[] {
  const base = EPIC_NAMES.map((e) => ({ ...e, status: "locked" as const }));

  return [
    {
      // Frame 1: Right-click PRD
      epics: base,
      content: <ContextMenuContent />,
      caption: "Right-click any PRD. One click to build.",
      duration: 3000,
    },
    {
      // Frame 2: Decomposing
      epics: base.map((e, i) => ({ ...e, status: i === 0 ? "active" : "locked" as Epic["status"] })),
      content: <DecomposingContent />,
      caption: "PRD decomposes into sequenced epics",
      duration: 4000,
    },
    {
      // Frame 3: Planning first epic
      epics: base.map((e, i) => ({ ...e, status: i === 0 ? "planning" : "locked" as Epic["status"] })),
      content: <PlanningContent />,
      caption: "Planning agent decomposes epic into stories",
      duration: 3000,
    },
    {
      // Frame 4: Executing stories
      epics: base.map((e, i) => ({ ...e, status: i === 0 ? "executing" : "locked" as Epic["status"] })),
      content: <ExecutingContent />,
      caption: "Parallel experts execute stories",
      duration: 4000,
    },
    {
      // Frame 5: Tech lead review, epic 1 done, epic 2 unlocks
      epics: base.map((e, i) => ({
        ...e,
        status: i === 0 ? "done" : i === 1 ? "active" : "locked" as Epic["status"],
      })),
      content: <ReviewContent />,
      caption: "Quality gate passed — next epic unlocks",
      duration: 3000,
    },
    {
      // Frame 6: Montage — several done, one executing
      epics: base.map((e, i) => ({
        ...e,
        status: i < 4 ? "done" : i === 4 ? "executing" : "locked" as Epic["status"],
      })),
      content: <MontageContent />,
      caption: "Epics complete autonomously in sequence",
      duration: 3000,
    },
    {
      // Frame 7: All done
      epics: base.map((e) => ({ ...e, status: "done" as const })),
      content: <CompleteContent />,
      caption: "Full build complete — PR ready for review",
      duration: 4000,
    },
  ];
}

// ─── Caption bar ────────────────────────────────────────────────────────────

function CaptionBar({ caption, frameIndex, totalFrames }: { caption: string; frameIndex: number; totalFrames: number }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 bg-[#1e1e1e] border-t border-white/5">
      <span className="text-xs text-slate-400">{caption}</span>
      <div className="flex gap-1">
        {Array.from({ length: totalFrames }).map((_, i) => (
          <div
            key={i}
            className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
              i === frameIndex ? "bg-blue-400" : "bg-slate-700"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function ExecutionShowcase() {
  const frames = useRef(buildFrames()).current;
  const [frameIndex, setFrameIndex] = useState(0);
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    const frame = frames[frameIndex];
    const timer = setTimeout(() => {
      setTransitioning(true);
      setTimeout(() => {
        setFrameIndex((prev) => (prev + 1) % frames.length);
        setTransitioning(false);
      }, 300); // crossfade duration
    }, frame.duration);

    return () => clearTimeout(timer);
  }, [frameIndex, frames]);

  const currentFrame = frames[frameIndex];

  return (
    <section className="py-20 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-blue-950/5 to-transparent" />

      <div className="relative container mx-auto px-6 lg:px-8">
        {/* Section header */}
        <div className="max-w-3xl mx-auto text-center mb-12">
          <p className="text-sm font-medium text-blue-400 mb-3 tracking-wide">
            FROM PRD TO PR
          </p>
          <h2 className="text-3xl lg:text-4xl font-bold tracking-tight text-white mb-4 text-balance">
            One document in.{" "}
            <span className="bg-gradient-to-r from-blue-400 to-teal-400 bg-clip-text text-transparent">
              Production code out.
            </span>
          </h2>
          <p className="text-lg text-slate-400 leading-relaxed">
            Drop a PRD, walk away. WorkerMill decomposes it into epics, sequences
            the work, and executes each one &mdash; planned, coded, tested, and
            reviewed.
          </p>
        </div>

        {/* VS Code frame */}
        <div className="max-w-5xl mx-auto">
          <div className="relative">
            {/* Glow */}
            <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/20 via-violet-500/10 to-blue-500/20 rounded-2xl blur-xl opacity-60" />

            {/* VS Code chrome */}
            <div className="relative bg-[#1e1e1e] rounded-xl border border-white/10 overflow-hidden shadow-2xl">
              {/* Title bar */}
              <div className="flex items-center gap-2 px-4 py-2.5 bg-[#323233] border-b border-white/5">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500/80" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                  <div className="w-3 h-3 rounded-full bg-green-500/80" />
                </div>
                <div className="flex-1 ml-3 flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.583 2.603L12.2 7.28l-4.041-3.06L2 7.38v9.24l6.16 3.16 4.04-3.06 5.382 4.677L24 18.24V5.76l-6.417-3.157zM8.16 15.38L4.4 13.2V10.8l3.76-2.18v6.76zm9.44-.54l-3.76 2.18V7.18l3.76-2.18v9.84z" />
                  </svg>
                  <span className="text-xs text-slate-400">
                    ShipAPI &mdash; Visual Studio Code
                  </span>
                </div>
              </div>

              {/* Body: sidebar + content */}
              <div className="flex min-h-[320px] lg:min-h-[380px]">
                {/* Sidebar — hidden on small screens */}
                <div className="hidden lg:block">
                  <EpicSidebar epics={currentFrame.epics} />
                </div>

                {/* Content area with crossfade */}
                <div
                  className={`flex-1 transition-opacity duration-300 ${
                    transitioning ? "opacity-0" : "opacity-100"
                  }`}
                >
                  {currentFrame.content}
                </div>
              </div>

              {/* Caption bar */}
              <CaptionBar
                caption={currentFrame.caption}
                frameIndex={frameIndex}
                totalFrames={frames.length}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
```

**Step 2: Remove the duplicate section header and shell from Task 2's version**

Make sure there is only ONE `export default function ExecutionShowcase` in the file. Delete the Task 2 version entirely and keep only this Task 4 version which includes the full section header, VS Code shell, sidebar, frame timer, and transitions.

**Step 3: Verify type check**

Run: `cd /home/user/github/workermill/frontend && npx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add frontend/src/components/ExecutionShowcase.tsx
git commit -m "feat(showcase): wire up frame timer, transitions, and caption bar"
```

---

### Task 5: Wire into LandingV0

**Files:**
- Modify: `frontend/src/pages/LandingV0.tsx`

**Step 1: Add import**

Add to the imports in `LandingV0.tsx` (near the other component imports around line 11-14):

```tsx
import ExecutionShowcase from "../components/ExecutionShowcase";
```

**Step 2: Place component after BuildTerminal section**

Find the closing of the BuildTerminal section (the `</section>` after the starter template pills, around line 196). Insert `ExecutionShowcase` between that `</section>` and the Showcase Section comment:

```tsx
          </section>

          {/* Execution lifecycle animation */}
          <ExecutionShowcase />

          {/* Showcase Section */}
          <div id="showcase" ref={showcaseRef}>
```

**Step 3: Verify type check**

Run: `cd /home/user/github/workermill/frontend && npx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add frontend/src/pages/LandingV0.tsx
git commit -m "feat: place ExecutionShowcase after BuildTerminal on homepage"
```

---

### Task 6: Visual verification and polish

**Step 1: Start dev server if not running**

Run: `cd /home/user/github/workermill/frontend && npm run dev`

**Step 2: Verify in browser**

Open http://localhost:5173 and scroll past the BuildTerminal. Verify:
- Section header "FROM PRD TO PR" / "One document in. Production code out." renders
- VS Code frame with title bar, sidebar, and content area renders
- Frames auto-advance every 3-4 seconds with crossfade transitions
- Sidebar epic statuses update per frame (locks → spinners → checkmarks)
- Caption bar updates with frame description and dot indicators
- After frame 7, loops back to frame 1
- On mobile/small screens, sidebar is hidden, content still works

**Step 3: Run type check one final time**

Run: `cd /home/user/github/workermill/frontend && npx tsc --noEmit`
Expected: no errors

**Step 4: Commit any polish tweaks**

```bash
git add frontend/src/components/ExecutionShowcase.tsx
git commit -m "fix: polish ExecutionShowcase spacing and transitions"
```

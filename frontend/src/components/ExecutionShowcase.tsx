import { useState, useEffect, useRef, useCallback } from "react";
import {
  Lock,
  CheckCircle2,
  Play,
  Shield,
  GitPullRequest,
  Loader2,
  FileText,
  Cpu,
  Rocket,
  Zap,
  ChevronRight,
  Terminal,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Epic {
  name: string;
  shortName: string;
  persona: string;
  status: "locked" | "active" | "planning" | "executing" | "review" | "done";
}

// ─── Step definitions (Railway-style labeled tabs) ──────────────────────────

const STEPS = [
  { label: "PRD", icon: FileText },
  { label: "Decompose", icon: Zap },
  { label: "Plan", icon: Cpu },
  { label: "Execute", icon: Play },
  { label: "Review", icon: Shield },
  { label: "Progress", icon: Rocket },
  { label: "Ship", icon: GitPullRequest },
] as const;

// ─── Epic data (ShipAPI example) ────────────────────────────────────────────

const EPIC_NAMES = [
  { name: "Project Setup & Dev Environment", shortName: "Project Setup", persona: "devops_engineer" },
  { name: "AWS Infrastructure via Terraform", shortName: "AWS Infra", persona: "devops_engineer" },
  { name: "CI/CD Pipelines (GitHub Actions)", shortName: "CI/CD Pipelines", persona: "devops_engineer" },
  { name: "Authentication System (JWT + API Key)", shortName: "Auth System", persona: "backend_developer" },
  { name: "Category & Product CRUD", shortName: "Product CRUD", persona: "backend_developer" },
  { name: "Stock Management & Audit Logging", shortName: "Stock & Audit", persona: "backend_developer" },
];

// ─── Persona colors ─────────────────────────────────────────────────────────

const PERSONA_COLORS: Record<string, string> = {
  devops_engineer: "text-emerald-400",
  backend_developer: "text-blue-400",
};

const PERSONA_BG: Record<string, string> = {
  devops_engineer: "bg-emerald-500/20",
  backend_developer: "bg-blue-500/20",
};

const PERSONA_BORDER: Record<string, string> = {
  devops_engineer: "border-emerald-500/30",
  backend_developer: "border-blue-500/30",
};

// ─── Frame durations ────────────────────────────────────────────────────────

const FRAME_DURATIONS = [3500, 4000, 3500, 4500, 3500, 3000, 5000];

// ─── EpicSidebar ────────────────────────────────────────────────────────────

function EpicSidebar({ epics }: { epics: Epic[] }) {
  return (
    <div className="w-[200px] min-w-[200px] bg-[***REMOVED***1a1a1c] border-r border-white/[0.06] py-4 px-2.5 flex flex-col gap-0.5 overflow-hidden">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 px-2 mb-2">
        Epics
      </div>
      {epics.map((epic, i) => {
        const isActive =
          epic.status === "active" ||
          epic.status === "planning" ||
          epic.status === "executing" ||
          epic.status === "review";
        const isDone = epic.status === "done";
        return (
          <div
            key={i}
            className={`flex items-center gap-2.5 px-2 py-[7px] rounded-md text-[11px] leading-tight transition-all duration-500 ${
              isActive
                ? "bg-blue-500/10 text-white"
                : isDone
                  ? "text-slate-500"
                  : "text-slate-600"
            }`}
          >
            <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
              {epic.status === "locked" && (
                <Lock className="w-3 h-3 text-slate-600" />
              )}
              {isDone && (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              )}
              {(epic.status === "active" || epic.status === "planning") && (
                <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
              )}
              {epic.status === "executing" && (
                <Play className="w-3 h-3 text-blue-400 fill-blue-400" />
              )}
              {epic.status === "review" && (
                <Shield className="w-3.5 h-3.5 text-violet-400" />
              )}
            </div>
            <span className="truncate">{epic.shortName}</span>
            {isActive && (
              <span
                className={`ml-auto flex-shrink-0 w-1.5 h-1.5 rounded-full ${PERSONA_BG[epic.persona]?.replace("/20", "") || "bg-slate-400"}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Frame content renderers ────────────────────────────────────────────────

function ContextMenuContent() {
  return (
    <div className="flex-1 relative flex flex-col overflow-hidden">
      {/* File tab bar */}
      <div className="flex items-center bg-[***REMOVED***1a1a1c] border-b border-white/[0.06]">
        <div className="px-4 py-2.5 text-[11px] text-blue-400 bg-[***REMOVED***1e1e1e] border-b-2 border-blue-400/60 font-medium">
          SHIPAPI_PRD.md
        </div>
        <div className="px-4 py-2.5 text-[11px] text-slate-600">
          README.md
        </div>
      </div>

      {/* Editor area */}
      <div className="flex-1 p-5 relative">
        {/* Fake markdown with gutter */}
        <div className="space-y-[7px]">
          <div className="flex gap-4">
            <span className="text-slate-700 text-[10px] font-mono w-5 text-right select-none">
              1
            </span>
            <div className="h-3.5 bg-blue-400/15 rounded w-56" />
          </div>
          <div className="flex gap-4">
            <span className="text-slate-700 text-[10px] font-mono w-5 text-right select-none">
              2
            </span>
            <div className="h-3.5" />
          </div>
          {[
            [180, 80],
            [90, 120],
            [150, 60],
            [110, 100],
            [140, 70],
            [70, 150],
            [160, 50],
            [100, 130],
            [120, 90],
            [80, 110],
          ].map(([w1, w2], i) => (
            <div key={i} className="flex gap-4">
              <span className="text-slate-700 text-[10px] font-mono w-5 text-right select-none">
                {i + 3}
              </span>
              <div className="flex gap-2">
                <div
                  className="h-3.5 bg-slate-700/40 rounded"
                  style={{ width: w1 }}
                />
                <div
                  className="h-3.5 bg-slate-700/20 rounded"
                  style={{ width: w2 }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Context menu */}
        <div className="absolute top-14 left-[38%] bg-[***REMOVED***2d2d30] border border-white/10 rounded-lg shadow-2xl shadow-black/40 py-1.5 w-60 z-10">
          {["Open Preview", "Copy Path", "Reveal in Explorer"].map((item) => (
            <div
              key={item}
              className="px-4 py-1.5 text-[11px] text-slate-400 hover:bg-white/5"
            >
              {item}
            </div>
          ))}
          <div className="border-t border-white/[0.08] my-1" />
          <div className="px-3 py-2 mx-1.5 text-[11px] text-blue-300 bg-blue-500/15 font-medium flex items-center gap-2 rounded-md">
            <Play className="w-3 h-3 fill-blue-300" />
            WorkerMill: Build from PRD
          </div>
          <div className="border-t border-white/[0.08] my-1" />
          <div className="px-4 py-1.5 text-[11px] text-slate-500">
            Find File References
          </div>
        </div>
      </div>
    </div>
  );
}

function DecomposingContent() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Terminal tab */}
      <div className="flex items-center bg-[***REMOVED***1a1a1c] border-b border-white/[0.06]">
        <div className="px-4 py-2.5 text-[11px] text-slate-300 bg-[***REMOVED***1e1e1e] border-b-2 border-blue-400/60 font-medium flex items-center gap-1.5">
          <Terminal className="w-3 h-3" />
          Terminal
        </div>
      </div>

      <div className="flex-1 p-5 font-mono text-[11px] leading-[1.8] overflow-hidden">
        <div className="text-slate-500">
          $ workermill build --from-prd SHIPAPI_PRD.md
        </div>
        <div className="h-3" />
        <div className="text-blue-400">Decomposing PRD into epics...</div>
        <div className="text-slate-600 pl-3">
          Analyzing requirements and dependencies
        </div>
        <div className="text-slate-600 pl-3">
          Identifying scope boundaries
        </div>
        <div className="h-3" />
        <div className="text-emerald-400">
          Found 6 epics with sequential dependencies
        </div>
        <div className="h-1" />
        {EPIC_NAMES.map((e, i) => (
          <div key={i} className="flex items-center gap-2 text-slate-400 pl-3">
            <span className="text-slate-600 w-3 text-right">{i + 1}.</span>
            <span>{e.name}</span>
          </div>
        ))}
        <div className="h-3" />
        <div className="text-slate-500">
          Creating board:{" "}
          <span className="text-blue-400">
            ShipAPI &mdash; Full Build &amp; Deployment
          </span>
        </div>
        <div className="text-emerald-400">
          Queued epic 1 of 6 &mdash; starting execution
          <span className="animate-pulse"> _</span>
        </div>
      </div>
    </div>
  );
}

function PlanningContent() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between bg-[***REMOVED***1a1a1c] border-b border-white/[0.06] px-5 py-2.5">
        <div className="flex items-center gap-2 text-[11px] text-blue-400 font-medium">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Planning: Project Setup &amp; Dev Environment
        </div>
        <div className="text-[10px] text-slate-600 font-mono">
          Epic 1 of 6
        </div>
      </div>

      <div className="flex-1 p-5 overflow-hidden flex flex-col gap-4">
        {/* Stories */}
        <div className="bg-white/[0.02] rounded-lg border border-white/[0.06] p-4 space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-600 font-semibold">
            Stories
          </div>
          {[
            { name: "Initialize FastAPI project with uv", files: 5 },
            { name: "Docker Compose for PostgreSQL + Redis", files: 3 },
            { name: "Alembic migration setup", files: 4 },
            { name: "Health check + base config", files: 3 },
          ].map((s, i) => (
            <div key={i} className="flex items-center gap-3 text-xs">
              <div className="w-5 h-5 rounded bg-blue-500/10 flex items-center justify-center text-[10px] text-blue-400 font-mono font-medium">
                {i + 1}
              </div>
              <span className="text-slate-300 flex-1">{s.name}</span>
              <span className="text-[10px] text-slate-600">
                {s.files} files
              </span>
            </div>
          ))}
        </div>

        {/* Critic result */}
        <div className="bg-emerald-500/[0.04] border border-emerald-500/20 rounded-lg p-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-xs">
            <div className="w-6 h-6 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <span className="text-emerald-400 font-medium">
              Plan approved by critic agent
            </span>
          </div>
          <div className="px-2.5 py-1 bg-emerald-500/10 rounded-full text-[10px] text-emerald-400 font-mono font-bold">
            92/100
          </div>
        </div>

        <div className="text-xs text-blue-400 font-medium flex items-center gap-2">
          <Play className="w-3 h-3 fill-blue-400" />
          Starting parallel execution...
        </div>
      </div>
    </div>
  );
}

function ExecutingContent() {
  const stories = [
    {
      name: "Initialize FastAPI project",
      persona: "devops_engineer",
      progress: 100,
      done: true,
    },
    {
      name: "Docker Compose setup",
      persona: "devops_engineer",
      progress: 85,
      done: false,
    },
    {
      name: "Alembic migration setup",
      persona: "backend_developer",
      progress: 55,
      done: false,
    },
    {
      name: "Health check + base config",
      persona: "backend_developer",
      progress: 20,
      done: false,
    },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between bg-[***REMOVED***1a1a1c] border-b border-white/[0.06] px-5 py-2.5">
        <div className="flex items-center gap-2 text-[11px] text-blue-400 font-medium">
          <Zap className="w-3.5 h-3.5" />
          Parallel expert execution
        </div>
        <div className="text-[10px] text-slate-600 font-mono">
          4 stories &middot; 2 experts
        </div>
      </div>

      <div className="flex-1 p-5 overflow-hidden flex flex-col gap-3">
        {/* Story cards */}
        <div className="space-y-2.5 flex-1">
          {stories.map((story, i) => (
            <div
              key={i}
              className={`rounded-lg border p-3 transition-all ${
                story.done
                  ? "bg-emerald-500/[0.03] border-emerald-500/15"
                  : `${PERSONA_BG[story.persona] || "bg-white/5"} ${PERSONA_BORDER[story.persona] || "border-white/10"}`
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-xs">
                  {story.done ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                  )}
                  <span
                    className={
                      story.done ? "text-slate-500" : "text-slate-200"
                    }
                  >
                    {story.name}
                  </span>
                </div>
                <span
                  className={`text-[10px] font-medium ${PERSONA_COLORS[story.persona] || "text-slate-400"}`}
                >
                  {story.persona.replace(/_/g, " ")}
                </span>
              </div>
              <div className="h-1 bg-black/20 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-1000 ${
                    story.done ? "bg-emerald-500/70" : "bg-blue-400/80"
                  }`}
                  style={{ width: `${story.progress}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Live log */}
        <div className="bg-black/20 rounded-lg border border-white/[0.06] p-3 font-mono text-[10px] text-slate-500 space-y-1.5">
          <div>
            <span className="text-emerald-400/80">devops_engineer</span>{" "}
            <ChevronRight className="w-2.5 h-2.5 inline text-slate-700" />{" "}
            Created Dockerfile with multi-stage build
          </div>
          <div>
            <span className="text-blue-400/80">backend_developer</span>{" "}
            <ChevronRight className="w-2.5 h-2.5 inline text-slate-700" />{" "}
            Added SQLAlchemy models for base tables
          </div>
          <div>
            <span className="text-emerald-400/80">devops_engineer</span>{" "}
            <ChevronRight className="w-2.5 h-2.5 inline text-slate-700" />{" "}
            Configured docker-compose.yml with health checks
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewContent() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between bg-[***REMOVED***1a1a1c] border-b border-white/[0.06] px-5 py-2.5">
        <div className="flex items-center gap-2 text-[11px] text-violet-400 font-medium">
          <Shield className="w-3.5 h-3.5" />
          Tech Lead Review
        </div>
        <div className="text-[10px] text-emerald-400 font-medium">
          Approved
        </div>
      </div>

      <div className="flex-1 p-5 overflow-hidden flex flex-col gap-4">
        {/* Review card */}
        <div className="bg-violet-500/[0.04] border border-violet-500/20 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500/30 to-violet-600/20 flex items-center justify-center ring-1 ring-violet-500/20">
              <Shield className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <div className="text-xs font-medium text-violet-300">
                Tech Lead
              </div>
              <div className="text-[10px] text-slate-600">AI Agent</div>
            </div>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed pl-11">
            &ldquo;Clean implementation. Docker setup is correct, Alembic config
            follows project conventions. All 4 stories passing tests.
            Approving.&rdquo;
          </p>
        </div>

        {/* Checklist grid */}
        <div className="grid grid-cols-2 gap-2">
          {[
            "All tests passing",
            "Type check clean",
            "No security issues",
            "Conventions followed",
          ].map((item, i) => (
            <div
              key={i}
              className="flex items-center gap-2 text-xs bg-white/[0.02] rounded-md px-3 py-2 border border-white/[0.06]"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
              <span className="text-slate-400">{item}</span>
            </div>
          ))}
        </div>

        {/* Verdict */}
        <div className="bg-emerald-500/[0.06] border border-emerald-500/20 rounded-lg p-3.5 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <div className="text-xs text-emerald-400 font-medium">
              Epic 1 complete
            </div>
            <div className="text-[10px] text-emerald-400/60">
              Unlocking: AWS Infrastructure via Terraform
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MontageContent() {
  const epicProgress = [
    { name: "Project Setup", status: "done" as const },
    { name: "AWS Infrastructure", status: "done" as const },
    { name: "CI/CD Pipelines", status: "done" as const },
    { name: "Auth System", status: "done" as const },
    { name: "Product CRUD", status: "executing" as const },
    { name: "Stock & Audit", status: "locked" as const },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between bg-[***REMOVED***1a1a1c] border-b border-white/[0.06] px-5 py-2.5">
        <div className="text-[11px] text-white font-medium">Build Progress</div>
        <div className="text-[10px] text-emerald-400 font-mono">5/6 epics</div>
      </div>

      <div className="flex-1 p-5 overflow-hidden flex gap-5">
        {/* Epic list */}
        <div className="flex-1 space-y-2">
          {epicProgress.map((epic, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 text-xs rounded-md px-3 py-2.5 border transition-all ${
                epic.status === "done"
                  ? "bg-emerald-500/[0.04] border-emerald-500/15"
                  : epic.status === "executing"
                    ? "bg-blue-500/[0.06] border-blue-500/20"
                    : "bg-transparent border-white/[0.04]"
              }`}
            >
              {epic.status === "done" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
              ) : epic.status === "executing" ? (
                <Loader2 className="w-4 h-4 text-blue-400 animate-spin flex-shrink-0" />
              ) : (
                <Lock className="w-4 h-4 text-slate-700 flex-shrink-0" />
              )}
              <span
                className={
                  epic.status === "done"
                    ? "text-emerald-400/70"
                    : epic.status === "executing"
                      ? "text-white font-medium"
                      : "text-slate-600"
                }
              >
                {epic.name}
              </span>
            </div>
          ))}
        </div>

        {/* Stats panel */}
        <div className="w-[160px] flex flex-col gap-3">
          {[
            { label: "Elapsed", value: "4h 12m", color: "text-white" },
            { label: "Stories", value: "23", color: "text-blue-400" },
            { label: "Tests", value: "142 pass", color: "text-emerald-400" },
            { label: "API cost", value: "$301", color: "text-amber-400" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-3"
            >
              <div className={`text-lg font-bold ${stat.color}`}>
                {stat.value}
              </div>
              <div className="text-[10px] text-slate-600">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CompleteContent() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 overflow-hidden p-8">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 border border-emerald-500/20 flex items-center justify-center">
        <GitPullRequest className="w-8 h-8 text-emerald-400" />
      </div>
      <div>
        <div className="text-2xl font-bold text-white text-center">
          Build complete
        </div>
        <div className="text-sm text-slate-500 text-center mt-1">
          6 epics &middot; 23 stories &middot; 142 tests passing
        </div>
      </div>
      <div className="flex items-center gap-3 px-6 py-3 bg-emerald-500/[0.08] border border-emerald-500/20 rounded-xl">
        <GitPullRequest className="w-5 h-5 text-emerald-400" />
        <div>
          <div className="text-sm text-emerald-300 font-semibold">
            PR ***REMOVED***42 ready for review
          </div>
          <div className="text-[11px] text-emerald-400/50 font-mono">
            github.com/acme/shipapi/pull/42
          </div>
        </div>
      </div>
      <div className="flex gap-6 mt-2 text-center">
        {[
          { label: "Time", value: "7h 23m" },
          { label: "Cost", value: "$301" },
          { label: "Files", value: "84" },
        ].map((s) => (
          <div key={s.label}>
            <div className="text-sm font-bold text-slate-300">{s.value}</div>
            <div className="text-[10px] text-slate-600">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Frame builder ──────────────────────────────────────────────────────────

interface Frame {
  epics: Epic[];
  content: React.ReactNode;
}

function buildFrames(): Frame[] {
  const base = EPIC_NAMES.map((e) => ({
    ...e,
    status: "locked" as const,
  }));

  return [
    { epics: base, content: <ContextMenuContent /> },
    {
      epics: base.map((e, i) => ({
        ...e,
        status: i === 0 ? ("active" as const) : ("locked" as const),
      })),
      content: <DecomposingContent />,
    },
    {
      epics: base.map((e, i) => ({
        ...e,
        status: i === 0 ? ("planning" as const) : ("locked" as const),
      })),
      content: <PlanningContent />,
    },
    {
      epics: base.map((e, i) => ({
        ...e,
        status: i === 0 ? ("executing" as const) : ("locked" as const),
      })),
      content: <ExecutingContent />,
    },
    {
      epics: base.map((e, i) => ({
        ...e,
        status:
          i === 0
            ? ("done" as const)
            : i === 1
              ? ("active" as const)
              : ("locked" as const),
      })),
      content: <ReviewContent />,
    },
    {
      epics: base.map((e, i) => ({
        ...e,
        status:
          i < 4
            ? ("done" as const)
            : i === 4
              ? ("executing" as const)
              : ("locked" as const),
      })),
      content: <MontageContent />,
    },
    {
      epics: base.map((e) => ({ ...e, status: "done" as const })),
      content: <CompleteContent />,
    },
  ];
}

// ─── Step tab bar (Railway-inspired) ────────────────────────────────────────

function StepTabs({
  activeIndex,
  onSelect,
  progress,
}: {
  activeIndex: number;
  onSelect: (i: number) => void;
  progress: number;
}) {
  return (
    <div className="flex items-center bg-[***REMOVED***141416] border-t border-white/[0.06] px-2 py-1.5 gap-0.5">
      {STEPS.map((step, i) => {
        const Icon = step.icon;
        const isActive = i === activeIndex;
        const isPast = i < activeIndex;
        return (
          <button
            key={step.label}
            onClick={() => onSelect(i)}
            className={`relative flex items-center gap-1.5 px-3 py-2 rounded-md text-[11px] font-medium transition-all cursor-pointer flex-1 justify-center ${
              isActive
                ? "text-white bg-white/[0.06]"
                : isPast
                  ? "text-slate-500 hover:text-slate-400 hover:bg-white/[0.03]"
                  : "text-slate-600 hover:text-slate-500 hover:bg-white/[0.02]"
            }`}
          >
            <Icon
              className={`w-3 h-3 flex-shrink-0 ${isActive ? "text-blue-400" : ""}`}
            />
            <span className="hidden sm:inline">{step.label}</span>
            {/* Active progress underline */}
            {isActive && (
              <div className="absolute bottom-0 left-1 right-1 h-[2px] bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-400/60 rounded-full transition-[width] duration-100 ease-linear"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function ExecutionShowcase() {
  const frames = useRef(buildFrames()).current;
  const [frameIndex, setFrameIndex] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [progress, setProgress] = useState(0);
  const startTimeRef = useRef(Date.now());

  const goToFrame = useCallback(
    (i: number) => {
      if (i === frameIndex) return;
      setTransitioning(true);
      setTimeout(() => {
        setFrameIndex(i);
        setTransitioning(false);
        setProgress(0);
        startTimeRef.current = Date.now();
      }, 250);
    },
    [frameIndex],
  );

  // Auto-advance timer
  useEffect(() => {
    const duration = FRAME_DURATIONS[frameIndex];
    startTimeRef.current = Date.now();
    setProgress(0);

    // Progress tick
    const tick = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      setProgress(Math.min((elapsed / duration) * 100, 100));
    }, 50);

    // Advance
    const timer = setTimeout(() => {
      goToFrame((frameIndex + 1) % frames.length);
    }, duration);

    return () => {
      clearInterval(tick);
      clearTimeout(timer);
    };
  }, [frameIndex, frames.length, goToFrame]);

  const currentFrame = frames[frameIndex];

  return (
    <section id="how-it-works" className="pb-20 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-blue-950/5 to-transparent" />

      <div className="relative container mx-auto px-6 lg:px-8">
        {/* Showcase frame */}
        <div className="max-w-6xl mx-auto">
          <div className="relative">
            {/* Glow */}
            <div className="absolute -inset-2 bg-gradient-to-r from-blue-500/15 via-violet-500/10 to-blue-500/15 rounded-2xl blur-2xl" />
            <div className="absolute -inset-1 bg-gradient-to-b from-blue-500/10 to-transparent rounded-2xl blur-xl" />

            <div className="relative bg-[***REMOVED***1e1e1e] rounded-xl border border-white/[0.08] overflow-hidden shadow-2xl shadow-black/50">
              {/* Title bar */}
              <div className="flex items-center gap-2 px-4 py-2.5 bg-[***REMOVED***1a1a1c] border-b border-white/[0.06]">
                <div className="flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-[***REMOVED***ff5f56]" />
                  <div className="w-3 h-3 rounded-full bg-[***REMOVED***ffbd2e]" />
                  <div className="w-3 h-3 rounded-full bg-[***REMOVED***27c93f]" />
                </div>
                <div className="flex-1 ml-4 flex items-center justify-center gap-2">
                  <svg
                    className="w-4 h-4 text-blue-400"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M17.583 2.603L12.2 7.28l-4.041-3.06L2 7.38v9.24l6.16 3.16 4.04-3.06 5.382 4.677L24 18.24V5.76l-6.417-3.157zM8.16 15.38L4.4 13.2V10.8l3.76-2.18v6.76zm9.44-.54l-3.76 2.18V7.18l3.76-2.18v9.84z" />
                  </svg>
                  <span className="text-[11px] text-slate-500">
                    ShipAPI &mdash; Visual Studio Code
                  </span>
                </div>
                <div className="w-[72px]" />
              </div>

              {/* Body: sidebar + content */}
              <div className="flex h-[400px] lg:h-[440px]">
                {/* Sidebar — hidden on mobile */}
                <div className="hidden lg:block">
                  <EpicSidebar epics={currentFrame.epics} />
                </div>

                {/* Content area with crossfade */}
                <div
                  className={`flex-1 flex transition-opacity duration-250 ${
                    transitioning ? "opacity-0" : "opacity-100"
                  }`}
                >
                  {currentFrame.content}
                </div>
              </div>

              {/* Step tabs (Railway-style) */}
              <StepTabs
                activeIndex={frameIndex}
                onSelect={goToFrame}
                progress={progress}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

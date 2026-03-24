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
  ChevronDown,
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
  { label: "Spec", icon: FileText },
  { label: "Decompose", icon: Zap },
  { label: "Plan", icon: Cpu },
  { label: "Execute", icon: Play },
  { label: "Review", icon: Shield },
  { label: "Progress", icon: Rocket },
  { label: "Ship", icon: GitPullRequest },
] as const;

// ─── Epic data (FlagDeck showcase) ──────────────────────────────────────────

const EPIC_NAMES = [
  { name: "Foundation — Backend API, Seed Data, CI & Docker", shortName: "Backend & API", persona: "backend_developer" },
  { name: "Frontend — SvelteKit UI, Components & Auth Flow", shortName: "Frontend UI", persona: "frontend_developer" },
  { name: "Deployment — Docker Infrastructure & Go-Live", shortName: "Deploy & Valid", persona: "devops_engineer" },
];

// ─── Frame durations ────────────────────────────────────────────────────────

const FRAME_DURATIONS = [3500, 4000, 3500, 4500, 3500, 3000, 5000];

// ─── VS Code Extension Sidebar ──────────────────────────────────────────────

function VsCodeSidebar({ epics }: { epics: Epic[] }) {
  const indexed = epics.map((e, i) => ({ ...e, idx: i }));
  const active = indexed.filter((e) =>
    ["planning", "executing", "review"].includes(e.status),
  );
  const backlog = indexed.filter((e) =>
    ["locked", "active"].includes(e.status),
  );
  const recent = indexed.filter((e) => e.status === "done");
  const maxBacklog = 8;
  const maxRecent = 3;

  return (
    <div className="w-[220px] min-w-[220px] bg-[#1a1a1c] border-r border-white/[0.06] overflow-hidden flex flex-col">
      {/* WORKERMILL section header */}
      <div className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500 border-b border-white/[0.04]">
        <div className="w-3 h-3 rounded-sm bg-teal-500/80" />
        WorkerMill
      </div>

      <div className="flex-1 overflow-hidden py-1 text-[10px]">
        {/* Active Tasks */}
        {active.length > 0 ? (
          <div className="mb-0.5">
            <div className="px-2 py-1 text-slate-600 font-medium flex items-center gap-0.5">
              <ChevronDown className="w-3 h-3" />
              Active Tasks ({active.length})
            </div>
            {active.map((e) => (
              <div
                key={e.idx}
                className="flex items-center gap-1.5 pl-5 pr-2 py-[3px] text-white transition-all duration-500"
              >
                {e.status === "planning" && (
                  <Loader2 className="w-3 h-3 text-amber-400 animate-spin flex-shrink-0" />
                )}
                {e.status === "executing" && (
                  <Loader2 className="w-3 h-3 text-blue-400 animate-spin flex-shrink-0" />
                )}
                {e.status === "review" && (
                  <Shield className="w-3 h-3 text-violet-400 flex-shrink-0" />
                )}
                <span className="truncate">
                  FDFBS-{e.idx + 1}: {e.shortName}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="pl-5 pr-2 py-1.5 text-slate-600 italic">
            No active tasks
          </div>
        )}

        {/* Backlog */}
        {backlog.length > 0 && (
          <div className="mb-0.5">
            <div className="px-2 py-1 text-slate-600 font-medium flex items-center gap-0.5">
              <ChevronDown className="w-3 h-3" />
              Backlog ({backlog.length})
            </div>
            {backlog.slice(0, maxBacklog).map((e) => (
              <div
                key={e.idx}
                className="flex items-center gap-1.5 pl-5 pr-2 py-[3px] text-slate-500 transition-all duration-500"
              >
                {e.status === "active" ? (
                  <Play className="w-2.5 h-2.5 text-blue-400 flex-shrink-0" />
                ) : (
                  <Lock className="w-2.5 h-2.5 text-slate-700 flex-shrink-0" />
                )}
                <span className="truncate flex-1">
                  FDFBS-{e.idx + 1}: {e.shortName}
                </span>
                {e.status === "locked" && (
                  <span className="text-[8px] text-slate-700 flex-shrink-0">
                    🔒
                  </span>
                )}
                {e.status === "active" && (
                  <span className="text-[8px] text-blue-400/60 flex-shrink-0">
                    🔓
                  </span>
                )}
              </div>
            ))}
            {backlog.length > maxBacklog && (
              <div className="pl-5 pr-2 py-[2px] text-slate-700 text-[9px]">
                ... {backlog.length - maxBacklog} more
              </div>
            )}
          </div>
        )}

        {/* Recent */}
        {recent.length > 0 && (
          <div>
            <div className="px-2 py-1 text-slate-600 font-medium flex items-center gap-0.5">
              <ChevronDown className="w-3 h-3" />
              Recent ({recent.length})
            </div>
            {recent.slice(0, maxRecent).map((e) => (
              <div
                key={e.idx}
                className="flex items-center gap-1.5 pl-5 pr-2 py-[3px] text-slate-500 transition-all duration-500"
              >
                <CheckCircle2 className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                <span className="truncate">
                  FDFBS-{e.idx + 1}: {e.shortName}
                </span>
              </div>
            ))}
            {recent.length > maxRecent && (
              <div className="pl-5 pr-2 py-[2px] text-slate-700 text-[9px]">
                ... {recent.length - maxRecent} more
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Frame content renderers ────────────────────────────────────────────────

function ContextMenuContent() {
  return (
    <div className="flex-1 relative flex flex-col overflow-hidden">
      {/* File tab bar */}
      <div className="flex items-center bg-[#1a1a1c] border-b border-white/[0.06]">
        <div className="px-4 py-2.5 text-[11px] text-blue-400 bg-[#1e1e1e] border-b-2 border-blue-400/60 font-medium">
          FLAGDECK_PRD.md
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
        <div className="absolute top-14 left-[38%] bg-[#2d2d30] border border-white/10 rounded-lg shadow-2xl shadow-black/40 py-1.5 w-64 z-10">
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
            <Rocket className="w-3 h-3" />
            WorkerMill: Product Build
          </div>
          <div className="px-3 py-2 mx-1.5 text-[11px] text-slate-300 flex items-center gap-2 rounded-md">
            <Play className="w-3 h-3" />
            WorkerMill: Run as Task
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
      {/* Terminal tab — matches real extension: "WM: Product Build" */}
      <div className="flex items-center bg-[#1a1a1c] border-b border-white/[0.06]">
        <div className="px-4 py-2.5 text-[11px] text-slate-300 bg-[#1e1e1e] border-b-2 border-blue-400/60 font-medium flex items-center gap-1.5">
          <Rocket className="w-3 h-3 text-blue-400" />
          WM: Product Build
        </div>
      </div>

      <div className="flex-1 p-4 font-mono text-[10px] leading-[1.6] overflow-hidden">
        <div className="text-white font-semibold">WorkerMill Product Build</div>
        <div className="text-slate-500">Building product...</div>
        <div className="h-1.5" />
        <div className="text-slate-400">
          &gt; Starting PRD decomposition...
        </div>
        <div className="text-slate-500">
          &gt; Analyzing PRD and generating implementation cards — this
          typically takes 1–3 minutes...
        </div>
        <div className="text-emerald-400">
          &gt; ✅ Cards are being generated...
        </div>
        <div className="text-blue-400">
          &gt; 📋 boardName: FlagDeck — Feature Flag &amp; Experimentation
          Platform
        </div>
        <div className="h-1" />
        <div className="text-slate-300">
          &gt; 📋 title: Foundation — Backend API, Seed Data, CI &amp; Docker
        </div>
        <div className="text-slate-500">
          &gt;&nbsp;&nbsp;&nbsp;description: Complete Go/Fiber backend with all
          models, endpoints, seed data, and CI pipeline...
        </div>
        <div className="text-slate-500">
          &gt; 👤 persona: backend_developer
        </div>
        <div className="text-slate-500">&gt; ⚡ priority: urgent</div>
        <div className="text-slate-500">&gt; 🔗 deps: []</div>
        <div className="text-slate-500">
          &gt; 🏷️ labels: [&ldquo;backend&rdquo;, &ldquo;api&rdquo;,
          &ldquo;docker&rdquo;, &ldquo;ci-cd&rdquo;, &ldquo;go&rdquo;]
        </div>
        <div className="text-slate-300">
          &gt; 📋 title: Frontend — SvelteKit UI, Components &amp; Auth Flow
        </div>
        <div className="text-slate-500">
          &gt; 👤 persona: frontend_developer
        </div>
        <div className="text-slate-500">&gt; ⚡ priority: high</div>
        <div className="text-slate-500">&gt; 🔗 deps: [0]</div>
        <div className="text-slate-600">&gt; ... 1 more card</div>
        <div className="h-1" />
        <div className="text-emerald-400">
          &gt; ✅ Generation complete. Finalizing board...
        </div>
        <div className="text-slate-400">
          &gt; 📊 Parsed 3 cards for board &ldquo;FlagDeck&rdquo;
        </div>
        <div className="text-emerald-400">
          ✓ Created board &ldquo;FlagDeck PRD — Full Build
          Specification&rdquo; with 3 cards
          <span className="animate-pulse"> _</span>
        </div>
      </div>
    </div>
  );
}

function PlanningContent() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Terminal tab */}
      <div className="flex items-center bg-[#1a1a1c] border-b border-white/[0.06]">
        <div className="px-4 py-2.5 text-[11px] text-slate-300 bg-[#1e1e1e] border-b-2 border-blue-400/60 font-medium flex items-center gap-1.5">
          <Terminal className="w-3 h-3" />
          Terminal
        </div>
      </div>

      <div className="flex-1 p-4 font-mono text-[10px] leading-[1.6] overflow-hidden">
        <div className="text-slate-500">
          WorkerMill — streaming logs for task de334c8f...
        </div>
        <div className="h-2" />
        <div className="text-amber-300">
          [💡 planning_agent 🤖] Fetching planning prompt from cloud API...
        </div>
        <div className="text-amber-300">
          [💡 planning_agent 🤖] Planning mode: simplified — critic feedback
          incorporated but never blocks
        </div>
        <div className="text-amber-300">
          [💡 planning_agent 🤖] Starting planning agent using
          anthropic/claude-opus-4-6
        </div>
        <div className="text-amber-300">
          [💡 planning_agent 🤖] Reading repository structure...
        </div>
        <div className="text-slate-500">
          [💡 planning_agent 🤖] Exploring codebase (4 files examined, 17s)
        </div>
        <div className="text-slate-500">
          [💡 planning_agent 🤖] Exploring codebase (4 files examined, 32s)
        </div>
        <div className="text-slate-500">
          [💡 planning_agent 🤖] Exploring codebase (4 files examined, 47s)
        </div>
        <div className="text-amber-300">
          [💡 planning_agent 🤖] Plan generated: 8 stories (49s). Running
          critic validation...
        </div>
        <div className="h-2" />
        <div className="text-emerald-400">
          [💡 planning_agent 🤖] Critic approved (score: 92/100)
        </div>
        <div className="text-slate-500">
          [💡 planning_agent 🤖] Critic suggestions: Consider splitting
          story-4...
        </div>
        <div className="text-emerald-400">
          [💡 planning_agent 🤖] Plan validated: 8 stories. Task queued for
          execution.
          <span className="animate-pulse"> _</span>
        </div>
      </div>
    </div>
  );
}

function ExecutingContent() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Terminal tab */}
      <div className="flex items-center bg-[#1a1a1c] border-b border-white/[0.06]">
        <div className="px-4 py-2.5 text-[11px] text-slate-300 bg-[#1e1e1e] border-b-2 border-blue-400/60 font-medium flex items-center gap-1.5">
          <Terminal className="w-3 h-3" />
          Terminal
        </div>
      </div>

      <div className="flex-1 p-4 font-mono text-[10px] leading-[1.6] overflow-hidden">
        <div className="text-emerald-400">
          [🔧 devops_engineer 🤖] Starting Docker Compose &amp; CI Pipeline
        </div>
        <div className="text-blue-400">
          [💻 backend_developer 🤖] Starting Go module, models &amp;
          database layer
        </div>
        <div className="text-orange-400">
          [🛡️ security_engineer 🤖] Starting Auth middleware &amp; JWT
          system
        </div>
        <div className="text-emerald-400">
          [🔧 devops_engineer 🤖] Target repo: workermill-examples/flagdeck
        </div>
        <div className="text-blue-400">
          [💻 backend_developer 🤖] Target repo: workermill-examples/flagdeck
        </div>
        <div className="text-orange-400">
          [🛡️ security_engineer 🤖] Target repo:
          workermill-examples/flagdeck
        </div>
        <div className="text-emerald-400">
          [🔧 devops_engineer 🤖] Created branch:
          story/fdfbs-1/0-docker-compose-ci
        </div>
        <div className="text-blue-400">
          [💻 backend_developer 🤖] Created branch:
          story/fdfbs-1/1-go-module-models-database
        </div>
        <div className="text-orange-400">
          [🛡️ security_engineer 🤖] Created branch:
          story/fdfbs-1/2-auth-middleware-jwt
        </div>
        <div className="text-emerald-400">
          [🔧 devops_engineer 🤖] Worktree: /workspace/worktrees/story-0
        </div>
        <div className="text-blue-400">
          [💻 backend_developer 🤖] Worktree: /workspace/worktrees/story-1
        </div>
        <div className="text-orange-400">
          [🛡️ security_engineer 🤖] Worktree: /workspace/worktrees/story-2
        </div>
        <div className="text-emerald-400">
          [🔧 devops_engineer 🤖] Pushed branch (initial checkpoint)
        </div>
        <div className="text-blue-400">
          [💻 backend_developer 🤖] Pushed branch (initial checkpoint)
        </div>
        <div className="text-orange-400">
          [🛡️ security_engineer 🤖] Pushed branch (initial checkpoint)
        </div>
        <div className="text-emerald-400">
          [🔧 devops_engineer 🤖] Executing story with Claude CLI
          (claude-sonnet-4-6)...
        </div>
        <div className="text-blue-400">
          [💻 backend_developer 🤖] Executing story with Claude CLI
          (claude-sonnet-4-6)...
        </div>
        <div className="text-orange-400">
          [🛡️ security_engineer 🤖] Executing story with Claude CLI
          (claude-sonnet-4-6)...
          <span className="animate-pulse"> _</span>
        </div>
      </div>
    </div>
  );
}

function ReviewContent() {
  const stories = [
    { name: "Docker Compose & CI Pipeline", status: "approved" },
    { name: "Go module, models & database layer", status: "approved" },
    { name: "Auth middleware & JWT system", status: "approved" },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Terminal tab — review logs */}
      <div className="flex items-center bg-[#1a1a1c] border-b border-white/[0.06]">
        <div className="px-4 py-2.5 text-[11px] text-slate-300 bg-[#1e1e1e] border-b-2 border-blue-400/60 font-medium flex items-center gap-1.5">
          <Terminal className="w-3 h-3" />
          Terminal
        </div>
      </div>

      <div className="flex-1 p-4 overflow-hidden flex flex-col gap-3">
        {/* Story reviews — each story reviewed by tech lead */}
        <div className="bg-white/[0.02] rounded-lg border border-white/[0.06] p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-slate-600 font-semibold">
            Story Reviews
          </div>
          {stories.map((s, i) => (
            <div
              key={i}
              className="flex items-center gap-2 text-[11px] text-slate-400"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
              <span className="flex-1 truncate">{s.name}</span>
              <span className="text-[9px] text-emerald-400/70 font-mono">
                {s.status}
              </span>
            </div>
          ))}
        </div>

        {/* Branch consolidation */}
        <div className="bg-blue-500/[0.04] border border-blue-500/20 rounded-lg p-3 font-mono text-[10px] space-y-1">
          <div className="text-blue-400">
            [👑 manager_reviewer 🤖] Consolidating feature branches into final
            PR...
          </div>
          <div className="text-slate-500">
            [👑 manager_reviewer 🤖] Merging story/fdfbs-1/0-docker-compose-ci
            → main
          </div>
          <div className="text-slate-500">
            [👑 manager_reviewer 🤖] Merging story/fdfbs-1/1-go-module-models →
            main
          </div>
          <div className="text-emerald-400">
            [👑 manager_reviewer 🤖] PR #1 created — reviewing with Claude CLI
          </div>
        </div>

        {/* Final PR review by tech lead */}
        <div className="bg-violet-500/[0.04] border border-violet-500/20 rounded-lg p-3 flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-violet-500/15 flex items-center justify-center">
            <Shield className="w-3.5 h-3.5 text-violet-400" />
          </div>
          <div className="flex-1">
            <div className="text-[11px] text-violet-300 font-medium">
              Tech Lead — Final PR Review
            </div>
            <div className="text-[10px] text-slate-500">
              All tests passing &middot; Type check clean &middot; No security
              issues
            </div>
          </div>
          <div className="px-2 py-1 bg-emerald-500/10 rounded-full text-[10px] text-emerald-400 font-medium">
            Approved
          </div>
        </div>

        {/* Unlock next epic */}
        <div className="bg-emerald-500/[0.06] border border-emerald-500/20 rounded-lg p-3 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          <div>
            <div className="text-xs text-emerald-400 font-medium">
              Epic 1 complete — merged to main
            </div>
            <div className="text-[10px] text-emerald-400/60">
              Unlocking: Frontend — SvelteKit UI &amp; Auth Flow
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MontageContent() {
  const epicProgress = [
    { name: "Backend & API", status: "done" as const },
    { name: "Frontend UI", status: "done" as const },
    { name: "Deploy & Valid", status: "executing" as const },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between bg-[#1a1a1c] border-b border-white/[0.06] px-5 py-2.5">
        <div className="text-[11px] text-white font-medium">Build Progress</div>
        <div className="text-[10px] text-emerald-400 font-mono">
          2/3 epics
        </div>
      </div>

      <div className="flex-1 p-4 overflow-hidden flex gap-4">
        {/* Epic list */}
        <div className="flex-1 flex flex-col gap-1.5 justify-start">
          {epicProgress.map((epic, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 text-[11px] rounded-md px-2.5 py-2 border transition-all ${
                epic.status === "done"
                  ? "bg-emerald-500/[0.04] border-emerald-500/15"
                  : epic.status === "executing"
                    ? "bg-blue-500/[0.06] border-blue-500/20"
                    : "bg-transparent border-white/[0.04]"
              }`}
            >
              {epic.status === "done" ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
              ) : epic.status === "executing" ? (
                <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin flex-shrink-0" />
              ) : (
                <Lock className="w-3.5 h-3.5 text-slate-700 flex-shrink-0" />
              )}
              <span
                className={`truncate ${
                  epic.status === "done"
                    ? "text-emerald-400/70"
                    : epic.status === "executing"
                      ? "text-white font-medium"
                      : "text-slate-600"
                }`}
              >
                {epic.name}
              </span>
            </div>
          ))}
        </div>

        {/* Stats panel */}
        <div className="w-[140px] flex flex-col gap-2.5">
          {[
            { label: "Elapsed", value: "3h 55m", color: "text-white" },
            { label: "Stories", value: "16/21", color: "text-blue-400" },
            { label: "Tests", value: "passing", color: "text-emerald-400" },
            { label: "API cost", value: "$52", color: "text-amber-400" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-2.5"
            >
              <div className={`text-base font-bold ${stat.color}`}>
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
          3 epics &middot; 21 stories &middot; tests passing
        </div>
      </div>
      <div className="flex items-center gap-3 px-6 py-3 bg-emerald-500/[0.08] border border-emerald-500/20 rounded-xl">
        <GitPullRequest className="w-5 h-5 text-emerald-400" />
        <div>
          <div className="text-sm text-emerald-300 font-semibold">
            PR #1 ready for review
          </div>
          <div className="text-[11px] text-emerald-400/50 font-mono">
            github.com/workermill-examples/flagdeck/pull/1
          </div>
        </div>
      </div>
      <div className="flex gap-6 mt-2 text-center">
        {[
          { label: "Time", value: "4h 45m" },
          { label: "Cost", value: "$64" },
          { label: "Files", value: "110" },
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
    // Frame 0: Spec — context menu on PRD, sidebar empty (pre-decomposition)
    { epics: [], content: <ContextMenuContent /> },

    // Frame 1: Decompose — PRD streaming, sidebar shows Backlog (13)
    {
      epics: base,
      content: <DecomposingContent />,
    },

    // Frame 2: Plan — planning agent, FDPFB-1 active in sidebar
    {
      epics: base.map((e, i) => ({
        ...e,
        status: i === 0 ? ("planning" as const) : ("locked" as const),
      })),
      content: <PlanningContent />,
    },

    // Frame 3: Execute — parallel experts, FDPFB-1 executing
    {
      epics: base.map((e, i) => ({
        ...e,
        status: i === 0 ? ("executing" as const) : ("locked" as const),
      })),
      content: <ExecutingContent />,
    },

    // Frame 4: Review — FDPFB-1 done, FDPFB-2 unlocked in backlog
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

    // Frame 5: Progress — 2 done, FDFBS-3 executing
    {
      epics: base.map((e, i) => ({
        ...e,
        status:
          i < 2
            ? ("done" as const)
            : i === 2
              ? ("executing" as const)
              : ("locked" as const),
      })),
      content: <MontageContent />,
    },

    // Frame 6: Ship — all done
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
    <div className="flex items-center bg-[#141416] border-t border-white/[0.06] px-2 py-1.5 gap-0.5">
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
  // eslint-disable-next-line react-hooks/purity -- ref initialization needs current time
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

            <div className="relative bg-[#1e1e1e] rounded-xl border border-white/[0.08] overflow-hidden shadow-2xl shadow-black/50">
              {/* Title bar */}
              <div className="flex items-center gap-2 px-4 py-2.5 bg-[#1a1a1c] border-b border-white/[0.06]">
                <div className="flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
                  <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                  <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
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
                    FlagDeck &mdash; Visual Studio Code
                  </span>
                </div>
                <div className="w-[72px]" />
              </div>

              {/* Body: sidebar + content */}
              <div className="flex h-[400px] lg:h-[440px]">
                {/* Sidebar — hidden on mobile */}
                <div className="hidden lg:block">
                  <VsCodeSidebar epics={currentFrame.epics} />
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

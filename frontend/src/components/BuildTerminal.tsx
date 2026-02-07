import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sparkles,
  Loader2,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Cpu,
  Users,
  Code2,
  Layers,
  Clock,
  Zap,
  Shield,
  GitBranch,
  LogIn,
  FileCode,
  CheckCircle2,
} from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL || "";

// ─── Types ──────────────────────────────────────────────────────────────────

interface StackTemplateOption {
  id: string;
  name: string;
  description: string;
  language: string;
}

interface PlannedStory {
  index: number;
  title: string;
  description: string;
  persona: string;
  scope: string;
  acceptanceCriteria: string[];
  dependencies: number[];
  storyPoints: number;
  targetFiles: string[];
  estimatedComplexity: "small" | "medium" | "large";
}

interface TechStackPreview {
  language: string;
  framework: string;
  styling?: string;
  database?: string;
  testing?: string;
  buildTool?: string;
  rationale: string;
}

interface FullPlan {
  strategy: string;
  reasoning: string;
  stories: PlannedStory[];
  techStack: TechStackPreview;
  qualityGates: string[];
}

export interface PlanPreview {
  plan: FullPlan;
  logs: string[];
  summary: {
    storyCount: number;
    personas: string[];
    techStackList: string[];
    reasoning: string;
  };
  complexity: {
    score: number;
    dimensions: {
      features: number;
      layers: number;
      files: number;
      clarity: number;
    };
  };
  estimatedCost: {
    local: number;
    byok: number;
    cloud: number;
  };
  estimatedDuration: number;
}

interface BuildTerminalProps {
  stackTemplates: StackTemplateOption[];
  onPreviewReady?: () => void;
  onPlanGenerated?: (plan: PlanPreview) => void;
  initialTitle?: string;
  initialDescription?: string;
  initialStack?: string;
  cachedPlan?: PlanPreview | null;
}

// ─── Persona display names ──────────────────────────────────────────────────

const PERSONA_LABELS: Record<string, string> = {
  backend_developer: "Backend Developer",
  frontend_developer: "Frontend Developer",
  devops_engineer: "DevOps Engineer",
  qa_engineer: "QA Engineer",
  security_engineer: "Security Engineer",
  api_developer: "API Developer",
  database_administrator: "Database Admin",
  data_engineer: "Data Engineer",
  ml_engineer: "ML Engineer",
  tech_writer: "Tech Writer",
  tech_lead: "Tech Lead",
  mobile_developer_android: "Android Developer",
  mobile_developer_ios: "iOS Developer",
};

const COMPLEXITY_COLORS: Record<string, string> = {
  small: "text-green-400 bg-green-500/10 border-green-500/20",
  medium: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  large: "text-red-400 bg-red-500/10 border-red-500/20",
};

// ─── Story Card ─────────────────────────────────────────────────────────────

function StoryCard({ story }: { story: PlannedStory }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-white/[0.02] transition-colors"
      >
        <ChevronRight
          className={`w-3.5 h-3.5 text-slate-500 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <span className="text-xs font-mono text-slate-500 shrink-0">
          #{story.index}
        </span>
        <span className="text-sm text-white flex-1 truncate">
          {story.title}
        </span>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded border ${COMPLEXITY_COLORS[story.estimatedComplexity] || COMPLEXITY_COLORS.medium}`}
        >
          {story.storyPoints}pt
        </span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-white/5">
          {PERSONA_LABELS[story.persona] || story.persona.replace(/_/g, " ")}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/5 pt-3">
          <p className="text-xs text-slate-400 leading-relaxed">
            {story.scope || story.description}
          </p>

          {story.acceptanceCriteria.length > 0 && (
            <div>
              <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                Acceptance Criteria
              </div>
              <ul className="space-y-1">
                {story.acceptanceCriteria.map((ac, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-xs text-slate-400"
                  >
                    <CheckCircle2 className="w-3 h-3 text-teal-500/60 mt-0.5 shrink-0" />
                    <span>{ac}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {story.targetFiles.length > 0 && (
            <div>
              <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                Target Files
              </div>
              <div className="flex flex-wrap gap-1.5">
                {story.targetFiles.map((f, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-400 font-mono border border-white/5"
                  >
                    <FileCode className="w-2.5 h-2.5" />
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}

          {story.dependencies.length > 0 && (
            <div className="text-[10px] text-slate-500">
              Depends on: {story.dependencies.map((d) => `#${d}`).join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Live Terminal ──────────────────────────────────────────────────────────

function LiveTerminal({
  logs,
  isComplete,
}: {
  logs: string[];
  isComplete: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Scroll only within the terminal container, not the page
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div ref={containerRef} className="bg-black/40 rounded-lg border border-white/5 p-4 font-mono text-xs flex-1 overflow-y-auto">
      {logs.map((line, i) => (
        <div key={i} className="text-slate-300 leading-relaxed">
          <span className="text-slate-600 select-none mr-2">$</span>
          {line}
        </div>
      ))}
      {!isComplete && (
        <div className="flex items-center gap-1 text-teal-400 mt-1">
          <span className="animate-pulse">_</span>
        </div>
      )}
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function BuildTerminal({
  stackTemplates,
  onPreviewReady,
  onPlanGenerated,
  initialTitle = "",
  initialDescription = "",
  initialStack = "",
  cachedPlan,
}: BuildTerminalProps) {
  const navigate = useNavigate();
  const isLoggedIn = !!localStorage.getItem("accessToken");

  // Form state
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [selectedStack, setSelectedStack] = useState(initialStack);
  const [targetRepo, setTargetRepo] = useState("");

  // Preview state
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [planningLogs, setPlanningLogs] = useState<string[]>([]);
  const [replayComplete, setReplayComplete] = useState(false);

  // Execution state
  const [isExecuting, setIsExecuting] = useState(false);
  const [executeError, setExecuteError] = useState<string | null>(null);

  // Track replay timer for cleanup
  const replayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync initial values when starter template is selected
  useEffect(() => {
    if (initialTitle) setTitle(initialTitle);
  }, [initialTitle]);
  useEffect(() => {
    if (initialDescription) setDescription(initialDescription);
  }, [initialDescription]);
  useEffect(() => {
    if (initialStack) setSelectedStack(initialStack);
  }, [initialStack]);

  // ─── Client-side log replay ──────────────────────────────────────────────

  // Stable ref for onPreviewReady so replayLogs doesn't re-create on every render
  const onPreviewReadyRef = useRef(onPreviewReady);
  onPreviewReadyRef.current = onPreviewReady;
  const onPlanGeneratedRef = useRef(onPlanGenerated);
  onPlanGeneratedRef.current = onPlanGenerated;

  const replayLogs = useCallback(
    (plan: PlanPreview) => {
      // Cancel any in-flight replay first
      if (replayTimerRef.current) clearTimeout(replayTimerRef.current);

      setIsPlanning(true);
      setPreview(null);
      setPlanningLogs([]);
      setReplayComplete(false);

      const logs = plan.logs || [];
      let i = 0;

      const playNext = () => {
        if (i >= logs.length) {
          setReplayComplete(true);
          replayTimerRef.current = setTimeout(() => {
            if (onPlanGeneratedRef.current) {
              // External mode: keep terminal visible, pass plan to parent
              onPlanGeneratedRef.current(plan);
            } else {
              // Internal mode: hide terminal, show preview
              setIsPlanning(false);
              setPreview(plan);
            }
            onPreviewReadyRef.current?.();
          }, 800);
          return;
        }

        setPlanningLogs((prev) => [...prev, logs[i]]);
        i++;

        const delay = 300 + Math.random() * 500;
        replayTimerRef.current = setTimeout(playNext, delay);
      };

      replayTimerRef.current = setTimeout(playNext, 600);
    },
    [], // stable — no deps, uses ref for callback
  );

  // Cleanup replay on unmount
  useEffect(() => {
    return () => {
      if (replayTimerRef.current) clearTimeout(replayTimerRef.current);
    };
  }, []);

  // Auto-replay when cachedPlan changes (starter template selected)
  // Track the last replayed plan ID to prevent double-replay
  const lastReplayedRef = useRef<string | null>(null);
  useEffect(() => {
    if (cachedPlan && initialTitle) {
      const planKey = initialTitle;
      if (lastReplayedRef.current === planKey) return;
      lastReplayedRef.current = planKey;
      replayLogs(cachedPlan);
    }
  }, [cachedPlan, initialTitle, replayLogs]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handlePreview = () => {
    if (!title.trim() || !description.trim()) return;

    if (cachedPlan) {
      // Replay cached plan
      replayLogs(cachedPlan);
    }
    // For custom descriptions without cached plans, we could show a signup CTA
    // For now, no-op — custom planning requires signup
  };

  const handleExecute = async () => {
    if (!title.trim() || !description.trim() || !targetRepo.trim()) return;

    setIsExecuting(true);
    setExecuteError(null);

    try {
      const token = localStorage.getItem("accessToken");
      const res = await fetch(`${API_BASE}/api/build/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title,
          description,
          stackTemplate: selectedStack || undefined,
          targetRepo,
        }),
      });

      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Execution failed" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      navigate(data.dashboardUrl || "/dashboard");
    } catch (err) {
      setExecuteError(
        err instanceof Error ? err.message : "Execution failed",
      );
    } finally {
      setIsExecuting(false);
    }
  };

  const handleEditDescription = () => {
    // Cancel replay and reset
    if (replayTimerRef.current) clearTimeout(replayTimerRef.current);
    setPreview(null);
    setIsPlanning(false);
    setPlanningLogs([]);
    setReplayComplete(false);
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  const hasCachedPlan = !!cachedPlan;

  return (
    <div className="relative w-full">
      {/* Glow effect */}
      <div className="absolute -inset-6 bg-gradient-to-br from-teal-500/20 via-transparent to-blue-500/10 rounded-3xl blur-3xl opacity-70" />

      {/* Window */}
      <div className="relative bg-slate-900/80 backdrop-blur-xl rounded-2xl shadow-2xl shadow-black/30 border border-white/10 overflow-hidden h-[600px] flex flex-col">
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-400" />
            <div className="w-3 h-3 rounded-full bg-amber-400" />
            <div className="w-3 h-3 rounded-full bg-emerald-400" />
          </div>
          <span className="text-xs font-medium text-slate-400">
            WorkerMill Build
          </span>
          <div className="w-16" />
        </div>

        {/* Form content — hidden when planning or plan ready */}
        {!isPlanning && !preview && (
          <div className="p-6 space-y-4 flex-1 overflow-y-auto">
            {/* Title input */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-teal-400 font-mono text-sm select-none">
                  {">"}
                </span>
                <span className="text-xs text-slate-500 font-mono">
                  Project title
                </span>
              </div>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="My awesome project"
                className="w-full px-4 py-2.5 rounded-lg bg-slate-800/60 border border-white/5 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500/30 font-mono text-sm"
              />
            </div>

            {/* Description textarea */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-teal-400 font-mono text-sm select-none">
                  {">"}
                </span>
                <span className="text-xs text-slate-500 font-mono">
                  Describe your project
                </span>
              </div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe your project in plain English. Include features, user types, and any technical preferences..."
                rows={6}
                className="w-full px-4 py-3 rounded-lg bg-slate-800/60 border border-white/5 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500/30 resize-y font-mono text-sm leading-relaxed"
              />
            </div>

            {/* Stack selector */}
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <select
                  value={selectedStack}
                  onChange={(e) => setSelectedStack(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg bg-slate-800/60 border border-white/5 text-slate-300 appearance-none pr-10 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500/30 text-sm"
                >
                  <option value="">Auto-detect stack</option>
                  {stackTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-3 w-4 h-4 text-slate-500 pointer-events-none" />
              </div>
            </div>

            {/* Generate Plan button */}
            <button
              onClick={handlePreview}
              disabled={!title.trim() || !description.trim() || !hasCachedPlan}
              className="w-full py-3 rounded-lg bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-400 hover:to-teal-500 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-teal-500/25 text-sm"
            >
              <Sparkles className="w-4 h-4" />
              Generate Plan (free)
            </button>

            {/* Custom description CTA */}
            {title.trim() && description.trim() && !hasCachedPlan && (
              <div className="p-3 rounded-lg bg-teal-500/5 border border-teal-500/10 text-center">
                <p className="text-sm text-slate-400">
                  Custom projects get full Opus 4.6 planning after signup.
                </p>
                <button
                  onClick={() => navigate("/signup")}
                  className="mt-2 text-sm text-teal-400 hover:text-teal-300 font-medium transition-colors inline-flex items-center gap-1"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  Sign up free to generate your plan
                </button>
              </div>
            )}
          </div>
        )}

        {/* Live terminal — shown while planning */}
        {isPlanning && !preview && (
          <div className="p-6 flex-1 overflow-y-auto flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              {replayComplete ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm text-emerald-400 font-medium">
                    Plan ready
                  </span>
                </>
              ) : (
                <>
                  <Loader2 className="w-4 h-4 text-teal-400 animate-spin" />
                  <span className="text-sm text-teal-400 font-medium">
                    Planning with Opus 4.6...
                  </span>
                </>
              )}
            </div>
            <LiveTerminal logs={planningLogs} isComplete={replayComplete} />
            {!replayComplete && (
              <p className="text-xs text-slate-500 mt-3 text-center">
                Analyzing architecture and building execution plan...
              </p>
            )}
          </div>
        )}
      </div>

      {/* ─── Full Plan Preview (only when parent isn't handling it) ───── */}
      {preview && !onPlanGenerated && (
        <div className="w-full mt-8 space-y-6">
          <div className="relative">
            <div className="absolute -inset-4 bg-gradient-to-br from-teal-500/10 via-transparent to-blue-500/5 rounded-3xl blur-2xl opacity-50" />
            <div className="relative rounded-2xl border border-white/10 overflow-hidden bg-slate-900/60 backdrop-blur-xl">
              {/* Preview Header */}
              <div className="px-6 py-4 bg-white/[0.03] border-b border-white/5">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white">
                    Execution Plan
                  </h2>
                  <button
                    onClick={handleEditDescription}
                    className="text-xs text-slate-400 hover:text-white transition-colors"
                  >
                    Edit description
                  </button>
                </div>
                <div className="flex items-center gap-4 mt-2 text-sm text-slate-400">
                  <span className="flex items-center gap-1">
                    <Layers className="w-3.5 h-3.5" />
                    {preview.summary.storyCount} stories
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />~
                    {preview.estimatedDuration} min
                  </span>
                  <span className="flex items-center gap-1">
                    <Cpu className="w-3.5 h-3.5" />
                    Complexity: {preview.complexity.score}/12
                  </span>
                </div>
              </div>

              {/* Plan Body */}
              <div className="p-6 space-y-5">
                <p className="text-sm text-slate-300 leading-relaxed">
                  {preview.plan.reasoning}
                </p>

                {/* Tech Stack */}
                <div>
                  <div className="text-xs font-medium text-slate-400 mb-2 flex items-center gap-1">
                    <Code2 className="w-3 h-3" /> Tech Stack
                  </div>
                  <div className="flex gap-2 flex-wrap mb-2">
                    {preview.summary.techStackList.map((t) => (
                      <span
                        key={t}
                        className="text-xs px-2 py-1 rounded-full border border-teal-500/30 text-teal-400 bg-teal-500/10"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                  {preview.plan.techStack.rationale && (
                    <p className="text-xs text-slate-500 italic">
                      {preview.plan.techStack.rationale}
                    </p>
                  )}
                </div>

                {/* Expert Team */}
                <div>
                  <div className="text-xs font-medium text-slate-400 mb-2 flex items-center gap-1">
                    <Users className="w-3 h-3" /> Expert Team
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {preview.summary.personas.map((p) => (
                      <span
                        key={p}
                        className="text-xs px-2 py-1 rounded-full border border-white/10 bg-white/5 text-slate-300"
                      >
                        {PERSONA_LABELS[p] || p.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Stories */}
                <div>
                  <div className="text-xs font-medium text-slate-400 mb-3 flex items-center gap-1">
                    <Layers className="w-3 h-3" /> Stories (
                    {preview.plan.stories.length})
                  </div>
                  <div className="space-y-1.5">
                    {preview.plan.stories.map((story) => (
                      <StoryCard key={story.index} story={story} />
                    ))}
                  </div>
                </div>

                {/* Quality Gates */}
                {preview.plan.qualityGates.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-slate-400 mb-2 flex items-center gap-1">
                      <Shield className="w-3 h-3" /> Quality Gates
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {preview.plan.qualityGates.map((g, i) => (
                        <span
                          key={i}
                          className="text-xs px-2 py-1 rounded-full border border-white/5 bg-white/[0.02] text-slate-400"
                        >
                          {g}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* What You Get */}
              <div className="px-6 py-4 bg-white/[0.02] border-t border-white/5">
                <div className="text-xs font-medium text-slate-400 mb-3">
                  What happens when you build:
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="flex items-start gap-2">
                    <Zap className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                    <span className="text-xs text-slate-400">
                      This exact plan executes — same stories, same architecture
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <GitBranch className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" />
                    <span className="text-xs text-slate-400">
                      Parallel expert agents write code with real-time
                      coordination
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Shield className="w-3.5 h-3.5 text-blue-500 mt-0.5 shrink-0" />
                    <span className="text-xs text-slate-400">
                      Automated PR with type checks, tests, and quality gates
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Action area */}
          {isLoggedIn ? (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-slate-300 mb-2 block">
                  Target Repository
                </label>
                <input
                  type="text"
                  value={targetRepo}
                  onChange={(e) => setTargetRepo(e.target.value)}
                  placeholder="owner/repo (e.g. myorg/my-project)"
                  className="w-full px-4 py-2.5 rounded-lg bg-slate-800/60 border border-white/5 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500/30 text-sm"
                />
              </div>

              {executeError && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  {executeError}
                </div>
              )}

              <button
                onClick={handleExecute}
                disabled={isExecuting || !targetRepo.trim()}
                className="w-full py-4 rounded-xl bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-400 hover:to-teal-500 text-white font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-teal-500/25"
              >
                {isExecuting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Creating task...
                  </>
                ) : (
                  <>
                    Build It
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="rounded-2xl border border-teal-500/20 bg-teal-500/5 backdrop-blur-sm p-6 text-center">
              <h3 className="text-lg font-semibold text-white mb-2">
                Ready to build this?
              </h3>
              <p className="text-sm text-slate-400 mb-4">
                Sign up for free to launch your AI engineering team. Your plan is
                saved and ready to execute.
              </p>
              <button
                onClick={() => navigate("/signup")}
                className="px-8 py-3 rounded-xl bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-400 hover:to-teal-500 text-white font-semibold transition-all inline-flex items-center gap-2 shadow-lg shadow-teal-500/25"
              >
                <LogIn className="w-4 h-4" />
                Sign Up to Build
              </button>
              <p className="text-xs text-slate-500 mt-3">
                Free with Claude Max subscription. No credit card required.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Plan Preview Panel (for external rendering) ────────────────────────────

export function PlanPreviewPanel({ preview }: { preview: PlanPreview }) {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <div className="relative">
        <div className="absolute -inset-4 bg-gradient-to-br from-teal-500/10 via-transparent to-blue-500/5 rounded-3xl blur-2xl opacity-50" />
        <div className="relative rounded-2xl border border-white/10 overflow-hidden bg-slate-900/60 backdrop-blur-xl">
          {/* Preview Header */}
          <div className="px-5 py-3 bg-white/[0.03] border-b border-white/5">
            <h2 className="text-base font-semibold text-white">
              Execution Plan
            </h2>
            <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-400">
              <span className="flex items-center gap-1">
                <Layers className="w-3 h-3" />
                {preview.summary.storyCount} stories
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />~{preview.estimatedDuration} min
              </span>
              <span className="flex items-center gap-1">
                <Cpu className="w-3 h-3" />
                {preview.complexity.score}/12
              </span>
            </div>
          </div>

          {/* Plan Body */}
          <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
            <p className="text-xs text-slate-300 leading-relaxed">
              {preview.plan.reasoning}
            </p>

            {/* Tech Stack */}
            <div>
              <div className="text-[10px] font-medium text-slate-400 mb-1.5 flex items-center gap-1">
                <Code2 className="w-3 h-3" /> Tech Stack
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {preview.summary.techStackList.map((t) => (
                  <span
                    key={t}
                    className="text-[10px] px-1.5 py-0.5 rounded-full border border-teal-500/30 text-teal-400 bg-teal-500/10"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>

            {/* Expert Team */}
            <div>
              <div className="text-[10px] font-medium text-slate-400 mb-1.5 flex items-center gap-1">
                <Users className="w-3 h-3" /> Expert Team
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {preview.summary.personas.map((p) => (
                  <span
                    key={p}
                    className="text-[10px] px-1.5 py-0.5 rounded-full border border-white/10 bg-white/5 text-slate-300"
                  >
                    {PERSONA_LABELS[p] || p.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </div>

            {/* Stories */}
            <div>
              <div className="text-[10px] font-medium text-slate-400 mb-2 flex items-center gap-1">
                <Layers className="w-3 h-3" /> Stories (
                {preview.plan.stories.length})
              </div>
              <div className="space-y-1">
                {preview.plan.stories.map((story) => (
                  <StoryCard key={story.index} story={story} />
                ))}
              </div>
            </div>

            {/* Quality Gates */}
            {preview.plan.qualityGates.length > 0 && (
              <div>
                <div className="text-[10px] font-medium text-slate-400 mb-1.5 flex items-center gap-1">
                  <Shield className="w-3 h-3" /> Quality Gates
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {preview.plan.qualityGates.map((g, i) => (
                    <span
                      key={i}
                      className="text-[10px] px-1.5 py-0.5 rounded-full border border-white/5 bg-white/[0.02] text-slate-400"
                    >
                      {g}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* What You Get */}
          <div className="px-5 py-3 bg-white/[0.02] border-t border-white/5">
            <div className="text-[10px] font-medium text-slate-400 mb-2">
              What happens when you build:
            </div>
            <div className="grid grid-cols-1 gap-2">
              <div className="flex items-start gap-2">
                <Zap className="w-3 h-3 text-amber-500 mt-0.5 shrink-0" />
                <span className="text-[10px] text-slate-400">
                  This exact plan executes — same stories, same architecture
                </span>
              </div>
              <div className="flex items-start gap-2">
                <GitBranch className="w-3 h-3 text-green-500 mt-0.5 shrink-0" />
                <span className="text-[10px] text-slate-400">
                  Parallel expert agents write code with real-time coordination
                </span>
              </div>
              <div className="flex items-start gap-2">
                <Shield className="w-3 h-3 text-blue-500 mt-0.5 shrink-0" />
                <span className="text-[10px] text-slate-400">
                  Automated PR with type checks, tests, and quality gates
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Signup CTA */}
      <div className="rounded-2xl border border-teal-500/20 bg-teal-500/5 backdrop-blur-sm p-5 text-center">
        <h3 className="text-base font-semibold text-white mb-1.5">
          Ready to build this?
        </h3>
        <p className="text-xs text-slate-400 mb-3">
          Sign up for free to launch your AI engineering team.
        </p>
        <button
          onClick={() => navigate("/signup")}
          className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-400 hover:to-teal-500 text-white font-semibold transition-all inline-flex items-center gap-2 shadow-lg shadow-teal-500/25 text-sm"
        >
          <LogIn className="w-4 h-4" />
          Sign Up to Build
        </button>
        <p className="text-[10px] text-slate-500 mt-2">
          Free with Claude Max subscription. No credit card required.
        </p>
      </div>
    </div>
  );
}

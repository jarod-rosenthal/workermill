import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowUp,
  Loader2,
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
  architect: "Architect",
  data_ml_engineer: "Data & ML Engineer",
  mobile_developer: "Mobile Developer",
  tech_writer: "Tech Writer",
  tech_lead: "Tech Lead",
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
          ***REMOVED***{story.index}
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
              Depends on: {story.dependencies.map((d) => `***REMOVED***${d}`).join(", ")}
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
    <div ref={containerRef} className="p-4 font-mono text-xs flex-1 overflow-y-auto">
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
  // Preview state
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [planningLogs, setPlanningLogs] = useState<string[]>([]);
  const [replayComplete, setReplayComplete] = useState(false);
  // Typing animation state
  const [isTyping, setIsTyping] = useState(false);

  // Tab state — "terminal" or "plan"
  const [activeTab, setActiveTab] = useState<"terminal" | "plan">("terminal");

  // Track replay timer for cleanup
  const replayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync initial values when starter template is selected (only if not typing)
  useEffect(() => {
    if (initialTitle && !isTyping) setTitle(initialTitle);
  }, [initialTitle, isTyping]);
  useEffect(() => {
    if (initialDescription && !isTyping) setDescription(initialDescription);
  }, [initialDescription, isTyping]);
  useEffect(() => {
    if (initialStack) setSelectedStack(initialStack);
  }, [initialStack]);

  // ─── Client-side log replay ──────────────────────────────────────────────

  // Stable ref for onPreviewReady so replayLogs doesn't re-create on every render
  const onPreviewReadyRef = useRef(onPreviewReady);
  onPreviewReadyRef.current = onPreviewReady;

  const replayLogs = useCallback(
    (plan: PlanPreview) => {
      // Cancel any in-flight replay first
      if (replayTimerRef.current) clearTimeout(replayTimerRef.current);

      setIsPlanning(true);
      setPreview(null);
      setPlanningLogs([]);
      setReplayComplete(false);
      setActiveTab("terminal");

      const logs = plan.logs || [];
      let i = 0;

      const playNext = () => {
        if (i >= logs.length) {
          setReplayComplete(true);
          replayTimerRef.current = setTimeout(() => {
            // Keep terminal visible, store plan, auto-switch to Plan tab
            setPreview(plan);
            setActiveTab("plan");
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

  // ─── Typing animation ─────────────────────────────────────────────────────

  const typeAndReplay = useCallback(
    (text: string, plan: PlanPreview) => {
      // Cancel any in-flight typing or replay
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      if (replayTimerRef.current) clearTimeout(replayTimerRef.current);

      // Reset state — show the textarea, clear previous results
      setIsPlanning(false);
      setPreview(null);
      setPlanningLogs([]);
      setReplayComplete(false);
      setActiveTab("terminal");
      setDescription("");
      setIsTyping(true);

      let charIdx = 0;

      const typeNext = () => {
        if (charIdx >= text.length) {
          // Typing done — pause to let user read, then start plan replay
          // Keep isTyping=true during the pause so textarea doesn't shrink
          typingTimerRef.current = setTimeout(() => {
            setIsTyping(false);
            replayLogs(plan);
          }, 800);
          return;
        }

        // Type in chunks of 2-4 characters for natural speed
        const chunkSize = 2 + Math.floor(Math.random() * 3);
        const nextIdx = Math.min(charIdx + chunkSize, text.length);
        const slice = text.slice(0, nextIdx);
        setDescription(slice);
        charIdx = nextIdx;

        // Faster for spaces/punctuation, slower for word starts
        const nextChar = text[charIdx] || "";
        const delay = nextChar === " " || nextChar === "," ? 15 : 20 + Math.random() * 25;
        typingTimerRef.current = setTimeout(typeNext, delay);
      };

      // Small initial delay before typing starts
      typingTimerRef.current = setTimeout(typeNext, 400);
    },
    [replayLogs],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (replayTimerRef.current) clearTimeout(replayTimerRef.current);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, []);

  // Auto-type-and-replay when cachedPlan changes (starter template selected)
  // Track the last replayed plan ID to prevent double-replay
  const lastReplayedRef = useRef<string | null>(null);
  useEffect(() => {
    if (cachedPlan && initialTitle && initialDescription) {
      const planKey = initialTitle;
      if (lastReplayedRef.current === planKey) return;
      lastReplayedRef.current = planKey;
      typeAndReplay(initialDescription, cachedPlan);
    }
  }, [cachedPlan, initialTitle, initialDescription, typeAndReplay]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handlePreview = () => {
    if (!description.trim()) return;

    if (cachedPlan) {
      // Replay cached plan
      replayLogs(cachedPlan);
    }
    // For custom descriptions without cached plans, we could show a signup CTA
    // For now, no-op — custom planning requires signup
  };

  const handleEditDescription = () => {
    // Cancel typing, replay, and reset
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    if (replayTimerRef.current) clearTimeout(replayTimerRef.current);
    setPreview(null);
    setIsPlanning(false);
    setIsTyping(false);
    setPlanningLogs([]);
    setReplayComplete(false);
    setActiveTab("terminal");
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  const hasCachedPlan = !!cachedPlan;

  return (
    <div className="relative w-full">
      {/* Window — compact input when idle, tall when planning/preview */}
      <div className={`relative overflow-hidden flex flex-col rounded-2xl bg-[***REMOVED***0f1117] transition-all duration-500 ${isPlanning || preview ? "h-[600px]" : ""}`}>
        {/* Tab bar — only when planning or plan ready */}
        {(isPlanning || preview) && (
          <div className="flex items-center justify-center px-4 py-2.5">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActiveTab("terminal")}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  activeTab === "terminal"
                    ? "bg-white/10 text-white"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                Terminal
              </button>
              {preview && (
                <button
                  onClick={() => setActiveTab("plan")}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    activeTab === "plan"
                      ? "bg-white/10 text-white"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  Plan
                </button>
              )}
            </div>
          </div>
        )}

        {/* Form content — visible when idle or during typing animation */}
        {(!isPlanning && !preview) && (
          <div>
            <div className="relative">
              <textarea
                value={description}
                onChange={(e) => {
                  if (!isTyping) setDescription(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (isTyping) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handlePreview();
                  }
                }}
                readOnly={isTyping}
                placeholder="Describe the app you want to build..."
                rows={isTyping ? 6 : 3}
                style={{ border: 'none', outline: 'none', boxShadow: 'none' }}
                className={`w-full rounded-2xl bg-transparent p-5 pr-14 text-white placeholder:text-white/30 resize-none text-lg leading-relaxed focus:ring-0 focus:outline-none ring-0 appearance-none transition-all duration-300 ${isTyping ? "caret-transparent" : ""}`}
              />
              {/* Blinking cursor during typing */}
              {isTyping && (
                <span className="absolute pointer-events-none text-teal-400 text-lg animate-pulse" style={{
                  // Position is approximate — the cursor just blinks after the textarea text
                  bottom: '1.25rem',
                  left: '1.25rem',
                  opacity: 0,
                }}>|</span>
              )}
              {!isTyping && (
                <button
                  onClick={handlePreview}
                  className="absolute right-4 bottom-4 transition-all"
                >
                  <ArrowUp className="w-5 h-5 text-white" />
                </button>
              )}
              {isTyping && (
                <div className="absolute right-4 bottom-4">
                  <Loader2 className="w-5 h-5 text-teal-400 animate-spin" />
                </div>
              )}
            </div>

            {/* Custom description CTA */}
            {description.trim() && !hasCachedPlan && !isTyping && (
              <div className="mt-4 text-center">
                <p className="text-sm text-white/30">
                  Custom projects require a free account to plan and build.
                </p>
                <button
                  onClick={() => navigate("/signup")}
                  className="mt-1.5 text-sm text-teal-400 hover:text-teal-300 font-medium transition-colors inline-flex items-center gap-1"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  Sign up free
                </button>
              </div>
            )}
          </div>
        )}

        {/* Terminal tab — shown while planning or after plan ready */}
        {(isPlanning || preview) && activeTab === "terminal" && (
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
                    Planning execution...
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

        {/* Plan tab — shown when plan is ready and plan tab selected */}
        {preview && activeTab === "plan" && (
          <div className="flex-1 overflow-y-auto">
            {/* Plan Header */}
            <div className="px-6 py-4 bg-white/[0.03] border-b border-white/5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">
                  Execution Plan
                </h2>
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
                    Parallel expert agents write code with real-time coordination
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

            {/* Signup CTA */}
            {!isLoggedIn && (
              <div className="px-6 py-5 bg-teal-500/5 border-t border-teal-500/20 text-center">
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
            )}
          </div>
        )}
      </div>

    </div>
  );
}


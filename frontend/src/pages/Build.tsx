import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sparkles,
  Loader2,
  ArrowRight,
  ChevronDown,
  Cpu,
  Users,
  Code2,
  Layers,
  Clock,
  Zap,
  Shield,
  GitBranch,
  LogIn,
} from "lucide-react";
const API_BASE = import.meta.env.VITE_API_URL || "";

// ─── Types ──────────────────────────────────────────────────────────────────

interface StackTemplateOption {
  id: string;
  name: string;
  description: string;
  language: string;
}

interface StarterProjectOption {
  id: string;
  title: string;
  description: string;
  stackTemplate: string;
  complexity: string;
  estimatedStories: number;
  tags: string[];
}

interface PlanPreview {
  preview: {
    storyCount: number;
    personas: string[];
    techStack: string[];
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

// ─── Component ──────────────────────────────────────────────────────────────

export default function Build() {
  const navigate = useNavigate();
  const isLoggedIn = !!localStorage.getItem("accessToken");

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedStack, setSelectedStack] = useState("");
  const [targetRepo, setTargetRepo] = useState("");

  // Template data
  const [stackTemplates, setStackTemplates] = useState<StackTemplateOption[]>([]);
  const [starterProjects, setStarterProjects] = useState<StarterProjectOption[]>([]);

  // Preview state
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Execution state
  const [isExecuting, setIsExecuting] = useState(false);
  const [executeError, setExecuteError] = useState<string | null>(null);

  // Load templates on mount
  useEffect(() => {
    async function loadTemplates() {
      try {
        const res = await fetch(`${API_BASE}/api/build/templates`);
        if (res.ok) {
          const data = await res.json();
          setStackTemplates(data.stackTemplates || []);
          setStarterProjects(data.starterProjects || []);
        }
      } catch {
        // Templates are optional — page still works without them
      }
    }
    loadTemplates();
  }, []);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleStarterSelect = (project: StarterProjectOption) => {
    setTitle(project.title);
    setDescription(project.description);
    setSelectedStack(project.stackTemplate);
  };

  const handlePreview = async () => {
    if (!title.trim() || !description.trim()) return;

    setIsLoadingPreview(true);
    setPreviewError(null);
    setPreview(null);

    try {
      const res = await fetch(`${API_BASE}/api/build/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          stackTemplate: selectedStack || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Preview failed" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setPreview(data);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setIsLoadingPreview(false);
    }
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
        const err = await res.json().catch(() => ({ error: "Execution failed" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      navigate(data.dashboardUrl || "/dashboard");
    } catch (err) {
      setExecuteError(err instanceof Error ? err.message : "Execution failed");
    } finally {
      setIsExecuting(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold mb-3">
            Describe what you want to build.
          </h1>
          <p className="text-lg text-muted-foreground">
            Our AI engineering team handles the rest.
          </p>
        </div>

        {/* Starter Projects */}
        {!preview && starterProjects.length > 0 && !description && (
          <div className="mb-8">
            <p className="text-sm text-muted-foreground mb-3">
              Or start with a template:
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {starterProjects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => handleStarterSelect(project)}
                  className="text-left p-3 rounded-lg border border-border/50 hover:border-primary/50 hover:bg-muted/30 transition-all"
                >
                  <div className="font-medium text-sm mb-1">{project.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {project.estimatedStories} stories &middot; {project.complexity}
                  </div>
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {project.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Description Form */}
        <div className="space-y-4 mb-6">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Project title"
            className="w-full px-4 py-3 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 text-lg"
          />

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe your project in plain English. Include features, user types, and any technical preferences."
            rows={12}
            className="w-full px-4 py-3 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y font-mono text-sm leading-relaxed"
          />

          {/* Stack + Repo Row */}
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <select
                value={selectedStack}
                onChange={(e) => setSelectedStack(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-border bg-background text-foreground appearance-none pr-10 focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">Auto-detect stack</option>
                {stackTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-3 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>

            <input
              type="text"
              value={targetRepo}
              onChange={(e) => setTargetRepo(e.target.value)}
              placeholder="owner/repo"
              className="flex-1 px-4 py-2.5 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>

        {/* Preview Button */}
        {!preview && (
          <button
            onClick={handlePreview}
            disabled={isLoadingPreview || !title.trim() || !description.trim()}
            className="w-full py-3 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {isLoadingPreview ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Analyzing your project...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                See the Plan (free)
              </>
            )}
          </button>
        )}

        {previewError && (
          <div className="mt-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
            {previewError}
          </div>
        )}

        {/* Plan Preview Card */}
        {preview && (
          <div className="mt-8 space-y-6">
            <div className="rounded-xl border border-border/50 overflow-hidden">
              {/* Preview Header */}
              <div className="px-6 py-4 bg-muted/30 border-b border-border/50">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Execution Plan</h2>
                  <button
                    onClick={() => setPreview(null)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Edit description
                  </button>
                </div>
                <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Layers className="w-3.5 h-3.5" />
                    {preview.preview.storyCount} stories
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    ~{preview.estimatedDuration} min
                  </span>
                  <span className="flex items-center gap-1">
                    <Cpu className="w-3.5 h-3.5" />
                    Complexity: {preview.complexity.score}/12
                  </span>
                </div>
              </div>

              {/* Preview Body */}
              <div className="p-6 space-y-4">
                <p className="text-sm text-muted-foreground">
                  {preview.preview.reasoning}
                </p>

                {/* Personas */}
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                    <Users className="w-3 h-3" /> Expert Team
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {preview.preview.personas.map((p) => (
                      <span
                        key={p}
                        className="text-xs px-2 py-1 rounded-full border border-border bg-muted/50"
                      >
                        {p.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Tech Stack */}
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                    <Code2 className="w-3 h-3" /> Tech Stack
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {preview.preview.techStack.map((t) => (
                      <span
                        key={t}
                        className="text-xs px-2 py-1 rounded-full border border-primary/30 text-primary bg-primary/10"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* What You Get Section */}
              <div className="px-6 py-4 bg-muted/20 border-t border-border/50">
                <div className="text-xs font-medium text-muted-foreground mb-3">What happens when you build:</div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex items-start gap-2">
                    <Zap className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                    <span className="text-xs text-muted-foreground">Opus 4.6 plans your architecture with full story decomposition</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <GitBranch className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" />
                    <span className="text-xs text-muted-foreground">Parallel expert agents write code with real-time coordination</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Shield className="w-3.5 h-3.5 text-blue-500 mt-0.5 shrink-0" />
                    <span className="text-xs text-muted-foreground">Automated PR with type checks, tests, and quality gates</span>
                  </div>
                </div>
              </div>
            </div>

            {isLoggedIn ? (
              <>
                {/* Repo input */}
                <div>
                  <label className="text-sm font-medium mb-2 block">Target Repository</label>
                  <input
                    type="text"
                    value={targetRepo}
                    onChange={(e) => setTargetRepo(e.target.value)}
                    placeholder="owner/repo (e.g. myorg/my-project)"
                    className="w-full px-4 py-2.5 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>

                {executeError && (
                  <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                    {executeError}
                  </div>
                )}

                {/* Build It Button */}
                <button
                  onClick={handleExecute}
                  disabled={isExecuting || !targetRepo.trim()}
                  className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
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
              </>
            ) : (
              /* Signup nudge for unauthenticated users */
              <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-6 text-center">
                <h3 className="text-lg font-semibold mb-2">
                  Ready to build this?
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Sign up for free to launch your AI engineering team. Your plan
                  is saved and ready to execute.
                </p>
                <button
                  onClick={() => navigate("/signup")}
                  className="px-8 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors inline-flex items-center gap-2"
                >
                  <LogIn className="w-4 h-4" />
                  Sign Up to Build
                </button>
                <p className="text-xs text-muted-foreground mt-3">
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

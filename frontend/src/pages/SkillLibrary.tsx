import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Search,
  BookOpen,
  CheckCircle,
  TrendingUp,
  Clock,
  Tag,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Trash2,
  BarChart3,
  Zap,
  Sparkles,
  Code2,
  FileCode,
  GitBranch,
  AlertTriangle,
  XCircle,
  Archive,
} from "lucide-react";
import { useAuthStore } from "../store/auth-store";

interface SkillStep {
  step: number;
  action: string;
  details?: string;
  example?: string;
}

interface SkillPrerequisites {
  filesMustExist?: string[];
  dependencies?: string[];
  technologies?: string[];
}

interface Skill {
  id: string;
  name: string;
  description: string;
  insight: string | null;
  steps: SkillStep[];
  prerequisites: SkillPrerequisites | null;
  sourceTaskId: string | null;
  sourceTaskSummary: string | null;
  repository: string | null;
  taskType: string | null;
  persona: string | null;
  isVerified: boolean;
  usageCount: number;
  successRate: number | null;
  createdAt: string;
  updatedAt: string;
}

interface AnalyticsOverview {
  totalMemories: number;
  byCategory: Record<string, number>;
  byOutcome: Record<string, number>;
  avgConfidence: number;
  recentActivity: {
    created24h: number;
    retrieved24h: number;
  };
}

interface MostUsedSkill {
  id: string;
  name: string;
  retrievalCount: number;
  successRate: number | null;
  lastRetrievedAt: string | null;
}

interface MostEffectiveSkill {
  id: string;
  name: string;
  successRate: number;
  usageCount: number;
}

interface LeastUsedSkill {
  id: string;
  name: string;
  description: string;
  retrievalCount: number;
  successRate: number | null;
  lastRetrievedAt: string | null;
  createdAt: string;
}

interface LeastEffectiveSkill {
  id: string;
  name: string;
  description: string;
  successRate: number;
  successCount: number;
  failureCount: number;
}

interface SkillTrend {
  date: string;
  count: number;
}

function SkillLibrary() {
  const tokens = useAuthStore((state) => state.tokens);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);
  const [selectedTaskType, setSelectedTaskType] = useState<string | null>(null);
  const [expandedSkillId, setExpandedSkillId] = useState<string | null>(null);
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [mostUsed, setMostUsed] = useState<MostUsedSkill[]>([]);
  const [mostEffective, setMostEffective] = useState<MostEffectiveSkill[]>([]);
  const [leastUsed, setLeastUsed] = useState<LeastUsedSkill[]>([]);
  const [leastEffective, setLeastEffective] = useState<LeastEffectiveSkill[]>([]);
  const [_trends, setTrends] = useState<SkillTrend[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetchSkills();
    fetchAnalytics();
  }, [tokens, selectedPersona, selectedTaskType]);

  const fetchSkills = async () => {
    if (!tokens?.accessToken) return;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ limit: "100" });
      if (selectedPersona) params.append("persona", selectedPersona);
      if (selectedTaskType) params.append("taskType", selectedTaskType);

      const response = await fetch(`/api/memory/procedural?${params}`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch skills");
      }

      const data = await response.json();
      setSkills(data.skills || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch skills");
    } finally {
      setLoading(false);
    }
  };

  const fetchAnalytics = async () => {
    if (!tokens?.accessToken) return;

    try {
      const [overviewRes, mostUsedRes, mostEffectiveRes, leastUsedRes, trendsRes] = await Promise.all([
        fetch("/api/memory/analytics/overview", {
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        }),
        fetch("/api/memory/analytics/most-used?limit=5", {
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        }),
        fetch("/api/memory/analytics/most-effective?limit=5&minUsage=1", {
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        }),
        fetch("/api/memory/analytics/least-used?limit=5", {
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        }),
        fetch("/api/memory/analytics/trends?days=30&memoryType=procedural", {
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        }),
      ]);

      if (overviewRes.ok) {
        setOverview(await overviewRes.json());
      }
      if (mostUsedRes.ok) {
        const data = await mostUsedRes.json();
        setMostUsed(data.skills || []);
      }
      if (mostEffectiveRes.ok) {
        const data = await mostEffectiveRes.json();
        setMostEffective(data.highestSuccess || []);
        // Also get least effective from the same endpoint
        setLeastEffective(data.leastEffective || []);
      }
      if (leastUsedRes.ok) {
        const data = await leastUsedRes.json();
        setLeastUsed(data.skills || []);
      }
      if (trendsRes.ok) {
        const data = await trendsRes.json();
        setTrends(data.trends || []);
      }
    } catch {
      // Analytics are optional, don't show error
    }
  };

  const handleDelete = async (skillId: string) => {
    if (!tokens?.accessToken) return;
    if (!confirm("Are you sure you want to delete this skill?")) return;

    setDeleting(skillId);
    try {
      const response = await fetch(`/api/memory/procedural/${skillId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to delete skill");
      }

      setSkills((prev) => prev.filter((s) => s.id !== skillId));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete skill");
    } finally {
      setDeleting(null);
    }
  };

  const filteredSkills = skills.filter((skill) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        skill.name.toLowerCase().includes(query) ||
        skill.description.toLowerCase().includes(query) ||
        skill.persona?.toLowerCase().includes(query)
      );
    }
    return true;
  });

  const personas = Array.from(new Set(skills.map((s) => s.persona).filter(Boolean))) as string[];
  const taskTypes = Array.from(new Set(skills.map((s) => s.taskType).filter(Boolean))) as string[];

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const getSuccessRateColor = (rate: number | null) => {
    if (rate === null) return "text-muted-foreground";
    if (rate >= 0.8) return "text-green-400";
    if (rate >= 0.5) return "text-yellow-400";
    return "text-red-400";
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Link
                to="/dashboard"
                className="text-muted-foreground hover:text-primary transition-colors"
              >
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <div>
                <h1 className="text-xl font-bold text-primary flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-accent" />
                  Skill Library
                </h1>
                <p className="text-sm text-muted-foreground">
                  Reusable procedures learned from successful tasks
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                fetchSkills();
                fetchAnalytics();
              }}
              className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Analytics Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-surface border border-border rounded-xl p-4 hover:border-muted-foreground/30 transition-colors">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <BookOpen className="h-4 w-4" />
              <span className="text-sm">Total Skills</span>
            </div>
            <p className="text-2xl font-bold text-primary">
              {overview?.byCategory?.procedural || skills.length}
            </p>
          </div>

          <div className="bg-surface border border-border rounded-xl p-4 hover:border-muted-foreground/30 transition-colors">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <BarChart3 className="h-4 w-4" />
              <span className="text-sm">Total Retrievals</span>
            </div>
            <p className="text-2xl font-bold text-primary">
              {mostUsed.reduce((sum, s) => sum + s.retrievalCount, 0) || 0}
            </p>
          </div>

          <div className="bg-surface border border-border rounded-xl p-4 hover:border-muted-foreground/30 transition-colors">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <TrendingUp className="h-4 w-4" />
              <span className="text-sm">Avg Success Rate</span>
            </div>
            <p className="text-2xl font-bold text-green-400">
              {mostEffective.length > 0
                ? `${Math.round(
                    (mostEffective.reduce((sum, s) => sum + s.successRate, 0) /
                      mostEffective.length) *
                      100
                  )}%`
                : "N/A"}
            </p>
          </div>

          <div className="bg-surface border border-border rounded-xl p-4 hover:border-muted-foreground/30 transition-colors">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Sparkles className="h-4 w-4" />
              <span className="text-sm">Created (24h)</span>
            </div>
            <p className="text-2xl font-bold text-primary">
              {overview?.recentActivity?.created24h || 0}
            </p>
          </div>
        </div>

        {/* Most Used & Most Effective */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* Most Used Skills */}
          <div className="bg-surface border border-border rounded-xl p-5">
            <h3 className="font-semibold text-primary mb-4 flex items-center gap-2">
              <Zap className="h-4 w-4 text-accent" />
              Most Used Skills
            </h3>
            {mostUsed.length === 0 ? (
              <p className="text-muted-foreground text-sm">No usage data yet</p>
            ) : (
              <ul className="space-y-3">
                {mostUsed.map((skill, index) => (
                  <li
                    key={skill.id}
                    className="flex items-center justify-between text-sm p-2 bg-background rounded-lg border border-border"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs font-medium">
                        {index + 1}
                      </span>
                      <span className="text-primary truncate">{skill.name}</span>
                    </div>
                    <span className="text-muted-foreground text-xs">{skill.retrievalCount} uses</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Most Effective Skills */}
          <div className="bg-surface border border-border rounded-xl p-5">
            <h3 className="font-semibold text-primary mb-4 flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-400" />
              Most Effective Skills
            </h3>
            {mostEffective.length === 0 ? (
              <p className="text-muted-foreground text-sm">No effectiveness data yet</p>
            ) : (
              <ul className="space-y-3">
                {mostEffective.map((skill, index) => (
                  <li
                    key={skill.id}
                    className="flex items-center justify-between text-sm p-2 bg-background rounded-lg border border-border"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center text-xs font-medium">
                        {index + 1}
                      </span>
                      <span className="text-primary truncate">{skill.name}</span>
                    </div>
                    <span className={`text-xs font-medium ${getSuccessRateColor(skill.successRate)}`}>
                      {Math.round(skill.successRate * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Least Used & Least Effective - Improvement Opportunities */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* Least Used Skills */}
          <div className="bg-surface border border-border rounded-xl p-5">
            <h3 className="font-semibold text-primary mb-4 flex items-center gap-2">
              <Archive className="h-4 w-4 text-yellow-400" />
              Least Used Skills
              <span className="text-xs text-muted-foreground font-normal ml-auto">May need promotion or removal</span>
            </h3>
            {leastUsed.length === 0 ? (
              <p className="text-muted-foreground text-sm">All skills are being used</p>
            ) : (
              <ul className="space-y-3">
                {leastUsed.map((skill, index) => (
                  <li
                    key={skill.id}
                    className="flex items-center justify-between text-sm p-2 bg-background rounded-lg border border-border"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-yellow-500/20 text-yellow-400 flex items-center justify-center text-xs font-medium">
                        {index + 1}
                      </span>
                      <span className="text-primary truncate" title={skill.description}>{skill.name}</span>
                    </div>
                    <span className="text-muted-foreground text-xs">
                      {skill.retrievalCount === 0 ? "Never used" : `${skill.retrievalCount} uses`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Least Effective Skills */}
          <div className="bg-surface border border-border rounded-xl p-5">
            <h3 className="font-semibold text-primary mb-4 flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-400" />
              Least Effective Skills
              <span className="text-xs text-muted-foreground font-normal ml-auto">Approaches that may not work</span>
            </h3>
            {leastEffective.length === 0 ? (
              <p className="text-muted-foreground text-sm">No low-effectiveness skills found</p>
            ) : (
              <ul className="space-y-3">
                {leastEffective.map((skill, index) => (
                  <li
                    key={skill.id}
                    className="flex items-center justify-between text-sm p-2 bg-background rounded-lg border border-border"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center text-xs font-medium">
                        {index + 1}
                      </span>
                      <div className="flex flex-col">
                        <span className="text-primary truncate" title={skill.description}>{skill.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {skill.failureCount} failures / {skill.successCount + skill.failureCount} uses
                        </span>
                      </div>
                    </div>
                    <span className={`text-xs font-medium ${getSuccessRateColor(skill.successRate)}`}>
                      {Math.round(skill.successRate * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Search and Filters */}
        <div className="bg-surface border border-border rounded-xl p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search skills..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-background border border-border rounded-lg text-primary placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
              />
            </div>

            <select
              value={selectedPersona || ""}
              onChange={(e) => setSelectedPersona(e.target.value || null)}
              className="px-3 py-2 bg-background border border-border rounded-lg text-primary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
            >
              <option value="">All Personas</option>
              {personas.map((persona) => (
                <option key={persona} value={persona}>
                  {persona.replace(/_/g, " ")}
                </option>
              ))}
            </select>

            <select
              value={selectedTaskType || ""}
              onChange={(e) => setSelectedTaskType(e.target.value || null)}
              className="px-3 py-2 bg-background border border-border rounded-lg text-primary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
            >
              <option value="">All Task Types</option>
              {taskTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Skills List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
          </div>
        ) : error ? (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-center">
            {error}
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="bg-surface border border-border rounded-xl p-12 text-center">
            <div className="mx-auto mb-4 p-4 bg-background rounded-full w-fit">
              <BookOpen className="h-12 w-12 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-primary mb-2">No Skills Found</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              Skills are automatically extracted from successful task completions.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredSkills.map((skill) => (
              <div
                key={skill.id}
                className="bg-surface border border-border rounded-xl overflow-hidden hover:border-muted-foreground/30 transition-colors"
              >
                {/* Skill Header */}
                <div
                  className="p-4 cursor-pointer"
                  onClick={() =>
                    setExpandedSkillId(expandedSkillId === skill.id ? null : skill.id)
                  }
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {skill.isVerified && (
                          <span className="flex items-center gap-1 text-green-400 text-xs">
                            <CheckCircle className="h-4 w-4" />
                            Verified
                          </span>
                        )}
                        {skill.persona && (
                          <span className="flex items-center gap-1 px-2 py-0.5 bg-accent/20 text-accent rounded text-xs font-medium">
                            <Tag className="h-3 w-3" />
                            {skill.persona.replace(/_/g, " ")}
                          </span>
                        )}
                        {skill.taskType && (
                          <span className="px-2 py-0.5 bg-background text-muted-foreground border border-border rounded text-xs">
                            {skill.taskType}
                          </span>
                        )}
                      </div>
                      <h3 className="font-semibold text-primary mt-2">{skill.name}</h3>
                      <p className="text-muted-foreground text-sm mt-1 line-clamp-2">
                        {skill.description}
                      </p>
                      <div className="flex flex-wrap items-center gap-3 mt-3 text-xs">
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatDate(skill.createdAt)}
                        </span>
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Zap className="h-3 w-3" />
                          {skill.usageCount} uses
                        </span>
                        {skill.successRate !== null ? (
                          <span
                            className={`flex items-center gap-1 ${getSuccessRateColor(
                              skill.successRate
                            )}`}
                          >
                            <TrendingUp className="h-3 w-3" />
                            {Math.round(skill.successRate * 100)}% success
                          </span>
                        ) : (
                          <span className="text-muted-foreground">No usage data</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-4">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(skill.id);
                        }}
                        disabled={deleting === skill.id}
                        className="p-2 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {deleting === skill.id ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                      {expandedSkillId === skill.id ? (
                        <ChevronUp className="h-5 w-5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded Details */}
                {expandedSkillId === skill.id && (
                  <div className="border-t border-border p-4 bg-background/50">
                    {/* Key Insight */}
                    {skill.insight && (
                      <div className="mb-6 p-4 bg-accent/5 border border-accent/20 rounded-lg">
                        <h4 className="font-medium text-primary mb-2 flex items-center gap-2">
                          <Zap className="h-4 w-4 text-accent" />
                          Key Insight
                        </h4>
                        <p className="text-primary text-sm leading-relaxed">{skill.insight}</p>
                      </div>
                    )}

                    {/* Steps */}
                    <div className="mb-6">
                      <h4 className="font-medium text-primary mb-3 flex items-center gap-2">
                        <Code2 className="h-4 w-4 text-accent" />
                        Steps
                      </h4>
                      <ol className="space-y-3">
                        {skill.steps.map((step) => (
                          <li key={step.step} className="flex gap-3">
                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent/20 text-accent flex items-center justify-center text-sm font-medium">
                              {step.step}
                            </span>
                            <div className="flex-1">
                              <p className="text-primary">{step.action}</p>
                              {step.details && (
                                <p className="text-muted-foreground text-sm mt-1">
                                  {step.details}
                                </p>
                              )}
                              {step.example && (
                                <code className="block text-xs bg-background border border-border rounded-lg px-3 py-2 mt-2 text-muted-foreground overflow-x-auto font-mono">
                                  {step.example}
                                </code>
                              )}
                            </div>
                          </li>
                        ))}
                      </ol>
                    </div>

                    {/* Prerequisites */}
                    {skill.prerequisites && (
                      <div className="mb-6">
                        <h4 className="font-medium text-primary mb-3 flex items-center gap-2">
                          <FileCode className="h-4 w-4 text-accent" />
                          Prerequisites
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                          {skill.prerequisites.technologies &&
                            skill.prerequisites.technologies.length > 0 && (
                              <div className="p-3 bg-background rounded-lg border border-border">
                                <span className="text-muted-foreground text-xs uppercase tracking-wider block mb-2">
                                  Technologies
                                </span>
                                <div className="flex flex-wrap gap-1">
                                  {skill.prerequisites.technologies.map((tech) => (
                                    <span
                                      key={tech}
                                      className="px-2 py-0.5 bg-accent/20 text-accent rounded text-xs"
                                    >
                                      {tech}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          {skill.prerequisites.dependencies &&
                            skill.prerequisites.dependencies.length > 0 && (
                              <div className="p-3 bg-background rounded-lg border border-border">
                                <span className="text-muted-foreground text-xs uppercase tracking-wider block mb-2">
                                  Dependencies
                                </span>
                                <div className="flex flex-wrap gap-1">
                                  {skill.prerequisites.dependencies.map((dep) => (
                                    <span
                                      key={dep}
                                      className="px-2 py-0.5 bg-surface border border-border rounded text-xs text-primary"
                                    >
                                      {dep}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          {skill.prerequisites.filesMustExist &&
                            skill.prerequisites.filesMustExist.length > 0 && (
                              <div className="p-3 bg-background rounded-lg border border-border">
                                <span className="text-muted-foreground text-xs uppercase tracking-wider block mb-2">
                                  Required Files
                                </span>
                                <div className="flex flex-wrap gap-1">
                                  {skill.prerequisites.filesMustExist.map((file) => (
                                    <code
                                      key={file}
                                      className="px-2 py-0.5 bg-background border border-border rounded text-xs text-muted-foreground font-mono"
                                    >
                                      {file}
                                    </code>
                                  ))}
                                </div>
                              </div>
                            )}
                        </div>
                      </div>
                    )}

                    {/* Source Info */}
                    {(skill.sourceTaskSummary || skill.repository) && (
                      <div className="pt-4 border-t border-border space-y-2">
                        {skill.sourceTaskSummary && (
                          <div className="flex items-start gap-2 text-sm">
                            <Sparkles className="h-4 w-4 text-muted-foreground mt-0.5" />
                            <div>
                              <span className="text-muted-foreground">Learned from: </span>
                              <span className="text-primary">{skill.sourceTaskSummary}</span>
                            </div>
                          </div>
                        )}
                        {skill.sourceTaskId && (
                          <Link
                            to={`/control-center?taskId=${skill.sourceTaskId}`}
                            className="text-accent hover:text-accent/80 text-sm flex items-center gap-1"
                          >
                            View source task
                          </Link>
                        )}
                        {skill.repository && (
                          <div className="flex items-center gap-2 text-sm">
                            <GitBranch className="h-4 w-4 text-muted-foreground" />
                            <span className="text-muted-foreground">Repository: </span>
                            <code className="text-primary bg-background px-1.5 py-0.5 rounded border border-border font-mono text-xs">
                              {skill.repository}
                            </code>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export default SkillLibrary;

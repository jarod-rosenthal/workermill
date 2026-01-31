import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Search,
  Brain,
  Database,
  History,
  Lightbulb,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Trash2,
  Edit3,
  X,
  Save,
  ChevronDown,
  ChevronUp,
  BarChart3,
  TrendingUp,
  Clock,
  Sparkles,
  Zap,
} from "lucide-react";
import { useAuthStore } from "../store/auth-store";

type MemoryType = "semantic" | "episodic" | "procedural";

interface SemanticMemory {
  id: string;
  category: string;
  subject: string;
  knowledge: string;
  confidence: number;
  repository: string | null;
  sourceTaskId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface EpisodicMemory {
  id: string;
  taskId: string;
  eventType: string;
  summary: string;
  details: Record<string, unknown> | null;
  outcome: string;
  outcomeDetails: string | null;
  repository: string | null;
  createdAt: string;
}

interface ProceduralMemory {
  id: string;
  name: string;
  description: string;
  steps: Array<{ step: number; action: string; details?: string }>;
  persona: string | null;
  taskType: string | null;
  isVerified: boolean;
  usageCount: number;
  successRate: number | null;
  createdAt: string;
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

interface MemoryTrend {
  date: string;
  count: number;
}

function MemoryManagement() {
  const tokens = useAuthStore((state) => state.tokens);
  const [activeTab, setActiveTab] = useState<MemoryType>("semantic");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Data states
  const [semanticMemories, setSemanticMemories] = useState<SemanticMemory[]>([]);
  const [episodicMemories, setEpisodicMemories] = useState<EpisodicMemory[]>([]);
  const [proceduralMemories, setProceduralMemories] = useState<ProceduralMemory[]>([]);
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [trends, setTrends] = useState<MemoryTrend[]>([]);

  // UI states
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [outcomeFilter, setOutcomeFilter] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
    fetchAnalytics();
  }, [tokens, activeTab, categoryFilter, outcomeFilter]);

  const fetchData = async () => {
    if (!tokens?.accessToken) return;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ limit: "100" });
      if (categoryFilter) params.append("category", categoryFilter);
      if (outcomeFilter) params.append("outcome", outcomeFilter);

      const response = await fetch(`/api/memory/${activeTab}?${params}`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
        cache: "no-store",
      });

      if (!response.ok) throw new Error("Failed to fetch memories");

      const data = await response.json();

      switch (activeTab) {
        case "semantic":
          setSemanticMemories(data.memories || []);
          break;
        case "episodic":
          setEpisodicMemories(data.memories || []);
          break;
        case "procedural":
          setProceduralMemories(data.skills || []);
          break;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch memories");
    } finally {
      setLoading(false);
    }
  };

  const fetchAnalytics = async () => {
    if (!tokens?.accessToken) return;

    try {
      const [overviewRes, trendsRes] = await Promise.all([
        fetch("/api/memory/analytics/overview", {
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
          cache: "no-store",
        }),
        fetch(`/api/memory/analytics/trends?days=30&memoryType=${activeTab}`, {
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
          cache: "no-store",
        }),
      ]);

      if (overviewRes.ok) setOverview(await overviewRes.json());
      if (trendsRes.ok) {
        const data = await trendsRes.json();
        setTrends(data.trends || []);
      }
    } catch {
      // Analytics are optional
    }
  };

  const handleDelete = async (id: string) => {
    if (!tokens?.accessToken) return;
    if (!confirm("Are you sure you want to delete this memory?")) return;

    setDeleting(id);
    try {
      const response = await fetch(`/api/memory/${activeTab}/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });

      if (!response.ok) throw new Error("Failed to delete memory");

      // Remove from state
      switch (activeTab) {
        case "semantic":
          setSemanticMemories((prev) => prev.filter((m) => m.id !== id));
          break;
        case "episodic":
          setEpisodicMemories((prev) => prev.filter((m) => m.id !== id));
          break;
        case "procedural":
          setProceduralMemories((prev) => prev.filter((m) => m.id !== id));
          break;
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete memory");
    } finally {
      setDeleting(null);
    }
  };

  const handleEdit = (id: string, initialData: Record<string, string>) => {
    setEditingId(id);
    setEditForm(initialData);
  };

  const handleSave = async (id: string) => {
    if (!tokens?.accessToken) return;
    setSaving(true);

    try {
      const response = await fetch(`/api/memory/${activeTab}/${id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(editForm),
      });

      if (!response.ok) throw new Error("Failed to update memory");

      const updated = await response.json();

      // Update state
      switch (activeTab) {
        case "semantic":
          setSemanticMemories((prev) =>
            prev.map((m) => (m.id === id ? { ...m, ...updated.memory } : m))
          );
          break;
        case "episodic":
          setEpisodicMemories((prev) =>
            prev.map((m) => (m.id === id ? { ...m, ...updated.memory } : m))
          );
          break;
        case "procedural":
          setProceduralMemories((prev) =>
            prev.map((m) => (m.id === id ? { ...m, ...updated.skill } : m))
          );
          break;
      }

      setEditingId(null);
      setEditForm({});
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update memory");
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getOutcomeIcon = (outcome: string) => {
    switch (outcome) {
      case "success":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "failure":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "partial":
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      default:
        return null;
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return "text-green-400";
    if (confidence >= 0.5) return "text-yellow-400";
    return "text-red-400";
  };

  const filterBySearch = <T extends { id: string }>(
    items: T[],
    searchFields: (keyof T)[]
  ): T[] => {
    if (!searchQuery) return items;
    const query = searchQuery.toLowerCase();
    return items.filter((item) =>
      searchFields.some((field) => {
        const value = item[field];
        return typeof value === "string" && value.toLowerCase().includes(query);
      })
    );
  };

  const filteredSemantic = filterBySearch(semanticMemories, [
    "subject",
    "knowledge",
    "category",
  ]);
  const filteredEpisodic = filterBySearch(episodicMemories, [
    "summary",
    "eventType",
    "outcomeDetails",
  ]);
  const filteredProcedural = filterBySearch(proceduralMemories, [
    "name",
    "description",
    "persona",
  ]);

  const categories = Array.from(new Set(semanticMemories.map((m) => m.category)));
  const outcomes = ["success", "failure", "partial"];

  const tabs: { id: MemoryType; label: string; icon: React.ReactNode; count: number }[] = [
    {
      id: "semantic",
      label: "Knowledge",
      icon: <Lightbulb className="h-4 w-4" />,
      count: overview?.byCategory?.semantic || semanticMemories.length,
    },
    {
      id: "episodic",
      label: "Experiences",
      icon: <History className="h-4 w-4" />,
      count: overview?.byCategory?.episodic || episodicMemories.length,
    },
    {
      id: "procedural",
      label: "Skills",
      icon: <Database className="h-4 w-4" />,
      count: overview?.byCategory?.procedural || proceduralMemories.length,
    },
  ];

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
                  <Brain className="h-5 w-5 text-accent" />
                  Memory Management
                </h1>
                <p className="text-sm text-muted-foreground">
                  View, edit, and manage agent memories
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                fetchData();
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
              <Brain className="h-4 w-4" />
              <span className="text-sm">Total Memories</span>
            </div>
            <p className="text-2xl font-bold text-primary">
              {overview?.totalMemories || 0}
            </p>
          </div>

          <div className="bg-surface border border-border rounded-xl p-4 hover:border-muted-foreground/30 transition-colors">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <TrendingUp className="h-4 w-4" />
              <span className="text-sm">Avg Confidence</span>
            </div>
            <p
              className={`text-2xl font-bold ${getConfidenceColor(
                overview?.avgConfidence || 0
              )}`}
            >
              {overview?.avgConfidence
                ? `${Math.round(overview.avgConfidence * 100)}%`
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

          <div className="bg-surface border border-border rounded-xl p-4 hover:border-muted-foreground/30 transition-colors">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <BarChart3 className="h-4 w-4" />
              <span className="text-sm">Retrieved (24h)</span>
            </div>
            <p className="text-2xl font-bold text-primary">
              {overview?.recentActivity?.retrieved24h || 0}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-accent text-accent"
                  : "border-transparent text-muted-foreground hover:text-primary"
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
              <span className="text-xs bg-background px-2 py-0.5 rounded-full border border-border">
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Search and Filters */}
        <div className="bg-surface border border-border rounded-xl p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search memories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-background border border-border rounded-lg text-primary placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
              />
            </div>

            {activeTab === "semantic" && (
              <select
                value={categoryFilter || ""}
                onChange={(e) => setCategoryFilter(e.target.value || null)}
                className="px-3 py-2 bg-background border border-border rounded-lg text-primary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
              >
                <option value="">All Categories</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            )}

            {activeTab === "episodic" && (
              <select
                value={outcomeFilter || ""}
                onChange={(e) => setOutcomeFilter(e.target.value || null)}
                className="px-3 py-2 bg-background border border-border rounded-lg text-primary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
              >
                <option value="">All Outcomes</option>
                {outcomes.map((outcome) => (
                  <option key={outcome} value={outcome}>
                    {outcome.charAt(0).toUpperCase() + outcome.slice(1)}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Memory List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
          </div>
        ) : error ? (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-center">
            {error}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Semantic Memories */}
            {activeTab === "semantic" &&
              (filteredSemantic.length === 0 ? (
                <EmptyState type="knowledge" />
              ) : (
                filteredSemantic.map((memory) => (
                  <MemoryCard
                    key={memory.id}
                    id={memory.id}
                    isExpanded={expandedId === memory.id}
                    isEditing={editingId === memory.id}
                    onToggle={() =>
                      setExpandedId(expandedId === memory.id ? null : memory.id)
                    }
                    onEdit={() =>
                      handleEdit(memory.id, {
                        subject: memory.subject,
                        knowledge: memory.knowledge,
                        confidence: String(memory.confidence),
                      })
                    }
                    onSave={() => handleSave(memory.id)}
                    onCancelEdit={() => {
                      setEditingId(null);
                      setEditForm({});
                    }}
                    onDelete={() => handleDelete(memory.id)}
                    deleting={deleting === memory.id}
                    saving={saving}
                    header={
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="px-2 py-0.5 bg-accent/20 text-accent rounded text-xs font-medium">
                            {memory.category}
                          </span>
                          <span
                            className={`text-xs ${getConfidenceColor(
                              memory.confidence
                            )}`}
                          >
                            {Math.round(memory.confidence * 100)}% confidence
                          </span>
                        </div>
                        <h3 className="font-semibold text-primary mt-2">
                          {memory.subject}
                        </h3>
                        <p className="text-muted-foreground text-sm mt-1 line-clamp-2">
                          {memory.knowledge}
                        </p>
                        <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDate(memory.createdAt)}
                          </span>
                          {memory.repository && (
                            <code className="bg-background px-1.5 py-0.5 rounded border border-border">
                              {memory.repository}
                            </code>
                          )}
                        </div>
                      </div>
                    }
                    expandedContent={
                      editingId === memory.id ? (
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm text-muted-foreground mb-1">
                              Subject
                            </label>
                            <input
                              type="text"
                              value={editForm.subject || ""}
                              onChange={(e) =>
                                setEditForm({ ...editForm, subject: e.target.value })
                              }
                              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                            />
                          </div>
                          <div>
                            <label className="block text-sm text-muted-foreground mb-1">
                              Knowledge
                            </label>
                            <textarea
                              value={editForm.knowledge || ""}
                              onChange={(e) =>
                                setEditForm({ ...editForm, knowledge: e.target.value })
                              }
                              rows={4}
                              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-primary focus:outline-none focus:ring-2 focus:ring-accent resize-none"
                            />
                          </div>
                          <div>
                            <label className="block text-sm text-muted-foreground mb-1">
                              Confidence (0-1)
                            </label>
                            <input
                              type="number"
                              min="0"
                              max="1"
                              step="0.1"
                              value={editForm.confidence || ""}
                              onChange={(e) =>
                                setEditForm({ ...editForm, confidence: e.target.value })
                              }
                              className="w-32 px-3 py-2 bg-background border border-border rounded-lg text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                            />
                          </div>
                        </div>
                      ) : (
                        <div>
                          <p className="text-primary whitespace-pre-wrap">
                            {memory.knowledge}
                          </p>
                        </div>
                      )
                    }
                  />
                ))
              ))}

            {/* Episodic Memories */}
            {activeTab === "episodic" &&
              (filteredEpisodic.length === 0 ? (
                <EmptyState type="experiences" />
              ) : (
                filteredEpisodic.map((memory) => (
                  <MemoryCard
                    key={memory.id}
                    id={memory.id}
                    isExpanded={expandedId === memory.id}
                    isEditing={editingId === memory.id}
                    onToggle={() =>
                      setExpandedId(expandedId === memory.id ? null : memory.id)
                    }
                    onEdit={() =>
                      handleEdit(memory.id, {
                        summary: memory.summary,
                        outcomeDetails: memory.outcomeDetails || "",
                      })
                    }
                    onSave={() => handleSave(memory.id)}
                    onCancelEdit={() => {
                      setEditingId(null);
                      setEditForm({});
                    }}
                    onDelete={() => handleDelete(memory.id)}
                    deleting={deleting === memory.id}
                    saving={saving}
                    header={
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          {getOutcomeIcon(memory.outcome)}
                          <span className="text-xs text-muted-foreground capitalize">
                            {memory.eventType.replace(/_/g, " ")}
                          </span>
                        </div>
                        <h3 className="font-semibold text-primary mt-2">
                          {memory.summary}
                        </h3>
                        <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDate(memory.createdAt)}
                          </span>
                          {memory.repository && (
                            <code className="bg-background px-1.5 py-0.5 rounded border border-border">
                              {memory.repository}
                            </code>
                          )}
                        </div>
                      </div>
                    }
                    expandedContent={
                      editingId === memory.id ? (
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm text-muted-foreground mb-1">
                              Summary
                            </label>
                            <textarea
                              value={editForm.summary || ""}
                              onChange={(e) =>
                                setEditForm({ ...editForm, summary: e.target.value })
                              }
                              rows={2}
                              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-primary focus:outline-none focus:ring-2 focus:ring-accent resize-none"
                            />
                          </div>
                          <div>
                            <label className="block text-sm text-muted-foreground mb-1">
                              Outcome Details
                            </label>
                            <textarea
                              value={editForm.outcomeDetails || ""}
                              onChange={(e) =>
                                setEditForm({
                                  ...editForm,
                                  outcomeDetails: e.target.value,
                                })
                              }
                              rows={4}
                              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-primary focus:outline-none focus:ring-2 focus:ring-accent resize-none"
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {memory.outcomeDetails && (
                            <div>
                              <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1">
                                <Lightbulb className="h-4 w-4" />
                                Outcome Details
                              </h4>
                              <p className="text-primary">{memory.outcomeDetails}</p>
                            </div>
                          )}
                          {memory.details && Object.keys(memory.details).length > 0 && (
                            <div>
                              <h4 className="text-sm font-medium text-muted-foreground mb-2">
                                Details
                              </h4>
                              <pre className="text-xs text-muted-foreground bg-background border border-border rounded-lg p-3 overflow-x-auto">
                                {JSON.stringify(memory.details, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      )
                    }
                  />
                ))
              ))}

            {/* Procedural Memories (Skills) */}
            {activeTab === "procedural" &&
              (filteredProcedural.length === 0 ? (
                <EmptyState type="skills" />
              ) : (
                filteredProcedural.map((skill) => (
                  <MemoryCard
                    key={skill.id}
                    id={skill.id}
                    isExpanded={expandedId === skill.id}
                    isEditing={editingId === skill.id}
                    onToggle={() =>
                      setExpandedId(expandedId === skill.id ? null : skill.id)
                    }
                    onEdit={() =>
                      handleEdit(skill.id, {
                        name: skill.name,
                        description: skill.description,
                      })
                    }
                    onSave={() => handleSave(skill.id)}
                    onCancelEdit={() => {
                      setEditingId(null);
                      setEditForm({});
                    }}
                    onDelete={() => handleDelete(skill.id)}
                    deleting={deleting === skill.id}
                    saving={saving}
                    header={
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {skill.isVerified && (
                            <span className="flex items-center gap-1 text-green-400 text-xs">
                              <CheckCircle className="h-4 w-4" />
                              Verified
                            </span>
                          )}
                          {skill.persona && (
                            <span className="px-2 py-0.5 bg-accent/20 text-accent rounded text-xs font-medium">
                              {skill.persona.replace(/_/g, " ")}
                            </span>
                          )}
                        </div>
                        <h3 className="font-semibold text-primary mt-2">
                          {skill.name}
                        </h3>
                        <p className="text-muted-foreground text-sm mt-1 line-clamp-2">
                          {skill.description}
                        </p>
                        <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDate(skill.createdAt)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Zap className="h-3 w-3" />
                            {skill.usageCount} uses
                          </span>
                          {skill.successRate !== null && (
                            <span
                              className={getConfidenceColor(skill.successRate)}
                            >
                              {Math.round(skill.successRate * 100)}% success
                            </span>
                          )}
                        </div>
                      </div>
                    }
                    expandedContent={
                      editingId === skill.id ? (
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm text-muted-foreground mb-1">
                              Name
                            </label>
                            <input
                              type="text"
                              value={editForm.name || ""}
                              onChange={(e) =>
                                setEditForm({ ...editForm, name: e.target.value })
                              }
                              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                            />
                          </div>
                          <div>
                            <label className="block text-sm text-muted-foreground mb-1">
                              Description
                            </label>
                            <textarea
                              value={editForm.description || ""}
                              onChange={(e) =>
                                setEditForm({
                                  ...editForm,
                                  description: e.target.value,
                                })
                              }
                              rows={4}
                              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-primary focus:outline-none focus:ring-2 focus:ring-accent resize-none"
                            />
                          </div>
                        </div>
                      ) : (
                        <div>
                          <h4 className="text-sm font-medium text-muted-foreground mb-3">
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
                                </div>
                              </li>
                            ))}
                          </ol>
                        </div>
                      )
                    }
                  />
                ))
              ))}
          </div>
        )}
      </main>
    </div>
  );
}

// Reusable Memory Card Component
function MemoryCard({
  id,
  isExpanded,
  isEditing,
  onToggle,
  onEdit,
  onSave,
  onCancelEdit,
  onDelete,
  deleting,
  saving,
  header,
  expandedContent,
}: {
  id: string;
  isExpanded: boolean;
  isEditing: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onSave: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
  saving: boolean;
  header: React.ReactNode;
  expandedContent: React.ReactNode;
}) {
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden hover:border-muted-foreground/30 transition-colors">
      <div
        className="p-4 cursor-pointer"
        onClick={onToggle}
      >
        <div className="flex items-start justify-between">
          {header}
          <div className="flex items-center gap-1 ml-4">
            {isEditing ? (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSave();
                  }}
                  disabled={saving}
                  className="p-2 text-green-400 hover:text-green-300 hover:bg-green-500/10 rounded-lg transition-colors disabled:opacity-50"
                >
                  {saving ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancelEdit();
                  }}
                  className="p-2 text-muted-foreground hover:text-primary hover:bg-background rounded-lg transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit();
                  }}
                  className="p-2 text-muted-foreground hover:text-primary hover:bg-background rounded-lg transition-colors"
                >
                  <Edit3 className="h-4 w-4" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  disabled={deleting}
                  className="p-2 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                >
                  {deleting ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              </>
            )}
            {isExpanded ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-border p-4 bg-background/50">
          {expandedContent}
        </div>
      )}
    </div>
  );
}

// Empty State Component
function EmptyState({ type }: { type: "knowledge" | "experiences" | "skills" }) {
  const config = {
    knowledge: {
      icon: <Lightbulb className="h-12 w-12 text-muted-foreground" />,
      title: "No Knowledge Found",
      description: "Semantic memories store patterns and conventions learned from tasks.",
    },
    experiences: {
      icon: <History className="h-12 w-12 text-muted-foreground" />,
      title: "No Experiences Found",
      description: "Episodic memories capture what happened during task execution.",
    },
    skills: {
      icon: <Database className="h-12 w-12 text-muted-foreground" />,
      title: "No Skills Found",
      description: "Skills are reusable procedures extracted from successful tasks.",
    },
  };

  const { icon, title, description } = config[type];

  return (
    <div className="bg-surface border border-border rounded-xl p-12 text-center">
      <div className="mx-auto mb-4 p-4 bg-background rounded-full w-fit">{icon}</div>
      <h3 className="text-lg font-semibold text-primary mb-2">{title}</h3>
      <p className="text-muted-foreground max-w-md mx-auto">{description}</p>
    </div>
  );
}

export default MemoryManagement;

import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Plus,
  Search,
  Settings,
  ChevronRight,
  ToggleLeft,
  ToggleRight,
  Loader2,
  AlertCircle,
  X,
  Sliders,
  Tag,
  FileText,
  Play,
  Trash2,
  Save,
} from "lucide-react";
import { useAuthStore } from "../store/auth-store";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface Persona {
  id: string;
  slug: string;
  name: string;
  emoji: string | null;
  color: string | null;
  shortLabel: string | null;
  description: string | null;
  enabled: boolean;
  isSystem: boolean;
  priority: number;
  skills: string[] | null;
  riskLevel: "low" | "medium" | "high";
  createdAt: string;
  updatedAt: string;
}

interface InferenceRules {
  labelMappings?: Record<string, string>;
  keywordPatterns?: Record<string, string>;
  defaultPersona?: string;
}

interface InferenceDefaults {
  labelMappings: Record<string, string>;
  keywordPatterns: Record<string, string>;
  availableSystemPersonas: string[];
}

type TabType = "personas" | "inference";

export default function PersonaStudio() {
  const tokens = useAuthStore((state) => state.tokens);
  const organization = useAuthStore((state) => state.organization);
  const isInitialized = useAuthStore((state) => state.isInitialized);
  const initialize = useAuthStore((state) => state.initialize);
  const isProPlan = false; // Plan-gating removed — all features available
  const navigate = useNavigate();

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Create form state
  const [newPersona, setNewPersona] = useState({
    slug: "",
    name: "",
    emoji: "",
    color: "#3B82F6",
    shortLabel: "",
    description: "",
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>("personas");

  // Inference rules state
  const [_inferenceRules, setInferenceRules] = useState<InferenceRules>({});
  const [inferenceDefaults, setInferenceDefaults] = useState<InferenceDefaults | null>(null);
  const [inferenceLoading, setInferenceLoading] = useState(false);
  const [inferenceSaving, setInferenceSaving] = useState(false);
  const [inferenceError, setInferenceError] = useState<string | null>(null);

  // Editable inference state
  const [editLabelMappings, setEditLabelMappings] = useState<Array<{ label: string; persona: string }>>([]);
  const [editKeywordPatterns, setEditKeywordPatterns] = useState<Array<{ persona: string; pattern: string }>>([]);
  const [editDefaultPersona, setEditDefaultPersona] = useState("");

  // Test inference state
  const [testSummary, setTestSummary] = useState("");
  const [testDescription, setTestDescription] = useState("");
  const [testLabels, setTestLabels] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  // Initialize auth on mount if not already initialized
  useEffect(() => {
    if (!isInitialized) {
      initialize();
    }
  }, [isInitialized, initialize]);

  // Redirect to login if not authenticated after initialization
  useEffect(() => {
    if (isInitialized && !tokens) {
      navigate("/login");
    }
  }, [isInitialized, tokens, navigate]);

  useEffect(() => {
    if (isInitialized && tokens) {
      fetchPersonas();
    }
  }, [isInitialized, tokens]);

  const fetchPersonas = async () => {
    if (!tokens) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/personas`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch personas");
      }

      const data = await response.json();
      setPersonas(data.personas);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load personas");
    } finally {
      setLoading(false);
    }
  };

  const fetchInferenceRules = async () => {
    if (!tokens) return;

    setInferenceLoading(true);
    setInferenceError(null);

    try {
      const response = await fetch(`${API_BASE}/api/settings/persona-inference-rules`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch inference rules");
      }

      const data = await response.json();
      setInferenceRules(data.rules || {});
      setInferenceDefaults(data.defaults || null);

      // Initialize editable state
      const rules = data.rules || {};
      setEditLabelMappings(
        Object.entries(rules.labelMappings || {}).map(([label, persona]) => ({
          label,
          persona: persona as string,
        }))
      );
      setEditKeywordPatterns(
        Object.entries(rules.keywordPatterns || {}).map(([persona, pattern]) => ({
          persona,
          pattern: pattern as string,
        }))
      );
      setEditDefaultPersona(rules.defaultPersona || "");
    } catch (err) {
      setInferenceError(err instanceof Error ? err.message : "Failed to load inference rules");
    } finally {
      setInferenceLoading(false);
    }
  };

  const saveInferenceRules = async () => {
    if (!tokens) return;

    setInferenceSaving(true);
    setInferenceError(null);

    try {
      const labelMappings: Record<string, string> = {};
      editLabelMappings.forEach(({ label, persona }) => {
        if (label.trim() && persona.trim()) {
          labelMappings[label.trim().toLowerCase()] = persona.trim();
        }
      });

      const keywordPatterns: Record<string, string> = {};
      editKeywordPatterns.forEach(({ persona, pattern }) => {
        if (persona.trim() && pattern.trim()) {
          keywordPatterns[persona.trim()] = pattern.trim();
        }
      });

      const response = await fetch(`${API_BASE}/api/settings/persona-inference-rules`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          labelMappings: Object.keys(labelMappings).length > 0 ? labelMappings : undefined,
          keywordPatterns: Object.keys(keywordPatterns).length > 0 ? keywordPatterns : undefined,
          defaultPersona: editDefaultPersona.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save inference rules");
      }

      const data = await response.json();
      setInferenceRules(data.rules || {});
    } catch (err) {
      setInferenceError(err instanceof Error ? err.message : "Failed to save inference rules");
    } finally {
      setInferenceSaving(false);
    }
  };

  const resetInferenceRules = async () => {
    if (!tokens) return;

    if (!confirm("Reset all custom inference rules to defaults?")) return;

    setInferenceSaving(true);
    setInferenceError(null);

    try {
      const response = await fetch(`${API_BASE}/api/settings/persona-inference-rules`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to reset inference rules");
      }

      // Clear editable state
      setEditLabelMappings([]);
      setEditKeywordPatterns([]);
      setEditDefaultPersona("");
      setInferenceRules({});
    } catch (err) {
      setInferenceError(err instanceof Error ? err.message : "Failed to reset inference rules");
    } finally {
      setInferenceSaving(false);
    }
  };

  const testInference = async () => {
    if (!tokens) return;

    setTestLoading(true);
    setTestResult(null);

    try {
      const labels = testLabels
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean);

      const response = await fetch(`${API_BASE}/api/settings/test-persona-inference`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: testSummary || undefined,
          description: testDescription || undefined,
          labels: labels.length > 0 ? labels : undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to test inference");
      }

      const data = await response.json();
      setTestResult(data.inferredPersona);
    } catch (err) {
      setTestResult(`Error: ${err instanceof Error ? err.message : "Failed"}`);
    } finally {
      setTestLoading(false);
    }
  };

  // Fetch inference rules when switching to that tab
  useEffect(() => {
    if (activeTab === "inference" && isInitialized && tokens && !inferenceDefaults) {
      fetchInferenceRules();
    }
  }, [activeTab, isInitialized, tokens]);

  const handleToggleEnabled = async (persona: Persona) => {
    if (!tokens || persona.isSystem) return;

    try {
      const response = await fetch(`${API_BASE}/api/personas/${persona.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ enabled: !persona.enabled }),
      });

      if (!response.ok) {
        throw new Error("Failed to update persona");
      }

      // Update local state
      setPersonas((prev) =>
        prev.map((p) =>
          p.id === persona.id ? { ...p, enabled: !p.enabled } : p
        )
      );
    } catch (err) {
      console.error("Error toggling persona:", err);
    }
  };

  const handleCreatePersona = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokens) return;

    setCreating(true);
    setCreateError(null);

    try {
      const response = await fetch(`${API_BASE}/api/personas`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(newPersona),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create persona");
      }

      const data = await response.json();
      setShowCreateModal(false);
      setNewPersona({
        slug: "",
        name: "",
        emoji: "",
        color: "#3B82F6",
        shortLabel: "",
        description: "",
      });

      // Navigate to the new persona
      navigate(`/personas/${data.persona.id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create persona");
    } finally {
      setCreating(false);
    }
  };

  // Hide internal system personas not shown to users
  const hiddenSlugs = ["support_agent", "manager"];
  const filteredPersonas = personas.filter((p) => {
    if (hiddenSlugs.includes(p.slug)) return false;
    const query = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(query) ||
      p.slug.toLowerCase().includes(query) ||
      (p.description && p.description.toLowerCase().includes(query))
    );
  });

  const getRiskBadgeColor = (risk: string) => {
    switch (risk) {
      case "low":
        return "bg-green-500/20 text-green-400 border-green-500/30";
      case "medium":
        return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      case "high":
        return "bg-red-500/20 text-red-400 border-red-500/30";
      default:
        return "bg-gray-500/20 text-gray-400 border-gray-500/30";
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Link
                to="/dashboard"
                className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="text-sm">Back to Dashboard</span>
              </Link>
              <div className="h-6 w-px bg-border" />
              <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Persona Studio
              </h1>
            </div>

            {activeTab === "personas" && (
              isProPlan ? (
                <Link
                  to="/pricing"
                  className="flex items-center gap-2 px-4 py-2 bg-muted text-muted-foreground rounded-lg hover:bg-muted/80 transition-colors cursor-pointer"
                  data-testid="create-persona-btn"
                >
                  <Plus className="h-4 w-4" />
                  New Persona
                  <span className="text-[10px] font-semibold bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">MAX</span>
                </Link>
              ) : (
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                  data-testid="create-persona-btn"
                >
                  <Plus className="h-4 w-4" />
                  New Persona
                </button>
              )
            )}
          </div>

          {/* Tabs */}
          <div className="flex gap-1 -mb-px">
            <button
              onClick={() => setActiveTab("personas")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "personas"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              <span className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Personas
              </span>
            </button>
            <button
              onClick={() => setActiveTab("inference")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "inference"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              <span className="flex items-center gap-2">
                <Sliders className="h-4 w-4" />
                Inference Rules
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Personas Tab */}
        {activeTab === "personas" && (
          <>
            {/* Search */}
            <div className="mb-6">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search personas..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  data-testid="persona-search"
                />
              </div>
            </div>

            {/* Loading State */}
            {loading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* Error State */}
            {error && (
              <div className="flex items-center gap-2 p-4 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Personas Grid */}
            {!loading && !error && (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredPersonas.map((persona) => (
                  <Link
                    key={persona.id}
                    to={`/personas/${persona.id}`}
                    className="group bg-card border border-border rounded-xl p-5 hover:border-primary/50 hover:bg-muted/30 transition-all"
                    data-testid="persona-card"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-10 h-10 rounded-lg flex items-center justify-center text-xl"
                          style={{ backgroundColor: persona.color ? `${persona.color}20` : "#3B82F620" }}
                        >
                          {persona.emoji || "🤖"}
                        </div>
                        <div>
                          <h3 className="font-medium text-foreground group-hover:text-primary transition-colors">
                            {persona.name}
                          </h3>
                          <p className="text-xs text-muted-foreground font-mono">
                            {persona.slug}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          handleToggleEnabled(persona);
                        }}
                        disabled={persona.isSystem}
                        className={`p-1 rounded ${
                          persona.isSystem
                            ? "text-muted-foreground cursor-not-allowed"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {persona.enabled ? (
                          <ToggleRight className="h-5 w-5 text-green-500" />
                        ) : (
                          <ToggleLeft className="h-5 w-5" />
                        )}
                      </button>
                    </div>

                    <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                      {persona.description || "No description"}
                    </p>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 text-xs rounded-full border ${getRiskBadgeColor(
                            persona.riskLevel
                          )}`}
                        >
                          {persona.riskLevel}
                        </span>
                        {persona.isSystem && (
                          <span className="px-2 py-0.5 text-xs rounded-full border border-blue-500/30 bg-blue-500/20 text-blue-400">
                            system
                          </span>
                        )}
                      </div>

                      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </Link>
                ))}

                {filteredPersonas.length === 0 && searchQuery && (
                  <div className="col-span-full text-center py-12 text-muted-foreground" data-testid="empty-state">
                    No personas found matching "{searchQuery}"
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Inference Rules Tab */}
        {activeTab === "inference" && (
          <div className="space-y-8">
            {/* Loading State */}
            {inferenceLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* Error State */}
            {inferenceError && (
              <div className="flex items-center gap-2 p-4 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <span>{inferenceError}</span>
              </div>
            )}

            {!inferenceLoading && (
              <>
                {/* Description */}
                <div className="bg-muted/30 border border-border rounded-lg p-4">
                  <p className="text-sm text-muted-foreground">
                    Configure how WorkerMill automatically assigns personas to incoming tickets based on labels, keywords, and content.
                    Custom rules override system defaults. Org-specific keyword patterns get 2x weight in scoring.
                  </p>
                </div>

                {/* Label Mappings */}
                <div className="bg-card border border-border rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Tag className="h-5 w-5 text-primary" />
                      <h2 className="text-lg font-semibold text-foreground">Label Mappings</h2>
                    </div>
                    <button
                      onClick={() => setEditLabelMappings([...editLabelMappings, { label: "", persona: "" }])}
                      className="flex items-center gap-1 text-sm text-primary hover:text-primary/80"
                    >
                      <Plus className="h-4 w-4" />
                      Add Mapping
                    </button>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    Map Jira/Linear labels directly to personas. When a ticket has a matching label, that persona is used.
                  </p>

                  {editLabelMappings.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">No custom label mappings. Using system defaults.</p>
                  ) : (
                    <div className="space-y-2">
                      {editLabelMappings.map((mapping, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={mapping.label}
                            onChange={(e) => {
                              const updated = [...editLabelMappings];
                              updated[idx].label = e.target.value;
                              setEditLabelMappings(updated);
                            }}
                            placeholder="Label (e.g., backend)"
                            className="flex-1 px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                          />
                          <span className="text-muted-foreground">&rarr;</span>
                          <input
                            type="text"
                            value={mapping.persona}
                            onChange={(e) => {
                              const updated = [...editLabelMappings];
                              updated[idx].persona = e.target.value;
                              setEditLabelMappings(updated);
                            }}
                            placeholder="Persona slug"
                            className="flex-1 px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                          />
                          <button
                            onClick={() => setEditLabelMappings(editLabelMappings.filter((_, i) => i !== idx))}
                            className="p-2 text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {inferenceDefaults && (
                    <details className="mt-4">
                      <summary className="text-sm text-muted-foreground cursor-pointer hover:text-foreground">
                        View system defaults
                      </summary>
                      <div className="mt-2 p-3 bg-muted/30 rounded-lg text-xs font-mono">
                        {Object.entries(inferenceDefaults.labelMappings).map(([label, persona]) => (
                          <div key={label} className="text-muted-foreground">
                            {label} &rarr; {persona}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>

                {/* Keyword Patterns */}
                <div className="bg-card border border-border rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <FileText className="h-5 w-5 text-primary" />
                      <h2 className="text-lg font-semibold text-foreground">Keyword Patterns</h2>
                    </div>
                    <button
                      onClick={() => setEditKeywordPatterns([...editKeywordPatterns, { persona: "", pattern: "" }])}
                      className="flex items-center gap-1 text-sm text-primary hover:text-primary/80"
                    >
                      <Plus className="h-4 w-4" />
                      Add Pattern
                    </button>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    Define regex patterns to match in ticket summary/description. Patterns use pipe (|) for OR matching.
                  </p>

                  {editKeywordPatterns.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">No custom keyword patterns. Using system defaults.</p>
                  ) : (
                    <div className="space-y-2">
                      {editKeywordPatterns.map((kp, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={kp.persona}
                            onChange={(e) => {
                              const updated = [...editKeywordPatterns];
                              updated[idx].persona = e.target.value;
                              setEditKeywordPatterns(updated);
                            }}
                            placeholder="Persona slug"
                            className="w-48 px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                          />
                          <span className="text-muted-foreground">:</span>
                          <input
                            type="text"
                            value={kp.pattern}
                            onChange={(e) => {
                              const updated = [...editKeywordPatterns];
                              updated[idx].pattern = e.target.value;
                              setEditKeywordPatterns(updated);
                            }}
                            placeholder="Pattern (e.g., stripe|payment|billing)"
                            className="flex-1 px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                          />
                          <button
                            onClick={() => setEditKeywordPatterns(editKeywordPatterns.filter((_, i) => i !== idx))}
                            className="p-2 text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {inferenceDefaults && (
                    <details className="mt-4">
                      <summary className="text-sm text-muted-foreground cursor-pointer hover:text-foreground">
                        View system defaults
                      </summary>
                      <div className="mt-2 p-3 bg-muted/30 rounded-lg text-xs font-mono max-h-48 overflow-y-auto">
                        {Object.entries(inferenceDefaults.keywordPatterns).map(([persona, pattern]) => (
                          <div key={persona} className="text-muted-foreground mb-1">
                            <span className="text-foreground">{persona}</span>: {pattern}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>

                {/* Default Persona */}
                <div className="bg-card border border-border rounded-xl p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Settings className="h-5 w-5 text-primary" />
                    <h2 className="text-lg font-semibold text-foreground">Default Persona</h2>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    Fallback persona when no labels or keywords match. System default is "backend_developer".
                  </p>
                  <input
                    type="text"
                    value={editDefaultPersona}
                    onChange={(e) => setEditDefaultPersona(e.target.value)}
                    placeholder="backend_developer"
                    className="w-full max-w-xs px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>

                {/* Save/Reset Actions */}
                <div className="flex items-center justify-between pt-4 border-t border-border">
                  <button
                    onClick={resetInferenceRules}
                    disabled={inferenceSaving}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                    Reset to Defaults
                  </button>
                  <button
                    onClick={saveInferenceRules}
                    disabled={inferenceSaving}
                    className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {inferenceSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Save Rules
                  </button>
                </div>

                {/* Test Inference */}
                <div className="bg-card border border-border rounded-xl p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Play className="h-5 w-5 text-primary" />
                    <h2 className="text-lg font-semibold text-foreground">Test Inference</h2>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    Enter sample ticket content to see which persona would be assigned.
                  </p>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1">Summary</label>
                      <input
                        type="text"
                        value={testSummary}
                        onChange={(e) => setTestSummary(e.target.value)}
                        placeholder="Add Stripe payment integration"
                        className="w-full px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1">Description</label>
                      <textarea
                        value={testDescription}
                        onChange={(e) => setTestDescription(e.target.value)}
                        placeholder="Implement payment processing using Stripe API..."
                        rows={2}
                        className="w-full px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1">Labels (comma-separated)</label>
                      <input
                        type="text"
                        value={testLabels}
                        onChange={(e) => setTestLabels(e.target.value)}
                        placeholder="backend, payments"
                        className="w-full px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>

                    <div className="flex items-center gap-4">
                      <button
                        onClick={testInference}
                        disabled={testLoading || (!testSummary && !testDescription && !testLabels)}
                        className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        {testLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                        Test
                      </button>

                      {testResult && (
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">Result:</span>
                          <span className={`px-3 py-1 rounded-full text-sm font-mono ${
                            testResult.startsWith("Error")
                              ? "bg-destructive/20 text-destructive"
                              : "bg-primary/20 text-primary"
                          }`}>
                            {testResult}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </main>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl w-full max-w-md mx-4 shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">Create Persona</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreatePersona} className="p-4 space-y-4">
              {createError && (
                <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-sm">
                  {createError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Slug <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    value={newPersona.slug}
                    onChange={(e) =>
                      setNewPersona((prev) => ({
                        ...prev,
                        slug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
                      }))
                    }
                    placeholder="my_persona"
                    required
                    className="w-full px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    value={newPersona.name}
                    onChange={(e) =>
                      setNewPersona((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder="My Persona"
                    required
                    className="w-full px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Emoji
                  </label>
                  <input
                    type="text"
                    value={newPersona.emoji}
                    onChange={(e) =>
                      setNewPersona((prev) => ({ ...prev, emoji: e.target.value }))
                    }
                    placeholder="🤖"
                    maxLength={4}
                    className="w-full px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Color
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={newPersona.color}
                      onChange={(e) =>
                        setNewPersona((prev) => ({ ...prev, color: e.target.value }))
                      }
                      className="h-9 w-9 rounded cursor-pointer border border-border"
                    />
                    <input
                      type="text"
                      value={newPersona.color}
                      onChange={(e) =>
                        setNewPersona((prev) => ({ ...prev, color: e.target.value }))
                      }
                      className="flex-1 px-2 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Short Label
                  </label>
                  <input
                    type="text"
                    value={newPersona.shortLabel}
                    onChange={(e) =>
                      setNewPersona((prev) => ({ ...prev, shortLabel: e.target.value }))
                    }
                    placeholder="Label"
                    maxLength={15}
                    className="w-full px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Description
                </label>
                <textarea
                  value={newPersona.description}
                  onChange={(e) =>
                    setNewPersona((prev) => ({ ...prev, description: e.target.value }))
                  }
                  placeholder="Describe what this persona specializes in..."
                  rows={3}
                  className="w-full px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                  Create Persona
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

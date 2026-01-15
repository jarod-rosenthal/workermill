import { useState, useEffect } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Settings,
  FileText,
  Code,
  History,
  Save,
  Plus,
  Trash2,
  RotateCcw,
  Loader2,
  AlertCircle,
  X,
  Clock,
  Edit,
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
  directives: DirectiveSummary[];
  scripts: ScriptSummary[];
}

interface DirectiveSummary {
  id: string;
  type: "readme" | "common";
  filename: string | null;
  version: number;
  changeSummary: string | null;
  createdAt: string;
  contentPreview: string;
}

interface ScriptSummary {
  id: string;
  category: string;
  name: string;
  version: number;
  changeSummary: string | null;
  createdAt: string;
}

interface DirectiveDetail {
  id: string;
  type: string;
  filename: string | null;
  content: string;
  version: number;
  changeSummary: string | null;
  createdAt: string;
}

interface ScriptDetail {
  id: string;
  category: string;
  name: string;
  content: string;
  version: number;
  changeSummary: string | null;
  createdAt: string;
}

interface HistoryEntry {
  id: string;
  version: number;
  isActive: boolean;
  changeSummary: string | null;
  createdAt: string;
  createdBy: { id: string; fullName: string } | null;
}

type Tab = "overview" | "directives" | "scripts" | "history";

export default function PersonaDetail() {
  const { id } = useParams<{ id: string }>();
  const tokens = useAuthStore((state) => state.tokens);
  const navigate = useNavigate();

  const [persona, setPersona] = useState<Persona | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  // Overview editing
  const [editingOverview, setEditingOverview] = useState(false);
  const [overviewForm, setOverviewForm] = useState({
    name: "",
    emoji: "",
    color: "",
    shortLabel: "",
    description: "",
    riskLevel: "medium" as "low" | "medium" | "high",
  });
  const [savingOverview, setSavingOverview] = useState(false);

  // Directive editing
  const [selectedDirective, setSelectedDirective] = useState<DirectiveDetail | null>(null);
  const [directiveContent, setDirectiveContent] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [savingDirective, setSavingDirective] = useState(false);
  const [directiveHistory, setDirectiveHistory] = useState<HistoryEntry[]>([]);
  const [showDirectiveHistory, setShowDirectiveHistory] = useState(false);
  const [loadingDirective, setLoadingDirective] = useState(false);

  // Script editing
  const [selectedScript, setSelectedScript] = useState<ScriptDetail | null>(null);
  const [scriptContent, setScriptContent] = useState("");
  const [scriptChangeSummary, setScriptChangeSummary] = useState("");
  const [savingScript, setSavingScript] = useState(false);
  const [loadingScript, setLoadingScript] = useState(false);

  // New directive/script modal
  const [showNewDirectiveModal, setShowNewDirectiveModal] = useState(false);
  const [newDirectiveType, setNewDirectiveType] = useState<"readme" | "common">("common");
  const [newDirectiveFilename, setNewDirectiveFilename] = useState("");
  const [newDirectiveContent, setNewDirectiveContent] = useState("");
  const [creatingDirective, setCreatingDirective] = useState(false);

  const [showNewScriptModal, setShowNewScriptModal] = useState(false);
  const [newScriptCategory, setNewScriptCategory] = useState("");
  const [newScriptName, setNewScriptName] = useState("");
  const [newScriptContent, setNewScriptContent] = useState("");
  const [creatingScript, setCreatingScript] = useState(false);

  useEffect(() => {
    if (id) fetchPersona();
  }, [id, tokens]);

  const fetchPersona = async () => {
    if (!tokens || !id) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/personas/${id}`, {
        headers: { Authorization: `Bearer ${tokens.idToken}` },
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("Persona not found");
        }
        throw new Error("Failed to fetch persona");
      }

      const data = await response.json();
      setPersona(data.persona);
      setOverviewForm({
        name: data.persona.name,
        emoji: data.persona.emoji || "",
        color: data.persona.color || "***REMOVED***3B82F6",
        shortLabel: data.persona.shortLabel || "",
        description: data.persona.description || "",
        riskLevel: data.persona.riskLevel,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load persona");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveOverview = async () => {
    if (!tokens || !id || !persona) return;

    setSavingOverview(true);
    try {
      const response = await fetch(`${API_BASE}/api/personas/${id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokens.idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(overviewForm),
      });

      if (!response.ok) {
        throw new Error("Failed to save changes");
      }

      const data = await response.json();
      setPersona((prev) => (prev ? { ...prev, ...data.persona } : null));
      setEditingOverview(false);
    } catch (err) {
      console.error("Error saving overview:", err);
    } finally {
      setSavingOverview(false);
    }
  };

  const handleDeletePersona = async () => {
    if (!tokens || !id || !persona || persona.isSystem) return;
    if (!confirm(`Delete persona "${persona.name}"? This cannot be undone.`)) return;

    try {
      const response = await fetch(`${API_BASE}/api/personas/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tokens.idToken}` },
      });

      if (!response.ok) {
        throw new Error("Failed to delete persona");
      }

      navigate("/personas");
    } catch (err) {
      console.error("Error deleting persona:", err);
    }
  };

  // Directive functions
  const handleSelectDirective = async (directive: DirectiveSummary) => {
    if (!tokens || !id) return;

    setLoadingDirective(true);
    try {
      const response = await fetch(
        `${API_BASE}/api/personas/${id}/directives/${directive.id}`,
        { headers: { Authorization: `Bearer ${tokens.idToken}` } }
      );

      if (!response.ok) throw new Error("Failed to load directive");

      const data = await response.json();
      setSelectedDirective(data.directive);
      setDirectiveContent(data.directive.content);
      setChangeSummary("");
    } catch (err) {
      console.error("Error loading directive:", err);
    } finally {
      setLoadingDirective(false);
    }
  };

  const handleSaveDirective = async () => {
    if (!tokens || !id || !selectedDirective) return;

    setSavingDirective(true);
    try {
      const response = await fetch(`${API_BASE}/api/personas/${id}/directives`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: selectedDirective.type,
          filename: selectedDirective.filename,
          content: directiveContent,
          changeSummary: changeSummary || undefined,
        }),
      });

      if (!response.ok) throw new Error("Failed to save directive");

      await fetchPersona();
      setChangeSummary("");

      // Refresh the selected directive
      const data = await response.json();
      setSelectedDirective({
        ...selectedDirective,
        content: directiveContent,
        version: data.directive.version,
      });
    } catch (err) {
      console.error("Error saving directive:", err);
    } finally {
      setSavingDirective(false);
    }
  };

  const handleFetchDirectiveHistory = async () => {
    if (!tokens || !id || !selectedDirective) return;

    try {
      const response = await fetch(
        `${API_BASE}/api/personas/${id}/directives/${selectedDirective.id}/history`,
        { headers: { Authorization: `Bearer ${tokens.idToken}` } }
      );

      if (!response.ok) throw new Error("Failed to load history");

      const data = await response.json();
      setDirectiveHistory(data.history);
      setShowDirectiveHistory(true);
    } catch (err) {
      console.error("Error loading history:", err);
    }
  };

  const handleRollbackDirective = async (historyId: string) => {
    if (!tokens || !id) return;

    try {
      const response = await fetch(
        `${API_BASE}/api/personas/${id}/directives/${historyId}/rollback`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${tokens.idToken}` },
        }
      );

      if (!response.ok) throw new Error("Failed to rollback");

      setShowDirectiveHistory(false);
      setSelectedDirective(null);
      await fetchPersona();
    } catch (err) {
      console.error("Error rolling back:", err);
    }
  };

  const handleCreateDirective = async () => {
    if (!tokens || !id) return;

    setCreatingDirective(true);
    try {
      const response = await fetch(`${API_BASE}/api/personas/${id}/directives`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: newDirectiveType,
          filename: newDirectiveType === "common" ? newDirectiveFilename : undefined,
          content: newDirectiveContent,
          changeSummary: "Initial version",
        }),
      });

      if (!response.ok) throw new Error("Failed to create directive");

      setShowNewDirectiveModal(false);
      setNewDirectiveFilename("");
      setNewDirectiveContent("");
      await fetchPersona();
    } catch (err) {
      console.error("Error creating directive:", err);
    } finally {
      setCreatingDirective(false);
    }
  };

  // Script functions (similar pattern)
  const handleSelectScript = async (script: ScriptSummary) => {
    if (!tokens || !id) return;

    setLoadingScript(true);
    try {
      const response = await fetch(
        `${API_BASE}/api/personas/${id}/scripts/${script.id}`,
        { headers: { Authorization: `Bearer ${tokens.idToken}` } }
      );

      if (!response.ok) throw new Error("Failed to load script");

      const data = await response.json();
      setSelectedScript(data.script);
      setScriptContent(data.script.content);
      setScriptChangeSummary("");
    } catch (err) {
      console.error("Error loading script:", err);
    } finally {
      setLoadingScript(false);
    }
  };

  const handleSaveScript = async () => {
    if (!tokens || !id || !selectedScript) return;

    setSavingScript(true);
    try {
      const response = await fetch(`${API_BASE}/api/personas/${id}/scripts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category: selectedScript.category,
          name: selectedScript.name,
          content: scriptContent,
          changeSummary: scriptChangeSummary || undefined,
        }),
      });

      if (!response.ok) throw new Error("Failed to save script");

      await fetchPersona();
      setScriptChangeSummary("");

      const data = await response.json();
      setSelectedScript({
        ...selectedScript,
        content: scriptContent,
        version: data.script.version,
      });
    } catch (err) {
      console.error("Error saving script:", err);
    } finally {
      setSavingScript(false);
    }
  };

  const handleCreateScript = async () => {
    if (!tokens || !id) return;

    setCreatingScript(true);
    try {
      const response = await fetch(`${API_BASE}/api/personas/${id}/scripts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category: newScriptCategory,
          name: newScriptName,
          content: newScriptContent,
          changeSummary: "Initial version",
        }),
      });

      if (!response.ok) throw new Error("Failed to create script");

      setShowNewScriptModal(false);
      setNewScriptCategory("");
      setNewScriptName("");
      setNewScriptContent("");
      await fetchPersona();
    } catch (err) {
      console.error("Error creating script:", err);
    } finally {
      setCreatingScript(false);
    }
  };

  const tabs = [
    { id: "overview" as Tab, label: "Overview", icon: Settings },
    { id: "directives" as Tab, label: "Directives", icon: FileText },
    { id: "scripts" as Tab, label: "Scripts", icon: Code },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !persona) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">
            {error || "Persona not found"}
          </h2>
          <Link
            to="/personas"
            className="text-primary hover:underline"
          >
            Back to Persona Studio
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Link
                to="/personas"
                className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="text-sm">All Personas</span>
              </Link>
              <div className="h-6 w-px bg-border" />
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: persona.color ? `${persona.color}20` : "***REMOVED***3B82F620" }}
                >
                  {persona.emoji || "🤖"}
                </div>
                <div>
                  <h1 className="text-lg font-semibold text-foreground">{persona.name}</h1>
                  <p className="text-xs text-muted-foreground font-mono">{persona.slug}</p>
                </div>
              </div>
            </div>

            {!persona.isSystem && (
              <button
                onClick={handleDeletePersona}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            )}
          </div>

          {/* Tabs */}
          <div className="flex gap-1 -mb-px">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Overview Tab */}
        {activeTab === "overview" && (
          <div className="max-w-2xl">
            <div className="bg-card border border-border rounded-xl p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-foreground">Persona Details</h2>
                {!persona.isSystem && !editingOverview && (
                  <button
                    onClick={() => setEditingOverview(true)}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm text-primary hover:bg-primary/10 rounded-lg transition-colors"
                  >
                    <Edit className="h-4 w-4" />
                    Edit
                  </button>
                )}
              </div>

              {editingOverview ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1">Name</label>
                      <input
                        type="text"
                        value={overviewForm.name}
                        onChange={(e) =>
                          setOverviewForm((prev) => ({ ...prev, name: e.target.value }))
                        }
                        className="w-full px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1">Short Label</label>
                      <input
                        type="text"
                        value={overviewForm.shortLabel}
                        onChange={(e) =>
                          setOverviewForm((prev) => ({ ...prev, shortLabel: e.target.value }))
                        }
                        className="w-full px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1">Emoji</label>
                      <input
                        type="text"
                        value={overviewForm.emoji}
                        onChange={(e) =>
                          setOverviewForm((prev) => ({ ...prev, emoji: e.target.value }))
                        }
                        maxLength={4}
                        className="w-full px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1">Color</label>
                      <div className="flex gap-2">
                        <input
                          type="color"
                          value={overviewForm.color}
                          onChange={(e) =>
                            setOverviewForm((prev) => ({ ...prev, color: e.target.value }))
                          }
                          className="h-9 w-9 rounded cursor-pointer border border-border"
                        />
                        <input
                          type="text"
                          value={overviewForm.color}
                          onChange={(e) =>
                            setOverviewForm((prev) => ({ ...prev, color: e.target.value }))
                          }
                          className="flex-1 px-2 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1">Risk Level</label>
                      <select
                        value={overviewForm.riskLevel}
                        onChange={(e) =>
                          setOverviewForm((prev) => ({
                            ...prev,
                            riskLevel: e.target.value as "low" | "medium" | "high",
                          }))
                        }
                        className="w-full px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Description</label>
                    <textarea
                      value={overviewForm.description}
                      onChange={(e) =>
                        setOverviewForm((prev) => ({ ...prev, description: e.target.value }))
                      }
                      rows={3}
                      className="w-full px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                    />
                  </div>

                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      onClick={() => setEditingOverview(false)}
                      className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveOverview}
                      disabled={savingOverview}
                      className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      {savingOverview && <Loader2 className="h-4 w-4 animate-spin" />}
                      Save Changes
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div
                      className="w-16 h-16 rounded-xl flex items-center justify-center text-3xl"
                      style={{ backgroundColor: persona.color ? `${persona.color}20` : "***REMOVED***3B82F620" }}
                    >
                      {persona.emoji || "🤖"}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Slug</p>
                      <p className="font-mono text-sm text-foreground">{persona.slug}</p>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Description</p>
                    <p className="text-sm text-foreground">{persona.description || "No description"}</p>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Risk Level</p>
                      <span
                        className={`inline-block px-2 py-0.5 text-xs rounded-full border ${
                          persona.riskLevel === "low"
                            ? "bg-green-500/20 text-green-400 border-green-500/30"
                            : persona.riskLevel === "medium"
                            ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                            : "bg-red-500/20 text-red-400 border-red-500/30"
                        }`}
                      >
                        {persona.riskLevel}
                      </span>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Priority</p>
                      <p className="text-sm text-foreground">{persona.priority}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Status</p>
                      <span
                        className={`inline-block px-2 py-0.5 text-xs rounded-full border ${
                          persona.enabled
                            ? "bg-green-500/20 text-green-400 border-green-500/30"
                            : "bg-gray-500/20 text-gray-400 border-gray-500/30"
                        }`}
                      >
                        {persona.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                  </div>

                  {persona.skills && persona.skills.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">Skills</p>
                      <div className="flex flex-wrap gap-2">
                        {persona.skills.map((skill) => (
                          <span
                            key={skill}
                            className="px-2 py-1 text-xs bg-muted rounded-full text-muted-foreground"
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Directives Tab */}
        {activeTab === "directives" && (
          <div className="grid grid-cols-3 gap-6">
            {/* Directive List */}
            <div className="col-span-1 bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-medium text-foreground">Directives</h3>
                <button
                  onClick={() => setShowNewDirectiveModal(true)}
                  className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-2">
                {persona.directives.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => handleSelectDirective(d)}
                    className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                      selectedDirective?.id === d.id
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-muted text-foreground"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0" />
                      <span className="text-sm font-medium truncate">
                        {d.type === "readme" ? "README.md" : d.filename}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">v{d.version}</p>
                  </button>
                ))}

                {persona.directives.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No directives yet
                  </p>
                )}
              </div>
            </div>

            {/* Directive Editor */}
            <div className="col-span-2 bg-card border border-border rounded-xl p-4">
              {loadingDirective ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : selectedDirective ? (
                <div className="h-full flex flex-col">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="font-medium text-foreground">
                        {selectedDirective.type === "readme"
                          ? "README.md"
                          : selectedDirective.filename}
                      </h3>
                      <p className="text-xs text-muted-foreground">Version {selectedDirective.version}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleFetchDirectiveHistory}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
                      >
                        <History className="h-4 w-4" />
                        History
                      </button>
                      <button
                        onClick={handleSaveDirective}
                        disabled={savingDirective || directiveContent === selectedDirective.content}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        {savingDirective && <Loader2 className="h-4 w-4 animate-spin" />}
                        <Save className="h-4 w-4" />
                        Save
                      </button>
                    </div>
                  </div>

                  <textarea
                    value={directiveContent}
                    onChange={(e) => setDirectiveContent(e.target.value)}
                    className="flex-1 min-h-[400px] px-4 py-3 bg-muted/30 border border-border rounded-lg text-foreground text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                    placeholder="Enter directive content (Markdown)..."
                  />

                  <div className="mt-3">
                    <input
                      type="text"
                      value={changeSummary}
                      onChange={(e) => setChangeSummary(e.target.value)}
                      placeholder="Change summary (optional)"
                      className="w-full px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <p>Select a directive to edit</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Scripts Tab */}
        {activeTab === "scripts" && (
          <div className="grid grid-cols-3 gap-6">
            {/* Script List */}
            <div className="col-span-1 bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-medium text-foreground">Scripts</h3>
                <button
                  onClick={() => setShowNewScriptModal(true)}
                  className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-2">
                {persona.scripts.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => handleSelectScript(s)}
                    className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                      selectedScript?.id === s.id
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-muted text-foreground"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Code className="h-4 w-4 shrink-0" />
                      <span className="text-sm font-medium truncate">{s.name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {s.category} &bull; v{s.version}
                    </p>
                  </button>
                ))}

                {persona.scripts.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No scripts yet
                  </p>
                )}
              </div>
            </div>

            {/* Script Editor */}
            <div className="col-span-2 bg-card border border-border rounded-xl p-4">
              {loadingScript ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : selectedScript ? (
                <div className="h-full flex flex-col">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="font-medium text-foreground">{selectedScript.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        {selectedScript.category} &bull; Version {selectedScript.version}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleSaveScript}
                        disabled={savingScript || scriptContent === selectedScript.content}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        {savingScript && <Loader2 className="h-4 w-4 animate-spin" />}
                        <Save className="h-4 w-4" />
                        Save
                      </button>
                    </div>
                  </div>

                  <textarea
                    value={scriptContent}
                    onChange={(e) => setScriptContent(e.target.value)}
                    className="flex-1 min-h-[400px] px-4 py-3 bg-muted/30 border border-border rounded-lg text-foreground text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                    placeholder="Enter script content (TypeScript)..."
                  />

                  <div className="mt-3">
                    <input
                      type="text"
                      value={scriptChangeSummary}
                      onChange={(e) => setScriptChangeSummary(e.target.value)}
                      placeholder="Change summary (optional)"
                      className="w-full px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <p>Select a script to edit</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* History Modal */}
      {showDirectiveHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl w-full max-w-md mx-4 shadow-xl max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">Version History</h2>
              <button
                onClick={() => setShowDirectiveHistory(false)}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="overflow-y-auto p-4 space-y-3">
              {directiveHistory.map((entry) => (
                <div
                  key={entry.id}
                  className={`p-3 rounded-lg border ${
                    entry.isActive ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-foreground">Version {entry.version}</span>
                    {entry.isActive && (
                      <span className="px-2 py-0.5 text-xs bg-primary/20 text-primary rounded-full">
                        Current
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    {entry.changeSummary || "No change summary"}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(entry.createdAt).toLocaleString()}
                    </span>
                    {!entry.isActive && (
                      <button
                        onClick={() => handleRollbackDirective(entry.id)}
                        className="flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Rollback
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* New Directive Modal */}
      {showNewDirectiveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl w-full max-w-lg mx-4 shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">New Directive</h2>
              <button
                onClick={() => setShowNewDirectiveModal(false)}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Type</label>
                <select
                  value={newDirectiveType}
                  onChange={(e) => setNewDirectiveType(e.target.value as "readme" | "common")}
                  className="w-full px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="readme">README</option>
                  <option value="common">Common</option>
                </select>
              </div>

              {newDirectiveType === "common" && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Filename</label>
                  <input
                    type="text"
                    value={newDirectiveFilename}
                    onChange={(e) => setNewDirectiveFilename(e.target.value)}
                    placeholder="example.md"
                    className="w-full px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Content</label>
                <textarea
                  value={newDirectiveContent}
                  onChange={(e) => setNewDirectiveContent(e.target.value)}
                  placeholder="***REMOVED*** Directive Title\n\nContent..."
                  rows={10}
                  className="w-full px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setShowNewDirectiveModal(false)}
                  className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateDirective}
                  disabled={creatingDirective || !newDirectiveContent}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {creatingDirective && <Loader2 className="h-4 w-4 animate-spin" />}
                  Create Directive
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Script Modal */}
      {showNewScriptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl w-full max-w-lg mx-4 shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">New Script</h2>
              <button
                onClick={() => setShowNewScriptModal(false)}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Category</label>
                  <input
                    type="text"
                    value={newScriptCategory}
                    onChange={(e) => setNewScriptCategory(e.target.value)}
                    placeholder="git"
                    className="w-full px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Name</label>
                  <input
                    type="text"
                    value={newScriptName}
                    onChange={(e) => setNewScriptName(e.target.value)}
                    placeholder="create_pr"
                    className="w-full px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Content</label>
                <textarea
                  value={newScriptContent}
                  onChange={(e) => setNewScriptContent(e.target.value)}
                  placeholder="// Script code..."
                  rows={10}
                  className="w-full px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setShowNewScriptModal(false)}
                  className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateScript}
                  disabled={creatingScript || !newScriptCategory || !newScriptName || !newScriptContent}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {creatingScript && <Loader2 className="h-4 w-4 animate-spin" />}
                  Create Script
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

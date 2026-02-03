import { useState, useEffect, useCallback } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Save,
  Loader2,
  Trash2,
  Archive,
  FolderKanban,
  GitBranch,
  Cpu,
  Settings,
  AlertTriangle,
} from "lucide-react";
import { useProjectsStore } from "../store/projects-store";

const API_BASE = import.meta.env.VITE_API_URL || "";

// Persona options
const PERSONA_OPTIONS = [
  { value: "backend_developer", label: "Backend Developer" },
  { value: "frontend_developer", label: "Frontend Developer" },
  { value: "devops_engineer", label: "DevOps Engineer" },
  { value: "security_engineer", label: "Security Engineer" },
  { value: "qa_engineer", label: "QA Engineer" },
  { value: "tech_writer", label: "Tech Writer" },
];

// Model options
const MODEL_OPTIONS = [
  { value: "claude-opus-4-5-20251101", label: "Claude Opus 4.5" },
  { value: "claude-sonnet-5-20260203", label: "Claude Sonnet 5" },
  { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
];

// Provider options
const PROVIDER_OPTIONS = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI" },
  { value: "google", label: "Google" },
  { value: "ollama", label: "Ollama" },
];

interface ProjectSettings {
  name: string;
  description: string;
  githubRepo: string;
  defaultPersona: string;
  defaultModel: string;
  defaultProvider: string;
  isArchived: boolean;
}

export default function ProjectSettings() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getProjectById, fetchProjects, updateProject, deleteProject } = useProjectsStore();
  const project = id ? getProjectById(id) : undefined;

  const [settings, setSettings] = useState<ProjectSettings>({
    name: "",
    description: "",
    githubRepo: "",
    defaultPersona: "backend_developer",
    defaultModel: "claude-haiku-4-5-20251001",
    defaultProvider: "anthropic",
    isArchived: false,
  });
  const [originalSettings, setOriginalSettings] = useState<ProjectSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const hasUnsavedChanges = originalSettings && JSON.stringify(settings) !== JSON.stringify(originalSettings);

  // Fetch project data
  const fetchProjectData = useCallback(async () => {
    if (!id) return;

    setIsLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/projects/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        if (response.status === 404) {
          navigate("/projects");
          return;
        }
        throw new Error("Failed to fetch project");
      }

      const data = await response.json();
      const projectSettings: ProjectSettings = {
        name: data.project.name || "",
        description: data.project.description || "",
        githubRepo: data.project.githubRepo || "",
        defaultPersona: data.project.defaultPersona || "backend_developer",
        defaultModel: data.project.defaultModel || "claude-haiku-4-5-20251001",
        defaultProvider: data.project.defaultProvider || "anthropic",
        isArchived: data.project.isArchived || false,
      };
      setSettings(projectSettings);
      setOriginalSettings(projectSettings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load project");
    } finally {
      setIsLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    if (!project) {
      fetchProjects();
    }
    fetchProjectData();
  }, [project, fetchProjects, fetchProjectData]);

  const handleSave = async () => {
    if (!id) return;

    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      await updateProject(id, {
        name: settings.name,
        description: settings.description || null,
        githubRepo: settings.githubRepo || null,
        defaultPersona: settings.defaultPersona,
        defaultModel: settings.defaultModel,
        defaultProvider: settings.defaultProvider,
      });
      setOriginalSettings(settings);
      setSuccessMessage("Settings saved successfully");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!id) return;

    try {
      await updateProject(id, { isArchived: !settings.isArchived });
      setSettings({ ...settings, isArchived: !settings.isArchived });
      setOriginalSettings({ ...settings, isArchived: !settings.isArchived });
      setSuccessMessage(settings.isArchived ? "Project restored" : "Project archived");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to archive project");
    }
  };

  const handleDelete = async () => {
    if (!id) return;

    setIsDeleting(true);
    try {
      await deleteProject(id);
      navigate("/projects");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete project");
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleDiscard = () => {
    if (originalSettings) {
      setSettings(originalSettings);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Background effects */}
      <div className="fixed inset-0 bg-grid-pattern pointer-events-none opacity-50" />
      <div className="fixed inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5 pointer-events-none" />

      {/* Header */}
      <header className="border-b border-border/30 glass-strong sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to={`/projects/${id}`}
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Board
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <FolderKanban className="w-5 h-5 text-primary" />
            <span className="font-mono text-sm text-muted-foreground">{project?.key}</span>
            <Settings className="w-4 h-4 text-muted-foreground" />
          </div>
        </div>
      </header>

      <main className="relative max-w-4xl mx-auto px-6 py-8 pb-24">
        <h1 className="text-2xl font-semibold mb-6">Project Settings</h1>

        {/* Messages */}
        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500">
            {error}
          </div>
        )}
        {successMessage && (
          <div className="mb-6 p-4 rounded-lg bg-green-500/10 border border-green-500/30 text-green-500">
            {successMessage}
          </div>
        )}

        {/* General Settings */}
        <section className="mb-8">
          <div className="border border-border/50 rounded-xl p-6 bg-card">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <FolderKanban className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="font-semibold text-foreground">General</h2>
                <p className="text-sm text-muted-foreground">Basic project information</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Project Name</label>
                <input
                  type="text"
                  value={settings.name}
                  onChange={(e) => setSettings({ ...settings, name: e.target.value })}
                  placeholder="My Project"
                  className="w-full px-4 py-3 rounded-xl bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Description</label>
                <textarea
                  value={settings.description}
                  onChange={(e) => setSettings({ ...settings, description: e.target.value })}
                  placeholder="Brief description of the project..."
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Repository Settings */}
        <section className="mb-8">
          <div className="border border-border/50 rounded-xl p-6 bg-card">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
                <GitBranch className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <h2 className="font-semibold text-foreground">Repository</h2>
                <p className="text-sm text-muted-foreground">Default GitHub repository for tasks</p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">GitHub Repository</label>
              <input
                type="text"
                value={settings.githubRepo}
                onChange={(e) => setSettings({ ...settings, githubRepo: e.target.value })}
                placeholder="owner/repo"
                className="w-full px-4 py-3 rounded-xl bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <p className="text-xs text-muted-foreground mt-2">
                Tasks without a specific repo will use this default
              </p>
            </div>
          </div>
        </section>

        {/* Worker Defaults */}
        <section className="mb-8">
          <div className="border border-border/50 rounded-xl p-6 bg-card">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <Cpu className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <h2 className="font-semibold text-foreground">Worker Defaults</h2>
                <p className="text-sm text-muted-foreground">Default settings for new tasks</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Default Persona</label>
                <select
                  value={settings.defaultPersona}
                  onChange={(e) => setSettings({ ...settings, defaultPersona: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  {PERSONA_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Default Model</label>
                  <select
                    value={settings.defaultModel}
                    onChange={(e) => setSettings({ ...settings, defaultModel: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    {MODEL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Default Provider</label>
                  <select
                    value={settings.defaultProvider}
                    onChange={(e) => setSettings({ ...settings, defaultProvider: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    {PROVIDER_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Danger Zone */}
        <section>
          <div className="border border-red-500/30 rounded-xl p-6 bg-red-500/5">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h2 className="font-semibold text-red-500">Danger Zone</h2>
                <p className="text-sm text-muted-foreground">Irreversible actions</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg bg-background border border-border">
                <div>
                  <p className="font-medium">{settings.isArchived ? "Restore Project" : "Archive Project"}</p>
                  <p className="text-sm text-muted-foreground">
                    {settings.isArchived
                      ? "Make this project active again"
                      : "Hide from active projects list"}
                  </p>
                </div>
                <button
                  onClick={handleArchive}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors"
                >
                  <Archive className="w-4 h-4" />
                  {settings.isArchived ? "Restore" : "Archive"}
                </button>
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-background border border-red-500/30">
                <div>
                  <p className="font-medium text-red-500">Delete Project</p>
                  <p className="text-sm text-muted-foreground">
                    Permanently delete this project and all its tasks
                  </p>
                </div>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Sticky Save Bar */}
      {hasUnsavedChanges && (
        <div className="fixed bottom-0 left-0 right-0 border-t border-border/50 bg-card/95 backdrop-blur-sm z-30 shadow-lg">
          <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-yellow-500">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-sm font-medium">You have unsaved changes</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleDiscard}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted transition-colors"
              >
                Discard
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-primary to-cyan-400 text-primary-foreground font-semibold rounded-lg hover:shadow-lg hover:shadow-primary/25 transition-all disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-xl border border-border w-full max-w-md p-6 mx-4">
            <h2 className="text-xl font-semibold mb-2">Delete Project</h2>
            <p className="text-muted-foreground mb-6">
              Are you sure you want to delete <strong>{settings.name}</strong>? This action cannot be
              undone and all tasks will be permanently removed.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                className="px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {isDeleting && <Loader2 className="w-4 h-4 animate-spin" />}
                Delete Project
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

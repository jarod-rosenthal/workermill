import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Plus,
  Zap,
  Settings,
  Trash2,
  Archive,
  MoreVertical,
  GitBranch,
  RefreshCw,
  ArrowLeft,
  Play,
  Loader2,
  Square,
} from "lucide-react";
import { useProjectsStore, type CreateProjectData } from "../store/projects-store";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface EpicStats {
  totalStories: number;
  readyCount: number;
  inProgressCount: number;
  completedCount: number;
  executionStatus: "idle" | "running" | "completed" | "failed";
}

export default function Epics() {
  const navigate = useNavigate();
  const {
    projects,
    isLoading,
    error,
    fetchProjects,
    createProject,
    deleteProject,
    updateProject,
  } = useProjectsStore();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [formData, setFormData] = useState<CreateProjectData>({
    key: "",
    name: "",
    description: "",
    githubRepo: "",
  });
  const [formError, setFormError] = useState<string | null>(null);

  // Epic execution state
  const [epicStats, setEpicStats] = useState<Record<string, EpicStats>>({});
  const [runningEpicId, setRunningEpicId] = useState<string | null>(null);
  const [cancellingEpicId, setCancellingEpicId] = useState<string | null>(null);

  // Fetch epic stats for all projects
  const fetchEpicStats = useCallback(async () => {
    const token = localStorage.getItem("accessToken");
    const stats: Record<string, EpicStats> = {};

    await Promise.all(
      projects.map(async (project) => {
        try {
          const response = await fetch(`${API_BASE}/api/projects/${project.id}/status`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (response.ok) {
            const data = await response.json();
            stats[project.id] = {
              totalStories: data.totalTasks || 0,
              readyCount: data.readyCount || 0,
              inProgressCount: data.inProgressCount || 0,
              completedCount: data.completedCount || 0,
              executionStatus: data.executionStatus || "idle",
            };
          }
        } catch {
          // Ignore errors for individual epic stats
        }
      })
    );

    setEpicStats(stats);
  }, [projects]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    if (projects.length > 0) {
      fetchEpicStats();
    }
  }, [projects, fetchEpicStats]);

  const handleRunEpic = async (epicId: string) => {
    setRunningEpicId(epicId);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/projects/${epicId}/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to run epic");
      }

      // Refresh stats
      await fetchEpicStats();
    } catch (err) {
      console.error("Failed to run epic:", err);
      alert(err instanceof Error ? err.message : "Failed to run epic");
    } finally {
      setRunningEpicId(null);
    }
  };

  const handleCancelEpic = async (epicId: string) => {
    setCancellingEpicId(epicId);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/projects/${epicId}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error("Failed to cancel epic");
      }

      // Refresh stats
      await fetchEpicStats();
    } catch (err) {
      console.error("Failed to cancel epic:", err);
    } finally {
      setCancellingEpicId(null);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formData.key || !formData.name) {
      setFormError("Epic key and name are required");
      return;
    }

    // Validate key format (uppercase letters and numbers only, max 10 chars)
    const keyRegex = /^[A-Z0-9]{1,10}$/;
    if (!keyRegex.test(formData.key)) {
      setFormError("Epic key must be 1-10 uppercase letters/numbers only");
      return;
    }

    try {
      const newProject = await createProject(formData);
      setShowCreateModal(false);
      setFormData({ key: "", name: "", description: "", githubRepo: "" });
      navigate(`/epics/${newProject.id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create project");
    }
  };

  const handleDeleteProject = async (id: string) => {
    try {
      await deleteProject(id);
      setShowDeleteConfirm(null);
    } catch (err) {
      console.error("Failed to delete project:", err);
    }
  };

  const handleArchiveProject = async (id: string) => {
    try {
      const project = projects.find((p) => p.id === id);
      if (project) {
        await updateProject(id, { isArchived: !project.isArchived });
      }
      setOpenMenuId(null);
    } catch (err) {
      console.error("Failed to archive project:", err);
    }
  };

  const activeProjects = projects.filter((p) => !p.isArchived);
  const archivedProjects = projects.filter((p) => p.isArchived);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/30 glass-strong sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/dashboard"
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="text-sm">Back to Dashboard</span>
            </Link>
            <div className="h-6 w-px bg-border" />
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Epics
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => fetchProjects()}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-5 h-5 text-muted-foreground ${isLoading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Epic
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500">
            {error}
          </div>
        )}

        {isLoading && projects.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-20">
            <Zap className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">No epics yet</h2>
            <p className="text-muted-foreground mb-6">
              Create your first epic to start organizing stories
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create Epic
            </button>
          </div>
        ) : (
          <>
            {/* Active Epics */}
            <section className="mb-12">
              <h2 className="text-lg font-semibold mb-4">Active Epics ({activeProjects.length})</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {activeProjects.map((project) => {
                  const stats = epicStats[project.id];
                  const isRunning = stats?.executionStatus === "running";
                  const readyCount = stats?.readyCount || 0;
                  const totalStories = stats?.totalStories || project.taskSequence || 0;
                  const completedCount = stats?.completedCount || 0;
                  const inProgressCount = stats?.inProgressCount || 0;

                  return (
                    <div
                      key={project.id}
                      className={`relative group rounded-xl border bg-card transition-all ${
                        isRunning ? "border-blue-500/50 shadow-lg shadow-blue-500/10" : "border-border hover:border-primary/50"
                      }`}
                    >
                      <div className="p-6">
                        {/* Header */}
                        <div className="flex items-start justify-between mb-4">
                          <Link to={`/epics/${project.id}`} className="flex items-center gap-4 flex-1">
                            <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${
                              isRunning ? "bg-blue-500/20" : "bg-primary/10"
                            }`}>
                              {isRunning ? (
                                <Loader2 className="w-7 h-7 text-blue-500 animate-spin" />
                              ) : (
                                <Zap className="w-7 h-7 text-primary" />
                              )}
                            </div>
                            <div>
                              <span className="text-xs font-mono text-muted-foreground">{project.key}</span>
                              <h3 className="text-lg font-semibold">{project.name}</h3>
                              {project.githubRepo && (
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                  <GitBranch className="w-3 h-3" />
                                  {project.githubRepo}
                                </span>
                              )}
                            </div>
                          </Link>
                          {/* Actions Menu */}
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              setOpenMenuId(openMenuId === project.id ? null : project.id);
                            }}
                            className="p-2 rounded-lg hover:bg-muted transition-colors"
                          >
                            <MoreVertical className="w-5 h-5 text-muted-foreground" />
                          </button>
                          {openMenuId === project.id && (
                            <div className="absolute right-4 top-16 w-40 rounded-lg border border-border bg-card shadow-lg py-1 z-50">
                              <Link
                                to={`/epics/${project.id}/settings`}
                                className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors"
                                onClick={() => setOpenMenuId(null)}
                              >
                                <Settings className="w-4 h-4" />
                                Settings
                              </Link>
                              <button
                                onClick={() => handleArchiveProject(project.id)}
                                className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors w-full text-left"
                              >
                                <Archive className="w-4 h-4" />
                                Archive
                              </button>
                              <button
                                onClick={() => {
                                  setShowDeleteConfirm(project.id);
                                  setOpenMenuId(null);
                                }}
                                className="flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-500/10 transition-colors w-full text-left"
                              >
                                <Trash2 className="w-4 h-4" />
                                Delete
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Description */}
                        {project.description && (
                          <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                            {project.description}
                          </p>
                        )}

                        {/* Story Stats */}
                        <div className="grid grid-cols-4 gap-3 mb-5">
                          <div className="text-center p-3 rounded-lg bg-muted/50">
                            <div className="text-2xl font-bold">{totalStories}</div>
                            <div className="text-xs text-muted-foreground">Total</div>
                          </div>
                          <div className="text-center p-3 rounded-lg bg-green-500/10">
                            <div className="text-2xl font-bold text-green-500">{readyCount}</div>
                            <div className="text-xs text-muted-foreground">Ready</div>
                          </div>
                          <div className="text-center p-3 rounded-lg bg-blue-500/10">
                            <div className="text-2xl font-bold text-blue-500">{inProgressCount}</div>
                            <div className="text-xs text-muted-foreground">In Progress</div>
                          </div>
                          <div className="text-center p-3 rounded-lg bg-purple-500/10">
                            <div className="text-2xl font-bold text-purple-500">{completedCount}</div>
                            <div className="text-xs text-muted-foreground">Done</div>
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-3">
                          {isRunning ? (
                            <button
                              onClick={() => handleCancelEpic(project.id)}
                              disabled={cancellingEpicId === project.id}
                              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors font-medium disabled:opacity-50"
                            >
                              {cancellingEpicId === project.id ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                              ) : (
                                <Square className="w-5 h-5" />
                              )}
                              Cancel Epic
                            </button>
                          ) : (
                            <button
                              onClick={() => handleRunEpic(project.id)}
                              disabled={runningEpicId === project.id || readyCount === 0}
                              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium disabled:opacity-50"
                              title={readyCount === 0 ? "No ready stories to execute" : `Run ${readyCount} ready stories`}
                            >
                              {runningEpicId === project.id ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                              ) : (
                                <Play className="w-5 h-5" />
                              )}
                              Run Epic ({readyCount} ready)
                            </button>
                          )}
                          <Link
                            to={`/epics/${project.id}`}
                            className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-border hover:bg-muted transition-colors font-medium"
                          >
                            View Board
                          </Link>
                        </div>

                        {/* Status indicator */}
                        {isRunning && (
                          <div className="mt-4 flex items-center gap-2 text-sm text-blue-500">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Epic is running...
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Archived Epics */}
            {archivedProjects.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold mb-4 text-muted-foreground">
                  Archived ({archivedProjects.length})
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 opacity-60">
                  {archivedProjects.map((project) => (
                    <div
                      key={project.id}
                      className="relative group rounded-xl border border-border bg-card/50"
                    >
                      <Link to={`/epics/${project.id}`} className="block p-5">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                            <Archive className="w-5 h-5 text-muted-foreground" />
                          </div>
                          <div>
                            <span className="text-xs font-mono text-muted-foreground">{project.key}</span>
                            <h3 className="font-semibold">{project.name}</h3>
                          </div>
                        </div>
                      </Link>
                      <div className="absolute top-4 right-4">
                        <button
                          onClick={() => handleArchiveProject(project.id)}
                          className="p-1.5 rounded-lg hover:bg-muted transition-colors text-xs"
                          title="Unarchive"
                        >
                          Restore
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      {/* Create Epic Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-xl border border-border w-full max-w-md p-6 mx-4">
            <h2 className="text-xl font-semibold mb-4">Create New Epic</h2>
            <form onSubmit={handleCreateProject}>
              {formError && (
                <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-sm">
                  {formError}
                </div>
              )}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Epic Key</label>
                  <input
                    type="text"
                    value={formData.key}
                    onChange={(e) => setFormData({ ...formData, key: e.target.value.toUpperCase() })}
                    placeholder="e.g., AUTH, FEAT"
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono uppercase"
                    maxLength={10}
                    required
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    1-10 uppercase letters/numbers. Used for story IDs (e.g., AUTH-1)
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Epic Name</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="User Authentication"
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Description (optional)</label>
                  <textarea
                    value={formData.description || ""}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Brief description of the project..."
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">GitHub Repository (optional)</label>
                  <input
                    type="text"
                    value={formData.githubRepo || ""}
                    onChange={(e) => setFormData({ ...formData, githubRepo: e.target.value })}
                    placeholder="owner/repo"
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setFormData({ key: "", name: "", description: "", githubRepo: "" });
                    setFormError(null);
                  }}
                  className="px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {isLoading ? "Creating..." : "Create Epic"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-xl border border-border w-full max-w-md p-6 mx-4">
            <h2 className="text-xl font-semibold mb-2">Delete Epic</h2>
            <p className="text-muted-foreground mb-6">
              Are you sure you want to delete this epic? This action cannot be undone and all stories will be permanently removed.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteProject(showDeleteConfirm)}
                className="px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                Delete Epic
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Click outside to close menu */}
      {openMenuId && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setOpenMenuId(null)}
        />
      )}
    </div>
  );
}

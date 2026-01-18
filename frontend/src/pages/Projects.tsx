import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Plus,
  FolderKanban,
  Settings,
  Trash2,
  Archive,
  MoreVertical,
  GitBranch,
  RefreshCw,
} from "lucide-react";
import { useProjectsStore, type CreateProjectData } from "../store/projects-store";

export default function Projects() {
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

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formData.key || !formData.name) {
      setFormError("Project key and name are required");
      return;
    }

    // Validate key format (uppercase letters and numbers only, max 10 chars)
    const keyRegex = /^[A-Z0-9]{1,10}$/;
    if (!keyRegex.test(formData.key)) {
      setFormError("Project key must be 1-10 uppercase letters/numbers only");
      return;
    }

    try {
      const newProject = await createProject(formData);
      setShowCreateModal(false);
      setFormData({ key: "", name: "", description: "", githubRepo: "" });
      navigate(`/projects/${newProject.id}`);
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
            <Link to="/dashboard" className="text-xl font-bold text-gradient-animated">
              WorkerMill
            </Link>
            <span className="text-muted-foreground">/</span>
            <h1 className="text-xl font-semibold">Projects</h1>
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
              New Project
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
            <FolderKanban className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">No projects yet</h2>
            <p className="text-muted-foreground mb-6">
              Create your first project to start organizing tasks
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create Project
            </button>
          </div>
        ) : (
          <>
            {/* Active Projects */}
            <section className="mb-12">
              <h2 className="text-lg font-semibold mb-4">Active Projects ({activeProjects.length})</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {activeProjects.map((project) => (
                  <div
                    key={project.id}
                    className="relative group rounded-xl border border-border bg-card hover:border-primary/50 transition-all"
                  >
                    <Link to={`/projects/${project.id}`} className="block p-5">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <FolderKanban className="w-5 h-5 text-primary" />
                          </div>
                          <div>
                            <span className="text-xs font-mono text-muted-foreground">{project.key}</span>
                            <h3 className="font-semibold">{project.name}</h3>
                          </div>
                        </div>
                      </div>
                      {project.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                          {project.description}
                        </p>
                      )}
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        {project.githubRepo && (
                          <span className="flex items-center gap-1">
                            <GitBranch className="w-3 h-3" />
                            {project.githubRepo}
                          </span>
                        )}
                        <span>{project.taskSequence} tasks</span>
                      </div>
                    </Link>

                    {/* Actions Menu */}
                    <div className="absolute top-4 right-4">
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          setOpenMenuId(openMenuId === project.id ? null : project.id);
                        }}
                        className="p-1.5 rounded-lg hover:bg-muted opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <MoreVertical className="w-4 h-4 text-muted-foreground" />
                      </button>
                      {openMenuId === project.id && (
                        <div className="absolute right-0 mt-1 w-40 rounded-lg border border-border bg-card shadow-lg py-1 z-50">
                          <Link
                            to={`/projects/${project.id}/settings`}
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
                  </div>
                ))}
              </div>
            </section>

            {/* Archived Projects */}
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
                      <Link to={`/projects/${project.id}`} className="block p-5">
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

      {/* Create Project Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-xl border border-border w-full max-w-md p-6 mx-4">
            <h2 className="text-xl font-semibold mb-4">Create New Project</h2>
            <form onSubmit={handleCreateProject}>
              {formError && (
                <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-sm">
                  {formError}
                </div>
              )}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Project Key</label>
                  <input
                    type="text"
                    value={formData.key}
                    onChange={(e) => setFormData({ ...formData, key: e.target.value.toUpperCase() })}
                    placeholder="e.g., PROJ, DEMO"
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono uppercase"
                    maxLength={10}
                    required
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    1-10 uppercase letters/numbers. Used for task IDs (e.g., PROJ-1)
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Project Name</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="My Awesome Project"
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
                  {isLoading ? "Creating..." : "Create Project"}
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
            <h2 className="text-xl font-semibold mb-2">Delete Project</h2>
            <p className="text-muted-foreground mb-6">
              Are you sure you want to delete this project? This action cannot be undone and all tasks will be permanently removed.
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
                Delete Project
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

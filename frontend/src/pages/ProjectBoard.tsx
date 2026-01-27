import { useState, useEffect } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  Plus,
  ArrowLeft,
  Settings,
  RefreshCw,
  Trash2,
  Play,
  Loader2,
  ExternalLink,
  X,
  Check,
  Clock,
  User,
  GitBranch,
  FileText,
  CheckCircle2,
  Save,
} from "lucide-react";
import { useProjectsStore } from "../store/projects-store";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface BoardColumn {
  id: string;
  name: string;
  columnType: string;
  position: number;
  color: string;
  wipLimit: number | null;
}

// Acceptance criteria in Gherkin format
interface AcceptanceCriterion {
  given: string;
  when: string;
  then: string;
}

// Definition of done checklist item
interface DefinitionOfDoneItem {
  text: string;
  checked: boolean;
}

// Worker task status for display on task cards
interface WorkerTaskStatus {
  id: string;
  status: string;
  githubPrUrl: string | null;
}

// Internal task status type
type InternalTaskStatus = "draft" | "ready" | "queued" | "executing" | "review" | "completed" | "failed";

interface InternalTask {
  id: string;
  taskKey: string;
  title: string;
  description: string | null;
  columnId: string;
  columnPosition: number;
  // System-controlled status
  status: InternalTaskStatus;
  storyIndex: number | null;
  // User Story fields
  userStoryRole: string | null;
  userStoryWant: string | null;
  userStoryBenefit: string | null;
  // Rich content
  acceptanceCriteria: AcceptanceCriterion[];
  definitionOfDone: DefinitionOfDoneItem[];
  technicalNotes: string | null;
  // Worker config
  persona: string | null;
  model: string | null;
  provider: string | null;
  githubRepo: string | null;
  labels: string[] | null;
  // Worker integration
  workerTaskId: string | null;
  workerTask: WorkerTaskStatus | null;
  assignedAt: string | null;
  // Metadata
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CreateTaskData {
  title: string;
  description?: string;
  persona?: string;
  model?: string;
  provider?: string;
  githubRepo?: string;
  userStoryRole?: string;
  userStoryWant?: string;
  userStoryBenefit?: string;
  acceptanceCriteria?: AcceptanceCriterion[];
  definitionOfDone?: DefinitionOfDoneItem[];
  technicalNotes?: string;
  labels?: string[];
  dueDate?: string;
}

export default function ProjectBoard() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getProjectById, fetchProjects } = useProjectsStore();
  const project = id ? getProjectById(id) : undefined;

  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [tasks, setTasks] = useState<InternalTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Epic execution state (read-only, for display)
  const [executionStatus, setExecutionStatus] = useState<"idle" | "running" | "completed" | "failed">("idle");

  // Create task modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createInColumnId, setCreateInColumnId] = useState<string | null>(null);
  const [taskFormData, setTaskFormData] = useState<CreateTaskData>({ title: "" });
  const [taskFormError, setTaskFormError] = useState<string | null>(null);

  // Assign to worker state
  const [assigningTaskKey, setAssigningTaskKey] = useState<string | null>(null);

  // Task detail slide-over state
  const [selectedTask, setSelectedTask] = useState<InternalTask | null>(null);
  const [isEditingTask, setIsEditingTask] = useState(false);
  const [editedTask, setEditedTask] = useState<Partial<InternalTask>>({});
  const [isSavingTask, setIsSavingTask] = useState(false);

  useEffect(() => {
    if (!project) {
      fetchProjects();
    }
  }, [project, fetchProjects]);

  useEffect(() => {
    if (id) {
      fetchBoardData();
    }
  }, [id]);

  const fetchBoardData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem("accessToken");

      // Fetch board with columns and tasks in one call
      const boardRes = await fetch(`${API_BASE}/api/projects/${id}/board`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!boardRes.ok) throw new Error("Failed to fetch board");
      const boardData = await boardRes.json();

      // Extract columns and flatten tasks from the columns
      const columnsFromApi = boardData.columns.map((col: BoardColumn & { tasks: InternalTask[] }) => ({
        id: col.id,
        name: col.name,
        columnType: col.columnType,
        position: col.position,
        color: col.color,
        wipLimit: col.wipLimit,
      }));
      setColumns(columnsFromApi);

      // Flatten tasks from all columns
      const tasksFromApi: InternalTask[] = [];
      for (const col of boardData.columns) {
        if (col.tasks) {
          for (const task of col.tasks) {
            tasksFromApi.push({
              ...task,
              columnId: col.id,
              columnPosition: task.columnPosition || 0,
              status: task.status || "draft",
            });
          }
        }
      }
      setTasks(tasksFromApi);

      // Also fetch execution status
      const statusRes = await fetch(`${API_BASE}/api/projects/${id}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setExecutionStatus(statusData.epic?.executionStatus || "idle");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load board");
    } finally {
      setIsLoading(false);
    }
  };

  // Drag-drop is disabled - columns are system-controlled based on task status
  // Tasks automatically move between columns as their status changes during execution

  const getStatusBadgeColor = (status: InternalTaskStatus) => {
    switch (status) {
      case "draft":
        return "bg-gray-500";
      case "ready":
        return "bg-blue-500";
      case "queued":
        return "bg-yellow-500";
      case "executing":
        return "bg-orange-500";
      case "review":
        return "bg-purple-500";
      case "completed":
        return "bg-green-500";
      case "failed":
        return "bg-red-500";
      default:
        return "bg-gray-500";
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setTaskFormError(null);

    if (!taskFormData.title.trim()) {
      setTaskFormError("Title is required");
      return;
    }

    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/projects/${id}/tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(taskFormData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create task");
      }

      const responseData = await response.json();
      const newTask: InternalTask = {
        ...responseData.task,
        columnPosition: responseData.task.columnPosition || 0,
      };
      setTasks([...tasks, newTask]);
      setShowCreateModal(false);
      setTaskFormData({ title: "" });
      setCreateInColumnId(null);
    } catch (err) {
      setTaskFormError(err instanceof Error ? err.message : "Failed to create task");
    }
  };

  const handleDeleteTask = async (taskKey: string) => {
    if (!confirm("Are you sure you want to delete this task?")) return;

    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/projects/${id}/tasks/${taskKey}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new Error("Failed to delete task");
      setTasks(tasks.filter((t) => t.taskKey !== taskKey));
    } catch (err) {
      console.error("Failed to delete task:", err);
    }
  };

  const handleAssignToWorker = async (taskKey: string) => {
    setAssigningTaskKey(taskKey);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/projects/${id}/tasks/${taskKey}/assign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to assign task to worker");
      }

      const data = await response.json();

      // Update the task in state with the worker task info
      setTasks(tasks.map((t) =>
        t.taskKey === taskKey
          ? {
              ...t,
              workerTaskId: data.workerTask.id,
              workerTask: {
                id: data.workerTask.id,
                status: data.workerTask.status,
                githubPrUrl: data.workerTask.githubPrUrl,
              },
              assignedAt: new Date().toISOString(),
            }
          : t
      ));
    } catch (err) {
      console.error("Failed to assign task to worker:", err);
      alert(err instanceof Error ? err.message : "Failed to assign task to worker");
    } finally {
      setAssigningTaskKey(null);
    }
  };

  const getColumnTasks = (columnId: string) => {
    return tasks
      .filter((t) => t.columnId === columnId)
      .sort((a, b) => a.columnPosition - b.columnPosition);
  };

  const getPersonaColor = (persona: string | null) => {
    switch (persona) {
      case "backend_developer":
        return "border-l-blue-500";
      case "frontend_developer":
        return "border-l-purple-500";
      case "devops_engineer":
        return "border-l-orange-500";
      case "security_engineer":
        return "border-l-red-500";
      case "qa_engineer":
        return "border-l-green-500";
      case "tech_writer":
        return "border-l-cyan-500";
      default:
        return "border-l-gray-500";
    }
  };

  const getWorkerStatusColor = (status: string) => {
    switch (status) {
      case "queued":
      case "claimed":
        return "bg-yellow-500";
      case "executing":
      case "planning":
        return "bg-blue-500";
      case "completed":
      case "deployed":
        return "bg-green-500";
      case "failed":
        return "bg-red-500";
      default:
        return "bg-gray-500";
    }
  };

  const openTaskDetail = (task: InternalTask) => {
    setSelectedTask(task);
    setEditedTask({});
    setIsEditingTask(false);
  };

  const closeTaskDetail = () => {
    setSelectedTask(null);
    setEditedTask({});
    setIsEditingTask(false);
  };

  const startEditingTask = () => {
    if (selectedTask) {
      setEditedTask({ ...selectedTask });
      setIsEditingTask(true);
    }
  };

  const cancelEditingTask = () => {
    setEditedTask({});
    setIsEditingTask(false);
  };

  const handleSaveTask = async () => {
    if (!selectedTask || !id) return;

    setIsSavingTask(true);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/projects/${id}/tasks/${selectedTask.taskKey}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(editedTask),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update task");
      }

      const data = await response.json();
      const updatedTask = data.task;

      // Update task in state
      setTasks(tasks.map((t) =>
        t.taskKey === selectedTask.taskKey ? { ...t, ...updatedTask } : t
      ));
      setSelectedTask({ ...selectedTask, ...updatedTask });
      setIsEditingTask(false);
      setEditedTask({});
    } catch (err) {
      console.error("Failed to save task:", err);
      alert(err instanceof Error ? err.message : "Failed to save task");
    } finally {
      setIsSavingTask(false);
    }
  };

  const toggleDoDItem = async (index: number) => {
    if (!selectedTask || !id) return;

    const updatedDoD = [...(selectedTask.definitionOfDone || [])];
    updatedDoD[index] = { ...updatedDoD[index], checked: !updatedDoD[index].checked };

    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/projects/${id}/tasks/${selectedTask.taskKey}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ definitionOfDone: updatedDoD }),
      });

      if (!response.ok) throw new Error("Failed to update");

      // Update local state
      const updatedSelectedTask = { ...selectedTask, definitionOfDone: updatedDoD };
      setSelectedTask(updatedSelectedTask);
      setTasks(tasks.map((t) =>
        t.taskKey === selectedTask.taskKey ? updatedSelectedTask : t
      ));
    } catch (err) {
      console.error("Failed to toggle DoD item:", err);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <p className="text-red-500">{error}</p>
        <button
          onClick={() => navigate("/epics")}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground"
        >
          Back to Epics
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border/30 glass-strong sticky top-0 z-10">
        <div className="max-w-full mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/epics"
              className="p-2 rounded-lg hover:bg-muted transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <p className="text-xs font-mono text-muted-foreground">
                {project?.key || "..."}
              </p>
              <h1 className="text-xl font-semibold">{project?.name || "Loading..."}</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Execution Status Badge */}
            {executionStatus === "running" && (
              <span className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-500 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Epic Running
              </span>
            )}
            {/* New Story Button */}
            <button
              onClick={() => {
                setCreateInColumnId(null);
                setShowCreateModal(true);
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              title="Create a new story"
            >
              <Plus className="w-4 h-4" />
              New Story
            </button>
            <button
              onClick={fetchBoardData}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-5 h-5 text-muted-foreground" />
            </button>
            <Link
              to={`/epics/${id}/settings`}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
              title="Epic Settings"
            >
              <Settings className="w-5 h-5 text-muted-foreground" />
            </Link>
          </div>
        </div>
      </header>

      {/* Board - System-controlled columns (no drag-drop) */}
      <main className="flex-1 overflow-x-auto p-6">
        {/* Empty state when no tasks */}
        {tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center min-h-[calc(100vh-200px)] text-center">
            <FileText className="w-16 h-16 text-muted-foreground/50 mb-4" />
            <h2 className="text-xl font-semibold mb-2">No stories yet</h2>
            <p className="text-muted-foreground mb-6 max-w-md">
              Create your first story to start building this epic. Stories will automatically move between columns as they progress.
            </p>
            <button
              onClick={() => {
                setCreateInColumnId(null);
                setShowCreateModal(true);
              }}
              className="flex items-center gap-2 px-6 py-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-lg"
            >
              <Plus className="w-5 h-5" />
              Create First Story
            </button>
          </div>
        )}

        {tasks.length > 0 && (
        <div className="flex gap-4 min-h-[calc(100vh-140px)]">
          {columns.map((column) => (
            <div
              key={column.id}
              className="flex-shrink-0 w-80 flex flex-col"
            >
              {/* Column Header - System-controlled (no add button) */}
              <div
                className="flex items-center justify-between px-3 py-2 rounded-t-lg"
                style={{ backgroundColor: `${column.color}20` }}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: column.color }}
                  />
                  <h3 className="font-semibold text-sm">{column.name}</h3>
                  <span className="text-xs text-muted-foreground">
                    ({getColumnTasks(column.id).length}
                    {column.wipLimit ? `/${column.wipLimit}` : ""})
                  </span>
                </div>
              </div>

              {/* Column Content - Read-only status lanes */}
              <div className="flex-1 p-2 rounded-b-lg bg-muted/30 border border-border/50 min-h-[200px]">
                {getColumnTasks(column.id).map((task) => (
                  <div
                    key={task.id}
                    className={`group mb-2 p-3 rounded-lg bg-card border border-border hover:border-primary/50 transition-all border-l-4 ${getPersonaColor(task.persona)}`}
                  >
                    <div className="flex items-start gap-2">
                      <div
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => openTaskDetail(task)}
                      >
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-xs font-mono text-muted-foreground">
                            {task.taskKey}
                          </span>
                          {/* Status badge */}
                          <span className={`text-xs px-1.5 py-0.5 rounded text-white ${getStatusBadgeColor(task.status)}`}>
                            {task.status}
                          </span>
                          {task.persona && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              {task.persona}
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-medium truncate">
                          {task.title}
                        </p>
                        {task.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                            {task.description}
                          </p>
                        )}
                        {task.dueDate && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Due: {new Date(task.dueDate).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                        {/* Run single story button - only show for ready tasks */}
                        {task.status === "ready" && !task.workerTaskId && (
                          <button
                            onClick={() => handleAssignToWorker(task.taskKey)}
                            disabled={assigningTaskKey === task.taskKey}
                            className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-primary/10 transition-all disabled:opacity-50"
                            title="Run this story"
                          >
                            {assigningTaskKey === task.taskKey ? (
                              <Loader2 className="w-3 h-3 text-primary animate-spin" />
                            ) : (
                              <Play className="w-3 h-3 text-primary" />
                            )}
                          </button>
                        )}
                        {/* View Worker Task - show if assigned */}
                        {task.workerTaskId && (
                          <Link
                            to={`/dashboard?task=${task.workerTaskId}`}
                            className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-primary/10 transition-all"
                            title="View Worker Task"
                          >
                            <ExternalLink className="w-3 h-3 text-primary" />
                          </Link>
                        )}
                        {/* Delete - only show for draft tasks */}
                        {task.status === "draft" && (
                          <button
                            onClick={() => handleDeleteTask(task.taskKey)}
                            className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-all"
                            title="Delete story"
                          >
                            <Trash2 className="w-3 h-3 text-red-500" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        )}
      </main>

      {/* Create Task Modal - Near full page */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl border border-border w-full max-w-5xl h-[95vh] overflow-hidden flex flex-col">
            {/* Header with Save button */}
            <div className="p-6 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Create Story</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Stories with persona and acceptance criteria go to Ready.
                  Incomplete stories go to Backlog.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setTaskFormData({ title: "" });
                    setCreateInColumnId(null);
                    setTaskFormError(null);
                  }}
                  className="px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="create-task-form"
                  className="px-6 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  Create Story
                </button>
              </div>
            </div>
            <form
              id="create-task-form"
              onSubmit={handleCreateTask}
              className="flex-1 overflow-y-auto"
            >
              <div className="p-6 space-y-6">
                {taskFormError && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-sm">
                    {taskFormError}
                  </div>
                )}

                {/* Basic Info Section */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    Basic Info
                  </h3>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Title *
                    </label>
                    <input
                      type="text"
                      value={taskFormData.title}
                      onChange={(e) =>
                        setTaskFormData({
                          ...taskFormData,
                          title: e.target.value,
                        })
                      }
                      placeholder="e.g., Add user authentication endpoint"
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Worker Persona
                    </label>
                    <select
                      value={taskFormData.persona || "backend_developer"}
                      onChange={(e) =>
                        setTaskFormData({
                          ...taskFormData,
                          persona: e.target.value,
                        })
                      }
                      className="w-full max-w-sm px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                    >
                      <option value="backend_developer">
                        Backend Developer
                      </option>
                      <option value="frontend_developer">
                        Frontend Developer
                      </option>
                      <option value="devops_engineer">DevOps Engineer</option>
                      <option value="security_engineer">
                        Security Engineer
                      </option>
                      <option value="qa_engineer">QA Engineer</option>
                      <option value="tech_writer">Tech Writer</option>
                    </select>
                  </div>
                </div>

                {/* User Story Section - Single larger text box */}
                <div className="space-y-4 pt-4 border-t border-border">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    User Story
                  </h3>
                  <textarea
                    value={taskFormData.description || ""}
                    onChange={(e) =>
                      setTaskFormData({
                        ...taskFormData,
                        description: e.target.value,
                      })
                    }
                    placeholder={`Describe the story in detail. Example format:

As a [user/admin/developer], I want [feature or capability], so that [benefit or value].

Background:
- Context about the current state
- Why this change is needed

Requirements:
- Specific functionality to implement
- Edge cases to handle
- Integration points

Out of scope:
- What this story does NOT include`}
                    rows={12}
                    className="w-full px-4 py-3 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none text-sm leading-relaxed"
                  />
                </div>

                {/* Acceptance Criteria Section */}
                <div className="space-y-4 pt-4 border-t border-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                        Acceptance Criteria
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Gherkin format: Given / When / Then
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const current = taskFormData.acceptanceCriteria || [];
                        setTaskFormData({
                          ...taskFormData,
                          acceptanceCriteria: [
                            ...current,
                            { given: "", when: "", then: "" },
                          ],
                        });
                      }}
                      className="text-xs px-2 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                    >
                      + Add Criterion
                    </button>
                  </div>
                  {(taskFormData.acceptanceCriteria || []).map((ac, index) => (
                    <div
                      key={index}
                      className="p-3 rounded-lg bg-muted/30 border border-border space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">
                          Criterion {index + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const current =
                              taskFormData.acceptanceCriteria || [];
                            setTaskFormData({
                              ...taskFormData,
                              acceptanceCriteria: current.filter(
                                (_, i) => i !== index
                              ),
                            });
                          }}
                          className="text-xs text-red-500 hover:text-red-400"
                        >
                          Remove
                        </button>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-green-500 w-12">
                            GIVEN
                          </span>
                          <input
                            type="text"
                            value={ac.given}
                            onChange={(e) => {
                              const current =
                                taskFormData.acceptanceCriteria || [];
                              current[index] = {
                                ...current[index],
                                given: e.target.value,
                              };
                              setTaskFormData({
                                ...taskFormData,
                                acceptanceCriteria: [...current],
                              });
                            }}
                            placeholder="the precondition..."
                            className="flex-1 px-2 py-1 text-sm rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-blue-500 w-12">
                            WHEN
                          </span>
                          <input
                            type="text"
                            value={ac.when}
                            onChange={(e) => {
                              const current =
                                taskFormData.acceptanceCriteria || [];
                              current[index] = {
                                ...current[index],
                                when: e.target.value,
                              };
                              setTaskFormData({
                                ...taskFormData,
                                acceptanceCriteria: [...current],
                              });
                            }}
                            placeholder="the action happens..."
                            className="flex-1 px-2 py-1 text-sm rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-purple-500 w-12">
                            THEN
                          </span>
                          <input
                            type="text"
                            value={ac.then}
                            onChange={(e) => {
                              const current =
                                taskFormData.acceptanceCriteria || [];
                              current[index] = {
                                ...current[index],
                                then: e.target.value,
                              };
                              setTaskFormData({
                                ...taskFormData,
                                acceptanceCriteria: [...current],
                              });
                            }}
                            placeholder="the expected result..."
                            className="flex-1 px-2 py-1 text-sm rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                  {(!taskFormData.acceptanceCriteria ||
                    taskFormData.acceptanceCriteria.length === 0) && (
                    <p className="text-xs text-muted-foreground italic text-center py-3">
                      No acceptance criteria defined yet
                    </p>
                  )}
                </div>

                {/* Definition of Done Section */}
                <div className="space-y-4 pt-4 border-t border-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                        Definition of Done
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Checklist items to verify completion
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const current = taskFormData.definitionOfDone || [];
                        setTaskFormData({
                          ...taskFormData,
                          definitionOfDone: [
                            ...current,
                            { text: "", checked: false },
                          ],
                        });
                      }}
                      className="text-xs px-2 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                    >
                      + Add Item
                    </button>
                  </div>
                  <div className="space-y-2">
                    {(taskFormData.definitionOfDone || []).map((item, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={item.text}
                          onChange={(e) => {
                            const current = taskFormData.definitionOfDone || [];
                            current[index] = {
                              ...current[index],
                              text: e.target.value,
                            };
                            setTaskFormData({
                              ...taskFormData,
                              definitionOfDone: [...current],
                            });
                          }}
                          placeholder="e.g., Unit tests pass, Code reviewed..."
                          className="flex-1 px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const current = taskFormData.definitionOfDone || [];
                            setTaskFormData({
                              ...taskFormData,
                              definitionOfDone: current.filter(
                                (_, i) => i !== index
                              ),
                            });
                          }}
                          className="p-2 text-red-500 hover:text-red-400"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    {(!taskFormData.definitionOfDone ||
                      taskFormData.definitionOfDone.length === 0) && (
                      <p className="text-xs text-muted-foreground italic text-center py-3">
                        No definition of done items yet
                      </p>
                    )}
                  </div>
                </div>

                {/* Technical Notes Section */}
                <div className="space-y-4 pt-4 border-t border-border">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    Technical Notes
                  </h3>
                  <textarea
                    value={taskFormData.technicalNotes || ""}
                    onChange={(e) =>
                      setTaskFormData({
                        ...taskFormData,
                        technicalNotes: e.target.value,
                      })
                    }
                    placeholder="Implementation hints, constraints, related files, dependencies..."
                    rows={4}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none font-mono text-sm"
                  />
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Task Detail Slide-Over */}
      {selectedTask && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={closeTaskDetail}
          />

          {/* Slide-over Panel */}
          <div className="fixed inset-y-0 right-0 w-full max-w-2xl bg-card border-l border-border z-50 shadow-2xl transform transition-transform duration-300 ease-out flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-3">
                <span className="text-sm font-mono text-muted-foreground bg-muted px-2 py-1 rounded">
                  {selectedTask.taskKey}
                </span>
                {selectedTask.workerTask && (
                  <span className={`text-xs px-2 py-1 rounded text-white ${getWorkerStatusColor(selectedTask.workerTask.status)}`}>
                    {selectedTask.workerTask.status}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!isEditingTask ? (
                  <button
                    onClick={startEditingTask}
                    className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
                  >
                    Edit
                  </button>
                ) : (
                  <>
                    <button
                      onClick={cancelEditingTask}
                      className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveTask}
                      disabled={isSavingTask}
                      className="px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                      {isSavingTask ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Save
                    </button>
                  </>
                )}
                <button
                  onClick={closeTaskDetail}
                  className="p-2 rounded-lg hover:bg-muted transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Title */}
              <div>
                {isEditingTask ? (
                  <input
                    type="text"
                    value={editedTask.title || selectedTask.title}
                    onChange={(e) => setEditedTask({ ...editedTask, title: e.target.value })}
                    className="w-full text-xl font-semibold px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                ) : (
                  <h2 className="text-xl font-semibold">{selectedTask.title}</h2>
                )}
              </div>

              {/* Metadata Row */}
              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                {selectedTask.persona && (
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4" />
                    <span>{selectedTask.persona.replace("_", " ")}</span>
                  </div>
                )}
                {selectedTask.dueDate && (
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    <span>Due {new Date(selectedTask.dueDate).toLocaleDateString()}</span>
                  </div>
                )}
                {selectedTask.githubRepo && (
                  <div className="flex items-center gap-2">
                    <GitBranch className="w-4 h-4" />
                    <span>{selectedTask.githubRepo}</span>
                  </div>
                )}
                {selectedTask.workerTask?.githubPrUrl && (
                  <a
                    href={selectedTask.workerTask.githubPrUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-primary hover:underline"
                  >
                    <ExternalLink className="w-4 h-4" />
                    View PR
                  </a>
                )}
              </div>

              {/* Worker Actions */}
              {!selectedTask.workerTaskId && (
                <div className="p-4 rounded-lg bg-muted/30 border border-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Ready for AI Worker</p>
                      <p className="text-sm text-muted-foreground">Assign this task to an AI worker for execution</p>
                    </div>
                    <button
                      onClick={() => {
                        handleAssignToWorker(selectedTask.taskKey);
                      }}
                      disabled={assigningTaskKey === selectedTask.taskKey}
                      className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                      {assigningTaskKey === selectedTask.taskKey ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                      Assign to Worker
                    </button>
                  </div>
                </div>
              )}

              {selectedTask.workerTaskId && (
                <div className="p-4 rounded-lg bg-muted/30 border border-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Assigned to AI Worker</p>
                      <p className="text-sm text-muted-foreground">Status: {selectedTask.workerTask?.status || "Unknown"}</p>
                    </div>
                    <Link
                      to={`/dashboard?task=${selectedTask.workerTaskId}`}
                      className="px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors flex items-center gap-2"
                    >
                      <ExternalLink className="w-4 h-4" />
                      View in Dashboard
                    </Link>
                  </div>
                </div>
              )}

              {/* User Story */}
              {(selectedTask.userStoryRole || selectedTask.userStoryWant || selectedTask.userStoryBenefit) && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    User Story
                  </h3>
                  <div className="p-4 rounded-lg bg-muted/30 border border-border">
                    {isEditingTask ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium w-16">As a</span>
                          <input
                            type="text"
                            value={editedTask.userStoryRole ?? selectedTask.userStoryRole ?? ""}
                            onChange={(e) => setEditedTask({ ...editedTask, userStoryRole: e.target.value })}
                            className="flex-1 px-2 py-1 text-sm rounded border border-border bg-background"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium w-16">I want</span>
                          <input
                            type="text"
                            value={editedTask.userStoryWant ?? selectedTask.userStoryWant ?? ""}
                            onChange={(e) => setEditedTask({ ...editedTask, userStoryWant: e.target.value })}
                            className="flex-1 px-2 py-1 text-sm rounded border border-border bg-background"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium w-16">So that</span>
                          <input
                            type="text"
                            value={editedTask.userStoryBenefit ?? selectedTask.userStoryBenefit ?? ""}
                            onChange={(e) => setEditedTask({ ...editedTask, userStoryBenefit: e.target.value })}
                            className="flex-1 px-2 py-1 text-sm rounded border border-border bg-background"
                          />
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm">
                        <span className="font-medium">As a</span> {selectedTask.userStoryRole || "..."},{" "}
                        <span className="font-medium">I want</span> {selectedTask.userStoryWant || "..."},{" "}
                        <span className="font-medium">so that</span> {selectedTask.userStoryBenefit || "..."}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Description */}
              {(selectedTask.description || isEditingTask) && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Description</h3>
                  {isEditingTask ? (
                    <textarea
                      value={editedTask.description ?? selectedTask.description ?? ""}
                      onChange={(e) => setEditedTask({ ...editedTask, description: e.target.value })}
                      rows={4}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selectedTask.description}</p>
                  )}
                </div>
              )}

              {/* Acceptance Criteria */}
              {selectedTask.acceptanceCriteria && selectedTask.acceptanceCriteria.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    Acceptance Criteria
                  </h3>
                  <div className="space-y-2">
                    {selectedTask.acceptanceCriteria.map((ac, index) => (
                      <div key={index} className="p-3 rounded-lg bg-muted/30 border border-border text-sm space-y-1">
                        <p><span className="font-mono text-green-500">GIVEN</span> {ac.given}</p>
                        <p><span className="font-mono text-blue-500">WHEN</span> {ac.when}</p>
                        <p><span className="font-mono text-purple-500">THEN</span> {ac.then}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Definition of Done */}
              {selectedTask.definitionOfDone && selectedTask.definitionOfDone.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    Definition of Done
                  </h3>
                  <div className="space-y-2">
                    {selectedTask.definitionOfDone.map((item, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => toggleDoDItem(index)}
                      >
                        <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                          item.checked
                            ? "bg-green-500 border-green-500 text-white"
                            : "border-border"
                        }`}>
                          {item.checked && <Check className="w-3 h-3" />}
                        </div>
                        <span className={`text-sm ${item.checked ? "line-through text-muted-foreground" : ""}`}>
                          {item.text}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Technical Notes */}
              {(selectedTask.technicalNotes || isEditingTask) && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Technical Notes</h3>
                  {isEditingTask ? (
                    <textarea
                      value={editedTask.technicalNotes ?? selectedTask.technicalNotes ?? ""}
                      onChange={(e) => setEditedTask({ ...editedTask, technicalNotes: e.target.value })}
                      rows={4}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none font-mono text-sm"
                    />
                  ) : (
                    <pre className="text-sm text-muted-foreground whitespace-pre-wrap font-mono p-3 bg-muted/30 rounded-lg">
                      {selectedTask.technicalNotes}
                    </pre>
                  )}
                </div>
              )}

              {/* Timestamps */}
              <div className="pt-4 border-t border-border text-xs text-muted-foreground space-y-1">
                <p>Created: {new Date(selectedTask.createdAt).toLocaleString()}</p>
                <p>Updated: {new Date(selectedTask.updatedAt).toLocaleString()}</p>
                {selectedTask.assignedAt && (
                  <p>Assigned: {new Date(selectedTask.assignedAt).toLocaleString()}</p>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

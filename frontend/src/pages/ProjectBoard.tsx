import { useState, useEffect } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  Plus,
  ArrowLeft,
  Settings,
  RefreshCw,
  Trash2,
  GripVertical,
} from "lucide-react";
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd";
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

interface InternalTask {
  id: string;
  taskKey: string;
  title: string;
  description: string | null;
  columnId: string;
  position: number;
  priority: "low" | "medium" | "high" | "critical";
  persona: string;
  createdAt: string;
}

interface CreateTaskData {
  title: string;
  description?: string;
  priority?: string;
  persona?: string;
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

  // Create task modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createInColumnId, setCreateInColumnId] = useState<string | null>(null);
  const [taskFormData, setTaskFormData] = useState<CreateTaskData>({ title: "" });
  const [taskFormError, setTaskFormError] = useState<string | null>(null);

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
              position: task.columnPosition || 0,
            });
          }
        }
      }
      setTasks(tasksFromApi);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load board");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result;

    // Dropped outside a droppable area
    if (!destination) return;

    // Dropped in the same position
    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      return;
    }

    // Find the task
    const task = tasks.find((t) => t.id === draggableId);
    if (!task) return;

    // Optimistically update UI
    const newTasks = tasks.filter((t) => t.id !== draggableId);
    const updatedTask = {
      ...task,
      columnId: destination.droppableId,
      position: destination.index,
    };
    newTasks.splice(destination.index, 0, updatedTask);
    setTasks(newTasks);

    // Send update to server using taskKey (backend expects taskKey, not id)
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/projects/${id}/tasks/${task.taskKey}/move`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          columnId: destination.droppableId,
          position: destination.index,
        }),
      });

      if (!response.ok) {
        // Revert on error
        fetchBoardData();
      }
    } catch (err) {
      console.error("Failed to move task:", err);
      fetchBoardData();
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
        body: JSON.stringify({
          ...taskFormData,
          columnId: createInColumnId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create task");
      }

      const responseData = await response.json();
      const newTask: InternalTask = {
        ...responseData.task,
        position: responseData.task.columnPosition || 0,
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

  const getColumnTasks = (columnId: string) => {
    return tasks
      .filter((t) => t.columnId === columnId)
      .sort((a, b) => a.position - b.position);
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "critical":
        return "border-l-red-500";
      case "high":
        return "border-l-orange-500";
      case "medium":
        return "border-l-yellow-500";
      case "low":
        return "border-l-blue-500";
      default:
        return "border-l-gray-500";
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
          onClick={() => navigate("/projects")}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground"
        >
          Back to Projects
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
              to="/projects"
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
            <button
              onClick={fetchBoardData}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-5 h-5 text-muted-foreground" />
            </button>
            <Link
              to={`/projects/${id}/settings`}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
              title="Project Settings"
            >
              <Settings className="w-5 h-5 text-muted-foreground" />
            </Link>
          </div>
        </div>
      </header>

      {/* Board */}
      <main className="flex-1 overflow-x-auto p-6">
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="flex gap-4 min-h-[calc(100vh-140px)]">
            {columns.map((column) => (
              <div
                key={column.id}
                className="flex-shrink-0 w-80 flex flex-col"
              >
                {/* Column Header */}
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
                  <button
                    onClick={() => {
                      setCreateInColumnId(column.id);
                      setShowCreateModal(true);
                    }}
                    className="p-1 rounded hover:bg-white/20 transition-colors"
                    title="Add task"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                {/* Column Content */}
                <Droppable droppableId={column.id}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`flex-1 p-2 rounded-b-lg bg-muted/30 border border-border/50 min-h-[200px] transition-colors ${
                        snapshot.isDraggingOver ? "bg-primary/10" : ""
                      }`}
                    >
                      {getColumnTasks(column.id).map((task, index) => (
                        <Draggable
                          key={task.id}
                          draggableId={task.id}
                          index={index}
                        >
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              className={`group mb-2 p-3 rounded-lg bg-card border border-border hover:border-primary/50 transition-all border-l-4 ${getPriorityColor(task.priority)} ${
                                snapshot.isDragging ? "shadow-lg rotate-2" : ""
                              }`}
                            >
                              <div className="flex items-start gap-2">
                                <div
                                  {...provided.dragHandleProps}
                                  className="mt-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab"
                                >
                                  <GripVertical className="w-4 h-4 text-muted-foreground" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-mono text-muted-foreground">
                                      {task.taskKey}
                                    </span>
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                      {task.persona}
                                    </span>
                                  </div>
                                  <p className="text-sm font-medium truncate">
                                    {task.title}
                                  </p>
                                  {task.description && (
                                    <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                                      {task.description}
                                    </p>
                                  )}
                                </div>
                                <button
                                  onClick={() => handleDeleteTask(task.taskKey)}
                                  className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-all"
                                  title="Delete task"
                                >
                                  <Trash2 className="w-3 h-3 text-red-500" />
                                </button>
                              </div>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            ))}
          </div>
        </DragDropContext>
      </main>

      {/* Create Task Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-xl border border-border w-full max-w-md p-6 mx-4">
            <h2 className="text-xl font-semibold mb-4">Create Task</h2>
            <form onSubmit={handleCreateTask}>
              {taskFormError && (
                <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-sm">
                  {taskFormError}
                </div>
              )}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Title</label>
                  <input
                    type="text"
                    value={taskFormData.title}
                    onChange={(e) =>
                      setTaskFormData({ ...taskFormData, title: e.target.value })
                    }
                    placeholder="Task title"
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Description (optional)
                  </label>
                  <textarea
                    value={taskFormData.description || ""}
                    onChange={(e) =>
                      setTaskFormData({ ...taskFormData, description: e.target.value })
                    }
                    placeholder="Task description..."
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Priority</label>
                    <select
                      value={taskFormData.priority || "medium"}
                      onChange={(e) =>
                        setTaskFormData({ ...taskFormData, priority: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Persona</label>
                    <select
                      value={taskFormData.persona || "backend_developer"}
                      onChange={(e) =>
                        setTaskFormData({ ...taskFormData, persona: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                    >
                      <option value="backend_developer">Backend Developer</option>
                      <option value="frontend_developer">Frontend Developer</option>
                      <option value="devops_engineer">DevOps Engineer</option>
                      <option value="security_engineer">Security Engineer</option>
                      <option value="qa_engineer">QA Engineer</option>
                      <option value="tech_writer">Tech Writer</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
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
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Create Task
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

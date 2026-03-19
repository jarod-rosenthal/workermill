import { Link } from "react-router-dom";
import {
  RefreshCw,
  DollarSign,
  Play,
  Layers,
  FolderKanban,
} from "lucide-react";
import { PERSONA_CONFIG } from "../types";

interface CreateTaskModalProps {
  showCreateTaskModal: boolean;
  taskSource: "external" | "internal";
  setTaskSource: (source: "external" | "internal") => void;
  createTaskForm: { jiraIssueKey: string; workerPersona: string };
  setCreateTaskForm: React.Dispatch<React.SetStateAction<{ jiraIssueKey: string; workerPersona: string }>>;
  createLoading: boolean;
  costEstimate: {
    tier: string;
    costRange: { min: number; max: number };
    tokenRange: { min: number; max: number };
    confidence: string;
    tierDescription: string;
    historicalBasis: number;
  } | null;
  setCostEstimate: (estimate: CreateTaskModalProps["costEstimate"]) => void;
  costEstimateLoading: boolean;
  internalProjects: Array<{ id: string; key: string; name: string }>;
  selectedProjectId: string;
  setSelectedProjectId: (id: string) => void;
  internalTasks: Array<{ taskKey: string; title: string; persona: string | null; columnType: string }>;
  selectedTaskKey: string;
  setSelectedTaskKey: (key: string) => void;
  projectsLoading: boolean;
  tasksLoading: boolean;
  handleCreateTask: () => void;
  fetchCostEstimate: (key: string) => void;
  onClose: () => void;
}

export function CreateTaskModal({
  taskSource,
  setTaskSource,
  createTaskForm,
  setCreateTaskForm,
  createLoading,
  costEstimate,
  setCostEstimate,
  costEstimateLoading,
  internalProjects,
  selectedProjectId,
  setSelectedProjectId,
  internalTasks,
  selectedTaskKey,
  setSelectedTaskKey,
  projectsLoading,
  tasksLoading,
  handleCreateTask,
  fetchCostEstimate,
  onClose,
}: CreateTaskModalProps) {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="card-elevated border border-border/50 rounded-xl w-full max-w-md glow-mixed">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2">
            <Play className="w-4 h-4" />
            Run AI Task
          </h3>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            {"\u00D7"}
          </button>
        </div>
        <div className="p-4 space-y-4">
          {/* Task Source Selector */}
          <div>
            <label className="block text-sm font-medium mb-2">Task Source</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTaskSource("external")}
                className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border transition-all ${
                  taskSource === "external"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                <Layers className="w-4 h-4" />
                <span className="text-sm font-medium">Jira / Linear</span>
              </button>
              <button
                type="button"
                onClick={() => setTaskSource("internal")}
                className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border transition-all ${
                  taskSource === "internal"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                <FolderKanban className="w-4 h-4" />
                <span className="text-sm font-medium">Internal Project</span>
              </button>
            </div>
          </div>

          {taskSource === "external" ? (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Issue Key
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="e.g., PROJ-123"
                    value={createTaskForm.jiraIssueKey}
                    onChange={(e) => {
                      setCreateTaskForm((prev) => ({
                        ...prev,
                        jiraIssueKey: e.target.value,
                      }));
                      setCostEstimate(null);
                    }}
                    className="flex-1 px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <button
                    type="button"
                    onClick={() => fetchCostEstimate(createTaskForm.jiraIssueKey)}
                    disabled={!createTaskForm.jiraIssueKey || costEstimateLoading}
                    className="px-3 py-2 bg-purple-500/10 text-purple-500 border border-purple-500/30 rounded-lg hover:bg-purple-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    {costEstimateLoading ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <DollarSign className="w-4 h-4" />
                    )}
                    <span className="text-sm">Estimate</span>
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Jira or Linear issue key (e.g., ACME-123 or PROJECT-456)
                </p>
                {costEstimate && (
                  <div className="mt-3 p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-purple-400">
                        Complexity: <span className="capitalize">{costEstimate.tier}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {costEstimate.historicalBasis >= 5
                          ? `Based on ${costEstimate.historicalBasis} past tasks`
                          : `${costEstimate.confidence} confidence`}
                      </span>
                    </div>
                    <div className="text-center py-2">
                      <span className="text-muted-foreground text-sm">Estimated Token Cost:</span>
                      <div className="font-bold text-xl text-green-400">
                        ~${costEstimate.costRange.min.toFixed(2)} - ${costEstimate.costRange.max.toFixed(2)}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 text-center">
                      {costEstimate.tierDescription}
                    </p>
                    <p className="text-xs text-muted-foreground/70 mt-2 text-center italic">
                      Estimated based on API token pricing. Actual cost depends on your provider and plan.
                    </p>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Worker Persona
                </label>
                <select
                  value={createTaskForm.workerPersona}
                  onChange={(e) =>
                    setCreateTaskForm((prev) => ({
                      ...prev,
                      workerPersona: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">{"\u{1F916}"} Auto (Dynamic Routing)</option>
                  {Object.entries(PERSONA_CONFIG)
                    .filter(([key]) => key !== "manager")
                    .map(([key, config]) => (
                      <option key={key} value={key}>
                        {config.emoji} {config.title}
                      </option>
                    ))}
                </select>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Project
                </label>
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  disabled={projectsLoading}
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                >
                  <option value="">
                    {projectsLoading ? "Loading projects..." : "Select a project"}
                  </option>
                  {internalProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.key} - {project.name}
                    </option>
                  ))}
                </select>
                {internalProjects.length === 0 && !projectsLoading && (
                  <p className="text-xs text-muted-foreground mt-1">
                    No projects found.{" "}
                    <Link to="/projects" className="text-primary hover:underline">
                      Create one
                    </Link>
                  </p>
                )}
              </div>
              {selectedProjectId && (
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Task
                  </label>
                  <select
                    value={selectedTaskKey}
                    onChange={(e) => setSelectedTaskKey(e.target.value)}
                    disabled={tasksLoading}
                    className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                  >
                    <option value="">
                      {tasksLoading ? "Loading tasks..." : "Select a task"}
                    </option>
                    {internalTasks.map((task) => (
                      <option key={task.taskKey} value={task.taskKey}>
                        {task.taskKey} - {task.title}
                        {task.persona && ` (${PERSONA_CONFIG[task.persona]?.emoji || ""} ${task.persona})`}
                      </option>
                    ))}
                  </select>
                  {internalTasks.length === 0 && !tasksLoading && (
                    <p className="text-xs text-muted-foreground mt-1">
                      No available tasks in Ready or Backlog columns.{" "}
                      <Link to={`/projects/${selectedProjectId}`} className="text-primary hover:underline">
                        Create tasks on the board
                      </Link>
                    </p>
                  )}
                  {selectedTaskKey && (
                    <div className="mt-2">
                      <p className="text-xs text-muted-foreground mb-1">
                        Task will use configured persona, model, and GitHub
                        repo settings.
                      </p>
                      <button
                        onClick={() =>
                          fetchCostEstimate(selectedTaskKey)
                        }
                        disabled={costEstimateLoading}
                        className="text-xs flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-muted transition-colors"
                      >
                        {costEstimateLoading ? (
                          <RefreshCw className="w-3 h-3 animate-spin" />
                        ) : (
                          <DollarSign className="w-3 h-3" />
                        )}
                        Estimate Cost
                      </button>
                      {costEstimate && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          <span className="font-medium">
                            {costEstimate.tier}
                          </span>
                          {" \u2014 "}
                          {typeof costEstimate.costRange === "object"
                            ? `$${costEstimate.costRange.min.toFixed(2)} - $${costEstimate.costRange.max.toFixed(2)}`
                            : costEstimate.costRange}
                          {costEstimate.confidence && (
                            <span className="text-muted-foreground/60">
                              {" "}
                              ({costEstimate.confidence})
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreateTask}
            disabled={
              createLoading ||
              (taskSource === "external" && !createTaskForm.jiraIssueKey) ||
              (taskSource === "internal" && (!selectedProjectId || !selectedTaskKey))
            }
            className="px-3 py-2 bg-blue-500/10 text-blue-500 border border-blue-500/30 rounded-lg hover:bg-blue-500/20 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {createLoading && (
              <RefreshCw className="w-4 h-4 animate-spin" />
            )}
            Run Task
          </button>
        </div>
      </div>
    </div>
  );
}

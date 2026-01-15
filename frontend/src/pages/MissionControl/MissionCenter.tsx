import { ExternalLink, XCircle, Eye } from "lucide-react";
import type { ActiveTask } from "./index";

// Persona emoji mapping
const PERSONA_EMOJI: Record<string, string> = {
  frontend_developer: "🎨",
  backend_developer: "⚙️",
  devops_engineer: "🔧",
  security_engineer: "🔒",
  qa_engineer: "🧪",
  tech_writer: "📝",
  project_manager: "📋",
  manager: "👔",
};

// Model short names
const MODEL_SHORT_NAMES: Record<string, string> = {
  "claude-opus-4-5-20251101": "Opus 4.5",
  "claude-sonnet-4-5-20250929": "Sonnet 4.5",
  "claude-haiku-4-5-20251001": "Haiku 4.5",
};

interface MissionCenterProps {
  activeTasks: ActiveTask[];
  queuedTasks: ActiveTask[];
  soundEnabled: boolean;
}

export function MissionCenter({ activeTasks, queuedTasks }: MissionCenterProps) {
  // Calculate estimated progress based on steps
  const calculateProgress = (task: ActiveTask) => {
    if (!task.steps || task.steps.length === 0) return 50;

    const doneSteps = task.steps.filter((s) => s.status === "done").length;
    const activeSteps = task.steps.filter((s) => s.status === "active").length;

    // Active step counts as half done
    const progress = ((doneSteps + activeSteps * 0.5) / task.steps.length) * 100;
    return Math.min(Math.max(progress, 5), 95); // Clamp between 5-95%
  };

  const getModelShortName = (modelId?: string) => {
    if (!modelId) return "Sonnet 4";
    return MODEL_SHORT_NAMES[modelId] || modelId.split("-").slice(-2, -1)[0] || "Unknown";
  };

  const formatCost = (cost: number) => {
    return cost?.toFixed(2) || "0.00";
  };

  const getLatestLog = (task: ActiveTask) => {
    if (task.recentLogs && task.recentLogs.length > 0) {
      return task.recentLogs[task.recentLogs.length - 1].message;
    }
    // Derive from steps
    const activeStep = task.steps?.find((s) => s.status === "active");
    if (activeStep) {
      return `${activeStep.name}...`;
    }
    return "Initializing...";
  };

  const allMissions = [...activeTasks, ...queuedTasks];
  const executingTasks = activeTasks.filter((t) => t.status === "executing");
  const waitingTasks = [...activeTasks.filter((t) => t.status !== "executing"), ...queuedTasks];

  return (
    <main className="mission-center">
      <div className="mission-center-header">
        <h2 className="mission-center-title">Active Missions</h2>
        <span className="mission-center-count">{allMissions.length}</span>
      </div>

      {allMissions.length === 0 ? (
        <div className="mission-center-empty">
          <div className="mission-center-empty-icon">🚀</div>
          <h3 className="mission-center-empty-title">No Active Missions</h3>
          <p className="mission-center-empty-text">
            Queue a task from Jira to begin operations
          </p>
        </div>
      ) : (
        <div className="mission-cards">
          {/* Executing tasks first */}
          {executingTasks.map((task) => (
            <MissionCard
              key={task.id}
              task={task}
              isActive={true}
              progress={calculateProgress(task)}
              modelName={getModelShortName(task.workerModel)}
              latestLog={getLatestLog(task)}
              formatCost={formatCost}
            />
          ))}

          {/* Then waiting/queued tasks */}
          {waitingTasks.map((task) => (
            <MissionCard
              key={task.id}
              task={task}
              isActive={false}
              progress={calculateProgress(task)}
              modelName={getModelShortName(task.workerModel)}
              latestLog={getLatestLog(task)}
              formatCost={formatCost}
            />
          ))}
        </div>
      )}
    </main>
  );
}

interface MissionCardProps {
  task: ActiveTask;
  isActive: boolean;
  progress: number;
  modelName: string;
  latestLog: string;
  formatCost: (cost: number) => string;
}

function MissionCard({
  task,
  isActive,
  progress,
  modelName,
  latestLog,
  formatCost,
}: MissionCardProps) {
  const personaEmoji = PERSONA_EMOJI[task.workerPersona] || "🤖";
  const personaName = task.workerPersona?.replace(/_/g, " ") || "worker";

  const handleViewPR = () => {
    if (task.githubPrUrl) {
      window.open(task.githubPrUrl, "_blank");
    }
  };

  const handleCancel = async () => {
    // TODO: Implement cancel via API
    console.log("Cancel task:", task.id);
  };

  return (
    <article className={`mission-card ${isActive ? "active" : ""}`}>
      <div className="mission-card-header">
        <div className="mission-card-id">
          <span className="mission-card-key">{task.jiraIssueKey}</span>
          <div className="mission-card-persona">
            <span>{personaEmoji}</span>
            <span>{personaName}</span>
            <span>•</span>
            <span>{modelName}</span>
          </div>
        </div>
        <span className="mission-card-cost">${formatCost(task.estimatedCostUsd)}</span>
      </div>

      <div className="mission-card-body">
        <p className="mission-card-summary">{task.summary}</p>

        <div className="mission-progress">
          <div className="mission-progress-bar">
            <div
              className="mission-progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mission-progress-text">
            <span className="mission-progress-status">
              {task.status === "queued" ? "Waiting in queue" : task.status}
            </span>
            <span className="mission-progress-percent">{Math.round(progress)}%</span>
          </div>
        </div>

        <div className="mission-log-preview">{latestLog}</div>
      </div>

      <div className="mission-card-actions">
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {task.githubPrUrl && (
            <button className="mission-card-action primary" onClick={handleViewPR}>
              <ExternalLink className="w-3 h-3" />
              View PR
            </button>
          )}
          <button className="mission-card-action">
            <Eye className="w-3 h-3" />
            Logs
          </button>
        </div>
        <button className="mission-card-action" onClick={handleCancel}>
          <XCircle className="w-3 h-3" />
          Cancel
        </button>
      </div>
    </article>
  );
}

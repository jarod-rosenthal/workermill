import { ExternalLink, Pause, XCircle, Zap, Eye, GitBranch } from "lucide-react";
import type { ParentTask, WorkflowStats, ExecutionMode } from "../orchestration-store";
import { PERSONA_CONFIGS } from "../../../types/mission-control";

interface WorkflowHeaderProps {
  parentTask: ParentTask | null;
  stats: WorkflowStats;
  executionMode: ExecutionMode;
  isLoading: boolean;
  showDependencyGraph: boolean;
  onPauseAll: () => void;
  onCancelWorkflow: () => void;
  onToggleGraph: () => void;
}

// Get Jira URL from issue key
function getJiraUrl(issueKey: string): string {
  // Default to oncallshift Jira - could be made configurable
  return `https://oncallshift.atlassian.net/browse/${issueKey}`;
}

// Format duration
function formatDuration(startedAt?: string): string {
  if (!startedAt) return "0m";
  const ms = Date.now() - new Date(startedAt).getTime();
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}m`;
}

// Format cost
function formatCost(cost: number): string {
  if (cost < 0.01) return "$0.00";
  return `$${cost.toFixed(2)}`;
}

// Progress percentage
function getProgressPercent(stats: WorkflowStats): number {
  if (stats.totalStories === 0) return 0;
  return Math.round((stats.completed / stats.totalStories) * 100);
}

export function WorkflowHeader({
  parentTask,
  stats,
  executionMode,
  isLoading,
  showDependencyGraph,
  onPauseAll,
  onCancelWorkflow,
  onToggleGraph,
}: WorkflowHeaderProps) {
  const progressPercent = getProgressPercent(stats);
  const personaConfig = parentTask?.workerPersona
    ? PERSONA_CONFIGS[parentTask.workerPersona]
    : null;

  if (isLoading && !parentTask) {
    return (
      <div className="mc-tile p-4">
        <div className="flex items-center gap-4">
          <div className="mc-skeleton w-32 h-6" />
          <div className="mc-skeleton w-48 h-4" />
        </div>
      </div>
    );
  }

  if (!parentTask) {
    return (
      <div className="mc-tile p-4">
        <div className="text-[var(--mc-text-muted)]">No workflow data available</div>
      </div>
    );
  }

  return (
    <div className="mc-tile">
      {/* Top Row: Key, Summary, Actions */}
      <div className="mc-tile-header">
        <div className="mc-tile-header-left">
          {/* Jira Key with Link */}
          <a
            href={getJiraUrl(parentTask.jiraIssueKey)}
            target="_blank"
            rel="noopener noreferrer"
            className="mc-tile-key flex items-center gap-1 hover:underline"
          >
            {parentTask.jiraIssueKey}
            <ExternalLink className="w-3 h-3" />
          </a>

          {/* Execution Mode Badge */}
          <span
            className={`px-2 py-0.5 text-[var(--mc-text-xs)] font-medium rounded ${
              executionMode === "autonomous"
                ? "bg-[var(--mc-status-active)] bg-opacity-20 text-[var(--mc-status-active)]"
                : "bg-[var(--mc-status-warning)] bg-opacity-20 text-[var(--mc-status-warning)]"
            }`}
          >
            {executionMode === "autonomous" ? (
              <span className="flex items-center gap-1">
                <Zap className="w-3 h-3" />
                Autonomous
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <Eye className="w-3 h-3" />
                Supervised
              </span>
            )}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleGraph}
            className={`mc-btn ${showDependencyGraph ? "mc-btn-primary" : "mc-btn-secondary"} flex items-center gap-1`}
            title="Toggle Dependency Graph"
          >
            <GitBranch className="w-3 h-3" />
            Graph
          </button>
          <button
            onClick={onPauseAll}
            className="mc-btn mc-btn-secondary flex items-center gap-1"
            title="Pause All Workers"
          >
            <Pause className="w-3 h-3" />
            Pause All
          </button>
          <button
            onClick={onCancelWorkflow}
            className="mc-btn mc-btn-danger flex items-center gap-1"
            title="Cancel Workflow"
          >
            <XCircle className="w-3 h-3" />
            Cancel
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="px-4 py-2 border-b border-[var(--mc-border-subtle)]">
        <h1 className="text-[var(--mc-text-lg)] font-semibold text-[var(--mc-text-primary)] truncate">
          {parentTask.summary}
        </h1>
      </div>

      {/* Progress Bar */}
      <div className="mc-tile-progress">
        <div className="mc-tile-progress-bar">
          <div
            className="mc-tile-progress-fill"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <span className="mc-tile-time">
          {stats.completed}/{stats.totalStories}
        </span>
      </div>

      {/* Stats Row */}
      <div className="mc-tile-footer">
        <div className="flex items-center gap-6">
          {/* Status Counts */}
          <div className="flex items-center gap-4 text-[var(--mc-text-xs)]">
            {stats.planned > 0 && (
              <span className="flex items-center gap-1">
                <span className="mc-status-dot warning" />
                <span className="text-[var(--mc-status-warning)]">
                  {stats.planned} planned
                </span>
              </span>
            )}
            <span className="flex items-center gap-1">
              <span className="mc-status-dot active" />
              <span className="text-[var(--mc-text-secondary)]">
                {stats.running} running
              </span>
            </span>
            <span className="flex items-center gap-1">
              <span className="mc-status-dot warning" />
              <span className="text-[var(--mc-text-secondary)]">
                {stats.blocked} blocked
              </span>
            </span>
            <span className="flex items-center gap-1">
              <span className="mc-status-dot muted" />
              <span className="text-[var(--mc-text-secondary)]">
                {stats.queued} queued
              </span>
            </span>
            <span className="flex items-center gap-1">
              <span className="mc-status-dot live" />
              <span className="text-[var(--mc-text-secondary)]">
                {stats.completed} done
              </span>
            </span>
            {stats.failed > 0 && (
              <span className="flex items-center gap-1">
                <span className="mc-status-dot danger" />
                <span className="text-[var(--mc-status-danger)]">
                  {stats.failed} failed
                </span>
              </span>
            )}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Duration */}
          <div className="text-[var(--mc-text-xs)] text-[var(--mc-text-muted)]">
            {formatDuration(parentTask.startedAt)}
          </div>

          {/* Cost */}
          <div className="mc-tile-cost">
            <span className="mc-tile-cost-value">
              {formatCost(stats.totalCostUsd)}
            </span>
          </div>

          {/* Persona */}
          {personaConfig && (
            <div className="flex items-center gap-1 text-[var(--mc-text-xs)] text-[var(--mc-text-muted)]">
              <span>{personaConfig.emoji}</span>
              <span>{personaConfig.shortLabel}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

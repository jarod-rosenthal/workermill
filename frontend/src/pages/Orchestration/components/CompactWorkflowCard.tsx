import { useState, useMemo } from "react";
import {
  ChevronDown,
  ExternalLink,
  GitBranch,
  Terminal,
  Ban,
  RefreshCw,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  GitPullRequest,
} from "lucide-react";
import type { ChildTask } from "../orchestration-store";
import { PERSONA_CONFIGS } from "../../../types/mission-control";

interface CompactWorkflowCardProps {
  story: ChildTask;
  isSelected: boolean;
  isExpanded: boolean;
  onSelect: () => void;
  onToggleExpand: () => void;
  onOpenTerminal: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
}

// Status to progress step mapping
function getProgressSteps(status: ChildTask["status"]): { current: number; total: number } {
  const statusOrder: Record<ChildTask["status"], number> = {
    planned: 0,
    queued: 1,
    claimed: 2,
    environment_setup: 2,
    executing: 3,
    pr_created: 4,
    review_requested: 4,
    blocked: 3,
    completed: 5,
    deployed: 5,
    failed: 3,
    cancelled: 0,
  };
  return { current: statusOrder[status] ?? 0, total: 5 };
}

// Get status info for display
function getStatusInfo(status: ChildTask["status"]): {
  label: string;
  color: string;
  icon: React.ReactNode;
  animate: boolean;
} {
  switch (status) {
    case "planned":
      return {
        label: "Planned",
        color: "text-[var(--mc-text-muted)]",
        icon: <Clock className="w-3 h-3" />,
        animate: false,
      };
    case "queued":
      return {
        label: "Queued",
        color: "text-[var(--mc-text-secondary)]",
        icon: <Clock className="w-3 h-3" />,
        animate: false,
      };
    case "claimed":
    case "environment_setup":
      return {
        label: "Setting Up",
        color: "text-[var(--mc-status-active)]",
        icon: <Loader2 className="w-3 h-3 animate-spin" />,
        animate: true,
      };
    case "executing":
      return {
        label: "Executing",
        color: "text-[var(--mc-status-live)]",
        icon: <Loader2 className="w-3 h-3 animate-spin" />,
        animate: true,
      };
    case "pr_created":
    case "review_requested":
      return {
        label: "PR Created",
        color: "text-[var(--mc-status-info)]",
        icon: <GitPullRequest className="w-3 h-3" />,
        animate: false,
      };
    case "blocked":
      return {
        label: "Blocked",
        color: "text-[var(--mc-status-warning)]",
        icon: <AlertTriangle className="w-3 h-3" />,
        animate: true,
      };
    case "completed":
    case "deployed":
      return {
        label: "Completed",
        color: "text-[var(--mc-status-live)]",
        icon: <CheckCircle className="w-3 h-3" />,
        animate: false,
      };
    case "failed":
    case "cancelled":
      return {
        label: status === "failed" ? "Failed" : "Cancelled",
        color: "text-[var(--mc-status-danger)]",
        icon: <XCircle className="w-3 h-3" />,
        animate: false,
      };
    default:
      return {
        label: status,
        color: "text-[var(--mc-text-muted)]",
        icon: <Clock className="w-3 h-3" />,
        animate: false,
      };
  }
}

// Format duration
function formatDuration(startedAt?: string, completedAt?: string): string {
  if (!startedAt) return "—";
  const endTime = completedAt ? new Date(completedAt).getTime() : Date.now();
  const ms = endTime - new Date(startedAt).getTime();
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

// Format cost
function formatCost(cost: number | string | null | undefined): string {
  if (cost == null || cost === 0) return "—";
  const numCost = typeof cost === "number" ? cost : parseFloat(String(cost));
  if (isNaN(numCost) || numCost === 0) return "—";
  if (numCost < 0.01) return "<$0.01";
  return `$${numCost.toFixed(2)}`;
}

/**
 * CompactWorkflowCard - Condensed workflow display
 * ~80px collapsed, expandable for details
 * Implements progressive disclosure from UX plan
 */
export function CompactWorkflowCard({
  story,
  isSelected,
  isExpanded,
  onSelect,
  onToggleExpand,
  onOpenTerminal,
  onCancel,
  onRetry,
}: CompactWorkflowCardProps) {
  const [showActions, setShowActions] = useState(false);

  const persona = PERSONA_CONFIGS[story.workerPersona];
  const statusInfo = getStatusInfo(story.status);
  const progress = getProgressSteps(story.status);
  const duration = formatDuration(story.startedAt, story.completedAt);
  const cost = formatCost(story.estimatedCostUsd);

  const isRunning = ["executing", "environment_setup", "claimed"].includes(story.status);
  const isBlocked = story.status === "blocked";
  const isFailed = story.status === "failed" || story.status === "cancelled";

  // Progress dots
  const progressDots = useMemo(() => {
    return Array.from({ length: progress.total }, (_, i) => {
      const isDone = i < progress.current;
      const isCurrent = i === progress.current;
      return (
        <span
          key={i}
          className={`mc-workflow-progress-dot ${
            isDone
              ? "done"
              : isCurrent
              ? isBlocked
                ? "blocked"
                : isFailed
                ? "failed"
                : "current"
              : "pending"
          }`}
        />
      );
    });
  }, [progress, isBlocked, isFailed]);

  return (
    <div
      className={`mc-workflow-card ${isSelected ? "selected" : ""} ${isExpanded ? "expanded" : ""} ${isRunning ? "running" : ""} ${isBlocked ? "blocked" : ""} ${isFailed ? "failed" : ""}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Compact Row - Always Visible */}
      <button
        onClick={onSelect}
        className="mc-workflow-card-main"
      >
        {/* Left: Persona + Story Info */}
        <div className="mc-workflow-card-left">
          <span className="mc-workflow-card-persona">{persona?.emoji || "?"}</span>
          <div className="mc-workflow-card-info">
            <div className="mc-workflow-card-title">
              <span className="mc-workflow-card-index">
                {persona?.shortLabel || story.workerPersona}
              </span>
              <span className="mc-workflow-card-jira">{story.jiraIssueKey}</span>
            </div>
            <div className="mc-workflow-card-summary">{story.summary}</div>
          </div>
        </div>

        {/* Center: Progress Dots */}
        <div className="mc-workflow-card-progress">
          {progressDots}
        </div>

        {/* Right: Status + Meta */}
        <div className="mc-workflow-card-right">
          <div className={`mc-workflow-card-status ${statusInfo.color}`}>
            {statusInfo.icon}
            <span>{statusInfo.label}</span>
          </div>
          <div className="mc-workflow-card-meta">
            <span className="mc-workflow-card-duration">{duration}</span>
            <span className="mc-workflow-card-cost">{cost}</span>
          </div>
        </div>

        {/* Expand Toggle */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
          className="mc-workflow-card-expand"
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
        </button>
      </button>

      {/* Quick Actions - Show on Hover */}
      {showActions && !isExpanded && (
        <div className="mc-workflow-card-actions">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenTerminal();
            }}
            className="mc-workflow-action-btn"
            title="View Terminal"
          >
            <Terminal className="w-3 h-3" />
          </button>
          {story.githubPrUrl && (
            <a
              href={story.githubPrUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mc-workflow-action-btn"
              title="View PR"
              onClick={(e) => e.stopPropagation()}
            >
              <GitBranch className="w-3 h-3" />
            </a>
          )}
          {isFailed && onRetry && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRetry();
              }}
              className="mc-workflow-action-btn warning"
              title="Retry"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          )}
          {isRunning && onCancel && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCancel();
              }}
              className="mc-workflow-action-btn danger"
              title="Cancel"
            >
              <Ban className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* Expanded Details */}
      {isExpanded && (
        <div className="mc-workflow-card-details">
          {/* Progress Bar */}
          <div className="mc-workflow-detail-section">
            <div className="mc-workflow-progress-bar">
              <div
                className={`mc-workflow-progress-fill ${isBlocked ? "blocked" : isFailed ? "failed" : ""}`}
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
            <div className="mc-workflow-progress-labels">
              <span>Queued</span>
              <span>Setup</span>
              <span>Execute</span>
              <span>PR</span>
              <span>Complete</span>
            </div>
          </div>

          {/* Current File */}
          {isRunning && story.currentFile && (
            <div className="mc-workflow-detail-row">
              <span className="mc-workflow-detail-label">Current File:</span>
              <span className="mc-workflow-detail-value mono">{story.currentFile}</span>
            </div>
          )}

          {/* Blocked Reason */}
          {isBlocked && story.blockedReason && (
            <div className="mc-workflow-detail-row warning">
              <AlertTriangle className="w-3 h-3" />
              <span>{story.blockedReason}</span>
            </div>
          )}

          {/* Dependencies */}
          {story.storyDependencies && story.storyDependencies.length > 0 && (
            <div className="mc-workflow-detail-row">
              <span className="mc-workflow-detail-label">Dependencies:</span>
              <span className="mc-workflow-detail-value">
                Stories {story.storyDependencies.join(", ")}
              </span>
            </div>
          )}

          {/* Branch */}
          {story.branchName && (
            <div className="mc-workflow-detail-row">
              <GitBranch className="w-3 h-3" />
              <span className="mc-workflow-detail-value mono">{story.branchName}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="mc-workflow-detail-actions">
            <button onClick={onOpenTerminal} className="mc-btn mc-btn-secondary">
              <Terminal className="w-3 h-3" />
              Terminal
            </button>
            {story.githubPrUrl && (
              <a
                href={story.githubPrUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mc-btn mc-btn-secondary"
              >
                <ExternalLink className="w-3 h-3" />
                PR #{story.githubPrNumber}
              </a>
            )}
            <a
              href={`https://oncallshift.atlassian.net/browse/${story.jiraIssueKey}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mc-btn mc-btn-secondary"
            >
              <ExternalLink className="w-3 h-3" />
              Jira
            </a>
            <div className="flex-1" />
            {isFailed && onRetry && (
              <button onClick={onRetry} className="mc-btn mc-btn-primary">
                <RefreshCw className="w-3 h-3" />
                Retry
              </button>
            )}
            {isRunning && onCancel && (
              <button onClick={onCancel} className="mc-btn mc-btn-danger">
                <Ban className="w-3 h-3" />
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import { ExternalLink, GitBranch, AlertTriangle, Clock } from "lucide-react";
import type { ChildTask } from "../orchestration-store";
import { PERSONA_CONFIGS } from "../../../types/mission-control";
import { StoryTerminal } from "./StoryTerminal";

interface StoryLaneProps {
  story: ChildTask;
  isExpanded: boolean;
  onToggle: () => void;
}

// Get status indicator character matching mockup
function getStatusIndicator(status: ChildTask["status"]): string {
  switch (status) {
    case "completed":
    case "deployed":
      return "✓";
    case "executing":
    case "environment_setup":
      return "●";
    case "claimed":
      return "◐";
    case "queued":
      return "○";
    case "planned":
      return "◇"; // Diamond outline for planned stories
    case "blocked":
      return "⊘";
    case "failed":
    case "cancelled":
      return "✗";
    case "pr_created":
    case "review_requested":
      return "◉";
    default:
      return "○";
  }
}

// Get status color class
function getStatusColorClass(status: ChildTask["status"]): string {
  switch (status) {
    case "completed":
    case "deployed":
      return "text-[var(--mc-status-live)]";
    case "executing":
    case "environment_setup":
      return "text-[var(--mc-status-active)]";
    case "claimed":
      return "text-[var(--mc-status-info)]";
    case "pr_created":
    case "review_requested":
      return "text-[var(--mc-status-info)]";
    case "planned":
      return "text-[var(--mc-status-warning)]"; // Yellow/amber for pending approval
    case "blocked":
    case "failed":
    case "cancelled":
      return "text-[var(--mc-status-danger)]";
    default:
      return "text-[var(--mc-text-muted)]";
  }
}

// Format duration from startedAt to now or completedAt
function formatDuration(startedAt?: string, completedAt?: string): string {
  if (!startedAt) return "—";
  const endTime = completedAt ? new Date(completedAt).getTime() : Date.now();
  const ms = endTime - new Date(startedAt).getTime();
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

// Format cost
function formatCost(cost: number | null | undefined): string {
  if (cost == null || cost === 0) return "—";
  const numCost = typeof cost === "number" ? cost : parseFloat(String(cost));
  if (isNaN(numCost)) return "—";
  if (numCost < 0.01) return "<$0.01";
  return `$${numCost.toFixed(2)}`;
}

export function StoryLane({ story, isExpanded, onToggle }: StoryLaneProps) {
  const personaConfig = PERSONA_CONFIGS[story.workerPersona];
  const duration = formatDuration(story.startedAt, story.completedAt);
  const cost = formatCost(story.estimatedCostUsd);
  const statusIndicator = getStatusIndicator(story.status);
  const statusColorClass = getStatusColorClass(story.status);

  // Determine if story is running (show animation)
  const isRunning = ["executing", "environment_setup"].includes(story.status);
  const isBlocked = story.status === "blocked";
  const isFailed = story.status === "failed";
  const isCompleted = ["completed", "deployed"].includes(story.status);

  // Get story index for display
  const storyIndex = story.storyIndex ?? 1;

  // Format dependencies text
  const dependenciesText =
    story.storyDependencies && story.storyDependencies.length > 0
      ? `Needs: ${story.storyDependencies.join(", ")}`
      : null;

  return (
    <div
      className={`mc-tile transition-all duration-200 ${isExpanded ? "ring-1 ring-[var(--mc-status-active)]" : ""} ${isBlocked ? "border-[var(--mc-status-danger)]" : ""} ${isFailed ? "opacity-70" : ""}`}
    >
      {/* Compact Row - Always visible */}
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 hover:bg-[var(--mc-bg-hover)] transition-colors"
      >
        <div className="flex items-center gap-3">
          {/* Status Indicator */}
          <span className={`text-lg font-bold ${statusColorClass} ${isRunning ? "animate-pulse" : ""}`}>
            {statusIndicator}
          </span>

          {/* Story Number & Title */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[var(--mc-text-sm)] font-semibold text-[var(--mc-text-primary)]">
                Story {storyIndex}:
              </span>
              <span className="text-[var(--mc-text-sm)] text-[var(--mc-text-secondary)] truncate">
                {story.summary}
              </span>
            </div>

            {/* Second line: Persona + Current File or Dependencies */}
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[var(--mc-text-xs)] text-[var(--mc-text-muted)]">
                └─ {personaConfig?.emoji || "?"} {personaConfig?.shortLabel || story.workerPersona}
              </span>

              {/* Show current file if running */}
              {isRunning && story.currentFile && (
                <span className="text-[var(--mc-text-xs)] text-[var(--mc-terminal-text)]">
                  ▸ {story.currentFile}
                </span>
              )}

              {/* Show dependencies if waiting */}
              {dependenciesText && !isCompleted && !isRunning && (
                <span className="flex items-center gap-1 text-[var(--mc-text-xs)] text-[var(--mc-status-warning)]">
                  <Clock className="w-3 h-3" />
                  {dependenciesText}
                </span>
              )}

              {/* Show blocked reason */}
              {isBlocked && story.blockedReason && (
                <span className="flex items-center gap-1 text-[var(--mc-text-xs)] text-[var(--mc-status-danger)]">
                  <AlertTriangle className="w-3 h-3" />
                  {story.blockedReason}
                </span>
              )}
            </div>
          </div>

          {/* Right side: Cost, Duration, PR link */}
          <div className="flex items-center gap-4 flex-shrink-0">
            {/* Cost */}
            <span className="text-[var(--mc-text-xs)] font-mono text-[var(--mc-text-secondary)] min-w-[50px] text-right">
              {cost}
            </span>

            {/* Duration */}
            <span className="text-[var(--mc-text-xs)] font-mono text-[var(--mc-text-muted)] min-w-[40px] text-right">
              {duration}
            </span>

            {/* PR Link (if available) */}
            {story.githubPrUrl && (
              <a
                href={story.githubPrUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[var(--mc-text-xs)] text-[var(--mc-status-active)] hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                PR #{story.githubPrNumber}
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      </button>

      {/* Expanded Content - Inline Terminal */}
      {isExpanded && (
        <div className="border-t border-[var(--mc-border-subtle)]">
          {/* Info Row */}
          <div className="flex items-center gap-4 px-4 py-2 bg-[var(--mc-bg-surface)] text-[var(--mc-text-xs)]">
            {/* Jira Key */}
            <span className="font-mono text-[var(--mc-status-active)]">
              {story.jiraIssueKey}
            </span>

            {/* Branch */}
            {story.branchName && (
              <span className="flex items-center gap-1 text-[var(--mc-text-muted)]">
                <GitBranch className="w-3 h-3" />
                {story.branchName}
              </span>
            )}

            {/* Model */}
            <span className="text-[var(--mc-text-muted)]">
              {story.workerModel}
            </span>

            <div className="flex-1" />

            {/* Dependencies list */}
            {story.dependencies && story.dependencies.length > 0 && (
              <span className="text-[var(--mc-text-muted)]">
                Depends on: {story.dependencies.join(", ")}
              </span>
            )}
          </div>

          {/* Terminal */}
          <StoryTerminal lines={story.terminalLines} isExpanded={isExpanded} />
        </div>
      )}
    </div>
  );
}

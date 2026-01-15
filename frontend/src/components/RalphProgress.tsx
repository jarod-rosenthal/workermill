/**
 * RalphProgress Component
 *
 * Displays progress for Ralph multi-story task execution.
 * Shows a progress bar with story count and current story description.
 */

import { Layers, Zap } from "lucide-react";

export interface RalphProgressData {
  currentStory: number;
  totalStories: number;
  currentStoryDescription: string;
  completedStories?: number;
  status?: "planning" | "executing" | "completed" | "failed" | "unknown";
}

interface RalphProgressProps {
  progress: RalphProgressData;
  className?: string;
}

export function RalphProgress({ progress, className = "" }: RalphProgressProps) {
  const { currentStory, totalStories, currentStoryDescription, completedStories, status } = progress;

  // Calculate percentage based on completed stories if available, otherwise current story
  const effectiveCompleted = completedStories ?? (currentStory > 0 ? currentStory - 1 : 0);
  const percent = totalStories > 0 ? Math.round((effectiveCompleted / totalStories) * 100) : 0;

  // Determine status color
  const statusColor = status === "completed"
    ? "text-green-500"
    : status === "failed"
      ? "text-red-500"
      : status === "planning"
        ? "text-yellow-500"
        : "text-blue-500";

  const progressBarColor = status === "completed"
    ? "bg-green-500"
    : status === "failed"
      ? "bg-red-500"
      : "bg-blue-500";

  return (
    <div className={`rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-blue-500" />
          <span className="text-sm font-medium text-blue-500">Ralph Execution</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full bg-current/10 ${statusColor}`}>
            {status || "executing"}
          </span>
          <span className="text-xs text-muted-foreground">
            {percent}% complete
          </span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="relative w-full h-2 bg-muted rounded-full overflow-hidden mb-2">
        <div
          className={`absolute left-0 top-0 h-full ${progressBarColor} transition-all duration-500 ease-out`}
          style={{ width: `${percent}%` }}
        />
        {/* Active story indicator (animated section) */}
        {status === "executing" && currentStory <= totalStories && (
          <div
            className={`absolute top-0 h-full bg-blue-400/50 animate-pulse`}
            style={{
              left: `${percent}%`,
              width: `${Math.round(100 / totalStories)}%`,
            }}
          />
        )}
      </div>

      {/* Story Counter and Description */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Zap className="w-3 h-3 text-yellow-500 flex-shrink-0" />
          <span className="text-sm font-medium text-foreground truncate">
            Story {currentStory}/{totalStories}
          </span>
        </div>
        <span className="text-xs text-muted-foreground truncate max-w-[60%] text-right" title={currentStoryDescription}>
          {currentStoryDescription || "Processing..."}
        </span>
      </div>
    </div>
  );
}

/**
 * Compact version for inline display
 */
export function RalphProgressCompact({ progress }: { progress: RalphProgressData }) {
  const { currentStory, totalStories, completedStories, status } = progress;
  const effectiveCompleted = completedStories ?? (currentStory > 0 ? currentStory - 1 : 0);
  const percent = totalStories > 0 ? Math.round((effectiveCompleted / totalStories) * 100) : 0;

  const statusIcon = status === "completed"
    ? "text-green-500"
    : status === "failed"
      ? "text-red-500"
      : "text-blue-500";

  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded bg-blue-500/10 border border-blue-500/30">
      <Layers className={`w-3 h-3 ${statusIcon}`} />
      <span className="text-xs font-medium text-blue-500">
        {currentStory}/{totalStories}
      </span>
      <span className="text-xs text-muted-foreground">
        ({percent}%)
      </span>
    </div>
  );
}

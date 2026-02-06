/**
 * PlanningProgress Component
 *
 * Displays an animated progress indicator for the planning agent.
 * Receives real-time updates via SSE planning_progress events (in-memory, not persisted).
 */

import { Search, Brain, FileCode, CheckCircle, Loader } from "lucide-react";

export type PlanningPhase =
  | "initializing"
  | "reading_repo"
  | "analyzing"
  | "generating_plan"
  | "validating"
  | "complete";

export interface PlanningProgressData {
  phase: PlanningPhase;
  elapsedSeconds: number;
  detail: string;
  charsGenerated: number;
  toolCallCount: number;
}

interface PlanningProgressProps {
  progress: PlanningProgressData;
  className?: string;
}

const PHASE_CONFIG: Record<
  PlanningPhase,
  { icon: typeof Loader; label: string; percent: number }
> = {
  initializing: { icon: Loader, label: "Initializing...", percent: 5 },
  reading_repo: { icon: Search, label: "Reading repository...", percent: 20 },
  analyzing: { icon: Brain, label: "Analyzing requirements...", percent: 40 },
  generating_plan: { icon: FileCode, label: "Generating execution plan...", percent: 65 },
  validating: { icon: CheckCircle, label: "Validating plan...", percent: 90 },
  complete: { icon: CheckCircle, label: "Planning complete", percent: 100 },
};

function computePercent(progress: PlanningProgressData): number {
  const config = PHASE_CONFIG[progress.phase];
  if (!config) return 0;

  // For generating_plan, scale from 50% to 85% based on chars generated
  if (progress.phase === "generating_plan") {
    // Typical plan is 3000-8000 chars; scale linearly within the band
    const charProgress = Math.min(progress.charsGenerated / 6000, 1);
    return Math.round(50 + charProgress * 35);
  }

  // For reading_repo, scale from 15% to 30% based on tool calls
  if (progress.phase === "reading_repo") {
    const toolProgress = Math.min(progress.toolCallCount / 10, 1);
    return Math.round(15 + toolProgress * 15);
  }

  return config.percent;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

export function PlanningProgress({ progress, className = "" }: PlanningProgressProps) {
  const config = PHASE_CONFIG[progress.phase] || PHASE_CONFIG.initializing;
  const PhaseIcon = config.icon;
  const percent = computePercent(progress);
  const isComplete = progress.phase === "complete";
  const isActive = !isComplete;

  return (
    <div className={`rounded-lg border border-teal-500/30 bg-teal-500/10 p-3 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-teal-500" />
          <span className="text-sm font-medium text-teal-500">Planning Agent</span>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatElapsed(progress.elapsedSeconds)}
        </span>
      </div>

      {/* Progress Bar */}
      <div className="relative w-full h-2 bg-muted rounded-full overflow-hidden mb-2">
        <div
          className={`absolute left-0 top-0 h-full rounded-full transition-all duration-700 ease-out ${
            isComplete ? "bg-green-500" : "bg-teal-500"
          }`}
          style={{ width: `${percent}%` }}
        />
        {/* Pulse on leading edge */}
        {isActive && (
          <div
            className="absolute top-0 h-full w-3 bg-teal-400/60 rounded-full animate-pulse"
            style={{ left: `calc(${percent}% - 6px)` }}
          />
        )}
      </div>

      {/* Phase detail and percentage */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <PhaseIcon
            className={`w-3.5 h-3.5 flex-shrink-0 ${
              isComplete ? "text-green-500" : "text-teal-500"
            } ${progress.phase === "initializing" ? "animate-spin" : ""}`}
            style={progress.phase === "initializing" ? { animationDuration: "1.5s" } : undefined}
          />
          <span className="text-sm text-foreground truncate">{progress.detail}</span>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">
          {percent}%
        </span>
      </div>
    </div>
  );
}

/**
 * Compact variant for task header badges.
 */
export function PlanningProgressCompact({ progress }: { progress: PlanningProgressData }) {
  const percent = computePercent(progress);
  const isComplete = progress.phase === "complete";
  const color = isComplete ? "text-green-500" : "text-teal-500";
  const borderColor = isComplete
    ? "border-green-500/30 bg-green-500/10"
    : "border-teal-500/30 bg-teal-500/10";

  return (
    <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border ${borderColor}`}>
      <Brain className={`w-3 h-3 ${color}`} />
      <span className={`text-xs font-medium ${color}`}>
        {percent}%
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {formatElapsed(progress.elapsedSeconds)}
      </span>
    </div>
  );
}

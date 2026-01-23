/**
 * PipelineV2Panel Component
 *
 * Container component that combines PipelineProgress, ContextSidecar, and
 * CommitTimeline for Pipeline V2 tasks. Only renders when task.pipelineVersion === 'v2'.
 *
 * Layout:
 * - Top: Pipeline progress with step indicators
 * - Middle: Context sidecar (collapsible constraints)
 * - Bottom: Commit timeline with git history
 */

import { useState } from "react";
import {
  Workflow,
  ChevronDown,
  ChevronUp,
  Brain,
  Clock,
  Target,
  AlertTriangle,
} from "lucide-react";
import { PipelineProgress, PipelineProgressCompact } from "./PipelineProgress";
import { ContextSidecar, ContextSidecarBadge } from "./ContextSidecar";
import { CommitTimeline, CommitTimelineBadge } from "./CommitTimeline";
import type {
  ExecutionPlanV2,
  PlannedStepV2,
  StepCommit,
} from "../types/pipeline-v2";
import { calculateProgress, formatDuration } from "../types/pipeline-v2";

/**
 * WorkerTask interface subset for V2 pipeline fields
 * This represents the relevant fields from the full WorkerTask type
 */
interface WorkerTaskV2Fields {
  id: string;
  status: string;
  pipelineVersion?: "v1" | "v2" | null;
  executionPlanV2?: ExecutionPlanV2 | null;
  currentStepIndex?: number;
  contextSidecar?: string[];
  commitHistory?: StepCommit[];
  githubRepo?: string;
  startedAt?: string;
  elapsedSeconds?: number;
}

interface PipelineV2PanelProps {
  task: WorkerTaskV2Fields;
  className?: string;
  defaultExpanded?: boolean;
}

/**
 * Plan summary showing tech stack and critic score
 */
function PlanSummary({ plan }: { plan: ExecutionPlanV2 }) {
  const { techStack, criticScore, criticRisks, metadata } = plan;

  return (
    <div className="p-3 rounded-lg border border-border/30 bg-muted/20">
      {/* Tech Stack */}
      <div className="flex items-center gap-2 mb-2">
        <Brain className="w-4 h-4 text-purple-500" />
        <span className="text-sm font-medium text-foreground">Plan Summary</span>
      </div>

      {/* Stack badges */}
      <div className="flex flex-wrap gap-2 mb-3">
        {techStack.language && (
          <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
            {techStack.language}
          </span>
        )}
        {techStack.framework && (
          <span className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400 border border-green-500/30">
            {techStack.framework}
          </span>
        )}
        {techStack.database && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
            {techStack.database}
          </span>
        )}
        {techStack.testing && (
          <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30">
            {techStack.testing}
          </span>
        )}
      </div>

      {/* Architecture summary */}
      <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
        {plan.architecturalSummary}
      </p>

      {/* Critic score and metadata */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          {criticScore !== undefined && (
            <div className="flex items-center gap-1">
              <Target className="w-3 h-3 text-blue-500" />
              <span className="text-muted-foreground">
                Critic: <span className="text-foreground font-medium">{criticScore}%</span>
              </span>
            </div>
          )}
          {metadata?.planningDurationMs && (
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3 text-muted-foreground" />
              <span className="text-muted-foreground">
                {formatDuration(metadata.planningDurationMs)} planning
              </span>
            </div>
          )}
        </div>

        {/* Risks indicator */}
        {criticRisks && criticRisks.length > 0 && (
          <div className="flex items-center gap-1 text-amber-500">
            <AlertTriangle className="w-3 h-3" />
            <span>{criticRisks.length} risk{criticRisks.length !== 1 ? "s" : ""}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function PipelineV2Panel({
  task,
  className = "",
  defaultExpanded = true,
}: PipelineV2PanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // Only render for V2 pipeline tasks
  if (task.pipelineVersion !== "v2") {
    return null;
  }

  const plan = task.executionPlanV2;
  const steps: PlannedStepV2[] = plan?.steps || [];
  const currentIndex = task.currentStepIndex || 0;
  const contextSidecar = task.contextSidecar || [];
  const commitHistory = task.commitHistory || [];

  // Calculate progress
  const progressPercent = steps.length > 0
    ? calculateProgress(commitHistory.length, steps.length)
    : 0;

  // Status display
  const isPlanning = task.status === "planning" || (!plan && task.status === "executing");
  const isComplete = task.status === "completed" || task.status === "deployed";
  const isFailed = task.status === "failed";

  return (
    <div className={`rounded-lg border border-purple-500/30 bg-purple-500/5 overflow-hidden ${className}`}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-purple-500/10 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Workflow className="w-4 h-4 text-purple-500" />
          <span className="text-sm font-semibold text-purple-500">Pipeline V2</span>

          {/* Status badge */}
          {isPlanning ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
              Planning
            </span>
          ) : isComplete ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30">
              Complete
            </span>
          ) : isFailed ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">
              Failed
            </span>
          ) : (
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
              Executing
            </span>
          )}

          {/* Progress indicator */}
          {steps.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {progressPercent}% ({commitHistory.length}/{steps.length})
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Compact badges when collapsed */}
          {!isExpanded && (
            <>
              <ContextSidecarBadge constraints={contextSidecar} />
              <CommitTimelineBadge commits={commitHistory} githubRepo={task.githubRepo} />
            </>
          )}

          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-purple-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-purple-500" />
          )}
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="p-3 pt-0 space-y-3">
          {/* Plan summary (if available) */}
          {plan && <PlanSummary plan={plan} />}

          {/* Pipeline progress */}
          {steps.length > 0 && (
            <PipelineProgress
              steps={steps}
              currentIndex={currentIndex}
              commitHistory={commitHistory}
              taskStatus={task.status}
            />
          )}

          {/* Planning in progress indicator */}
          {isPlanning && !plan && (
            <div className="p-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10">
              <div className="flex items-center gap-2 mb-2">
                <Brain className="w-4 h-4 text-yellow-500 animate-pulse" />
                <span className="text-sm font-medium text-yellow-500">
                  Generating execution plan...
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                The Planner Agent is analyzing the PRD and creating an execution plan.
                This includes tech stack selection, step decomposition, and Critic Agent validation.
              </p>
            </div>
          )}

          {/* Context sidecar */}
          {contextSidecar.length > 0 && (
            <ContextSidecar constraints={contextSidecar} />
          )}

          {/* Commit timeline */}
          {commitHistory.length > 0 && (
            <CommitTimeline
              commits={commitHistory}
              steps={steps}
              githubRepo={task.githubRepo}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Compact version for use in task lists
 */
export function PipelineV2Badge({ task }: { task: WorkerTaskV2Fields }) {
  if (task.pipelineVersion !== "v2") {
    return null;
  }

  const steps = task.executionPlanV2?.steps || [];
  const commitHistory = task.commitHistory || [];
  const contextSidecar = task.contextSidecar || [];

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 px-2 py-1 rounded bg-purple-500/10 border border-purple-500/30">
        <Workflow className="w-3 h-3 text-purple-500" />
        <span className="text-xs font-medium text-purple-500">V2</span>
      </div>

      {steps.length > 0 && (
        <PipelineProgressCompact
          steps={steps}
          currentIndex={task.currentStepIndex || 0}
          commitHistory={commitHistory}
          taskStatus={task.status}
        />
      )}

      <ContextSidecarBadge constraints={contextSidecar} />
    </div>
  );
}

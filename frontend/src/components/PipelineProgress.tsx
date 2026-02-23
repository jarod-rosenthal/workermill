/**
 * PipelineProgress Component
 *
 * Horizontal step indicator showing all steps in a V2 pipeline.
 * Displays current step highlighted, completed steps with checkmarks,
 * and failed steps with X. Steps are clickable to show details.
 */

import { useState } from "react";
import {
  Check,
  X,
  Circle,
  Loader2,
  ChevronDown,
  ChevronUp,
  FileCode,
  Target,
} from "lucide-react";
import type {
  PlannedStepV2,
  StepCommit,
  StepStatus,
} from "../types/pipeline-v2";
import {
  getStepStatus,
  getStatusBgColor,
  formatDuration,
  truncateCommitHash,
  getComplexityLabel,
  getComplexityColor,
  countUniqueCompletedSteps,
  VERIFICATION_COLORS,
} from "../types/pipeline-v2";
import { PERSONA_CONFIGS } from "../types/mission-control";

interface PipelineProgressProps {
  steps: PlannedStepV2[];
  currentIndex: number;
  commitHistory: StepCommit[];
  taskStatus?: string;
  className?: string;
}

/**
 * Get icon for step status
 */
function StepIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "completed":
      return <Check className="w-3 h-3" />;
    case "in-progress":
      return <Loader2 className="w-3 h-3 animate-spin" />;
    case "failed":
      return <X className="w-3 h-3" />;
    case "pending":
    default:
      return <Circle className="w-3 h-3" />;
  }
}

/**
 * Get background color for step indicator
 */
function getStepBgColor(status: StepStatus): string {
  switch (status) {
    case "completed":
      return "bg-green-500 text-white";
    case "in-progress":
      return "bg-blue-500 text-white";
    case "failed":
      return "bg-red-500 text-white";
    case "pending":
    default:
      return "bg-gray-500/30 text-gray-400";
  }
}

/**
 * Get connector line color
 */
function getConnectorColor(prevStatus: StepStatus): string {
  switch (prevStatus) {
    case "completed":
      return "bg-green-500";
    case "failed":
      return "bg-red-500";
    default:
      return "bg-gray-500/30";
  }
}

/**
 * Step detail panel shown when a step is selected
 */
function StepDetail({
  step,
  commit,
  status,
}: {
  step: PlannedStepV2;
  commit?: StepCommit;
  status: StepStatus;
}) {
  const personaConfig = PERSONA_CONFIGS[step.persona];
  const verificationColor = VERIFICATION_COLORS[step.verificationType];
  const complexityColor = getComplexityColor(step.estimatedComplexity);

  return (
    <div className={`mt-3 p-3 rounded-lg border ${getStatusBgColor(status)}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{personaConfig?.emoji || "?"}</span>
          <div>
            <h4 className="font-medium text-foreground">{step.title}</h4>
            <span className="text-xs text-muted-foreground">
              {personaConfig?.label || step.persona}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Complexity */}
          <span className={`text-xs px-2 py-0.5 rounded-full border ${complexityColor} border-current/30`}>
            {getComplexityLabel(step.estimatedComplexity)}
          </span>
          {/* Verification type */}
          <span className={`text-xs px-2 py-0.5 rounded-full border ${verificationColor} border-current/30`}>
            {step.verificationType}
          </span>
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-muted-foreground mb-3">{step.description}</p>

      {/* Target files */}
      {step.targetFiles.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
            <FileCode className="w-3 h-3" />
            <span>Target files:</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {step.targetFiles.map((file, i) => (
              <code
                key={i}
                className="text-xs px-1.5 py-0.5 rounded bg-muted/50 text-cyan-400"
              >
                {file}
              </code>
            ))}
          </div>
        </div>
      )}

      {/* Verification instructions */}
      <div className="mb-3">
        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
          <Target className="w-3 h-3" />
          <span>Verification:</span>
        </div>
        <p className="text-xs text-muted-foreground bg-muted/30 rounded p-2">
          {step.verificationInstructions}
        </p>
      </div>

      {/* Commit info (if completed) */}
      {commit && (
        <div className="pt-2 border-t border-border/30">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Committed at {new Date(commit.committedAt).toLocaleTimeString()}
            </span>
            <div className="flex items-center gap-2">
              <code className="px-1.5 py-0.5 rounded bg-muted/50 text-green-400">
                {truncateCommitHash(commit.commitHash)}
              </code>
              {commit.durationMs && (
                <span className="text-muted-foreground">
                  {formatDuration(commit.durationMs)}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function PipelineProgress({
  steps,
  currentIndex,
  commitHistory,
  taskStatus,
  className = "",
}: PipelineProgressProps) {
  const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  if (steps.length === 0) {
    return null;
  }

  const completedCount = countUniqueCompletedSteps(commitHistory);
  const totalSteps = steps.length;
  const progressPercent = Math.min(100, Math.round((completedCount / totalSteps) * 100));

  const selectedStep = selectedStepIndex !== null ? steps[selectedStepIndex] : null;
  const selectedCommit = selectedStepIndex !== null
    ? commitHistory.find((c) => c.stepIndex === selectedStepIndex)
    : undefined;
  const selectedStatus = selectedStepIndex !== null
    ? getStepStatus(selectedStepIndex, currentIndex, commitHistory, taskStatus)
    : "pending";

  return (
    <div className={`rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-blue-500" />
          <span className="text-sm font-medium text-blue-500">Pipeline V2</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">
            {completedCount}/{totalSteps} steps
          </span>
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="w-3 h-3" />
              Collapse
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" />
              Details
            </>
          )}
        </button>
      </div>

      {/* Progress bar */}
      <div className="relative w-full h-2 bg-muted rounded-full overflow-hidden mb-3">
        <div
          className="absolute left-0 top-0 h-full bg-green-500 transition-all duration-500 ease-out"
          style={{ width: `${progressPercent}%` }}
        />
        {/* Active step indicator */}
        {taskStatus !== "failed" && currentIndex < totalSteps && (
          <div
            className="absolute top-0 h-full bg-blue-500/50 animate-pulse"
            style={{
              left: `${progressPercent}%`,
              width: `${Math.round(100 / totalSteps)}%`,
            }}
          />
        )}
      </div>

      {/* Step indicators */}
      <div className="flex items-center justify-between gap-1 overflow-x-auto pb-1">
        {steps.map((step, index) => {
          const status = getStepStatus(index, currentIndex, commitHistory, taskStatus);
          const isSelected = selectedStepIndex === index;

          return (
            <div key={index} className="flex items-center">
              {/* Connector line (not for first step) */}
              {index > 0 && (
                <div
                  className={`h-0.5 w-4 ${getConnectorColor(
                    getStepStatus(index - 1, currentIndex, commitHistory, taskStatus)
                  )}`}
                />
              )}

              {/* Step indicator */}
              <button
                onClick={() =>
                  setSelectedStepIndex(isSelected ? null : index)
                }
                className={`
                  flex items-center justify-center w-6 h-6 rounded-full
                  transition-all duration-200
                  ${getStepBgColor(status)}
                  ${isSelected ? "ring-2 ring-offset-2 ring-offset-background ring-primary" : ""}
                  hover:scale-110
                `}
                title={`Step ${index + 1}: ${step.title}`}
              >
                <StepIcon status={status} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Expanded: Show all steps */}
      {isExpanded && (
        <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
          {steps.map((step, index) => {
            const status = getStepStatus(index, currentIndex, commitHistory, taskStatus);
            const commit = commitHistory.find((c) => c.stepIndex === index);
            const personaConfig = PERSONA_CONFIGS[step.persona];

            return (
              <div
                key={index}
                className={`
                  p-2 rounded border cursor-pointer transition-colors
                  ${getStatusBgColor(status)}
                  hover:bg-muted/40
                `}
                onClick={() =>
                  setSelectedStepIndex(selectedStepIndex === index ? null : index)
                }
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center ${getStepBgColor(status)}`}>
                      <StepIcon status={status} />
                    </div>
                    <span className="text-sm font-medium text-foreground">
                      {index + 1}. {step.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {personaConfig?.emoji} {personaConfig?.shortLabel}
                    </span>
                    {commit && (
                      <code className="text-xs px-1 py-0.5 rounded bg-green-500/20 text-green-400">
                        {truncateCommitHash(commit.commitHash)}
                      </code>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Selected step detail */}
      {selectedStep && !isExpanded && (
        <StepDetail
          step={selectedStep}
          commit={selectedCommit}
          status={selectedStatus}
        />
      )}
    </div>
  );
}

/**
 * Compact version for inline display
 */
export function PipelineProgressCompact({
  steps,
  currentIndex,
  commitHistory,
  taskStatus,
}: {
  steps: PlannedStepV2[];
  currentIndex: number;
  commitHistory: StepCommit[];
  taskStatus?: string;
}) {
  const completedCount = countUniqueCompletedSteps(commitHistory);
  const totalSteps = steps.length;

  const statusColor =
    taskStatus === "failed"
      ? "text-red-500"
      : completedCount === totalSteps
        ? "text-green-500"
        : "text-blue-500";

  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded bg-blue-500/10 border border-blue-500/30">
      <Target className={`w-3 h-3 ${statusColor}`} />
      <span className="text-xs font-medium text-blue-500">
        {completedCount}/{totalSteps}
      </span>
      <div className="flex items-center gap-0.5">
        {steps.slice(0, 6).map((_, index) => {
          const status = getStepStatus(index, currentIndex, commitHistory, taskStatus);
          return (
            <div
              key={index}
              className={`w-2 h-2 rounded-full ${
                status === "completed"
                  ? "bg-green-500"
                  : status === "in-progress"
                    ? "bg-blue-500 animate-pulse"
                    : status === "failed"
                      ? "bg-red-500"
                      : "bg-gray-500/30"
              }`}
            />
          );
        })}
        {steps.length > 6 && (
          <span className="text-xs text-muted-foreground ml-1">
            +{steps.length - 6}
          </span>
        )}
      </div>
    </div>
  );
}

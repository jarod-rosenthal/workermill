/**
 * CommitTimeline Component
 *
 * Vertical timeline of commits for Pipeline V2.
 * Shows step title, persona, commit hash, and timestamp.
 * Provides a history view of successful step completions.
 */

import { useState } from "react";
import {
  GitCommit,
  ChevronDown,
  ChevronUp,
  Clock,
  Timer,
  ExternalLink,
} from "lucide-react";
import type { StepCommit, PlannedStepV2 } from "../types/pipeline-v2";
import { formatDuration, truncateCommitHash, formatTime } from "../types/pipeline-v2";
import { PERSONA_CONFIGS } from "../types/mission-control";

interface CommitTimelineProps {
  commits: StepCommit[];
  steps?: PlannedStepV2[];
  githubRepo?: string;
  className?: string;
}

/**
 * Single commit entry in the timeline
 */
function CommitEntry({
  commit,
  step,
  isLast,
  githubRepo,
}: {
  commit: StepCommit;
  step?: PlannedStepV2;
  isLast: boolean;
  githubRepo?: string;
}) {
  const personaConfig = PERSONA_CONFIGS[commit.persona];
  const commitUrl = githubRepo
    ? `https://github.com/${githubRepo}/commit/${commit.commitHash}`
    : null;

  return (
    <div className="relative flex gap-3">
      {/* Timeline line */}
      {!isLast && (
        <div className="absolute left-[11px] top-6 bottom-0 w-0.5 bg-green-500/30" />
      )}

      {/* Commit dot */}
      <div className="relative z-10 flex-shrink-0 w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
        <GitCommit className="w-3 h-3 text-white" />
      </div>

      {/* Commit content */}
      <div className="flex-1 pb-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">{personaConfig?.emoji || "?"}</span>
            <span className="text-sm font-medium text-foreground">
              {step?.title || `Step ${commit.stepIndex + 1}`}
            </span>
          </div>

          {/* Commit hash with link */}
          {commitUrl ? (
            <a
              href={commitUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors"
            >
              <code>{truncateCommitHash(commit.commitHash)}</code>
              <ExternalLink className="w-3 h-3" />
            </a>
          ) : (
            <code className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400">
              {truncateCommitHash(commit.commitHash)}
            </code>
          )}
        </div>

        {/* Meta info */}
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            <span>{formatTime(commit.committedAt)}</span>
          </div>

          {commit.durationMs && (
            <div className="flex items-center gap-1">
              <Timer className="w-3 h-3" />
              <span>{formatDuration(commit.durationMs)}</span>
            </div>
          )}

          <span className="text-muted-foreground/60">
            {personaConfig?.shortLabel || commit.persona}
          </span>
        </div>

        {/* Step description (if available) */}
        {step?.description && (
          <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
            {step.description}
          </p>
        )}
      </div>
    </div>
  );
}

export function CommitTimeline({
  commits,
  steps,
  githubRepo,
  className = "",
}: CommitTimelineProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);

  if (commits.length === 0) {
    return null;
  }

  // Sort commits by timestamp (newest first)
  const sortedCommits = [...commits].sort(
    (a, b) => new Date(b.committedAt).getTime() - new Date(a.committedAt).getTime()
  );

  // Show only recent commits unless expanded
  const displayCommits = showAll ? sortedCommits : sortedCommits.slice(0, 5);
  const hiddenCount = sortedCommits.length - displayCommits.length;

  // Calculate total duration
  const totalDuration = commits.reduce((sum, c) => sum + (c.durationMs || 0), 0);

  return (
    <div className={`rounded-lg border border-green-500/30 bg-green-500/10 ${className}`}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-green-500/20 transition-colors rounded-t-lg"
      >
        <div className="flex items-center gap-2">
          <GitCommit className="w-4 h-4 text-green-500" />
          <span className="text-sm font-medium text-green-500">Commit History</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">
            {commits.length} commit{commits.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {totalDuration > 0 && (
            <span className="text-xs text-muted-foreground">
              {formatDuration(totalDuration)} total
            </span>
          )}
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-green-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-green-500" />
          )}
        </div>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="p-3 pt-0">
          {/* Timeline */}
          <div className="mt-2">
            {displayCommits.map((commit, index) => {
              const step = steps?.find((s) => s.index === commit.stepIndex);
              return (
                <CommitEntry
                  key={commit.commitHash}
                  commit={commit}
                  step={step}
                  isLast={index === displayCommits.length - 1}
                  githubRepo={githubRepo}
                />
              );
            })}
          </div>

          {/* Show more/less toggle */}
          {sortedCommits.length > 5 && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="w-full mt-2 py-2 text-xs text-muted-foreground hover:text-foreground border border-border/30 rounded hover:bg-muted/30 transition-colors"
            >
              {showAll ? (
                <>Show less</>
              ) : (
                <>Show {hiddenCount} more commit{hiddenCount !== 1 ? "s" : ""}</>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Compact badge showing commit count and latest hash
 */
export function CommitTimelineBadge({
  commits,
  githubRepo,
}: {
  commits: StepCommit[];
  githubRepo?: string;
}) {
  if (commits.length === 0) {
    return null;
  }

  const latestCommit = commits.reduce((latest, c) =>
    new Date(c.committedAt) > new Date(latest.committedAt) ? c : latest
  );

  const commitUrl = githubRepo
    ? `https://github.com/${githubRepo}/commit/${latestCommit.commitHash}`
    : null;

  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded bg-green-500/10 border border-green-500/30">
      <GitCommit className="w-3 h-3 text-green-500" />
      <span className="text-xs font-medium text-green-500">{commits.length}</span>
      {commitUrl ? (
        <a
          href={commitUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-green-400 hover:underline"
        >
          {truncateCommitHash(latestCommit.commitHash)}
        </a>
      ) : (
        <code className="text-xs text-green-400">
          {truncateCommitHash(latestCommit.commitHash)}
        </code>
      )}
    </div>
  );
}

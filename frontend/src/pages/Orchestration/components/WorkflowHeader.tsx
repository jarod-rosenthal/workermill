import { useState } from "react";
import {
  ExternalLink,
  Pause,
  XCircle,
  Zap,
  Eye,
  GitBranch,
  FlaskConical,
  Loader2,
  Layers,
} from "lucide-react";
import type { ParentTask, WorkflowStats, ExecutionMode } from "../orchestration-store";
import { PERSONA_CONFIGS } from "../../../types/mission-control";
import { isExecutionPlanV2, THEME_CATEGORY_LABELS } from "../../../types/planning-v2";
import type { ConsistencyReport } from "../../../types/planning-v2";
import { QualityScoreIndicator } from "./PlanQualityBadge";

interface WorkflowHeaderProps {
  parentTask: ParentTask | null;
  stats: WorkflowStats;
  executionMode: ExecutionMode;
  isLoading: boolean;
  showDependencyGraph: boolean;
  onPauseAll: () => void;
  onCancelWorkflow: () => void;
  onToggleGraph: () => void;
  onConsistencyTest?: () => Promise<ConsistencyReport>;
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
function formatCost(cost: number | null | undefined): string {
  if (cost == null) return "$0.00";
  const numCost = typeof cost === "number" ? cost : parseFloat(String(cost));
  if (isNaN(numCost) || numCost < 0.01) return "$0.00";
  return `$${numCost.toFixed(2)}`;
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
  onConsistencyTest,
}: WorkflowHeaderProps) {
  const [isTestingConsistency, setIsTestingConsistency] = useState(false);
  const [consistencyReport, setConsistencyReport] = useState<ConsistencyReport | null>(null);
  const [showQualityDetails, setShowQualityDetails] = useState(false);

  const progressPercent = getProgressPercent(stats);
  const personaConfig = parentTask?.workerPersona
    ? PERSONA_CONFIGS[parentTask.workerPersona]
    : null;

  // Check if plan is V2 format
  const planV2 = parentTask?.planJson && isExecutionPlanV2(parentTask.planJson)
    ? parentTask.planJson
    : null;

  // Handle consistency test
  const handleConsistencyTest = async () => {
    if (!onConsistencyTest || isTestingConsistency) return;
    setIsTestingConsistency(true);
    setConsistencyReport(null);
    try {
      const report = await onConsistencyTest();
      setConsistencyReport(report);
    } catch (err) {
      console.error("Consistency test failed:", err);
    } finally {
      setIsTestingConsistency(false);
    }
  };

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
          {/* V2 Quality Score */}
          {planV2 && (
            <QualityScoreIndicator
              score={planV2.qualityScore.overall}
              onClick={() => setShowQualityDetails(!showQualityDetails)}
            />
          )}

          {/* Consistency Test Button */}
          {onConsistencyTest && (
            <button
              onClick={handleConsistencyTest}
              disabled={isTestingConsistency}
              className="mc-btn mc-btn-secondary flex items-center gap-1"
              title="Run consistency test (runs planning 5 times to check for variance)"
            >
              {isTestingConsistency ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <FlaskConical className="w-3 h-3" />
              )}
              Test
            </button>
          )}

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

      {/* V2 Theme Summary */}
      {planV2 && planV2.themes.length > 0 && (
        <div className="px-4 py-2 border-b border-[var(--mc-border-subtle)] flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 text-[var(--mc-text-xs)] text-[var(--mc-text-muted)]">
            <Layers className="w-3 h-3" />
            Themes:
          </div>
          {planV2.themes.map((theme) => (
            <span
              key={theme.id}
              className="px-2 py-0.5 rounded text-[var(--mc-text-xs)] bg-[var(--mc-bg-elevated)] text-[var(--mc-text-secondary)]"
              title={`${theme.description} (${THEME_CATEGORY_LABELS[theme.category]})`}
            >
              {theme.id}: {theme.name}
            </span>
          ))}
        </div>
      )}

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

      {/* Consistency Report Modal */}
      {consistencyReport && (
        <ConsistencyReportModal
          report={consistencyReport}
          onClose={() => setConsistencyReport(null)}
        />
      )}

      {/* Quality Details Popover (TODO: implement as dropdown/popover) */}
      {showQualityDetails && planV2 && (
        <div className="absolute right-4 top-full mt-1 z-50 w-72 p-3 bg-[var(--mc-bg-surface)] border border-[var(--mc-border-default)] rounded-lg shadow-lg">
          <div className="text-[var(--mc-text-sm)] font-medium text-[var(--mc-text-primary)] mb-2">
            Quality Score Details
          </div>
          <div className="grid grid-cols-3 gap-2 text-[var(--mc-text-xs)]">
            <div className="text-center">
              <div className="text-[var(--mc-text-muted)]">Completeness</div>
              <div className="font-medium">{planV2.qualityScore.completeness.toFixed(1)}</div>
            </div>
            <div className="text-center">
              <div className="text-[var(--mc-text-muted)]">Ordering</div>
              <div className="font-medium">{planV2.qualityScore.ordering.toFixed(1)}</div>
            </div>
            <div className="text-center">
              <div className="text-[var(--mc-text-muted)]">Balance</div>
              <div className="font-medium">{planV2.qualityScore.balance.toFixed(1)}</div>
            </div>
          </div>
          {planV2.qualityScore.suggestions.length > 0 && (
            <div className="mt-2 pt-2 border-t border-[var(--mc-border-subtle)]">
              <div className="text-[var(--mc-text-2xs)] text-[var(--mc-text-muted)] uppercase mb-1">
                Suggestions
              </div>
              <ul className="text-[var(--mc-text-xs)] text-[var(--mc-text-secondary)] space-y-0.5">
                {planV2.qualityScore.suggestions.slice(0, 3).map((s, i) => (
                  <li key={i}>- {s}</li>
                ))}
              </ul>
            </div>
          )}
          <button
            onClick={() => setShowQualityDetails(false)}
            className="mt-2 w-full text-center text-[var(--mc-text-xs)] text-[var(--mc-text-muted)] hover:text-[var(--mc-text-primary)]"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Modal for displaying consistency test results
 */
function ConsistencyReportModal({
  report,
  onClose,
}: {
  report: ConsistencyReport;
  onClose: () => void;
}) {
  const isConsistent = report.consistentRuns === report.totalRuns;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[var(--mc-bg-surface)] border border-[var(--mc-border-default)] rounded-lg shadow-2xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--mc-border-subtle)] bg-[var(--mc-bg-elevated)]">
          <div className="flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-[var(--mc-status-info)]" />
            <h2 className="text-[var(--mc-text-lg)] font-semibold text-[var(--mc-text-primary)]">
              Consistency Report
            </h2>
            <span className="text-[var(--mc-text-sm)] text-[var(--mc-text-muted)]">
              {report.jiraKey}
            </span>
          </div>
          <button onClick={onClose} className="mc-btn mc-btn-ghost p-1" title="Close">
            <span className="text-xl">&times;</span>
          </button>
        </div>

        {/* Summary */}
        <div className="px-4 py-3 border-b border-[var(--mc-border-subtle)]">
          <div className="flex items-center gap-4">
            <div
              className={`px-3 py-1.5 rounded font-medium ${
                isConsistent
                  ? "bg-[var(--mc-status-live)] bg-opacity-20 text-[var(--mc-status-live)]"
                  : "bg-[var(--mc-status-warning)] bg-opacity-20 text-[var(--mc-status-warning)]"
              }`}
            >
              {isConsistent ? "Consistent" : "Variance Detected"}
            </div>
            <span className="text-[var(--mc-text-sm)] text-[var(--mc-text-secondary)]">
              {report.consistentRuns}/{report.totalRuns} runs matched
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {/* Divergences */}
          {report.divergences.length > 0 && (
            <div className="mb-4">
              <h3 className="text-[var(--mc-text-sm)] font-medium text-[var(--mc-text-primary)] mb-2">
                Divergences Found
              </h3>
              <div className="space-y-2">
                {report.divergences.map((d, i) => (
                  <div
                    key={i}
                    className="p-2 bg-[var(--mc-bg-elevated)] rounded border border-[var(--mc-border-subtle)]"
                  >
                    <div className="flex items-center gap-2 text-[var(--mc-text-xs)]">
                      <span className="px-1.5 py-0.5 rounded bg-[var(--mc-status-warning)] bg-opacity-20 text-[var(--mc-status-warning)]">
                        Run {d.runNumber}
                      </span>
                      <span className="text-[var(--mc-text-muted)]">{d.level}</span>
                      <span className="text-[var(--mc-text-secondary)]">{d.field}</span>
                    </div>
                    <div className="mt-1 text-[var(--mc-text-xs)] text-[var(--mc-text-secondary)]">
                      {d.description}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Root Causes */}
          {report.rootCauses.length > 0 && (
            <div className="mb-4">
              <h3 className="text-[var(--mc-text-sm)] font-medium text-[var(--mc-text-primary)] mb-2">
                Root Causes
              </h3>
              <ul className="text-[var(--mc-text-sm)] text-[var(--mc-text-secondary)] space-y-1">
                {report.rootCauses.map((cause, i) => (
                  <li key={i}>- {cause}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommendations */}
          {report.recommendations.length > 0 && (
            <div className="mb-4">
              <h3 className="text-[var(--mc-text-sm)] font-medium text-[var(--mc-text-primary)] mb-2">
                Recommendations
              </h3>
              <ul className="text-[var(--mc-text-sm)] text-[var(--mc-text-secondary)] space-y-1">
                {report.recommendations.map((rec, i) => (
                  <li key={i}>- {rec}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Full Report */}
          {report.report && (
            <div>
              <h3 className="text-[var(--mc-text-sm)] font-medium text-[var(--mc-text-primary)] mb-2">
                Full Report
              </h3>
              <pre className="p-3 bg-[var(--mc-bg-elevated)] rounded border border-[var(--mc-border-subtle)] text-[var(--mc-text-xs)] text-[var(--mc-text-secondary)] whitespace-pre-wrap font-mono overflow-auto max-h-48">
                {report.report}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[var(--mc-border-subtle)] bg-[var(--mc-bg-elevated)]">
          <button onClick={onClose} className="mc-btn mc-btn-primary w-full">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

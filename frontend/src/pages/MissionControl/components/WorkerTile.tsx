import { memo, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Pause, X, ExternalLink, AlertTriangle, Shield, Layers } from 'lucide-react';
import type {
  MissionControlTask,
  ViewMode,
  SafetyStatus,
} from '../../../types/mission-control';
import { PERSONA_CONFIGS } from '../../../types/mission-control';
import { CostSparkline } from './CostSparkline';

interface WorkerTileProps {
  task: MissionControlTask;
  isExpanded: boolean;
  viewMode: ViewMode;
  costHistory: number[];
  onExpand: () => void;
  onCollapse: () => void;
  onPause: () => void;
  onCancel: () => void;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function getProgressPercent(task: MissionControlTask): number {
  // Rough estimate based on status
  switch (task.status) {
    case 'queued':
    case 'claimed':
      return 5;
    case 'environment_setup':
      return 15;
    case 'executing':
      return Math.min(85, 20 + (task.elapsedSeconds / 300) * 65); // Grows over 5 mins
    case 'pr_created':
    case 'review_requested':
    case 'review_pending':
      return 90;
    case 'manager_review':
    case 'approved':
    case 'pr_approved':
      return 95;
    case 'deploying':
    case 'deployment_pending':
      return 98;
    case 'deployed':
    case 'completed':
      return 100;
    default:
      return 50;
  }
}

function getSafetyClass(status: SafetyStatus): string {
  switch (status) {
    case 'safe':
      return 'safe';
    case 'blocked':
      return 'blocked';
    case 'escalated':
      return 'escalated';
    default:
      return 'safe';
  }
}

function classifyTerminalLine(
  line: string
): 'prompt' | 'error' | 'warning' | 'normal' {
  if (line.startsWith('$') || line.startsWith('>')) return 'prompt';
  if (
    line.toLowerCase().includes('error') ||
    line.toLowerCase().includes('fail') ||
    line.includes('ERR!')
  )
    return 'error';
  if (
    line.toLowerCase().includes('warn') ||
    line.toLowerCase().includes('deprecat')
  )
    return 'warning';
  return 'normal';
}

export const WorkerTile = memo(
  function WorkerTile({
    task,
    isExpanded,
    viewMode,
    costHistory,
    onExpand,
    onCollapse,
    onPause,
    onCancel,
  }: WorkerTileProps) {
    const config = PERSONA_CONFIGS[task.workerPersona] || {
      emoji: '🤖',
      shortLabel: 'Worker',
    };

    const progress = useMemo(() => getProgressPercent(task), [task.status, task.elapsedSeconds]);
    const terminalLinesToShow = viewMode === 'compact' ? 3 : 5;
    const displayLines = task.terminalLines.slice(-terminalLinesToShow);

    const tileClass = useMemo(() => {
      const classes = ['mc-tile'];
      if (isExpanded) classes.push('expanded');
      if (task.safetyStatus === 'blocked') classes.push('blocked');
      if (task.safetyStatus === 'escalated') classes.push('escalated');
      return classes.join(' ');
    }, [isExpanded, task.safetyStatus]);

    const isRunningLong = task.elapsedSeconds > 300; // 5 minutes

    return (
      <div className={tileClass} onClick={isExpanded ? undefined : onExpand}>
        {/* Header */}
        <div className="mc-tile-header">
          <div className="mc-tile-header-left">
            <span className="mc-tile-persona-icon">{config.emoji}</span>
            <div className="flex flex-col min-w-0">
              <span className="mc-tile-key truncate">{task.jiraIssueKey}</span>
              <span className="mc-tile-persona">{config.shortLabel}</span>
            </div>
          </div>
          {isExpanded && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCollapse();
              }}
              className="mc-tile-btn"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Progress Bar */}
        <div className="mc-tile-progress">
          <div className="mc-tile-progress-bar">
            <div
              className={`mc-tile-progress-fill ${isRunningLong ? 'slow' : ''}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="mc-tile-time">{formatDuration(task.elapsedSeconds)}</span>
        </div>

        {/* Terminal */}
        <div className="mc-tile-terminal">
          {displayLines.length > 0 ? (
            displayLines.map((line, i) => (
              <div
                key={i}
                className={`mc-tile-terminal-line ${classifyTerminalLine(line)}`}
              >
                {line}
              </div>
            ))
          ) : (
            <div className="mc-tile-terminal-line text-[var(--mc-text-muted)]">
              Waiting for output...
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mc-tile-footer">
          {/* Cost + Sparkline */}
          <div className="mc-tile-cost">
            <span className="mc-tile-cost-value">
              ${task.estimatedCostUsd.toFixed(2)}
            </span>
            {costHistory.length > 1 && (
              <CostSparkline data={costHistory} width={60} height={16} />
            )}
          </div>

          {/* Safety Status */}
          <div className={`mc-tile-safety ${getSafetyClass(task.safetyStatus)}`}>
            {task.safetyStatus === 'safe' && (
              <>
                <Shield className="w-3 h-3" />
                <span>Safe</span>
              </>
            )}
            {task.safetyStatus === 'blocked' && (
              <>
                <AlertTriangle className="w-3 h-3" />
                <span>BLOCKED</span>
              </>
            )}
            {task.safetyStatus === 'escalated' && (
              <>
                <AlertTriangle className="w-3 h-3" />
                <span>Escalated</span>
              </>
            )}
          </div>

          {/* Controls */}
          <div className="mc-tile-controls">
            {/* Orchestration link for PRD/Ralph tasks */}
            {task.isRalphTask && (
              <Link
                to={`/orchestration/${task.id}`}
                onClick={(e) => e.stopPropagation()}
                className="mc-tile-btn"
                title="View PRD Orchestration"
              >
                <Layers className="w-3 h-3" />
              </Link>
            )}
            {task.hasPr && task.githubPrUrl && (
              <a
                href={task.githubPrUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="mc-tile-btn"
                title="View PR"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPause();
              }}
              className="mc-tile-btn"
              title="Pause Worker"
            >
              <Pause className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCancel();
              }}
              className="mc-tile-btn danger"
              title="Cancel Task"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    );
  },
  (prev, next) => {
    // Custom comparison for memo
    return (
      prev.task.id === next.task.id &&
      prev.task.status === next.task.status &&
      prev.task.elapsedSeconds === next.task.elapsedSeconds &&
      prev.task.estimatedCostUsd === next.task.estimatedCostUsd &&
      prev.task.safetyStatus === next.task.safetyStatus &&
      prev.task.terminalLines.length === next.task.terminalLines.length &&
      prev.isExpanded === next.isExpanded &&
      prev.viewMode === next.viewMode &&
      prev.costHistory.length === next.costHistory.length
    );
  }
);

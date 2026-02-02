import {
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
  SkipForward,
  Rocket,
  TestTube,
  Eye,
  Server,
  Play,
  RotateCcw,
  ExternalLink,
  GitPullRequest,
} from 'lucide-react';
import type {
  DeploymentPipelineData,
  PipelineStageData,
  DeploymentRecord,
  PipelineStage,
  StageStatus,
} from '../../types/dashboard';
import { useIssueTrackerConfig } from '../../hooks/useIssueTrackerConfig';
import { buildTicketUrl } from '../../lib/utils';

const stageConfig: Record<PipelineStage, { icon: React.ReactNode; label: string }> = {
  build: { icon: <Play className="h-5 w-5" />, label: 'Build' },
  test: { icon: <TestTube className="h-5 w-5" />, label: 'Test' },
  review: { icon: <Eye className="h-5 w-5" />, label: 'Review' },
  staging: { icon: <Server className="h-5 w-5" />, label: 'Staging' },
  production: { icon: <Rocket className="h-5 w-5" />, label: 'Production' },
};

const statusConfig: Record<StageStatus, { color: string; bgColor: string; icon: React.ReactNode }> = {
  pending: {
    color: 'text-slate-400 dark:text-slate-500',
    bgColor: 'bg-slate-100 dark:bg-slate-800',
    icon: <Clock className="h-4 w-4" />,
  },
  running: {
    color: 'text-cyan-500',
    bgColor: 'bg-cyan-100 dark:bg-cyan-900/30',
    icon: <Loader2 className="h-4 w-4 animate-spin" />,
  },
  passed: {
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-100 dark:bg-emerald-900/30',
    icon: <CheckCircle className="h-4 w-4" />,
  },
  failed: {
    color: 'text-red-500',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    icon: <XCircle className="h-4 w-4" />,
  },
  skipped: {
    color: 'text-slate-400 dark:text-slate-500',
    bgColor: 'bg-slate-100 dark:bg-slate-800',
    icon: <SkipForward className="h-4 w-4" />,
  },
};

interface DeploymentPipelineProps {
  data: DeploymentPipelineData;
  onRollback?: (deploymentId: string) => void;
  onViewLogs?: (deploymentId: string) => void;
}

export function DeploymentPipeline({ data, onRollback, onViewLogs }: DeploymentPipelineProps) {
  return (
    <div className="space-y-6">
      {/* Pipeline Stages */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">
            Pipeline Status
          </h3>
          <span className={`px-2 py-1 text-xs font-medium rounded ${
            data.environment === 'production'
              ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
              : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
          }`}>
            {data.environment.toUpperCase()}
          </span>
        </div>

        <div className="flex items-center justify-between">
          {data.stages.map((stage, index) => (
            <PipelineStageNode
              key={stage.stage}
              stage={stage}
              isLast={index === data.stages.length - 1}
            />
          ))}
        </div>
      </div>

      {/* Current Deployments */}
      {data.currentDeployments.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">
              Recent Deployments
            </h3>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {data.currentDeployments.map((deployment) => (
              <DeploymentRow
                key={deployment.id}
                deployment={deployment}
                onRollback={onRollback}
                onViewLogs={onViewLogs}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface PipelineStageNodeProps {
  stage: PipelineStageData;
  isLast: boolean;
}

function PipelineStageNode({ stage, isLast }: PipelineStageNodeProps) {
  const config = stageConfig[stage.stage];
  const status = statusConfig[stage.status];

  return (
    <>
      <div className="flex flex-col items-center">
        {/* Stage icon */}
        <div className={`p-3 rounded-full ${status.bgColor} ${status.color}`}>
          {config.icon}
        </div>

        {/* Label */}
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mt-2">
          {config.label}
        </span>

        {/* Status */}
        <div className={`flex items-center gap-1 mt-1 text-xs ${status.color}`}>
          {status.icon}
          <span className="capitalize">{stage.status}</span>
        </div>

        {/* Duration */}
        {stage.duration && (
          <span className="text-xs text-slate-400 dark:text-slate-500 mt-1">
            {formatDuration(stage.duration)}
          </span>
        )}
      </div>

      {/* Connector line */}
      {!isLast && (
        <div className={`flex-1 h-0.5 mx-2 ${
          stage.status === 'passed' ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'
        }`} />
      )}
    </>
  );
}

interface DeploymentRowProps {
  deployment: DeploymentRecord;
  onRollback?: (deploymentId: string) => void;
  onViewLogs?: (deploymentId: string) => void;
}

function DeploymentRow({ deployment, onRollback, onViewLogs }: DeploymentRowProps) {
  const issueTrackerConfig = useIssueTrackerConfig();
  const ticketUrl = buildTicketUrl(deployment.jiraKey, issueTrackerConfig ?? undefined);
  const statusColors: Record<string, string> = {
    live: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
    rolling_back: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    rolled_back: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300',
    failed: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  };

  return (
    <div className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
      <div className="flex items-center gap-4">
        {/* Status badge */}
        <span className={`px-2 py-1 text-xs font-medium rounded ${statusColors[deployment.status]}`}>
          {deployment.status.replace('_', ' ')}
        </span>

        {/* Service & version */}
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {deployment.service}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            v{deployment.version}
          </p>
        </div>

        {/* Issue tracker link */}
        {deployment.jiraKey && (
          ticketUrl ? (
            <a
              href={ticketUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
            >
              {deployment.jiraKey}
            </a>
          ) : (
            <span className="text-xs font-medium">{deployment.jiraKey}</span>
          )
        )}

        {/* PR link */}
        {deployment.prNumber && (
          <span className="text-xs text-purple-600 dark:text-purple-400 flex items-center gap-1">
            <GitPullRequest className="h-3 w-3" />
            #{deployment.prNumber}
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        {/* Deploy info */}
        <div className="text-right text-sm">
          <p className="text-slate-500 dark:text-slate-400">
            {formatRelativeTime(deployment.deployedAt)}
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            by {deployment.deployedBy}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {onViewLogs && (
            <button
              onClick={() => onViewLogs(deployment.id)}
              className="p-1.5 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors"
              title="View logs"
            >
              <ExternalLink className="h-4 w-4" />
            </button>
          )}
          {onRollback && deployment.status === 'live' && (
            <button
              onClick={() => onRollback(deployment.id)}
              className="p-1.5 text-amber-600 hover:text-amber-700 dark:hover:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 rounded transition-colors"
              title="Rollback"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Compact pipeline indicator for headers
interface PipelineIndicatorProps {
  stages: PipelineStageData[];
}

export function PipelineIndicator({ stages }: PipelineIndicatorProps) {
  return (
    <div className="flex items-center gap-1">
      {stages.map((stage, index) => {
        return (
          <div key={index} className="flex items-center">
            <div
              className={`w-2 h-2 rounded-full ${
                stage.status === 'running' ? 'animate-pulse' : ''
              }`}
              style={{
                backgroundColor:
                  stage.status === 'passed' ? '#10b981' :
                  stage.status === 'running' ? '#06b6d4' :
                  stage.status === 'failed' ? '#ef4444' :
                  '#94a3b8',
              }}
              title={`${stageConfig[stage.stage].label}: ${stage.status}`}
            />
            {index < stages.length - 1 && (
              <div className={`w-3 h-0.5 ${
                stage.status === 'passed' ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
              }`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default DeploymentPipeline;

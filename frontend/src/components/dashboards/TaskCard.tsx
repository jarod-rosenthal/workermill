import {
  Clock,
  GitPullRequest,
  ExternalLink,
  FileCode,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  DollarSign,
} from 'lucide-react';
import { useState } from 'react';
import type { TaskCardData, TaskStep } from '../../types/dashboard';

const statusColors: Record<string, string> = {
  queued: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  executing: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  pr_created: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  review_requested: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  deploying: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  deployed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  escalated: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
};

const statusLabels: Record<string, string> = {
  queued: 'Queued',
  executing: 'Executing',
  pr_created: 'PR Created',
  review_requested: 'Review Requested',
  approved: 'Approved',
  deploying: 'Deploying',
  deployed: 'Deployed',
  completed: 'Completed',
  failed: 'Failed',
  escalated: 'Escalated',
};

function StepIndicator({ steps }: { steps: TaskStep[] }) {
  return (
    <div className="flex items-center gap-1">
      {steps.map((step, index) => (
        <div key={step.id} className="flex items-center">
          <div
            className={`
              w-2 h-2 rounded-full
              ${step.status === 'completed' ? 'bg-emerald-500' :
                step.status === 'active' ? 'bg-cyan-500 animate-pulse' :
                step.status === 'failed' ? 'bg-red-500' :
                'bg-slate-300 dark:bg-slate-600'}
            `}
            title={`${step.label}: ${step.status}`}
          />
          {index < steps.length - 1 && (
            <div
              className={`
                w-4 h-0.5
                ${step.status === 'completed' ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}
              `}
            />
          )}
        </div>
      ))}
    </div>
  );
}

interface TaskCardProps {
  task: TaskCardData;
  showDetails?: boolean;
  onViewDetails?: (taskId: string) => void;
  onApprove?: (taskId: string) => void;
  onReject?: (taskId: string) => void;
  compact?: boolean;
}

export function TaskCard({
  task,
  showDetails = false,
  onViewDetails,
  onApprove,
  onReject,
  compact = false,
}: TaskCardProps) {
  const [expanded, setExpanded] = useState(showDetails);

  const formatDuration = (minutes?: number) => {
    if (!minutes) return '-';
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  };

  const formatCost = (cost?: number) => {
    if (!cost) return '-';
    return `$${cost.toFixed(2)}`;
  };

  if (compact) {
    return (
      <div className="flex items-center justify-between p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`px-2 py-0.5 text-xs font-medium rounded ${statusColors[task.status]}`}>
            {statusLabels[task.status]}
          </span>
          <a
            href={`https://jira.atlassian.net/browse/${task.jiraKey}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-cyan-600 dark:text-cyan-400 hover:underline"
          >
            {task.jiraKey}
          </a>
          <span className="text-sm text-slate-600 dark:text-slate-400 truncate">
            {task.summary}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {task.prUrl && (
            <a
              href={task.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            >
              <GitPullRequest className="h-4 w-4" />
            </a>
          )}
          <span className="text-xs text-slate-500">
            {formatCost(task.estimatedCost)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-1 text-xs font-medium rounded ${statusColors[task.status]}`}>
              {statusLabels[task.status]}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400 capitalize">
              {task.persona.replace('_', ' ')}
            </span>
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {task.model}
            </span>
          </div>
          <StepIndicator steps={task.steps} />
        </div>

        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <a
              href={`https://jira.atlassian.net/browse/${task.jiraKey}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-lg font-semibold text-cyan-600 dark:text-cyan-400 hover:underline inline-flex items-center gap-1"
            >
              {task.jiraKey}
              <ExternalLink className="h-4 w-4" />
            </a>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              {task.summary}
            </p>
          </div>

          <button
            onClick={() => setExpanded(!expanded)}
            className="ml-4 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          >
            {expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </button>
        </div>

        {/* Quick Stats */}
        <div className="flex items-center gap-4 mt-3 text-sm text-slate-500 dark:text-slate-400">
          {task.filesChanged !== undefined && (
            <span className="flex items-center gap-1">
              <FileCode className="h-4 w-4" />
              {task.filesChanged} files
            </span>
          )}
          {(task.linesAdded !== undefined || task.linesRemoved !== undefined) && (
            <span>
              <span className="text-emerald-600 dark:text-emerald-400">+{task.linesAdded || 0}</span>
              {' / '}
              <span className="text-red-600 dark:text-red-400">-{task.linesRemoved || 0}</span>
            </span>
          )}
          {task.duration !== undefined && (
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              {formatDuration(task.duration)}
            </span>
          )}
          {task.estimatedCost !== undefined && (
            <span className="flex items-center gap-1">
              <DollarSign className="h-4 w-4" />
              {formatCost(task.estimatedCost)}
            </span>
          )}
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="border-t border-slate-200 dark:border-slate-700 p-4 bg-slate-50 dark:bg-slate-800/50">
          {/* PR Link */}
          {task.prUrl && (
            <div className="mb-3">
              <a
                href={task.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-purple-600 dark:text-purple-400 hover:underline"
              >
                <GitPullRequest className="h-4 w-4" />
                Pull Request #{task.prNumber}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}

          {/* Actions */}
          {(onApprove || onReject || onViewDetails) && (
            <div className="flex items-center gap-2">
              {onApprove && (task.status === 'review_requested' || task.status === 'pr_created') && (
                <button
                  onClick={() => onApprove(task.id)}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md flex items-center gap-1"
                >
                  <CheckCircle className="h-4 w-4" />
                  Approve
                </button>
              )}
              {onReject && (task.status === 'review_requested' || task.status === 'pr_created') && (
                <button
                  onClick={() => onReject(task.id)}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md flex items-center gap-1"
                >
                  <XCircle className="h-4 w-4" />
                  Reject
                </button>
              )}
              {onViewDetails && (
                <button
                  onClick={() => onViewDetails(task.id)}
                  className="px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-md"
                >
                  View Details
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Loading skeleton
export function TaskCardSkeleton() {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4 animate-pulse">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-6 w-20 bg-slate-200 dark:bg-slate-700 rounded" />
        <div className="h-4 w-16 bg-slate-200 dark:bg-slate-700 rounded" />
      </div>
      <div className="h-5 w-24 bg-slate-200 dark:bg-slate-700 rounded mb-2" />
      <div className="h-4 w-3/4 bg-slate-200 dark:bg-slate-700 rounded" />
    </div>
  );
}

export default TaskCard;

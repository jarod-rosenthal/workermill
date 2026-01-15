import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  GitPullRequest,
  GitMerge,
  Rocket,
  Shield,
  DollarSign,
  Play,
  Plus,
  Info,
} from 'lucide-react';
import type { ActivityItem, ActivityType } from '../../types/dashboard';

const activityIcons: Record<ActivityType, React.ReactNode> = {
  task_created: <Plus className="h-4 w-4" />,
  task_started: <Play className="h-4 w-4" />,
  task_completed: <CheckCircle className="h-4 w-4" />,
  task_failed: <XCircle className="h-4 w-4" />,
  pr_created: <GitPullRequest className="h-4 w-4" />,
  pr_approved: <CheckCircle className="h-4 w-4" />,
  pr_merged: <GitMerge className="h-4 w-4" />,
  deployment_started: <Rocket className="h-4 w-4" />,
  deployment_completed: <Rocket className="h-4 w-4" />,
  deployment_failed: <XCircle className="h-4 w-4" />,
  security_alert: <Shield className="h-4 w-4" />,
  cost_alert: <DollarSign className="h-4 w-4" />,
  escalation: <AlertTriangle className="h-4 w-4" />,
};

const activityColors: Record<ActivityType, string> = {
  task_created: 'text-slate-500 bg-slate-100 dark:bg-slate-800',
  task_started: 'text-cyan-500 bg-cyan-100 dark:bg-cyan-900/30',
  task_completed: 'text-emerald-500 bg-emerald-100 dark:bg-emerald-900/30',
  task_failed: 'text-red-500 bg-red-100 dark:bg-red-900/30',
  pr_created: 'text-purple-500 bg-purple-100 dark:bg-purple-900/30',
  pr_approved: 'text-emerald-500 bg-emerald-100 dark:bg-emerald-900/30',
  pr_merged: 'text-purple-500 bg-purple-100 dark:bg-purple-900/30',
  deployment_started: 'text-blue-500 bg-blue-100 dark:bg-blue-900/30',
  deployment_completed: 'text-emerald-500 bg-emerald-100 dark:bg-emerald-900/30',
  deployment_failed: 'text-red-500 bg-red-100 dark:bg-red-900/30',
  security_alert: 'text-orange-500 bg-orange-100 dark:bg-orange-900/30',
  cost_alert: 'text-amber-500 bg-amber-100 dark:bg-amber-900/30',
  escalation: 'text-orange-500 bg-orange-100 dark:bg-orange-900/30',
};

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

interface ActivityFeedProps {
  activities: ActivityItem[];
  maxItems?: number;
  showTimestamps?: boolean;
  compact?: boolean;
  title?: string;
  emptyMessage?: string;
}

export function ActivityFeed({
  activities,
  maxItems,
  showTimestamps = true,
  compact = false,
  title,
  emptyMessage = 'No recent activity',
}: ActivityFeedProps) {
  const displayActivities = maxItems ? activities.slice(0, maxItems) : activities;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
      {title && (
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
        </div>
      )}

      <div className={`${compact ? 'divide-y divide-slate-100 dark:divide-slate-700' : 'p-4 space-y-4'}`}>
        {displayActivities.length === 0 ? (
          <div className={`text-center ${compact ? 'py-8' : 'py-4'} text-slate-500 dark:text-slate-400`}>
            <Info className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">{emptyMessage}</p>
          </div>
        ) : (
          displayActivities.map((activity) => (
            <ActivityFeedItem
              key={activity.id}
              activity={activity}
              showTimestamp={showTimestamps}
              compact={compact}
            />
          ))
        )}
      </div>

      {maxItems && activities.length > maxItems && (
        <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-700 text-center">
          <button className="text-sm text-cyan-600 dark:text-cyan-400 hover:underline">
            View all {activities.length} activities
          </button>
        </div>
      )}
    </div>
  );
}

interface ActivityFeedItemProps {
  activity: ActivityItem;
  showTimestamp?: boolean;
  compact?: boolean;
}

function ActivityFeedItem({ activity, showTimestamp = true, compact = false }: ActivityFeedItemProps) {
  const severityBorder = activity.severity === 'error' ? 'border-l-red-500' :
                        activity.severity === 'warning' ? 'border-l-amber-500' :
                        activity.severity === 'success' ? 'border-l-emerald-500' :
                        'border-l-transparent';

  if (compact) {
    return (
      <div className={`flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 border-l-2 ${severityBorder}`}>
        <div className={`p-1.5 rounded-full ${activityColors[activity.type]}`}>
          {activityIcons[activity.type]}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-900 dark:text-slate-100 truncate">
            {activity.title}
          </p>
        </div>
        {showTimestamp && (
          <span className="text-xs text-slate-500 dark:text-slate-400 flex-shrink-0">
            {formatTimestamp(activity.timestamp)}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={`flex gap-3 border-l-2 pl-3 ${severityBorder}`}>
      <div className={`p-2 rounded-full ${activityColors[activity.type]} flex-shrink-0 h-fit`}>
        {activityIcons[activity.type]}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {activity.title}
            </p>
            {activity.description && (
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                {activity.description}
              </p>
            )}
          </div>
          {showTimestamp && (
            <span className="text-xs text-slate-500 dark:text-slate-400 flex-shrink-0">
              {formatTimestamp(activity.timestamp)}
            </span>
          )}
        </div>

        {/* Links */}
        <div className="flex items-center gap-3 mt-2">
          {activity.jiraKey && (
            <a
              href={`https://jira.atlassian.net/browse/${activity.jiraKey}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
            >
              {activity.jiraKey}
            </a>
          )}
          {activity.prUrl && (
            <a
              href={activity.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1"
            >
              <GitPullRequest className="h-3 w-3" />
              View PR
            </a>
          )}
          {activity.actor && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              by {activity.actor}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// Single activity alert banner (for important notifications)
interface ActivityAlertProps {
  activity: ActivityItem;
  onDismiss?: () => void;
}

export function ActivityAlert({ activity, onDismiss }: ActivityAlertProps) {
  const bgColor = activity.severity === 'error' ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' :
                  activity.severity === 'warning' ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' :
                  activity.severity === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' :
                  'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700';

  return (
    <div className={`rounded-lg border p-4 ${bgColor}`}>
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-full ${activityColors[activity.type]}`}>
          {activityIcons[activity.type]}
        </div>
        <div className="flex-1">
          <p className="font-medium text-slate-900 dark:text-slate-100">{activity.title}</p>
          {activity.description && (
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{activity.description}</p>
          )}
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          >
            <XCircle className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
}

export default ActivityFeed;

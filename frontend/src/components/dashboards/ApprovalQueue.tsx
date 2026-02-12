import {
  GitPullRequest,
  Rocket,
  Shield,
  DollarSign,
  FileCode,
  Clock,
  ExternalLink,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Info,
} from 'lucide-react';
import type { ApprovalItem, ApprovalType } from '../../types/dashboard';
import { useIssueTrackerConfig } from '../../hooks/useIssueTrackerConfig';
import { buildTicketUrl } from '../../lib/utils';

const typeConfig: Record<ApprovalType, { icon: React.ReactNode; color: string; label: string }> = {
  pr_review: {
    icon: <GitPullRequest className="h-4 w-4" />,
    color: 'text-purple-500 bg-purple-100 dark:bg-purple-900/30',
    label: 'PR Review',
  },
  deployment: {
    icon: <Rocket className="h-4 w-4" />,
    color: 'text-blue-500 bg-blue-100 dark:bg-blue-900/30',
    label: 'Deployment',
  },
  security: {
    icon: <Shield className="h-4 w-4" />,
    color: 'text-orange-500 bg-orange-100 dark:bg-orange-900/30',
    label: 'Security',
  },
  cost: {
    icon: <DollarSign className="h-4 w-4" />,
    color: 'text-amber-500 bg-amber-100 dark:bg-amber-900/30',
    label: 'Cost',
  },
  architecture: {
    icon: <FileCode className="h-4 w-4" />,
    color: 'text-cyan-500 bg-cyan-100 dark:bg-cyan-900/30',
    label: 'Architecture',
  },
};

interface ApprovalQueueProps {
  items: ApprovalItem[];
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onViewDetails?: (id: string) => void;
  maxItems?: number;
  title?: string;
  emptyMessage?: string;
}

export function ApprovalQueue({
  items,
  onApprove,
  onReject,
  onViewDetails,
  maxItems,
  title = 'Pending Approvals',
  emptyMessage = 'No pending approvals',
}: ApprovalQueueProps) {
  const displayItems = maxItems ? items.slice(0, maxItems) : items;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          {title}
        </h3>
        {items.length > 0 && (
          <span className="px-2 py-1 text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full">
            {items.length} pending
          </span>
        )}
      </div>

      {/* Items */}
      <div className="divide-y divide-slate-100 dark:divide-slate-700">
        {displayItems.length === 0 ? (
          <div className="py-8 text-center">
            <Info className="h-8 w-8 text-slate-400 mx-auto mb-2" />
            <p className="text-sm text-slate-500 dark:text-slate-400">{emptyMessage}</p>
          </div>
        ) : (
          displayItems.map((item) => (
            <ApprovalQueueItem
              key={item.id}
              item={item}
              onApprove={onApprove}
              onReject={onReject}
              onViewDetails={onViewDetails}
            />
          ))
        )}
      </div>

      {/* Show more */}
      {maxItems && items.length > maxItems && (
        <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-700 text-center">
          <button className="text-sm text-cyan-600 dark:text-cyan-400 hover:underline">
            View all {items.length} pending approvals
          </button>
        </div>
      )}
    </div>
  );
}

interface ApprovalQueueItemProps {
  item: ApprovalItem;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onViewDetails?: (id: string) => void;
}

function ApprovalQueueItem({ item, onApprove, onReject, onViewDetails }: ApprovalQueueItemProps) {
  const issueTrackerConfig = useIssueTrackerConfig();
  const ticketUrl = buildTicketUrl(item.jiraKey, issueTrackerConfig ?? undefined);
  const config = typeConfig[item.type];

  return (
    <div className="p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
      <div className="flex items-start gap-3">
        {/* Type icon */}
        <div className={`p-2 rounded-lg ${config.color}`}>{config.icon}</div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
              {config.label}
            </span>
            {item.jiraKey && (
              ticketUrl ? (
                <a
                  href={ticketUrl}
                  {...(ticketUrl.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
                >
                  {item.jiraKey}
                </a>
              ) : (
                <span className="text-xs font-medium">{item.jiraKey}</span>
              )
            )}
          </div>

          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{item.title}</p>

          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 line-clamp-2">
            {item.description}
          </p>

          {/* Meta info */}
          <div className="flex items-center gap-4 mt-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatRelativeTime(item.requestedAt)}
            </span>
            <span>by {item.requestedBy}</span>
            {item.prUrl && (
              <a
                href={item.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-purple-600 dark:text-purple-400 hover:underline"
              >
                <GitPullRequest className="h-3 w-3" />
                PR ***REMOVED***{item.prNumber}
              </a>
            )}
          </div>

          {/* Reason if provided */}
          {item.reason && (
            <div className="mt-2 p-2 bg-slate-100 dark:bg-slate-700 rounded text-xs text-slate-600 dark:text-slate-400">
              {item.reason}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {onApprove && (
            <button
              onClick={() => onApprove(item.id)}
              className="p-2 text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 rounded-lg transition-colors"
              title="Approve"
            >
              <CheckCircle className="h-5 w-5" />
            </button>
          )}
          {onReject && (
            <button
              onClick={() => onReject(item.id)}
              className="p-2 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
              title="Reject"
            >
              <XCircle className="h-5 w-5" />
            </button>
          )}
          {onViewDetails && (
            <button
              onClick={() => onViewDetails(item.id)}
              className="p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              title="View Details"
            >
              <ExternalLink className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function formatRelativeTime(timestamp: string): string {
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

// Compact approval badge for headers
interface ApprovalBadgeProps {
  count: number;
  onClick?: () => void;
}

export function ApprovalBadge({ count, onClick }: ApprovalBadgeProps) {
  if (count === 0) return null;

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
    >
      <AlertTriangle className="h-4 w-4" />
      <span className="text-sm font-medium">{count} pending</span>
    </button>
  );
}

export default ApprovalQueue;

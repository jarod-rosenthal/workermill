import {
  Shield,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle,
  ExternalLink,
  GitPullRequest,
} from 'lucide-react';
import type { SecurityFinding, SecuritySeverity, FindingStatus } from '../../types/dashboard';

const severityConfig: Record<SecuritySeverity, { color: string; bgColor: string; icon: React.ReactNode; label: string }> = {
  critical: {
    color: 'text-red-700 dark:text-red-300',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    icon: <AlertCircle className="h-4 w-4" />,
    label: 'Critical',
  },
  high: {
    color: 'text-orange-700 dark:text-orange-300',
    bgColor: 'bg-orange-100 dark:bg-orange-900/30',
    icon: <AlertTriangle className="h-4 w-4" />,
    label: 'High',
  },
  medium: {
    color: 'text-amber-700 dark:text-amber-300',
    bgColor: 'bg-amber-100 dark:bg-amber-900/30',
    icon: <AlertTriangle className="h-4 w-4" />,
    label: 'Medium',
  },
  low: {
    color: 'text-cyan-700 dark:text-cyan-300',
    bgColor: 'bg-cyan-100 dark:bg-cyan-900/30',
    icon: <Info className="h-4 w-4" />,
    label: 'Low',
  },
  info: {
    color: 'text-slate-700 dark:text-slate-300',
    bgColor: 'bg-slate-100 dark:bg-slate-800',
    icon: <Info className="h-4 w-4" />,
    label: 'Info',
  },
};

const statusConfig: Record<FindingStatus, { color: string; bgColor: string; label: string }> = {
  open: {
    color: 'text-red-700 dark:text-red-300',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    label: 'Open',
  },
  in_progress: {
    color: 'text-amber-700 dark:text-amber-300',
    bgColor: 'bg-amber-100 dark:bg-amber-900/30',
    label: 'In Progress',
  },
  resolved: {
    color: 'text-emerald-700 dark:text-emerald-300',
    bgColor: 'bg-emerald-100 dark:bg-emerald-900/30',
    label: 'Resolved',
  },
  accepted: {
    color: 'text-purple-700 dark:text-purple-300',
    bgColor: 'bg-purple-100 dark:bg-purple-900/30',
    label: 'Accepted',
  },
  blocked: {
    color: 'text-red-700 dark:text-red-300',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    label: 'Blocked',
  },
};

interface SecurityFindingsProps {
  findings: SecurityFinding[];
  onViewDetails?: (id: string) => void;
  onResolve?: (id: string) => void;
  maxItems?: number;
  filterBySeverity?: SecuritySeverity[];
  filterByStatus?: FindingStatus[];
}

export function SecurityFindings({
  findings,
  onViewDetails,
  onResolve,
  maxItems,
  filterBySeverity,
  filterByStatus,
}: SecurityFindingsProps) {
  let filteredFindings = findings;

  if (filterBySeverity?.length) {
    filteredFindings = filteredFindings.filter((f) => filterBySeverity.includes(f.severity));
  }

  if (filterByStatus?.length) {
    filteredFindings = filteredFindings.filter((f) => filterByStatus.includes(f.status));
  }

  const displayFindings = maxItems ? filteredFindings.slice(0, maxItems) : filteredFindings;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Security Findings
        </h3>
        <SeveritySummary findings={findings} />
      </div>

      {/* Findings Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-slate-800/50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Severity
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Issue
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                PR
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {displayFindings.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                  <Shield className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  No security findings
                </td>
              </tr>
            ) : (
              displayFindings.map((finding) => (
                <FindingRow
                  key={finding.id}
                  finding={finding}
                  onViewDetails={onViewDetails}
                  onResolve={onResolve}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Show more */}
      {maxItems && filteredFindings.length > maxItems && (
        <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-700 text-center">
          <button className="text-sm text-cyan-600 dark:text-cyan-400 hover:underline">
            View all {filteredFindings.length} findings
          </button>
        </div>
      )}
    </div>
  );
}

interface FindingRowProps {
  finding: SecurityFinding;
  onViewDetails?: (id: string) => void;
  onResolve?: (id: string) => void;
}

function FindingRow({ finding, onViewDetails, onResolve }: FindingRowProps) {
  const severity = severityConfig[finding.severity];
  const status = statusConfig[finding.status];

  return (
    <tr className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
      {/* Severity */}
      <td className="px-4 py-3">
        <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded ${severity.bgColor} ${severity.color}`}>
          {severity.icon}
          {severity.label}
        </span>
      </td>

      {/* Issue */}
      <td className="px-4 py-3">
        <div className="max-w-md">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {finding.title}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-1">
            {finding.description}
          </p>
          {(finding.cweId || finding.owaspCategory) && (
            <div className="flex items-center gap-2 mt-1">
              {finding.cweId && (
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  {finding.cweId}
                </span>
              )}
              {finding.owaspCategory && (
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  {finding.owaspCategory}
                </span>
              )}
            </div>
          )}
        </div>
      </td>

      {/* PR */}
      <td className="px-4 py-3">
        {finding.prNumber ? (
          <a
            href={finding.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-purple-600 dark:text-purple-400 hover:underline"
          >
            <GitPullRequest className="h-4 w-4" />
            ***REMOVED***{finding.prNumber}
          </a>
        ) : (
          <span className="text-sm text-slate-400">-</span>
        )}
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        <span className={`px-2 py-1 text-xs font-medium rounded ${status.bgColor} ${status.color}`}>
          {status.label}
        </span>
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {onViewDetails && (
            <button
              onClick={() => onViewDetails(finding.id)}
              className="p-1.5 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors"
              title="View details"
            >
              <ExternalLink className="h-4 w-4" />
            </button>
          )}
          {onResolve && finding.status === 'open' && (
            <button
              onClick={() => onResolve(finding.id)}
              className="p-1.5 text-emerald-600 hover:text-emerald-700 dark:hover:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 rounded transition-colors"
              title="Mark as resolved"
            >
              <CheckCircle className="h-4 w-4" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function SeveritySummary({ findings }: { findings: SecurityFinding[] }) {
  const counts = {
    critical: findings.filter((f) => f.severity === 'critical' && f.status === 'open').length,
    high: findings.filter((f) => f.severity === 'high' && f.status === 'open').length,
    medium: findings.filter((f) => f.severity === 'medium' && f.status === 'open').length,
    low: findings.filter((f) => f.severity === 'low' && f.status === 'open').length,
  };

  return (
    <div className="flex items-center gap-3">
      {counts.critical > 0 && (
        <span className="flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
          <AlertCircle className="h-3 w-3" />
          {counts.critical}
        </span>
      )}
      {counts.high > 0 && (
        <span className="flex items-center gap-1 text-xs font-medium text-orange-600 dark:text-orange-400">
          <AlertTriangle className="h-3 w-3" />
          {counts.high}
        </span>
      )}
      {counts.medium > 0 && (
        <span className="flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
          {counts.medium} med
        </span>
      )}
      {counts.low > 0 && (
        <span className="flex items-center gap-1 text-xs font-medium text-cyan-600 dark:text-cyan-400">
          {counts.low} low
        </span>
      )}
      {!counts.critical && !counts.high && !counts.medium && !counts.low && (
        <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          <CheckCircle className="h-3 w-3" />
          All clear
        </span>
      )}
    </div>
  );
}

// Compact security badge for headers
interface SecurityBadgeProps {
  criticalCount: number;
  highCount: number;
  onClick?: () => void;
}

export function SecurityBadge({ criticalCount, highCount, onClick }: SecurityBadgeProps) {
  const totalSevere = criticalCount + highCount;

  if (totalSevere === 0) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded-full">
        <Shield className="h-4 w-4" />
        <span className="text-sm font-medium">Secure</span>
      </div>
    );
  }

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors ${
        criticalCount > 0
          ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50'
          : 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-900/50'
      }`}
    >
      <AlertTriangle className="h-4 w-4" />
      <span className="text-sm font-medium">
        {criticalCount > 0 ? `${criticalCount} critical` : `${highCount} high`}
      </span>
    </button>
  );
}

export default SecurityFindings;

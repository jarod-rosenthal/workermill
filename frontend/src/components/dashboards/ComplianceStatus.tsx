import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  FileCheck,
} from 'lucide-react';
import type { ComplianceItem } from '../../types/dashboard';

const statusConfig: Record<string, { color: string; bgColor: string; icon: React.ReactNode; label: string }> = {
  compliant: {
    color: 'text-emerald-600 dark:text-emerald-400',
    bgColor: 'bg-emerald-100 dark:bg-emerald-900/30',
    icon: <CheckCircle className="h-4 w-4" />,
    label: 'Compliant',
  },
  non_compliant: {
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    icon: <XCircle className="h-4 w-4" />,
    label: 'Non-Compliant',
  },
  partial: {
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-100 dark:bg-amber-900/30',
    icon: <AlertTriangle className="h-4 w-4" />,
    label: 'Partial',
  },
  not_applicable: {
    color: 'text-slate-500 dark:text-slate-400',
    bgColor: 'bg-slate-100 dark:bg-slate-800',
    icon: <Clock className="h-4 w-4" />,
    label: 'N/A',
  },
};

interface ComplianceStatusProps {
  items: ComplianceItem[];
  title?: string;
  compact?: boolean;
}

export function ComplianceStatus({ items, title = 'Compliance Status', compact = false }: ComplianceStatusProps) {
  if (compact) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
          <FileCheck className="h-5 w-5" />
          {title}
        </h4>
        <div className="space-y-3">
          {items.map((item) => (
            <ComplianceItemCompact key={item.framework} item={item} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <FileCheck className="h-5 w-5" />
          {title}
        </h3>
        <OverallComplianceScore items={items} />
      </div>

      {/* Items */}
      <div className="divide-y divide-slate-100 dark:divide-slate-700">
        {items.map((item) => (
          <ComplianceItemRow key={item.framework} item={item} />
        ))}
      </div>
    </div>
  );
}

function ComplianceItemRow({ item }: { item: ComplianceItem }) {
  const config = statusConfig[item.status];

  return (
    <div className="p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <span className="font-medium text-slate-900 dark:text-slate-100">
            {item.framework}
          </span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded ${config.bgColor} ${config.color}`}>
            {config.icon}
            {config.label}
          </span>
        </div>
        <span className="text-sm text-slate-600 dark:text-slate-400">
          {item.passedControls}/{item.totalControls} controls
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            item.status === 'compliant' ? 'bg-emerald-500' :
            item.status === 'partial' ? 'bg-amber-500' :
            item.status === 'non_compliant' ? 'bg-red-500' :
            'bg-slate-400'
          }`}
          style={{ width: `${item.progress}%` }}
        />
      </div>

      {/* Additional info */}
      <div className="flex items-center justify-between mt-2 text-xs text-slate-500 dark:text-slate-400">
        <span>{item.progress.toFixed(0)}% complete</span>
        {item.pendingItems > 0 && (
          <span className="text-amber-600 dark:text-amber-400">
            {item.pendingItems} items pending
          </span>
        )}
        {item.lastAudit && (
          <span>Last audit: {formatDate(item.lastAudit)}</span>
        )}
      </div>
    </div>
  );
}

function ComplianceItemCompact({ item }: { item: ComplianceItem }) {
  const config = statusConfig[item.status];

  return (
    <div className="flex items-center gap-3">
      {/* Status icon */}
      <span className={config.color}>{config.icon}</span>

      {/* Framework name */}
      <span className="flex-1 text-sm font-medium text-slate-900 dark:text-slate-100">
        {item.framework}
      </span>

      {/* Progress */}
      <div className="w-20">
        <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${
              item.status === 'compliant' ? 'bg-emerald-500' :
              item.status === 'partial' ? 'bg-amber-500' :
              item.status === 'non_compliant' ? 'bg-red-500' :
              'bg-slate-400'
            }`}
            style={{ width: `${item.progress}%` }}
          />
        </div>
      </div>

      {/* Percentage */}
      <span className="text-xs text-slate-500 dark:text-slate-400 w-10 text-right">
        {item.progress.toFixed(0)}%
      </span>
    </div>
  );
}

function OverallComplianceScore({ items }: { items: ComplianceItem[] }) {
  const applicableItems = items.filter((i) => i.status !== 'not_applicable');
  const compliantItems = items.filter((i) => i.status === 'compliant');
  const score = applicableItems.length > 0
    ? Math.round((compliantItems.length / applicableItems.length) * 100)
    : 100;

  return (
    <div className="flex items-center gap-2">
      <span className={`text-sm font-medium ${
        score === 100 ? 'text-emerald-600 dark:text-emerald-400' :
        score >= 75 ? 'text-amber-600 dark:text-amber-400' :
        'text-red-600 dark:text-red-400'
      }`}>
        {score}% compliant
      </span>
      <span className="text-xs text-slate-500 dark:text-slate-400">
        ({compliantItems.length}/{applicableItems.length} frameworks)
      </span>
    </div>
  );
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Compliance badge for headers
interface ComplianceBadgeProps {
  score: number;
  onClick?: () => void;
}

export function ComplianceBadge({ score, onClick }: ComplianceBadgeProps) {
  const colorClass = score === 100
    ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
    : score >= 75
    ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
    : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300';

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-opacity hover:opacity-80 ${colorClass}`}
    >
      <FileCheck className="h-4 w-4" />
      <span className="text-sm font-medium">{score}%</span>
    </button>
  );
}

export default ComplianceStatus;

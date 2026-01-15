import { useState } from 'react';
import {
  History,
  CheckCircle,
  XCircle,
  Ban,
  User,
  Clock,
  Download,
  Search,
  ChevronDown,
  ChevronUp,
  Server,
  Key,
  FileText,
  Shield,
} from 'lucide-react';
import type { AuditLogEntry } from '../../types/dashboard';

const resultConfig: Record<string, { color: string; bgColor: string; icon: React.ReactNode }> = {
  success: {
    color: 'text-emerald-600 dark:text-emerald-400',
    bgColor: 'bg-emerald-100 dark:bg-emerald-900/30',
    icon: <CheckCircle className="h-4 w-4" />,
  },
  failure: {
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    icon: <XCircle className="h-4 w-4" />,
  },
  blocked: {
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-100 dark:bg-amber-900/30',
    icon: <Ban className="h-4 w-4" />,
  },
};

// Action icons based on action type
const actionIcons: Record<string, React.ReactNode> = {
  login: <Key className="h-4 w-4" />,
  logout: <Key className="h-4 w-4" />,
  create: <FileText className="h-4 w-4" />,
  update: <FileText className="h-4 w-4" />,
  delete: <FileText className="h-4 w-4" />,
  deploy: <Server className="h-4 w-4" />,
  approve: <CheckCircle className="h-4 w-4" />,
  reject: <XCircle className="h-4 w-4" />,
  access: <Shield className="h-4 w-4" />,
};

interface AuditTrailProps {
  entries: AuditLogEntry[];
  maxItems?: number;
  showFilters?: boolean;
  onExport?: () => void;
  title?: string;
}

export function AuditTrail({
  entries,
  maxItems,
  showFilters = false,
  onExport,
  title = 'Audit Trail',
}: AuditTrailProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  const [filterResult, setFilterResult] = useState<string | null>(null);

  let filteredEntries = entries;

  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    filteredEntries = filteredEntries.filter(
      (e) =>
        e.actor.toLowerCase().includes(query) ||
        e.action.toLowerCase().includes(query) ||
        e.resource.toLowerCase().includes(query) ||
        e.details?.toLowerCase().includes(query)
    );
  }

  if (filterResult) {
    filteredEntries = filteredEntries.filter((e) => e.result === filterResult);
  }

  const displayEntries = maxItems ? filteredEntries.slice(0, maxItems) : filteredEntries;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <History className="h-5 w-5" />
            {title}
          </h3>
          <div className="flex items-center gap-2">
            {onExport && (
              <button
                onClick={onExport}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                <Download className="h-4 w-4" />
                Export
              </button>
            )}
          </div>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="flex items-center gap-3 mt-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search logs..."
                className="w-full pl-9 pr-4 py-2 text-sm bg-slate-100 dark:bg-slate-700 border-0 rounded-lg focus:ring-2 focus:ring-cyan-500 text-slate-900 dark:text-slate-100 placeholder:text-slate-500"
              />
            </div>
            <select
              value={filterResult || ''}
              onChange={(e) => setFilterResult(e.target.value || null)}
              className="px-3 py-2 text-sm bg-slate-100 dark:bg-slate-700 border-0 rounded-lg focus:ring-2 focus:ring-cyan-500 text-slate-900 dark:text-slate-100"
            >
              <option value="">All Results</option>
              <option value="success">Success</option>
              <option value="failure">Failure</option>
              <option value="blocked">Blocked</option>
            </select>
          </div>
        )}
      </div>

      {/* Entries */}
      <div className="divide-y divide-slate-100 dark:divide-slate-700 max-h-96 overflow-y-auto">
        {displayEntries.length === 0 ? (
          <div className="py-8 text-center">
            <History className="h-8 w-8 text-slate-400 mx-auto mb-2" />
            <p className="text-sm text-slate-500 dark:text-slate-400">No audit entries found</p>
          </div>
        ) : (
          displayEntries.map((entry) => (
            <AuditEntryRow
              key={entry.id}
              entry={entry}
              isExpanded={expandedEntry === entry.id}
              onToggle={() => setExpandedEntry(expandedEntry === entry.id ? null : entry.id)}
            />
          ))
        )}
      </div>

      {/* Show more */}
      {maxItems && filteredEntries.length > maxItems && (
        <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-700 text-center">
          <button className="text-sm text-cyan-600 dark:text-cyan-400 hover:underline">
            View all {filteredEntries.length} entries
          </button>
        </div>
      )}
    </div>
  );
}

interface AuditEntryRowProps {
  entry: AuditLogEntry;
  isExpanded: boolean;
  onToggle: () => void;
}

function AuditEntryRow({ entry, isExpanded, onToggle }: AuditEntryRowProps) {
  const result = resultConfig[entry.result];
  const actionIcon = actionIcons[entry.action.toLowerCase()] || <FileText className="h-4 w-4" />;

  return (
    <div className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer"
        onClick={onToggle}
      >
        {/* Result indicator */}
        <span className={`${result.color}`}>{result.icon}</span>

        {/* Timestamp */}
        <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 w-24 flex-shrink-0">
          <Clock className="h-3 w-3" />
          {formatTimestamp(entry.timestamp)}
        </div>

        {/* Actor */}
        <div className="flex items-center gap-1 text-sm text-slate-700 dark:text-slate-300 w-32 flex-shrink-0">
          <User className="h-4 w-4 text-slate-400" />
          <span className="truncate">{entry.actor}</span>
        </div>

        {/* Action & Resource */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-slate-500">{actionIcon}</span>
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {entry.action}
            </span>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              on {entry.resource}
              {entry.resourceId && (
                <span className="text-xs ml-1">({entry.resourceId})</span>
              )}
            </span>
          </div>
        </div>

        {/* Expand button */}
        <button className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div className="px-4 pb-3 pt-0">
          <div className="ml-7 p-3 bg-slate-100 dark:bg-slate-700 rounded-lg text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="text-xs text-slate-500 dark:text-slate-400 uppercase">Timestamp</span>
                <p className="text-slate-900 dark:text-slate-100">
                  {new Date(entry.timestamp).toLocaleString()}
                </p>
              </div>
              {entry.ipAddress && (
                <div>
                  <span className="text-xs text-slate-500 dark:text-slate-400 uppercase">IP Address</span>
                  <p className="text-slate-900 dark:text-slate-100">{entry.ipAddress}</p>
                </div>
              )}
              <div>
                <span className="text-xs text-slate-500 dark:text-slate-400 uppercase">Result</span>
                <p className={`capitalize ${result.color}`}>{entry.result}</p>
              </div>
              {entry.details && (
                <div className="col-span-2">
                  <span className="text-xs text-slate-500 dark:text-slate-400 uppercase">Details</span>
                  <p className="text-slate-900 dark:text-slate-100">{entry.details}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;

  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Compact audit list for sidebar
interface AuditListCompactProps {
  entries: AuditLogEntry[];
  maxItems?: number;
}

export function AuditListCompact({ entries, maxItems = 5 }: AuditListCompactProps) {
  const displayEntries = entries.slice(0, maxItems);

  return (
    <div className="space-y-2">
      {displayEntries.map((entry) => {
        const result = resultConfig[entry.result];
        return (
          <div key={entry.id} className="flex items-center gap-2 text-sm">
            <span className={result.color}>{result.icon}</span>
            <span className="text-slate-600 dark:text-slate-400 truncate">
              {entry.actor} {entry.action.toLowerCase()} {entry.resource}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default AuditTrail;

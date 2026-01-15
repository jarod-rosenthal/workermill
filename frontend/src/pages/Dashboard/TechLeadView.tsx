import { useState, useEffect } from 'react';
import {
  Compass,
  RefreshCw,
  AlertCircle,
  GitPullRequest,
  AlertTriangle,
  Code,
  Layers,
} from 'lucide-react';
import { MetricGrid } from '../../components/dashboards/MetricTile';
import { ApprovalQueue } from '../../components/dashboards/ApprovalQueue';
import { ActivityFeed } from '../../components/dashboards/ActivityFeed';
import type {
  TechLeadDashboardData,
  MetricTileProps,
} from '../../types/dashboard';

// Mock data for development
const mockTechLeadData: TechLeadDashboardData = {
  codeReviews: [
    {
      id: '1',
      type: 'pr_review',
      title: 'Add caching layer to user service',
      description: 'Implements Redis caching for frequently accessed user data. Affects core service architecture.',
      requestedBy: 'AI Worker (Backend)',
      requestedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
      jiraKey: 'OCS-148',
      prUrl: 'https://github.com/example/repo/pull/48',
      prNumber: 48,
    },
    {
      id: '2',
      type: 'architecture',
      title: 'Database schema migration',
      description: 'Adds new tables for audit logging. Review for normalization and indexing.',
      requestedBy: 'AI Worker (Backend)',
      requestedAt: new Date(Date.now() - 4 * 3600000).toISOString(),
      jiraKey: 'OCS-146',
      prUrl: 'https://github.com/example/repo/pull/46',
      prNumber: 46,
    },
    {
      id: '3',
      type: 'pr_review',
      title: 'Refactor authentication middleware',
      description: 'Consolidates auth logic and adds support for API keys. Review for security implications.',
      requestedBy: 'AI Worker (Security)',
      requestedAt: new Date(Date.now() - 6 * 3600000).toISOString(),
      jiraKey: 'OCS-145',
      prUrl: 'https://github.com/example/repo/pull/45',
      prNumber: 45,
    },
  ],
  architectureDecisions: [
    {
      id: '1',
      title: 'Migrate to event-driven architecture',
      status: 'pending',
      requestedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
      impact: 'high',
    },
    {
      id: '2',
      title: 'Add GraphQL API layer',
      status: 'approved',
      requestedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
      impact: 'medium',
    },
    {
      id: '3',
      title: 'Implement microservices for payments',
      status: 'rejected',
      requestedAt: new Date(Date.now() - 14 * 86400000).toISOString(),
      impact: 'high',
    },
  ],
  technicalDebt: {
    total: 47,
    byCategory: {
      'Code Duplication': 12,
      'Missing Tests': 15,
      'Outdated Dependencies': 8,
      'Documentation': 7,
      'Performance': 5,
    },
  },
  activity: [
    {
      id: '1',
      type: 'pr_approved',
      title: 'Approved PR ***REMOVED***47 with minor comments',
      timestamp: new Date(Date.now() - 1 * 3600000).toISOString(),
      prUrl: 'https://github.com/example/repo/pull/47',
      severity: 'success',
    },
    {
      id: '2',
      type: 'pr_created',
      title: 'AI Worker created architectural PR',
      timestamp: new Date(Date.now() - 4 * 3600000).toISOString(),
      prUrl: 'https://github.com/example/repo/pull/46',
      severity: 'info',
    },
    {
      id: '3',
      type: 'escalation',
      title: 'Architecture review needed for OCS-148',
      timestamp: new Date(Date.now() - 6 * 3600000).toISOString(),
      jiraKey: 'OCS-148',
      severity: 'warning',
    },
  ],
};

interface TechLeadViewProps {
  onApproveReview?: (id: string) => void;
  onRejectReview?: (id: string) => void;
  onViewReviewDetails?: (id: string) => void;
}

export function TechLeadView({ onApproveReview, onRejectReview, onViewReviewDetails }: TechLeadViewProps) {
  const [data, setData] = useState<TechLeadDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    try {
      setData(mockTechLeadData);
      setError(null);
    } catch (err) {
      setError('Failed to load dashboard data');
      console.error('Error fetching tech lead dashboard:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  if (loading) {
    return <TechLeadViewSkeleton />;
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <p className="text-slate-600 dark:text-slate-400">{error || 'No data available'}</p>
          <button
            onClick={handleRefresh}
            className="mt-4 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const pendingDecisions = data.architectureDecisions.filter((d) => d.status === 'pending').length;
  const highImpactDecisions = data.architectureDecisions.filter(
    (d) => d.status === 'pending' && d.impact === 'high'
  ).length;

  const metrics: MetricTileProps[] = [
    {
      label: 'Pending Reviews',
      value: data.codeReviews.length,
      icon: <GitPullRequest className="h-5 w-5" />,
      color: data.codeReviews.length > 0 ? 'warning' : 'success',
    },
    {
      label: 'Architecture Decisions',
      value: pendingDecisions,
      icon: <Compass className="h-5 w-5" />,
      color: highImpactDecisions > 0 ? 'warning' : 'default',
    },
    {
      label: 'Technical Debt',
      value: data.technicalDebt.total,
      icon: <AlertTriangle className="h-5 w-5" />,
      color: data.technicalDebt.total > 50 ? 'error' : data.technicalDebt.total > 25 ? 'warning' : 'default',
    },
    {
      label: 'Code Quality',
      value: 'Good',
      icon: <Code className="h-5 w-5" />,
      color: 'success',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Tech Lead Dashboard
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            Architecture decisions and code reviews
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Metrics */}
      <MetricGrid metrics={metrics} columns={4} />

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content - spans 2 columns */}
        <div className="lg:col-span-2 space-y-6">
          {/* Code Reviews */}
          <section>
            <ApprovalQueue
              items={data.codeReviews}
              onApprove={onApproveReview}
              onReject={onRejectReview}
              onViewDetails={onViewReviewDetails}
              title="Pending Code Reviews"
            />
          </section>

          {/* Architecture Decisions */}
          <section>
            <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Layers className="h-5 w-5" />
                  Architecture Decisions
                </h3>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                {data.architectureDecisions.map((decision) => (
                  <ArchitectureDecisionRow key={decision.id} decision={decision} />
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Technical Debt Overview */}
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Technical Debt
            </h4>

            <div className="space-y-3">
              {Object.entries(data.technicalDebt.byCategory).map(([category, count]) => (
                <TechnicalDebtBar key={category} category={category} count={count} total={data.technicalDebt.total} />
              ))}
            </div>

            <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-400">Total Items</span>
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {data.technicalDebt.total}
                </span>
              </div>
            </div>
          </div>

          {/* Activity Feed */}
          <ActivityFeed
            activities={data.activity}
            title="Recent Activity"
            compact
            maxItems={8}
          />
        </div>
      </div>
    </div>
  );
}

interface ArchitectureDecisionRowProps {
  decision: {
    id: string;
    title: string;
    status: 'pending' | 'approved' | 'rejected';
    requestedAt: string;
    impact: 'low' | 'medium' | 'high';
  };
}

function ArchitectureDecisionRow({ decision }: ArchitectureDecisionRowProps) {
  const statusConfig = {
    pending: { color: 'text-amber-700 dark:text-amber-300', bgColor: 'bg-amber-100 dark:bg-amber-900/30', label: 'Pending' },
    approved: { color: 'text-emerald-700 dark:text-emerald-300', bgColor: 'bg-emerald-100 dark:bg-emerald-900/30', label: 'Approved' },
    rejected: { color: 'text-red-700 dark:text-red-300', bgColor: 'bg-red-100 dark:bg-red-900/30', label: 'Rejected' },
  };

  const impactConfig = {
    low: { color: 'text-cyan-700 dark:text-cyan-300', bgColor: 'bg-cyan-100 dark:bg-cyan-900/30' },
    medium: { color: 'text-amber-700 dark:text-amber-300', bgColor: 'bg-amber-100 dark:bg-amber-900/30' },
    high: { color: 'text-red-700 dark:text-red-300', bgColor: 'bg-red-100 dark:bg-red-900/30' },
  };

  const status = statusConfig[decision.status];
  const impact = impactConfig[decision.impact];

  return (
    <div className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{decision.title}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Requested {formatRelativeTime(decision.requestedAt)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className={`px-2 py-1 text-xs font-medium rounded ${impact.bgColor} ${impact.color}`}>
          {decision.impact} impact
        </span>
        <span className={`px-2 py-1 text-xs font-medium rounded ${status.bgColor} ${status.color}`}>
          {status.label}
        </span>
      </div>
    </div>
  );
}

function TechnicalDebtBar({ category, count, total }: { category: string; count: number; total: number }) {
  const percentage = (count / total) * 100;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-slate-600 dark:text-slate-400">{category}</span>
        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{count}</span>
      </div>
      <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-amber-500 rounded-full"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays < 1) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function TechLeadViewSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div>
          <div className="h-8 w-48 bg-slate-200 dark:bg-slate-700 rounded" />
          <div className="h-4 w-64 bg-slate-200 dark:bg-slate-700 rounded mt-2" />
        </div>
        <div className="h-10 w-24 bg-slate-200 dark:bg-slate-700 rounded" />
      </div>
      <div className="grid grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 bg-slate-200 dark:bg-slate-700 rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="h-80 bg-slate-200 dark:bg-slate-700 rounded-lg" />
          <div className="h-64 bg-slate-200 dark:bg-slate-700 rounded-lg" />
        </div>
        <div className="space-y-6">
          <div className="h-80 bg-slate-200 dark:bg-slate-700 rounded-lg" />
          <div className="h-96 bg-slate-200 dark:bg-slate-700 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export default TechLeadView;

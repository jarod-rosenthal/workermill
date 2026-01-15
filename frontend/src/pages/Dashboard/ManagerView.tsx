import { useState, useEffect } from 'react';
import {
  DollarSign,
  RefreshCw,
  AlertCircle,
  BarChart3,
  CheckCircle,
  Clock,
  Target,
} from 'lucide-react';
import { MetricGrid } from '../../components/dashboards/MetricTile';
import { CostMeter } from '../../components/dashboards/CostMeter';
import { ApprovalQueue } from '../../components/dashboards/ApprovalQueue';
import { TeamActivity } from '../../components/dashboards/TeamActivity';
import { ActivityFeed } from '../../components/dashboards/ActivityFeed';
import type {
  ManagerDashboardData,
  MetricTileProps,
} from '../../types/dashboard';

// Mock data for development
const mockManagerData: ManagerDashboardData = {
  teamPerformance: {
    dailyActivity: [
      { date: new Date(Date.now() - 6 * 86400000).toISOString(), tasks: 12, cost: 4.50, byPersona: { backend: 6, frontend: 4, devops: 2 } },
      { date: new Date(Date.now() - 5 * 86400000).toISOString(), tasks: 18, cost: 6.20, byPersona: { backend: 8, frontend: 7, devops: 3 } },
      { date: new Date(Date.now() - 4 * 86400000).toISOString(), tasks: 15, cost: 5.80, byPersona: { backend: 7, frontend: 5, devops: 3 } },
      { date: new Date(Date.now() - 3 * 86400000).toISOString(), tasks: 22, cost: 8.40, byPersona: { backend: 10, frontend: 8, devops: 4 } },
      { date: new Date(Date.now() - 2 * 86400000).toISOString(), tasks: 19, cost: 7.10, byPersona: { backend: 9, frontend: 6, devops: 4 } },
      { date: new Date(Date.now() - 1 * 86400000).toISOString(), tasks: 25, cost: 9.50, byPersona: { backend: 12, frontend: 9, devops: 4 } },
      { date: new Date().toISOString(), tasks: 8, cost: 3.20, byPersona: { backend: 4, frontend: 3, devops: 1 } },
    ],
    members: [
      { id: '1', name: 'Sarah Chen', email: 'sarah@company.com', role: 'tech_lead', tasksCompleted: 45, lastActive: new Date(Date.now() - 30 * 60000).toISOString() },
      { id: '2', name: 'Mike Johnson', email: 'mike@company.com', role: 'engineer', tasksCompleted: 38, lastActive: new Date(Date.now() - 2 * 3600000).toISOString() },
      { id: '3', name: 'Emily Davis', email: 'emily@company.com', role: 'engineer', tasksCompleted: 42, lastActive: new Date(Date.now() - 45 * 60000).toISOString() },
      { id: '4', name: 'Alex Kumar', email: 'alex@company.com', role: 'devops', tasksCompleted: 28, lastActive: new Date(Date.now() - 15 * 60000).toISOString() },
    ],
    summary: {
      totalTasks: 119,
      completedTasks: 98,
      failedTasks: 5,
      aiVsHumanSplit: { ai: 72, human: 28 },
      costSavings: 12450,
    },
  },
  pendingApprovals: [
    {
      id: '1',
      type: 'security',
      title: 'Database migration requires security review',
      description: 'Migration adds new PII columns to users table. Encryption and access controls need verification.',
      requestedBy: 'AI Worker (Backend)',
      requestedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
      jiraKey: 'OCS-145',
    },
    {
      id: '2',
      type: 'architecture',
      title: 'New API rate limiting implementation',
      description: 'Implementing rate limiting middleware that affects all endpoints. Architecture review recommended.',
      requestedBy: 'AI Worker (DevOps)',
      requestedAt: new Date(Date.now() - 4 * 3600000).toISOString(),
      jiraKey: 'OCS-142',
      prUrl: 'https://github.com/example/repo/pull/46',
      prNumber: 46,
    },
    {
      id: '3',
      type: 'cost',
      title: 'Task exceeded cost threshold',
      description: 'OCS-140 completed with $2.50 cost (threshold: $2.00). Review for optimization opportunities.',
      requestedBy: 'System',
      requestedAt: new Date(Date.now() - 6 * 3600000).toISOString(),
      jiraKey: 'OCS-140',
      reason: 'Cost exceeded budget threshold by 25%',
    },
  ],
  costs: {
    currentPeriodCost: 89.23,
    cumulativeCost: 456.78,
    budget: 150,
    breakdown: [
      { provider: 'Anthropic', amount: 64.50, percentage: 72, color: '#06b6d4' },
      { provider: 'OpenAI', amount: 18.90, percentage: 21, color: '#8b5cf6' },
      { provider: 'Compute', amount: 5.83, percentage: 7, color: '#f59e0b' },
    ],
    period: {
      start: new Date(Date.now() - 30 * 86400000).toISOString(),
      end: new Date().toISOString(),
    },
  },
  activity: [
    {
      id: '1',
      type: 'task_completed',
      title: 'OCS-148 completed successfully',
      description: 'Add user profile image upload',
      timestamp: new Date(Date.now() - 30 * 60000).toISOString(),
      jiraKey: 'OCS-148',
      severity: 'success',
    },
    {
      id: '2',
      type: 'pr_merged',
      title: 'PR #45 merged to main',
      timestamp: new Date(Date.now() - 2 * 3600000).toISOString(),
      prUrl: 'https://github.com/example/repo/pull/45',
      severity: 'success',
    },
    {
      id: '3',
      type: 'cost_alert',
      title: 'Daily cost alert triggered',
      description: 'Cost threshold exceeded for OCS-140',
      timestamp: new Date(Date.now() - 6 * 3600000).toISOString(),
      severity: 'warning',
    },
    {
      id: '4',
      type: 'task_failed',
      title: 'OCS-135 failed after 3 retries',
      description: 'Build errors in generated code',
      timestamp: new Date(Date.now() - 12 * 3600000).toISOString(),
      jiraKey: 'OCS-135',
      severity: 'error',
    },
    {
      id: '5',
      type: 'deployment_completed',
      title: 'Production deployment successful',
      timestamp: new Date(Date.now() - 24 * 3600000).toISOString(),
      severity: 'success',
    },
  ],
};

interface ManagerViewProps {
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onViewApprovalDetails?: (id: string) => void;
}

export function ManagerView({ onApprove, onReject, onViewApprovalDetails }: ManagerViewProps) {
  const [data, setData] = useState<ManagerDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    try {
      // For now, use mock data - will be replaced with real API call
      setData(mockManagerData);
      setError(null);
    } catch (err) {
      setError('Failed to load dashboard data');
      console.error('Error fetching manager dashboard:', err);
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
    return <ManagerViewSkeleton />;
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

  const completionRate = Math.round(
    (data.teamPerformance.summary.completedTasks / data.teamPerformance.summary.totalTasks) * 100
  );

  const metrics: MetricTileProps[] = [
    {
      label: 'Tasks Completed',
      value: data.teamPerformance.summary.completedTasks,
      change: { value: 23, type: 'increase', period: 'vs last week' },
      icon: <CheckCircle className="h-5 w-5" />,
      color: 'success',
    },
    {
      label: 'Completion Rate',
      value: `${completionRate}%`,
      icon: <Target className="h-5 w-5" />,
      color: completionRate >= 90 ? 'success' : completionRate >= 70 ? 'warning' : 'error',
    },
    {
      label: 'Period Cost',
      value: `$${data.costs.currentPeriodCost.toFixed(2)}`,
      icon: <DollarSign className="h-5 w-5" />,
      color: data.costs.budget && data.costs.currentPeriodCost > data.costs.budget ? 'warning' : 'default',
    },
    {
      label: 'Pending Approvals',
      value: data.pendingApprovals.length,
      icon: <Clock className="h-5 w-5" />,
      color: data.pendingApprovals.length > 0 ? 'warning' : 'default',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Manager Dashboard
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            Team performance and cost management
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

      {/* Key Metrics */}
      <MetricGrid metrics={metrics} columns={4} />

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content - spans 2 columns */}
        <div className="lg:col-span-2 space-y-6">
          {/* Team Performance */}
          <section>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-cyan-500" />
              Team Performance
            </h2>
            <TeamActivity data={data.teamPerformance} />
          </section>

          {/* Pending Approvals */}
          <section>
            <ApprovalQueue
              items={data.pendingApprovals}
              onApprove={onApprove}
              onReject={onReject}
              onViewDetails={onViewApprovalDetails}
              title="Pending Approvals"
            />
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Cost Overview */}
          <CostMeter data={data.costs} />

          {/* Recent Activity */}
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

function ManagerViewSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div>
          <div className="h-8 w-56 bg-slate-200 dark:bg-slate-700 rounded" />
          <div className="h-4 w-72 bg-slate-200 dark:bg-slate-700 rounded mt-2" />
        </div>
        <div className="h-10 w-24 bg-slate-200 dark:bg-slate-700 rounded" />
      </div>

      {/* Metrics skeleton */}
      <div className="grid grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 bg-slate-200 dark:bg-slate-700 rounded-lg" />
        ))}
      </div>

      {/* Content skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="h-96 bg-slate-200 dark:bg-slate-700 rounded-lg" />
          <div className="h-64 bg-slate-200 dark:bg-slate-700 rounded-lg" />
        </div>
        <div className="space-y-6">
          <div className="h-64 bg-slate-200 dark:bg-slate-700 rounded-lg" />
          <div className="h-96 bg-slate-200 dark:bg-slate-700 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export default ManagerView;

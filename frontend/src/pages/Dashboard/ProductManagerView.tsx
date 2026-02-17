import { useState, useEffect } from 'react';
import {
  FileText,
  RefreshCw,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Target,
  Clock,
  AlertTriangle,
  BarChart3,
  Layers,
} from 'lucide-react';
import { MetricGrid } from '../../components/dashboards/MetricTile';
import { ActivityFeed } from '../../components/dashboards/ActivityFeed';
import type {
  ProductManagerDashboardData,
  MetricTileProps,
} from '../../types/dashboard';

// Mock data for development
const mockPMData: ProductManagerDashboardData = {
  sprintProgress: {
    totalTickets: 24,
    completed: 16,
    inProgress: 5,
    blocked: 3,
  },
  ticketsByStatus: {
    'To Do': 5,
    'In Progress': 5,
    'In Review': 3,
    'Ready to Deploy': 4,
    'Done': 7,
  },
  velocity: {
    current: 42,
    average: 38,
    trend: 'up',
  },
  activity: [
    {
      id: '1',
      type: 'task_completed',
      title: 'APP-150 marked as Done',
      description: 'User profile settings page completed',
      timestamp: new Date(Date.now() - 2 * 3600000).toISOString(),
      jiraKey: 'APP-150',
      severity: 'success',
    },
    {
      id: '2',
      type: 'task_started',
      title: 'AI Worker started APP-152',
      timestamp: new Date(Date.now() - 4 * 3600000).toISOString(),
      jiraKey: 'APP-152',
      severity: 'info',
    },
    {
      id: '3',
      type: 'escalation',
      title: 'APP-148 blocked: requires API changes',
      timestamp: new Date(Date.now() - 6 * 3600000).toISOString(),
      jiraKey: 'APP-148',
      severity: 'warning',
    },
    {
      id: '4',
      type: 'pr_merged',
      title: 'PR ***REMOVED***45 merged for APP-145',
      timestamp: new Date(Date.now() - 12 * 3600000).toISOString(),
      jiraKey: 'APP-145',
      prUrl: 'https://github.com/example/repo/pull/45',
      severity: 'success',
    },
  ],
};

export function ProductManagerView() {
  const [data, setData] = useState<ProductManagerDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    try {
      setData(mockPMData);
      setError(null);
    } catch (err) {
      setError('Failed to load dashboard data');
      console.error('Error fetching PM dashboard:', err);
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
    return <PMViewSkeleton />;
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

  const sprintCompletion = Math.round((data.sprintProgress.completed / data.sprintProgress.totalTickets) * 100);
  const velocityChange = Math.round(((data.velocity.current - data.velocity.average) / data.velocity.average) * 100);

  const metrics: MetricTileProps[] = [
    {
      label: 'Sprint Progress',
      value: `${sprintCompletion}%`,
      change: { value: 12, type: 'increase', period: 'vs last sprint' },
      icon: <Target className="h-5 w-5" />,
      color: sprintCompletion >= 75 ? 'success' : sprintCompletion >= 50 ? 'warning' : 'error',
    },
    {
      label: 'Velocity',
      value: data.velocity.current,
      change: {
        value: Math.abs(velocityChange),
        type: data.velocity.trend === 'up' ? 'increase' : data.velocity.trend === 'down' ? 'decrease' : 'neutral',
        period: 'vs avg',
      },
      icon: <TrendingUp className="h-5 w-5" />,
      color: 'info',
    },
    {
      label: 'In Progress',
      value: data.sprintProgress.inProgress,
      icon: <Clock className="h-5 w-5" />,
      color: 'default',
    },
    {
      label: 'Blocked',
      value: data.sprintProgress.blocked,
      icon: <AlertTriangle className="h-5 w-5" />,
      color: data.sprintProgress.blocked > 0 ? 'error' : 'success',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Product Manager Dashboard
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            Sprint progress and ticket tracking
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
          {/* Sprint Progress */}
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
              <Target className="h-5 w-5" />
              Sprint Progress
            </h3>

            {/* Progress bar */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  {data.sprintProgress.completed} of {data.sprintProgress.totalTickets} tickets completed
                </span>
                <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {sprintCompletion}%
                </span>
              </div>
              <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{ width: `${sprintCompletion}%` }}
                />
              </div>
            </div>

            {/* Breakdown */}
            <div className="grid grid-cols-4 gap-4">
              <SprintStatCard
                label="To Do"
                value={data.sprintProgress.totalTickets - data.sprintProgress.completed - data.sprintProgress.inProgress - data.sprintProgress.blocked}
                color="slate"
              />
              <SprintStatCard
                label="In Progress"
                value={data.sprintProgress.inProgress}
                color="cyan"
              />
              <SprintStatCard
                label="Blocked"
                value={data.sprintProgress.blocked}
                color="red"
              />
              <SprintStatCard
                label="Completed"
                value={data.sprintProgress.completed}
                color="emerald"
              />
            </div>
          </div>

          {/* Ticket Status Distribution */}
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
              <Layers className="h-5 w-5" />
              Tickets by Status
            </h3>

            <div className="space-y-3">
              {Object.entries(data.ticketsByStatus).map(([status, count]) => (
                <StatusBar
                  key={status}
                  status={status}
                  count={count}
                  total={data.sprintProgress.totalTickets}
                />
              ))}
            </div>
          </div>

          {/* Velocity Chart */}
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Velocity Trend
            </h3>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                  {data.velocity.current}
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Story points this sprint
                </p>
              </div>
              <div className="text-right">
                <div className={`flex items-center gap-1 ${
                  data.velocity.trend === 'up' ? 'text-emerald-600 dark:text-emerald-400' :
                  data.velocity.trend === 'down' ? 'text-red-600 dark:text-red-400' :
                  'text-slate-500 dark:text-slate-400'
                }`}>
                  {data.velocity.trend === 'up' ? (
                    <TrendingUp className="h-5 w-5" />
                  ) : data.velocity.trend === 'down' ? (
                    <TrendingDown className="h-5 w-5" />
                  ) : null}
                  <span className="text-lg font-semibold">
                    {velocityChange > 0 ? '+' : ''}{velocityChange}%
                  </span>
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  vs {data.velocity.average} avg
                </p>
              </div>
            </div>

            {/* Simple sparkline representation */}
            <div className="mt-6 flex items-end gap-1 h-16">
              {[32, 35, 38, 36, 40, 38, data.velocity.current].map((value, index) => (
                <div
                  key={index}
                  className={`flex-1 rounded-t ${
                    index === 6 ? 'bg-cyan-500' : 'bg-slate-300 dark:bg-slate-600'
                  }`}
                  style={{ height: `${(value / 50) * 100}%` }}
                />
              ))}
            </div>
            <div className="flex justify-between mt-2 text-xs text-slate-500 dark:text-slate-400">
              <span>Sprint 1</span>
              <span>Current</span>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Quick Stats */}
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Quick Stats
            </h4>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">AI Worker Tasks</span>
                <span className="font-medium text-slate-900 dark:text-slate-100">18</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">Human Tasks</span>
                <span className="font-medium text-slate-900 dark:text-slate-100">6</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">Automation Rate</span>
                <span className="font-medium text-emerald-600 dark:text-emerald-400">75%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">Avg. Cycle Time</span>
                <span className="font-medium text-slate-900 dark:text-slate-100">2.3 days</span>
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

function SprintStatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: 'slate' | 'cyan' | 'red' | 'emerald';
}) {
  const colorClasses = {
    slate: 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300',
    cyan: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300',
    red: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    emerald: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  };

  return (
    <div className={`rounded-lg p-4 text-center ${colorClasses[color]}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm opacity-75">{label}</p>
    </div>
  );
}

function StatusBar({ status, count, total }: { status: string; count: number; total: number }) {
  const percentage = (count / total) * 100;
  const statusColors: Record<string, string> = {
    'To Do': 'bg-slate-400',
    'In Progress': 'bg-cyan-500',
    'In Review': 'bg-purple-500',
    'Ready to Deploy': 'bg-amber-500',
    'Done': 'bg-emerald-500',
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-slate-600 dark:text-slate-400">{status}</span>
        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{count}</span>
      </div>
      <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${statusColors[status] || 'bg-slate-400'}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function PMViewSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div>
          <div className="h-8 w-56 bg-slate-200 dark:bg-slate-700 rounded" />
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
          <div className="h-64 bg-slate-200 dark:bg-slate-700 rounded-lg" />
          <div className="h-48 bg-slate-200 dark:bg-slate-700 rounded-lg" />
          <div className="h-48 bg-slate-200 dark:bg-slate-700 rounded-lg" />
        </div>
        <div className="space-y-6">
          <div className="h-48 bg-slate-200 dark:bg-slate-700 rounded-lg" />
          <div className="h-96 bg-slate-200 dark:bg-slate-700 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export default ProductManagerView;

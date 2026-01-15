import { useState, useEffect } from 'react';
import {
  Code,
  GitPullRequest,
  CheckCircle,
  ExternalLink,
  RefreshCw,
  Play,
  Eye,
  Terminal,
  AlertCircle,
} from 'lucide-react';
import { MetricGrid } from '../../components/dashboards/MetricTile';
import { TaskCard, TaskCardSkeleton } from '../../components/dashboards/TaskCard';
import { ActivityFeed } from '../../components/dashboards/ActivityFeed';
import type {
  EngineerDashboardData,
  MetricTileProps,
} from '../../types/dashboard';

// Mock data for development - will be replaced with real API calls
const mockEngineerData: EngineerDashboardData = {
  myTasks: {
    inProgress: [
      {
        id: '1',
        jiraKey: 'OCS-145',
        summary: 'Add user authentication middleware',
        status: 'executing',
        persona: 'backend_developer',
        model: 'Sonnet 4',
        provider: 'anthropic',
        steps: [
          { id: '1', label: 'Queued', status: 'completed' },
          { id: '2', label: 'Executing', status: 'active' },
          { id: '3', label: 'PR', status: 'pending' },
          { id: '4', label: 'Review', status: 'pending' },
          { id: '5', label: 'Deploy', status: 'pending' },
        ],
        estimatedCost: 0.45,
        duration: 12,
        filesChanged: 3,
        linesAdded: 142,
        linesRemoved: 23,
        createdAt: new Date(Date.now() - 15 * 60000).toISOString(),
        startedAt: new Date(Date.now() - 12 * 60000).toISOString(),
      },
    ],
    needsReview: [
      {
        id: '2',
        jiraKey: 'OCS-142',
        summary: 'Fix null pointer in user service',
        status: 'review_requested',
        persona: 'backend_developer',
        model: 'Haiku 4.5',
        provider: 'anthropic',
        steps: [
          { id: '1', label: 'Queued', status: 'completed' },
          { id: '2', label: 'Executing', status: 'completed' },
          { id: '3', label: 'PR', status: 'completed' },
          { id: '4', label: 'Review', status: 'active' },
          { id: '5', label: 'Deploy', status: 'pending' },
        ],
        prUrl: 'https://github.com/example/repo/pull/45',
        prNumber: 45,
        estimatedCost: 0.12,
        duration: 8,
        filesChanged: 1,
        linesAdded: 15,
        linesRemoved: 3,
        createdAt: new Date(Date.now() - 45 * 60000).toISOString(),
        startedAt: new Date(Date.now() - 40 * 60000).toISOString(),
        completedAt: new Date(Date.now() - 32 * 60000).toISOString(),
      },
    ],
    readyToDeploy: [
      {
        id: '3',
        jiraKey: 'OCS-139',
        summary: 'Update API documentation',
        status: 'approved',
        persona: 'tech_writer',
        model: 'Haiku 4.5',
        provider: 'anthropic',
        steps: [
          { id: '1', label: 'Queued', status: 'completed' },
          { id: '2', label: 'Executing', status: 'completed' },
          { id: '3', label: 'PR', status: 'completed' },
          { id: '4', label: 'Review', status: 'completed' },
          { id: '5', label: 'Deploy', status: 'pending' },
        ],
        prUrl: 'https://github.com/example/repo/pull/44',
        prNumber: 44,
        estimatedCost: 0.08,
        duration: 5,
        filesChanged: 4,
        linesAdded: 89,
        linesRemoved: 12,
        createdAt: new Date(Date.now() - 120 * 60000).toISOString(),
        startedAt: new Date(Date.now() - 115 * 60000).toISOString(),
        completedAt: new Date(Date.now() - 110 * 60000).toISOString(),
      },
    ],
  },
  recentPRs: [
    {
      id: '1',
      number: 45,
      title: 'Fix null pointer in user service',
      url: 'https://github.com/example/repo/pull/45',
      status: 'open',
      createdAt: new Date(Date.now() - 32 * 60000).toISOString(),
    },
    {
      id: '2',
      number: 44,
      title: 'Update API documentation',
      url: 'https://github.com/example/repo/pull/44',
      status: 'approved',
      createdAt: new Date(Date.now() - 110 * 60000).toISOString(),
    },
    {
      id: '3',
      number: 43,
      title: 'Add rate limiting to auth endpoints',
      url: 'https://github.com/example/repo/pull/43',
      status: 'merged',
      createdAt: new Date(Date.now() - 240 * 60000).toISOString(),
    },
  ],
  activity: [
    {
      id: '1',
      type: 'task_started',
      title: 'Task OCS-145 started executing',
      timestamp: new Date(Date.now() - 12 * 60000).toISOString(),
      jiraKey: 'OCS-145',
      severity: 'info',
    },
    {
      id: '2',
      type: 'pr_created',
      title: 'PR ***REMOVED***45 created for OCS-142',
      timestamp: new Date(Date.now() - 32 * 60000).toISOString(),
      jiraKey: 'OCS-142',
      prUrl: 'https://github.com/example/repo/pull/45',
      severity: 'success',
    },
    {
      id: '3',
      type: 'pr_approved',
      title: 'PR ***REMOVED***44 approved',
      timestamp: new Date(Date.now() - 60 * 60000).toISOString(),
      prUrl: 'https://github.com/example/repo/pull/44',
      severity: 'success',
    },
    {
      id: '4',
      type: 'pr_merged',
      title: 'PR ***REMOVED***43 merged to main',
      timestamp: new Date(Date.now() - 240 * 60000).toISOString(),
      prUrl: 'https://github.com/example/repo/pull/43',
      severity: 'success',
    },
  ],
};

interface EngineerViewProps {
  onViewTaskDetails?: (taskId: string) => void;
  onApproveTask?: (taskId: string) => void;
  onRejectTask?: (taskId: string) => void;
}

export function EngineerView({ onViewTaskDetails, onApproveTask, onRejectTask }: EngineerViewProps) {
  const [data, setData] = useState<EngineerDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    try {
      // For now, use mock data - will be replaced with real API call
      // const response = await fetch(`${API_BASE}/api/dashboard/engineer`);
      // const data = await response.json();
      setData(mockEngineerData);
      setError(null);
    } catch (err) {
      setError('Failed to load dashboard data');
      console.error('Error fetching engineer dashboard:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  if (loading) {
    return <EngineerViewSkeleton />;
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

  const metrics: MetricTileProps[] = [
    {
      label: 'In Progress',
      value: data.myTasks.inProgress.length,
      icon: <Play className="h-5 w-5" />,
      color: 'info',
    },
    {
      label: 'Needs Review',
      value: data.myTasks.needsReview.length,
      icon: <Eye className="h-5 w-5" />,
      color: data.myTasks.needsReview.length > 0 ? 'warning' : 'default',
    },
    {
      label: 'Ready to Deploy',
      value: data.myTasks.readyToDeploy.length,
      icon: <CheckCircle className="h-5 w-5" />,
      color: data.myTasks.readyToDeploy.length > 0 ? 'success' : 'default',
    },
    {
      label: 'Recent PRs',
      value: data.recentPRs.length,
      icon: <GitPullRequest className="h-5 w-5" />,
      color: 'default',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Engineer Dashboard
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            Track your AI worker tasks and PRs
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
        {/* Tasks Column - spans 2 columns on large screens */}
        <div className="lg:col-span-2 space-y-6">
          {/* In Progress Tasks */}
          <section>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
              <Play className="h-5 w-5 text-cyan-500" />
              In Progress ({data.myTasks.inProgress.length})
            </h2>
            {data.myTasks.inProgress.length === 0 ? (
              <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-8 text-center">
                <Terminal className="h-8 w-8 text-slate-400 mx-auto mb-2" />
                <p className="text-slate-500 dark:text-slate-400">No tasks currently executing</p>
              </div>
            ) : (
              <div className="space-y-4">
                {data.myTasks.inProgress.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    showDetails
                    onViewDetails={onViewTaskDetails}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Needs Review */}
          <section>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
              <Eye className="h-5 w-5 text-amber-500" />
              Needs Review ({data.myTasks.needsReview.length})
            </h2>
            {data.myTasks.needsReview.length === 0 ? (
              <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-8 text-center">
                <CheckCircle className="h-8 w-8 text-slate-400 mx-auto mb-2" />
                <p className="text-slate-500 dark:text-slate-400">No PRs awaiting review</p>
              </div>
            ) : (
              <div className="space-y-4">
                {data.myTasks.needsReview.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    showDetails
                    onViewDetails={onViewTaskDetails}
                    onApprove={onApproveTask}
                    onReject={onRejectTask}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Ready to Deploy */}
          <section>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-emerald-500" />
              Ready to Deploy ({data.myTasks.readyToDeploy.length})
            </h2>
            {data.myTasks.readyToDeploy.length === 0 ? (
              <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-8 text-center">
                <Code className="h-8 w-8 text-slate-400 mx-auto mb-2" />
                <p className="text-slate-500 dark:text-slate-400">No tasks ready to deploy</p>
              </div>
            ) : (
              <div className="space-y-4">
                {data.myTasks.readyToDeploy.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    compact
                    onViewDetails={onViewTaskDetails}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Sidebar - Activity & PRs */}
        <div className="space-y-6">
          {/* Recent PRs */}
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
              <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <GitPullRequest className="h-5 w-5" />
                Recent PRs
              </h3>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {data.recentPRs.map((pr) => (
                <a
                  key={pr.id}
                  href={pr.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                >
                  <PRStatusIcon status={pr.status} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      ***REMOVED***{pr.number} {pr.title}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {formatRelativeTime(pr.createdAt)}
                    </p>
                  </div>
                  <ExternalLink className="h-4 w-4 text-slate-400 flex-shrink-0" />
                </a>
              ))}
            </div>
          </div>

          {/* Activity Feed */}
          <ActivityFeed
            activities={data.activity}
            title="Recent Activity"
            compact
            maxItems={10}
          />
        </div>
      </div>
    </div>
  );
}

function PRStatusIcon({ status }: { status: 'open' | 'approved' | 'merged' | 'closed' }) {
  switch (status) {
    case 'open':
      return <GitPullRequest className="h-4 w-4 text-emerald-500" />;
    case 'approved':
      return <CheckCircle className="h-4 w-4 text-purple-500" />;
    case 'merged':
      return <GitPullRequest className="h-4 w-4 text-purple-500" />;
    case 'closed':
      return <GitPullRequest className="h-4 w-4 text-red-500" />;
    default:
      return <GitPullRequest className="h-4 w-4 text-slate-400" />;
  }
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

function EngineerViewSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div>
          <div className="h-8 w-48 bg-slate-200 dark:bg-slate-700 rounded" />
          <div className="h-4 w-64 bg-slate-200 dark:bg-slate-700 rounded mt-2" />
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
          {[1, 2, 3].map((i) => (
            <div key={i}>
              <div className="h-6 w-32 bg-slate-200 dark:bg-slate-700 rounded mb-4" />
              <TaskCardSkeleton />
            </div>
          ))}
        </div>
        <div className="space-y-6">
          <div className="h-64 bg-slate-200 dark:bg-slate-700 rounded-lg" />
          <div className="h-96 bg-slate-200 dark:bg-slate-700 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export default EngineerView;

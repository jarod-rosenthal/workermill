import { useState, useEffect } from 'react';
import {
  TestTube,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
  BarChart3,
  Play,
  Percent,
  FileCheck,
} from 'lucide-react';
import { MetricGrid } from '../../components/dashboards/MetricTile';
import { ActivityFeed } from '../../components/dashboards/ActivityFeed';
import type {
  QADashboardData,
  MetricTileProps,
} from '../../types/dashboard';

// Mock data for development
const mockQAData: QADashboardData = {
  testMetrics: {
    totalTests: 1247,
    passed: 1198,
    failed: 23,
    skipped: 26,
    coverage: 84.7,
  },
  recentTestRuns: [
    {
      id: '1',
      name: 'Full Test Suite',
      status: 'passed',
      duration: 245,
      timestamp: new Date(Date.now() - 30 * 60000).toISOString(),
    },
    {
      id: '2',
      name: 'Unit Tests',
      status: 'passed',
      duration: 45,
      timestamp: new Date(Date.now() - 2 * 3600000).toISOString(),
    },
    {
      id: '3',
      name: 'Integration Tests',
      status: 'failed',
      duration: 180,
      timestamp: new Date(Date.now() - 4 * 3600000).toISOString(),
    },
    {
      id: '4',
      name: 'E2E Tests',
      status: 'running',
      duration: 0,
      timestamp: new Date().toISOString(),
    },
    {
      id: '5',
      name: 'Security Tests',
      status: 'passed',
      duration: 120,
      timestamp: new Date(Date.now() - 6 * 3600000).toISOString(),
    },
  ],
  activity: [
    {
      id: '1',
      type: 'task_completed',
      title: 'Test suite passed for PROJ-218',
      description: '47 tests passed, 0 failed',
      timestamp: new Date(Date.now() - 30 * 60000).toISOString(),
      jiraKey: 'PROJ-218',
      severity: 'success',
    },
    {
      id: '2',
      type: 'task_failed',
      title: 'Integration test failure',
      description: 'API timeout in auth flow test',
      timestamp: new Date(Date.now() - 4 * 3600000).toISOString(),
      severity: 'error',
    },
    {
      id: '3',
      type: 'pr_created',
      title: 'AI Worker added 12 new tests',
      timestamp: new Date(Date.now() - 6 * 3600000).toISOString(),
      prUrl: 'https://github.com/example/repo/pull/47',
      severity: 'info',
    },
  ],
};

interface QAViewProps {
  onRunTests?: (suiteId: string) => void;
  onViewTestDetails?: (runId: string) => void;
}

export function QAView({ onRunTests, onViewTestDetails }: QAViewProps) {
  const [data, setData] = useState<QADashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    try {
      setData(mockQAData);
      setError(null);
    } catch (err) {
      setError('Failed to load dashboard data');
      console.error('Error fetching QA dashboard:', err);
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
    return <QAViewSkeleton />;
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

  const passRate = Math.round((data.testMetrics.passed / data.testMetrics.totalTests) * 100);

  const metrics: MetricTileProps[] = [
    {
      label: 'Total Tests',
      value: data.testMetrics.totalTests.toLocaleString(),
      icon: <TestTube className="h-5 w-5" />,
      color: 'default',
    },
    {
      label: 'Pass Rate',
      value: `${passRate}%`,
      icon: <CheckCircle className="h-5 w-5" />,
      color: passRate >= 95 ? 'success' : passRate >= 80 ? 'warning' : 'error',
    },
    {
      label: 'Failed Tests',
      value: data.testMetrics.failed,
      icon: <XCircle className="h-5 w-5" />,
      color: data.testMetrics.failed > 0 ? 'error' : 'success',
    },
    {
      label: 'Coverage',
      value: `${data.testMetrics.coverage.toFixed(1)}%`,
      icon: <Percent className="h-5 w-5" />,
      color: data.testMetrics.coverage >= 80 ? 'success' : data.testMetrics.coverage >= 60 ? 'warning' : 'error',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            QA Dashboard
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            Test coverage, quality metrics, and test runs
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onRunTests?.('full')}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
          >
            <Play className="h-4 w-4" />
            Run Tests
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Metrics */}
      <MetricGrid metrics={metrics} columns={4} />

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content - spans 2 columns */}
        <div className="lg:col-span-2 space-y-6">
          {/* Test Results Overview */}
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Test Results Distribution
            </h3>
            <div className="flex items-center gap-4 mb-4">
              <div className="flex-1 h-8 bg-slate-200 dark:bg-slate-700 rounded-lg overflow-hidden flex">
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: `${(data.testMetrics.passed / data.testMetrics.totalTests) * 100}%` }}
                  title={`Passed: ${data.testMetrics.passed}`}
                />
                <div
                  className="h-full bg-red-500"
                  style={{ width: `${(data.testMetrics.failed / data.testMetrics.totalTests) * 100}%` }}
                  title={`Failed: ${data.testMetrics.failed}`}
                />
                <div
                  className="h-full bg-slate-400"
                  style={{ width: `${(data.testMetrics.skipped / data.testMetrics.totalTests) * 100}%` }}
                  title={`Skipped: ${data.testMetrics.skipped}`}
                />
              </div>
            </div>
            <div className="flex items-center justify-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-emerald-500 rounded" />
                <span className="text-slate-600 dark:text-slate-400">
                  Passed ({data.testMetrics.passed})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-red-500 rounded" />
                <span className="text-slate-600 dark:text-slate-400">
                  Failed ({data.testMetrics.failed})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-slate-400 rounded" />
                <span className="text-slate-600 dark:text-slate-400">
                  Skipped ({data.testMetrics.skipped})
                </span>
              </div>
            </div>
          </div>

          {/* Recent Test Runs */}
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
              <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Recent Test Runs
              </h3>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {data.recentTestRuns.map((run) => (
                <div
                  key={run.id}
                  className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer transition-colors"
                  onClick={() => onViewTestDetails?.(run.id)}
                >
                  <div className="flex items-center gap-3">
                    <TestRunStatusIcon status={run.status} />
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {run.name}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {formatRelativeTime(run.timestamp)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <TestRunStatusBadge status={run.status} />
                    {run.duration > 0 && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {formatDuration(run.duration)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Coverage Details */}
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
              <FileCheck className="h-5 w-5" />
              Code Coverage
            </h4>

            <div className="space-y-4">
              <CoverageBar label="Statements" value={data.testMetrics.coverage + 2} />
              <CoverageBar label="Branches" value={data.testMetrics.coverage - 5} />
              <CoverageBar label="Functions" value={data.testMetrics.coverage + 8} />
              <CoverageBar label="Lines" value={data.testMetrics.coverage} />
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

function TestRunStatusIcon({ status }: { status: 'passed' | 'failed' | 'running' }) {
  switch (status) {
    case 'passed':
      return <CheckCircle className="h-5 w-5 text-emerald-500" />;
    case 'failed':
      return <XCircle className="h-5 w-5 text-red-500" />;
    case 'running':
      return <RefreshCw className="h-5 w-5 text-cyan-500 animate-spin" />;
  }
}

function TestRunStatusBadge({ status }: { status: 'passed' | 'failed' | 'running' }) {
  const config = {
    passed: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
    failed: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    running: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300',
  };

  return (
    <span className={`px-2 py-1 text-xs font-medium rounded capitalize ${config[status]}`}>
      {status}
    </span>
  );
}

function CoverageBar({ label, value }: { label: string; value: number }) {
  const clampedValue = Math.min(Math.max(value, 0), 100);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-slate-600 dark:text-slate-400">{label}</span>
        <span className={`text-sm font-medium ${
          clampedValue >= 80 ? 'text-emerald-600 dark:text-emerald-400' :
          clampedValue >= 60 ? 'text-amber-600 dark:text-amber-400' :
          'text-red-600 dark:text-red-400'
        }`}>
          {clampedValue.toFixed(1)}%
        </span>
      </div>
      <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            clampedValue >= 80 ? 'bg-emerald-500' :
            clampedValue >= 60 ? 'bg-amber-500' :
            'bg-red-500'
          }`}
          style={{ width: `${clampedValue}%` }}
        />
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function QAViewSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div>
          <div className="h-8 w-40 bg-slate-200 dark:bg-slate-700 rounded" />
          <div className="h-4 w-64 bg-slate-200 dark:bg-slate-700 rounded mt-2" />
        </div>
        <div className="flex items-center gap-3">
          <div className="h-10 w-28 bg-slate-200 dark:bg-slate-700 rounded" />
          <div className="h-10 w-24 bg-slate-200 dark:bg-slate-700 rounded" />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 bg-slate-200 dark:bg-slate-700 rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="h-48 bg-slate-200 dark:bg-slate-700 rounded-lg" />
          <div className="h-80 bg-slate-200 dark:bg-slate-700 rounded-lg" />
        </div>
        <div className="space-y-6">
          <div className="h-64 bg-slate-200 dark:bg-slate-700 rounded-lg" />
          <div className="h-96 bg-slate-200 dark:bg-slate-700 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export default QAView;

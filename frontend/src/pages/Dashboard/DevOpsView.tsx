import { useState, useEffect } from 'react';
import {
  Server,
  Rocket,
  Activity,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  Pause,
  Play,
} from 'lucide-react';
import { MetricGrid } from '../../components/dashboards/MetricTile';
import { DeploymentPipeline, PipelineIndicator } from '../../components/dashboards/DeploymentPipeline';
import { HealthMonitor, HealthSummaryBar } from '../../components/dashboards/HealthMonitor';
import { ActivityFeed, ActivityAlert } from '../../components/dashboards/ActivityFeed';
import type {
  DevOpsDashboardData,
  MetricTileProps,
} from '../../types/dashboard';

// Mock data for development
const mockDevOpsData: DevOpsDashboardData = {
  pipeline: {
    stages: [
      { stage: 'build', status: 'passed', startedAt: new Date(Date.now() - 30 * 60000).toISOString(), completedAt: new Date(Date.now() - 28 * 60000).toISOString(), duration: 120 },
      { stage: 'test', status: 'passed', startedAt: new Date(Date.now() - 28 * 60000).toISOString(), completedAt: new Date(Date.now() - 22 * 60000).toISOString(), duration: 360 },
      { stage: 'review', status: 'running', startedAt: new Date(Date.now() - 22 * 60000).toISOString() },
      { stage: 'staging', status: 'pending' },
      { stage: 'production', status: 'pending' },
    ],
    currentDeployments: [
      {
        id: '1',
        service: 'API',
        version: '2.4.1',
        jiraKey: 'OCS-140',
        prNumber: 45,
        status: 'live',
        deployedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
        deployedBy: 'AI Worker',
        environment: 'production',
      },
      {
        id: '2',
        service: 'Frontend',
        version: '1.8.3',
        jiraKey: 'OCS-138',
        prNumber: 44,
        status: 'live',
        deployedAt: new Date(Date.now() - 5 * 3600000).toISOString(),
        deployedBy: 'AI Worker',
        environment: 'production',
      },
      {
        id: '3',
        service: 'Worker',
        version: '1.2.0',
        status: 'live',
        deployedAt: new Date(Date.now() - 24 * 3600000).toISOString(),
        deployedBy: 'manual',
        environment: 'production',
      },
    ],
    environment: 'production',
  },
  health: {
    services: [
      { name: 'API', status: 'healthy', latency: 45, uptime: 99.98, lastCheck: new Date().toISOString() },
      { name: 'Frontend', status: 'healthy', latency: 23, uptime: 99.99, lastCheck: new Date().toISOString() },
      { name: 'Database', status: 'degraded', latency: 120, uptime: 99.5, lastCheck: new Date().toISOString(), details: 'High CPU usage (87%)' },
      { name: 'Workers', status: 'healthy', latency: 89, uptime: 99.9, lastCheck: new Date().toISOString(), details: '3/3 healthy' },
      { name: 'Redis', status: 'healthy', latency: 5, uptime: 100, lastCheck: new Date().toISOString() },
    ],
    overallStatus: 'degraded',
    lastUpdated: new Date().toISOString(),
  },
  alerts: [
    {
      id: '1',
      type: 'escalation',
      title: 'Database CPU at 87%',
      description: 'Consider scaling or optimizing queries. Auto-scaling threshold is 90%.',
      timestamp: new Date(Date.now() - 15 * 60000).toISOString(),
      severity: 'warning',
    },
  ],
  deployments: [
    {
      id: '1',
      service: 'API',
      version: '2.4.1',
      jiraKey: 'OCS-140',
      prNumber: 45,
      status: 'live',
      deployedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
      deployedBy: 'AI Worker',
      environment: 'production',
    },
  ],
};

interface DevOpsViewProps {
  onRollback?: (deploymentId: string) => void;
  onViewLogs?: (deploymentId: string) => void;
  onPausePipeline?: () => void;
  onResumePipeline?: () => void;
}

export function DevOpsView({ onRollback, onViewLogs, onPausePipeline, onResumePipeline }: DevOpsViewProps) {
  const [data, setData] = useState<DevOpsDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pipelinePaused, setPipelinePaused] = useState(false);

  const fetchData = async () => {
    try {
      setData(mockDevOpsData);
      setError(null);
    } catch (err) {
      setError('Failed to load dashboard data');
      console.error('Error fetching devops dashboard:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000); // Faster refresh for DevOps
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const handlePauseToggle = () => {
    if (pipelinePaused) {
      onResumePipeline?.();
    } else {
      onPausePipeline?.();
    }
    setPipelinePaused(!pipelinePaused);
  };

  if (loading) {
    return <DevOpsViewSkeleton />;
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

  const healthyServices = data.health.services.filter((s) => s.status === 'healthy').length;
  const totalServices = data.health.services.length;
  const activeDeployments = data.deployments.filter((d) => d.status === 'live').length;
  const runningStages = data.pipeline.stages.filter((s) => s.status === 'running').length;

  const metrics: MetricTileProps[] = [
    {
      label: 'System Health',
      value: `${healthyServices}/${totalServices}`,
      icon: <Activity className="h-5 w-5" />,
      color: data.health.overallStatus === 'healthy' ? 'success' :
             data.health.overallStatus === 'degraded' ? 'warning' : 'error',
    },
    {
      label: 'Active Deployments',
      value: activeDeployments,
      icon: <Rocket className="h-5 w-5" />,
      color: 'info',
    },
    {
      label: 'Pipeline Status',
      value: runningStages > 0 ? 'Running' : 'Idle',
      icon: <Server className="h-5 w-5" />,
      color: runningStages > 0 ? 'info' : 'default',
    },
    {
      label: 'Alerts',
      value: data.alerts.length,
      icon: <AlertTriangle className="h-5 w-5" />,
      color: data.alerts.some((a) => a.severity === 'error') ? 'error' :
             data.alerts.length > 0 ? 'warning' : 'success',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            DevOps Dashboard
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            Deployments and system health monitoring
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Pipeline pause/resume */}
          <button
            onClick={handlePauseToggle}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              pipelinePaused
                ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-900/50'
                : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/50'
            }`}
          >
            {pipelinePaused ? (
              <>
                <Play className="h-4 w-4" />
                Resume Pipeline
              </>
            ) : (
              <>
                <Pause className="h-4 w-4" />
                Pause Pipeline
              </>
            )}
          </button>

          {/* Refresh */}
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

      {/* Alert Banner */}
      {data.alerts.length > 0 && data.alerts[0].severity !== 'info' && (
        <ActivityAlert activity={data.alerts[0]} />
      )}

      {/* Metrics */}
      <MetricGrid metrics={metrics} columns={4} />

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content - spans 2 columns */}
        <div className="lg:col-span-2 space-y-6">
          {/* Deployment Pipeline */}
          <section>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
              <Rocket className="h-5 w-5 text-cyan-500" />
              Deployment Pipeline
            </h2>
            <DeploymentPipeline
              data={data.pipeline}
              onRollback={onRollback}
              onViewLogs={onViewLogs}
            />
          </section>

          {/* System Health */}
          <section>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
              <Activity className="h-5 w-5 text-emerald-500" />
              System Health
            </h2>
            <HealthMonitor
              data={data.health}
              onRefresh={handleRefresh}
              refreshing={refreshing}
            />
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Quick Status */}
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">
              Quick Status
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">Environment</span>
                <span className={`px-2 py-1 text-xs font-medium rounded ${
                  data.pipeline.environment === 'production'
                    ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                    : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                }`}>
                  {data.pipeline.environment.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">Pipeline</span>
                <PipelineIndicator stages={data.pipeline.stages} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">Health</span>
                <HealthSummaryBar services={data.health.services} />
              </div>
            </div>
          </div>

          {/* Alerts Feed */}
          <ActivityFeed
            activities={data.alerts}
            title="Active Alerts"
            compact
            maxItems={5}
            emptyMessage="No active alerts"
          />

          {/* Recent Deployments Summary */}
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
              <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                Live Services
              </h3>
            </div>
            <div className="p-4 space-y-3">
              {data.deployments
                .filter((d) => d.status === 'live')
                .map((deployment) => (
                  <div
                    key={deployment.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-emerald-500 rounded-full" />
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {deployment.service}
                      </span>
                    </div>
                    <span className="text-slate-500 dark:text-slate-400">
                      v{deployment.version}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DevOpsViewSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div>
          <div className="h-8 w-48 bg-slate-200 dark:bg-slate-700 rounded" />
          <div className="h-4 w-72 bg-slate-200 dark:bg-slate-700 rounded mt-2" />
        </div>
        <div className="flex items-center gap-3">
          <div className="h-10 w-36 bg-slate-200 dark:bg-slate-700 rounded" />
          <div className="h-10 w-24 bg-slate-200 dark:bg-slate-700 rounded" />
        </div>
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
          <div className="h-64 bg-slate-200 dark:bg-slate-700 rounded-lg" />
          <div className="h-80 bg-slate-200 dark:bg-slate-700 rounded-lg" />
        </div>
        <div className="space-y-6">
          <div className="h-48 bg-slate-200 dark:bg-slate-700 rounded-lg" />
          <div className="h-64 bg-slate-200 dark:bg-slate-700 rounded-lg" />
          <div className="h-48 bg-slate-200 dark:bg-slate-700 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export default DevOpsView;

import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  HelpCircle,
  RefreshCw,
  Activity,
  Wifi,
} from 'lucide-react';
import type { HealthMonitorData, ServiceHealth, HealthStatus } from '../../types/dashboard';

const statusConfig: Record<HealthStatus, { color: string; bgColor: string; icon: React.ReactNode; label: string }> = {
  healthy: {
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-100 dark:bg-emerald-900/30',
    icon: <CheckCircle className="h-5 w-5" />,
    label: 'Healthy',
  },
  degraded: {
    color: 'text-amber-500',
    bgColor: 'bg-amber-100 dark:bg-amber-900/30',
    icon: <AlertTriangle className="h-5 w-5" />,
    label: 'Degraded',
  },
  unhealthy: {
    color: 'text-red-500',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    icon: <XCircle className="h-5 w-5" />,
    label: 'Unhealthy',
  },
  unknown: {
    color: 'text-slate-400',
    bgColor: 'bg-slate-100 dark:bg-slate-800',
    icon: <HelpCircle className="h-5 w-5" />,
    label: 'Unknown',
  },
};

interface HealthMonitorProps {
  data: HealthMonitorData;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function HealthMonitor({ data, onRefresh, refreshing }: HealthMonitorProps) {
  const overallConfig = statusConfig[data.overallStatus];

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${overallConfig.bgColor} ${overallConfig.color}`}>
            {overallConfig.icon}
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">System Health</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Last updated: {formatRelativeTime(data.lastUpdated)}
            </p>
          </div>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="p-2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        )}
      </div>

      {/* Services */}
      <div className="divide-y divide-slate-100 dark:divide-slate-700">
        {data.services.map((service) => (
          <ServiceHealthRow key={service.name} service={service} />
        ))}
      </div>
    </div>
  );
}

function ServiceHealthRow({ service }: { service: ServiceHealth }) {
  const config = statusConfig[service.status];

  return (
    <div className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
      <div className="flex items-center gap-3">
        {/* Status indicator */}
        <div className={`w-2.5 h-2.5 rounded-full ${
          service.status === 'healthy' ? 'bg-emerald-500' :
          service.status === 'degraded' ? 'bg-amber-500' :
          service.status === 'unhealthy' ? 'bg-red-500' :
          'bg-slate-400'
        }`} />

        {/* Service info */}
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {service.name}
          </p>
          {service.details && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {service.details}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Latency */}
        {service.latency !== undefined && (
          <div className="flex items-center gap-1 text-sm">
            <Activity className="h-4 w-4 text-slate-400" />
            <span className={`${
              service.latency < 100 ? 'text-emerald-600 dark:text-emerald-400' :
              service.latency < 500 ? 'text-amber-600 dark:text-amber-400' :
              'text-red-600 dark:text-red-400'
            }`}>
              {service.latency}ms
            </span>
          </div>
        )}

        {/* Uptime */}
        {service.uptime !== undefined && (
          <div className="flex items-center gap-1 text-sm">
            <Wifi className="h-4 w-4 text-slate-400" />
            <span className={`${
              service.uptime >= 99.9 ? 'text-emerald-600 dark:text-emerald-400' :
              service.uptime >= 99 ? 'text-amber-600 dark:text-amber-400' :
              'text-red-600 dark:text-red-400'
            }`}>
              {service.uptime.toFixed(1)}%
            </span>
          </div>
        )}

        {/* Status badge */}
        <span className={`px-2 py-1 text-xs font-medium rounded ${config.bgColor} ${config.color}`}>
          {config.label}
        </span>
      </div>
    </div>
  );
}

function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffMs / 60000);

  if (diffSecs < 60) return `${diffSecs}s ago`;
  if (diffMins < 60) return `${diffMins}m ago`;

  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Compact health indicator for headers
interface HealthIndicatorProps {
  status: HealthStatus;
  label?: string;
}

export function HealthIndicator({ status, label }: HealthIndicatorProps) {
  const config = statusConfig[status];

  return (
    <div className="flex items-center gap-2">
      <div className={`w-2.5 h-2.5 rounded-full ${
        status === 'healthy' ? 'bg-emerald-500' :
        status === 'degraded' ? 'bg-amber-500 animate-pulse' :
        status === 'unhealthy' ? 'bg-red-500 animate-pulse' :
        'bg-slate-400'
      }`} />
      {label && (
        <span className={`text-sm ${config.color}`}>
          {label}
        </span>
      )}
    </div>
  );
}

// Health summary bar for dashboard headers
interface HealthSummaryBarProps {
  services: ServiceHealth[];
}

export function HealthSummaryBar({ services }: HealthSummaryBarProps) {
  const healthy = services.filter((s) => s.status === 'healthy').length;
  const degraded = services.filter((s) => s.status === 'degraded').length;
  const unhealthy = services.filter((s) => s.status === 'unhealthy').length;
  const total = services.length;

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1">
        {services.map((service, index) => (
          <div
            key={index}
            className={`w-2 h-6 rounded-sm ${
              service.status === 'healthy' ? 'bg-emerald-500' :
              service.status === 'degraded' ? 'bg-amber-500' :
              service.status === 'unhealthy' ? 'bg-red-500' :
              'bg-slate-300 dark:bg-slate-600'
            }`}
            title={`${service.name}: ${service.status}`}
          />
        ))}
      </div>
      <div className="text-sm text-slate-600 dark:text-slate-400">
        {healthy}/{total} healthy
        {degraded > 0 && <span className="text-amber-500 ml-2">{degraded} degraded</span>}
        {unhealthy > 0 && <span className="text-red-500 ml-2">{unhealthy} down</span>}
      </div>
    </div>
  );
}

// Uptime chart (simple)
interface UptimeChartProps {
  uptimeHistory: number[]; // Last N periods (e.g., days) as percentages
}

export function UptimeChart({ uptimeHistory }: UptimeChartProps) {
  return (
    <div className="flex items-end gap-px h-8">
      {uptimeHistory.map((uptime, index) => (
        <div
          key={index}
          className={`flex-1 rounded-t ${
            uptime >= 99.9 ? 'bg-emerald-500' :
            uptime >= 99 ? 'bg-amber-500' :
            uptime >= 95 ? 'bg-orange-500' :
            'bg-red-500'
          }`}
          style={{ height: `${Math.max(uptime, 10)}%` }}
          title={`${uptime.toFixed(2)}%`}
        />
      ))}
    </div>
  );
}

export default HealthMonitor;

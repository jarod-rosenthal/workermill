import { useState, useEffect } from 'react';
import {
  Shield,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Eye,
  Ban,
} from 'lucide-react';
import { MetricGrid } from '../../components/dashboards/MetricTile';
import { SecurityFindings, SecurityBadge } from '../../components/dashboards/SecurityFindings';
import { ComplianceStatus, ComplianceBadge } from '../../components/dashboards/ComplianceStatus';
import { AuditTrail } from '../../components/dashboards/AuditTrail';
import type {
  SecurityDashboardData,
  MetricTileProps,
} from '../../types/dashboard';

// Mock data for development
const mockSecurityData: SecurityDashboardData = {
  findings: [
    {
      id: '1',
      severity: 'high',
      title: 'SQL Injection vulnerability detected',
      description: 'User input not properly sanitized in query builder. Potential for SQL injection attacks.',
      prNumber: 156,
      prUrl: 'https://github.com/example/repo/pull/156',
      status: 'blocked',
      detectedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
      cweId: 'CWE-89',
      owaspCategory: 'A03:2021 Injection',
    },
    {
      id: '2',
      severity: 'medium',
      title: 'Missing authentication check',
      description: 'API endpoint /api/admin/users lacks proper authentication middleware.',
      prNumber: 154,
      prUrl: 'https://github.com/example/repo/pull/154',
      status: 'resolved',
      detectedAt: new Date(Date.now() - 24 * 3600000).toISOString(),
      resolvedAt: new Date(Date.now() - 12 * 3600000).toISOString(),
      cweId: 'CWE-287',
      owaspCategory: 'A07:2021 Identification',
    },
    {
      id: '3',
      severity: 'medium',
      title: 'Hardcoded API secret in source code',
      description: 'Third-party API key found in config file. Should be moved to environment variables.',
      prNumber: 151,
      prUrl: 'https://github.com/example/repo/pull/151',
      status: 'blocked',
      detectedAt: new Date(Date.now() - 48 * 3600000).toISOString(),
      cweId: 'CWE-798',
      owaspCategory: 'A02:2021 Cryptographic',
    },
    {
      id: '4',
      severity: 'low',
      title: 'Verbose error logging in production',
      description: 'Stack traces being logged which may expose internal structure.',
      prNumber: 149,
      prUrl: 'https://github.com/example/repo/pull/149',
      status: 'accepted',
      detectedAt: new Date(Date.now() - 72 * 3600000).toISOString(),
    },
  ],
  auditLog: [
    {
      id: '1',
      timestamp: new Date(Date.now() - 15 * 60000).toISOString(),
      actor: 'AI Worker',
      action: 'access',
      resource: 'Production Secrets',
      details: 'Read-only access to database credentials',
      result: 'success',
    },
    {
      id: '2',
      timestamp: new Date(Date.now() - 30 * 60000).toISOString(),
      actor: 'Security Scanner',
      action: 'blocked',
      resource: 'PR #156',
      details: 'SQL injection vulnerability detected',
      result: 'blocked',
    },
    {
      id: '3',
      timestamp: new Date(Date.now() - 2 * 3600000).toISOString(),
      actor: 'john@company.com',
      action: 'approve',
      resource: 'Deployment',
      resourceId: 'deploy-2024-001',
      details: 'Approved production deployment',
      result: 'success',
      ipAddress: '10.0.1.42',
    },
    {
      id: '4',
      timestamp: new Date(Date.now() - 4 * 3600000).toISOString(),
      actor: 'AI Worker',
      action: 'create',
      resource: 'PR',
      resourceId: '#156',
      details: 'Created pull request with security changes',
      result: 'success',
    },
    {
      id: '5',
      timestamp: new Date(Date.now() - 6 * 3600000).toISOString(),
      actor: 'admin@company.com',
      action: 'update',
      resource: 'Security Policy',
      details: 'Updated CORS configuration',
      result: 'success',
      ipAddress: '10.0.1.50',
    },
  ],
  compliance: [
    {
      framework: 'SOC 2',
      status: 'compliant',
      progress: 100,
      totalControls: 89,
      passedControls: 89,
      pendingItems: 0,
      lastAudit: new Date(Date.now() - 30 * 86400000).toISOString(),
    },
    {
      framework: 'GDPR',
      status: 'compliant',
      progress: 100,
      totalControls: 45,
      passedControls: 45,
      pendingItems: 0,
      lastAudit: new Date(Date.now() - 60 * 86400000).toISOString(),
    },
    {
      framework: 'HIPAA',
      status: 'partial',
      progress: 78,
      totalControls: 54,
      passedControls: 42,
      pendingItems: 3,
      lastAudit: new Date(Date.now() - 15 * 86400000).toISOString(),
    },
    {
      framework: 'PCI DSS',
      status: 'not_applicable',
      progress: 0,
      totalControls: 0,
      passedControls: 0,
      pendingItems: 0,
    },
  ],
  metrics: {
    totalScanned: 156,
    issuesFound: 7,
    blocked: 2,
    resolved: 4,
  },
};

interface SecurityViewProps {
  onViewFindingDetails?: (id: string) => void;
  onResolveFinding?: (id: string) => void;
  onExportAuditLog?: () => void;
}

export function SecurityView({ onViewFindingDetails, onResolveFinding, onExportAuditLog }: SecurityViewProps) {
  const [data, setData] = useState<SecurityDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    try {
      setData(mockSecurityData);
      setError(null);
    } catch (err) {
      setError('Failed to load dashboard data');
      console.error('Error fetching security dashboard:', err);
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
    return <SecurityViewSkeleton />;
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

  const openFindings = data.findings.filter((f) => f.status === 'open' || f.status === 'blocked');
  const criticalCount = openFindings.filter((f) => f.severity === 'critical').length;
  const highCount = openFindings.filter((f) => f.severity === 'high').length;

  const compliantFrameworks = data.compliance.filter(
    (c) => c.status === 'compliant'
  ).length;
  const applicableFrameworks = data.compliance.filter(
    (c) => c.status !== 'not_applicable'
  ).length;
  const complianceScore = applicableFrameworks > 0
    ? Math.round((compliantFrameworks / applicableFrameworks) * 100)
    : 100;

  const metrics: MetricTileProps[] = [
    {
      label: 'PRs Scanned',
      value: data.metrics.totalScanned,
      icon: <Eye className="h-5 w-5" />,
      color: 'default',
    },
    {
      label: 'Issues Found',
      value: data.metrics.issuesFound,
      icon: <AlertTriangle className="h-5 w-5" />,
      color: data.metrics.issuesFound > 0 ? 'warning' : 'success',
    },
    {
      label: 'Blocked',
      value: data.metrics.blocked,
      icon: <Ban className="h-5 w-5" />,
      color: data.metrics.blocked > 0 ? 'error' : 'success',
    },
    {
      label: 'Resolved',
      value: data.metrics.resolved,
      icon: <CheckCircle className="h-5 w-5" />,
      color: 'success',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Security Dashboard
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            Security scanning, audits, and compliance
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SecurityBadge criticalCount={criticalCount} highCount={highCount} />
          <ComplianceBadge score={complianceScore} />
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
          {/* Security Findings */}
          <section>
            <SecurityFindings
              findings={data.findings}
              onViewDetails={onViewFindingDetails}
              onResolve={onResolveFinding}
            />
          </section>

          {/* Audit Trail */}
          <section>
            <AuditTrail
              entries={data.auditLog}
              showFilters
              onExport={onExportAuditLog}
            />
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Compliance Status */}
          <ComplianceStatus items={data.compliance} />

          {/* Quick Security Stats */}
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Security Overview
            </h4>

            <div className="space-y-4">
              {/* Findings by severity */}
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400 uppercase mb-2">
                  Open Findings by Severity
                </p>
                <div className="flex items-center gap-2">
                  <SeverityBar
                    label="Critical"
                    count={criticalCount}
                    color="bg-red-500"
                    total={openFindings.length || 1}
                  />
                  <SeverityBar
                    label="High"
                    count={highCount}
                    color="bg-orange-500"
                    total={openFindings.length || 1}
                  />
                  <SeverityBar
                    label="Medium"
                    count={openFindings.filter((f) => f.severity === 'medium').length}
                    color="bg-amber-500"
                    total={openFindings.length || 1}
                  />
                  <SeverityBar
                    label="Low"
                    count={openFindings.filter((f) => f.severity === 'low').length}
                    color="bg-cyan-500"
                    total={openFindings.length || 1}
                  />
                </div>
              </div>

              {/* Resolution rate */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-slate-500 dark:text-slate-400 uppercase">
                    Resolution Rate
                  </p>
                  <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {Math.round((data.metrics.resolved / (data.metrics.issuesFound || 1)) * 100)}%
                  </span>
                </div>
                <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full"
                    style={{
                      width: `${(data.metrics.resolved / (data.metrics.issuesFound || 1)) * 100}%`,
                    }}
                  />
                </div>
              </div>

              {/* Last scan time */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500 dark:text-slate-400">Last Scan</span>
                <span className="text-slate-900 dark:text-slate-100">5 minutes ago</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SeverityBar({
  label,
  count,
  color,
  total,
}: {
  label: string;
  count: number;
  color: string;
  total: number;
}) {
  const percentage = (count / total) * 100;

  return (
    <div className="flex-1" title={`${label}: ${count}`}>
      <div className="h-6 bg-slate-200 dark:bg-slate-700 rounded overflow-hidden">
        <div
          className={`h-full ${color} transition-all`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <p className="text-xs text-center text-slate-500 dark:text-slate-400 mt-1">
        {count}
      </p>
    </div>
  );
}

function SecurityViewSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div>
          <div className="h-8 w-52 bg-slate-200 dark:bg-slate-700 rounded" />
          <div className="h-4 w-72 bg-slate-200 dark:bg-slate-700 rounded mt-2" />
        </div>
        <div className="flex items-center gap-3">
          <div className="h-8 w-24 bg-slate-200 dark:bg-slate-700 rounded-full" />
          <div className="h-8 w-16 bg-slate-200 dark:bg-slate-700 rounded-full" />
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
          <div className="h-80 bg-slate-200 dark:bg-slate-700 rounded-lg" />
          <div className="h-96 bg-slate-200 dark:bg-slate-700 rounded-lg" />
        </div>
        <div className="space-y-6">
          <div className="h-80 bg-slate-200 dark:bg-slate-700 rounded-lg" />
          <div className="h-64 bg-slate-200 dark:bg-slate-700 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export default SecurityView;

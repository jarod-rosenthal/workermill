import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  Users,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Minus,
  Clock,
  CheckCircle,
  AlertCircle,
  Activity,
  Loader2,
  RefreshCw,
  ChevronRight,
  MessageSquare,
  Server,
  Zap,
  ExternalLink,
} from "lucide-react";
import { useAuthStore } from "../store/auth-store";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface PlatformStats {
  totalCustomers: number;
  activeCustomers: number;
  customersByPlan: Record<string, number>;
  newCustomersThisMonth: number;
  totalTasks: number;
  tasksThisMonth: number;
  avgTasksPerCustomer: number;
  openTickets: number;
  avgResolutionTimeHours: number;
  supportTasksThisMonth: number;
  platformCostsThisMonth: number;
  customerRevenueThisMonth: number;
  netMarginThisMonth: number;
  lifetimeRevenue: number;
  lifetimePlatformCosts: number;
}

interface CustomerSummary {
  id: string;
  name: string;
  slug: string;
  plan: string;
  createdAt: string;
  userCount: number;
  taskCount: number;
  lastTaskAt: string | null;
  cumulativeCostUsd: number;
  primaryProvider: string | null;
  scmProvider: string | null;
}

interface ROIMetrics {
  thisMonth: { revenue: number; costs: number; roi: number; margin: number };
  lastMonth: { revenue: number; costs: number; roi: number; margin: number };
  lifetime: { revenue: number; costs: number; roi: number; margin: number };
  trend: "up" | "down" | "stable";
}

interface SupportTicket {
  id: string;
  ticketKey: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  orgName: string;
  orgSlug: string | null;
}

interface PlatformTask {
  id: string;
  jiraIssueKey: string;
  summary: string;
  status: string;
  workerPersona: string;
  estimatedCostUsd: number;
  createdAt: string;
  completedAt: string | null;
  customerOrgName: string;
  customerOrgSlug: string | null;
}

interface HealthStatus {
  status: "healthy" | "degraded" | "unknown";
  metrics: {
    activeTasks: number;
    queuedTasks: number;
    stuckTasks: number;
    recentFailures: number;
  };
  timestamp: string;
}

export default function ManagementDashboard() {
  const tokens = useAuthStore((state) => state.tokens);
  const user = useAuthStore((state) => state.user);

  // Access control - only platform admins can view this page
  const hasAccess = user?.isPlatformAdmin === true;

  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [roi, setRoi] = useState<ROIMetrics | null>(null);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [platformTasks, setPlatformTasks] = useState<PlatformTask[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!tokens?.accessToken) return;

    try {
      setLoading(true);
      setError(null);

      const headers = { Authorization: `Bearer ${tokens.accessToken}` };

      // Fetch all data in parallel
      const [statsRes, customersRes, roiRes, ticketsRes, tasksRes, healthRes] = await Promise.all([
        fetch(`${API_BASE}/api/management/stats`, { headers }),
        fetch(`${API_BASE}/api/management/customers`, { headers }),
        fetch(`${API_BASE}/api/management/roi`, { headers }),
        fetch(`${API_BASE}/api/management/support-queue`, { headers }),
        fetch(`${API_BASE}/api/management/platform-tasks?limit=20`, { headers }),
        fetch(`${API_BASE}/api/management/health`, { headers }),
      ]);

      // Check for errors
      if (!statsRes.ok || !customersRes.ok || !roiRes.ok || !ticketsRes.ok || !tasksRes.ok) {
        throw new Error("Failed to fetch management data");
      }

      const [statsData, customersData, roiData, ticketsData, tasksData, healthData] = await Promise.all([
        statsRes.json(),
        customersRes.json(),
        roiRes.json(),
        ticketsRes.json(),
        tasksRes.json(),
        healthRes.ok ? healthRes.json() : null,
      ]);

      setStats(statsData);
      setCustomers(customersData.customers);
      setRoi(roiData);
      setTickets(ticketsData.tickets);
      setPlatformTasks(tasksData.tasks);
      setHealth(healthData);
    } catch (err) {
      console.error("Failed to fetch management data:", err);
      setError("Failed to load management dashboard data");
    } finally {
      setLoading(false);
    }
  }, [tokens?.accessToken]);

  useEffect(() => {
    if (hasAccess) {
      fetchData();
    }
  }, [fetchData, hasAccess]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const getTrendIcon = (trend: "up" | "down" | "stable") => {
    switch (trend) {
      case "up":
        return <TrendingUp className="w-4 h-4 text-green-500" />;
      case "down":
        return <TrendingDown className="w-4 h-4 text-red-500" />;
      default:
        return <Minus className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const statusColors: Record<string, string> = {
      healthy: "bg-green-500/10 text-green-500 border-green-500/20",
      degraded: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
      unknown: "bg-gray-500/10 text-gray-500 border-gray-500/20",
      open: "bg-blue-500/10 text-blue-500 border-blue-500/20",
      in_progress: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
      completed: "bg-green-500/10 text-green-500 border-green-500/20",
      failed: "bg-red-500/10 text-red-500 border-red-500/20",
      queued: "bg-gray-500/10 text-gray-500 border-gray-500/20",
      executing: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    };

    return (
      <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${statusColors[status] || statusColors.unknown}`}>
        {status.replace(/_/g, " ")}
      </span>
    );
  };

  const getPlanBadge = (plan: string) => {
    const planColors: Record<string, string> = {
      free: "bg-gray-500/10 text-gray-500",
      pro: "bg-purple-500/10 text-purple-500",
      enterprise: "bg-amber-500/10 text-amber-500",
    };

    return (
      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${planColors[plan] || planColors.free}`}>
        {plan}
      </span>
    );
  };

  // Access denied view
  if (!hasAccess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="bg-card rounded-lg border border-border p-8 max-w-md text-center">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">Access Denied</h2>
          <p className="text-muted-foreground mb-6">
            You don't have permission to view the Platform Management dashboard.
            This page is only accessible to platform administrators.
          </p>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Link
                to="/dashboard"
                className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-muted-foreground" />
              </Link>
              <div>
                <h1 className="text-xl font-semibold text-foreground">Platform Management</h1>
                <p className="text-sm text-muted-foreground">
                  WorkerMill platform operations dashboard
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {health && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Platform:</span>
                  {getStatusBadge(health.status)}
                </div>
              )}
              <button
                onClick={fetchData}
                disabled={loading}
                className="p-2 rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
                title="Refresh data"
              >
                <RefreshCw className={`w-5 h-5 text-muted-foreground ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading && !stats ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-6 text-center">
            <AlertCircle className="w-8 h-8 text-destructive mx-auto mb-2" />
            <p className="text-destructive">{error}</p>
            <button
              onClick={fetchData}
              className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              Try Again
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* ROI & Financial Summary */}
            {roi && stats && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-card rounded-lg border border-border p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">Revenue (MTD)</span>
                    <DollarSign className="w-4 h-4 text-green-500" />
                  </div>
                  <p className="text-2xl font-bold text-foreground">
                    {formatCurrency(roi.thisMonth.revenue)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Last month: {formatCurrency(roi.lastMonth.revenue)}
                  </p>
                </div>

                <div className="bg-card rounded-lg border border-border p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">Platform Costs (MTD)</span>
                    <Server className="w-4 h-4 text-orange-500" />
                  </div>
                  <p className="text-2xl font-bold text-foreground">
                    {formatCurrency(roi.thisMonth.costs)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Last month: {formatCurrency(roi.lastMonth.costs)}
                  </p>
                </div>

                <div className="bg-card rounded-lg border border-border p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">Net Margin (MTD)</span>
                    {getTrendIcon(roi.trend)}
                  </div>
                  <p className="text-2xl font-bold text-foreground">
                    {roi.thisMonth.margin.toFixed(1)}%
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Last month: {roi.lastMonth.margin.toFixed(1)}%
                  </p>
                </div>

                <div className="bg-card rounded-lg border border-border p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">ROI (MTD)</span>
                    <TrendingUp className="w-4 h-4 text-primary" />
                  </div>
                  <p className="text-2xl font-bold text-foreground">
                    {roi.thisMonth.roi.toFixed(1)}%
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Lifetime: {roi.lifetime.roi.toFixed(1)}%
                  </p>
                </div>
              </div>
            )}

            {/* Platform Health & Quick Stats */}
            {stats && health && (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                <div className="bg-card rounded-lg border border-border p-4 text-center">
                  <Building2 className="w-6 h-6 text-primary mx-auto mb-2" />
                  <p className="text-2xl font-bold text-foreground">{stats.totalCustomers}</p>
                  <p className="text-xs text-muted-foreground">Total Customers</p>
                </div>
                <div className="bg-card rounded-lg border border-border p-4 text-center">
                  <Users className="w-6 h-6 text-green-500 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-foreground">{stats.activeCustomers}</p>
                  <p className="text-xs text-muted-foreground">Active (30d)</p>
                </div>
                <div className="bg-card rounded-lg border border-border p-4 text-center">
                  <Zap className="w-6 h-6 text-blue-500 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-foreground">{stats.tasksThisMonth}</p>
                  <p className="text-xs text-muted-foreground">Tasks (MTD)</p>
                </div>
                <div className="bg-card rounded-lg border border-border p-4 text-center">
                  <Activity className="w-6 h-6 text-amber-500 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-foreground">{health.metrics.activeTasks}</p>
                  <p className="text-xs text-muted-foreground">Active Tasks</p>
                </div>
                <div className="bg-card rounded-lg border border-border p-4 text-center">
                  <Clock className="w-6 h-6 text-purple-500 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-foreground">{health.metrics.queuedTasks}</p>
                  <p className="text-xs text-muted-foreground">Queued</p>
                </div>
                <div className="bg-card rounded-lg border border-border p-4 text-center">
                  <MessageSquare className="w-6 h-6 text-rose-500 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-foreground">{stats.openTickets}</p>
                  <p className="text-xs text-muted-foreground">Open Tickets</p>
                </div>
              </div>
            )}

            {/* Customers Table */}
            <div className="bg-card rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h2 className="text-lg font-semibold text-foreground">
                  Customers ({customers.length})
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Organization
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Plan
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Users
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Tasks
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Providers
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Last Activity
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Cost
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">

                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {customers.map((customer) => (
                      <tr key={customer.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-medium text-foreground">{customer.name}</p>
                            <p className="text-xs text-muted-foreground">{customer.slug}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {getPlanBadge(customer.plan)}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          {customer.userCount}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          {customer.taskCount}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            {customer.primaryProvider && (
                              <span className="px-1.5 py-0.5 text-xs bg-blue-500/10 text-blue-500 rounded">
                                {customer.primaryProvider}
                              </span>
                            )}
                            {customer.scmProvider && (
                              <span className="px-1.5 py-0.5 text-xs bg-green-500/10 text-green-500 rounded">
                                {customer.scmProvider}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {customer.lastTaskAt ? formatDate(customer.lastTaskAt) : "Never"}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          {formatCurrency(customer.cumulativeCostUsd || 0)}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            to={`/management/customers/${customer.id}`}
                            className="p-1 rounded hover:bg-muted transition-colors"
                          >
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Two-column layout for Support Queue and Platform Tasks */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Support Queue */}
              <div className="bg-card rounded-lg border border-border overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-foreground">
                    Support Queue ({tickets.length})
                  </h2>
                  <Link
                    to="/support"
                    className="text-sm text-primary hover:text-primary/80 flex items-center gap-1"
                  >
                    View All <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>
                <div className="divide-y divide-border max-h-96 overflow-y-auto">
                  {tickets.length === 0 ? (
                    <div className="p-8 text-center">
                      <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" />
                      <p className="text-muted-foreground">No open tickets</p>
                    </div>
                  ) : (
                    tickets.map((ticket) => (
                      <Link
                        key={ticket.id}
                        to={`/support/${ticket.ticketKey}`}
                        className="block p-4 hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-mono text-xs text-muted-foreground">
                                {ticket.ticketKey}
                              </span>
                              {getStatusBadge(ticket.status)}
                            </div>
                            <p className="text-sm font-medium text-foreground truncate">
                              {ticket.subject}
                            </p>
                            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                              <span className="px-1.5 py-0.5 bg-primary/10 text-primary rounded">
                                {ticket.orgName}
                              </span>
                              <span>{formatDate(ticket.createdAt)}</span>
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                        </div>
                      </Link>
                    ))
                  )}
                </div>
              </div>

              {/* Platform Tasks (Support Agents) */}
              <div className="bg-card rounded-lg border border-border overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <h2 className="text-lg font-semibold text-foreground">
                    Platform Tasks ({platformTasks.length})
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Support agent tasks billed to platform
                  </p>
                </div>
                <div className="divide-y divide-border max-h-96 overflow-y-auto">
                  {platformTasks.length === 0 ? (
                    <div className="p-8 text-center">
                      <Activity className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-muted-foreground">No platform tasks</p>
                    </div>
                  ) : (
                    platformTasks.map((task) => (
                      <div
                        key={task.id}
                        className="p-4 hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-mono text-xs text-muted-foreground">
                                {task.jiraIssueKey}
                              </span>
                              {getStatusBadge(task.status)}
                            </div>
                            <p className="text-sm font-medium text-foreground truncate">
                              {task.summary}
                            </p>
                            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                              <span className="px-1.5 py-0.5 bg-purple-500/10 text-purple-500 rounded">
                                {task.workerPersona}
                              </span>
                              <span className="px-1.5 py-0.5 bg-primary/10 text-primary rounded">
                                {task.customerOrgName}
                              </span>
                              <span>{formatDate(task.createdAt)}</span>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-medium text-foreground">
                              {formatCurrency(task.estimatedCostUsd || 0)}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Platform Health Details */}
            {health && health.metrics.stuckTasks > 0 && (
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 text-yellow-500 shrink-0" />
                  <div>
                    <p className="font-medium text-foreground">Platform Health Warning</p>
                    <p className="text-sm text-muted-foreground">
                      {health.metrics.stuckTasks} stuck task(s) detected (running for more than 2 hours).
                      {health.metrics.recentFailures > 0 && ` ${health.metrics.recentFailures} failure(s) in the last hour.`}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useAuthStore } from "../store/auth-store";
import { AnalyticsSkeleton } from "../components/ui/skeleton";

interface UsageStats {
  plan: string;
  hours: {
    used: number;
    included: number;
    remaining: number;
    percent: number;
    isUnlimited: boolean;
  };
  billingPeriod: {
    start: string | null;
    daysUntilReset: number;
  };
}

interface TaskStats {
  total: number;
  completed: number;
  failed: number;
  deployed: number;
  inProgress: number;
}

interface DailyUsage {
  date: string;
  tasks: number;
  cost: number;
}

interface PrdMetrics {
  period: {
    days: number;
    startDate: string;
    endDate: string;
  };
  summary: {
    totalPrdWorkflows: number;
    completed: number;
    failed: number;
    inProgress: number;
    successRate: number;
  };
  costVariance: {
    totalPlannedCost: number;
    totalActualCost: number;
    avgVariancePercent: number;
    dataPoints: number;
  };
  planAccuracy: {
    totalPlannedStories: number;
    totalExecutedStories: number;
    accuracyPercent: number;
  };
  timeToCompletion: {
    byComplexity: Record<string, number>;
    byComplexityReadable: Record<string, string>;
  };
}

interface FailureCategory {
  category: string;
  label: string;
  count: number;
  percentage: number;
  examples: string[];
}

interface FailureMetrics {
  period: {
    days: number;
    startDate: string;
    endDate: string;
  };
  summary: {
    totalFailures: number;
    totalTasks: number;
    failureRate: number;
    retriedTasks: number;
    maxRetriesExhausted: number;
  };
  byCategory: FailureCategory[];
  byPersona: Array<{ persona: string; count: number }>;
  byModel: Array<{ model: string; count: number }>;
  weeklyTrend: Array<{ week: string; count: number }>;
}

interface EffectivenessMetrics {
  period: {
    days: number;
    startDate: string;
    endDate: string;
  };
  summary: {
    total: number;
    successful: number;
    deployed: number;
    failed: number;
    cancelled: number;
    escalated: number;
    reviewRejected: number;
    successRate: number;
    deploymentRate: number;
    firstAttemptRate: number;
    prAcceptanceRate: number;
    escalationRate: number;
  };
  prStats: {
    total: number;
    accepted: number;
    rejected: number;
    acceptanceRate: number;
  };
  byModel: Array<{
    model: string;
    total: number;
    successRate: number;
    deploymentRate: number;
    firstAttemptRate: number;
  }>;
  byPersona: Array<{
    persona: string;
    total: number;
    successRate: number;
    deploymentRate: number;
    firstAttemptRate: number;
  }>;
  trend: Array<{
    date: string;
    success: number;
    failed: number;
    deployed: number;
    total: number;
    successRate: number;
  }>;
}

interface CodeQualityMetrics {
  period: {
    days: number;
    startDate: string;
    endDate: string;
  };
  summary: {
    totalTasks: number;
    tasksWithMetrics: number;
    metricsRate: number;
    averageQualityScore: number;
    averageLintScore: number;
    averageTypecheckScore: number;
    averageTestScore: number;
    averageCoverageScore: number;
    averageSecurityScore: number;
  };
  scoreDistribution: {
    excellent: number;
    good: number;
    fair: number;
    poor: number;
  };
  byPersona: Array<{
    persona: string;
    taskCount: number;
    avgScore: number;
  }>;
  byModel: Array<{
    model: string;
    taskCount: number;
    avgScore: number;
  }>;
  trend: Array<{
    date: string;
    taskCount: number;
    avgScore: number;
  }>;
  lowQualityTasks: Array<{
    id: string;
    jiraKey: string | null;
    summary: string | null;
    qualityScore: number | null;
    lintScore: number | null;
    typecheckScore: number | null;
    testScore: number | null;
    coverageScore: number | null;
    securityScore: number | null;
    persona: string | null;
    model: string | null;
    completedAt: string | null;
  }>;
}

export default function Analytics() {
  const tokens = useAuthStore((state) => state.tokens);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [taskStats, setTaskStats] = useState<TaskStats | null>(null);
  const [dailyUsage, setDailyUsage] = useState<DailyUsage[]>([]);
  const [prdMetrics, setPrdMetrics] = useState<PrdMetrics | null>(null);
  const [failureMetrics, setFailureMetrics] = useState<FailureMetrics | null>(null);
  const [effectivenessMetrics, setEffectivenessMetrics] = useState<EffectivenessMetrics | null>(null);
  const [codeQualityMetrics, setCodeQualityMetrics] = useState<CodeQualityMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "90d">("30d");
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  useEffect(() => {
    fetchAnalytics();
  }, [tokens, timeRange]);

  async function fetchAnalytics() {
    setLoading(true);
    try {
      // Fetch billing subscription for compute hours usage
      const usageRes = await fetch("/api/billing/subscription", {
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      if (usageRes.ok) {
        const data = await usageRes.json();
        // Map subscription data to UsageStats interface
        setUsage({
          plan: data.plan.id,
          hours: {
            used: data.usage.hoursUsed,
            included: data.usage.hoursIncluded,
            remaining: data.usage.hoursRemaining,
            percent: data.usage.percentUsed,
            isUnlimited: data.usage.isUnlimited,
          },
          billingPeriod: {
            start: data.billing.periodStart,
            daysUntilReset: data.billing.daysRemaining,
          },
        });
      }

      // Fetch task statistics
      const statsRes = await fetch(`/api/analytics/tasks?range=${timeRange}`, {
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      if (statsRes.ok) {
        const data = await statsRes.json();
        setTaskStats(data.stats);
        setDailyUsage(data.daily || []);
      }

      // Fetch PRD workflow metrics
      const prdRes = await fetch(`/api/analytics/prd-metrics?range=${timeRange}`, {
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      if (prdRes.ok) {
        const data = await prdRes.json();
        setPrdMetrics(data);
      }

      // Fetch failure metrics
      const failureRes = await fetch(`/api/analytics/failures?range=${timeRange}`, {
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      if (failureRes.ok) {
        const data = await failureRes.json();
        setFailureMetrics(data);
      }

      // Fetch effectiveness metrics
      const effectivenessRes = await fetch(`/api/analytics/effectiveness?range=${timeRange}`, {
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      if (effectivenessRes.ok) {
        const data = await effectivenessRes.json();
        setEffectivenessMetrics(data);
      }

      // Fetch code quality metrics
      const codeQualityRes = await fetch(`/api/analytics/code-quality?range=${timeRange}`, {
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      if (codeQualityRes.ok) {
        const data = await codeQualityRes.json();
        setCodeQualityMetrics(data);
      }
    } catch (error) {
      console.error("Failed to fetch analytics:", error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <AnalyticsSkeleton />;
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-4">
          <Link
            to="/dashboard"
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Dashboard</span>
          </Link>
          <h1 className="text-2xl font-bold">Analytics</h1>
        </div>
        <div className="flex gap-2">
          {(["7d", "30d", "90d"] as const).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-3 py-1 text-sm rounded ${
                timeRange === range
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600"
              }`}
            >
              {range === "7d" ? "7 Days" : range === "30d" ? "30 Days" : "90 Days"}
            </button>
          ))}
        </div>
      </div>

      {/* Usage Overview */}
      {usage && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">Plan</p>
            <p className="text-2xl font-bold capitalize">{usage.plan}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Hours Used
            </p>
            <p className="text-2xl font-bold">
              {usage.hours.isUnlimited
                ? `${usage.hours.used.toFixed(1)}h`
                : `${usage.hours.used.toFixed(1)}h / ${usage.hours.included}h`}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Hours Remaining
            </p>
            <p className="text-2xl font-bold">
              {usage.hours.isUnlimited ? "∞" : `${usage.hours.remaining.toFixed(1)}h`}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Days Until Reset
            </p>
            <p className="text-2xl font-bold">{usage.billingPeriod.daysUntilReset}</p>
          </div>
        </div>
      )}

      {/* Worker Effectiveness - Automatic metrics from task states */}
      {effectivenessMetrics && effectivenessMetrics.summary.total > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">Worker Effectiveness</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            Automatically calculated from task outcomes - no manual input required
          </p>

          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <div className="text-center p-3 bg-green-50 dark:bg-green-900/30 rounded">
              <p className="text-2xl font-bold text-green-600">
                {effectivenessMetrics.summary.successRate}%
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Success Rate</p>
            </div>
            <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/30 rounded">
              <p className="text-2xl font-bold text-blue-600">
                {effectivenessMetrics.summary.deploymentRate}%
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Deployment Rate</p>
            </div>
            <div className="text-center p-3 bg-purple-50 dark:bg-purple-900/30 rounded">
              <p className="text-2xl font-bold text-purple-600">
                {effectivenessMetrics.summary.firstAttemptRate}%
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">First Attempt</p>
            </div>
            <div className="text-center p-3 bg-cyan-50 dark:bg-cyan-900/30 rounded">
              <p className="text-2xl font-bold text-cyan-600">
                {effectivenessMetrics.summary.prAcceptanceRate}%
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">PR Acceptance</p>
            </div>
            <div className="text-center p-3 bg-gray-50 dark:bg-gray-700 rounded">
              <p className="text-2xl font-bold">{effectivenessMetrics.summary.total}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Tasks</p>
            </div>
          </div>

          {/* Outcome Breakdown */}
          <div className="mb-6">
            <div className="flex h-4 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700">
              <div
                className="bg-blue-500"
                style={{
                  width: `${(effectivenessMetrics.summary.deployed / effectivenessMetrics.summary.total) * 100}%`,
                }}
                title={`Deployed: ${effectivenessMetrics.summary.deployed}`}
              ></div>
              <div
                className="bg-green-500"
                style={{
                  width: `${((effectivenessMetrics.summary.successful - effectivenessMetrics.summary.deployed) / effectivenessMetrics.summary.total) * 100}%`,
                }}
                title={`Completed: ${effectivenessMetrics.summary.successful - effectivenessMetrics.summary.deployed}`}
              ></div>
              <div
                className="bg-red-500"
                style={{
                  width: `${(effectivenessMetrics.summary.failed / effectivenessMetrics.summary.total) * 100}%`,
                }}
                title={`Failed: ${effectivenessMetrics.summary.failed}`}
              ></div>
              <div
                className="bg-yellow-500"
                style={{
                  width: `${(effectivenessMetrics.summary.escalated / effectivenessMetrics.summary.total) * 100}%`,
                }}
                title={`Escalated: ${effectivenessMetrics.summary.escalated}`}
              ></div>
              <div
                className="bg-orange-500"
                style={{
                  width: `${(effectivenessMetrics.summary.reviewRejected / effectivenessMetrics.summary.total) * 100}%`,
                }}
                title={`PR Rejected: ${effectivenessMetrics.summary.reviewRejected}`}
              ></div>
              <div
                className="bg-gray-400"
                style={{
                  width: `${(effectivenessMetrics.summary.cancelled / effectivenessMetrics.summary.total) * 100}%`,
                }}
                title={`Cancelled: ${effectivenessMetrics.summary.cancelled}`}
              ></div>
            </div>
            <div className="flex flex-wrap justify-between mt-2 text-xs text-gray-500 dark:text-gray-400 gap-2">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                Deployed ({effectivenessMetrics.summary.deployed})
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                Completed ({effectivenessMetrics.summary.successful - effectivenessMetrics.summary.deployed})
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                Failed ({effectivenessMetrics.summary.failed})
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-yellow-500 rounded-full"></span>
                Escalated ({effectivenessMetrics.summary.escalated})
              </span>
              {effectivenessMetrics.summary.reviewRejected > 0 && (
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-orange-500 rounded-full"></span>
                  PR Rejected ({effectivenessMetrics.summary.reviewRejected})
                </span>
              )}
            </div>
          </div>

          {/* Model Performance Comparison */}
          {effectivenessMetrics.byModel.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Model Performance</h3>
              <div className="space-y-3">
                {effectivenessMetrics.byModel.map((m) => (
                  <div key={m.model} className="flex items-center gap-4">
                    <div className="w-36 text-sm text-gray-600 dark:text-gray-400 truncate">
                      {m.model.replace("claude-", "").replace(/-20\d{6}$/, "")}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                          <div
                            className="bg-green-500 h-2 rounded-full"
                            style={{ width: `${m.successRate}%` }}
                          ></div>
                        </div>
                        <span className="text-sm font-medium w-12 text-right">
                          {m.successRate}%
                        </span>
                      </div>
                    </div>
                    <div className="w-24 text-xs text-gray-500 text-right">
                      {m.firstAttemptRate}% 1st try
                    </div>
                    <div className="w-16 text-sm text-gray-400 text-right">
                      n={m.total}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PR Stats */}
          {effectivenessMetrics.prStats.total > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Pull Request Outcomes</h3>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex justify-between text-sm mb-1">
                    <span>Accepted: {effectivenessMetrics.prStats.accepted}</span>
                    <span>Rejected: {effectivenessMetrics.prStats.rejected}</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-green-500 h-2 rounded-full"
                      style={{ width: `${effectivenessMetrics.prStats.acceptanceRate}%` }}
                    ></div>
                  </div>
                </div>
                <span className="text-sm font-medium">
                  {effectivenessMetrics.prStats.acceptanceRate}% accepted
                </span>
              </div>
            </div>
          )}

          {/* Success Rate Trend */}
          {effectivenessMetrics.trend.length > 1 && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Success Rate Trend</h3>
              <div className="h-24 flex items-end gap-1">
                {effectivenessMetrics.trend.map((point, i) => {
                  const height = point.successRate;
                  return (
                    <div
                      key={i}
                      className="flex-1 bg-green-400 rounded-t hover:bg-green-500 transition-colors"
                      style={{ height: `${Math.max(height, 4)}%` }}
                      title={`${point.date}: ${point.successRate}% success (${point.success}/${point.total})`}
                    ></div>
                  );
                })}
              </div>
              <div className="flex justify-between mt-1 text-xs text-gray-500 dark:text-gray-400">
                <span>{effectivenessMetrics.trend[0]?.date}</span>
                <span>{effectivenessMetrics.trend[effectivenessMetrics.trend.length - 1]?.date}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Task Statistics */}
      {taskStats && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">Task Statistics</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="text-center">
              <p className="text-3xl font-bold">{taskStats.total}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-green-600">
                {taskStats.completed}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Completed
              </p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-blue-600">
                {taskStats.deployed}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Deployed
              </p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-red-600">
                {taskStats.failed}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Failed</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-yellow-600">
                {taskStats.inProgress}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                In Progress
              </p>
            </div>
          </div>

          {taskStats.total > 0 && (
            <div className="mt-6">
              <div className="flex h-4 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700">
                <div
                  className="bg-green-500"
                  style={{
                    width: `${(taskStats.completed / taskStats.total) * 100}%`,
                  }}
                ></div>
                <div
                  className="bg-blue-500"
                  style={{
                    width: `${(taskStats.deployed / taskStats.total) * 100}%`,
                  }}
                ></div>
                <div
                  className="bg-red-500"
                  style={{
                    width: `${(taskStats.failed / taskStats.total) * 100}%`,
                  }}
                ></div>
                <div
                  className="bg-yellow-500"
                  style={{
                    width: `${(taskStats.inProgress / taskStats.total) * 100}%`,
                  }}
                ></div>
              </div>
              <div className="flex justify-between mt-2 text-xs text-gray-500 dark:text-gray-400">
                <span>Completed</span>
                <span>Deployed</span>
                <span>Failed</span>
                <span>In Progress</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Code Quality Metrics */}
      {codeQualityMetrics && codeQualityMetrics.summary.tasksWithMetrics > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">Code Quality Metrics</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            Automated quality analysis from lint, typecheck, tests, coverage, and security scans
          </p>

          {/* Quality Score Cards */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
            <div className="text-center p-3 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 rounded-lg">
              <p className="text-3xl font-bold text-blue-600">{codeQualityMetrics.summary.averageQualityScore}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Overall Score</p>
            </div>
            <div className="text-center p-3 bg-yellow-50 dark:bg-yellow-900/30 rounded">
              <p className="text-2xl font-bold text-yellow-600">{codeQualityMetrics.summary.averageLintScore}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Lint</p>
            </div>
            <div className="text-center p-3 bg-purple-50 dark:bg-purple-900/30 rounded">
              <p className="text-2xl font-bold text-purple-600">{codeQualityMetrics.summary.averageTypecheckScore}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Typecheck</p>
            </div>
            <div className="text-center p-3 bg-green-50 dark:bg-green-900/30 rounded">
              <p className="text-2xl font-bold text-green-600">{codeQualityMetrics.summary.averageTestScore}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Tests</p>
            </div>
            <div className="text-center p-3 bg-cyan-50 dark:bg-cyan-900/30 rounded">
              <p className="text-2xl font-bold text-cyan-600">{codeQualityMetrics.summary.averageCoverageScore}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Coverage</p>
            </div>
            <div className="text-center p-3 bg-red-50 dark:bg-red-900/30 rounded">
              <p className="text-2xl font-bold text-red-600">{codeQualityMetrics.summary.averageSecurityScore}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Security</p>
            </div>
          </div>

          {/* Score Distribution */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Score Distribution</h3>
            <div className="flex h-6 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700">
              {codeQualityMetrics.scoreDistribution.excellent > 0 && (
                <div
                  className="bg-green-500 flex items-center justify-center"
                  style={{
                    width: `${(codeQualityMetrics.scoreDistribution.excellent / codeQualityMetrics.summary.tasksWithMetrics) * 100}%`,
                  }}
                  title={`Excellent (90-100): ${codeQualityMetrics.scoreDistribution.excellent}`}
                >
                  <span className="text-xs text-white font-medium">
                    {codeQualityMetrics.scoreDistribution.excellent > 2 && codeQualityMetrics.scoreDistribution.excellent}
                  </span>
                </div>
              )}
              {codeQualityMetrics.scoreDistribution.good > 0 && (
                <div
                  className="bg-blue-500 flex items-center justify-center"
                  style={{
                    width: `${(codeQualityMetrics.scoreDistribution.good / codeQualityMetrics.summary.tasksWithMetrics) * 100}%`,
                  }}
                  title={`Good (70-89): ${codeQualityMetrics.scoreDistribution.good}`}
                >
                  <span className="text-xs text-white font-medium">
                    {codeQualityMetrics.scoreDistribution.good > 2 && codeQualityMetrics.scoreDistribution.good}
                  </span>
                </div>
              )}
              {codeQualityMetrics.scoreDistribution.fair > 0 && (
                <div
                  className="bg-yellow-500 flex items-center justify-center"
                  style={{
                    width: `${(codeQualityMetrics.scoreDistribution.fair / codeQualityMetrics.summary.tasksWithMetrics) * 100}%`,
                  }}
                  title={`Fair (50-69): ${codeQualityMetrics.scoreDistribution.fair}`}
                >
                  <span className="text-xs text-white font-medium">
                    {codeQualityMetrics.scoreDistribution.fair > 2 && codeQualityMetrics.scoreDistribution.fair}
                  </span>
                </div>
              )}
              {codeQualityMetrics.scoreDistribution.poor > 0 && (
                <div
                  className="bg-red-500 flex items-center justify-center"
                  style={{
                    width: `${(codeQualityMetrics.scoreDistribution.poor / codeQualityMetrics.summary.tasksWithMetrics) * 100}%`,
                  }}
                  title={`Poor (<50): ${codeQualityMetrics.scoreDistribution.poor}`}
                >
                  <span className="text-xs text-white font-medium">
                    {codeQualityMetrics.scoreDistribution.poor > 2 && codeQualityMetrics.scoreDistribution.poor}
                  </span>
                </div>
              )}
            </div>
            <div className="flex flex-wrap justify-between mt-2 text-xs text-gray-500 dark:text-gray-400 gap-2">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                Excellent ({codeQualityMetrics.scoreDistribution.excellent})
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                Good ({codeQualityMetrics.scoreDistribution.good})
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-yellow-500 rounded-full"></span>
                Fair ({codeQualityMetrics.scoreDistribution.fair})
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                Poor ({codeQualityMetrics.scoreDistribution.poor})
              </span>
            </div>
          </div>

          {/* Quality by Persona & Model */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {codeQualityMetrics.byPersona.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Quality by Persona</h3>
                <div className="space-y-2">
                  {codeQualityMetrics.byPersona.slice(0, 5).map((p) => (
                    <div key={p.persona} className="flex items-center gap-3">
                      <div className="w-28 text-sm text-gray-600 dark:text-gray-400 truncate">
                        {p.persona.replace(/_/g, " ")}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                            <div
                              className={`h-2 rounded-full ${
                                p.avgScore >= 90 ? "bg-green-500" :
                                p.avgScore >= 70 ? "bg-blue-500" :
                                p.avgScore >= 50 ? "bg-yellow-500" : "bg-red-500"
                              }`}
                              style={{ width: `${p.avgScore}%` }}
                            ></div>
                          </div>
                          <span className="text-sm font-medium w-8 text-right">{p.avgScore}</span>
                        </div>
                      </div>
                      <span className="text-xs text-gray-400">n={p.taskCount}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {codeQualityMetrics.byModel.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Quality by Model</h3>
                <div className="space-y-2">
                  {codeQualityMetrics.byModel.slice(0, 5).map((m) => (
                    <div key={m.model} className="flex items-center gap-3">
                      <div className="w-28 text-sm text-gray-600 dark:text-gray-400 truncate">
                        {m.model.replace("claude-", "").replace(/-20\d{6}$/, "")}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                            <div
                              className={`h-2 rounded-full ${
                                m.avgScore >= 90 ? "bg-green-500" :
                                m.avgScore >= 70 ? "bg-blue-500" :
                                m.avgScore >= 50 ? "bg-yellow-500" : "bg-red-500"
                              }`}
                              style={{ width: `${m.avgScore}%` }}
                            ></div>
                          </div>
                          <span className="text-sm font-medium w-8 text-right">{m.avgScore}</span>
                        </div>
                      </div>
                      <span className="text-xs text-gray-400">n={m.taskCount}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Quality Trend */}
          {codeQualityMetrics.trend.length > 1 && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mb-6">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Quality Score Trend</h3>
              <div className="h-24 flex items-end gap-1">
                {codeQualityMetrics.trend.map((point, i) => {
                  const height = point.avgScore;
                  return (
                    <div
                      key={i}
                      className={`flex-1 rounded-t hover:opacity-80 transition-opacity ${
                        point.avgScore >= 90 ? "bg-green-400" :
                        point.avgScore >= 70 ? "bg-blue-400" :
                        point.avgScore >= 50 ? "bg-yellow-400" : "bg-red-400"
                      }`}
                      style={{ height: `${Math.max(height, 4)}%` }}
                      title={`${point.date}: Score ${point.avgScore} (${point.taskCount} tasks)`}
                    ></div>
                  );
                })}
              </div>
              <div className="flex justify-between mt-1 text-xs text-gray-500 dark:text-gray-400">
                <span>{codeQualityMetrics.trend[0]?.date}</span>
                <span>{codeQualityMetrics.trend[codeQualityMetrics.trend.length - 1]?.date}</span>
              </div>
            </div>
          )}

          {/* Low Quality Tasks - Investigation List */}
          {codeQualityMetrics.lowQualityTasks.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Tasks Needing Attention (Score &lt; 70)
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400">
                      <th className="pb-2 pr-4">Task</th>
                      <th className="pb-2 pr-4 text-center">Score</th>
                      <th className="pb-2 pr-4 text-center">Lint</th>
                      <th className="pb-2 pr-4 text-center">Type</th>
                      <th className="pb-2 pr-4 text-center">Tests</th>
                      <th className="pb-2 pr-4 text-center">Coverage</th>
                      <th className="pb-2 pr-4 text-center">Security</th>
                      <th className="pb-2">Persona</th>
                    </tr>
                  </thead>
                  <tbody>
                    {codeQualityMetrics.lowQualityTasks.slice(0, 5).map((task) => (
                      <tr key={task.id} className="border-t border-gray-100 dark:border-gray-700">
                        <td className="py-2 pr-4">
                          <div className="font-medium text-blue-600 dark:text-blue-400">
                            {task.jiraKey || task.id.slice(0, 8)}
                          </div>
                          {task.summary && (
                            <div className="text-xs text-gray-500 truncate max-w-xs">
                              {task.summary}
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-center">
                          <span className={`font-bold ${
                            (task.qualityScore ?? 0) >= 50 ? "text-yellow-600" : "text-red-600"
                          }`}>
                            {task.qualityScore ?? "-"}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-center">{task.lintScore ?? "-"}</td>
                        <td className="py-2 pr-4 text-center">{task.typecheckScore ?? "-"}</td>
                        <td className="py-2 pr-4 text-center">{task.testScore ?? "-"}</td>
                        <td className="py-2 pr-4 text-center">{task.coverageScore ?? "-"}</td>
                        <td className="py-2 pr-4 text-center">{task.securityScore ?? "-"}</td>
                        <td className="py-2 text-xs text-gray-500">
                          {task.persona?.replace(/_/g, " ") ?? "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Metrics Coverage Note */}
          <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
            {codeQualityMetrics.summary.tasksWithMetrics} of {codeQualityMetrics.summary.totalTasks} tasks have quality metrics ({codeQualityMetrics.summary.metricsRate}%)
          </div>
        </div>
      )}

      {/* Epic Workflow Metrics */}
      {prdMetrics && prdMetrics.summary.totalPrdWorkflows > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">Epic Workflow Metrics</h2>

          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="text-center p-3 bg-gray-50 dark:bg-gray-700 rounded">
              <p className="text-2xl font-bold">{prdMetrics.summary.totalPrdWorkflows}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Epics</p>
            </div>
            <div className="text-center p-3 bg-green-50 dark:bg-green-900/30 rounded">
              <p className="text-2xl font-bold text-green-600">{prdMetrics.summary.successRate}%</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Success Rate</p>
            </div>
            <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/30 rounded">
              <p className="text-2xl font-bold text-blue-600">{prdMetrics.planAccuracy.accuracyPercent}%</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Plan Accuracy</p>
            </div>
            <div className="text-center p-3 bg-purple-50 dark:bg-purple-900/30 rounded">
              <p className={`text-2xl font-bold ${prdMetrics.costVariance.avgVariancePercent > 20 ? "text-red-600" : prdMetrics.costVariance.avgVariancePercent < -10 ? "text-green-600" : "text-purple-600"}`}>
                {prdMetrics.costVariance.avgVariancePercent > 0 ? "+" : ""}{prdMetrics.costVariance.avgVariancePercent}%
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Cost Variance</p>
            </div>
          </div>

          {/* Cost Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Cost Analysis</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Planned Total:</span>
                  <span className="font-medium">${prdMetrics.costVariance.totalPlannedCost}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Actual Total:</span>
                  <span className="font-medium">${prdMetrics.costVariance.totalActualCost}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Data Points:</span>
                  <span className="font-medium">{prdMetrics.costVariance.dataPoints}</span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Time by Complexity</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Low Complexity:</span>
                  <span className="font-medium">{prdMetrics.timeToCompletion.byComplexityReadable.low}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Medium Complexity:</span>
                  <span className="font-medium">{prdMetrics.timeToCompletion.byComplexityReadable.medium}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">High Complexity:</span>
                  <span className="font-medium">{prdMetrics.timeToCompletion.byComplexityReadable.high}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Stories Planned vs Executed */}
          <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Story Execution</h3>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="flex justify-between text-sm mb-1">
                  <span>Planned: {prdMetrics.planAccuracy.totalPlannedStories}</span>
                  <span>Executed: {prdMetrics.planAccuracy.totalExecutedStories}</span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full"
                    style={{ width: `${Math.min(prdMetrics.planAccuracy.accuracyPercent, 100)}%` }}
                  ></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Failure Modes Analysis */}
      {failureMetrics && failureMetrics.summary.totalFailures > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">Failure Mode Analysis</h2>

          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <div className="text-center p-3 bg-red-50 dark:bg-red-900/30 rounded">
              <p className="text-2xl font-bold text-red-600">{failureMetrics.summary.totalFailures}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Failures</p>
            </div>
            <div className="text-center p-3 bg-gray-50 dark:bg-gray-700 rounded">
              <p className="text-2xl font-bold">{failureMetrics.summary.failureRate}%</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Failure Rate</p>
            </div>
            <div className="text-center p-3 bg-yellow-50 dark:bg-yellow-900/30 rounded">
              <p className="text-2xl font-bold text-yellow-600">{failureMetrics.summary.retriedTasks}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Retried</p>
            </div>
            <div className="text-center p-3 bg-orange-50 dark:bg-orange-900/30 rounded">
              <p className="text-2xl font-bold text-orange-600">{failureMetrics.summary.maxRetriesExhausted}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Max Retries Hit</p>
            </div>
            <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/30 rounded">
              <p className="text-2xl font-bold text-blue-600">{failureMetrics.summary.totalTasks}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Tasks</p>
            </div>
          </div>

          {/* Failure Categories */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Failure Categories</h3>
            <div className="space-y-2">
              {failureMetrics.byCategory.slice(0, 8).map((cat) => (
                <div key={cat.category}>
                  <button
                    onClick={() => setExpandedCategory(expandedCategory === cat.category ? null : cat.category)}
                    className="w-full"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-gray-600 dark:text-gray-400">{cat.label}</span>
                          <span className="font-medium">{cat.count} ({cat.percentage}%)</span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full ${
                              cat.category.includes("infrastructure") || cat.category.includes("spot")
                                ? "bg-purple-500"
                                : cat.category.includes("git") || cat.category.includes("github")
                                ? "bg-orange-500"
                                : cat.category.includes("build") || cat.category.includes("type") || cat.category.includes("test") || cat.category.includes("lint")
                                ? "bg-yellow-500"
                                : cat.category.includes("context") || cat.category.includes("rate") || cat.category.includes("api")
                                ? "bg-blue-500"
                                : "bg-red-500"
                            }`}
                            style={{ width: `${cat.percentage}%` }}
                          ></div>
                        </div>
                      </div>
                      <span className="text-gray-400 text-sm">
                        {cat.examples.length > 0 && (expandedCategory === cat.category ? "−" : "+")}
                      </span>
                    </div>
                  </button>
                  {expandedCategory === cat.category && cat.examples.length > 0 && (
                    <div className="mt-2 ml-4 p-3 bg-gray-50 dark:bg-gray-700 rounded text-xs font-mono">
                      {cat.examples.map((ex, i) => (
                        <div key={i} className="text-gray-600 dark:text-gray-400 mb-1 last:mb-0 truncate">
                          {ex}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Breakdown by Persona & Model */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-gray-200 dark:border-gray-700">
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">By Persona</h3>
              <div className="space-y-1 text-sm">
                {failureMetrics.byPersona.slice(0, 5).map((p) => (
                  <div key={p.persona} className="flex justify-between">
                    <span className="text-gray-500">{p.persona.replace(/_/g, " ")}</span>
                    <span className="font-medium">{p.count}</span>
                  </div>
                ))}
                {failureMetrics.byPersona.length === 0 && (
                  <span className="text-gray-400">No data</span>
                )}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">By Model</h3>
              <div className="space-y-1 text-sm">
                {failureMetrics.byModel.slice(0, 5).map((m) => (
                  <div key={m.model} className="flex justify-between">
                    <span className="text-gray-500 truncate">{m.model.replace("claude-", "").replace("-20241022", "").replace("-20251001", "")}</span>
                    <span className="font-medium">{m.count}</span>
                  </div>
                ))}
                {failureMetrics.byModel.length === 0 && (
                  <span className="text-gray-400">No data</span>
                )}
              </div>
            </div>
          </div>

          {/* Weekly Trend */}
          {failureMetrics.weeklyTrend.length > 1 && (
            <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Weekly Failure Trend</h3>
              <div className="h-24 flex items-end gap-1">
                {failureMetrics.weeklyTrend.map((week, i) => {
                  const maxCount = Math.max(...failureMetrics.weeklyTrend.map((w) => w.count), 1);
                  const height = (week.count / maxCount) * 100;
                  return (
                    <div
                      key={i}
                      className="flex-1 bg-red-400 rounded-t hover:bg-red-500 transition-colors"
                      style={{ height: `${Math.max(height, 4)}%` }}
                      title={`Week of ${week.week}: ${week.count} failures`}
                    ></div>
                  );
                })}
              </div>
              <div className="flex justify-between mt-1 text-xs text-gray-500 dark:text-gray-400">
                <span>{failureMetrics.weeklyTrend[0]?.week}</span>
                <span>{failureMetrics.weeklyTrend[failureMetrics.weeklyTrend.length - 1]?.week}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Daily Usage Chart (simplified) */}
      {dailyUsage.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Daily Task Usage</h2>
          <div className="h-48 flex items-end gap-1">
            {dailyUsage.map((day, i) => {
              const maxTasks = Math.max(...dailyUsage.map((d) => d.tasks), 1);
              const height = (day.tasks / maxTasks) * 100;
              return (
                <div
                  key={i}
                  className="flex-1 bg-blue-500 rounded-t hover:bg-blue-600 transition-colors"
                  style={{ height: `${Math.max(height, 2)}%` }}
                  title={`${day.date}: ${day.tasks} tasks`}
                ></div>
              );
            })}
          </div>
          <div className="flex justify-between mt-2 text-xs text-gray-500 dark:text-gray-400">
            <span>{dailyUsage[0]?.date}</span>
            <span>{dailyUsage[dailyUsage.length - 1]?.date}</span>
          </div>
        </div>
      )}
    </div>
  );
}

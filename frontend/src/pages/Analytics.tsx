import { useState, useEffect } from "react";
import { useAuthStore } from "../store/auth-store";
import { AnalyticsSkeleton } from "../components/ui/skeleton";

interface UsageStats {
  plan: string;
  tasks: {
    used: number;
    quota: number;
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

export default function Analytics() {
  const tokens = useAuthStore((state) => state.tokens);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [taskStats, setTaskStats] = useState<TaskStats | null>(null);
  const [dailyUsage, setDailyUsage] = useState<DailyUsage[]>([]);
  const [prdMetrics, setPrdMetrics] = useState<PrdMetrics | null>(null);
  const [failureMetrics, setFailureMetrics] = useState<FailureMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "90d">("30d");
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  useEffect(() => {
    fetchAnalytics();
  }, [tokens, timeRange]);

  async function fetchAnalytics() {
    setLoading(true);
    try {
      // Fetch billing usage
      const usageRes = await fetch("/api/billing/usage", {
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      if (usageRes.ok) {
        const data = await usageRes.json();
        setUsage(data);
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
        <h1 className="text-2xl font-bold">Analytics</h1>
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
              Tasks Used
            </p>
            <p className="text-2xl font-bold">
              {usage.tasks.isUnlimited
                ? usage.tasks.used
                : `${usage.tasks.used}/${usage.tasks.quota}`}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Remaining
            </p>
            <p className="text-2xl font-bold">
              {usage.tasks.isUnlimited ? "∞" : usage.tasks.remaining}
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

      {/* PRD Workflow Metrics */}
      {prdMetrics && prdMetrics.summary.totalPrdWorkflows > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">PRD Workflow Metrics</h2>

          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="text-center p-3 bg-gray-50 dark:bg-gray-700 rounded">
              <p className="text-2xl font-bold">{prdMetrics.summary.totalPrdWorkflows}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total PRDs</p>
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

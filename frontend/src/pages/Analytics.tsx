import { useState, useEffect } from "react";
import { useAuthStore } from "../store/auth-store";

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

export default function Analytics() {
  const tokens = useAuthStore((state) => state.tokens);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [taskStats, setTaskStats] = useState<TaskStats | null>(null);
  const [dailyUsage, setDailyUsage] = useState<DailyUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "90d">("30d");

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
    } catch (error) {
      console.error("Failed to fetch analytics:", error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
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

import type { FailureMetrics } from "./types";

interface FailureAnalysisProps {
  data: FailureMetrics;
  expandedCategory: string | null;
  setExpandedCategory: (v: string | null) => void;
}

export default function FailureAnalysis({ data, expandedCategory, setExpandedCategory }: FailureAnalysisProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
      <h2 className="text-lg font-semibold mb-4">Failure Mode Analysis</h2>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="text-center p-3 bg-red-50 dark:bg-red-900/30 rounded">
          <p className="text-2xl font-bold text-red-600">{data.summary.totalFailures}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Total Failures</p>
        </div>
        <div className="text-center p-3 bg-gray-50 dark:bg-gray-700 rounded">
          <p className="text-2xl font-bold">{data.summary.failureRate}%</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Failure Rate</p>
        </div>
        <div className="text-center p-3 bg-yellow-50 dark:bg-yellow-900/30 rounded">
          <p className="text-2xl font-bold text-yellow-600">{data.summary.retriedTasks}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Retried</p>
        </div>
        <div className="text-center p-3 bg-orange-50 dark:bg-orange-900/30 rounded">
          <p className="text-2xl font-bold text-orange-600">{data.summary.maxRetriesExhausted}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Max Retries Hit</p>
        </div>
        <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/30 rounded">
          <p className="text-2xl font-bold text-blue-600">{data.summary.totalTasks}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Total Tasks</p>
        </div>
      </div>

      {/* Failure Categories */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Failure Categories</h3>
        <div className="space-y-2">
          {data.byCategory.slice(0, 8).map((cat) => (
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
                    {cat.examples.length > 0 && (expandedCategory === cat.category ? "\u2212" : "+")}
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
            {data.byPersona.slice(0, 5).map((p) => (
              <div key={p.persona} className="flex justify-between">
                <span className="text-gray-500">{p.persona.replace(/_/g, " ")}</span>
                <span className="font-medium">{p.count}</span>
              </div>
            ))}
            {data.byPersona.length === 0 && (
              <span className="text-gray-400">No data</span>
            )}
          </div>
        </div>
        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">By Model</h3>
          <div className="space-y-1 text-sm">
            {data.byModel.slice(0, 5).map((m) => (
              <div key={m.model} className="flex justify-between">
                <span className="text-gray-500 truncate">{m.model.replace("claude-", "").replace("-20241022", "").replace("-20251001", "")}</span>
                <span className="font-medium">{m.count}</span>
              </div>
            ))}
            {data.byModel.length === 0 && (
              <span className="text-gray-400">No data</span>
            )}
          </div>
        </div>
      </div>

      {/* Weekly Trend */}
      {data.weeklyTrend.length > 1 && (
        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Weekly Failure Trend</h3>
          <div className="h-24 flex items-end gap-1">
            {data.weeklyTrend.map((week, i) => {
              const maxCount = Math.max(...data.weeklyTrend.map((w) => w.count), 1);
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
            <span>{data.weeklyTrend[0]?.week}</span>
            <span>{data.weeklyTrend[data.weeklyTrend.length - 1]?.week}</span>
          </div>
        </div>
      )}
    </div>
  );
}

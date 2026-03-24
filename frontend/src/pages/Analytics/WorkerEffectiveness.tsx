import type { EffectivenessMetrics } from "./types";

interface WorkerEffectivenessProps {
  data: EffectivenessMetrics;
}

export default function WorkerEffectiveness({ data }: WorkerEffectivenessProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
      <h2 className="text-lg font-semibold mb-4">Worker Effectiveness</h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        Automatically calculated from task outcomes - no manual input required
      </p>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="text-center p-3 bg-green-50 dark:bg-green-900/30 rounded">
          <p className="text-2xl font-bold text-green-600">
            {data.summary.successRate}%
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Success Rate</p>
        </div>
        <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/30 rounded">
          <p className="text-2xl font-bold text-blue-600">
            {data.summary.deploymentRate}%
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Deployment Rate</p>
        </div>
        <div className="text-center p-3 bg-purple-50 dark:bg-purple-900/30 rounded">
          <p className="text-2xl font-bold text-purple-600">
            {data.summary.firstAttemptRate}%
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">First Attempt</p>
        </div>
        <div className="text-center p-3 bg-cyan-50 dark:bg-cyan-900/30 rounded">
          <p className="text-2xl font-bold text-cyan-600">
            {data.summary.prAcceptanceRate}%
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">PR Acceptance</p>
        </div>
        <div className="text-center p-3 bg-gray-50 dark:bg-gray-700 rounded">
          <p className="text-2xl font-bold">{data.summary.total}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Total Tasks</p>
        </div>
      </div>

      {/* Outcome Breakdown */}
      <div className="mb-6">
        <div className="flex h-4 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700">
          <div
            className="bg-blue-500"
            style={{
              width: `${(data.summary.deployed / data.summary.total) * 100}%`,
            }}
            title={`Deployed: ${data.summary.deployed}`}
          ></div>
          <div
            className="bg-green-500"
            style={{
              width: `${((data.summary.successful - data.summary.deployed) / data.summary.total) * 100}%`,
            }}
            title={`Completed: ${data.summary.successful - data.summary.deployed}`}
          ></div>
          <div
            className="bg-red-500"
            style={{
              width: `${(data.summary.failed / data.summary.total) * 100}%`,
            }}
            title={`Failed: ${data.summary.failed}`}
          ></div>
          <div
            className="bg-yellow-500"
            style={{
              width: `${(data.summary.escalated / data.summary.total) * 100}%`,
            }}
            title={`Escalated: ${data.summary.escalated}`}
          ></div>
          <div
            className="bg-orange-500"
            style={{
              width: `${(data.summary.reviewRejected / data.summary.total) * 100}%`,
            }}
            title={`PR Rejected: ${data.summary.reviewRejected}`}
          ></div>
          <div
            className="bg-gray-400"
            style={{
              width: `${(data.summary.cancelled / data.summary.total) * 100}%`,
            }}
            title={`Cancelled: ${data.summary.cancelled}`}
          ></div>
        </div>
        <div className="flex flex-wrap justify-between mt-2 text-xs text-gray-500 dark:text-gray-400 gap-2">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
            Deployed ({data.summary.deployed})
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
            Completed ({data.summary.successful - data.summary.deployed})
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-red-500 rounded-full"></span>
            Failed ({data.summary.failed})
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-yellow-500 rounded-full"></span>
            Escalated ({data.summary.escalated})
          </span>
          {data.summary.reviewRejected > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-orange-500 rounded-full"></span>
              PR Rejected ({data.summary.reviewRejected})
            </span>
          )}
        </div>
      </div>

      {/* Model Performance Comparison */}
      {data.byModel.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Model Performance</h3>
          <div className="space-y-3">
            {data.byModel.map((m) => (
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
      {data.prStats.total > 0 && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Pull Request Outcomes</h3>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="flex justify-between text-sm mb-1">
                <span>Accepted: {data.prStats.accepted}</span>
                <span>Rejected: {data.prStats.rejected}</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-green-500 h-2 rounded-full"
                  style={{ width: `${data.prStats.acceptanceRate}%` }}
                ></div>
              </div>
            </div>
            <span className="text-sm font-medium">
              {data.prStats.acceptanceRate}% accepted
            </span>
          </div>
        </div>
      )}

      {/* Success Rate Trend */}
      {data.trend.length > 1 && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Success Rate Trend</h3>
          <div className="h-24 flex items-end gap-1">
            {data.trend.map((point, i) => {
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
            <span>{data.trend[0]?.date}</span>
            <span>{data.trend[data.trend.length - 1]?.date}</span>
          </div>
        </div>
      )}
    </div>
  );
}

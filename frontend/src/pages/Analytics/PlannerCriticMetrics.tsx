import type { PlannerCriticMetrics } from "./types";

interface PlannerCriticSectionProps {
  data: PlannerCriticMetrics;
}

export default function PlannerCriticSection({ data }: PlannerCriticSectionProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
      <h2 className="text-lg font-semibold mb-4">Planner-Critic Metrics</h2>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/30 rounded">
          <p className="text-2xl font-bold text-blue-600">{data.summary.avgCriticScore}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Avg Score</p>
        </div>
        <div className="text-center p-3 bg-green-50 dark:bg-green-900/30 rounded">
          <p className="text-2xl font-bold text-green-600">{data.summary.firstAttemptApprovalRate}%</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">First-Pass Rate</p>
        </div>
        <div className="text-center p-3 bg-purple-50 dark:bg-purple-900/30 rounded">
          <p className="text-2xl font-bold text-purple-600">{data.summary.avgIterations}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Avg Iterations</p>
        </div>
        <div className="text-center p-3 bg-yellow-50 dark:bg-yellow-900/30 rounded">
          <p className="text-2xl font-bold text-yellow-600">{data.summary.fileCapHitRate}%</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">File Cap Hit Rate</p>
        </div>
      </div>

      {/* Score Distribution Bar */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Score Distribution</h3>
        <div className="flex gap-1 h-8">
          {data.scoreDistribution.map((bucket) => {
            const color =
              bucket.range === "90-100" ? "bg-green-500" :
              bucket.range === "85-89" ? "bg-green-400" :
              bucket.range === "75-84" ? "bg-yellow-400" :
              bucket.range === "50-74" ? "bg-orange-400" :
              "bg-red-400";
            return bucket.count > 0 ? (
              <div
                key={bucket.range}
                className={`${color} rounded flex items-center justify-center text-xs text-white font-medium`}
                style={{ flex: bucket.count }}
                title={`${bucket.range}: ${bucket.count} plans (${bucket.percentage}%)`}
              >
                {bucket.percentage >= 10 && `${bucket.range}`}
              </div>
            ) : null;
          })}
        </div>
        <div className="flex justify-between text-xs text-gray-400 mt-1">
          <span>0</span>
          <span>50</span>
          <span>75</span>
          <span>85</span>
          <span>100</span>
        </div>
      </div>

      {/* Recent Plans Table */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Recent Plans</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                <th className="pb-2 pr-4">Task</th>
                <th className="pb-2 pr-4">Score</th>
                <th className="pb-2 pr-4">Iterations</th>
                <th className="pb-2 pr-4">Stories</th>
                <th className="pb-2 pr-4">File Cap</th>
              </tr>
            </thead>
            <tbody>
              {data.recentPlans.map((plan) => (
                <tr key={plan.taskId} className="border-b dark:border-gray-700/50">
                  <td className="py-2 pr-4 max-w-[200px] truncate" title={plan.summary}>
                    {plan.summary}
                  </td>
                  <td className="py-2 pr-4">
                    <span className={`font-medium ${
                      plan.criticScore >= 90 ? "text-green-600" :
                      plan.criticScore >= 85 ? "text-green-500" :
                      plan.criticScore >= 75 ? "text-yellow-500" :
                      "text-red-500"
                    }`}>
                      {plan.criticScore}
                    </span>
                  </td>
                  <td className="py-2 pr-4">{plan.iterations}</td>
                  <td className="py-2 pr-4">{plan.storyCount}</td>
                  <td className="py-2 pr-4">
                    {plan.fileCapTruncations > 0 ? (
                      <span className="text-yellow-500">{plan.fileCapTruncations}</span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Common Risks */}
      {data.commonRisks.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Common Risks</h3>
          <div className="space-y-1">
            {data.commonRisks.slice(0, 5).map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="text-gray-400 w-6 text-right">{r.count}x</span>
                <span className="text-gray-600 dark:text-gray-400 truncate">{r.risk}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

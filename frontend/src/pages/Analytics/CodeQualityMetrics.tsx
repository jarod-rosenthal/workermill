import type { CodeQualityMetrics } from "./types";

interface CodeQualitySectionProps {
  data: CodeQualityMetrics;
  timeRange: string;
}

export default function CodeQualitySection({ data, timeRange }: CodeQualitySectionProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Code Quality Metrics</h2>
        <div className="flex gap-2">
          <button
            onClick={() => {
              window.open(`/api/analytics/quality-export?range=${timeRange}&format=csv`, "_blank");
            }}
            className="text-xs px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            Export CSV
          </button>
          <button
            onClick={() => {
              window.open(`/api/analytics/quality-export?range=${timeRange}&format=json`, "_blank");
            }}
            className="text-xs px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            Export JSON
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        Automated quality analysis from lint, typecheck, tests, coverage, and security scans
      </p>

      {/* Quality Score Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
        <div className="text-center p-3 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 rounded-lg">
          <p className="text-3xl font-bold text-blue-600">{data.summary.averageQualityScore}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Overall Score</p>
        </div>
        <div className="text-center p-3 bg-yellow-50 dark:bg-yellow-900/30 rounded">
          <p className="text-2xl font-bold text-yellow-600">{data.summary.averageLintScore}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Lint</p>
        </div>
        <div className="text-center p-3 bg-purple-50 dark:bg-purple-900/30 rounded">
          <p className="text-2xl font-bold text-purple-600">{data.summary.averageTypecheckScore}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Typecheck</p>
        </div>
        <div className="text-center p-3 bg-green-50 dark:bg-green-900/30 rounded">
          <p className="text-2xl font-bold text-green-600">{data.summary.averageTestScore}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Tests</p>
        </div>
        <div className="text-center p-3 bg-cyan-50 dark:bg-cyan-900/30 rounded">
          <p className="text-2xl font-bold text-cyan-600">{data.summary.averageCoverageScore}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Coverage</p>
        </div>
        <div className="text-center p-3 bg-red-50 dark:bg-red-900/30 rounded">
          <p className="text-2xl font-bold text-red-600">{data.summary.averageSecurityScore}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Security</p>
        </div>
      </div>

      {/* Score Distribution */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Score Distribution</h3>
        <div className="flex h-6 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700">
          {data.scoreDistribution.excellent > 0 && (
            <div
              className="bg-green-500 flex items-center justify-center"
              style={{
                width: `${(data.scoreDistribution.excellent / data.summary.tasksWithMetrics) * 100}%`,
              }}
              title={`Excellent (90-100): ${data.scoreDistribution.excellent}`}
            >
              <span className="text-xs text-white font-medium">
                {data.scoreDistribution.excellent > 2 && data.scoreDistribution.excellent}
              </span>
            </div>
          )}
          {data.scoreDistribution.good > 0 && (
            <div
              className="bg-blue-500 flex items-center justify-center"
              style={{
                width: `${(data.scoreDistribution.good / data.summary.tasksWithMetrics) * 100}%`,
              }}
              title={`Good (70-89): ${data.scoreDistribution.good}`}
            >
              <span className="text-xs text-white font-medium">
                {data.scoreDistribution.good > 2 && data.scoreDistribution.good}
              </span>
            </div>
          )}
          {data.scoreDistribution.fair > 0 && (
            <div
              className="bg-yellow-500 flex items-center justify-center"
              style={{
                width: `${(data.scoreDistribution.fair / data.summary.tasksWithMetrics) * 100}%`,
              }}
              title={`Fair (50-69): ${data.scoreDistribution.fair}`}
            >
              <span className="text-xs text-white font-medium">
                {data.scoreDistribution.fair > 2 && data.scoreDistribution.fair}
              </span>
            </div>
          )}
          {data.scoreDistribution.poor > 0 && (
            <div
              className="bg-red-500 flex items-center justify-center"
              style={{
                width: `${(data.scoreDistribution.poor / data.summary.tasksWithMetrics) * 100}%`,
              }}
              title={`Poor (<50): ${data.scoreDistribution.poor}`}
            >
              <span className="text-xs text-white font-medium">
                {data.scoreDistribution.poor > 2 && data.scoreDistribution.poor}
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap justify-between mt-2 text-xs text-gray-500 dark:text-gray-400 gap-2">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
            Excellent ({data.scoreDistribution.excellent})
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
            Good ({data.scoreDistribution.good})
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-yellow-500 rounded-full"></span>
            Fair ({data.scoreDistribution.fair})
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-red-500 rounded-full"></span>
            Poor ({data.scoreDistribution.poor})
          </span>
        </div>
      </div>

      {/* Quality by Persona & Model */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {data.byPersona.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Quality by Persona</h3>
            <div className="space-y-2">
              {data.byPersona.slice(0, 5).map((p) => (
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

        {data.byModel.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Quality by Model</h3>
            <div className="space-y-2">
              {data.byModel.slice(0, 5).map((m) => (
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
      {data.trend.length > 1 && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mb-6">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Quality Score Trend</h3>
          <div className="h-24 flex items-end gap-1">
            {data.trend.map((point, i) => {
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
            <span>{data.trend[0]?.date}</span>
            <span>{data.trend[data.trend.length - 1]?.date}</span>
          </div>
        </div>
      )}

      {/* Low Quality Tasks - Investigation List */}
      {data.lowQualityTasks.length > 0 && (
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
                {data.lowQualityTasks.slice(0, 5).map((task) => (
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
        {data.summary.tasksWithMetrics} of {data.summary.totalTasks} tasks have quality metrics ({data.summary.metricsRate}%)
      </div>
    </div>
  );
}

import type { BusinessOutcomes, TimeSaved } from "./types";

interface ExecutiveDashboardProps {
  businessOutcomes: BusinessOutcomes | null;
  timeSaved: TimeSaved | null;
  timeRange: string;
}

export default function ExecutiveDashboard({ businessOutcomes, timeSaved, timeRange }: ExecutiveDashboardProps) {
  return (
    <div className="bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-800 rounded-lg shadow-lg p-6 mb-8 border border-indigo-100 dark:border-gray-700">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Executive Dashboard</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Business outcomes and ROI metrics for stakeholder reporting
          </p>
        </div>
        <div className="px-3 py-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs font-medium rounded-full">
          {timeRange === "7d" ? "Last 7 Days" : timeRange === "30d" ? "Last 30 Days" : "Last 90 Days"}
        </div>
      </div>

      {/* Key Business KPIs - Large format for executive visibility */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {businessOutcomes && (
          <>
            <div className="bg-white dark:bg-gray-700 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-600">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">PRs Merged</span>
              </div>
              <p className="text-3xl font-bold text-green-600 dark:text-green-400">{businessOutcomes.summary.prsMerged}</p>
              <p className="text-xs text-gray-400 mt-1">Code shipped to production</p>
            </div>
            <div className="bg-white dark:bg-gray-700 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-600">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Issues Closed</span>
              </div>
              <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{businessOutcomes.summary.issuesClosed}</p>
              <p className="text-xs text-gray-400 mt-1">Tickets resolved by AI</p>
            </div>
          </>
        )}
        {timeSaved && (
          <>
            <div className="bg-white dark:bg-gray-700 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-600">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Hours Saved</span>
              </div>
              <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">{timeSaved.summary.estimatedHoursSaved}</p>
              <p className="text-xs text-gray-400 mt-1">Developer time freed up</p>
            </div>
            <div className="bg-white dark:bg-gray-700 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-600">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 bg-amber-500 rounded-full"></div>
                <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Cost/Hour Saved</span>
              </div>
              <p className="text-3xl font-bold text-amber-600 dark:text-amber-400">${timeSaved.summary.costPerHourSaved}</p>
              <p className="text-xs text-gray-400 mt-1">AI cost per dev hour</p>
            </div>
          </>
        )}
      </div>

      {/* Code Output Metrics */}
      {businessOutcomes && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white/50 dark:bg-gray-700/50 rounded-lg p-4">
            <p className="text-sm text-gray-600 dark:text-gray-300 font-medium mb-2">Code Output</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold">{businessOutcomes.summary.totalLinesChanged.toLocaleString()}</span>
              <span className="text-sm text-gray-500">lines changed</span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-lg font-semibold text-gray-600 dark:text-gray-400">{businessOutcomes.summary.totalFilesModified}</span>
              <span className="text-sm text-gray-500">files modified</span>
            </div>
          </div>
          <div className="bg-white/50 dark:bg-gray-700/50 rounded-lg p-4">
            <p className="text-sm text-gray-600 dark:text-gray-300 font-medium mb-2">Task Success</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold">{businessOutcomes.summary.successRate}%</span>
              <span className="text-sm text-gray-500">success rate</span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-lg font-semibold text-gray-600 dark:text-gray-400">{businessOutcomes.summary.successfulTasks}/{businessOutcomes.summary.totalTasks}</span>
              <span className="text-sm text-gray-500">tasks completed</span>
            </div>
          </div>
          <div className="bg-white/50 dark:bg-gray-700/50 rounded-lg p-4">
            <p className="text-sm text-gray-600 dark:text-gray-300 font-medium mb-2">Cost Efficiency</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold">${businessOutcomes.summary.totalCost.toFixed(2)}</span>
              <span className="text-sm text-gray-500">total spend</span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-lg font-semibold text-gray-600 dark:text-gray-400">{businessOutcomes.summary.executionHours}h</span>
              <span className="text-sm text-gray-500">compute time</span>
            </div>
          </div>
        </div>
      )}

      {/* Time Saved by Complexity Breakdown */}
      {timeSaved && timeSaved.byComplexity.length > 0 && (
        <div className="bg-white/50 dark:bg-gray-700/50 rounded-lg p-4 mb-6">
          <p className="text-sm text-gray-600 dark:text-gray-300 font-medium mb-3">Time Saved by Task Complexity</p>
          <div className="flex h-8 rounded-lg overflow-hidden">
            {timeSaved.byComplexity.map((item) => {
              const totalHours = timeSaved.summary.estimatedHoursSaved;
              const percentage = totalHours > 0 ? (item.hoursSaved / totalHours) * 100 : 0;
              const colors: Record<string, string> = {
                simple: "bg-green-400",
                medium: "bg-blue-400",
                complex: "bg-purple-400",
                expert: "bg-red-400",
                unknown: "bg-gray-400",
              };
              if (percentage < 3) return null;
              return (
                <div
                  key={item.complexity}
                  className={`${colors[item.complexity] || "bg-gray-400"} flex items-center justify-center text-white text-xs font-medium`}
                  style={{ width: `${percentage}%` }}
                  title={`${item.complexity}: ${item.hoursSaved}h saved (${item.taskCount} tasks)`}
                >
                  {percentage > 15 && item.complexity.charAt(0).toUpperCase() + item.complexity.slice(1)}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-4 mt-3 text-xs text-gray-500">
            {timeSaved.byComplexity.map((item) => (
              <span key={item.complexity} className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${
                  item.complexity === "simple" ? "bg-green-400" :
                  item.complexity === "medium" ? "bg-blue-400" :
                  item.complexity === "complex" ? "bg-purple-400" :
                  item.complexity === "expert" ? "bg-red-400" : "bg-gray-400"
                }`}></span>
                <span className="capitalize">{item.complexity}</span>
                <span className="text-gray-400">({item.hoursSaved}h)</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Value Trend Chart */}
      {businessOutcomes && businessOutcomes.trend.length > 1 && (
        <div className="bg-white/50 dark:bg-gray-700/50 rounded-lg p-4">
          <p className="text-sm text-gray-600 dark:text-gray-300 font-medium mb-3">Value Delivered Over Time</p>
          <div className="h-20 flex items-end gap-1">
            {businessOutcomes.trend.map((point, i) => {
              const maxTasks = Math.max(...businessOutcomes.trend.map((t) => t.tasksCompleted), 1);
              const height = (point.tasksCompleted / maxTasks) * 100;
              return (
                <div key={i} className="flex-1 flex flex-col items-center">
                  <div
                    className="w-full bg-indigo-400 rounded-t hover:bg-indigo-500 transition-colors relative"
                    style={{ height: `${Math.max(height, 4)}%` }}
                    title={`${point.date}: ${point.tasksCompleted} tasks, ${point.prsMerged} PRs merged`}
                  >
                    {point.prsMerged > 0 && (
                      <div
                        className="absolute bottom-0 left-0 right-0 bg-green-500 rounded-t"
                        style={{ height: `${(point.prsMerged / point.tasksCompleted) * 100}%` }}
                      ></div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-2 text-xs text-gray-500">
            <span>{businessOutcomes.trend[0]?.date}</span>
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-indigo-400 rounded-full"></span>
                Tasks
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                PRs Merged
              </span>
            </span>
            <span>{businessOutcomes.trend[businessOutcomes.trend.length - 1]?.date}</span>
          </div>
        </div>
      )}

      {/* Methodology Note */}
      {timeSaved && (
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-600">
          <details className="text-xs text-gray-500 dark:text-gray-400">
            <summary className="cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
              Methodology & assumptions
            </summary>
            <div className="mt-2 pl-4 space-y-1">
              <p>{timeSaved.methodology.description}</p>
              <p className="font-medium mt-2">Complexity benchmarks:</p>
              <ul className="list-disc list-inside">
                {Object.entries(timeSaved.methodology.complexityBenchmarks).map(([level, desc]) => (
                  <li key={level}><span className="capitalize">{level}</span>: {desc}</li>
                ))}
              </ul>
              <p className="mt-2 text-gray-400">{timeSaved.methodology.codeVolumeBenchmark}</p>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

import type { TokenUsageMetrics } from "./types";

interface TokenUsageAnalyticsProps {
  data: TokenUsageMetrics;
}

export default function TokenUsageAnalytics({ data }: TokenUsageAnalyticsProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
      <h2 className="text-lg font-semibold mb-4">Token Usage Analytics</h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        AI FinOps: Phase-level token tracking for cost optimization
      </p>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/30 rounded">
          <p className="text-2xl font-bold text-blue-600">
            {(data.summary.totalTokens / 1000000).toFixed(2)}M
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Total Tokens</p>
        </div>
        <div className="text-center p-3 bg-green-50 dark:bg-green-900/30 rounded">
          <p className="text-2xl font-bold text-green-600">
            ${data.summary.totalCost.toFixed(2)}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Total Cost</p>
        </div>
        <div className="text-center p-3 bg-purple-50 dark:bg-purple-900/30 rounded">
          <p className="text-2xl font-bold text-purple-600">
            {data.summary.cacheEfficiency}%
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Cache Efficiency</p>
        </div>
        <div className="text-center p-3 bg-cyan-50 dark:bg-cyan-900/30 rounded">
          <p className="text-2xl font-bold text-cyan-600">
            {(data.summary.avgTokensPerTask / 1000).toFixed(0)}K
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Avg Tokens/Task</p>
        </div>
        <div className="text-center p-3 bg-gray-50 dark:bg-gray-700 rounded">
          <p className="text-2xl font-bold">
            ${data.summary.avgCostPerTask.toFixed(2)}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Avg Cost/Task</p>
        </div>
      </div>

      {/* Token Distribution by Phase */}
      {data.byPhase.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Usage by Phase</h3>
          <div className="flex h-6 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700">
            {(() => {
              const phaseColors: Record<string, string> = {
                planning: "bg-blue-500",
                execution: "bg-green-500",
                review: "bg-purple-500",
                deployment: "bg-cyan-500",
                improvement: "bg-orange-500",
              };
              const totalTokens = data.byPhase.reduce((sum, p) => sum + p.inputTokens + p.outputTokens, 0);
              return data.byPhase.map((phase) => {
                const tokens = phase.inputTokens + phase.outputTokens;
                const pct = totalTokens > 0 ? (tokens / totalTokens) * 100 : 0;
                if (pct < 1) return null;
                return (
                  <div
                    key={phase.phase}
                    className={`${phaseColors[phase.phase] || "bg-gray-400"} flex items-center justify-center`}
                    style={{ width: `${pct}%` }}
                    title={`${phase.phase}: ${(tokens / 1000).toFixed(0)}K tokens ($${phase.cost.toFixed(2)})`}
                  >
                    {pct > 10 && (
                      <span className="text-xs text-white font-medium capitalize">
                        {phase.phase}
                      </span>
                    )}
                  </div>
                );
              });
            })()}
          </div>
          <div className="flex flex-wrap justify-between mt-2 text-xs text-gray-500 dark:text-gray-400 gap-2">
            {data.byPhase.map((phase) => (
              <span key={phase.phase} className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${
                  phase.phase === "planning" ? "bg-blue-500" :
                  phase.phase === "execution" ? "bg-green-500" :
                  phase.phase === "review" ? "bg-purple-500" :
                  phase.phase === "deployment" ? "bg-cyan-500" :
                  "bg-orange-500"
                }`}></span>
                <span className="capitalize">{phase.phase}</span>
                <span className="text-gray-400">(${phase.cost.toFixed(2)})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Cost by Persona & Model */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {data.byPersona.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Cost by Persona</h3>
            <div className="space-y-2">
              {data.byPersona.slice(0, 5).map((p) => {
                const maxCost = Math.max(...data.byPersona.map((x) => x.cost));
                return (
                  <div key={p.persona} className="flex items-center gap-3">
                    <div className="w-28 text-sm text-gray-600 dark:text-gray-400 truncate">
                      {p.persona.replace(/_/g, " ")}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                          <div
                            className="bg-blue-500 h-2 rounded-full"
                            style={{ width: `${(p.cost / maxCost) * 100}%` }}
                          ></div>
                        </div>
                        <span className="text-sm font-medium w-16 text-right">${p.cost.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {data.byModel.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Cost by Model</h3>
            <div className="space-y-2">
              {data.byModel.slice(0, 5).map((m) => {
                const maxCost = Math.max(...data.byModel.map((x) => x.cost));
                return (
                  <div key={m.model} className="flex items-center gap-3">
                    <div className="w-28 text-sm text-gray-600 dark:text-gray-400 truncate">
                      {m.model.replace("claude-", "").replace(/-20\d{6}$/, "")}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                          <div
                            className="bg-green-500 h-2 rounded-full"
                            style={{ width: `${(m.cost / maxCost) * 100}%` }}
                          ></div>
                        </div>
                        <span className="text-sm font-medium w-16 text-right">${m.cost.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Token Usage Trend */}
      {data.trends.length > 1 && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mb-6">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Cost Trend</h3>
          <div className="h-24 flex items-end gap-1">
            {(() => {
              const maxCost = Math.max(...data.trends.map((t) => t.cost));
              return data.trends.map((point, i) => {
                const height = maxCost > 0 ? (point.cost / maxCost) * 100 : 0;
                return (
                  <div
                    key={i}
                    className="flex-1 bg-blue-400 rounded-t hover:bg-blue-500 transition-colors"
                    style={{ height: `${Math.max(height, 2)}%` }}
                    title={`${point.date}: $${point.cost.toFixed(2)} (${point.tasks} tasks)`}
                  ></div>
                );
              });
            })()}
          </div>
          <div className="flex justify-between mt-1 text-xs text-gray-500 dark:text-gray-400">
            <span>{data.trends[0]?.date}</span>
            <span>{data.trends[data.trends.length - 1]?.date}</span>
          </div>
        </div>
      )}

      {/* Operation Type Breakdown */}
      {data.byOperationType.length > 0 && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Cost by Operation Type</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {data.byOperationType.map((op) => (
              <div key={op.operationType} className="text-center p-2 bg-gray-50 dark:bg-gray-700 rounded">
                <p className="text-sm font-medium">${op.cost.toFixed(2)}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                  {op.operationType.replace(/_/g, " ")}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Data Coverage Note */}
      <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
        {data.summary.taskCount} tasks tracked in this period
      </div>
    </div>
  );
}

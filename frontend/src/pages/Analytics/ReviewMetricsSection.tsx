import type { ReviewMetrics } from "./types";

interface ReviewMetricsSectionProps {
  data: ReviewMetrics;
}

export default function ReviewMetricsSection({ data }: ReviewMetricsSectionProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8 border-l-4 border-emerald-500">
      <h2 className="text-lg font-semibold mb-1">Tech Lead Review Metrics</h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        AI code review value metrics - tasks with the <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">review</code> label enabled
      </p>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="text-center p-3 bg-emerald-50 dark:bg-emerald-900/30 rounded">
          <p className="text-2xl font-bold text-emerald-600">
            {data.summary.adoptionRate}%
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Review Adoption</p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {data.summary.reviewedTasks}/{data.summary.totalTasks} tasks
          </p>
        </div>
        <div className="text-center p-3 bg-green-50 dark:bg-green-900/30 rounded">
          <p className="text-2xl font-bold text-green-600">
            {data.summary.firstPassApprovalRate}%
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">First-Pass Approval</p>
          <p className="text-xs text-gray-400 dark:text-gray-500">Approved without revisions</p>
        </div>
        <div className="text-center p-3 bg-amber-50 dark:bg-amber-900/30 rounded">
          <p className="text-2xl font-bold text-amber-600">
            {data.summary.avgRevisionsPerTask}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Avg Revisions</p>
          <p className="text-xs text-gray-400 dark:text-gray-500">Per reviewed task</p>
        </div>
        <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/30 rounded">
          <p className="text-2xl font-bold text-blue-600">
            {data.qualityImpact.reviewedAvgAccuracy !== null &&
             data.qualityImpact.nonReviewedAvgAccuracy !== null
              ? `+${Math.max(0, data.qualityImpact.reviewedAvgAccuracy - data.qualityImpact.nonReviewedAvgAccuracy)}`
              : "\u2014"}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Quality Gain</p>
          <p className="text-xs text-gray-400 dark:text-gray-500">Accuracy vs non-reviewed</p>
        </div>
      </div>

      {/* Revision Distribution */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Revision Distribution</h3>
        <div className="flex h-6 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700">
          {(() => {
            const total = data.revisionDistribution.zero +
              data.revisionDistribution.one +
              data.revisionDistribution.two +
              data.revisionDistribution.threeOrMore;
            if (total === 0) return null;
            return (
              <>
                <div
                  className="bg-green-500"
                  style={{ width: `${(data.revisionDistribution.zero / total) * 100}%` }}
                  title={`0 revisions: ${data.revisionDistribution.zero}`}
                ></div>
                <div
                  className="bg-yellow-500"
                  style={{ width: `${(data.revisionDistribution.one / total) * 100}%` }}
                  title={`1 revision: ${data.revisionDistribution.one}`}
                ></div>
                <div
                  className="bg-orange-500"
                  style={{ width: `${(data.revisionDistribution.two / total) * 100}%` }}
                  title={`2 revisions: ${data.revisionDistribution.two}`}
                ></div>
                <div
                  className="bg-red-500"
                  style={{ width: `${(data.revisionDistribution.threeOrMore / total) * 100}%` }}
                  title={`3+ revisions: ${data.revisionDistribution.threeOrMore}`}
                ></div>
              </>
            );
          })()}
        </div>
        <div className="flex flex-wrap justify-between mt-2 text-xs text-gray-500 dark:text-gray-400 gap-2">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
            0 revisions ({data.revisionDistribution.zero})
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-yellow-500 rounded-full"></span>
            1 revision ({data.revisionDistribution.one})
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-orange-500 rounded-full"></span>
            2 revisions ({data.revisionDistribution.two})
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-red-500 rounded-full"></span>
            3+ revisions ({data.revisionDistribution.threeOrMore})
          </span>
        </div>
      </div>

      {/* Decision Breakdown & Quality Impact */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Decision Breakdown */}
        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Review Decisions</h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-24 text-sm text-gray-600 dark:text-gray-400">Approved</div>
              <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                <div
                  className="bg-green-500 h-3 rounded-full"
                  style={{
                    width: `${
                      data.summary.reviewedTasks > 0
                        ? (data.decisions.approved / data.summary.reviewedTasks) * 100
                        : 0
                    }%`,
                  }}
                ></div>
              </div>
              <span className="w-12 text-sm text-right">{data.decisions.approved}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-24 text-sm text-gray-600 dark:text-gray-400">Revised</div>
              <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                <div
                  className="bg-yellow-500 h-3 rounded-full"
                  style={{
                    width: `${
                      data.summary.reviewedTasks > 0
                        ? (data.decisions.revisionNeeded / data.summary.reviewedTasks) * 100
                        : 0
                    }%`,
                  }}
                ></div>
              </div>
              <span className="w-12 text-sm text-right">{data.decisions.revisionNeeded}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-24 text-sm text-gray-600 dark:text-gray-400">Rejected</div>
              <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                <div
                  className="bg-red-500 h-3 rounded-full"
                  style={{
                    width: `${
                      data.summary.reviewedTasks > 0
                        ? (data.decisions.rejected / data.summary.reviewedTasks) * 100
                        : 0
                    }%`,
                  }}
                ></div>
              </div>
              <span className="w-12 text-sm text-right">{data.decisions.rejected}</span>
            </div>
            {data.decisions.escalated > 0 && (
              <div className="flex items-center gap-2">
                <div className="w-24 text-sm text-gray-600 dark:text-gray-400">Escalated</div>
                <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                  <div
                    className="bg-purple-500 h-3 rounded-full"
                    style={{
                      width: `${
                        data.summary.reviewedTasks > 0
                          ? (data.decisions.escalated / data.summary.reviewedTasks) * 100
                          : 0
                      }%`,
                    }}
                  ></div>
                </div>
                <span className="w-12 text-sm text-right">{data.decisions.escalated}</span>
              </div>
            )}
          </div>
        </div>

        {/* Quality Impact Comparison */}
        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Quality Impact</h3>
          {(data.qualityImpact.reviewedAvgAccuracy !== null ||
            data.qualityImpact.nonReviewedAvgAccuracy !== null) ? (
            <div className="space-y-3">
              <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded border border-emerald-200 dark:border-emerald-800">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                    With Review
                  </span>
                  <span className="text-lg font-bold text-emerald-600">
                    {data.qualityImpact.reviewedAvgAccuracy ?? "\u2014"}%
                  </span>
                </div>
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  Avg accuracy score
                </p>
              </div>
              <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Without Review
                  </span>
                  <span className="text-lg font-bold text-gray-600 dark:text-gray-400">
                    {data.qualityImpact.nonReviewedAvgAccuracy ?? "\u2014"}%
                  </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Avg accuracy score
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400 italic">
              No accuracy data available yet. Review tasks to see quality impact.
            </p>
          )}
        </div>
      </div>

      {/* Efficiency Comparison */}
      {(data.efficiency.reviewedAvgDurationMinutes !== null ||
        data.efficiency.reviewedAvgCost !== null) && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mb-6">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Time & Cost Analysis</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-2 bg-gray-50 dark:bg-gray-700 rounded">
              <p className="text-sm font-medium">
                {data.efficiency.reviewedAvgDurationMinutes !== null
                  ? `${data.efficiency.reviewedAvgDurationMinutes}m`
                  : "\u2014"}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Reviewed Avg Time</p>
            </div>
            <div className="text-center p-2 bg-gray-50 dark:bg-gray-700 rounded">
              <p className="text-sm font-medium">
                {data.efficiency.nonReviewedAvgDurationMinutes !== null
                  ? `${data.efficiency.nonReviewedAvgDurationMinutes}m`
                  : "\u2014"}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Non-Reviewed Avg Time</p>
            </div>
            <div className="text-center p-2 bg-gray-50 dark:bg-gray-700 rounded">
              <p className="text-sm font-medium">
                {data.efficiency.reviewedAvgCost !== null
                  ? `$${data.efficiency.reviewedAvgCost.toFixed(2)}`
                  : "\u2014"}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Reviewed Avg Cost</p>
            </div>
            <div className="text-center p-2 bg-gray-50 dark:bg-gray-700 rounded">
              <p className="text-sm font-medium">
                {data.efficiency.nonReviewedAvgCost !== null
                  ? `$${data.efficiency.nonReviewedAvgCost.toFixed(2)}`
                  : "\u2014"}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Non-Reviewed Avg Cost</p>
            </div>
          </div>
        </div>
      )}

      {/* Model Performance for Reviews */}
      {data.byModel.length > 0 && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mb-6">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Review Performance by Model</h3>
          <div className="space-y-3">
            {data.byModel.slice(0, 5).map((m) => (
              <div key={m.model} className="flex items-center gap-4">
                <div className="w-36 text-sm text-gray-600 dark:text-gray-400 truncate">
                  {m.model.replace("claude-", "").replace(/-20\d{6}$/, "")}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div
                        className="bg-emerald-500 h-2 rounded-full"
                        style={{ width: `${m.approvalRate}%` }}
                      ></div>
                    </div>
                    <span className="text-sm font-medium w-12 text-right">
                      {m.approvalRate}%
                    </span>
                  </div>
                </div>
                <div className="w-20 text-xs text-gray-500 text-right">
                  {m.avgRevisions} revisions
                </div>
                <div className="w-14 text-sm text-gray-400 text-right">
                  n={m.reviewedCount}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* First-Pass Approval Trend */}
      {data.trend.length > 1 && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">First-Pass Approval Trend</h3>
          <div className="h-24 flex items-end gap-1">
            {data.trend.map((point, i) => {
              const rate = point.reviewedCount > 0
                ? Math.round((point.approvedFirstPass / point.reviewedCount) * 100)
                : 0;
              return (
                <div
                  key={i}
                  className="flex-1 bg-emerald-400 rounded-t hover:bg-emerald-500 transition-colors"
                  style={{ height: `${Math.max(rate, 4)}%` }}
                  title={`${point.date}: ${rate}% first-pass (${point.approvedFirstPass}/${point.reviewedCount})`}
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

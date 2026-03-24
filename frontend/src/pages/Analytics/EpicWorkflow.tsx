import type { PrdMetrics } from "./types";

interface EpicWorkflowProps {
  data: PrdMetrics;
}

export default function EpicWorkflow({ data }: EpicWorkflowProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
      <h2 className="text-lg font-semibold mb-4">Epic Workflow Metrics</h2>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="text-center p-3 bg-gray-50 dark:bg-gray-700 rounded">
          <p className="text-2xl font-bold">{data.summary.totalPrdWorkflows}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Total Epics</p>
        </div>
        <div className="text-center p-3 bg-green-50 dark:bg-green-900/30 rounded">
          <p className="text-2xl font-bold text-green-600">{data.summary.successRate}%</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Success Rate</p>
        </div>
        <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/30 rounded">
          <p className="text-2xl font-bold text-blue-600">{data.planAccuracy.accuracyPercent}%</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Plan Accuracy</p>
        </div>
        <div className="text-center p-3 bg-purple-50 dark:bg-purple-900/30 rounded">
          <p className={`text-2xl font-bold ${data.costVariance.avgVariancePercent > 20 ? "text-red-600" : data.costVariance.avgVariancePercent < -10 ? "text-green-600" : "text-purple-600"}`}>
            {data.costVariance.avgVariancePercent > 0 ? "+" : ""}{data.costVariance.avgVariancePercent}%
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
              <span className="font-medium">${data.costVariance.totalPlannedCost}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Actual Total:</span>
              <span className="font-medium">${data.costVariance.totalActualCost}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Data Points:</span>
              <span className="font-medium">{data.costVariance.dataPoints}</span>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Time by Complexity</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Low Complexity:</span>
              <span className="font-medium">{data.timeToCompletion.byComplexityReadable.low}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Medium Complexity:</span>
              <span className="font-medium">{data.timeToCompletion.byComplexityReadable.medium}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">High Complexity:</span>
              <span className="font-medium">{data.timeToCompletion.byComplexityReadable.high}</span>
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
              <span>Planned: {data.planAccuracy.totalPlannedStories}</span>
              <span>Executed: {data.planAccuracy.totalExecutedStories}</span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full"
                style={{ width: `${Math.min(data.planAccuracy.accuracyPercent, 100)}%` }}
              ></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

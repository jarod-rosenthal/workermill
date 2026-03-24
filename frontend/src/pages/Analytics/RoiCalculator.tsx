import type { RoiMetrics } from "./types";

interface RoiCalculatorProps {
  data: RoiMetrics;
  hourlyRate: number;
  setHourlyRate: (v: number) => void;
}

export default function RoiCalculator({ data, hourlyRate, setHourlyRate }: RoiCalculatorProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">ROI Calculator</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Calculate your return on investment with your team's hourly rate
          </p>
        </div>
      </div>

      {/* Hourly Rate Input */}
      <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <label htmlFor="hourlyRate" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Developer Hourly Rate (USD)
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Enter your team's average developer hourly rate to see personalized ROI
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-lg font-medium text-gray-500">$</span>
            <input
              id="hourlyRate"
              type="number"
              min="10"
              max="500"
              step="5"
              value={hourlyRate}
              onChange={(e) => setHourlyRate(Math.min(500, Math.max(10, parseInt(e.target.value) || 75)))}
              className="w-24 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-lg font-bold text-center focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <span className="text-sm text-gray-500">/hour</span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {[50, 75, 100, 125, 150, 200].map((rate) => (
            <button
              key={rate}
              onClick={() => setHourlyRate(rate)}
              className={`px-3 py-1 text-sm rounded-full transition-colors ${
                hourlyRate === rate
                  ? "bg-blue-600 text-white"
                  : "bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500"
              }`}
            >
              ${rate}
            </button>
          ))}
        </div>
      </div>

      {/* ROI Results */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className={`text-center p-4 rounded-lg ${
          data.metrics.roiPositive
            ? "bg-green-50 dark:bg-green-900/30"
            : "bg-red-50 dark:bg-red-900/30"
        }`}>
          <p className={`text-3xl font-bold ${
            data.metrics.roiPositive ? "text-green-600" : "text-red-600"
          }`}>
            {data.metrics.roi > 0 ? "+" : ""}{data.metrics.roi}%
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Return on Investment</p>
          <p className={`text-xs mt-1 font-medium ${
            data.metrics.roiCategory === "excellent" ? "text-green-600" :
            data.metrics.roiCategory === "good" ? "text-blue-600" :
            data.metrics.roiCategory === "positive" ? "text-green-500" : "text-red-500"
          }`}>
            {data.metrics.roiCategory.charAt(0).toUpperCase() + data.metrics.roiCategory.slice(1)}
          </p>
        </div>
        <div className={`text-center p-4 rounded-lg ${
          data.metrics.netSavings >= 0
            ? "bg-blue-50 dark:bg-blue-900/30"
            : "bg-orange-50 dark:bg-orange-900/30"
        }`}>
          <p className={`text-3xl font-bold ${
            data.metrics.netSavings >= 0 ? "text-blue-600" : "text-orange-600"
          }`}>
            ${Math.abs(data.metrics.netSavings).toLocaleString()}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {data.metrics.netSavings >= 0 ? "Net Savings" : "Net Cost"}
          </p>
        </div>
        <div className="text-center p-4 bg-purple-50 dark:bg-purple-900/30 rounded-lg">
          <p className="text-3xl font-bold text-purple-600">
            ${data.metrics.estimatedDevCostSaved.toLocaleString()}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Dev Cost Equivalent</p>
          <p className="text-xs text-gray-400 mt-1">
            {data.metrics.estimatedDevHoursSaved}h × ${hourlyRate}
          </p>
        </div>
        <div className="text-center p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <p className="text-3xl font-bold text-gray-700 dark:text-gray-300">
            ${data.metrics.totalCost.toLocaleString()}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">AI Worker Cost</p>
        </div>
      </div>

      {/* Break-even Analysis */}
      <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Break-even Analysis</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">Break-even hourly rate</p>
            <p className="text-xl font-bold">
              ${data.metrics.breakEvenRate}
              <span className="text-sm font-normal text-gray-500 ml-2">/hour</span>
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {data.metrics.breakEvenRate < hourlyRate
                ? `Your rate ($${hourlyRate}) exceeds break-even — you're saving money!`
                : `Set rate above $${data.metrics.breakEvenRate} to see positive ROI`
              }
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">Cost per developer hour equivalent</p>
            <p className="text-xl font-bold">
              ${data.metrics.costPerDevHourEquivalent}
              <span className="text-sm font-normal text-gray-500 ml-2">/hour</span>
            </p>
            <p className="text-xs text-gray-500 mt-1">
              AI workers cost ${data.metrics.costPerDevHourEquivalent} to do 1 hour of dev work
            </p>
          </div>
        </div>
      </div>

      {/* ROI Visualization Bar */}
      <div className="mt-6">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-gray-600 dark:text-gray-400">AI Cost</span>
          <span className="text-gray-600 dark:text-gray-400">Dev Cost Equivalent</span>
        </div>
        <div className="relative h-8 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          {data.metrics.estimatedDevCostSaved > 0 && (
            <>
              <div
                className="absolute left-0 top-0 h-full bg-red-400 flex items-center justify-center text-white text-xs font-medium"
                style={{
                  width: `${Math.min((data.metrics.totalCost / data.metrics.estimatedDevCostSaved) * 100, 100)}%`,
                }}
              >
                ${data.metrics.totalCost}
              </div>
              <div
                className="absolute right-0 top-0 h-full bg-green-400 flex items-center justify-center text-white text-xs font-medium"
                style={{
                  width: `${Math.max(100 - (data.metrics.totalCost / data.metrics.estimatedDevCostSaved) * 100, 0)}%`,
                }}
              >
                {data.metrics.netSavings > 0 && `+$${data.metrics.netSavings} saved`}
              </div>
            </>
          )}
        </div>
        <div className="flex items-center justify-between text-xs text-gray-500 mt-1">
          <span>$0</span>
          <span>${data.metrics.estimatedDevCostSaved.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

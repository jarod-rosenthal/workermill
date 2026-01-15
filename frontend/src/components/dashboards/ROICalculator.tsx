import { TrendingUp, DollarSign, Clock, Calculator } from 'lucide-react';
import type { ROIMetrics } from '../../types/dashboard';

interface ROICalculatorProps {
  data: ROIMetrics;
  compact?: boolean;
}

export function ROICalculator({ data, compact = false }: ROICalculatorProps) {
  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(1)}M`;
    }
    if (value >= 1000) {
      return `$${(value / 1000).toFixed(1)}K`;
    }
    return `$${value.toFixed(2)}`;
  };

  const formatHours = (hours: number) => {
    if (hours >= 1000) {
      return `${(hours / 1000).toFixed(1)}K`;
    }
    return hours.toLocaleString();
  };

  if (compact) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-emerald-500" />
            <span className="text-sm font-medium text-slate-600 dark:text-slate-400">ROI</span>
          </div>
          <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {data.roiPercentage.toFixed(0)}%
          </span>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
          {formatCurrency(data.netSavings)} saved this period
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Calculator className="h-5 w-5" />
          ROI Calculator
        </h3>
      </div>

      <div className="p-4">
        {/* Main ROI Display */}
        <div className="text-center mb-6">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Return on Investment</p>
          <p className="text-5xl font-bold text-emerald-600 dark:text-emerald-400">
            {data.roiPercentage.toFixed(0)}%
          </p>
        </div>

        {/* Cost Breakdown */}
        <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-4 mb-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-600 dark:text-slate-400">Manual dev cost:</span>
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {formatCurrency(data.manualDevCost)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-600 dark:text-slate-400">AI worker cost:</span>
              <span className="font-medium text-red-600 dark:text-red-400">
                -{formatCurrency(data.aiWorkerCost)}
              </span>
            </div>
            <div className="border-t border-slate-200 dark:border-slate-600 pt-2 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Net Savings:</span>
              <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                {formatCurrency(data.netSavings)}
              </span>
            </div>
          </div>
        </div>

        {/* Additional Metrics */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-cyan-500 mb-1">
              <Clock className="h-4 w-4" />
            </div>
            <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {formatHours(data.developerHoursSaved)}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Hours Saved</p>
          </div>
          <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-purple-500 mb-1">
              <DollarSign className="h-4 w-4" />
            </div>
            <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              ${data.avgDeveloperHourlyCost}/hr
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Avg Dev Cost</p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/30">
        <div className="flex items-center justify-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
          <TrendingUp className="h-4 w-4" />
          <span>Value generated: {formatCurrency(data.developerHoursSaved * data.avgDeveloperHourlyCost)}</span>
        </div>
      </div>
    </div>
  );
}

export default ROICalculator;

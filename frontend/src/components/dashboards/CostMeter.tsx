import { DollarSign, AlertTriangle } from 'lucide-react';
import type { CostMeterData, CostBreakdown } from '../../types/dashboard';

interface CostMeterProps {
  data: CostMeterData;
  showBreakdown?: boolean;
  compact?: boolean;
}

export function CostMeter({ data, showBreakdown = true, compact = false }: CostMeterProps) {
  const budgetPercentage = data.budget
    ? Math.min((data.currentPeriodCost / data.budget) * 100, 100)
    : 0;
  const isOverBudget = data.budget && data.currentPeriodCost > data.budget;
  const isNearBudget = data.budget && budgetPercentage >= 80 && !isOverBudget;

  if (compact) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-slate-500" />
            <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
              Period Cost
            </span>
          </div>
          <span className={`text-xl font-bold ${
            isOverBudget ? 'text-red-600 dark:text-red-400' :
            isNearBudget ? 'text-amber-600 dark:text-amber-400' :
            'text-slate-900 dark:text-slate-100'
          }`}>
            ${data.currentPeriodCost.toFixed(2)}
          </span>
        </div>
        {data.budget && (
          <div className="mt-2">
            <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  isOverBudget ? 'bg-red-500' :
                  isNearBudget ? 'bg-amber-500' :
                  'bg-emerald-500'
                }`}
                style={{ width: `${budgetPercentage}%` }}
              />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {budgetPercentage.toFixed(0)}% of ${data.budget} budget
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <DollarSign className="h-5 w-5" />
          Cost Overview
        </h3>
      </div>

      <div className="p-4">
        {/* Main cost display */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">Current Period</p>
            <p className={`text-3xl font-bold ${
              isOverBudget ? 'text-red-600 dark:text-red-400' :
              isNearBudget ? 'text-amber-600 dark:text-amber-400' :
              'text-slate-900 dark:text-slate-100'
            }`}>
              ${data.currentPeriodCost.toFixed(2)}
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              {formatPeriod(data.period.start, data.period.end)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-500 dark:text-slate-400">Cumulative</p>
            <p className="text-lg font-semibold text-slate-700 dark:text-slate-300">
              ${data.cumulativeCost.toFixed(2)}
            </p>
          </div>
        </div>

        {/* Budget progress */}
        {data.budget && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-slate-500 dark:text-slate-400">Budget</span>
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                ${data.budget.toFixed(2)}
              </span>
            </div>
            <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  isOverBudget ? 'bg-red-500' :
                  isNearBudget ? 'bg-amber-500' :
                  'bg-emerald-500'
                }`}
                style={{ width: `${budgetPercentage}%` }}
              />
            </div>
            {(isOverBudget || isNearBudget) && (
              <div className={`flex items-center gap-1 mt-2 text-sm ${
                isOverBudget ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'
              }`}>
                <AlertTriangle className="h-4 w-4" />
                {isOverBudget
                  ? `Over budget by $${(data.currentPeriodCost - data.budget).toFixed(2)}`
                  : `${(100 - budgetPercentage).toFixed(0)}% of budget remaining`
                }
              </div>
            )}
          </div>
        )}

        {/* Breakdown */}
        {showBreakdown && data.breakdown.length > 0 && (
          <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
              Cost Breakdown by Provider
            </p>
            <div className="space-y-3">
              {data.breakdown.map((item) => (
                <CostBreakdownRow key={item.provider} item={item} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CostBreakdownRow({ item }: { item: CostBreakdown }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="w-3 h-3 rounded-full flex-shrink-0"
        style={{ backgroundColor: item.color }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-700 dark:text-slate-300">{item.provider}</span>
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
            ${item.amount.toFixed(2)}
          </span>
        </div>
        <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mt-1">
          <div
            className="h-full rounded-full"
            style={{
              width: `${item.percentage}%`,
              backgroundColor: item.color,
            }}
          />
        </div>
      </div>
      <span className="text-xs text-slate-500 dark:text-slate-400 w-10 text-right">
        {item.percentage.toFixed(0)}%
      </span>
    </div>
  );
}

function formatPeriod(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);

  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };

  return `${startDate.toLocaleDateString(undefined, options)} - ${endDate.toLocaleDateString(undefined, options)}`;
}

// Inline sparkline for cost trends
interface CostSparklineProps {
  values: number[];
  height?: number;
  color?: string;
}

export function CostSparkline({ values, height = 24, color = '#06b6d4' }: CostSparklineProps) {
  if (values.length < 2) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg viewBox={`0 0 100 ${height}`} className="w-full" preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default CostMeter;

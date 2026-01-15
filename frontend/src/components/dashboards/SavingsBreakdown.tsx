import { PiggyBank, ArrowRight } from 'lucide-react';
import type { SavingsBreakdownData, SavingsCategory } from '../../types/dashboard';

interface SavingsBreakdownProps {
  data: SavingsBreakdownData;
  compact?: boolean;
}

export function SavingsBreakdown({ data, compact = false }: SavingsBreakdownProps) {
  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(2)}M`;
    }
    if (value >= 1000) {
      return `$${(value / 1000).toFixed(1)}K`;
    }
    return `$${value.toFixed(2)}`;
  };

  if (compact) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <PiggyBank className="h-5 w-5 text-emerald-500" />
            <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Savings</span>
          </div>
          <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {formatCurrency(data.totalSavings)}
          </span>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {data.savingsPercentage.toFixed(0)}% reduction vs manual development
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <PiggyBank className="h-5 w-5" />
          Savings Breakdown
        </h3>
      </div>

      <div className="p-4">
        {/* Summary */}
        <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm text-emerald-700 dark:text-emerald-300">Manual Cost</p>
              <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {formatCurrency(data.totalManualCost)}
              </p>
            </div>
            <ArrowRight className="h-5 w-5 text-emerald-500" />
            <div>
              <p className="text-sm text-emerald-700 dark:text-emerald-300">AI Cost</p>
              <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {formatCurrency(data.totalAICost)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-emerald-700 dark:text-emerald-300">You Save</p>
              <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                {formatCurrency(data.totalSavings)}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-center gap-2 text-sm">
            <span className="text-emerald-700 dark:text-emerald-300">
              {data.savingsPercentage.toFixed(0)}% cost reduction
            </span>
          </div>
        </div>

        {/* Category Breakdown */}
        <div className="space-y-3">
          {data.categories.map((category) => (
            <SavingsCategoryRow key={category.category} category={category} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SavingsCategoryRow({ category }: { category: SavingsCategory }) {
  const savingsPercent = category.manualCost > 0
    ? ((category.manualCost - category.aiCost) / category.manualCost) * 100
    : 0;

  const formatCurrency = (value: number) => {
    if (value >= 1000) {
      return `$${(value / 1000).toFixed(1)}K`;
    }
    return `$${value.toFixed(2)}`;
  };

  return (
    <div className="p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: category.color }}
          />
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {category.category}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            ({category.tasks} tasks)
          </span>
        </div>
        <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
          -{savingsPercent.toFixed(0)}%
        </span>
      </div>

      <div className="flex items-center gap-3 text-xs">
        <div className="flex-1">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
            <span>Manual</span>
            <span>{formatCurrency(category.manualCost)}</span>
          </div>
          <div className="h-1.5 bg-slate-300 dark:bg-slate-600 rounded-full" />
        </div>
        <ArrowRight className="h-3 w-3 text-slate-400 flex-shrink-0" />
        <div className="flex-1">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
            <span>AI</span>
            <span>{formatCurrency(category.aiCost)}</span>
          </div>
          <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(category.aiCost / category.manualCost) * 100}%`,
                backgroundColor: category.color,
              }}
            />
          </div>
        </div>
        <div className="w-16 text-right">
          <span className="text-emerald-600 dark:text-emerald-400 font-medium">
            {formatCurrency(category.savings)}
          </span>
        </div>
      </div>
    </div>
  );
}

// Compact savings display for cards
interface SavingsSummaryProps {
  savings: number;
  percentage: number;
}

export function SavingsSummary({ savings, percentage }: SavingsSummaryProps) {
  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(1)}M`;
    }
    if (value >= 1000) {
      return `$${(value / 1000).toFixed(0)}K`;
    }
    return `$${value.toFixed(0)}`;
  };

  return (
    <div className="flex items-center gap-2">
      <PiggyBank className="h-4 w-4 text-emerald-500" />
      <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
        {formatCurrency(savings)} saved ({percentage.toFixed(0)}%)
      </span>
    </div>
  );
}

export default SavingsBreakdown;

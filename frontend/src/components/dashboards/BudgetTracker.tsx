import { Wallet, AlertTriangle } from 'lucide-react';
import type { BudgetTrackerData } from '../../types/dashboard';

interface BudgetTrackerProps {
  data: BudgetTrackerData;
  compact?: boolean;
}

export function BudgetTracker({ data, compact = false }: BudgetTrackerProps) {
  const isOverBudget = data.totalSpent > data.totalBudget;
  const isNearBudget = data.budgetPercentUsed >= 80 && !isOverBudget;

  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(2)}M`;
    }
    if (value >= 1000) {
      return `$${(value / 1000).toFixed(1)}K`;
    }
    return `$${value.toFixed(2)}`;
  };

  const getProgressColor = () => {
    if (isOverBudget) return 'bg-red-500';
    if (isNearBudget) return 'bg-amber-500';
    return 'bg-emerald-500';
  };

  const getTextColor = () => {
    if (isOverBudget) return 'text-red-600 dark:text-red-400';
    if (isNearBudget) return 'text-amber-600 dark:text-amber-400';
    return 'text-emerald-600 dark:text-emerald-400';
  };

  if (compact) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-slate-500" />
            <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Budget</span>
          </div>
          <span className={`text-lg font-bold ${getTextColor()}`}>
            {data.budgetPercentUsed.toFixed(0)}%
          </span>
        </div>
        <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${getProgressColor()}`}
            style={{ width: `${Math.min(data.budgetPercentUsed, 100)}%` }}
          />
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
          {formatCurrency(data.totalSpent)} of {formatCurrency(data.totalBudget)}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          Budget Tracker
        </h3>
      </div>

      <div className="p-4">
        {/* Main Stats */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">Total Spend</p>
            <p className={`text-xl font-bold ${getTextColor()}`}>
              {formatCurrency(data.totalSpent)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">Budget</p>
            <p className="text-xl font-bold text-slate-900 dark:text-slate-100">
              {formatCurrency(data.totalBudget)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">Remaining</p>
            <p className={`text-xl font-bold ${isOverBudget ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}>
              {isOverBudget ? '-' : ''}{formatCurrency(Math.abs(data.budgetRemaining))}
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-slate-500 dark:text-slate-400">Usage</span>
            <span className={`text-sm font-medium ${getTextColor()}`}>
              {data.budgetPercentUsed.toFixed(1)}%
            </span>
          </div>
          <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${getProgressColor()}`}
              style={{ width: `${Math.min(data.budgetPercentUsed, 100)}%` }}
            />
          </div>
        </div>

        {/* Alerts */}
        {data.alerts.length > 0 && (
          <div className="space-y-2 mb-4">
            {data.alerts.map((alert, index) => (
              <div
                key={index}
                className={`flex items-center gap-2 p-2 rounded-lg text-sm ${
                  alert.type === 'critical'
                    ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                    : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'
                }`}
              >
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                <span>{alert.message}</span>
              </div>
            ))}
          </div>
        )}

        {/* Category Breakdown */}
        {data.allocations.length > 0 && (
          <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
              Allocation by Category
            </p>
            <div className="space-y-3">
              {data.allocations.map((allocation) => (
                <AllocationRow key={allocation.category} allocation={allocation} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface AllocationRowProps {
  allocation: {
    category: string;
    allocated: number;
    spent: number;
    remaining: number;
    color: string;
  };
}

function AllocationRow({ allocation }: AllocationRowProps) {
  const percentUsed = allocation.allocated > 0
    ? (allocation.spent / allocation.allocated) * 100
    : 0;

  const formatCurrency = (value: number) => {
    if (value >= 1000) {
      return `$${(value / 1000).toFixed(1)}K`;
    }
    return `$${value.toFixed(2)}`;
  };

  return (
    <div className="flex items-center gap-3">
      <div
        className="w-3 h-3 rounded-full flex-shrink-0"
        style={{ backgroundColor: allocation.color }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm text-slate-700 dark:text-slate-300">{allocation.category}</span>
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {formatCurrency(allocation.spent)} / {formatCurrency(allocation.allocated)}
          </span>
        </div>
        <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(percentUsed, 100)}%`,
              backgroundColor: allocation.color,
            }}
          />
        </div>
      </div>
      <span className="text-xs text-slate-500 dark:text-slate-400 w-12 text-right">
        {percentUsed.toFixed(0)}%
      </span>
    </div>
  );
}

// Budget overview card for summaries
interface BudgetSummaryCardProps {
  spent: number;
  budget: number;
  label?: string;
}

export function BudgetSummaryCard({ spent, budget, label = 'Budget' }: BudgetSummaryCardProps) {
  const percentUsed = budget > 0 ? (spent / budget) * 100 : 0;
  const isOverBudget = spent > budget;
  const isNearBudget = percentUsed >= 80 && !isOverBudget;

  const formatCurrency = (value: number) => `$${value.toLocaleString()}`;

  return (
    <div className={`p-3 rounded-lg ${
      isOverBudget ? 'bg-red-50 dark:bg-red-900/20' :
      isNearBudget ? 'bg-amber-50 dark:bg-amber-900/20' :
      'bg-slate-50 dark:bg-slate-700/50'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-slate-600 dark:text-slate-400">{label}</span>
        <span className={`text-sm font-medium ${
          isOverBudget ? 'text-red-600 dark:text-red-400' :
          isNearBudget ? 'text-amber-600 dark:text-amber-400' :
          'text-slate-700 dark:text-slate-300'
        }`}>
          {percentUsed.toFixed(0)}% used
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
          {formatCurrency(spent)}
        </span>
        <span className="text-sm text-slate-500 dark:text-slate-400">
          of {formatCurrency(budget)}
        </span>
      </div>
    </div>
  );
}

export default BudgetTracker;

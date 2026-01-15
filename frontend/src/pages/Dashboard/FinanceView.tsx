import { useState } from 'react';
import {
  RefreshCw,
  Download,
  DollarSign,
  TrendingUp,
  Calculator,
  FileSpreadsheet,
} from 'lucide-react';
import { MetricGrid } from '../../components/dashboards/MetricTile';
import { BudgetTracker } from '../../components/dashboards/BudgetTracker';
import { CostForecast } from '../../components/dashboards/CostForecast';
import { SavingsBreakdown } from '../../components/dashboards/SavingsBreakdown';
import { CostMeter } from '../../components/dashboards/CostMeter';
import type { FinanceDashboardData } from '../../types/dashboard';

// Mock data for Finance dashboard
const mockFinanceData: FinanceDashboardData = {
  budget: {
    totalBudget: 10000,
    totalSpent: 8450,
    budgetRemaining: 1550,
    budgetPercentUsed: 84.5,
    allocations: [
      { category: 'AI Models', allocated: 6000, spent: 5400, remaining: 600, color: '***REMOVED***06b6d4' },
      { category: 'Compute', allocated: 2500, spent: 1850, remaining: 650, color: '***REMOVED***8b5cf6' },
      { category: 'Storage', allocated: 1000, spent: 800, remaining: 200, color: '***REMOVED***f59e0b' },
      { category: 'Other', allocated: 500, spent: 400, remaining: 100, color: '***REMOVED***94a3b8' },
    ],
    alerts: [
      { type: 'warning', message: 'AI Models category at 90% of budget' },
    ],
  },
  forecast: {
    points: [
      { date: '2025-01-01', actual: 0, budgetLine: 0 },
      { date: '2025-01-07', actual: 2100, budgetLine: 2500 },
      { date: '2025-01-14', actual: 4300, budgetLine: 5000 },
      { date: '2025-01-21', actual: 6800, budgetLine: 7500 },
      { date: '2025-01-28', actual: 8450, budgetLine: 10000 },
      { date: '2025-01-31', forecast: 9200, budgetLine: 10000 },
    ],
    projectedMonthEnd: 9200,
    projectedOverUnder: -800,
    confidence: 85,
  },
  savings: {
    categories: [
      { category: 'Backend Development', manualCost: 45000, aiCost: 3200, savings: 41800, tasks: 85, color: '***REMOVED***06b6d4' },
      { category: 'Frontend Development', manualCost: 32000, aiCost: 2800, savings: 29200, tasks: 62, color: '***REMOVED***8b5cf6' },
      { category: 'DevOps Tasks', manualCost: 18000, aiCost: 1500, savings: 16500, tasks: 34, color: '***REMOVED***10b981' },
      { category: 'Testing & QA', manualCost: 15000, aiCost: 1200, savings: 13800, tasks: 45, color: '***REMOVED***f59e0b' },
      { category: 'Documentation', manualCost: 8000, aiCost: 450, savings: 7550, tasks: 28, color: '***REMOVED***ec4899' },
    ],
    totalManualCost: 118000,
    totalAICost: 9150,
    totalSavings: 108850,
    savingsPercentage: 92.2,
  },
  costPerUnit: {
    perTask: 0.42,
    perPR: 0.85,
    perDeploy: 0.12,
    vsManualPerTask: 45,
  },
  monthlyTrend: [
    { month: 'Sep', spend: 7200, budget: 10000 },
    { month: 'Oct', spend: 9500, budget: 10000 },
    { month: 'Nov', spend: 8100, budget: 10000 },
    { month: 'Dec', spend: 7800, budget: 10000 },
    { month: 'Jan', spend: 8450, budget: 10000 },
  ],
  providerBreakdown: [
    { provider: 'Anthropic', amount: 6082.40, percentage: 72, color: '***REMOVED***06b6d4' },
    { provider: 'OpenAI', amount: 1774.50, percentage: 21, color: '***REMOVED***10b981' },
    { provider: 'Compute', amount: 593.10, percentage: 7, color: '***REMOVED***8b5cf6' },
  ],
};

export function FinanceView() {
  const [isLoading, setIsLoading] = useState(false);
  const [data] = useState<FinanceDashboardData>(mockFinanceData);

  const handleRefresh = () => {
    setIsLoading(true);
    setTimeout(() => setIsLoading(false), 1000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            AI Development Costs
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Budget tracking, forecasting, and ROI analysis
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">
            <option>This Month</option>
            <option>Last Month</option>
            <option>This Quarter</option>
            <option>Year to Date</option>
          </select>
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button className="flex items-center gap-2 px-3 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm transition-colors">
            <FileSpreadsheet className="h-4 w-4" />
            Export to Excel
          </button>
        </div>
      </div>

      {/* Financial KPIs */}
      <MetricGrid
        columns={4}
        metrics={[
          {
            label: 'Total Spend',
            value: `$${data.budget.totalSpent.toLocaleString()}`,
            change: { value: -5.2, type: 'decrease', period: 'vs last month' },
            icon: <DollarSign className="h-5 w-5" />,
            color: 'default',
          },
          {
            label: 'Budget Remaining',
            value: `$${data.budget.budgetRemaining.toLocaleString()}`,
            icon: <Calculator className="h-5 w-5" />,
            color: data.budget.budgetPercentUsed > 90 ? 'warning' : 'success',
          },
          {
            label: 'Forecast (Month-End)',
            value: `$${data.forecast.projectedMonthEnd.toLocaleString()}`,
            change: {
              value: Math.abs(data.forecast.projectedOverUnder),
              type: data.forecast.projectedOverUnder < 0 ? 'decrease' : 'increase',
              period: 'vs budget',
            },
            icon: <TrendingUp className="h-5 w-5" />,
            color: data.forecast.projectedOverUnder > 0 ? 'warning' : 'success',
          },
          {
            label: 'Total Savings',
            value: `$${(data.savings.totalSavings / 1000).toFixed(1)}K`,
            change: { value: data.savings.savingsPercentage, type: 'increase', period: 'cost reduction' },
            icon: <TrendingUp className="h-5 w-5" />,
            color: 'success',
          },
        ]}
      />

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Budget Tracker */}
        <BudgetTracker data={data.budget} />

        {/* Cost Forecast */}
        <CostForecast data={data.forecast} />
      </div>

      {/* Provider Cost Breakdown & Cost Per Unit */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Provider Breakdown */}
        <div className="lg:col-span-2">
          <CostMeter
            data={{
              currentPeriodCost: data.budget.totalSpent,
              cumulativeCost: data.budget.totalSpent * 3, // Simulated YTD
              budget: data.budget.totalBudget,
              breakdown: data.providerBreakdown,
              period: {
                start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
                end: new Date().toISOString(),
              },
            }}
          />
        </div>

        {/* Cost Per Unit */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Cost Per Unit
            </h3>
          </div>
          <div className="p-4 space-y-4">
            <CostPerUnitRow label="Per Task" value={data.costPerUnit.perTask} vsManual={data.costPerUnit.vsManualPerTask} />
            <CostPerUnitRow label="Per PR" value={data.costPerUnit.perPR} />
            <CostPerUnitRow label="Per Deploy" value={data.costPerUnit.perDeploy} />
          </div>
        </div>
      </div>

      {/* Savings Breakdown */}
      <SavingsBreakdown data={data.savings} />

      {/* Monthly Trend */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">Monthly Spend Trend</h3>
          <span className="text-sm text-slate-500 dark:text-slate-400">Last 5 months</span>
        </div>
        <div className="p-4">
          <MonthlyTrendChart data={data.monthlyTrend} />
        </div>
      </div>

      {/* ROI Calculator Section */}
      <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800 p-6">
        <h3 className="text-lg font-semibold text-emerald-900 dark:text-emerald-100 mb-4 flex items-center gap-2">
          <Calculator className="h-5 w-5" />
          ROI Summary
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-slate-800 rounded-lg p-4 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">Developer hours saved</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">3,240 hrs</p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-lg p-4 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">Avg developer cost</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">× $75/hr</p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-lg p-4 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">Value generated</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">= $243,000</p>
          </div>
          <div className="bg-emerald-100 dark:bg-emerald-900/40 rounded-lg p-4 text-center">
            <p className="text-sm text-emerald-700 dark:text-emerald-300">NET ROI</p>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">$234,550</p>
            <p className="text-xs text-emerald-600 dark:text-emerald-400">(2,775%)</p>
          </div>
        </div>
        <div className="flex justify-center gap-4 mt-4">
          <button className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
            <Download className="h-4 w-4" />
            Export to Excel
          </button>
          <button className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm transition-colors">
            <FileSpreadsheet className="h-4 w-4" />
            Generate Invoice
          </button>
        </div>
      </div>
    </div>
  );
}

// Cost per unit row
function CostPerUnitRow({
  label,
  value,
  vsManual,
}: {
  label: string;
  value: number;
  vsManual?: number;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-slate-600 dark:text-slate-400">{label}</span>
      <div className="text-right">
        <span className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          ${value.toFixed(2)}
        </span>
        {vsManual && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400">
            vs ${vsManual}/task manual
          </p>
        )}
      </div>
    </div>
  );
}

// Monthly trend chart
function MonthlyTrendChart({ data }: { data: { month: string; spend: number; budget: number }[] }) {
  const maxValue = Math.max(...data.map((d) => Math.max(d.spend, d.budget)));

  return (
    <div className="h-48">
      <div className="flex items-end gap-4 h-40">
        {data.map((point) => (
          <div key={point.month} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full flex items-end gap-1" style={{ height: '100%' }}>
              {/* Spend bar */}
              <div
                className="flex-1 bg-cyan-500 rounded-t transition-all hover:bg-cyan-600"
                style={{
                  height: `${(point.spend / maxValue) * 100}%`,
                  minHeight: '4px',
                }}
              />
              {/* Budget line indicator */}
              <div
                className="w-1 bg-slate-400 dark:bg-slate-500 rounded"
                style={{
                  height: `${(point.budget / maxValue) * 100}%`,
                  minHeight: '4px',
                }}
              />
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">{point.month}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-center gap-4 mt-2 text-xs">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-cyan-500" />
          <span className="text-slate-500 dark:text-slate-400">Spend</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-slate-400 dark:bg-slate-500" />
          <span className="text-slate-500 dark:text-slate-400">Budget</span>
        </div>
      </div>
    </div>
  );
}

export default FinanceView;

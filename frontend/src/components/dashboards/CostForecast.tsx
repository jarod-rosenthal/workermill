import { TrendingUp, TrendingDown, LineChart } from 'lucide-react';
import type { CostForecastData } from '../../types/dashboard';

interface CostForecastProps {
  data: CostForecastData;
  compact?: boolean;
}

export function CostForecast({ data, compact = false }: CostForecastProps) {
  const isOverBudget = data.projectedOverUnder > 0;
  const isUnderBudget = data.projectedOverUnder < 0;

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
            <LineChart className="h-5 w-5 text-slate-500" />
            <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Forecast</span>
          </div>
          <span className={`text-lg font-bold ${
            isOverBudget ? 'text-red-600 dark:text-red-400' :
            isUnderBudget ? 'text-emerald-600 dark:text-emerald-400' :
            'text-slate-900 dark:text-slate-100'
          }`}>
            {formatCurrency(data.projectedMonthEnd)}
          </span>
        </div>
        <div className={`flex items-center gap-1 text-sm ${
          isOverBudget ? 'text-red-600 dark:text-red-400' :
          isUnderBudget ? 'text-emerald-600 dark:text-emerald-400' :
          'text-slate-500 dark:text-slate-400'
        }`}>
          {isOverBudget && <TrendingUp className="h-4 w-4" />}
          {isUnderBudget && <TrendingDown className="h-4 w-4" />}
          <span>
            {isOverBudget ? '+' : ''}{formatCurrency(data.projectedOverUnder)} vs budget
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <LineChart className="h-5 w-5" />
          Cost Forecast
        </h3>
      </div>

      <div className="p-4">
        {/* Chart */}
        <div className="h-40 mb-4">
          <ForecastChart data={data} />
        </div>

        {/* Projection Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3">
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Projected Month-End</p>
            <p className={`text-xl font-bold ${
              isOverBudget ? 'text-red-600 dark:text-red-400' :
              isUnderBudget ? 'text-emerald-600 dark:text-emerald-400' :
              'text-slate-900 dark:text-slate-100'
            }`}>
              {formatCurrency(data.projectedMonthEnd)}
            </p>
          </div>
          <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3">
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">vs Budget</p>
            <div className={`flex items-center gap-1 ${
              isOverBudget ? 'text-red-600 dark:text-red-400' :
              isUnderBudget ? 'text-emerald-600 dark:text-emerald-400' :
              'text-slate-900 dark:text-slate-100'
            }`}>
              {isOverBudget && <TrendingUp className="h-5 w-5" />}
              {isUnderBudget && <TrendingDown className="h-5 w-5" />}
              <span className="text-xl font-bold">
                {isOverBudget ? '+' : ''}{formatCurrency(data.projectedOverUnder)}
              </span>
            </div>
          </div>
        </div>

        {/* Confidence */}
        <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-slate-500 dark:text-slate-400">Forecast Confidence</span>
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {data.confidence}%
            </span>
          </div>
          <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${
                data.confidence >= 80 ? 'bg-emerald-500' :
                data.confidence >= 60 ? 'bg-amber-500' :
                'bg-red-500'
              }`}
              style={{ width: `${data.confidence}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// Simple SVG chart for forecast visualization
function ForecastChart({ data }: { data: CostForecastData }) {
  const { points } = data;
  if (points.length < 2) return null;

  const padding = { top: 10, right: 10, bottom: 20, left: 40 };
  const width = 100;
  const height = 100;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Calculate scales
  const allValues = points.flatMap(p => [p.actual, p.forecast, p.budgetLine].filter(Boolean)) as number[];
  const maxValue = Math.max(...allValues);
  const minValue = Math.min(...allValues) * 0.9;
  const valueRange = maxValue - minValue;

  const xScale = (index: number) => padding.left + (index / (points.length - 1)) * chartWidth;
  const yScale = (value: number) => padding.top + chartHeight - ((value - minValue) / valueRange) * chartHeight;

  // Build paths
  const budgetPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(p.budgetLine)}`).join(' ');

  const actualPoints = points.filter(p => p.actual !== undefined);
  const actualPath = actualPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(points.indexOf(p))} ${yScale(p.actual!)}`).join(' ');

  const forecastPoints = points.filter(p => p.forecast !== undefined);
  const forecastPath = forecastPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(points.indexOf(p))} ${yScale(p.forecast!)}`).join(' ');

  // Connect actual to forecast
  const lastActualIndex = points.findIndex(p => p.actual !== undefined && points[points.indexOf(p) + 1]?.forecast !== undefined);
  let connectorPath = '';
  if (lastActualIndex >= 0) {
    const lastActual = points[lastActualIndex];
    const firstForecast = points[lastActualIndex + 1];
    if (lastActual.actual && firstForecast.forecast) {
      connectorPath = `M ${xScale(lastActualIndex)} ${yScale(lastActual.actual)} L ${xScale(lastActualIndex + 1)} ${yScale(firstForecast.forecast)}`;
    }
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full" preserveAspectRatio="none">
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
        <line
          key={ratio}
          x1={padding.left}
          y1={padding.top + chartHeight * ratio}
          x2={width - padding.right}
          y2={padding.top + chartHeight * ratio}
          stroke="currentColor"
          strokeOpacity={0.1}
          strokeWidth={0.5}
        />
      ))}

      {/* Budget line (dashed) */}
      <path
        d={budgetPath}
        fill="none"
        stroke="#94a3b8"
        strokeWidth={1}
        strokeDasharray="3,2"
      />

      {/* Actual line */}
      {actualPath && (
        <path
          d={actualPath}
          fill="none"
          stroke="#06b6d4"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {/* Connector */}
      {connectorPath && (
        <path
          d={connectorPath}
          fill="none"
          stroke="#06b6d4"
          strokeWidth={1}
          strokeDasharray="2,2"
        />
      )}

      {/* Forecast line */}
      {forecastPath && (
        <path
          d={forecastPath}
          fill="none"
          stroke="#f59e0b"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="4,2"
        />
      )}

      {/* Legend */}
      <g transform={`translate(${padding.left}, ${height - 8})`}>
        <line x1="0" y1="0" x2="10" y2="0" stroke="#06b6d4" strokeWidth={2} />
        <text x="12" y="3" fontSize="6" fill="currentColor" opacity={0.6}>Actual</text>

        <line x1="35" y1="0" x2="45" y2="0" stroke="#f59e0b" strokeWidth={2} strokeDasharray="2,1" />
        <text x="47" y="3" fontSize="6" fill="currentColor" opacity={0.6}>Forecast</text>

        <line x1="75" y1="0" x2="85" y2="0" stroke="#94a3b8" strokeWidth={1} strokeDasharray="2,1" />
        <text x="87" y="3" fontSize="6" fill="currentColor" opacity={0.6}>Budget</text>
      </g>
    </svg>
  );
}

export default CostForecast;

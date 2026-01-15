import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { MetricTileProps } from '../../types/dashboard';

const colorClasses = {
  default: 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100',
  success: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-900 dark:text-emerald-100',
  warning: 'bg-amber-100 dark:bg-amber-900/30 text-amber-900 dark:text-amber-100',
  error: 'bg-red-100 dark:bg-red-900/30 text-red-900 dark:text-red-100',
  info: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-900 dark:text-cyan-100',
};

const sizeClasses = {
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

const valueSizeClasses = {
  sm: 'text-xl',
  md: 'text-2xl',
  lg: 'text-3xl',
};

export function MetricTile({
  label,
  value,
  change,
  icon,
  color = 'default',
  size = 'md',
}: MetricTileProps) {
  const TrendIcon = change?.type === 'increase' ? TrendingUp :
                    change?.type === 'decrease' ? TrendingDown : Minus;

  const trendColor = change?.type === 'increase' ? 'text-emerald-600 dark:text-emerald-400' :
                     change?.type === 'decrease' ? 'text-red-600 dark:text-red-400' :
                     'text-slate-500 dark:text-slate-400';

  return (
    <div
      className={`
        rounded-lg border border-slate-200 dark:border-slate-700
        ${colorClasses[color]}
        ${sizeClasses[size]}
        transition-all duration-200 hover:shadow-md
      `}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">
            {label}
          </p>
          <p className={`font-bold ${valueSizeClasses[size]}`}>
            {value}
          </p>
          {change && (
            <div className={`flex items-center gap-1 mt-2 text-sm ${trendColor}`}>
              <TrendIcon className="h-4 w-4" />
              <span>
                {change.type === 'increase' ? '+' : change.type === 'decrease' ? '-' : ''}
                {Math.abs(change.value)}%
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                {change.period}
              </span>
            </div>
          )}
        </div>
        {icon && (
          <div className="text-slate-400 dark:text-slate-500">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

// Compact variant for smaller displays
export function MetricTileCompact({
  label,
  value,
  icon,
  color = 'default',
}: Pick<MetricTileProps, 'label' | 'value' | 'icon' | 'color'>) {
  return (
    <div
      className={`
        rounded-lg border border-slate-200 dark:border-slate-700
        ${colorClasses[color]}
        p-3 flex items-center gap-3
        transition-all duration-200 hover:shadow-md
      `}
    >
      {icon && (
        <div className="text-slate-400 dark:text-slate-500 flex-shrink-0">
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
          {label}
        </p>
        <p className="text-lg font-bold truncate">
          {value}
        </p>
      </div>
    </div>
  );
}

// Grid of metrics for dashboard headers
interface MetricGridProps {
  metrics: MetricTileProps[];
  columns?: 2 | 3 | 4;
}

export function MetricGrid({ metrics, columns = 3 }: MetricGridProps) {
  const gridCols = {
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
  };

  return (
    <div className={`grid ${gridCols[columns]} gap-4`}>
      {metrics.map((metric, index) => (
        <MetricTile key={index} {...metric} />
      ))}
    </div>
  );
}

export default MetricTile;

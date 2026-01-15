import { Shield, AlertTriangle, CheckCircle, XCircle, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { RiskScorecardData, RiskLevel, RiskIndicator } from '../../types/dashboard';

interface RiskScorecardProps {
  data: RiskScorecardData;
  compact?: boolean;
}

const riskConfig: Record<RiskLevel, { color: string; bgColor: string; icon: React.ReactNode; label: string }> = {
  low: {
    color: 'text-emerald-600 dark:text-emerald-400',
    bgColor: 'bg-emerald-100 dark:bg-emerald-900/30',
    icon: <CheckCircle className="h-5 w-5" />,
    label: 'Low Risk',
  },
  medium: {
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-100 dark:bg-amber-900/30',
    icon: <AlertTriangle className="h-5 w-5" />,
    label: 'Medium Risk',
  },
  high: {
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-100 dark:bg-orange-900/30',
    icon: <AlertTriangle className="h-5 w-5" />,
    label: 'High Risk',
  },
  critical: {
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    icon: <XCircle className="h-5 w-5" />,
    label: 'Critical Risk',
  },
};

export function RiskScorecard({ data, compact = false }: RiskScorecardProps) {
  const overallConfig = riskConfig[data.overallRisk];

  if (compact) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-slate-500" />
            <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Risk Score</span>
          </div>
          <span className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-sm font-medium ${overallConfig.bgColor} ${overallConfig.color}`}>
            {overallConfig.icon}
            {overallConfig.label}
          </span>
        </div>
        <div className="mt-3 flex gap-3">
          {data.indicators.slice(0, 3).map((indicator) => (
            <div key={indicator.category} className="text-center flex-1">
              <p className={`text-lg font-bold ${riskConfig[indicator.level].color}`}>
                {indicator.count}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {indicator.category}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Risk Scorecard
        </h3>
      </div>

      <div className="p-4">
        {/* Overall Risk Badge */}
        <div className="flex items-center justify-center mb-4">
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full ${overallConfig.bgColor}`}>
            <span className={overallConfig.color}>{overallConfig.icon}</span>
            <span className={`text-lg font-semibold ${overallConfig.color}`}>
              {overallConfig.label}
            </span>
          </div>
        </div>

        {/* Risk Indicators */}
        <div className="space-y-3">
          {data.indicators.map((indicator) => (
            <RiskIndicatorRow key={indicator.category} indicator={indicator} />
          ))}
        </div>

        {/* Last Assessment */}
        <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 text-center">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Last assessment: {formatDate(data.lastAssessment)}
          </p>
        </div>
      </div>
    </div>
  );
}

function RiskIndicatorRow({ indicator }: { indicator: RiskIndicator }) {
  const config = riskConfig[indicator.level];

  return (
    <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
      {/* Level badge */}
      <div className={`w-2 h-8 rounded-full ${
        indicator.level === 'critical' ? 'bg-red-500' :
        indicator.level === 'high' ? 'bg-orange-500' :
        indicator.level === 'medium' ? 'bg-amber-500' :
        'bg-emerald-500'
      }`} />

      {/* Category & Description */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
          {indicator.category}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
          {indicator.description}
        </p>
      </div>

      {/* Count */}
      <div className="flex items-center gap-2">
        <span className={`text-lg font-bold ${config.color}`}>
          {indicator.count}
        </span>
        {indicator.trend && (
          <span className="flex items-center">
            {indicator.trend === 'up' && <TrendingUp className="h-4 w-4 text-red-500" />}
            {indicator.trend === 'down' && <TrendingDown className="h-4 w-4 text-emerald-500" />}
            {indicator.trend === 'stable' && <Minus className="h-4 w-4 text-slate-400" />}
          </span>
        )}
      </div>
    </div>
  );
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Risk summary badge for headers
interface RiskBadgeProps {
  level: RiskLevel;
  onClick?: () => void;
}

export function RiskBadge({ level, onClick }: RiskBadgeProps) {
  const config = riskConfig[level];

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-opacity hover:opacity-80 ${config.bgColor} ${config.color}`}
    >
      {config.icon}
      <span className="text-sm font-medium">{config.label}</span>
    </button>
  );
}

export default RiskScorecard;

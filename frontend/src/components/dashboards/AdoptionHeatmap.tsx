import { Users, TrendingUp, TrendingDown } from 'lucide-react';
import type { TeamAdoptionData } from '../../types/dashboard';

interface AdoptionHeatmapProps {
  teams: TeamAdoptionData[];
  title?: string;
  compact?: boolean;
}

export function AdoptionHeatmap({ teams, title = 'Team Adoption', compact = false }: AdoptionHeatmapProps) {
  // Sort teams by adoption rate
  const sortedTeams = [...teams].sort((a, b) => b.adoptionRate - a.adoptionRate);

  // Calculate overall adoption
  const overallAdoption = teams.length > 0
    ? teams.reduce((sum, t) => sum + t.adoptionRate, 0) / teams.length
    : 0;

  const getAdoptionColor = (rate: number) => {
    if (rate >= 80) return 'bg-emerald-500';
    if (rate >= 60) return 'bg-cyan-500';
    if (rate >= 40) return 'bg-amber-500';
    if (rate >= 20) return 'bg-orange-500';
    return 'bg-red-500';
  };

  const getAdoptionTextColor = (rate: number) => {
    if (rate >= 80) return 'text-emerald-600 dark:text-emerald-400';
    if (rate >= 60) return 'text-cyan-600 dark:text-cyan-400';
    if (rate >= 40) return 'text-amber-600 dark:text-amber-400';
    if (rate >= 20) return 'text-orange-600 dark:text-orange-400';
    return 'text-red-600 dark:text-red-400';
  };

  if (compact) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
          <Users className="h-5 w-5" />
          {title}
        </h4>
        <div className="space-y-2">
          {sortedTeams.slice(0, 4).map((team) => (
            <div key={team.teamName} className="flex items-center gap-2">
              <span className="text-sm text-slate-600 dark:text-slate-400 flex-1 truncate">
                {team.teamName}
              </span>
              <div className="w-20 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${getAdoptionColor(team.adoptionRate)}`}
                  style={{ width: `${team.adoptionRate}%` }}
                />
              </div>
              <span className={`text-xs font-medium w-10 text-right ${getAdoptionTextColor(team.adoptionRate)}`}>
                {team.adoptionRate}%
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Users className="h-5 w-5" />
          {title}
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500 dark:text-slate-400">Overall:</span>
          <span className={`text-sm font-semibold ${getAdoptionTextColor(overallAdoption)}`}>
            {overallAdoption.toFixed(0)}%
          </span>
        </div>
      </div>

      {/* Team List */}
      <div className="p-4 space-y-3">
        {sortedTeams.map((team, index) => (
          <div key={team.teamName} className="group">
            <div className="flex items-center gap-3 mb-1">
              {/* Rank */}
              <span className="text-xs text-slate-400 dark:text-slate-500 w-5">
                #{index + 1}
              </span>

              {/* Team Name */}
              <span className="text-sm font-medium text-slate-900 dark:text-slate-100 flex-1">
                {team.teamName}
              </span>

              {/* Tasks Completed */}
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {team.tasksCompleted} tasks
              </span>

              {/* Adoption Rate */}
              <span className={`text-sm font-semibold w-12 text-right ${getAdoptionTextColor(team.adoptionRate)}`}>
                {team.adoptionRate}%
              </span>
            </div>

            {/* Progress Bar */}
            <div className="ml-8 h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${getAdoptionColor(team.adoptionRate)}`}
                style={{ width: `${team.adoptionRate}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/30">
        <div className="flex items-center justify-center gap-4 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-emerald-500" />
            <span className="text-slate-500 dark:text-slate-400">80%+</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-cyan-500" />
            <span className="text-slate-500 dark:text-slate-400">60-79%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-amber-500" />
            <span className="text-slate-500 dark:text-slate-400">40-59%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-orange-500" />
            <span className="text-slate-500 dark:text-slate-400">20-39%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-red-500" />
            <span className="text-slate-500 dark:text-slate-400">&lt;20%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Adoption trend indicator
interface AdoptionTrendProps {
  current: number;
  previous: number;
}

export function AdoptionTrend({ current, previous }: AdoptionTrendProps) {
  const change = current - previous;
  const isPositive = change > 0;
  const isNeutral = change === 0;

  return (
    <div className={`flex items-center gap-1 text-sm ${
      isNeutral ? 'text-slate-500' :
      isPositive ? 'text-emerald-600 dark:text-emerald-400' :
      'text-red-600 dark:text-red-400'
    }`}>
      {!isNeutral && (
        isPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />
      )}
      <span>{isPositive ? '+' : ''}{change.toFixed(1)}%</span>
    </div>
  );
}

export default AdoptionHeatmap;

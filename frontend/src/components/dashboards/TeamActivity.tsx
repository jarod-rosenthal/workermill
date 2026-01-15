import { useState } from 'react';
import {
  Users,
  TrendingUp,
  Bot,
  User,
  DollarSign,
  CheckCircle,
  XCircle,
  Activity,
} from 'lucide-react';
import type { TeamActivityData, DailyActivity, TeamMember } from '../../types/dashboard';

interface TeamActivityProps {
  data: TeamActivityData;
  showChart?: boolean;
  showMembers?: boolean;
}

export function TeamActivity({ data, showChart = true, showMembers = true }: TeamActivityProps) {
  const [chartView, setChartView] = useState<'tasks' | 'cost'>('tasks');

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          label="Total Tasks"
          value={data.summary.totalTasks}
          icon={<Activity className="h-5 w-5" />}
        />
        <SummaryCard
          label="Completed"
          value={data.summary.completedTasks}
          icon={<CheckCircle className="h-5 w-5" />}
          color="success"
        />
        <SummaryCard
          label="Failed"
          value={data.summary.failedTasks}
          icon={<XCircle className="h-5 w-5" />}
          color={data.summary.failedTasks > 0 ? 'error' : 'default'}
        />
        <SummaryCard
          label="Cost Savings"
          value={`$${data.summary.costSavings.toFixed(0)}`}
          icon={<DollarSign className="h-5 w-5" />}
          color="success"
        />
      </div>

      {/* AI vs Human Split */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
          Work Distribution
        </h4>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden flex">
              <div
                className="h-full bg-cyan-500 transition-all"
                style={{ width: `${data.summary.aiVsHumanSplit.ai}%` }}
              />
              <div
                className="h-full bg-purple-500 transition-all"
                style={{ width: `${data.summary.aiVsHumanSplit.human}%` }}
              />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between mt-2 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-cyan-500 rounded-full" />
            <Bot className="h-4 w-4 text-slate-500" />
            <span className="text-slate-600 dark:text-slate-400">
              AI Workers: {data.summary.aiVsHumanSplit.ai}%
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-purple-500 rounded-full" />
            <User className="h-4 w-4 text-slate-500" />
            <span className="text-slate-600 dark:text-slate-400">
              Human: {data.summary.aiVsHumanSplit.human}%
            </span>
          </div>
        </div>
      </div>

      {/* Activity Chart */}
      {showChart && data.dailyActivity.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Daily Activity
            </h4>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setChartView('tasks')}
                className={`px-3 py-1 text-sm rounded-md transition-colors ${
                  chartView === 'tasks'
                    ? 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                Tasks
              </button>
              <button
                onClick={() => setChartView('cost')}
                className={`px-3 py-1 text-sm rounded-md transition-colors ${
                  chartView === 'cost'
                    ? 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                Cost
              </button>
            </div>
          </div>

          <ActivityBarChart
            data={data.dailyActivity}
            valueKey={chartView}
          />
        </div>
      )}

      {/* Team Members */}
      {showMembers && data.members.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Users className="h-5 w-5" />
              Team Members
            </h4>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {data.members.map((member) => (
              <TeamMemberRow key={member.id} member={member} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface SummaryCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color?: 'default' | 'success' | 'error';
}

function SummaryCard({ label, value, icon, color = 'default' }: SummaryCardProps) {
  const colorClasses = {
    default: 'text-slate-600 dark:text-slate-400',
    success: 'text-emerald-600 dark:text-emerald-400',
    error: 'text-red-600 dark:text-red-400',
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className={colorClasses[color]}>{icon}</span>
        <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${colorClasses[color]}`}>{value}</p>
    </div>
  );
}

interface ActivityBarChartProps {
  data: DailyActivity[];
  valueKey: 'tasks' | 'cost';
}

function ActivityBarChart({ data, valueKey }: ActivityBarChartProps) {
  const values = data.map((d) => d[valueKey]);
  const maxValue = Math.max(...values, 1);

  return (
    <div className="flex items-end gap-1 h-32">
      {data.map((day, index) => {
        const height = (day[valueKey] / maxValue) * 100;
        const dayName = new Date(day.date).toLocaleDateString(undefined, { weekday: 'short' });

        return (
          <div key={index} className="flex-1 flex flex-col items-center gap-1">
            <div
              className="w-full bg-cyan-500 dark:bg-cyan-400 rounded-t transition-all hover:bg-cyan-600 dark:hover:bg-cyan-300 cursor-pointer relative group"
              style={{ height: `${height}%`, minHeight: day[valueKey] > 0 ? '4px' : '0' }}
            >
              {/* Tooltip */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                {valueKey === 'cost' ? `$${day.cost.toFixed(2)}` : `${day.tasks} tasks`}
              </div>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">{dayName}</span>
          </div>
        );
      })}
    </div>
  );
}

function TeamMemberRow({ member }: { member: TeamMember }) {
  const roleColors: Record<string, string> = {
    engineer: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
    manager: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    devops: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    security: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
    qa: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    tech_lead: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
    product_manager: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
    hr: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
      {/* Avatar */}
      <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center overflow-hidden">
        {member.avatar ? (
          <img src={member.avatar} alt={member.name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-lg font-medium text-slate-600 dark:text-slate-400">
            {member.name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{member.name}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{member.email}</p>
      </div>

      {/* Role badge */}
      <span className={`px-2 py-1 text-xs font-medium rounded ${roleColors[member.role] || roleColors.engineer}`}>
        {member.role.replace('_', ' ')}
      </span>

      {/* Stats */}
      <div className="text-right">
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
          {member.tasksCompleted}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">tasks</p>
      </div>
    </div>
  );
}

// Compact version for sidebar
interface TeamActivityCompactProps {
  data: TeamActivityData;
}

export function TeamActivityCompact({ data }: TeamActivityCompactProps) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
      <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
        <Users className="h-5 w-5" />
        Team Summary
      </h4>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-600 dark:text-slate-400">Tasks Completed</span>
          <span className="font-medium text-slate-900 dark:text-slate-100">
            {data.summary.completedTasks} / {data.summary.totalTasks}
          </span>
        </div>

        <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full"
            style={{
              width: `${(data.summary.completedTasks / (data.summary.totalTasks || 1)) * 100}%`,
            }}
          />
        </div>

        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <TrendingUp className="h-4 w-4" />
            <span>${data.summary.costSavings.toFixed(0)} saved</span>
          </div>
          <span className="text-slate-500 dark:text-slate-400">
            {data.summary.aiVsHumanSplit.ai}% AI
          </span>
        </div>
      </div>
    </div>
  );
}

export default TeamActivity;

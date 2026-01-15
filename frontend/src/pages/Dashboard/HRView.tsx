import { useState, useEffect } from 'react';
import {
  RefreshCw,
  AlertCircle,
  Users,
  Bot,
  TrendingUp,
  Clock,
  DollarSign,
  GraduationCap,
  BarChart3,
} from 'lucide-react';
import { MetricGrid } from '../../components/dashboards/MetricTile';
import { ActivityFeed } from '../../components/dashboards/ActivityFeed';
import type {
  HRDashboardData,
  MetricTileProps,
} from '../../types/dashboard';

// Mock data for development
const mockHRData: HRDashboardData = {
  teamUtilization: {
    totalMembers: 12,
    activeWithAI: 9,
    adoptionRate: 75,
  },
  aiImpact: {
    tasksAutomated: 342,
    timeSaved: 156, // hours
    costSavings: 24500,
  },
  trainingNeeds: [
    { topic: 'AI Prompt Engineering', priority: 'high', affectedMembers: 5 },
    { topic: 'Code Review Best Practices', priority: 'medium', affectedMembers: 3 },
    { topic: 'Security Awareness', priority: 'high', affectedMembers: 8 },
    { topic: 'API Development', priority: 'low', affectedMembers: 2 },
  ],
  activity: [
    {
      id: '1',
      type: 'task_completed',
      title: 'New team member onboarded to WorkerMill',
      description: 'Emily Davis completed AI tools training',
      timestamp: new Date(Date.now() - 2 * 3600000).toISOString(),
      severity: 'success',
    },
    {
      id: '2',
      type: 'task_completed',
      title: 'Weekly utilization report generated',
      timestamp: new Date(Date.now() - 24 * 3600000).toISOString(),
      severity: 'info',
    },
    {
      id: '3',
      type: 'escalation',
      title: 'Training gap identified: Security practices',
      timestamp: new Date(Date.now() - 48 * 3600000).toISOString(),
      severity: 'warning',
    },
  ],
};

interface HRViewProps {
  onViewTrainingDetails?: (topic: string) => void;
}

export function HRView({ onViewTrainingDetails }: HRViewProps) {
  const [data, setData] = useState<HRDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    try {
      setData(mockHRData);
      setError(null);
    } catch (err) {
      setError('Failed to load dashboard data');
      console.error('Error fetching HR dashboard:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  if (loading) {
    return <HRViewSkeleton />;
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <p className="text-slate-600 dark:text-slate-400">{error || 'No data available'}</p>
          <button
            onClick={handleRefresh}
            className="mt-4 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const metrics: MetricTileProps[] = [
    {
      label: 'Team Size',
      value: data.teamUtilization.totalMembers,
      icon: <Users className="h-5 w-5" />,
      color: 'default',
    },
    {
      label: 'AI Adoption',
      value: `${data.teamUtilization.adoptionRate}%`,
      change: { value: 15, type: 'increase', period: 'vs last month' },
      icon: <Bot className="h-5 w-5" />,
      color: data.teamUtilization.adoptionRate >= 70 ? 'success' : 'warning',
    },
    {
      label: 'Time Saved',
      value: `${data.aiImpact.timeSaved}h`,
      icon: <Clock className="h-5 w-5" />,
      color: 'success',
    },
    {
      label: 'Cost Savings',
      value: `$${(data.aiImpact.costSavings / 1000).toFixed(1)}k`,
      icon: <DollarSign className="h-5 w-5" />,
      color: 'success',
    },
  ];

  const highPriorityTraining = data.trainingNeeds.filter((t) => t.priority === 'high').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            HR Dashboard
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            Team utilization and AI adoption metrics
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Metrics */}
      <MetricGrid metrics={metrics} columns={4} />

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content - spans 2 columns */}
        <div className="lg:col-span-2 space-y-6">
          {/* Team Utilization */}
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
              <Users className="h-5 w-5" />
              Team Utilization
            </h3>

            <div className="grid grid-cols-3 gap-6">
              <div className="text-center">
                <div className="relative w-24 h-24 mx-auto">
                  <svg className="w-24 h-24 transform -rotate-90">
                    <circle
                      cx="48"
                      cy="48"
                      r="40"
                      stroke="currentColor"
                      strokeWidth="8"
                      fill="none"
                      className="text-slate-200 dark:text-slate-700"
                    />
                    <circle
                      cx="48"
                      cy="48"
                      r="40"
                      stroke="currentColor"
                      strokeWidth="8"
                      fill="none"
                      strokeDasharray={`${(data.teamUtilization.adoptionRate / 100) * 251.2} 251.2`}
                      className="text-cyan-500"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                      {data.teamUtilization.adoptionRate}%
                    </span>
                  </div>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">AI Adoption</p>
              </div>

              <div className="text-center">
                <p className="text-4xl font-bold text-emerald-600 dark:text-emerald-400">
                  {data.teamUtilization.activeWithAI}
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
                  of {data.teamUtilization.totalMembers} actively using AI
                </p>
              </div>

              <div className="text-center">
                <p className="text-4xl font-bold text-purple-600 dark:text-purple-400">
                  {data.aiImpact.tasksAutomated}
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
                  Tasks automated this month
                </p>
              </div>
            </div>
          </div>

          {/* AI Impact */}
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              AI Impact
            </h3>

            <div className="grid grid-cols-2 gap-6">
              <ImpactCard
                title="Time Saved"
                value={`${data.aiImpact.timeSaved} hours`}
                subtitle="This month"
                icon={<Clock className="h-6 w-6" />}
                color="cyan"
              />
              <ImpactCard
                title="Cost Savings"
                value={`$${data.aiImpact.costSavings.toLocaleString()}`}
                subtitle="Estimated savings"
                icon={<DollarSign className="h-6 w-6" />}
                color="emerald"
              />
            </div>

            {/* Productivity breakdown */}
            <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                Productivity Improvement by Category
              </p>
              <div className="space-y-3">
                <ProductivityBar label="Code Generation" percentage={45} />
                <ProductivityBar label="Bug Fixes" percentage={32} />
                <ProductivityBar label="Documentation" percentage={15} />
                <ProductivityBar label="Testing" percentage={8} />
              </div>
            </div>
          </div>

          {/* Training Needs */}
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <GraduationCap className="h-5 w-5" />
                Training Needs
              </h3>
              {highPriorityTraining > 0 && (
                <span className="px-2 py-1 text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-full">
                  {highPriorityTraining} high priority
                </span>
              )}
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {data.trainingNeeds.map((training, index) => (
                <TrainingNeedRow
                  key={index}
                  training={training}
                  onClick={() => onViewTrainingDetails?.(training.topic)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Quick Stats */}
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Key Insights
            </h4>

            <div className="space-y-4">
              <InsightItem
                label="Avg. tasks/employee/week"
                value="8.2"
                trend="up"
                trendValue="+12%"
              />
              <InsightItem
                label="AI completion rate"
                value="94%"
                trend="up"
                trendValue="+3%"
              />
              <InsightItem
                label="Time to onboard"
                value="2 days"
                trend="down"
                trendValue="-40%"
              />
              <InsightItem
                label="Team satisfaction"
                value="4.5/5"
                trend="up"
                trendValue="+0.3"
              />
            </div>
          </div>

          {/* Activity Feed */}
          <ActivityFeed
            activities={data.activity}
            title="Recent Activity"
            compact
            maxItems={6}
          />
        </div>
      </div>
    </div>
  );
}

function ImpactCard({
  title,
  value,
  subtitle,
  icon,
  color,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
  color: 'cyan' | 'emerald';
}) {
  const colorClasses = {
    cyan: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300',
    emerald: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  };

  return (
    <div className={`rounded-lg p-4 ${colorClasses[color]}`}>
      <div className="flex items-center gap-3">
        <div className="opacity-75">{icon}</div>
        <div>
          <p className="text-sm opacity-75">{title}</p>
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-xs opacity-75">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

function ProductivityBar({ label, percentage }: { label: string; percentage: number }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-slate-600 dark:text-slate-400">{label}</span>
        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{percentage}%</span>
      </div>
      <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-purple-500 rounded-full"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function TrainingNeedRow({
  training,
  onClick,
}: {
  training: { topic: string; priority: 'high' | 'medium' | 'low'; affectedMembers: number };
  onClick?: () => void;
}) {
  const priorityColors = {
    high: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    medium: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    low: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300',
  };

  return (
    <div
      className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer transition-colors"
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <GraduationCap className="h-5 w-5 text-slate-400" />
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {training.topic}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {training.affectedMembers} team members
          </p>
        </div>
      </div>
      <span className={`px-2 py-1 text-xs font-medium rounded capitalize ${priorityColors[training.priority]}`}>
        {training.priority}
      </span>
    </div>
  );
}

function InsightItem({
  label,
  value,
  trend,
  trendValue,
}: {
  label: string;
  value: string;
  trend: 'up' | 'down';
  trendValue: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-slate-600 dark:text-slate-400">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-medium text-slate-900 dark:text-slate-100">{value}</span>
        <span className={`text-xs ${
          trend === 'up' ? 'text-emerald-600 dark:text-emerald-400' : 'text-cyan-600 dark:text-cyan-400'
        }`}>
          {trendValue}
        </span>
      </div>
    </div>
  );
}

function HRViewSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div>
          <div className="h-8 w-40 bg-slate-200 dark:bg-slate-700 rounded" />
          <div className="h-4 w-64 bg-slate-200 dark:bg-slate-700 rounded mt-2" />
        </div>
        <div className="h-10 w-24 bg-slate-200 dark:bg-slate-700 rounded" />
      </div>
      <div className="grid grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 bg-slate-200 dark:bg-slate-700 rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="h-48 bg-slate-200 dark:bg-slate-700 rounded-lg" />
          <div className="h-64 bg-slate-200 dark:bg-slate-700 rounded-lg" />
          <div className="h-48 bg-slate-200 dark:bg-slate-700 rounded-lg" />
        </div>
        <div className="space-y-6">
          <div className="h-64 bg-slate-200 dark:bg-slate-700 rounded-lg" />
          <div className="h-80 bg-slate-200 dark:bg-slate-700 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export default HRView;

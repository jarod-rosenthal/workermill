import { useState } from 'react';
import {
  RefreshCw,
  Download,
  Calendar,
  TrendingUp,
  Users,
  CheckCircle,
} from 'lucide-react';
import { MetricGrid } from '../../components/dashboards/MetricTile';
import { ROICalculator } from '../../components/dashboards/ROICalculator';
import { AdoptionHeatmap } from '../../components/dashboards/AdoptionHeatmap';
import { RiskScorecard } from '../../components/dashboards/RiskScorecard';
import { ActivityFeed } from '../../components/dashboards/ActivityFeed';
import type { CTODashboardData, ActivityItem } from '../../types/dashboard';

// Mock data for CTO dashboard
const mockCTOData: CTODashboardData = {
  roi: {
    manualDevCost: 145000,
    aiWorkerCost: 12400,
    netSavings: 132600,
    roiPercentage: 1069,
    developerHoursSaved: 3240,
    avgDeveloperHourlyCost: 75,
  },
  teamAdoption: [
    { teamName: 'Backend Team', adoptionRate: 92, tasksCompleted: 156 },
    { teamName: 'Frontend Team', adoptionRate: 78, tasksCompleted: 89 },
    { teamName: 'DevOps Team', adoptionRate: 62, tasksCompleted: 45 },
    { teamName: 'QA Team', adoptionRate: 45, tasksCompleted: 34 },
    { teamName: 'Mobile Team', adoptionRate: 38, tasksCompleted: 23 },
    { teamName: 'Data Team', adoptionRate: 25, tasksCompleted: 12 },
  ],
  riskScorecard: {
    overallRisk: 'low',
    indicators: [
      { category: 'Security Issues', level: 'low', count: 2, description: 'Low severity vulnerabilities', trend: 'down' },
      { category: 'Rollbacks', level: 'low', count: 0, description: 'No rollbacks this period', trend: 'stable' },
      { category: 'Failed Tasks', level: 'medium', count: 8, description: '3% failure rate', trend: 'down' },
      { category: 'Escalations', level: 'low', count: 3, description: 'Human intervention required', trend: 'stable' },
    ],
    lastAssessment: new Date().toISOString(),
  },
  velocityTrend: [
    { week: 'W1', tasksCompleted: 45 },
    { week: 'W2', tasksCompleted: 52 },
    { week: 'W3', tasksCompleted: 58 },
    { week: 'W4', tasksCompleted: 67 },
    { week: 'W5', tasksCompleted: 78 },
    { week: 'W6', tasksCompleted: 85 },
    { week: 'W7', tasksCompleted: 92 },
    { week: 'W8', tasksCompleted: 98 },
  ],
  qualityMetrics: {
    passRate: 98.2,
    bugRate: 1.8,
    rollbackRate: 0,
  },
  executiveSummary: {
    totalTasksAI: 359,
    totalTasksHuman: 102,
    costSavingsThisMonth: 132600,
    adoptionRate: 78,
  },
};

const mockRecentActivity: ActivityItem[] = [
  {
    id: '1',
    type: 'task_completed',
    title: 'Backend API refactoring completed',
    description: '15 files updated, 200 lines changed',
    timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    severity: 'success',
    jiraKey: 'OCS-456',
  },
  {
    id: '2',
    type: 'deployment_completed',
    title: 'Production deployment successful',
    description: 'v2.4.1 deployed to production',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    severity: 'success',
  },
  {
    id: '3',
    type: 'security_alert',
    title: 'Low severity vulnerability detected',
    description: 'Dependency update recommended',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    severity: 'warning',
  },
];

export function CTOView() {
  const [isLoading, setIsLoading] = useState(false);
  const [data] = useState<CTODashboardData>(mockCTOData);

  const handleRefresh = () => {
    setIsLoading(true);
    setTimeout(() => setIsLoading(false), 1000);
  };

  const aiVsHumanPercent = Math.round(
    (data.executiveSummary.totalTasksAI /
      (data.executiveSummary.totalTasksAI + data.executiveSummary.totalTasksHuman)) *
      100
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Executive Summary
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            AI development ROI and strategic metrics
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">
            <option>Last 30 Days</option>
            <option>Last 90 Days</option>
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
            <Download className="h-4 w-4" />
            Export PDF
          </button>
        </div>
      </div>

      {/* Executive KPIs */}
      <MetricGrid
        columns={4}
        metrics={[
          {
            label: 'ROI',
            value: `${data.roi.roiPercentage.toFixed(0)}%`,
            change: { value: 45, type: 'increase', period: 'vs last month' },
            icon: <TrendingUp className="h-5 w-5" />,
            color: 'success',
          },
          {
            label: 'Tasks by AI',
            value: `${aiVsHumanPercent}%`,
            change: { value: 12, type: 'increase', period: 'vs last month' },
            icon: <CheckCircle className="h-5 w-5" />,
            color: 'info',
          },
          {
            label: 'Quality (Pass Rate)',
            value: `${data.qualityMetrics.passRate.toFixed(1)}%`,
            change: { value: 0.5, type: 'increase', period: 'vs last month' },
            icon: <CheckCircle className="h-5 w-5" />,
            color: 'success',
          },
          {
            label: 'Team Adoption',
            value: `${data.executiveSummary.adoptionRate}%`,
            change: { value: 8, type: 'increase', period: 'vs last month' },
            icon: <Users className="h-5 w-5" />,
            color: 'info',
          },
        ]}
      />

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ROI Calculator */}
        <ROICalculator data={data.roi} />

        {/* Risk Scorecard */}
        <RiskScorecard data={data.riskScorecard} />
      </div>

      {/* Team Adoption */}
      <AdoptionHeatmap teams={data.teamAdoption} title="Team Adoption Rates" />

      {/* Velocity Trend & Quality */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Velocity Chart */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Velocity Trend (Tasks/Week)
            </h3>
          </div>
          <div className="p-4">
            <VelocityChart data={data.velocityTrend} />
          </div>
        </div>

        {/* Quality Metrics */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">Quality Metrics</h3>
          </div>
          <div className="p-4 space-y-4">
            <QualityMetric
              label="Pass Rate"
              value={data.qualityMetrics.passRate}
              suffix="%"
              color="emerald"
            />
            <QualityMetric
              label="Bug Rate"
              value={data.qualityMetrics.bugRate}
              suffix="%"
              color={data.qualityMetrics.bugRate > 5 ? 'red' : 'emerald'}
              inverted
            />
            <QualityMetric
              label="Rollback Rate"
              value={data.qualityMetrics.rollbackRate}
              suffix="%"
              color={data.qualityMetrics.rollbackRate > 1 ? 'amber' : 'emerald'}
              inverted
            />
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <ActivityFeed
        activities={mockRecentActivity}
        title="Recent Activity"
        maxItems={5}
      />
    </div>
  );
}

// Simple bar chart for velocity
function VelocityChart({ data }: { data: { week: string; tasksCompleted: number }[] }) {
  const maxValue = Math.max(...data.map((d) => d.tasksCompleted));

  return (
    <div className="h-48 flex items-end gap-2">
      {data.map((point) => (
        <div key={point.week} className="flex-1 flex flex-col items-center gap-1">
          <div
            className="w-full bg-cyan-500 rounded-t transition-all hover:bg-cyan-600"
            style={{
              height: `${(point.tasksCompleted / maxValue) * 100}%`,
              minHeight: '4px',
            }}
          />
          <span className="text-xs text-slate-500 dark:text-slate-400">{point.week}</span>
        </div>
      ))}
    </div>
  );
}

// Quality metric row
function QualityMetric({
  label,
  value,
  suffix,
  color,
  inverted = false,
}: {
  label: string;
  value: number;
  suffix: string;
  color: string;
  inverted?: boolean;
}) {
  const percentage = inverted ? 100 - value : value;
  const colorClass =
    color === 'emerald'
      ? 'bg-emerald-500'
      : color === 'red'
      ? 'bg-red-500'
      : 'bg-amber-500';

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-slate-600 dark:text-slate-400">{label}</span>
        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {value}
          {suffix}
        </span>
      </div>
      <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${colorClass}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

export default CTOView;

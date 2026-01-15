import { useState } from 'react';
import {
  RefreshCw,
  Download,
  TrendingUp,
  Users,
  DollarSign,
  Clock,
  Eye,
  EyeOff,
  Star,
  MessageSquare,
  Zap,
  Target,
  Award,
} from 'lucide-react';
import { MetricGrid } from '../../components/dashboards/MetricTile';
import type { SalesDashboardData } from '../../types/dashboard';

// Mock data for Sales dashboard - real data shown when demo mode is off
const realData: SalesDashboardData = {
  demoMode: false,
  velocityBenchmarks: [
    { metric: 'Time to First PR', before: 4.5, after: 0.5, improvement: 89, unit: 'hours' },
    { metric: 'Tasks per Developer/Day', before: 1.2, after: 4.8, improvement: 300, unit: 'tasks' },
    { metric: 'Bug Fix Time', before: 3.2, after: 0.8, improvement: 75, unit: 'hours' },
    { metric: 'Code Review Turnaround', before: 8, after: 2, improvement: 75, unit: 'hours' },
  ],
  successStories: [
    {
      id: '1',
      company: 'TechCorp Inc.',
      industry: 'SaaS',
      tasksCompleted: 1250,
      timeSaved: 3200,
      costSavings: 185000,
      testimonial: 'WorkerMill transformed our development velocity.',
    },
    {
      id: '2',
      company: 'DataFlow Systems',
      industry: 'Data Analytics',
      tasksCompleted: 890,
      timeSaved: 2100,
      costSavings: 124000,
    },
    {
      id: '3',
      company: 'CloudFirst',
      industry: 'Cloud Infrastructure',
      tasksCompleted: 2100,
      timeSaved: 5400,
      costSavings: 312000,
      testimonial: 'Our team ships 4x faster with AI workers.',
    },
  ],
  featureRequests: [
    { id: '1', title: 'Slack Integration', requestedBy: 'John D.', company: 'TechCorp', priority: 'high', status: 'in_progress', votesCount: 24, createdAt: '2025-01-10' },
    { id: '2', title: 'Custom Personas', requestedBy: 'Sarah M.', company: 'DataFlow', priority: 'high', status: 'planned', votesCount: 18, createdAt: '2025-01-08' },
    { id: '3', title: 'GitLab Support', requestedBy: 'Mike R.', company: 'CloudFirst', priority: 'medium', status: 'requested', votesCount: 12, createdAt: '2025-01-05' },
  ],
  platformStats: {
    totalTasksCompleted: 15420,
    totalCostSavings: 2340000,
    totalTimeSaved: 42000,
    activeCustomers: 47,
    avgROI: 1850,
  },
  recentWins: [
    { id: '1', title: 'Enterprise Deal - FinServ Co.', value: 125000, closedAt: '2025-01-12' },
    { id: '2', title: 'Expansion - TechCorp Inc.', value: 45000, closedAt: '2025-01-10' },
  ],
};

// Demo data with sanitized/impressive numbers for prospect calls
const demoData: SalesDashboardData = {
  demoMode: true,
  velocityBenchmarks: [
    { metric: 'Time to First PR', before: 4.5, after: 0.5, improvement: 89, unit: 'hours' },
    { metric: 'Tasks per Developer/Day', before: 1.2, after: 4.8, improvement: 300, unit: 'tasks' },
    { metric: 'Bug Fix Time', before: 3.2, after: 0.8, improvement: 75, unit: 'hours' },
    { metric: 'Code Review Turnaround', before: 8, after: 2, improvement: 75, unit: 'hours' },
  ],
  successStories: [
    {
      id: '1',
      company: 'Enterprise Customer A',
      industry: 'Technology',
      tasksCompleted: 2500,
      timeSaved: 6400,
      costSavings: 380000,
      testimonial: 'Dramatically improved our development velocity.',
    },
    {
      id: '2',
      company: 'Growth Company B',
      industry: 'SaaS',
      tasksCompleted: 1800,
      timeSaved: 4200,
      costSavings: 248000,
    },
    {
      id: '3',
      company: 'Scale-up C',
      industry: 'FinTech',
      tasksCompleted: 3200,
      timeSaved: 8100,
      costSavings: 475000,
      testimonial: 'Our engineering team now ships 5x faster.',
    },
  ],
  featureRequests: [
    { id: '1', title: 'Enterprise SSO', requestedBy: 'Customer', company: 'Enterprise', priority: 'high', status: 'shipped', votesCount: 32, createdAt: '2025-01-01' },
    { id: '2', title: 'Custom AI Personas', requestedBy: 'Customer', company: 'Enterprise', priority: 'high', status: 'in_progress', votesCount: 28, createdAt: '2025-01-05' },
    { id: '3', title: 'Advanced Analytics', requestedBy: 'Customer', company: 'Enterprise', priority: 'medium', status: 'planned', votesCount: 22, createdAt: '2025-01-08' },
  ],
  platformStats: {
    totalTasksCompleted: 25000,
    totalCostSavings: 4500000,
    totalTimeSaved: 85000,
    activeCustomers: 100,
    avgROI: 2500,
  },
  recentWins: [],
};

export function SalesView() {
  const [isLoading, setIsLoading] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const data = isDemoMode ? demoData : realData;

  const handleRefresh = () => {
    setIsLoading(true);
    setTimeout(() => setIsLoading(false), 1000);
  };

  return (
    <div className="space-y-6">
      {/* Header with Demo Mode Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Sales Dashboard
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Velocity benchmarks, success stories, and feature requests
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Demo Mode Toggle */}
          <button
            onClick={() => setIsDemoMode(!isDemoMode)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              isDemoMode
                ? 'bg-purple-600 hover:bg-purple-700 text-white'
                : 'bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300'
            }`}
          >
            {isDemoMode ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            {isDemoMode ? 'Demo Mode ON' : 'Demo Mode OFF'}
          </button>
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
            Export Deck
          </button>
        </div>
      </div>

      {/* Demo Mode Banner */}
      {isDemoMode && (
        <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <Eye className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            <div>
              <p className="font-medium text-purple-900 dark:text-purple-100">Demo Mode Active</p>
              <p className="text-sm text-purple-700 dark:text-purple-300">
                Showing sanitized data optimized for prospect presentations. Toggle off to see real metrics.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Platform Showcase Stats */}
      <MetricGrid
        columns={4}
        metrics={[
          {
            label: 'Tasks Completed',
            value: data.platformStats.totalTasksCompleted.toLocaleString(),
            icon: <Zap className="h-5 w-5" />,
            color: 'info',
          },
          {
            label: 'Total Cost Savings',
            value: `$${(data.platformStats.totalCostSavings / 1000000).toFixed(1)}M`,
            icon: <DollarSign className="h-5 w-5" />,
            color: 'success',
          },
          {
            label: 'Active Customers',
            value: data.platformStats.activeCustomers.toString(),
            icon: <Users className="h-5 w-5" />,
            color: 'default',
          },
          {
            label: 'Average ROI',
            value: `${data.platformStats.avgROI}%`,
            icon: <TrendingUp className="h-5 w-5" />,
            color: 'success',
          },
        ]}
      />

      {/* Secondary Stats Row */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4 flex items-center gap-4">
          <div className="p-3 bg-cyan-100 dark:bg-cyan-900/30 rounded-lg">
            <Clock className="h-6 w-6 text-cyan-600 dark:text-cyan-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {(data.platformStats.totalTimeSaved / 1000).toFixed(0)}K
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400">Hours Saved</p>
          </div>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-700 p-4 flex items-center gap-4">
          <div className="p-3 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
            <DollarSign className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              ${(data.platformStats.totalCostSavings / data.platformStats.activeCustomers / 1000).toFixed(0)}K
            </p>
            <p className="text-sm text-emerald-700 dark:text-emerald-300">Avg Savings per Customer</p>
          </div>
        </div>
      </div>

      {/* Velocity Benchmarks */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Target className="h-5 w-5" />
            Velocity Benchmarks
          </h3>
          <span className="text-xs text-slate-500 dark:text-slate-400">Before vs After WorkerMill</span>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {data.velocityBenchmarks.map((benchmark) => (
              <VelocityCard key={benchmark.metric} benchmark={benchmark} />
            ))}
          </div>
        </div>
      </div>

      {/* Two Column: Success Stories & Feature Requests */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Customer Success Stories */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Award className="h-5 w-5" />
              Customer Success Stories
            </h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">{data.successStories.length} stories</span>
          </div>
          <div className="p-4 space-y-4">
            {data.successStories.map((story) => (
              <SuccessStoryCard key={story.id} story={story} />
            ))}
          </div>
        </div>

        {/* Feature Requests */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Feature Requests
            </h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">From customers</span>
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-700">
            {data.featureRequests.map((request) => (
              <FeatureRequestRow key={request.id} request={request} />
            ))}
          </div>
        </div>
      </div>

      {/* Recent Wins (only shown when not in demo mode) */}
      {!isDemoMode && data.recentWins.length > 0 && (
        <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
          <div className="px-4 py-3 border-b border-emerald-200 dark:border-emerald-700">
            <h3 className="font-semibold text-emerald-900 dark:text-emerald-100 flex items-center gap-2">
              <Star className="h-5 w-5" />
              Recent Wins
            </h3>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.recentWins.map((win) => (
                <div
                  key={win.id}
                  className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-emerald-200 dark:border-emerald-700"
                >
                  <p className="font-medium text-slate-900 dark:text-slate-100">{win.title}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                      ${win.value.toLocaleString()}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {new Date(win.closedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Velocity benchmark card
function VelocityCard({
  benchmark,
}: {
  benchmark: { metric: string; before: number; after: number; improvement: number; unit: string };
}) {
  return (
    <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-4">
      <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-3">{benchmark.metric}</p>
      <div className="flex items-end gap-2 mb-2">
        <div className="flex-1">
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Before</p>
          <p className="text-lg font-semibold text-slate-400 dark:text-slate-500 line-through">
            {benchmark.before} {benchmark.unit}
          </p>
        </div>
        <div className="flex-1">
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">After</p>
          <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {benchmark.after} {benchmark.unit}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full"
            style={{ width: `${Math.min(benchmark.improvement, 100)}%` }}
          />
        </div>
        <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
          {benchmark.improvement > 100 ? `${benchmark.improvement}%` : `${benchmark.improvement}%`}
        </span>
      </div>
    </div>
  );
}

// Success story card
function SuccessStoryCard({
  story,
}: {
  story: {
    company: string;
    industry: string;
    tasksCompleted: number;
    timeSaved: number;
    costSavings: number;
    testimonial?: string;
  };
}) {
  return (
    <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-medium text-slate-900 dark:text-slate-100">{story.company}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{story.industry}</p>
        </div>
        <span className="px-2 py-1 bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 text-xs rounded-full">
          Customer
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="text-center">
          <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
            {story.tasksCompleted.toLocaleString()}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Tasks</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
            {(story.timeSaved / 24).toFixed(0)}d
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Saved</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
            ${(story.costSavings / 1000).toFixed(0)}K
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Savings</p>
        </div>
      </div>
      {story.testimonial && (
        <p className="text-sm text-slate-600 dark:text-slate-400 italic border-l-2 border-cyan-500 pl-3">
          "{story.testimonial}"
        </p>
      )}
    </div>
  );
}

// Feature request row
function FeatureRequestRow({
  request,
}: {
  request: {
    title: string;
    requestedBy: string;
    company: string;
    priority: 'high' | 'medium' | 'low';
    status: 'requested' | 'planned' | 'in_progress' | 'shipped';
    votesCount: number;
  };
}) {
  const priorityColors = {
    high: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    medium: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    low: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400',
  };

  const statusColors = {
    requested: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400',
    planned: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
    in_progress: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    shipped: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  };

  return (
    <div className="px-4 py-3 flex items-center justify-between">
      <div className="flex-1">
        <p className="font-medium text-slate-900 dark:text-slate-100">{request.title}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {request.requestedBy} at {request.company}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1 text-sm text-slate-600 dark:text-slate-400">
          <Star className="h-3 w-3" />
          {request.votesCount}
        </span>
        <span className={`px-2 py-1 text-xs rounded-full ${priorityColors[request.priority]}`}>
          {request.priority}
        </span>
        <span className={`px-2 py-1 text-xs rounded-full ${statusColors[request.status]}`}>
          {request.status.replace('_', ' ')}
        </span>
      </div>
    </div>
  );
}

export default SalesView;

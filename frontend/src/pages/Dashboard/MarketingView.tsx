import { useState } from 'react';
import {
  RefreshCw,
  Download,
  Calendar,
  Megaphone,
  FileText,
  Rocket,
  Clock,
  CheckCircle,
  Circle,
  ArrowRight,
  ExternalLink,
  TrendingUp,
} from 'lucide-react';
import { MetricGrid } from '../../components/dashboards/MetricTile';
import type { MarketingDashboardData } from '../../types/dashboard';

// Mock data for Marketing dashboard
const mockMarketingData: MarketingDashboardData = {
  releaseTimeline: [
    {
      id: '1',
      version: 'v2.5.0',
      title: 'Enterprise SSO & Team Management',
      description: 'SAML/OIDC SSO, team roles, and organization management',
      type: 'feature',
      status: 'shipped',
      releaseDate: '2025-01-10',
      jiraKeys: ['OCS-201', 'OCS-205'],
      prNumbers: [156, 158, 160],
    },
    {
      id: '2',
      version: 'v2.6.0',
      title: 'Custom AI Personas',
      description: 'Create and configure custom AI worker personas',
      type: 'feature',
      status: 'in_progress',
      plannedDate: '2025-01-25',
      jiraKeys: ['OCS-210', 'OCS-212'],
    },
    {
      id: '3',
      version: 'v2.7.0',
      title: 'Advanced Analytics Dashboard',
      description: 'Enhanced metrics, custom reports, and data exports',
      type: 'feature',
      status: 'planned',
      plannedDate: '2025-02-08',
      jiraKeys: ['OCS-220'],
    },
    {
      id: '4',
      version: 'v2.5.1',
      title: 'Performance Improvements',
      description: 'Faster task execution and reduced latency',
      type: 'improvement',
      status: 'shipped',
      releaseDate: '2025-01-12',
    },
  ],
  announcements: [
    {
      id: '1',
      title: 'Introducing Enterprise SSO',
      description: 'Secure your WorkerMill deployment with SAML and OIDC support',
      releaseId: '1',
      status: 'published',
      publishedAt: '2025-01-10',
      channels: ['blog', 'email', 'twitter', 'linkedin'],
    },
    {
      id: '2',
      title: 'Custom AI Personas Coming Soon',
      description: 'Define specialized AI workers for your unique workflows',
      releaseId: '2',
      status: 'scheduled',
      scheduledFor: '2025-01-25',
      channels: ['blog', 'email'],
    },
    {
      id: '3',
      title: 'Q1 Product Roadmap',
      description: 'What we are building in Q1 2025',
      releaseId: '',
      status: 'draft',
      channels: ['blog'],
    },
  ],
  changelog: [
    { week: 'Jan 6-12', features: 3, improvements: 5, fixes: 8 },
    { week: 'Dec 30-Jan 5', features: 2, improvements: 3, fixes: 6 },
    { week: 'Dec 23-29', features: 1, improvements: 4, fixes: 4 },
    { week: 'Dec 16-22', features: 4, improvements: 6, fixes: 10 },
  ],
  velocityMetrics: {
    featuresShippedThisMonth: 8,
    avgTimeToShip: 4.2,
    upcomingFeatures: 12,
  },
  contentQueue: [
    { id: '1', title: 'How TechCorp Saved $185K with AI Workers', type: 'case_study', status: 'writing', dueDate: '2025-01-20' },
    { id: '2', title: 'Getting Started with Custom Personas', type: 'blog', status: 'idea', dueDate: '2025-01-28' },
    { id: '3', title: 'WorkerMill Demo Webinar', type: 'webinar', status: 'scheduled', dueDate: '2025-01-30' },
    { id: '4', title: 'AI-Powered Development: Best Practices', type: 'blog', status: 'review', dueDate: '2025-01-18' },
  ],
};

export function MarketingView() {
  const [isLoading, setIsLoading] = useState(false);
  const [data] = useState<MarketingDashboardData>(mockMarketingData);

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
            Marketing Dashboard
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Release timeline, announcements, and content planning
          </p>
        </div>
        <div className="flex items-center gap-3">
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
            Export Changelog
          </button>
        </div>
      </div>

      {/* Velocity Metrics */}
      <MetricGrid
        columns={3}
        metrics={[
          {
            label: 'Features Shipped (This Month)',
            value: data.velocityMetrics.featuresShippedThisMonth.toString(),
            change: { value: 33, type: 'increase', period: 'vs last month' },
            icon: <Rocket className="h-5 w-5" />,
            color: 'success',
          },
          {
            label: 'Avg Time to Ship',
            value: `${data.velocityMetrics.avgTimeToShip} days`,
            change: { value: 15, type: 'decrease', period: 'vs last month' },
            icon: <Clock className="h-5 w-5" />,
            color: 'info',
          },
          {
            label: 'Upcoming Features',
            value: data.velocityMetrics.upcomingFeatures.toString(),
            icon: <TrendingUp className="h-5 w-5" />,
            color: 'default',
          },
        ]}
      />

      {/* Release Timeline */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Release Timeline
          </h3>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {data.releaseTimeline.filter((r) => r.status === 'shipped').length} shipped,{' '}
            {data.releaseTimeline.filter((r) => r.status === 'in_progress').length} in progress,{' '}
            {data.releaseTimeline.filter((r) => r.status === 'planned').length} planned
          </span>
        </div>
        <div className="p-4">
          <div className="space-y-4">
            {data.releaseTimeline.map((release, index) => (
              <ReleaseTimelineItem key={release.id} release={release} isLast={index === data.releaseTimeline.length - 1} />
            ))}
          </div>
        </div>
      </div>

      {/* Two Column: Announcements & Content Queue */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Announcements */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Megaphone className="h-5 w-5" />
              Announcement Queue
            </h3>
            <button className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline">
              + New Announcement
            </button>
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-700">
            {data.announcements.map((announcement) => (
              <AnnouncementRow key={announcement.id} announcement={announcement} />
            ))}
          </div>
        </div>

        {/* Content Queue */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Content Queue
            </h3>
            <button className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline">
              + New Content
            </button>
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-700">
            {data.contentQueue.map((content) => (
              <ContentQueueRow key={content.id} content={content} />
            ))}
          </div>
        </div>
      </div>

      {/* Weekly Changelog Chart */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">Weekly Changelog</h3>
          <span className="text-xs text-slate-500 dark:text-slate-400">Auto-generated from merged PRs</span>
        </div>
        <div className="p-4">
          <ChangelogChart data={data.changelog} />
        </div>
      </div>
    </div>
  );
}

// Release timeline item
function ReleaseTimelineItem({
  release,
  isLast,
}: {
  release: {
    version: string;
    title: string;
    description: string;
    type: 'feature' | 'improvement' | 'fix';
    status: 'shipped' | 'in_progress' | 'planned';
    releaseDate?: string;
    plannedDate?: string;
    jiraKeys?: string[];
    prNumbers?: number[];
  };
  isLast: boolean;
}) {
  const statusConfig = {
    shipped: { icon: CheckCircle, color: 'text-emerald-500', bg: 'bg-emerald-100 dark:bg-emerald-900/30' },
    in_progress: { icon: ArrowRight, color: 'text-amber-500', bg: 'bg-amber-100 dark:bg-amber-900/30' },
    planned: { icon: Circle, color: 'text-slate-400', bg: 'bg-slate-100 dark:bg-slate-700' },
  };

  const typeColors = {
    feature: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300',
    improvement: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
    fix: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  };

  const StatusIcon = statusConfig[release.status].icon;
  const date = release.releaseDate || release.plannedDate;

  return (
    <div className="flex gap-4">
      {/* Timeline indicator */}
      <div className="flex flex-col items-center">
        <div className={`p-2 rounded-full ${statusConfig[release.status].bg}`}>
          <StatusIcon className={`h-4 w-4 ${statusConfig[release.status].color}`} />
        </div>
        {!isLast && <div className="w-0.5 flex-1 bg-slate-200 dark:bg-slate-700 my-2" />}
      </div>

      {/* Content */}
      <div className="flex-1 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
                {release.version}
              </span>
              <span className={`px-2 py-0.5 text-xs rounded-full ${typeColors[release.type]}`}>
                {release.type}
              </span>
            </div>
            <p className="font-medium text-slate-900 dark:text-slate-100">{release.title}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{release.description}</p>
          </div>
          {date && (
            <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
              {release.status === 'shipped' ? 'Released' : 'Planned'}: {new Date(date).toLocaleDateString()}
            </span>
          )}
        </div>

        {/* Links */}
        {(release.jiraKeys?.length || release.prNumbers?.length) && (
          <div className="flex items-center gap-3 mt-2">
            {release.jiraKeys?.map((key) => (
              <a
                key={key}
                href={`https://workermill.atlassian.net/browse/${key}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
              >
                {key}
                <ExternalLink className="h-3 w-3" />
              </a>
            ))}
            {release.prNumbers?.map((pr) => (
              <a
                key={pr}
                href={`https://github.com/workermill/workermill/pull/${pr}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400 hover:underline"
              >
                PR #{pr}
                <ExternalLink className="h-3 w-3" />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Announcement row
function AnnouncementRow({
  announcement,
}: {
  announcement: {
    title: string;
    description: string;
    status: 'draft' | 'scheduled' | 'published';
    scheduledFor?: string;
    publishedAt?: string;
    channels: ('blog' | 'email' | 'twitter' | 'linkedin')[];
  };
}) {
  const statusConfig = {
    draft: { label: 'Draft', color: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400' },
    scheduled: { label: 'Scheduled', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' },
    published: { label: 'Published', color: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' },
  };

  const channelEmojis = {
    blog: '📝',
    email: '📧',
    twitter: '🐦',
    linkedin: '💼',
  };

  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="font-medium text-slate-900 dark:text-slate-100">{announcement.title}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{announcement.description}</p>
          <div className="flex items-center gap-2 mt-2">
            <span className={`px-2 py-0.5 text-xs rounded-full ${statusConfig[announcement.status].color}`}>
              {statusConfig[announcement.status].label}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {announcement.channels.map((c) => channelEmojis[c]).join(' ')}
            </span>
          </div>
        </div>
        {(announcement.scheduledFor || announcement.publishedAt) && (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {announcement.status === 'published'
              ? new Date(announcement.publishedAt!).toLocaleDateString()
              : new Date(announcement.scheduledFor!).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  );
}

// Content queue row
function ContentQueueRow({
  content,
}: {
  content: {
    title: string;
    type: 'blog' | 'case_study' | 'video' | 'webinar';
    status: 'idea' | 'writing' | 'review' | 'scheduled' | 'published';
    dueDate?: string;
  };
}) {
  const typeLabels = {
    blog: { label: 'Blog', color: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300' },
    case_study: { label: 'Case Study', color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' },
    video: { label: 'Video', color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' },
    webinar: { label: 'Webinar', color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' },
  };

  const statusLabels = {
    idea: { label: 'Idea', color: 'text-slate-500' },
    writing: { label: 'Writing', color: 'text-blue-500' },
    review: { label: 'Review', color: 'text-amber-500' },
    scheduled: { label: 'Scheduled', color: 'text-purple-500' },
    published: { label: 'Published', color: 'text-emerald-500' },
  };

  return (
    <div className="px-4 py-3 flex items-center justify-between">
      <div className="flex-1">
        <p className="font-medium text-slate-900 dark:text-slate-100">{content.title}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className={`px-2 py-0.5 text-xs rounded-full ${typeLabels[content.type].color}`}>
            {typeLabels[content.type].label}
          </span>
          <span className={`text-xs ${statusLabels[content.status].color}`}>
            {statusLabels[content.status].label}
          </span>
        </div>
      </div>
      {content.dueDate && (
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Due: {new Date(content.dueDate).toLocaleDateString()}
        </span>
      )}
    </div>
  );
}

// Changelog chart
function ChangelogChart({
  data,
}: {
  data: { week: string; features: number; improvements: number; fixes: number }[];
}) {
  const maxValue = Math.max(...data.map((d) => d.features + d.improvements + d.fixes));

  return (
    <div className="space-y-4">
      {data.map((week) => {
        const total = week.features + week.improvements + week.fixes;
        return (
          <div key={week.week}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-slate-600 dark:text-slate-400">{week.week}</span>
              <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{total} changes</span>
            </div>
            <div className="h-6 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden flex">
              <div
                className="bg-cyan-500 h-full"
                style={{ width: `${(week.features / maxValue) * 100}%` }}
                title={`${week.features} features`}
              />
              <div
                className="bg-purple-500 h-full"
                style={{ width: `${(week.improvements / maxValue) * 100}%` }}
                title={`${week.improvements} improvements`}
              />
              <div
                className="bg-amber-500 h-full"
                style={{ width: `${(week.fixes / maxValue) * 100}%` }}
                title={`${week.fixes} fixes`}
              />
            </div>
          </div>
        );
      })}
      <div className="flex items-center justify-center gap-4 mt-2 text-xs">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-cyan-500" />
          <span className="text-slate-500 dark:text-slate-400">Features</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-purple-500" />
          <span className="text-slate-500 dark:text-slate-400">Improvements</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-amber-500" />
          <span className="text-slate-500 dark:text-slate-400">Fixes</span>
        </div>
      </div>
    </div>
  );
}

export default MarketingView;

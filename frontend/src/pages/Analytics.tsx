import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useAuthStore } from "../store/auth-store";
import { AnalyticsSkeleton } from "../components/ui/skeleton";

interface UsageStats {
  plan: string;
  tasks: {
    used: number;
    quota: number;
    percent: number;
    isUnlimited: boolean;
  };
  billingPeriod: {
    start: string | null;
    daysUntilReset: number;
  };
}

interface TaskStats {
  total: number;
  completed: number;
  failed: number;
  deployed: number;
  inProgress: number;
}

interface DailyUsage {
  date: string;
  tasks: number;
  cost: number;
}

interface PrdMetrics {
  period: {
    days: number;
    startDate: string;
    endDate: string;
  };
  summary: {
    totalPrdWorkflows: number;
    completed: number;
    failed: number;
    inProgress: number;
    successRate: number;
  };
  costVariance: {
    totalPlannedCost: number;
    totalActualCost: number;
    avgVariancePercent: number;
    dataPoints: number;
  };
  planAccuracy: {
    totalPlannedStories: number;
    totalExecutedStories: number;
    accuracyPercent: number;
  };
  timeToCompletion: {
    byComplexity: Record<string, number>;
    byComplexityReadable: Record<string, string>;
  };
}

interface FailureCategory {
  category: string;
  label: string;
  count: number;
  percentage: number;
  examples: string[];
}

interface FailureMetrics {
  period: {
    days: number;
    startDate: string;
    endDate: string;
  };
  summary: {
    totalFailures: number;
    totalTasks: number;
    failureRate: number;
    retriedTasks: number;
    maxRetriesExhausted: number;
  };
  byCategory: FailureCategory[];
  byPersona: Array<{ persona: string; count: number }>;
  byModel: Array<{ model: string; count: number }>;
  weeklyTrend: Array<{ week: string; count: number }>;
}

interface EffectivenessMetrics {
  period: {
    days: number;
    startDate: string;
    endDate: string;
  };
  summary: {
    total: number;
    successful: number;
    deployed: number;
    failed: number;
    cancelled: number;
    escalated: number;
    reviewRejected: number;
    successRate: number;
    deploymentRate: number;
    firstAttemptRate: number;
    prAcceptanceRate: number;
    escalationRate: number;
  };
  prStats: {
    total: number;
    accepted: number;
    rejected: number;
    acceptanceRate: number;
  };
  byModel: Array<{
    model: string;
    total: number;
    successRate: number;
    deploymentRate: number;
    firstAttemptRate: number;
  }>;
  byPersona: Array<{
    persona: string;
    total: number;
    successRate: number;
    deploymentRate: number;
    firstAttemptRate: number;
  }>;
  trend: Array<{
    date: string;
    success: number;
    failed: number;
    deployed: number;
    total: number;
    successRate: number;
  }>;
}

interface ReviewMetrics {
  period: {
    days: number;
    startDate: string;
    endDate: string;
  };
  summary: {
    totalTasks: number;
    reviewedTasks: number;
    adoptionRate: number;
    firstPassApprovalRate: number;
    avgRevisionsPerTask: number;
  };
  revisionDistribution: {
    zero: number;
    one: number;
    two: number;
    threeOrMore: number;
  };
  decisions: {
    approved: number;
    revisionNeeded: number;
    rejected: number;
    escalated: number;
  };
  qualityImpact: {
    reviewedAvgAccuracy: number | null;
    nonReviewedAvgAccuracy: number | null;
    reviewedOutcomes: { accepted: number; rejected: number; partial: number };
    nonReviewedOutcomes: { accepted: number; rejected: number; partial: number };
  };
  efficiency: {
    reviewedAvgDurationMinutes: number | null;
    nonReviewedAvgDurationMinutes: number | null;
    reviewedAvgCost: number | null;
    nonReviewedAvgCost: number | null;
  };
  trend: Array<{
    date: string;
    reviewedCount: number;
    approvedFirstPass: number;
    totalRevisions: number;
  }>;
  byPersona: Array<{
    persona: string;
    reviewedCount: number;
    approvalRate: number;
    avgRevisions: number;
  }>;
  byModel: Array<{
    model: string;
    reviewedCount: number;
    approvalRate: number;
    avgRevisions: number;
  }>;
}

interface CodeQualityMetrics {
  period: {
    days: number;
    startDate: string;
    endDate: string;
  };
  summary: {
    totalTasks: number;
    tasksWithMetrics: number;
    metricsRate: number;
    averageQualityScore: number;
    averageLintScore: number;
    averageTypecheckScore: number;
    averageTestScore: number;
    averageCoverageScore: number;
    averageSecurityScore: number;
  };
  scoreDistribution: {
    excellent: number;
    good: number;
    fair: number;
    poor: number;
  };
  byPersona: Array<{
    persona: string;
    taskCount: number;
    avgScore: number;
  }>;
  byModel: Array<{
    model: string;
    taskCount: number;
    avgScore: number;
  }>;
  trend: Array<{
    date: string;
    taskCount: number;
    avgScore: number;
  }>;
  lowQualityTasks: Array<{
    id: string;
    jiraKey: string | null;
    summary: string | null;
    qualityScore: number | null;
    lintScore: number | null;
    typecheckScore: number | null;
    testScore: number | null;
    coverageScore: number | null;
    securityScore: number | null;
    persona: string | null;
    model: string | null;
    completedAt: string | null;
  }>;
}

interface TokenUsageMetrics {
  period: {
    days: number;
    startDate: string;
    endDate: string;
  };
  summary: {
    taskCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheCreation: number;
    totalCacheRead: number;
    totalTokens: number;
    totalCost: number;
    cacheEfficiency: number;
    avgTokensPerTask: number;
    avgCostPerTask: number;
  };
  byPhase: Array<{
    phase: string;
    records: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cost: number;
  }>;
  byPersona: Array<{
    persona: string;
    records: number;
    totalTokens: number;
    cost: number;
  }>;
  byModel: Array<{
    model: string;
    records: number;
    totalTokens: number;
    cost: number;
  }>;
  byOperationType: Array<{
    operationType: string;
    records: number;
    totalTokens: number;
    cost: number;
  }>;
  trends: Array<{
    date: string;
    tasks: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cost: number;
  }>;
}

interface BusinessOutcomes {
  period: {
    days: number;
    range: string;
    startDate: string;
    endDate: string;
  };
  summary: {
    prsMerged: number;
    issuesClosed: number;
    totalLinesChanged: number;
    totalFilesModified: number;
    successfulTasks: number;
    totalTasks: number;
    successRate: number;
    avgLinesPerTask: number;
    avgFilesPerTask: number;
    costPerLineChanged: number;
    totalCost: number;
    executionHours: number;
  };
  byComplexity: Array<{
    complexity: string;
    count: number;
    linesChanged: number;
    cost: number;
  }>;
  trend: Array<{
    date: string;
    tasksCompleted: number;
    prsMerged: number;
    linesChanged: number;
  }>;
  topRepositories: Array<{
    repo: string;
    tasksCompleted: number;
    prsMerged: number;
    linesChanged: number;
  }>;
}

interface TimeSaved {
  period: {
    days: number;
    range: string;
    startDate: string;
    endDate: string;
  };
  summary: {
    totalTasksAnalyzed: number;
    tasksWithComplexityData: number;
    tasksWithoutComplexityData: number;
    estimatedHoursSaved: number;
    estimatedHoursSavedMin: number;
    estimatedHoursSavedMax: number;
    avgHoursSavedPerTask: number;
    totalLinesChanged: number;
    totalCost: number;
    costPerHourSaved: number;
  };
  byComplexity: Array<{
    complexity: string;
    taskCount: number;
    hoursSaved: number;
    linesChanged: number;
    avgHoursPerTask: number;
  }>;
  byPersona: Array<{
    persona: string;
    taskCount: number;
    hoursSaved: number;
  }>;
  methodology: {
    description: string;
    complexityBenchmarks: Record<string, string>;
    codeVolumeBenchmark: string;
    calculation: string;
    limitations: string[];
  };
}

interface RoiMetrics {
  range: string;
  startDate: string;
  metrics: {
    totalTasks: number;
    successfulTasks: number;
    failedTasks: number;
    prsCreated: number;
    successRate: number;
    totalCost: number;
    avgCostPerTask: number;
    costPerPr: number;
    costPerSuccess: number;
    avgExecutionMinutes: number;
    estimatedDevHoursSaved: number;
    estimatedDevCostSaved: number;
    roi: number;
    netSavings: number;
    breakEvenRate: number;
    costPerDevHourEquivalent: number;
    roiPositive: boolean;
    roiCategory: "excellent" | "good" | "positive" | "negative";
    assumptions: {
      developerHourlyRate: number;
      estimatedHoursPerTask: number;
      isCustomRate: boolean;
    };
  };
}

interface PlannerCriticMetrics {
  summary: {
    totalPlans: number;
    avgCriticScore: number;
    avgIterations: number;
    firstAttemptApprovalRate: number;
    fileCapHitRate: number;
  };
  scoreDistribution: Array<{
    range: string;
    count: number;
    percentage: number;
  }>;
  iterationBreakdown: Array<{
    iterations: number;
    count: number;
    percentage: number;
  }>;
  recentPlans: Array<{
    taskId: string;
    summary: string;
    criticScore: number;
    iterations: number;
    storyCount: number;
    fileCapTruncations: number;
    planningDurationMs: number | null;
    createdAt: string;
  }>;
  commonRisks: Array<{
    risk: string;
    count: number;
  }>;
  trend: Array<{
    week: string;
    planCount: number;
    avgScore: number;
    avgIterations: number;
  }>;
}

export default function Analytics() {
  const tokens = useAuthStore((state) => state.tokens);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [taskStats, setTaskStats] = useState<TaskStats | null>(null);
  const [dailyUsage, setDailyUsage] = useState<DailyUsage[]>([]);
  const [prdMetrics, setPrdMetrics] = useState<PrdMetrics | null>(null);
  const [failureMetrics, setFailureMetrics] = useState<FailureMetrics | null>(null);
  const [effectivenessMetrics, setEffectivenessMetrics] = useState<EffectivenessMetrics | null>(null);
  const [reviewMetrics, setReviewMetrics] = useState<ReviewMetrics | null>(null);
  const [codeQualityMetrics, setCodeQualityMetrics] = useState<CodeQualityMetrics | null>(null);
  const [tokenUsageMetrics, setTokenUsageMetrics] = useState<TokenUsageMetrics | null>(null);
  const [businessOutcomes, setBusinessOutcomes] = useState<BusinessOutcomes | null>(null);
  const [timeSaved, setTimeSaved] = useState<TimeSaved | null>(null);
  const [roiMetrics, setRoiMetrics] = useState<RoiMetrics | null>(null);
  const [plannerCriticMetrics, setPlannerCriticMetrics] = useState<PlannerCriticMetrics | null>(null);
  const [hourlyRate, setHourlyRate] = useState<number>(75);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "90d">("30d");
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  useEffect(() => {
    fetchAnalytics();
  }, [tokens, timeRange]);

  // Refetch ROI when hourly rate changes
  useEffect(() => {
    if (!tokens?.accessToken) return;

    async function fetchRoi() {
      try {
        const roiRes = await fetch(`/api/analytics/roi?range=${timeRange}&hourlyRate=${hourlyRate}`, {
          headers: { Authorization: `Bearer ${tokens?.accessToken}` },
        });
        if (roiRes.ok) {
          const data = await roiRes.json();
          setRoiMetrics(data);
        }
      } catch (error) {
        console.error("Failed to fetch ROI metrics:", error);
      }
    }

    fetchRoi();
  }, [tokens, timeRange, hourlyRate]);

  async function fetchAnalytics() {
    setLoading(true);
    try {
      // Fetch billing status for task usage
      const usageRes = await fetch("/api/billing/status", {
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      if (usageRes.ok) {
        const data = await usageRes.json();
        // Map billing status data to UsageStats interface
        setUsage({
          plan: data.plan ?? "pro",
          tasks: {
            used: data.usage?.tasks ?? 0,
            quota: data.usage?.quota ?? 0,
            percent: data.usage?.percent ?? 0,
            isUnlimited: data.usage?.isUnlimited ?? false,
          },
          billingPeriod: {
            start: data.billing?.billingCycleStart ?? null,
            daysUntilReset: 0,
          },
        });
      }

      // Fetch task statistics
      const statsRes = await fetch(`/api/analytics/tasks?range=${timeRange}`, {
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      if (statsRes.ok) {
        const data = await statsRes.json();
        setTaskStats(data.stats);
        setDailyUsage(data.daily || []);
      }

      // Fetch Full Build workflow metrics
      const prdRes = await fetch(`/api/analytics/prd-metrics?range=${timeRange}`, {
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      if (prdRes.ok) {
        const data = await prdRes.json();
        setPrdMetrics(data);
      }

      // Fetch failure metrics
      const failureRes = await fetch(`/api/analytics/failures?range=${timeRange}`, {
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      if (failureRes.ok) {
        const data = await failureRes.json();
        setFailureMetrics(data);
      }

      // Fetch planner-critic metrics
      const plannerCriticRes = await fetch(`/api/analytics/planner-critic?range=${timeRange}`, {
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      if (plannerCriticRes.ok) {
        const data = await plannerCriticRes.json();
        setPlannerCriticMetrics(data);
      }

      // Fetch effectiveness metrics
      const effectivenessRes = await fetch(`/api/analytics/effectiveness?range=${timeRange}`, {
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      if (effectivenessRes.ok) {
        const data = await effectivenessRes.json();
        setEffectivenessMetrics(data);
      }

      // Fetch Virtual Manager review metrics
      const reviewMetricsRes = await fetch(`/api/analytics/review-metrics?range=${timeRange}`, {
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      if (reviewMetricsRes.ok) {
        const data = await reviewMetricsRes.json();
        setReviewMetrics(data);
      }

      // Fetch code quality metrics
      const codeQualityRes = await fetch(`/api/analytics/code-quality?range=${timeRange}`, {
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      if (codeQualityRes.ok) {
        const data = await codeQualityRes.json();
        setCodeQualityMetrics(data);
      }

      // Fetch token usage metrics (AI FinOps)
      const tokenUsageRes = await fetch(`/api/analytics/token-usage?range=${timeRange}`, {
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      if (tokenUsageRes.ok) {
        const data = await tokenUsageRes.json();
        setTokenUsageMetrics(data);
      }

      // Fetch business outcomes metrics (Executive Dashboard)
      const businessOutcomesRes = await fetch(`/api/analytics/business-outcomes?range=${timeRange}`, {
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      if (businessOutcomesRes.ok) {
        const data = await businessOutcomesRes.json();
        setBusinessOutcomes(data);
      }

      // Fetch time saved estimates
      const timeSavedRes = await fetch(`/api/analytics/time-saved?range=${timeRange}`, {
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      if (timeSavedRes.ok) {
        const data = await timeSavedRes.json();
        setTimeSaved(data);
      }

      // Fetch ROI metrics with current hourly rate
      const roiRes = await fetch(`/api/analytics/roi?range=${timeRange}&hourlyRate=${hourlyRate}`, {
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      if (roiRes.ok) {
        const data = await roiRes.json();
        setRoiMetrics(data);
      }
    } catch (error) {
      console.error("Failed to fetch analytics:", error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <AnalyticsSkeleton />;
  }

  return (
    <div className="max-w-6xl mx-auto p-6" data-testid="analytics-page">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-4">
          <Link
            to="/dashboard"
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Dashboard</span>
          </Link>
          <h1 className="text-2xl font-bold">Analytics</h1>
        </div>
        <div className="flex gap-2">
          {(["7d", "30d", "90d"] as const).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-3 py-1 text-sm rounded ${
                timeRange === range
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600"
              }`}
            >
              {range === "7d" ? "7 Days" : range === "30d" ? "30 Days" : "90 Days"}
            </button>
          ))}
        </div>
      </div>

      {/* Usage Overview */}
      {usage && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">Plan</p>
            <p className="text-2xl font-bold capitalize">{usage.plan}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Tasks Used
            </p>
            <p className="text-2xl font-bold">
              {usage.tasks.isUnlimited
                ? `${usage.tasks.used}`
                : `${usage.tasks.used} / ${usage.tasks.quota}`}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Usage
            </p>
            <p className="text-2xl font-bold">
              {usage.tasks.isUnlimited ? "Unlimited" : `${usage.tasks.percent}%`}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Days Until Reset
            </p>
            <p className="text-2xl font-bold">{usage.billingPeriod.daysUntilReset}</p>
          </div>
        </div>
      )}

      {/* Executive Dashboard - Business Outcome Metrics */}
      {(businessOutcomes || timeSaved) && (
        <div className="bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-800 rounded-lg shadow-lg p-6 mb-8 border border-indigo-100 dark:border-gray-700">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Executive Dashboard</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Business outcomes and ROI metrics for stakeholder reporting
              </p>
            </div>
            <div className="px-3 py-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs font-medium rounded-full">
              {timeRange === "7d" ? "Last 7 Days" : timeRange === "30d" ? "Last 30 Days" : "Last 90 Days"}
            </div>
          </div>

          {/* Key Business KPIs - Large format for executive visibility */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {businessOutcomes && (
              <>
                <div className="bg-white dark:bg-gray-700 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-600">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">PRs Merged</span>
                  </div>
                  <p className="text-3xl font-bold text-green-600 dark:text-green-400">{businessOutcomes.summary.prsMerged}</p>
                  <p className="text-xs text-gray-400 mt-1">Code shipped to production</p>
                </div>
                <div className="bg-white dark:bg-gray-700 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-600">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                    <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Issues Closed</span>
                  </div>
                  <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{businessOutcomes.summary.issuesClosed}</p>
                  <p className="text-xs text-gray-400 mt-1">Tickets resolved by AI</p>
                </div>
              </>
            )}
            {timeSaved && (
              <>
                <div className="bg-white dark:bg-gray-700 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-600">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                    <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Hours Saved</span>
                  </div>
                  <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">{timeSaved.summary.estimatedHoursSaved}</p>
                  <p className="text-xs text-gray-400 mt-1">Developer time freed up</p>
                </div>
                <div className="bg-white dark:bg-gray-700 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-600">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-2 h-2 bg-amber-500 rounded-full"></div>
                    <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Cost/Hour Saved</span>
                  </div>
                  <p className="text-3xl font-bold text-amber-600 dark:text-amber-400">${timeSaved.summary.costPerHourSaved}</p>
                  <p className="text-xs text-gray-400 mt-1">AI cost per dev hour</p>
                </div>
              </>
            )}
          </div>

          {/* Code Output Metrics */}
          {businessOutcomes && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-white/50 dark:bg-gray-700/50 rounded-lg p-4">
                <p className="text-sm text-gray-600 dark:text-gray-300 font-medium mb-2">Code Output</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold">{businessOutcomes.summary.totalLinesChanged.toLocaleString()}</span>
                  <span className="text-sm text-gray-500">lines changed</span>
                </div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-lg font-semibold text-gray-600 dark:text-gray-400">{businessOutcomes.summary.totalFilesModified}</span>
                  <span className="text-sm text-gray-500">files modified</span>
                </div>
              </div>
              <div className="bg-white/50 dark:bg-gray-700/50 rounded-lg p-4">
                <p className="text-sm text-gray-600 dark:text-gray-300 font-medium mb-2">Task Success</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold">{businessOutcomes.summary.successRate}%</span>
                  <span className="text-sm text-gray-500">success rate</span>
                </div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-lg font-semibold text-gray-600 dark:text-gray-400">{businessOutcomes.summary.successfulTasks}/{businessOutcomes.summary.totalTasks}</span>
                  <span className="text-sm text-gray-500">tasks completed</span>
                </div>
              </div>
              <div className="bg-white/50 dark:bg-gray-700/50 rounded-lg p-4">
                <p className="text-sm text-gray-600 dark:text-gray-300 font-medium mb-2">Cost Efficiency</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold">${businessOutcomes.summary.totalCost.toFixed(2)}</span>
                  <span className="text-sm text-gray-500">total spend</span>
                </div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-lg font-semibold text-gray-600 dark:text-gray-400">{businessOutcomes.summary.executionHours}h</span>
                  <span className="text-sm text-gray-500">compute time</span>
                </div>
              </div>
            </div>
          )}

          {/* Time Saved by Complexity Breakdown */}
          {timeSaved && timeSaved.byComplexity.length > 0 && (
            <div className="bg-white/50 dark:bg-gray-700/50 rounded-lg p-4 mb-6">
              <p className="text-sm text-gray-600 dark:text-gray-300 font-medium mb-3">Time Saved by Task Complexity</p>
              <div className="flex h-8 rounded-lg overflow-hidden">
                {timeSaved.byComplexity.map((item) => {
                  const totalHours = timeSaved.summary.estimatedHoursSaved;
                  const percentage = totalHours > 0 ? (item.hoursSaved / totalHours) * 100 : 0;
                  const colors: Record<string, string> = {
                    simple: "bg-green-400",
                    medium: "bg-blue-400",
                    complex: "bg-purple-400",
                    expert: "bg-red-400",
                    unknown: "bg-gray-400",
                  };
                  if (percentage < 3) return null;
                  return (
                    <div
                      key={item.complexity}
                      className={`${colors[item.complexity] || "bg-gray-400"} flex items-center justify-center text-white text-xs font-medium`}
                      style={{ width: `${percentage}%` }}
                      title={`${item.complexity}: ${item.hoursSaved}h saved (${item.taskCount} tasks)`}
                    >
                      {percentage > 15 && item.complexity.charAt(0).toUpperCase() + item.complexity.slice(1)}
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-4 mt-3 text-xs text-gray-500">
                {timeSaved.byComplexity.map((item) => (
                  <span key={item.complexity} className="flex items-center gap-1">
                    <span className={`w-2 h-2 rounded-full ${
                      item.complexity === "simple" ? "bg-green-400" :
                      item.complexity === "medium" ? "bg-blue-400" :
                      item.complexity === "complex" ? "bg-purple-400" :
                      item.complexity === "expert" ? "bg-red-400" : "bg-gray-400"
                    }`}></span>
                    <span className="capitalize">{item.complexity}</span>
                    <span className="text-gray-400">({item.hoursSaved}h)</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Value Trend Chart */}
          {businessOutcomes && businessOutcomes.trend.length > 1 && (
            <div className="bg-white/50 dark:bg-gray-700/50 rounded-lg p-4">
              <p className="text-sm text-gray-600 dark:text-gray-300 font-medium mb-3">Value Delivered Over Time</p>
              <div className="h-20 flex items-end gap-1">
                {businessOutcomes.trend.map((point, i) => {
                  const maxTasks = Math.max(...businessOutcomes.trend.map((t) => t.tasksCompleted), 1);
                  const height = (point.tasksCompleted / maxTasks) * 100;
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center">
                      <div
                        className="w-full bg-indigo-400 rounded-t hover:bg-indigo-500 transition-colors relative"
                        style={{ height: `${Math.max(height, 4)}%` }}
                        title={`${point.date}: ${point.tasksCompleted} tasks, ${point.prsMerged} PRs merged`}
                      >
                        {point.prsMerged > 0 && (
                          <div
                            className="absolute bottom-0 left-0 right-0 bg-green-500 rounded-t"
                            style={{ height: `${(point.prsMerged / point.tasksCompleted) * 100}%` }}
                          ></div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between mt-2 text-xs text-gray-500">
                <span>{businessOutcomes.trend[0]?.date}</span>
                <span className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 bg-indigo-400 rounded-full"></span>
                    Tasks
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                    PRs Merged
                  </span>
                </span>
                <span>{businessOutcomes.trend[businessOutcomes.trend.length - 1]?.date}</span>
              </div>
            </div>
          )}

          {/* Methodology Note */}
          {timeSaved && (
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-600">
              <details className="text-xs text-gray-500 dark:text-gray-400">
                <summary className="cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
                  Methodology & assumptions
                </summary>
                <div className="mt-2 pl-4 space-y-1">
                  <p>{timeSaved.methodology.description}</p>
                  <p className="font-medium mt-2">Complexity benchmarks:</p>
                  <ul className="list-disc list-inside">
                    {Object.entries(timeSaved.methodology.complexityBenchmarks).map(([level, desc]) => (
                      <li key={level}><span className="capitalize">{level}</span>: {desc}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-gray-400">{timeSaved.methodology.codeVolumeBenchmark}</p>
                </div>
              </details>
            </div>
          )}
        </div>
      )}

      {/* ROI Calculator */}
      {roiMetrics && roiMetrics.metrics.totalTasks > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">ROI Calculator</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Calculate your return on investment with your team's hourly rate
              </p>
            </div>
          </div>

          {/* Hourly Rate Input */}
          <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1">
                <label htmlFor="hourlyRate" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Developer Hourly Rate (USD)
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Enter your team's average developer hourly rate to see personalized ROI
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-lg font-medium text-gray-500">$</span>
                <input
                  id="hourlyRate"
                  type="number"
                  min="10"
                  max="500"
                  step="5"
                  value={hourlyRate}
                  onChange={(e) => setHourlyRate(Math.min(500, Math.max(10, parseInt(e.target.value) || 75)))}
                  className="w-24 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-lg font-bold text-center focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <span className="text-sm text-gray-500">/hour</span>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {[50, 75, 100, 125, 150, 200].map((rate) => (
                <button
                  key={rate}
                  onClick={() => setHourlyRate(rate)}
                  className={`px-3 py-1 text-sm rounded-full transition-colors ${
                    hourlyRate === rate
                      ? "bg-blue-600 text-white"
                      : "bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500"
                  }`}
                >
                  ${rate}
                </button>
              ))}
            </div>
          </div>

          {/* ROI Results */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className={`text-center p-4 rounded-lg ${
              roiMetrics.metrics.roiPositive
                ? "bg-green-50 dark:bg-green-900/30"
                : "bg-red-50 dark:bg-red-900/30"
            }`}>
              <p className={`text-3xl font-bold ${
                roiMetrics.metrics.roiPositive ? "text-green-600" : "text-red-600"
              }`}>
                {roiMetrics.metrics.roi > 0 ? "+" : ""}{roiMetrics.metrics.roi}%
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Return on Investment</p>
              <p className={`text-xs mt-1 font-medium ${
                roiMetrics.metrics.roiCategory === "excellent" ? "text-green-600" :
                roiMetrics.metrics.roiCategory === "good" ? "text-blue-600" :
                roiMetrics.metrics.roiCategory === "positive" ? "text-green-500" : "text-red-500"
              }`}>
                {roiMetrics.metrics.roiCategory.charAt(0).toUpperCase() + roiMetrics.metrics.roiCategory.slice(1)}
              </p>
            </div>
            <div className={`text-center p-4 rounded-lg ${
              roiMetrics.metrics.netSavings >= 0
                ? "bg-blue-50 dark:bg-blue-900/30"
                : "bg-orange-50 dark:bg-orange-900/30"
            }`}>
              <p className={`text-3xl font-bold ${
                roiMetrics.metrics.netSavings >= 0 ? "text-blue-600" : "text-orange-600"
              }`}>
                ${Math.abs(roiMetrics.metrics.netSavings).toLocaleString()}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {roiMetrics.metrics.netSavings >= 0 ? "Net Savings" : "Net Cost"}
              </p>
            </div>
            <div className="text-center p-4 bg-purple-50 dark:bg-purple-900/30 rounded-lg">
              <p className="text-3xl font-bold text-purple-600">
                ${roiMetrics.metrics.estimatedDevCostSaved.toLocaleString()}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Dev Cost Equivalent</p>
              <p className="text-xs text-gray-400 mt-1">
                {roiMetrics.metrics.estimatedDevHoursSaved}h × ${hourlyRate}
              </p>
            </div>
            <div className="text-center p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <p className="text-3xl font-bold text-gray-700 dark:text-gray-300">
                ${roiMetrics.metrics.totalCost.toLocaleString()}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">AI Worker Cost</p>
            </div>
          </div>

          {/* Break-even Analysis */}
          <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Break-even Analysis</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Break-even hourly rate</p>
                <p className="text-xl font-bold">
                  ${roiMetrics.metrics.breakEvenRate}
                  <span className="text-sm font-normal text-gray-500 ml-2">/hour</span>
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {roiMetrics.metrics.breakEvenRate < hourlyRate
                    ? `Your rate ($${hourlyRate}) exceeds break-even — you're saving money!`
                    : `Set rate above $${roiMetrics.metrics.breakEvenRate} to see positive ROI`
                  }
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Cost per developer hour equivalent</p>
                <p className="text-xl font-bold">
                  ${roiMetrics.metrics.costPerDevHourEquivalent}
                  <span className="text-sm font-normal text-gray-500 ml-2">/hour</span>
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  AI workers cost ${roiMetrics.metrics.costPerDevHourEquivalent} to do 1 hour of dev work
                </p>
              </div>
            </div>
          </div>

          {/* ROI Visualization Bar */}
          <div className="mt-6">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-gray-600 dark:text-gray-400">AI Cost</span>
              <span className="text-gray-600 dark:text-gray-400">Dev Cost Equivalent</span>
            </div>
            <div className="relative h-8 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              {roiMetrics.metrics.estimatedDevCostSaved > 0 && (
                <>
                  <div
                    className="absolute left-0 top-0 h-full bg-red-400 flex items-center justify-center text-white text-xs font-medium"
                    style={{
                      width: `${Math.min((roiMetrics.metrics.totalCost / roiMetrics.metrics.estimatedDevCostSaved) * 100, 100)}%`,
                    }}
                  >
                    ${roiMetrics.metrics.totalCost}
                  </div>
                  <div
                    className="absolute right-0 top-0 h-full bg-green-400 flex items-center justify-center text-white text-xs font-medium"
                    style={{
                      width: `${Math.max(100 - (roiMetrics.metrics.totalCost / roiMetrics.metrics.estimatedDevCostSaved) * 100, 0)}%`,
                    }}
                  >
                    {roiMetrics.metrics.netSavings > 0 && `+$${roiMetrics.metrics.netSavings} saved`}
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center justify-between text-xs text-gray-500 mt-1">
              <span>$0</span>
              <span>${roiMetrics.metrics.estimatedDevCostSaved.toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}

      {/* Token Usage Analytics (AI FinOps) */}
      {tokenUsageMetrics && tokenUsageMetrics.summary.taskCount > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">Token Usage Analytics</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            AI FinOps: Phase-level token tracking for cost optimization
          </p>

          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/30 rounded">
              <p className="text-2xl font-bold text-blue-600">
                {(tokenUsageMetrics.summary.totalTokens / 1000000).toFixed(2)}M
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Tokens</p>
            </div>
            <div className="text-center p-3 bg-green-50 dark:bg-green-900/30 rounded">
              <p className="text-2xl font-bold text-green-600">
                ${tokenUsageMetrics.summary.totalCost.toFixed(2)}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Cost</p>
            </div>
            <div className="text-center p-3 bg-purple-50 dark:bg-purple-900/30 rounded">
              <p className="text-2xl font-bold text-purple-600">
                {tokenUsageMetrics.summary.cacheEfficiency}%
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Cache Efficiency</p>
            </div>
            <div className="text-center p-3 bg-cyan-50 dark:bg-cyan-900/30 rounded">
              <p className="text-2xl font-bold text-cyan-600">
                {(tokenUsageMetrics.summary.avgTokensPerTask / 1000).toFixed(0)}K
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Avg Tokens/Task</p>
            </div>
            <div className="text-center p-3 bg-gray-50 dark:bg-gray-700 rounded">
              <p className="text-2xl font-bold">
                ${tokenUsageMetrics.summary.avgCostPerTask.toFixed(2)}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Avg Cost/Task</p>
            </div>
          </div>

          {/* Token Distribution by Phase */}
          {tokenUsageMetrics.byPhase.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Usage by Phase</h3>
              <div className="flex h-6 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700">
                {(() => {
                  const phaseColors: Record<string, string> = {
                    planning: "bg-blue-500",
                    execution: "bg-green-500",
                    review: "bg-purple-500",
                    deployment: "bg-cyan-500",
                    improvement: "bg-orange-500",
                  };
                  const totalTokens = tokenUsageMetrics.byPhase.reduce((sum, p) => sum + p.inputTokens + p.outputTokens, 0);
                  return tokenUsageMetrics.byPhase.map((phase) => {
                    const tokens = phase.inputTokens + phase.outputTokens;
                    const pct = totalTokens > 0 ? (tokens / totalTokens) * 100 : 0;
                    if (pct < 1) return null;
                    return (
                      <div
                        key={phase.phase}
                        className={`${phaseColors[phase.phase] || "bg-gray-400"} flex items-center justify-center`}
                        style={{ width: `${pct}%` }}
                        title={`${phase.phase}: ${(tokens / 1000).toFixed(0)}K tokens ($${phase.cost.toFixed(2)})`}
                      >
                        {pct > 10 && (
                          <span className="text-xs text-white font-medium capitalize">
                            {phase.phase}
                          </span>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
              <div className="flex flex-wrap justify-between mt-2 text-xs text-gray-500 dark:text-gray-400 gap-2">
                {tokenUsageMetrics.byPhase.map((phase) => (
                  <span key={phase.phase} className="flex items-center gap-1">
                    <span className={`w-2 h-2 rounded-full ${
                      phase.phase === "planning" ? "bg-blue-500" :
                      phase.phase === "execution" ? "bg-green-500" :
                      phase.phase === "review" ? "bg-purple-500" :
                      phase.phase === "deployment" ? "bg-cyan-500" :
                      "bg-orange-500"
                    }`}></span>
                    <span className="capitalize">{phase.phase}</span>
                    <span className="text-gray-400">(${phase.cost.toFixed(2)})</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Cost by Persona & Model */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {tokenUsageMetrics.byPersona.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Cost by Persona</h3>
                <div className="space-y-2">
                  {tokenUsageMetrics.byPersona.slice(0, 5).map((p) => {
                    const maxCost = Math.max(...tokenUsageMetrics.byPersona.map((x) => x.cost));
                    return (
                      <div key={p.persona} className="flex items-center gap-3">
                        <div className="w-28 text-sm text-gray-600 dark:text-gray-400 truncate">
                          {p.persona.replace(/_/g, " ")}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                              <div
                                className="bg-blue-500 h-2 rounded-full"
                                style={{ width: `${(p.cost / maxCost) * 100}%` }}
                              ></div>
                            </div>
                            <span className="text-sm font-medium w-16 text-right">${p.cost.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {tokenUsageMetrics.byModel.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Cost by Model</h3>
                <div className="space-y-2">
                  {tokenUsageMetrics.byModel.slice(0, 5).map((m) => {
                    const maxCost = Math.max(...tokenUsageMetrics.byModel.map((x) => x.cost));
                    return (
                      <div key={m.model} className="flex items-center gap-3">
                        <div className="w-28 text-sm text-gray-600 dark:text-gray-400 truncate">
                          {m.model.replace("claude-", "").replace(/-20\d{6}$/, "")}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                              <div
                                className="bg-green-500 h-2 rounded-full"
                                style={{ width: `${(m.cost / maxCost) * 100}%` }}
                              ></div>
                            </div>
                            <span className="text-sm font-medium w-16 text-right">${m.cost.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Token Usage Trend */}
          {tokenUsageMetrics.trends.length > 1 && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mb-6">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Cost Trend</h3>
              <div className="h-24 flex items-end gap-1">
                {(() => {
                  const maxCost = Math.max(...tokenUsageMetrics.trends.map((t) => t.cost));
                  return tokenUsageMetrics.trends.map((point, i) => {
                    const height = maxCost > 0 ? (point.cost / maxCost) * 100 : 0;
                    return (
                      <div
                        key={i}
                        className="flex-1 bg-blue-400 rounded-t hover:bg-blue-500 transition-colors"
                        style={{ height: `${Math.max(height, 2)}%` }}
                        title={`${point.date}: $${point.cost.toFixed(2)} (${point.tasks} tasks)`}
                      ></div>
                    );
                  });
                })()}
              </div>
              <div className="flex justify-between mt-1 text-xs text-gray-500 dark:text-gray-400">
                <span>{tokenUsageMetrics.trends[0]?.date}</span>
                <span>{tokenUsageMetrics.trends[tokenUsageMetrics.trends.length - 1]?.date}</span>
              </div>
            </div>
          )}

          {/* Operation Type Breakdown */}
          {tokenUsageMetrics.byOperationType.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Cost by Operation Type</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {tokenUsageMetrics.byOperationType.map((op) => (
                  <div key={op.operationType} className="text-center p-2 bg-gray-50 dark:bg-gray-700 rounded">
                    <p className="text-sm font-medium">${op.cost.toFixed(2)}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                      {op.operationType.replace(/_/g, " ")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Data Coverage Note */}
          <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
            {tokenUsageMetrics.summary.taskCount} tasks tracked in this period
          </div>
        </div>
      )}

      {/* Worker Effectiveness - Automatic metrics from task states */}
      {effectivenessMetrics && effectivenessMetrics.summary.total > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">Worker Effectiveness</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            Automatically calculated from task outcomes - no manual input required
          </p>

          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <div className="text-center p-3 bg-green-50 dark:bg-green-900/30 rounded">
              <p className="text-2xl font-bold text-green-600">
                {effectivenessMetrics.summary.successRate}%
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Success Rate</p>
            </div>
            <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/30 rounded">
              <p className="text-2xl font-bold text-blue-600">
                {effectivenessMetrics.summary.deploymentRate}%
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Deployment Rate</p>
            </div>
            <div className="text-center p-3 bg-purple-50 dark:bg-purple-900/30 rounded">
              <p className="text-2xl font-bold text-purple-600">
                {effectivenessMetrics.summary.firstAttemptRate}%
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">First Attempt</p>
            </div>
            <div className="text-center p-3 bg-cyan-50 dark:bg-cyan-900/30 rounded">
              <p className="text-2xl font-bold text-cyan-600">
                {effectivenessMetrics.summary.prAcceptanceRate}%
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">PR Acceptance</p>
            </div>
            <div className="text-center p-3 bg-gray-50 dark:bg-gray-700 rounded">
              <p className="text-2xl font-bold">{effectivenessMetrics.summary.total}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Tasks</p>
            </div>
          </div>

          {/* Outcome Breakdown */}
          <div className="mb-6">
            <div className="flex h-4 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700">
              <div
                className="bg-blue-500"
                style={{
                  width: `${(effectivenessMetrics.summary.deployed / effectivenessMetrics.summary.total) * 100}%`,
                }}
                title={`Deployed: ${effectivenessMetrics.summary.deployed}`}
              ></div>
              <div
                className="bg-green-500"
                style={{
                  width: `${((effectivenessMetrics.summary.successful - effectivenessMetrics.summary.deployed) / effectivenessMetrics.summary.total) * 100}%`,
                }}
                title={`Completed: ${effectivenessMetrics.summary.successful - effectivenessMetrics.summary.deployed}`}
              ></div>
              <div
                className="bg-red-500"
                style={{
                  width: `${(effectivenessMetrics.summary.failed / effectivenessMetrics.summary.total) * 100}%`,
                }}
                title={`Failed: ${effectivenessMetrics.summary.failed}`}
              ></div>
              <div
                className="bg-yellow-500"
                style={{
                  width: `${(effectivenessMetrics.summary.escalated / effectivenessMetrics.summary.total) * 100}%`,
                }}
                title={`Escalated: ${effectivenessMetrics.summary.escalated}`}
              ></div>
              <div
                className="bg-orange-500"
                style={{
                  width: `${(effectivenessMetrics.summary.reviewRejected / effectivenessMetrics.summary.total) * 100}%`,
                }}
                title={`PR Rejected: ${effectivenessMetrics.summary.reviewRejected}`}
              ></div>
              <div
                className="bg-gray-400"
                style={{
                  width: `${(effectivenessMetrics.summary.cancelled / effectivenessMetrics.summary.total) * 100}%`,
                }}
                title={`Cancelled: ${effectivenessMetrics.summary.cancelled}`}
              ></div>
            </div>
            <div className="flex flex-wrap justify-between mt-2 text-xs text-gray-500 dark:text-gray-400 gap-2">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                Deployed ({effectivenessMetrics.summary.deployed})
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                Completed ({effectivenessMetrics.summary.successful - effectivenessMetrics.summary.deployed})
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                Failed ({effectivenessMetrics.summary.failed})
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-yellow-500 rounded-full"></span>
                Escalated ({effectivenessMetrics.summary.escalated})
              </span>
              {effectivenessMetrics.summary.reviewRejected > 0 && (
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-orange-500 rounded-full"></span>
                  PR Rejected ({effectivenessMetrics.summary.reviewRejected})
                </span>
              )}
            </div>
          </div>

          {/* Model Performance Comparison */}
          {effectivenessMetrics.byModel.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Model Performance</h3>
              <div className="space-y-3">
                {effectivenessMetrics.byModel.map((m) => (
                  <div key={m.model} className="flex items-center gap-4">
                    <div className="w-36 text-sm text-gray-600 dark:text-gray-400 truncate">
                      {m.model.replace("claude-", "").replace(/-20\d{6}$/, "")}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                          <div
                            className="bg-green-500 h-2 rounded-full"
                            style={{ width: `${m.successRate}%` }}
                          ></div>
                        </div>
                        <span className="text-sm font-medium w-12 text-right">
                          {m.successRate}%
                        </span>
                      </div>
                    </div>
                    <div className="w-24 text-xs text-gray-500 text-right">
                      {m.firstAttemptRate}% 1st try
                    </div>
                    <div className="w-16 text-sm text-gray-400 text-right">
                      n={m.total}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PR Stats */}
          {effectivenessMetrics.prStats.total > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Pull Request Outcomes</h3>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex justify-between text-sm mb-1">
                    <span>Accepted: {effectivenessMetrics.prStats.accepted}</span>
                    <span>Rejected: {effectivenessMetrics.prStats.rejected}</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-green-500 h-2 rounded-full"
                      style={{ width: `${effectivenessMetrics.prStats.acceptanceRate}%` }}
                    ></div>
                  </div>
                </div>
                <span className="text-sm font-medium">
                  {effectivenessMetrics.prStats.acceptanceRate}% accepted
                </span>
              </div>
            </div>
          )}

          {/* Success Rate Trend */}
          {effectivenessMetrics.trend.length > 1 && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Success Rate Trend</h3>
              <div className="h-24 flex items-end gap-1">
                {effectivenessMetrics.trend.map((point, i) => {
                  const height = point.successRate;
                  return (
                    <div
                      key={i}
                      className="flex-1 bg-green-400 rounded-t hover:bg-green-500 transition-colors"
                      style={{ height: `${Math.max(height, 4)}%` }}
                      title={`${point.date}: ${point.successRate}% success (${point.success}/${point.total})`}
                    ></div>
                  );
                })}
              </div>
              <div className="flex justify-between mt-1 text-xs text-gray-500 dark:text-gray-400">
                <span>{effectivenessMetrics.trend[0]?.date}</span>
                <span>{effectivenessMetrics.trend[effectivenessMetrics.trend.length - 1]?.date}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tech Lead Review Metrics */}
      {reviewMetrics && reviewMetrics.summary.reviewedTasks > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8 border-l-4 border-emerald-500">
          <h2 className="text-lg font-semibold mb-1">Tech Lead Review Metrics</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            AI code review value metrics - tasks with the <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">review</code> label enabled
          </p>

          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="text-center p-3 bg-emerald-50 dark:bg-emerald-900/30 rounded">
              <p className="text-2xl font-bold text-emerald-600">
                {reviewMetrics.summary.adoptionRate}%
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Review Adoption</p>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {reviewMetrics.summary.reviewedTasks}/{reviewMetrics.summary.totalTasks} tasks
              </p>
            </div>
            <div className="text-center p-3 bg-green-50 dark:bg-green-900/30 rounded">
              <p className="text-2xl font-bold text-green-600">
                {reviewMetrics.summary.firstPassApprovalRate}%
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">First-Pass Approval</p>
              <p className="text-xs text-gray-400 dark:text-gray-500">Approved without revisions</p>
            </div>
            <div className="text-center p-3 bg-amber-50 dark:bg-amber-900/30 rounded">
              <p className="text-2xl font-bold text-amber-600">
                {reviewMetrics.summary.avgRevisionsPerTask}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Avg Revisions</p>
              <p className="text-xs text-gray-400 dark:text-gray-500">Per reviewed task</p>
            </div>
            <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/30 rounded">
              <p className="text-2xl font-bold text-blue-600">
                {reviewMetrics.qualityImpact.reviewedAvgAccuracy !== null &&
                 reviewMetrics.qualityImpact.nonReviewedAvgAccuracy !== null
                  ? `+${Math.max(0, reviewMetrics.qualityImpact.reviewedAvgAccuracy - reviewMetrics.qualityImpact.nonReviewedAvgAccuracy)}`
                  : "—"}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Quality Gain</p>
              <p className="text-xs text-gray-400 dark:text-gray-500">Accuracy vs non-reviewed</p>
            </div>
          </div>

          {/* Revision Distribution */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Revision Distribution</h3>
            <div className="flex h-6 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700">
              {(() => {
                const total = reviewMetrics.revisionDistribution.zero +
                  reviewMetrics.revisionDistribution.one +
                  reviewMetrics.revisionDistribution.two +
                  reviewMetrics.revisionDistribution.threeOrMore;
                if (total === 0) return null;
                return (
                  <>
                    <div
                      className="bg-green-500"
                      style={{ width: `${(reviewMetrics.revisionDistribution.zero / total) * 100}%` }}
                      title={`0 revisions: ${reviewMetrics.revisionDistribution.zero}`}
                    ></div>
                    <div
                      className="bg-yellow-500"
                      style={{ width: `${(reviewMetrics.revisionDistribution.one / total) * 100}%` }}
                      title={`1 revision: ${reviewMetrics.revisionDistribution.one}`}
                    ></div>
                    <div
                      className="bg-orange-500"
                      style={{ width: `${(reviewMetrics.revisionDistribution.two / total) * 100}%` }}
                      title={`2 revisions: ${reviewMetrics.revisionDistribution.two}`}
                    ></div>
                    <div
                      className="bg-red-500"
                      style={{ width: `${(reviewMetrics.revisionDistribution.threeOrMore / total) * 100}%` }}
                      title={`3+ revisions: ${reviewMetrics.revisionDistribution.threeOrMore}`}
                    ></div>
                  </>
                );
              })()}
            </div>
            <div className="flex flex-wrap justify-between mt-2 text-xs text-gray-500 dark:text-gray-400 gap-2">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                0 revisions ({reviewMetrics.revisionDistribution.zero})
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-yellow-500 rounded-full"></span>
                1 revision ({reviewMetrics.revisionDistribution.one})
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-orange-500 rounded-full"></span>
                2 revisions ({reviewMetrics.revisionDistribution.two})
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                3+ revisions ({reviewMetrics.revisionDistribution.threeOrMore})
              </span>
            </div>
          </div>

          {/* Decision Breakdown & Quality Impact */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {/* Decision Breakdown */}
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Review Decisions</h3>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-24 text-sm text-gray-600 dark:text-gray-400">Approved</div>
                  <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                    <div
                      className="bg-green-500 h-3 rounded-full"
                      style={{
                        width: `${
                          reviewMetrics.summary.reviewedTasks > 0
                            ? (reviewMetrics.decisions.approved / reviewMetrics.summary.reviewedTasks) * 100
                            : 0
                        }%`,
                      }}
                    ></div>
                  </div>
                  <span className="w-12 text-sm text-right">{reviewMetrics.decisions.approved}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-24 text-sm text-gray-600 dark:text-gray-400">Revised</div>
                  <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                    <div
                      className="bg-yellow-500 h-3 rounded-full"
                      style={{
                        width: `${
                          reviewMetrics.summary.reviewedTasks > 0
                            ? (reviewMetrics.decisions.revisionNeeded / reviewMetrics.summary.reviewedTasks) * 100
                            : 0
                        }%`,
                      }}
                    ></div>
                  </div>
                  <span className="w-12 text-sm text-right">{reviewMetrics.decisions.revisionNeeded}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-24 text-sm text-gray-600 dark:text-gray-400">Rejected</div>
                  <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                    <div
                      className="bg-red-500 h-3 rounded-full"
                      style={{
                        width: `${
                          reviewMetrics.summary.reviewedTasks > 0
                            ? (reviewMetrics.decisions.rejected / reviewMetrics.summary.reviewedTasks) * 100
                            : 0
                        }%`,
                      }}
                    ></div>
                  </div>
                  <span className="w-12 text-sm text-right">{reviewMetrics.decisions.rejected}</span>
                </div>
                {reviewMetrics.decisions.escalated > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="w-24 text-sm text-gray-600 dark:text-gray-400">Escalated</div>
                    <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                      <div
                        className="bg-purple-500 h-3 rounded-full"
                        style={{
                          width: `${
                            reviewMetrics.summary.reviewedTasks > 0
                              ? (reviewMetrics.decisions.escalated / reviewMetrics.summary.reviewedTasks) * 100
                              : 0
                          }%`,
                        }}
                      ></div>
                    </div>
                    <span className="w-12 text-sm text-right">{reviewMetrics.decisions.escalated}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Quality Impact Comparison */}
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Quality Impact</h3>
              {(reviewMetrics.qualityImpact.reviewedAvgAccuracy !== null ||
                reviewMetrics.qualityImpact.nonReviewedAvgAccuracy !== null) ? (
                <div className="space-y-3">
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded border border-emerald-200 dark:border-emerald-800">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                        With Review
                      </span>
                      <span className="text-lg font-bold text-emerald-600">
                        {reviewMetrics.qualityImpact.reviewedAvgAccuracy ?? "—"}%
                      </span>
                    </div>
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">
                      Avg accuracy score
                    </p>
                  </div>
                  <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Without Review
                      </span>
                      <span className="text-lg font-bold text-gray-600 dark:text-gray-400">
                        {reviewMetrics.qualityImpact.nonReviewedAvgAccuracy ?? "—"}%
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Avg accuracy score
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                  No accuracy data available yet. Review tasks to see quality impact.
                </p>
              )}
            </div>
          </div>

          {/* Efficiency Comparison */}
          {(reviewMetrics.efficiency.reviewedAvgDurationMinutes !== null ||
            reviewMetrics.efficiency.reviewedAvgCost !== null) && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mb-6">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Time & Cost Analysis</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-2 bg-gray-50 dark:bg-gray-700 rounded">
                  <p className="text-sm font-medium">
                    {reviewMetrics.efficiency.reviewedAvgDurationMinutes !== null
                      ? `${reviewMetrics.efficiency.reviewedAvgDurationMinutes}m`
                      : "—"}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Reviewed Avg Time</p>
                </div>
                <div className="text-center p-2 bg-gray-50 dark:bg-gray-700 rounded">
                  <p className="text-sm font-medium">
                    {reviewMetrics.efficiency.nonReviewedAvgDurationMinutes !== null
                      ? `${reviewMetrics.efficiency.nonReviewedAvgDurationMinutes}m`
                      : "—"}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Non-Reviewed Avg Time</p>
                </div>
                <div className="text-center p-2 bg-gray-50 dark:bg-gray-700 rounded">
                  <p className="text-sm font-medium">
                    {reviewMetrics.efficiency.reviewedAvgCost !== null
                      ? `$${reviewMetrics.efficiency.reviewedAvgCost.toFixed(2)}`
                      : "—"}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Reviewed Avg Cost</p>
                </div>
                <div className="text-center p-2 bg-gray-50 dark:bg-gray-700 rounded">
                  <p className="text-sm font-medium">
                    {reviewMetrics.efficiency.nonReviewedAvgCost !== null
                      ? `$${reviewMetrics.efficiency.nonReviewedAvgCost.toFixed(2)}`
                      : "—"}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Non-Reviewed Avg Cost</p>
                </div>
              </div>
            </div>
          )}

          {/* Model Performance for Reviews */}
          {reviewMetrics.byModel.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mb-6">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Review Performance by Model</h3>
              <div className="space-y-3">
                {reviewMetrics.byModel.slice(0, 5).map((m) => (
                  <div key={m.model} className="flex items-center gap-4">
                    <div className="w-36 text-sm text-gray-600 dark:text-gray-400 truncate">
                      {m.model.replace("claude-", "").replace(/-20\d{6}$/, "")}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                          <div
                            className="bg-emerald-500 h-2 rounded-full"
                            style={{ width: `${m.approvalRate}%` }}
                          ></div>
                        </div>
                        <span className="text-sm font-medium w-12 text-right">
                          {m.approvalRate}%
                        </span>
                      </div>
                    </div>
                    <div className="w-20 text-xs text-gray-500 text-right">
                      {m.avgRevisions} revisions
                    </div>
                    <div className="w-14 text-sm text-gray-400 text-right">
                      n={m.reviewedCount}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* First-Pass Approval Trend */}
          {reviewMetrics.trend.length > 1 && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">First-Pass Approval Trend</h3>
              <div className="h-24 flex items-end gap-1">
                {reviewMetrics.trend.map((point, i) => {
                  const rate = point.reviewedCount > 0
                    ? Math.round((point.approvedFirstPass / point.reviewedCount) * 100)
                    : 0;
                  return (
                    <div
                      key={i}
                      className="flex-1 bg-emerald-400 rounded-t hover:bg-emerald-500 transition-colors"
                      style={{ height: `${Math.max(rate, 4)}%` }}
                      title={`${point.date}: ${rate}% first-pass (${point.approvedFirstPass}/${point.reviewedCount})`}
                    ></div>
                  );
                })}
              </div>
              <div className="flex justify-between mt-1 text-xs text-gray-500 dark:text-gray-400">
                <span>{reviewMetrics.trend[0]?.date}</span>
                <span>{reviewMetrics.trend[reviewMetrics.trend.length - 1]?.date}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Task Statistics */}
      {taskStats && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">Task Statistics</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="text-center">
              <p className="text-3xl font-bold">{taskStats.total}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-green-600">
                {taskStats.completed}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Completed
              </p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-blue-600">
                {taskStats.deployed}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Deployed
              </p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-red-600">
                {taskStats.failed}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Failed</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-yellow-600">
                {taskStats.inProgress}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                In Progress
              </p>
            </div>
          </div>

          {taskStats.total > 0 && (
            <div className="mt-6">
              <div className="flex h-4 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700">
                <div
                  className="bg-green-500"
                  style={{
                    width: `${(taskStats.completed / taskStats.total) * 100}%`,
                  }}
                ></div>
                <div
                  className="bg-blue-500"
                  style={{
                    width: `${(taskStats.deployed / taskStats.total) * 100}%`,
                  }}
                ></div>
                <div
                  className="bg-red-500"
                  style={{
                    width: `${(taskStats.failed / taskStats.total) * 100}%`,
                  }}
                ></div>
                <div
                  className="bg-yellow-500"
                  style={{
                    width: `${(taskStats.inProgress / taskStats.total) * 100}%`,
                  }}
                ></div>
              </div>
              <div className="flex justify-between mt-2 text-xs text-gray-500 dark:text-gray-400">
                <span>Completed</span>
                <span>Deployed</span>
                <span>Failed</span>
                <span>In Progress</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Code Quality Metrics */}
      {codeQualityMetrics && codeQualityMetrics.summary.tasksWithMetrics > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Code Quality Metrics</h2>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  window.open(`/api/analytics/quality-export?range=${timeRange}&format=csv`, "_blank");
                }}
                className="text-xs px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Export CSV
              </button>
              <button
                onClick={() => {
                  window.open(`/api/analytics/quality-export?range=${timeRange}&format=json`, "_blank");
                }}
                className="text-xs px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Export JSON
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            Automated quality analysis from lint, typecheck, tests, coverage, and security scans
          </p>

          {/* Quality Score Cards */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
            <div className="text-center p-3 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 rounded-lg">
              <p className="text-3xl font-bold text-blue-600">{codeQualityMetrics.summary.averageQualityScore}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Overall Score</p>
            </div>
            <div className="text-center p-3 bg-yellow-50 dark:bg-yellow-900/30 rounded">
              <p className="text-2xl font-bold text-yellow-600">{codeQualityMetrics.summary.averageLintScore}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Lint</p>
            </div>
            <div className="text-center p-3 bg-purple-50 dark:bg-purple-900/30 rounded">
              <p className="text-2xl font-bold text-purple-600">{codeQualityMetrics.summary.averageTypecheckScore}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Typecheck</p>
            </div>
            <div className="text-center p-3 bg-green-50 dark:bg-green-900/30 rounded">
              <p className="text-2xl font-bold text-green-600">{codeQualityMetrics.summary.averageTestScore}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Tests</p>
            </div>
            <div className="text-center p-3 bg-cyan-50 dark:bg-cyan-900/30 rounded">
              <p className="text-2xl font-bold text-cyan-600">{codeQualityMetrics.summary.averageCoverageScore}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Coverage</p>
            </div>
            <div className="text-center p-3 bg-red-50 dark:bg-red-900/30 rounded">
              <p className="text-2xl font-bold text-red-600">{codeQualityMetrics.summary.averageSecurityScore}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Security</p>
            </div>
          </div>

          {/* Score Distribution */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Score Distribution</h3>
            <div className="flex h-6 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700">
              {codeQualityMetrics.scoreDistribution.excellent > 0 && (
                <div
                  className="bg-green-500 flex items-center justify-center"
                  style={{
                    width: `${(codeQualityMetrics.scoreDistribution.excellent / codeQualityMetrics.summary.tasksWithMetrics) * 100}%`,
                  }}
                  title={`Excellent (90-100): ${codeQualityMetrics.scoreDistribution.excellent}`}
                >
                  <span className="text-xs text-white font-medium">
                    {codeQualityMetrics.scoreDistribution.excellent > 2 && codeQualityMetrics.scoreDistribution.excellent}
                  </span>
                </div>
              )}
              {codeQualityMetrics.scoreDistribution.good > 0 && (
                <div
                  className="bg-blue-500 flex items-center justify-center"
                  style={{
                    width: `${(codeQualityMetrics.scoreDistribution.good / codeQualityMetrics.summary.tasksWithMetrics) * 100}%`,
                  }}
                  title={`Good (70-89): ${codeQualityMetrics.scoreDistribution.good}`}
                >
                  <span className="text-xs text-white font-medium">
                    {codeQualityMetrics.scoreDistribution.good > 2 && codeQualityMetrics.scoreDistribution.good}
                  </span>
                </div>
              )}
              {codeQualityMetrics.scoreDistribution.fair > 0 && (
                <div
                  className="bg-yellow-500 flex items-center justify-center"
                  style={{
                    width: `${(codeQualityMetrics.scoreDistribution.fair / codeQualityMetrics.summary.tasksWithMetrics) * 100}%`,
                  }}
                  title={`Fair (50-69): ${codeQualityMetrics.scoreDistribution.fair}`}
                >
                  <span className="text-xs text-white font-medium">
                    {codeQualityMetrics.scoreDistribution.fair > 2 && codeQualityMetrics.scoreDistribution.fair}
                  </span>
                </div>
              )}
              {codeQualityMetrics.scoreDistribution.poor > 0 && (
                <div
                  className="bg-red-500 flex items-center justify-center"
                  style={{
                    width: `${(codeQualityMetrics.scoreDistribution.poor / codeQualityMetrics.summary.tasksWithMetrics) * 100}%`,
                  }}
                  title={`Poor (<50): ${codeQualityMetrics.scoreDistribution.poor}`}
                >
                  <span className="text-xs text-white font-medium">
                    {codeQualityMetrics.scoreDistribution.poor > 2 && codeQualityMetrics.scoreDistribution.poor}
                  </span>
                </div>
              )}
            </div>
            <div className="flex flex-wrap justify-between mt-2 text-xs text-gray-500 dark:text-gray-400 gap-2">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                Excellent ({codeQualityMetrics.scoreDistribution.excellent})
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                Good ({codeQualityMetrics.scoreDistribution.good})
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-yellow-500 rounded-full"></span>
                Fair ({codeQualityMetrics.scoreDistribution.fair})
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                Poor ({codeQualityMetrics.scoreDistribution.poor})
              </span>
            </div>
          </div>

          {/* Quality by Persona & Model */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {codeQualityMetrics.byPersona.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Quality by Persona</h3>
                <div className="space-y-2">
                  {codeQualityMetrics.byPersona.slice(0, 5).map((p) => (
                    <div key={p.persona} className="flex items-center gap-3">
                      <div className="w-28 text-sm text-gray-600 dark:text-gray-400 truncate">
                        {p.persona.replace(/_/g, " ")}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                            <div
                              className={`h-2 rounded-full ${
                                p.avgScore >= 90 ? "bg-green-500" :
                                p.avgScore >= 70 ? "bg-blue-500" :
                                p.avgScore >= 50 ? "bg-yellow-500" : "bg-red-500"
                              }`}
                              style={{ width: `${p.avgScore}%` }}
                            ></div>
                          </div>
                          <span className="text-sm font-medium w-8 text-right">{p.avgScore}</span>
                        </div>
                      </div>
                      <span className="text-xs text-gray-400">n={p.taskCount}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {codeQualityMetrics.byModel.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Quality by Model</h3>
                <div className="space-y-2">
                  {codeQualityMetrics.byModel.slice(0, 5).map((m) => (
                    <div key={m.model} className="flex items-center gap-3">
                      <div className="w-28 text-sm text-gray-600 dark:text-gray-400 truncate">
                        {m.model.replace("claude-", "").replace(/-20\d{6}$/, "")}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                            <div
                              className={`h-2 rounded-full ${
                                m.avgScore >= 90 ? "bg-green-500" :
                                m.avgScore >= 70 ? "bg-blue-500" :
                                m.avgScore >= 50 ? "bg-yellow-500" : "bg-red-500"
                              }`}
                              style={{ width: `${m.avgScore}%` }}
                            ></div>
                          </div>
                          <span className="text-sm font-medium w-8 text-right">{m.avgScore}</span>
                        </div>
                      </div>
                      <span className="text-xs text-gray-400">n={m.taskCount}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Quality Trend */}
          {codeQualityMetrics.trend.length > 1 && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mb-6">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Quality Score Trend</h3>
              <div className="h-24 flex items-end gap-1">
                {codeQualityMetrics.trend.map((point, i) => {
                  const height = point.avgScore;
                  return (
                    <div
                      key={i}
                      className={`flex-1 rounded-t hover:opacity-80 transition-opacity ${
                        point.avgScore >= 90 ? "bg-green-400" :
                        point.avgScore >= 70 ? "bg-blue-400" :
                        point.avgScore >= 50 ? "bg-yellow-400" : "bg-red-400"
                      }`}
                      style={{ height: `${Math.max(height, 4)}%` }}
                      title={`${point.date}: Score ${point.avgScore} (${point.taskCount} tasks)`}
                    ></div>
                  );
                })}
              </div>
              <div className="flex justify-between mt-1 text-xs text-gray-500 dark:text-gray-400">
                <span>{codeQualityMetrics.trend[0]?.date}</span>
                <span>{codeQualityMetrics.trend[codeQualityMetrics.trend.length - 1]?.date}</span>
              </div>
            </div>
          )}

          {/* Low Quality Tasks - Investigation List */}
          {codeQualityMetrics.lowQualityTasks.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Tasks Needing Attention (Score &lt; 70)
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400">
                      <th className="pb-2 pr-4">Task</th>
                      <th className="pb-2 pr-4 text-center">Score</th>
                      <th className="pb-2 pr-4 text-center">Lint</th>
                      <th className="pb-2 pr-4 text-center">Type</th>
                      <th className="pb-2 pr-4 text-center">Tests</th>
                      <th className="pb-2 pr-4 text-center">Coverage</th>
                      <th className="pb-2 pr-4 text-center">Security</th>
                      <th className="pb-2">Persona</th>
                    </tr>
                  </thead>
                  <tbody>
                    {codeQualityMetrics.lowQualityTasks.slice(0, 5).map((task) => (
                      <tr key={task.id} className="border-t border-gray-100 dark:border-gray-700">
                        <td className="py-2 pr-4">
                          <div className="font-medium text-blue-600 dark:text-blue-400">
                            {task.jiraKey || task.id.slice(0, 8)}
                          </div>
                          {task.summary && (
                            <div className="text-xs text-gray-500 truncate max-w-xs">
                              {task.summary}
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-center">
                          <span className={`font-bold ${
                            (task.qualityScore ?? 0) >= 50 ? "text-yellow-600" : "text-red-600"
                          }`}>
                            {task.qualityScore ?? "-"}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-center">{task.lintScore ?? "-"}</td>
                        <td className="py-2 pr-4 text-center">{task.typecheckScore ?? "-"}</td>
                        <td className="py-2 pr-4 text-center">{task.testScore ?? "-"}</td>
                        <td className="py-2 pr-4 text-center">{task.coverageScore ?? "-"}</td>
                        <td className="py-2 pr-4 text-center">{task.securityScore ?? "-"}</td>
                        <td className="py-2 text-xs text-gray-500">
                          {task.persona?.replace(/_/g, " ") ?? "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Metrics Coverage Note */}
          <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
            {codeQualityMetrics.summary.tasksWithMetrics} of {codeQualityMetrics.summary.totalTasks} tasks have quality metrics ({codeQualityMetrics.summary.metricsRate}%)
          </div>
        </div>
      )}

      {/* Epic Workflow Metrics */}
      {prdMetrics && prdMetrics.summary.totalPrdWorkflows > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">Epic Workflow Metrics</h2>

          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="text-center p-3 bg-gray-50 dark:bg-gray-700 rounded">
              <p className="text-2xl font-bold">{prdMetrics.summary.totalPrdWorkflows}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Epics</p>
            </div>
            <div className="text-center p-3 bg-green-50 dark:bg-green-900/30 rounded">
              <p className="text-2xl font-bold text-green-600">{prdMetrics.summary.successRate}%</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Success Rate</p>
            </div>
            <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/30 rounded">
              <p className="text-2xl font-bold text-blue-600">{prdMetrics.planAccuracy.accuracyPercent}%</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Plan Accuracy</p>
            </div>
            <div className="text-center p-3 bg-purple-50 dark:bg-purple-900/30 rounded">
              <p className={`text-2xl font-bold ${prdMetrics.costVariance.avgVariancePercent > 20 ? "text-red-600" : prdMetrics.costVariance.avgVariancePercent < -10 ? "text-green-600" : "text-purple-600"}`}>
                {prdMetrics.costVariance.avgVariancePercent > 0 ? "+" : ""}{prdMetrics.costVariance.avgVariancePercent}%
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Cost Variance</p>
            </div>
          </div>

          {/* Cost Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Cost Analysis</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Planned Total:</span>
                  <span className="font-medium">${prdMetrics.costVariance.totalPlannedCost}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Actual Total:</span>
                  <span className="font-medium">${prdMetrics.costVariance.totalActualCost}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Data Points:</span>
                  <span className="font-medium">{prdMetrics.costVariance.dataPoints}</span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Time by Complexity</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Low Complexity:</span>
                  <span className="font-medium">{prdMetrics.timeToCompletion.byComplexityReadable.low}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Medium Complexity:</span>
                  <span className="font-medium">{prdMetrics.timeToCompletion.byComplexityReadable.medium}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">High Complexity:</span>
                  <span className="font-medium">{prdMetrics.timeToCompletion.byComplexityReadable.high}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Stories Planned vs Executed */}
          <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Story Execution</h3>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="flex justify-between text-sm mb-1">
                  <span>Planned: {prdMetrics.planAccuracy.totalPlannedStories}</span>
                  <span>Executed: {prdMetrics.planAccuracy.totalExecutedStories}</span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full"
                    style={{ width: `${Math.min(prdMetrics.planAccuracy.accuracyPercent, 100)}%` }}
                  ></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Planner-Critic Metrics */}
      {plannerCriticMetrics && plannerCriticMetrics.summary.totalPlans > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">Planner-Critic Metrics</h2>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/30 rounded">
              <p className="text-2xl font-bold text-blue-600">{plannerCriticMetrics.summary.avgCriticScore}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Avg Score</p>
            </div>
            <div className="text-center p-3 bg-green-50 dark:bg-green-900/30 rounded">
              <p className="text-2xl font-bold text-green-600">{plannerCriticMetrics.summary.firstAttemptApprovalRate}%</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">First-Pass Rate</p>
            </div>
            <div className="text-center p-3 bg-purple-50 dark:bg-purple-900/30 rounded">
              <p className="text-2xl font-bold text-purple-600">{plannerCriticMetrics.summary.avgIterations}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Avg Iterations</p>
            </div>
            <div className="text-center p-3 bg-yellow-50 dark:bg-yellow-900/30 rounded">
              <p className="text-2xl font-bold text-yellow-600">{plannerCriticMetrics.summary.fileCapHitRate}%</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">File Cap Hit Rate</p>
            </div>
          </div>

          {/* Score Distribution Bar */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Score Distribution</h3>
            <div className="flex gap-1 h-8">
              {plannerCriticMetrics.scoreDistribution.map((bucket) => {
                const color =
                  bucket.range === "90-100" ? "bg-green-500" :
                  bucket.range === "85-89" ? "bg-green-400" :
                  bucket.range === "75-84" ? "bg-yellow-400" :
                  bucket.range === "50-74" ? "bg-orange-400" :
                  "bg-red-400";
                return bucket.count > 0 ? (
                  <div
                    key={bucket.range}
                    className={`${color} rounded flex items-center justify-center text-xs text-white font-medium`}
                    style={{ flex: bucket.count }}
                    title={`${bucket.range}: ${bucket.count} plans (${bucket.percentage}%)`}
                  >
                    {bucket.percentage >= 10 && `${bucket.range}`}
                  </div>
                ) : null;
              })}
            </div>
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>0</span>
              <span>50</span>
              <span>75</span>
              <span>85</span>
              <span>100</span>
            </div>
          </div>

          {/* Recent Plans Table */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Recent Plans</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                    <th className="pb-2 pr-4">Task</th>
                    <th className="pb-2 pr-4">Score</th>
                    <th className="pb-2 pr-4">Iterations</th>
                    <th className="pb-2 pr-4">Stories</th>
                    <th className="pb-2 pr-4">File Cap</th>
                  </tr>
                </thead>
                <tbody>
                  {plannerCriticMetrics.recentPlans.map((plan) => (
                    <tr key={plan.taskId} className="border-b dark:border-gray-700/50">
                      <td className="py-2 pr-4 max-w-[200px] truncate" title={plan.summary}>
                        {plan.summary}
                      </td>
                      <td className="py-2 pr-4">
                        <span className={`font-medium ${
                          plan.criticScore >= 90 ? "text-green-600" :
                          plan.criticScore >= 85 ? "text-green-500" :
                          plan.criticScore >= 75 ? "text-yellow-500" :
                          "text-red-500"
                        }`}>
                          {plan.criticScore}
                        </span>
                      </td>
                      <td className="py-2 pr-4">{plan.iterations}</td>
                      <td className="py-2 pr-4">{plan.storyCount}</td>
                      <td className="py-2 pr-4">
                        {plan.fileCapTruncations > 0 ? (
                          <span className="text-yellow-500">{plan.fileCapTruncations}</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Common Risks */}
          {plannerCriticMetrics.commonRisks.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Common Risks</h3>
              <div className="space-y-1">
                {plannerCriticMetrics.commonRisks.slice(0, 5).map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="text-gray-400 w-6 text-right">{r.count}x</span>
                    <span className="text-gray-600 dark:text-gray-400 truncate">{r.risk}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Failure Modes Analysis */}
      {failureMetrics && failureMetrics.summary.totalFailures > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">Failure Mode Analysis</h2>

          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <div className="text-center p-3 bg-red-50 dark:bg-red-900/30 rounded">
              <p className="text-2xl font-bold text-red-600">{failureMetrics.summary.totalFailures}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Failures</p>
            </div>
            <div className="text-center p-3 bg-gray-50 dark:bg-gray-700 rounded">
              <p className="text-2xl font-bold">{failureMetrics.summary.failureRate}%</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Failure Rate</p>
            </div>
            <div className="text-center p-3 bg-yellow-50 dark:bg-yellow-900/30 rounded">
              <p className="text-2xl font-bold text-yellow-600">{failureMetrics.summary.retriedTasks}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Retried</p>
            </div>
            <div className="text-center p-3 bg-orange-50 dark:bg-orange-900/30 rounded">
              <p className="text-2xl font-bold text-orange-600">{failureMetrics.summary.maxRetriesExhausted}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Max Retries Hit</p>
            </div>
            <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/30 rounded">
              <p className="text-2xl font-bold text-blue-600">{failureMetrics.summary.totalTasks}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Tasks</p>
            </div>
          </div>

          {/* Failure Categories */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Failure Categories</h3>
            <div className="space-y-2">
              {failureMetrics.byCategory.slice(0, 8).map((cat) => (
                <div key={cat.category}>
                  <button
                    onClick={() => setExpandedCategory(expandedCategory === cat.category ? null : cat.category)}
                    className="w-full"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-gray-600 dark:text-gray-400">{cat.label}</span>
                          <span className="font-medium">{cat.count} ({cat.percentage}%)</span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full ${
                              cat.category.includes("infrastructure") || cat.category.includes("spot")
                                ? "bg-purple-500"
                                : cat.category.includes("git") || cat.category.includes("github")
                                ? "bg-orange-500"
                                : cat.category.includes("build") || cat.category.includes("type") || cat.category.includes("test") || cat.category.includes("lint")
                                ? "bg-yellow-500"
                                : cat.category.includes("context") || cat.category.includes("rate") || cat.category.includes("api")
                                ? "bg-blue-500"
                                : "bg-red-500"
                            }`}
                            style={{ width: `${cat.percentage}%` }}
                          ></div>
                        </div>
                      </div>
                      <span className="text-gray-400 text-sm">
                        {cat.examples.length > 0 && (expandedCategory === cat.category ? "−" : "+")}
                      </span>
                    </div>
                  </button>
                  {expandedCategory === cat.category && cat.examples.length > 0 && (
                    <div className="mt-2 ml-4 p-3 bg-gray-50 dark:bg-gray-700 rounded text-xs font-mono">
                      {cat.examples.map((ex, i) => (
                        <div key={i} className="text-gray-600 dark:text-gray-400 mb-1 last:mb-0 truncate">
                          {ex}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Breakdown by Persona & Model */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-gray-200 dark:border-gray-700">
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">By Persona</h3>
              <div className="space-y-1 text-sm">
                {failureMetrics.byPersona.slice(0, 5).map((p) => (
                  <div key={p.persona} className="flex justify-between">
                    <span className="text-gray-500">{p.persona.replace(/_/g, " ")}</span>
                    <span className="font-medium">{p.count}</span>
                  </div>
                ))}
                {failureMetrics.byPersona.length === 0 && (
                  <span className="text-gray-400">No data</span>
                )}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">By Model</h3>
              <div className="space-y-1 text-sm">
                {failureMetrics.byModel.slice(0, 5).map((m) => (
                  <div key={m.model} className="flex justify-between">
                    <span className="text-gray-500 truncate">{m.model.replace("claude-", "").replace("-20241022", "").replace("-20251001", "")}</span>
                    <span className="font-medium">{m.count}</span>
                  </div>
                ))}
                {failureMetrics.byModel.length === 0 && (
                  <span className="text-gray-400">No data</span>
                )}
              </div>
            </div>
          </div>

          {/* Weekly Trend */}
          {failureMetrics.weeklyTrend.length > 1 && (
            <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Weekly Failure Trend</h3>
              <div className="h-24 flex items-end gap-1">
                {failureMetrics.weeklyTrend.map((week, i) => {
                  const maxCount = Math.max(...failureMetrics.weeklyTrend.map((w) => w.count), 1);
                  const height = (week.count / maxCount) * 100;
                  return (
                    <div
                      key={i}
                      className="flex-1 bg-red-400 rounded-t hover:bg-red-500 transition-colors"
                      style={{ height: `${Math.max(height, 4)}%` }}
                      title={`Week of ${week.week}: ${week.count} failures`}
                    ></div>
                  );
                })}
              </div>
              <div className="flex justify-between mt-1 text-xs text-gray-500 dark:text-gray-400">
                <span>{failureMetrics.weeklyTrend[0]?.week}</span>
                <span>{failureMetrics.weeklyTrend[failureMetrics.weeklyTrend.length - 1]?.week}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Daily Usage Chart (simplified) */}
      {dailyUsage.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Daily Task Usage</h2>
          <div className="h-48 flex items-end gap-1">
            {dailyUsage.map((day, i) => {
              const maxTasks = Math.max(...dailyUsage.map((d) => d.tasks), 1);
              const height = (day.tasks / maxTasks) * 100;
              return (
                <div
                  key={i}
                  className="flex-1 bg-blue-500 rounded-t hover:bg-blue-600 transition-colors"
                  style={{ height: `${Math.max(height, 2)}%` }}
                  title={`${day.date}: ${day.tasks} tasks`}
                ></div>
              );
            })}
          </div>
          <div className="flex justify-between mt-2 text-xs text-gray-500 dark:text-gray-400">
            <span>{dailyUsage[0]?.date}</span>
            <span>{dailyUsage[dailyUsage.length - 1]?.date}</span>
          </div>
        </div>
      )}
    </div>
  );
}

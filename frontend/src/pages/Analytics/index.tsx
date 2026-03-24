import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useAuthStore } from "../../store/auth-store";
import { AnalyticsSkeleton } from "../../components/ui/skeleton";
import type {
  UsageStats,
  TaskStats,
  DailyUsage,
  PrdMetrics,
  FailureMetrics,
  EffectivenessMetrics,
  ReviewMetrics,
  CodeQualityMetrics,
  TokenUsageMetrics,
  BusinessOutcomes,
  TimeSaved,
  RoiMetrics,
  PlannerCriticMetrics,
} from "./types";
import UsageOverview from "./UsageOverview";
import ExecutiveDashboard from "./ExecutiveDashboard";
import RoiCalculator from "./RoiCalculator";
import TokenUsageAnalytics from "./TokenUsageAnalytics";
import WorkerEffectiveness from "./WorkerEffectiveness";
import ReviewMetricsSection from "./ReviewMetricsSection";
import TaskStatistics from "./TaskStatistics";
import CodeQualitySection from "./CodeQualityMetrics";
import EpicWorkflow from "./EpicWorkflow";
import PlannerCriticSection from "./PlannerCriticMetrics";
import FailureAnalysis from "./FailureAnalysis";
import DailyUsageChart from "./DailyUsageChart";

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
      {usage && <UsageOverview data={usage} />}

      {/* Executive Dashboard - Business Outcome Metrics */}
      {(businessOutcomes || timeSaved) && (
        <ExecutiveDashboard
          businessOutcomes={businessOutcomes}
          timeSaved={timeSaved}
          timeRange={timeRange}
        />
      )}

      {/* ROI Calculator */}
      {roiMetrics && roiMetrics.metrics.totalTasks > 0 && (
        <RoiCalculator
          data={roiMetrics}
          hourlyRate={hourlyRate}
          setHourlyRate={setHourlyRate}
        />
      )}

      {/* Token Usage Analytics (AI FinOps) */}
      {tokenUsageMetrics && tokenUsageMetrics.summary.taskCount > 0 && (
        <TokenUsageAnalytics data={tokenUsageMetrics} />
      )}

      {/* Worker Effectiveness */}
      {effectivenessMetrics && effectivenessMetrics.summary.total > 0 && (
        <WorkerEffectiveness data={effectivenessMetrics} />
      )}

      {/* Tech Lead Review Metrics */}
      {reviewMetrics && reviewMetrics.summary.reviewedTasks > 0 && (
        <ReviewMetricsSection data={reviewMetrics} />
      )}

      {/* Task Statistics */}
      {taskStats && <TaskStatistics data={taskStats} />}

      {/* Code Quality Metrics */}
      {codeQualityMetrics && codeQualityMetrics.summary.tasksWithMetrics > 0 && (
        <CodeQualitySection data={codeQualityMetrics} timeRange={timeRange} />
      )}

      {/* Epic Workflow Metrics */}
      {prdMetrics && prdMetrics.summary.totalPrdWorkflows > 0 && (
        <EpicWorkflow data={prdMetrics} />
      )}

      {/* Planner-Critic Metrics */}
      {plannerCriticMetrics && plannerCriticMetrics.summary.totalPlans > 0 && (
        <PlannerCriticSection data={plannerCriticMetrics} />
      )}

      {/* Failure Modes Analysis */}
      {failureMetrics && failureMetrics.summary.totalFailures > 0 && (
        <FailureAnalysis
          data={failureMetrics}
          expandedCategory={expandedCategory}
          setExpandedCategory={setExpandedCategory}
        />
      )}

      {/* Daily Usage Chart */}
      {dailyUsage.length > 0 && <DailyUsageChart data={dailyUsage} />}
    </div>
  );
}

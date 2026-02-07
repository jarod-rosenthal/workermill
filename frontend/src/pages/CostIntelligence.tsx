import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  BarChart3,
  Target,
  Zap,
  Clock,
  RefreshCw,
  Download,
} from "lucide-react";
import { useAuthStore } from "../store/auth-store";

interface BudgetStatus {
  withinBudget: boolean;
  violations: Array<{
    period: string;
    limit: number;
    spent: number;
    exceededBy: number;
  }>;
  spending: {
    daily: number;
    weekly: number;
    monthly: number;
  };
  limits: {
    daily: number | null;
    weekly: number | null;
    monthly: number | null;
  };
  override: {
    active: boolean;
    until: string | null;
    reason: string | null;
  };
}

interface EfficiencyTask {
  taskId: string;
  jiraKey: string | null;
  status: string;
  estimatedCostUsd: number | null;
  costVsAvg: number | null;
  hasPr: boolean;
  efficiencyScore: number;
  rating: string;
  createdAt: string;
}

interface EfficiencyScores {
  tasks: EfficiencyTask[];
  summary: {
    avgScore: number;
    excellent: number;
    good: number;
    average: number;
    belowAverage: number;
    poor: number;
    avgCostBaseline: number;
    avgDurationMinutes: number | null;
  };
}

interface WastefulPattern {
  type: string;
  severity: "high" | "medium" | "low";
  description: string;
  estimatedWaste: number;
  affectedTasks: number;
  examples: Array<{ taskId: string; jiraKey: string | null; cost: number }>;
  recommendation: string;
}

interface WastefulPatterns {
  patterns: WastefulPattern[];
  summary: {
    totalWaste: number;
    patternCount: number;
    highSeverity: number;
    mediumSeverity: number;
    lowSeverity: number;
    tasksAnalyzed: number;
    avgCostBaseline: number;
  };
}

interface RoiMetrics {
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
  assumptions: {
    developerHourlyRate: number;
    estimatedHoursPerTask: number;
  };
}

interface ActionCost {
  operationType: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number;
  recordCount: number;
  taskCount: number;
  avgCostPerTask: number;
}

interface ActionCosts {
  byOperationType: ActionCost[];
  totals: {
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalRecords: number;
  };
}

interface CostComparison {
  byModel: Array<{
    model: string;
    totalCost: number;
    taskCount: number;
    avgCost: number;
    successRate: number;
  }>;
  byPersona: Array<{
    persona: string;
    totalCost: number;
    taskCount: number;
    avgCost: number;
    successRate: number;
  }>;
  dailyTrend: Array<{
    date: string;
    cost: number;
    tasks: number;
  }>;
  summary: {
    totalCost: number;
    totalTasks: number;
    avgCostPerDay: number;
    dateRange: { start: string; end: string; days: number };
  };
}

interface CostAnomaly {
  type: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  value: number;
  threshold: number;
  timestamp: string;
  taskId?: string;
  jiraKey?: string;
}

interface CostAnomalies {
  anomalies: CostAnomaly[];
  summary: {
    total: number;
    critical: number;
    warning: number;
    info: number;
  };
  baseline: {
    avgCost: number;
    medianCost: number;
    stdDev: number;
    taskCount: number;
  };
}

interface CostSimulationResult {
  simulation: {
    model: string;
    complexity: string;
    durationMinutes: number;
    taskCount: number;
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    costPerTask: number;
    totalCost: number;
  };
  modelComparison: Array<{
    model: string;
    costPerTask: number;
    totalCost: number;
    savings: number;
    savingsPercent: number;
  }>;
  historicalComparison: {
    avgCost: number;
    vsHistorical: number | null;
  };
  budgetImpact: {
    dailyLimit: number | null;
    weeklyLimit: number | null;
    monthlyLimit: number | null;
    wouldExceedDaily: boolean;
    wouldExceedWeekly: boolean;
    wouldExceedMonthly: boolean;
  };
}

export default function CostIntelligence() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const tokens = useAuthStore((state) => state.tokens);
  const [range, setRange] = useState<"7d" | "30d" | "90d">("30d");
  const [loading, setLoading] = useState(true);
  const [budgetStatus, setBudgetStatus] = useState<BudgetStatus | null>(null);
  const [efficiencyScores, setEfficiencyScores] = useState<EfficiencyScores | null>(null);
  const [wastefulPatterns, setWastefulPatterns] = useState<WastefulPatterns | null>(null);
  const [roiMetrics, setRoiMetrics] = useState<RoiMetrics | null>(null);
  const [actionCosts, setActionCosts] = useState<ActionCosts | null>(null);
  const [costComparison, setCostComparison] = useState<CostComparison | null>(null);
  const [costAnomalies, setCostAnomalies] = useState<CostAnomalies | null>(null);

  // Cost simulation state
  const [simModel, setSimModel] = useState("claude-haiku-4-5");
  const [simComplexity, setSimComplexity] = useState("moderate");
  const [simDuration, setSimDuration] = useState(30);
  const [simTaskCount, setSimTaskCount] = useState(1);
  const [simulating, setSimulating] = useState(false);
  const [simulationResult, setSimulationResult] = useState<CostSimulationResult | null>(null);

  useEffect(() => {
    if (isAuthenticated && tokens?.accessToken) {
      fetchAllData();
    }
  }, [isAuthenticated, tokens?.accessToken, range]);

  const fetchAllData = async () => {
    if (!tokens?.accessToken) return;
    setLoading(true);
    const headers = { Authorization: `Bearer ${tokens.accessToken}` };

    try {
      const [budgetRes, efficiencyRes, patternsRes, roiRes, actionRes, comparisonRes] = await Promise.all([
        fetch(`/api/analytics/budget-status?range=${range}`, { headers }),
        fetch(`/api/analytics/efficiency-scores?range=${range}`, { headers }),
        fetch(`/api/analytics/wasteful-patterns?range=${range}`, { headers }),
        fetch(`/api/analytics/roi?range=${range}`, { headers }),
        fetch(`/api/analytics/action-costs?range=${range}`, { headers }),
        fetch(`/api/analytics/cost-comparison?range=${range}`, { headers }),
      ]);

      if (budgetRes.ok) {
        const data = await budgetRes.json();
        setBudgetStatus(data.data);
      }

      if (efficiencyRes.ok) {
        const data = await efficiencyRes.json();
        setEfficiencyScores(data.data);
      }

      if (patternsRes.ok) {
        const data = await patternsRes.json();
        setWastefulPatterns(data.data);
      }

      if (roiRes.ok) {
        const data = await roiRes.json();
        setRoiMetrics(data.data);
      }

      if (actionRes.ok) {
        const data = await actionRes.json();
        setActionCosts(data.data);
      }

      if (comparisonRes.ok) {
        const data = await comparisonRes.json();
        setCostComparison(data.data);
      }

      // Fetch anomalies
      const anomaliesRes = await fetch("/api/analytics/cost-anomalies", { headers });
      if (anomaliesRes.ok) {
        const data = await anomaliesRes.json();
        setCostAnomalies(data.data);
      }
    } catch (error) {
      console.error("Error fetching cost intelligence data:", error);
    } finally {
      setLoading(false);
    }
  };

  const runSimulation = async () => {
    if (!tokens?.accessToken) return;
    setSimulating(true);

    try {
      const response = await fetch("/api/analytics/cost-simulation", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: simModel,
          complexity: simComplexity,
          durationMinutes: simDuration,
          taskCount: simTaskCount,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setSimulationResult(data.data);
      }
    } catch (error) {
      console.error("Error running cost simulation:", error);
    } finally {
      setSimulating(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(value);
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "high":
        return "bg-red-500/20 text-red-400";
      case "medium":
        return "bg-yellow-500/20 text-yellow-400";
      case "low":
        return "bg-blue-500/20 text-blue-400";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getRatingColor = (rating: string) => {
    switch (rating) {
      case "excellent":
        return "text-green-400";
      case "good":
        return "text-blue-400";
      case "average":
        return "text-muted-foreground";
      case "below_average":
        return "text-yellow-400";
      case "poor":
        return "text-red-400";
      default:
        return "text-muted-foreground";
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-7xl mx-auto">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-muted rounded w-64"></div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-32 bg-muted rounded-lg"></div>
              ))}
            </div>
            <div className="h-64 bg-muted rounded-lg"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/dashboard"
              className="text-muted-foreground hover:text-primary"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-primary">Cost Intelligence</h1>
              <p className="text-sm text-muted-foreground">
                AI FinOps dashboard for cost optimization
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={range}
              onChange={(e) => setRange(e.target.value as "7d" | "30d" | "90d")}
              className="px-3 py-2 bg-surface border border-border border border-border rounded-lg text-sm"
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
            </select>
            <button
              onClick={fetchAllData}
              className="p-2 bg-surface border border-border border border-border rounded-lg hover:bg-muted"
              title="Refresh data"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <div className="relative">
              <button
                onClick={() => {
                  const link = document.createElement("a");
                  link.href = `/api/analytics/cost-report?range=${range}&format=csv`;
                  link.download = `cost-report-${range}.csv`;
                  if (tokens?.accessToken) {
                    fetch(`/api/analytics/cost-report?range=${range}&format=csv`, {
                      headers: { Authorization: `Bearer ${tokens.accessToken}` },
                    })
                      .then((res) => res.blob())
                      .then((blob) => {
                        const url = window.URL.createObjectURL(blob);
                        link.href = url;
                        link.click();
                        window.URL.revokeObjectURL(url);
                      });
                  }
                }}
                className="flex items-center gap-1 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
                title="Export CSV Report"
              >
                <Download className="w-4 h-4" />
                CSV
              </button>
            </div>
            <button
              onClick={() => {
                if (tokens?.accessToken) {
                  fetch(`/api/analytics/cost-report?range=${range}&format=json`, {
                    headers: { Authorization: `Bearer ${tokens.accessToken}` },
                  })
                    .then((res) => res.blob())
                    .then((blob) => {
                      const url = window.URL.createObjectURL(blob);
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = `cost-report-${range}.json`;
                      link.click();
                      window.URL.revokeObjectURL(url);
                    });
                }
              }}
              className="flex items-center gap-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
              title="Export JSON Report"
            >
              <Download className="w-4 h-4" />
              JSON
            </button>
          </div>
        </div>

        {/* Budget Status */}
        {budgetStatus && (
          <div className="bg-surface border border-border rounded-lg p-6 rounded-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <DollarSign className="w-5 h-5" />
                Budget Status
              </h2>
              {budgetStatus.override.active && (
                <span className="px-3 py-1 bg-yellow-500/20 text-yellow-400 rounded-full text-sm">
                  Override Active
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Daily */}
              <div className="p-4 bg-background rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">Daily</span>
                  {budgetStatus.limits.daily && (
                    <span className="text-xs text-muted-foreground">
                      Limit: {formatCurrency(budgetStatus.limits.daily)}
                    </span>
                  )}
                </div>
                <div className="text-2xl font-bold">{formatCurrency(budgetStatus.spending.daily)}</div>
                {budgetStatus.limits.daily && (
                  <div className="mt-2">
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          budgetStatus.spending.daily >= budgetStatus.limits.daily
                            ? "bg-red-500"
                            : budgetStatus.spending.daily >= budgetStatus.limits.daily * 0.8
                            ? "bg-yellow-500"
                            : "bg-green-500"
                        }`}
                        style={{
                          width: `${Math.min(
                            100,
                            (budgetStatus.spending.daily / budgetStatus.limits.daily) * 100
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Weekly */}
              <div className="p-4 bg-background rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">Weekly</span>
                  {budgetStatus.limits.weekly && (
                    <span className="text-xs text-muted-foreground">
                      Limit: {formatCurrency(budgetStatus.limits.weekly)}
                    </span>
                  )}
                </div>
                <div className="text-2xl font-bold">{formatCurrency(budgetStatus.spending.weekly)}</div>
                {budgetStatus.limits.weekly && (
                  <div className="mt-2">
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          budgetStatus.spending.weekly >= budgetStatus.limits.weekly
                            ? "bg-red-500"
                            : budgetStatus.spending.weekly >= budgetStatus.limits.weekly * 0.8
                            ? "bg-yellow-500"
                            : "bg-green-500"
                        }`}
                        style={{
                          width: `${Math.min(
                            100,
                            (budgetStatus.spending.weekly / budgetStatus.limits.weekly) * 100
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Monthly */}
              <div className="p-4 bg-background rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">Monthly</span>
                  {budgetStatus.limits.monthly && (
                    <span className="text-xs text-muted-foreground">
                      Limit: {formatCurrency(budgetStatus.limits.monthly)}
                    </span>
                  )}
                </div>
                <div className="text-2xl font-bold">{formatCurrency(budgetStatus.spending.monthly)}</div>
                {budgetStatus.limits.monthly && (
                  <div className="mt-2">
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          budgetStatus.spending.monthly >= budgetStatus.limits.monthly
                            ? "bg-red-500"
                            : budgetStatus.spending.monthly >= budgetStatus.limits.monthly * 0.8
                            ? "bg-yellow-500"
                            : "bg-green-500"
                        }`}
                        style={{
                          width: `${Math.min(
                            100,
                            (budgetStatus.spending.monthly / budgetStatus.limits.monthly) * 100
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {budgetStatus.violations.length > 0 && (
              <div className="mt-4 p-4 bg-red-500/10 rounded-lg">
                <div className="flex items-center gap-2 text-red-400 font-medium mb-2">
                  <AlertTriangle className="w-4 h-4" />
                  Budget Violations
                </div>
                <ul className="space-y-1 text-sm text-red-400">
                  {budgetStatus.violations.map((v, i) => (
                    <li key={i}>
                      {v.period} limit exceeded by {formatCurrency(v.exceededBy)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Cost Anomalies */}
        {costAnomalies && costAnomalies.anomalies.length > 0 && (
          <div className="bg-surface border border-border rounded-lg p-6 rounded-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                Cost Anomalies Detected
              </h2>
              <div className="flex gap-2">
                {costAnomalies.summary.critical > 0 && (
                  <span className="px-2 py-1 bg-red-500/20 text-red-400 rounded text-xs font-medium">
                    {costAnomalies.summary.critical} Critical
                  </span>
                )}
                {costAnomalies.summary.warning > 0 && (
                  <span className="px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded text-xs font-medium">
                    {costAnomalies.summary.warning} Warning
                  </span>
                )}
                {costAnomalies.summary.info > 0 && (
                  <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs font-medium">
                    {costAnomalies.summary.info} Info
                  </span>
                )}
              </div>
            </div>
            <div className="space-y-3">
              {costAnomalies.anomalies.slice(0, 5).map((anomaly, i) => (
                <div
                  key={i}
                  className={`p-4 rounded-lg border ${
                    anomaly.severity === "critical"
                      ? "bg-red-500/10 border-red-800"
                      : anomaly.severity === "warning"
                      ? "bg-yellow-500/10 border-yellow-800"
                      : "bg-blue-500/10 border-blue-800"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            anomaly.severity === "critical"
                              ? "bg-red-500"
                              : anomaly.severity === "warning"
                              ? "bg-yellow-500"
                              : "bg-blue-500"
                          }`}
                        />
                        <span className="font-medium text-sm">{anomaly.title}</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{anomaly.description}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(anomaly.timestamp).toLocaleDateString()}
                    </span>
                  </div>
                  {anomaly.jiraKey && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      Task: <span className="font-mono">{anomaly.jiraKey}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {costAnomalies.anomalies.length > 5 && (
              <div className="mt-3 text-center text-sm text-muted-foreground">
                +{costAnomalies.anomalies.length - 5} more anomalies
              </div>
            )}
          </div>
        )}

        {/* Cost Simulation Tool */}
        <div className="bg-surface border border-border rounded-lg p-6 rounded-xl">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5" />
            What-If Cost Simulator
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                Model
              </label>
              <select
                value={simModel}
                onChange={(e) => setSimModel(e.target.value)}
                className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm"
              >
                <option value="claude-haiku-4-5">Claude Haiku 4.5 ($1/$5)</option>
                <option value="claude-sonnet-4-5">Claude Sonnet 4.5 ($3/$15)</option>
                <option value="claude-opus-4-6">Claude Opus 4.6 ($5/$25)</option>
                <option value="gpt-4o">GPT-4o ($2.5/$10)</option>
                <option value="gpt-4o-mini">GPT-4o Mini ($0.15/$0.6)</option>
                <option value="gemini-2.0-flash">Gemini 2.0 Flash ($0.15/$0.6)</option>
                <option value="gemini-3-pro-preview">Gemini 3 Pro ($3.5/$10.5)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                Complexity
              </label>
              <select
                value={simComplexity}
                onChange={(e) => setSimComplexity(e.target.value)}
                className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm"
              >
                <option value="trivial">Trivial</option>
                <option value="simple">Simple</option>
                <option value="moderate">Moderate</option>
                <option value="complex">Complex</option>
                <option value="epic">Epic</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                Duration (min)
              </label>
              <input
                type="number"
                value={simDuration}
                onChange={(e) => setSimDuration(parseInt(e.target.value) || 30)}
                min={5}
                max={180}
                className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                Task Count
              </label>
              <input
                type="number"
                value={simTaskCount}
                onChange={(e) => setSimTaskCount(parseInt(e.target.value) || 1)}
                min={1}
                max={100}
                className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm"
              />
            </div>
          </div>
          <button
            onClick={runSimulation}
            disabled={simulating}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          >
            {simulating ? "Simulating..." : "Run Simulation"}
          </button>

          {simulationResult && (
            <div className="mt-6 space-y-4">
              {/* Main Result */}
              <div className="p-4 bg-blue-500/10 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-blue-400">
                    Estimated Cost
                  </span>
                  {simulationResult.budgetImpact.wouldExceedDaily ||
                  simulationResult.budgetImpact.wouldExceedWeekly ||
                  simulationResult.budgetImpact.wouldExceedMonthly ? (
                    <span className="px-2 py-0.5 bg-red-500/20 text-red-400 rounded text-xs">
                      Exceeds Budget
                    </span>
                  ) : null}
                </div>
                <div className="text-3xl font-bold text-blue-100">
                  {formatCurrency(simulationResult.simulation.totalCost)}
                </div>
                <div className="text-sm text-blue-300 mt-1">
                  {formatCurrency(simulationResult.simulation.costPerTask)} per task ×{" "}
                  {simulationResult.simulation.taskCount} tasks
                </div>
                <div className="text-xs text-blue-400 mt-2">
                  ~{simulationResult.simulation.estimatedInputTokens.toLocaleString()} input +{" "}
                  ~{simulationResult.simulation.estimatedOutputTokens.toLocaleString()} output tokens
                </div>
                {simulationResult.historicalComparison.vsHistorical !== null && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {simulationResult.historicalComparison.vsHistorical > 0 ? "+" : ""}
                    {simulationResult.historicalComparison.vsHistorical}% vs historical average (
                    {formatCurrency(simulationResult.historicalComparison.avgCost)})
                  </div>
                )}
              </div>

              {/* Model Comparison */}
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">
                  Compare with Other Models
                </h3>
                <div className="space-y-2">
                  {simulationResult.modelComparison.slice(0, 5).map((model) => (
                    <div
                      key={model.model}
                      className={`flex items-center justify-between p-2 rounded text-sm ${
                        model.model === simModel
                          ? "bg-blue-500/10 border border-blue-800"
                          : "bg-background"
                      }`}
                    >
                      <span className="font-medium">{model.model}</span>
                      <div className="text-right">
                        <div>{formatCurrency(model.totalCost)}</div>
                        {model.savings !== 0 && (
                          <div
                            className={`text-xs ${
                              model.savings > 0
                                ? "text-green-400"
                                : "text-red-400"
                            }`}
                          >
                            {model.savings > 0 ? "Save " : "Cost "}
                            {formatCurrency(Math.abs(model.savings))} ({Math.abs(model.savingsPercent)}%)
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ROI Summary */}
        {roiMetrics && (
          <div className="bg-surface border border-border rounded-lg p-6 rounded-xl">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Return on Investment
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-4 bg-background rounded-lg">
                <div className="text-3xl font-bold text-green-400">
                  {roiMetrics.roi > 0 ? "+" : ""}
                  {roiMetrics.roi.toFixed(0)}%
                </div>
                <div className="text-sm text-muted-foreground">ROI</div>
              </div>
              <div className="text-center p-4 bg-background rounded-lg">
                <div className="text-3xl font-bold">{formatCurrency(roiMetrics.totalCost)}</div>
                <div className="text-sm text-muted-foreground">Total Spend</div>
              </div>
              <div className="text-center p-4 bg-background rounded-lg">
                <div className="text-3xl font-bold text-green-400">
                  {formatCurrency(roiMetrics.estimatedDevCostSaved)}
                </div>
                <div className="text-sm text-muted-foreground">Est. Dev Cost Saved</div>
              </div>
              <div className="text-center p-4 bg-background rounded-lg">
                <div className="text-3xl font-bold">{roiMetrics.estimatedDevHoursSaved.toFixed(0)}h</div>
                <div className="text-sm text-muted-foreground">Est. Dev Hours Saved</div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Total Tasks:</span>{" "}
                <span className="font-medium">{roiMetrics.totalTasks}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Success Rate:</span>{" "}
                <span className="font-medium">{roiMetrics.successRate.toFixed(1)}%</span>
              </div>
              <div>
                <span className="text-muted-foreground">Avg Cost/Task:</span>{" "}
                <span className="font-medium">{formatCurrency(roiMetrics.avgCostPerTask)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Cost/PR:</span>{" "}
                <span className="font-medium">{formatCurrency(roiMetrics.costPerPr)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Efficiency Scores */}
        {efficiencyScores && (
          <div className="bg-surface border border-border rounded-lg p-6 rounded-xl">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Target className="w-5 h-5" />
              Cost Efficiency Scores
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-4">
              <div className="text-center p-3 bg-background rounded-lg">
                <div className="text-2xl font-bold">{efficiencyScores.summary.avgScore}</div>
                <div className="text-xs text-muted-foreground">Avg Score</div>
              </div>
              <div className="text-center p-3 bg-green-500/10 rounded-lg">
                <div className="text-2xl font-bold text-green-400">
                  {efficiencyScores.summary.excellent}
                </div>
                <div className="text-xs text-muted-foreground">Excellent</div>
              </div>
              <div className="text-center p-3 bg-blue-500/10 rounded-lg">
                <div className="text-2xl font-bold text-blue-400">
                  {efficiencyScores.summary.good}
                </div>
                <div className="text-xs text-muted-foreground">Good</div>
              </div>
              <div className="text-center p-3 bg-muted rounded-lg">
                <div className="text-2xl font-bold">{efficiencyScores.summary.average}</div>
                <div className="text-xs text-muted-foreground">Average</div>
              </div>
              <div className="text-center p-3 bg-yellow-500/10 rounded-lg">
                <div className="text-2xl font-bold text-yellow-400">
                  {efficiencyScores.summary.belowAverage}
                </div>
                <div className="text-xs text-muted-foreground">Below Avg</div>
              </div>
              <div className="text-center p-3 bg-red-500/10 rounded-lg">
                <div className="text-2xl font-bold text-red-400">
                  {efficiencyScores.summary.poor}
                </div>
                <div className="text-xs text-muted-foreground">Poor</div>
              </div>
            </div>

            {efficiencyScores.tasks.length > 0 && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3">Task</th>
                      <th className="text-left py-2 px-3">Status</th>
                      <th className="text-right py-2 px-3">Cost</th>
                      <th className="text-right py-2 px-3">vs Avg</th>
                      <th className="text-center py-2 px-3">PR</th>
                      <th className="text-right py-2 px-3">Score</th>
                      <th className="text-left py-2 px-3">Rating</th>
                    </tr>
                  </thead>
                  <tbody>
                    {efficiencyScores.tasks.slice(0, 10).map((task) => (
                      <tr key={task.taskId} className="border-b border-border hover:bg-muted/50">
                        <td className="py-2 px-3">
                          <span className="font-mono text-xs">{task.jiraKey || task.taskId.slice(0, 8)}</span>
                        </td>
                        <td className="py-2 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-xs ${
                              task.status === "completed" || task.status === "deployed"
                                ? "bg-green-500/20 text-green-400"
                                : "bg-red-500/20 text-red-400"
                            }`}
                          >
                            {task.status}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right font-mono">
                          {task.estimatedCostUsd ? formatCurrency(task.estimatedCostUsd) : "-"}
                        </td>
                        <td className="py-2 px-3 text-right">
                          {task.costVsAvg && (
                            <span
                              className={
                                task.costVsAvg <= 1
                                  ? "text-green-400"
                                  : "text-red-400"
                              }
                            >
                              {task.costVsAvg.toFixed(2)}x
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {task.hasPr ? (
                            <CheckCircle className="w-4 h-4 text-green-400 inline" />
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-bold">{task.efficiencyScore}</td>
                        <td className={`py-2 px-3 font-medium ${getRatingColor(task.rating)}`}>
                          {task.rating.replace("_", " ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Wasteful Patterns */}
        {wastefulPatterns && (
          <div className="bg-surface border border-border rounded-lg p-6 rounded-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                Wasteful Patterns Detected
              </h2>
              <div className="text-sm">
                <span className="text-muted-foreground">Est. Total Waste: </span>
                <span className="font-bold text-red-400">
                  {formatCurrency(wastefulPatterns.summary.totalWaste)}
                </span>
              </div>
            </div>

            {wastefulPatterns.patterns.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle className="w-12 h-12 mx-auto mb-2 text-green-500" />
                <p>No wasteful patterns detected. Great job!</p>
              </div>
            ) : (
              <div className="space-y-4">
                {wastefulPatterns.patterns.map((pattern, i) => (
                  <div key={i} className="p-4 border border-border rounded-lg">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-xs ${getSeverityColor(pattern.severity)}`}>
                          {pattern.severity}
                        </span>
                        <span className="font-medium">{pattern.type.replace(/_/g, " ")}</span>
                      </div>
                      <span className="text-red-400 font-medium">
                        -{formatCurrency(pattern.estimatedWaste)}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">{pattern.description}</p>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-medium">Recommendation:</span> {pattern.recommendation}
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      Affected tasks: {pattern.affectedTasks}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Action Costs */}
        {actionCosts && actionCosts.byOperationType.length > 0 && (
          <div className="bg-surface border border-border rounded-lg p-6 rounded-xl">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Zap className="w-5 h-5" />
              Cost by Operation Type
            </h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3">Operation</th>
                    <th className="text-right py-2 px-3">Tasks</th>
                    <th className="text-right py-2 px-3">Total Cost</th>
                    <th className="text-right py-2 px-3">Avg/Task</th>
                    <th className="text-right py-2 px-3">Input Tokens</th>
                    <th className="text-right py-2 px-3">Output Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {actionCosts.byOperationType.slice(0, 10).map((op) => (
                    <tr key={op.operationType} className="border-b border-border hover:bg-muted/50">
                      <td className="py-2 px-3 font-medium">{op.operationType}</td>
                      <td className="py-2 px-3 text-right">{op.taskCount}</td>
                      <td className="py-2 px-3 text-right font-mono">{formatCurrency(op.estimatedCostUsd)}</td>
                      <td className="py-2 px-3 text-right font-mono">{formatCurrency(op.avgCostPerTask)}</td>
                      <td className="py-2 px-3 text-right text-muted-foreground">{op.inputTokens.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right text-muted-foreground">{op.outputTokens.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-bold bg-background">
                    <td className="py-2 px-3">Total</td>
                    <td className="py-2 px-3 text-right">-</td>
                    <td className="py-2 px-3 text-right font-mono">{formatCurrency(actionCosts.totals.totalCost)}</td>
                    <td className="py-2 px-3 text-right">-</td>
                    <td className="py-2 px-3 text-right text-muted-foreground">{actionCosts.totals.totalInputTokens.toLocaleString()}</td>
                    <td className="py-2 px-3 text-right text-muted-foreground">{actionCosts.totals.totalOutputTokens.toLocaleString()}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* Cost Comparison Charts */}
        {costComparison && (
          <>
            {/* Daily Cost Trend */}
            {costComparison.dailyTrend.length > 0 && (
              <div className="bg-surface border border-border rounded-lg p-6 rounded-xl">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5" />
                  Daily Cost Trend
                </h2>
                <div className="h-48 flex items-end gap-1">
                  {costComparison.dailyTrend.map((day, i) => {
                    const maxCost = Math.max(...costComparison.dailyTrend.map((d) => d.cost), 0.01);
                    const height = (day.cost / maxCost) * 100;
                    return (
                      <div
                        key={i}
                        className="flex-1 bg-blue-600 rounded-t hover:bg-blue-500 transition-colors cursor-pointer"
                        style={{ height: `${Math.max(height, 2)}%` }}
                        title={`${day.date}: ${formatCurrency(day.cost)} (${day.tasks} tasks)`}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between mt-2 text-xs text-muted-foreground">
                  <span>{costComparison.dailyTrend[0]?.date}</span>
                  <span>Avg: {formatCurrency(costComparison.summary.avgCostPerDay)}/day</span>
                  <span>{costComparison.dailyTrend[costComparison.dailyTrend.length - 1]?.date}</span>
                </div>
              </div>
            )}

            {/* Cost by Model and Persona Charts */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Cost by Model */}
              {costComparison.byModel.length > 0 && (
                <div className="bg-surface border border-border rounded-lg p-6 rounded-xl">
                  <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <BarChart3 className="w-5 h-5" />
                    Cost by Model
                  </h2>
                  <div className="space-y-3">
                    {costComparison.byModel.slice(0, 6).map((item) => {
                      const maxCost = Math.max(...costComparison.byModel.map((m) => m.totalCost), 0.01);
                      const width = (item.totalCost / maxCost) * 100;
                      return (
                        <div key={item.model}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="font-medium truncate">{item.model}</span>
                            <span className="text-muted-foreground ml-2">
                              {formatCurrency(item.totalCost)}
                            </span>
                          </div>
                          <div className="h-4 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-purple-600 rounded-full transition-all"
                              style={{ width: `${width}%` }}
                            />
                          </div>
                          <div className="flex justify-between text-xs text-muted-foreground mt-1">
                            <span>{item.taskCount} tasks</span>
                            <span>Avg: {formatCurrency(item.avgCost)}</span>
                            <span>{item.successRate}% success</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Cost by Persona */}
              {costComparison.byPersona.length > 0 && (
                <div className="bg-surface border border-border rounded-lg p-6 rounded-xl">
                  <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <BarChart3 className="w-5 h-5" />
                    Cost by Persona
                  </h2>
                  <div className="space-y-3">
                    {costComparison.byPersona.slice(0, 6).map((item) => {
                      const maxCost = Math.max(...costComparison.byPersona.map((p) => p.totalCost), 0.01);
                      const width = (item.totalCost / maxCost) * 100;
                      return (
                        <div key={item.persona}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="font-medium truncate">{item.persona.replace(/_/g, " ")}</span>
                            <span className="text-muted-foreground ml-2">
                              {formatCurrency(item.totalCost)}
                            </span>
                          </div>
                          <div className="h-4 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-green-600 rounded-full transition-all"
                              style={{ width: `${width}%` }}
                            />
                          </div>
                          <div className="flex justify-between text-xs text-muted-foreground mt-1">
                            <span>{item.taskCount} tasks</span>
                            <span>Avg: {formatCurrency(item.avgCost)}</span>
                            <span>{item.successRate}% success</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

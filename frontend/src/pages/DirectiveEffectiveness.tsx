import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle,
  XCircle,
  TrendingUp,
  TrendingDown,
  Beaker,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useAuthStore } from "../store/auth-store";

// Types
interface DirectiveMetrics {
  directiveId: string;
  personaSlug: string;
  type: string;
  filename: string | null;
  version: number;
  usageCount: number;
  successCount: number;
  failureCount: number;
  successRate: number | null;
  avgQualityScore: number | null;
  avgAccuracyScore: number | null;
  lastUsedAt: string | null;
  isDeprecated: boolean;
}

interface DirectiveHealth {
  directiveId: string;
  personaSlug: string;
  type: string;
  filename: string | null;
  version: number;
  isActive: boolean;
  healthScore: number;
  healthStatus: "healthy" | "warning" | "critical" | "unknown";
  usageCount: number;
  successRate: number | null;
  avgQualityScore: number | null;
  issues: string[];
  recommendations: string[];
}

interface DeprecationCandidate {
  directiveId: string;
  personaSlug: string;
  type: string;
  filename: string | null;
  version: number;
  reason: string;
  score: number;
  usageCount: number;
  successRate: number | null;
  lastUsedAt: string | null;
  betterAlternative?: {
    directiveId: string;
    version: number;
    successRate: number | null;
  };
}

interface DirectiveGap {
  personaSlug: string;
  gapType: string;
  description: string;
  severity: "low" | "medium" | "high";
  recommendation: string;
  affectedTaskCount?: number;
}

interface ExperimentSummary {
  id: string;
  name: string;
  description: string | null;
  status: string;
  personaSlug: string;
  directiveType: string;
  variantCount: number;
  startedAt: string | null;
  completedAt: string | null;
  winnerId: string | null;
  totalSamples: number;
  progress: number;
}

interface HealthSummary {
  total: number;
  healthy: number;
  warning: number;
  critical: number;
  unknown: number;
}

// API Client
const API_BASE = import.meta.env.VITE_API_URL || "/api";

async function fetchWithAuth(path: string, options: RequestInit = {}) {
  const token = useAuthStore.getState().tokens?.accessToken;
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
}

// Components
function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  color = "gray",
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string }>;
  trend?: "up" | "down";
  color?: "gray" | "green" | "yellow" | "red";
}) {
  const colorClasses = {
    gray: "bg-zinc-800/50 border-zinc-700",
    green: "bg-emerald-900/30 border-emerald-700",
    yellow: "bg-amber-900/30 border-amber-700",
    red: "bg-red-900/30 border-red-700",
  };

  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color]}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-zinc-400">{title}</span>
        {Icon && <Icon className="h-4 w-4 text-zinc-500" />}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold">{value}</span>
        {trend && (
          <span className={trend === "up" ? "text-emerald-400" : "text-red-400"}>
            {trend === "up" ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          </span>
        )}
      </div>
      {subtitle && <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>}
    </div>
  );
}

function HealthBadge({ status }: { status: DirectiveHealth["healthStatus"] }) {
  const config = {
    healthy: { icon: CheckCircle, label: "Healthy", className: "text-emerald-400 bg-emerald-900/30" },
    warning: { icon: AlertTriangle, label: "Warning", className: "text-amber-400 bg-amber-900/30" },
    critical: { icon: XCircle, label: "Critical", className: "text-red-400 bg-red-900/30" },
    unknown: { icon: AlertTriangle, label: "Unknown", className: "text-zinc-400 bg-zinc-800" },
  };

  const { icon: Icon, label, className } = config[status];

  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${className}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function DirectiveRow({
  directive,
  health,
}: {
  directive: DirectiveMetrics;
  health?: DirectiveHealth;
}) {
  const [expanded, setExpanded] = useState(false);
  const successRate = directive.successRate !== null ? (directive.successRate * 100).toFixed(1) : "N/A";

  return (
    <div className="border-b border-zinc-800 last:border-b-0">
      <div
        className="flex cursor-pointer items-center gap-4 px-4 py-3 hover:bg-zinc-800/30"
        onClick={() => setExpanded(!expanded)}
      >
        <button className="text-zinc-400">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{directive.personaSlug}</span>
            <span className="text-xs text-zinc-500">
              {directive.type === "readme" ? "README" : directive.filename}
            </span>
            <span className="text-xs text-zinc-600">v{directive.version}</span>
          </div>
        </div>
        <div className="flex items-center gap-6 text-sm">
          <div className="w-20 text-right">
            <span className="text-zinc-400">{directive.usageCount}</span>
            <span className="ml-1 text-xs text-zinc-600">uses</span>
          </div>
          <div className="w-24 text-right">
            <span className={successRate !== "N/A" && parseFloat(successRate) >= 70 ? "text-emerald-400" : successRate !== "N/A" && parseFloat(successRate) < 50 ? "text-red-400" : "text-zinc-400"}>
              {successRate}%
            </span>
          </div>
          <div className="w-16 text-right">
            <span className="text-zinc-400">
              {directive.avgQualityScore !== null ? directive.avgQualityScore.toFixed(0) : "N/A"}
            </span>
          </div>
          {health && <HealthBadge status={health.healthStatus} />}
        </div>
      </div>
      {expanded && health && (
        <div className="border-t border-zinc-800/50 bg-zinc-900/30 px-12 py-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h4 className="mb-2 text-sm font-medium text-zinc-400">Issues</h4>
              {health.issues.length > 0 ? (
                <ul className="space-y-1 text-sm text-zinc-500">
                  {health.issues.map((issue, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0 text-amber-500" />
                      {issue}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-zinc-600">No issues detected</p>
              )}
            </div>
            <div>
              <h4 className="mb-2 text-sm font-medium text-zinc-400">Recommendations</h4>
              {health.recommendations.length > 0 ? (
                <ul className="space-y-1 text-sm text-zinc-500">
                  {health.recommendations.map((rec, i) => (
                    <li key={i}>{rec}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-zinc-600">No recommendations</p>
              )}
            </div>
          </div>
          <div className="mt-4 flex gap-4 text-xs text-zinc-600">
            <span>Success: {directive.successCount}</span>
            <span>Failures: {directive.failureCount}</span>
            <span>
              Accuracy: {directive.avgAccuracyScore !== null ? directive.avgAccuracyScore.toFixed(0) : "N/A"}
            </span>
            {directive.lastUsedAt && (
              <span>Last used: {new Date(directive.lastUsedAt).toLocaleDateString()}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ExperimentCard({ experiment }: { experiment: ExperimentSummary }) {
  const statusColors = {
    draft: "bg-zinc-700 text-zinc-300",
    running: "bg-blue-900/50 text-blue-300",
    completed: "bg-emerald-900/50 text-emerald-300",
    cancelled: "bg-red-900/50 text-red-300",
  };

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800/30 p-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-medium">{experiment.name}</h3>
          <p className="mt-1 text-sm text-zinc-500">
            {experiment.personaSlug} - {experiment.directiveType}
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            statusColors[experiment.status as keyof typeof statusColors] || statusColors.draft
          }`}
        >
          {experiment.status}
        </span>
      </div>
      {experiment.description && (
        <p className="mt-2 text-sm text-zinc-400">{experiment.description}</p>
      )}
      <div className="mt-3">
        <div className="flex justify-between text-xs text-zinc-500">
          <span>{experiment.totalSamples} samples</span>
          <span>{experiment.progress}% complete</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-700">
          <div
            className="h-full rounded-full bg-blue-500 transition-all"
            style={{ width: `${experiment.progress}%` }}
          />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs text-zinc-600">
        <span>{experiment.variantCount} variants</span>
        {experiment.startedAt && (
          <span>Started: {new Date(experiment.startedAt).toLocaleDateString()}</span>
        )}
        {experiment.winnerId && <span className="text-emerald-400">Winner selected</span>}
      </div>
    </div>
  );
}

// Main Page
export default function DirectiveEffectiveness() {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<DirectiveMetrics[]>([]);
  const [healthSummary, setHealthSummary] = useState<HealthSummary | null>(null);
  const [healthReport, setHealthReport] = useState<DirectiveHealth[]>([]);
  const [deprecationCandidates, setDeprecationCandidates] = useState<DeprecationCandidate[]>([]);
  const [gaps, setGaps] = useState<DirectiveGap[]>([]);
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [activeTab, setActiveTab] = useState<"overview" | "experiments" | "gaps">("overview");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [metricsRes, healthRes, deprecationRes, gapsRes, experimentsRes] = await Promise.all([
        fetchWithAuth("/directives/effectiveness?activeOnly=true"),
        fetchWithAuth("/directives/health"),
        fetchWithAuth("/directives/deprecation-candidates"),
        fetchWithAuth("/directives/gaps"),
        fetchWithAuth("/directives/experiments?limit=10"),
      ]);

      setMetrics(metricsRes.metrics || []);
      setHealthSummary(healthRes.summary || null);
      setHealthReport(healthRes.directives || []);
      setDeprecationCandidates(deprecationRes.candidates || []);
      setGaps(gapsRes.gaps || []);
      setExperiments(experimentsRes.experiments || []);
    } catch (error) {
      console.error("Failed to load directive data:", error);
    } finally {
      setLoading(false);
    }
  }

  // Calculate overview stats
  const totalDirectives = metrics.length;
  const avgSuccessRate =
    metrics.filter((m) => m.successRate !== null).length > 0
      ? metrics
          .filter((m) => m.successRate !== null)
          .reduce((sum, m) => sum + (m.successRate || 0), 0) /
        metrics.filter((m) => m.successRate !== null).length
      : null;
  const runningExperiments = experiments.filter((e) => e.status === "running").length;

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        <div className="mx-auto max-w-6xl px-4 py-8">
          <div className="animate-pulse">
            <div className="h-8 w-48 rounded bg-zinc-800" />
            <div className="mt-8 grid gap-4 md:grid-cols-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-24 rounded-lg bg-zinc-800" />
              ))}
            </div>
            <div className="mt-8 h-96 rounded-lg bg-zinc-800" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/settings" className="text-zinc-400 hover:text-zinc-200">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-2xl font-semibold">Directive Effectiveness</h1>
          </div>
        </div>

        {/* Overview Cards */}
        <div className="mb-8 grid gap-4 md:grid-cols-4">
          <StatCard
            title="Total Directives"
            value={totalDirectives}
            subtitle="Active directives"
          />
          <StatCard
            title="Avg Success Rate"
            value={avgSuccessRate !== null ? `${(avgSuccessRate * 100).toFixed(1)}%` : "N/A"}
            subtitle="Across all directives"
            color={avgSuccessRate !== null && avgSuccessRate >= 0.7 ? "green" : avgSuccessRate !== null && avgSuccessRate < 0.5 ? "red" : "gray"}
          />
          <StatCard
            title="Running Experiments"
            value={runningExperiments}
            subtitle="A/B tests in progress"
            icon={Beaker}
          />
          <StatCard
            title="Health Alerts"
            value={(healthSummary?.warning || 0) + (healthSummary?.critical || 0)}
            subtitle={`${healthSummary?.critical || 0} critical`}
            color={(healthSummary?.critical || 0) > 0 ? "red" : (healthSummary?.warning || 0) > 0 ? "yellow" : "green"}
          />
        </div>

        {/* Tabs */}
        <div className="mb-6 flex gap-4 border-b border-zinc-800">
          {[
            { id: "overview", label: "Overview" },
            { id: "experiments", label: "Experiments" },
            { id: "gaps", label: "Gaps & Issues" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-blue-500 text-blue-400"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* Directive List */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
              <div className="border-b border-zinc-800 px-4 py-3">
                <h2 className="font-medium">Directive Performance</h2>
              </div>
              <div className="divide-y divide-zinc-800">
                {/* Header */}
                <div className="flex items-center gap-4 px-4 py-2 text-xs text-zinc-500">
                  <div className="w-4" />
                  <div className="flex-1">Directive</div>
                  <div className="w-20 text-right">Usage</div>
                  <div className="w-24 text-right">Success Rate</div>
                  <div className="w-16 text-right">Quality</div>
                  <div className="w-20">Health</div>
                </div>
                {/* Rows */}
                {metrics.length > 0 ? (
                  metrics.map((directive) => (
                    <DirectiveRow
                      key={directive.directiveId}
                      directive={directive}
                      health={healthReport.find((h) => h.directiveId === directive.directiveId)}
                    />
                  ))
                ) : (
                  <div className="px-4 py-8 text-center text-zinc-500">
                    No directives with usage data yet. Run some tasks to start tracking effectiveness.
                  </div>
                )}
              </div>
            </div>

            {/* Deprecation Candidates */}
            {deprecationCandidates.length > 0 && (
              <div className="rounded-lg border border-amber-800/50 bg-amber-900/20">
                <div className="border-b border-amber-800/50 px-4 py-3">
                  <h2 className="flex items-center gap-2 font-medium text-amber-300">
                    <AlertTriangle className="h-4 w-4" />
                    Deprecation Candidates
                  </h2>
                </div>
                <div className="divide-y divide-amber-800/30">
                  {deprecationCandidates.slice(0, 5).map((candidate) => (
                    <div key={candidate.directiveId} className="px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-medium">{candidate.personaSlug}</span>
                          <span className="ml-2 text-sm text-zinc-500">
                            {candidate.type === "readme" ? "README" : candidate.filename} v{candidate.version}
                          </span>
                        </div>
                        <span className="text-sm text-amber-400">{candidate.score}% confidence</span>
                      </div>
                      <p className="mt-1 text-sm text-zinc-400">{candidate.reason}</p>
                      {candidate.betterAlternative && (
                        <p className="mt-1 text-xs text-zinc-500">
                          Better alternative: v{candidate.betterAlternative.version} (
                          {((candidate.betterAlternative.successRate || 0) * 100).toFixed(0)}% success)
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "experiments" && (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              {experiments.length > 0 ? (
                experiments.map((experiment) => (
                  <ExperimentCard key={experiment.id} experiment={experiment} />
                ))
              ) : (
                <div className="col-span-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-8 text-center text-zinc-500">
                  No experiments yet. Create an A/B test to compare directive versions.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "gaps" && (
          <div className="space-y-6">
            {gaps.length > 0 ? (
              <div className="space-y-4">
                {gaps.map((gap, index) => (
                  <div
                    key={index}
                    className={`rounded-lg border p-4 ${
                      gap.severity === "high"
                        ? "border-red-800/50 bg-red-900/20"
                        : gap.severity === "medium"
                        ? "border-amber-800/50 bg-amber-900/20"
                        : "border-zinc-700 bg-zinc-800/30"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="font-medium">{gap.personaSlug}</span>
                        <span
                          className={`ml-2 rounded px-2 py-0.5 text-xs ${
                            gap.severity === "high"
                              ? "bg-red-900/50 text-red-300"
                              : gap.severity === "medium"
                              ? "bg-amber-900/50 text-amber-300"
                              : "bg-zinc-700 text-zinc-300"
                          }`}
                        >
                          {gap.severity}
                        </span>
                      </div>
                      <span className="text-xs text-zinc-500">{gap.gapType.replace(/_/g, " ")}</span>
                    </div>
                    <p className="mt-2 text-sm text-zinc-400">{gap.description}</p>
                    <p className="mt-2 text-sm text-zinc-500">
                      <strong>Recommendation:</strong> {gap.recommendation}
                    </p>
                    {gap.affectedTaskCount && (
                      <p className="mt-1 text-xs text-zinc-600">{gap.affectedTaskCount} tasks affected</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-emerald-800/50 bg-emerald-900/20 px-4 py-8 text-center">
                <CheckCircle className="mx-auto h-8 w-8 text-emerald-400" />
                <p className="mt-2 text-emerald-300">No gaps detected</p>
                <p className="mt-1 text-sm text-zinc-500">All personas have working directives</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

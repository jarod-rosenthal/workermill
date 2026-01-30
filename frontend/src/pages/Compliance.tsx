import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Shield,
  CheckCircle,
  AlertTriangle,
  Clock,
  Globe,
  Key,
  Activity,
  FileText,
  RefreshCw,
  Download,
  ExternalLink,
  Lock,
  Eye,
  Database,
  Server,
} from "lucide-react";
import { useAuthStore } from "../store/auth-store";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface CompliancePosture {
  organization: { id: string; name: string; plan: string };
  period: { days: number; startDate: string; endDate: string };
  summary: {
    overallScore: number;
    totalControls: number;
    activeControls: number;
    reviewNeeded: number;
  };
  eventCounts: {
    security: number;
    accessControl: number;
    changeManagement: number;
    total: number;
  };
  controls: Array<{
    id: string;
    name: string;
    status: "active" | "review_needed";
    description: string;
  }>;
  frameworks: Array<{
    id: string;
    name: string;
    status: "supported" | "partial" | "preparing";
  }>;
}

interface Soc2Report {
  reportType: string;
  organization: { id: string; name: string };
  period: { startDate: string; endDate: string };
  generatedAt: string;
  summary: {
    totalCriteria: number;
    compliant: number;
    reviewNeeded: number;
    noData: number;
    overallScore: number;
  };
  criteria: Record<
    string,
    {
      name: string;
      description: string;
      totalEvents: number;
      events: Array<{ action: string; count: number; lastOccurrence: Date | null }>;
      complianceStatus: "compliant" | "review_needed" | "no_data";
    }
  >;
}

interface DataResidencyConfig {
  current: {
    region: string;
    regionInfo: {
      name: string;
      country: string;
      continent: string;
      gdprCompliant: boolean;
    };
    residencyMode: string;
  };
  complianceStatus: {
    gdprCompliant: boolean;
    crossBorderTransfers: boolean;
    dataLocalizedTo: string | null;
  };
}

interface AiTransparency {
  reportType: string;
  organization: { id: string; name: string; plan: string };
  period: { days: number; startDate: string; endDate: string };
  generatedAt: string;
  aiUsageSummary: {
    totalTasks: number;
    tasksByStatus: Record<string, number>;
    defaultModel: string;
    defaultPersona: string;
  };
  costSummary: {
    totalCost: number;
    averageCostPerTask: number;
    maxTaskCost: number;
  };
  humanOversight: {
    prReviewRequired: boolean;
    managerReviewEnabled: boolean;
    qualityGatesEnabled: boolean;
  };
  transparencyCommitments: string[];
}

export default function Compliance() {
  const tokens = useAuthStore((state) => state.tokens);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [posture, setPosture] = useState<CompliancePosture | null>(null);
  const [soc2Report, setSoc2Report] = useState<Soc2Report | null>(null);
  const [dataResidency, setDataResidency] = useState<DataResidencyConfig | null>(null);
  const [aiTransparency, setAiTransparency] = useState<AiTransparency | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "soc2" | "ai" | "data">("overview");
  const [refreshing, setRefreshing] = useState(false);

  const fetchComplianceData = async () => {
    setRefreshing(true);
    try {
      const headers = { Authorization: `Bearer ${tokens?.accessToken}` };

      const [postureRes, soc2Res, residencyRes, aiRes] = await Promise.all([
        fetch(`${API_BASE}/api/compliance/posture`, { headers }),
        fetch(`${API_BASE}/api/compliance/soc2-report`, { headers }),
        fetch(`${API_BASE}/api/compliance/data-residency/config`, { headers }),
        fetch(`${API_BASE}/api/compliance/ai-audit/transparency`, { headers }),
      ]);

      if (postureRes.ok) setPosture(await postureRes.json());
      if (soc2Res.ok) setSoc2Report(await soc2Res.json());
      if (residencyRes.ok) setDataResidency(await residencyRes.json());
      if (aiRes.ok) setAiTransparency(await aiRes.json());

      setError(null);
    } catch (err) {
      setError("Failed to load compliance data");
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchComplianceData();
  }, [tokens?.accessToken]);

  const exportSoc2Report = async () => {
    try {
      const response = await fetch(
        `${API_BASE}/api/compliance/soc2-report/export`,
        { headers: { Authorization: `Bearer ${tokens?.accessToken}` } }
      );
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `soc2-report-${new Date().toISOString().split("T")[0]}.json`;
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error("Failed to export report", err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b border-border bg-surface">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center gap-4">
                <Link
                  to="/dashboard"
                  className="text-muted-foreground hover:text-primary transition-colors"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Link>
                <div>
                  <h1 className="text-xl font-bold text-primary flex items-center gap-2">
                    <Shield className="h-5 w-5 text-accent" />
                    Compliance Center
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    Enterprise security & compliance management
                  </p>
                </div>
              </div>
            </div>
          </div>
        </header>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="animate-pulse space-y-6">
            <div className="h-32 bg-surface border border-border rounded-xl" />
            <div className="grid grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-24 bg-surface border border-border rounded-lg" />
              ))}
            </div>
            <div className="h-64 bg-surface border border-border rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: "overview", label: "Overview", icon: Shield },
    { id: "soc2", label: "SOC 2", icon: FileText },
    { id: "ai", label: "AI Transparency", icon: Activity },
    { id: "data", label: "Data Residency", icon: Globe },
  ] as const;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Link
                to="/dashboard"
                className="text-muted-foreground hover:text-primary transition-colors"
              >
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <div>
                <h1 className="text-xl font-bold text-primary flex items-center gap-2">
                  <Shield className="h-5 w-5 text-accent" />
                  Compliance Center
                </h1>
                <p className="text-sm text-muted-foreground">
                  Enterprise security & compliance management
                </p>
              </div>
            </div>
            <button
              onClick={fetchComplianceData}
              disabled={refreshing}
              className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="border-b border-border bg-surface">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 border-b-2 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? "border-accent text-accent"
                    : "border-transparent text-muted-foreground hover:text-primary hover:border-border"
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400">
            {error}
          </div>
        )}

        {/* Overview Tab */}
        {activeTab === "overview" && posture && (
          <div className="space-y-6">
            {/* Score Card */}
            <div className="relative overflow-hidden bg-gradient-to-br from-accent/20 via-accent/10 to-transparent border border-accent/30 rounded-xl p-8">
              <div className="absolute top-0 right-0 w-64 h-64 bg-accent/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
              <div className="relative flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 text-muted-foreground mb-2">
                    <Shield className="h-5 w-5" />
                    <span className="text-sm font-medium uppercase tracking-wider">
                      Overall Compliance Score
                    </span>
                  </div>
                  <div className="flex items-baseline gap-3">
                    <span className="text-5xl font-bold text-primary">
                      {posture.summary.overallScore}%
                    </span>
                    <span className="text-lg text-muted-foreground">
                      ({posture.summary.activeControls}/{posture.summary.totalControls} controls active)
                    </span>
                  </div>
                  {posture.summary.reviewNeeded > 0 && (
                    <p className="mt-2 text-sm text-yellow-400 flex items-center gap-1">
                      <AlertTriangle className="h-4 w-4" />
                      {posture.summary.reviewNeeded} control{posture.summary.reviewNeeded !== 1 ? 's' : ''} need review
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Analysis Period</p>
                  <p className="text-lg font-medium text-primary">Last {posture.period.days} days</p>
                </div>
              </div>
            </div>

            {/* Framework Coverage */}
            <div className="bg-surface border border-border rounded-xl p-6">
              <h3 className="text-lg font-semibold text-primary mb-4 flex items-center gap-2">
                <Lock className="h-5 w-5 text-accent" />
                Framework Coverage
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {posture.frameworks.map((fw) => (
                  <div
                    key={fw.id}
                    className={`p-4 rounded-lg border transition-all ${
                      fw.status === "supported"
                        ? "bg-green-500/10 border-green-500/30 hover:border-green-500/50"
                        : fw.status === "partial"
                        ? "bg-yellow-500/10 border-yellow-500/30 hover:border-yellow-500/50"
                        : "bg-background border-border hover:border-muted-foreground/30"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {fw.status === "supported" ? (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      ) : fw.status === "partial" ? (
                        <AlertTriangle className="h-5 w-5 text-yellow-500" />
                      ) : (
                        <Clock className="h-5 w-5 text-muted-foreground" />
                      )}
                      <span className="font-semibold text-primary">{fw.name}</span>
                    </div>
                    <span
                      className={`text-sm ${
                        fw.status === "supported"
                          ? "text-green-400"
                          : fw.status === "partial"
                          ? "text-yellow-400"
                          : "text-muted-foreground"
                      }`}
                    >
                      {fw.status === "supported"
                        ? "Fully Supported"
                        : fw.status === "partial"
                        ? "Partial Coverage"
                        : "Preparing"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Security Controls */}
            <div className="bg-surface border border-border rounded-xl p-6">
              <h3 className="text-lg font-semibold text-primary mb-4 flex items-center gap-2">
                <Eye className="h-5 w-5 text-accent" />
                Security Controls
              </h3>
              <div className="space-y-3">
                {posture.controls.map((control) => (
                  <div
                    key={control.id}
                    className="flex items-center justify-between p-4 bg-background rounded-lg border border-border hover:border-muted-foreground/30 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {control.status === "active" ? (
                        <div className="p-2 rounded-lg bg-green-500/10">
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        </div>
                      ) : (
                        <div className="p-2 rounded-lg bg-yellow-500/10">
                          <AlertTriangle className="h-5 w-5 text-yellow-500" />
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-primary">{control.name}</p>
                        <p className="text-sm text-muted-foreground">{control.description}</p>
                      </div>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-medium ${
                        control.status === "active"
                          ? "bg-green-500/20 text-green-400"
                          : "bg-yellow-500/20 text-yellow-400"
                      }`}
                    >
                      {control.status === "active" ? "Active" : "Review Needed"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Event Counts */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Security Events", value: posture.eventCounts.security, icon: Shield },
                { label: "Access Control", value: posture.eventCounts.accessControl, icon: Key },
                { label: "Change Management", value: posture.eventCounts.changeManagement, icon: Activity },
                { label: "Total Events", value: posture.eventCounts.total, icon: Database },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="bg-surface border border-border rounded-lg p-4 hover:border-muted-foreground/30 transition-colors"
                >
                  <div className="flex items-center gap-2 text-muted-foreground mb-2">
                    <stat.icon className="h-4 w-4" />
                    <span className="text-sm">{stat.label}</span>
                  </div>
                  <p className="text-2xl font-bold text-primary">{stat.value.toLocaleString()}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SOC 2 Tab */}
        {activeTab === "soc2" && soc2Report && (
          <div className="space-y-6">
            {/* Report Header */}
            <div className="bg-surface border border-border rounded-xl p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg font-semibold text-primary flex items-center gap-2">
                    <FileText className="h-5 w-5 text-accent" />
                    {soc2Report.reportType}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {new Date(soc2Report.period.startDate).toLocaleDateString()} -{" "}
                    {new Date(soc2Report.period.endDate).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={exportSoc2Report}
                  className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors"
                >
                  <Download className="h-4 w-4" />
                  Export Report
                </button>
              </div>

              {/* Score Summary */}
              <div className="grid grid-cols-4 gap-4">
                <div className="text-center p-4 bg-accent/10 border border-accent/30 rounded-lg">
                  <p className="text-3xl font-bold text-accent">
                    {soc2Report.summary.overallScore}%
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">Overall Score</p>
                </div>
                <div className="text-center p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                  <p className="text-3xl font-bold text-green-400">
                    {soc2Report.summary.compliant}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">Compliant</p>
                </div>
                <div className="text-center p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                  <p className="text-3xl font-bold text-yellow-400">
                    {soc2Report.summary.reviewNeeded}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">Review Needed</p>
                </div>
                <div className="text-center p-4 bg-background border border-border rounded-lg">
                  <p className="text-3xl font-bold text-muted-foreground">
                    {soc2Report.summary.noData}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">No Data</p>
                </div>
              </div>
            </div>

            {/* Trust Service Criteria */}
            <div className="bg-surface border border-border rounded-xl p-6">
              <h3 className="text-lg font-semibold text-primary mb-4">
                Trust Service Criteria
              </h3>
              <div className="space-y-4">
                {Object.entries(soc2Report.criteria).map(([id, criteria]) => (
                  <div
                    key={id}
                    className="border border-border rounded-lg p-4 bg-background hover:border-muted-foreground/30 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm bg-surface border border-border px-2 py-1 rounded text-muted-foreground">
                          {id}
                        </span>
                        <span className="font-medium text-primary">{criteria.name}</span>
                      </div>
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-medium ${
                          criteria.complianceStatus === "compliant"
                            ? "bg-green-500/20 text-green-400"
                            : criteria.complianceStatus === "review_needed"
                            ? "bg-yellow-500/20 text-yellow-400"
                            : "bg-background border border-border text-muted-foreground"
                        }`}
                      >
                        {criteria.complianceStatus === "compliant"
                          ? "Compliant"
                          : criteria.complianceStatus === "review_needed"
                          ? "Review Needed"
                          : "No Data"}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">{criteria.description}</p>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-primary">
                        <strong>{criteria.totalEvents}</strong> events recorded
                      </span>
                      {criteria.events.length > 0 && (
                        <span className="text-muted-foreground">
                          {criteria.events.map((e) => e.action).join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* AI Transparency Tab */}
        {activeTab === "ai" && aiTransparency && (
          <div className="space-y-6">
            {/* AI Usage Summary */}
            <div className="bg-surface border border-border rounded-xl p-6">
              <h3 className="text-lg font-semibold text-primary mb-4 flex items-center gap-2">
                <Activity className="h-5 w-5 text-accent" />
                AI Usage Summary
              </h3>
              <div className="grid grid-cols-3 gap-6">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Total AI Tasks</p>
                  <p className="text-3xl font-bold text-primary">
                    {aiTransparency.aiUsageSummary.totalTasks.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Default Model</p>
                  <p className="text-lg font-medium text-primary font-mono">
                    {aiTransparency.aiUsageSummary.defaultModel}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Default Persona</p>
                  <p className="text-lg font-medium text-primary">
                    {aiTransparency.aiUsageSummary.defaultPersona.replace(/_/g, " ")}
                  </p>
                </div>
              </div>
            </div>

            {/* Human Oversight */}
            <div className="bg-surface border border-border rounded-xl p-6">
              <h3 className="text-lg font-semibold text-primary mb-4 flex items-center gap-2">
                <Eye className="h-5 w-5 text-accent" />
                Human Oversight Controls
              </h3>
              <div className="grid grid-cols-3 gap-4">
                {[
                  {
                    label: "PR Review Required",
                    enabled: aiTransparency.humanOversight.prReviewRequired,
                    description: "All AI changes require human code review",
                  },
                  {
                    label: "Manager Review",
                    enabled: aiTransparency.humanOversight.managerReviewEnabled,
                    description: "Manager approval before task execution",
                  },
                  {
                    label: "Quality Gates",
                    enabled: aiTransparency.humanOversight.qualityGatesEnabled,
                    description: "Automated quality checks on AI output",
                  },
                ].map((control) => (
                  <div
                    key={control.label}
                    className={`p-4 rounded-lg border transition-all ${
                      control.enabled
                        ? "bg-green-500/10 border-green-500/30"
                        : "bg-background border-border"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {control.enabled ? (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-muted-foreground" />
                      )}
                      <span className="font-medium text-primary">{control.label}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">{control.description}</p>
                    <span
                      className={`text-xs font-medium ${
                        control.enabled ? "text-green-400" : "text-muted-foreground"
                      }`}
                    >
                      {control.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Transparency Commitments */}
            <div className="bg-surface border border-border rounded-xl p-6">
              <h3 className="text-lg font-semibold text-primary mb-4 flex items-center gap-2">
                <Shield className="h-5 w-5 text-accent" />
                Transparency Commitments
              </h3>
              <ul className="space-y-3">
                {aiTransparency.transparencyCommitments.map((commitment, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <div className="p-1 rounded-full bg-green-500/20 mt-0.5">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    </div>
                    <span className="text-primary">{commitment}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Cost Summary */}
            <div className="bg-surface border border-border rounded-xl p-6">
              <h3 className="text-lg font-semibold text-primary mb-4 flex items-center gap-2">
                <Database className="h-5 w-5 text-accent" />
                Cost Transparency
              </h3>
              <div className="grid grid-cols-3 gap-6">
                <div className="p-4 bg-background rounded-lg border border-border">
                  <p className="text-sm text-muted-foreground mb-1">Total AI Cost</p>
                  <p className="text-2xl font-bold text-primary">
                    ${aiTransparency.costSummary.totalCost.toFixed(2)}
                  </p>
                </div>
                <div className="p-4 bg-background rounded-lg border border-border">
                  <p className="text-sm text-muted-foreground mb-1">Avg Cost per Task</p>
                  <p className="text-2xl font-bold text-primary">
                    ${aiTransparency.costSummary.averageCostPerTask.toFixed(2)}
                  </p>
                </div>
                <div className="p-4 bg-background rounded-lg border border-border">
                  <p className="text-sm text-muted-foreground mb-1">Max Task Cost</p>
                  <p className="text-2xl font-bold text-primary">
                    ${aiTransparency.costSummary.maxTaskCost.toFixed(2)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Data Residency Tab */}
        {activeTab === "data" && dataResidency && (
          <div className="space-y-6">
            {/* Current Configuration */}
            <div className="bg-surface border border-border rounded-xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-accent/10">
                  <Globe className="h-6 w-6 text-accent" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-primary">Data Residency Configuration</h3>
                  <p className="text-sm text-muted-foreground">Where your data is stored and processed</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="p-4 bg-background rounded-lg border border-border">
                  <p className="text-sm text-muted-foreground mb-1">Current Region</p>
                  <p className="text-xl font-semibold text-primary">
                    {dataResidency.current.regionInfo.name}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {dataResidency.current.regionInfo.country} ({dataResidency.current.region})
                  </p>
                </div>
                <div className="p-4 bg-background rounded-lg border border-border">
                  <p className="text-sm text-muted-foreground mb-1">Residency Mode</p>
                  <p className="text-xl font-semibold text-primary capitalize">
                    {dataResidency.current.residencyMode.replace("_", " ")}
                  </p>
                </div>
              </div>
            </div>

            {/* Compliance Status */}
            <div className="bg-surface border border-border rounded-xl p-6">
              <h3 className="text-lg font-semibold text-primary mb-4 flex items-center gap-2">
                <Server className="h-5 w-5 text-accent" />
                Compliance Status
              </h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-background rounded-lg border border-border">
                  <div className="flex items-center gap-3">
                    {dataResidency.complianceStatus.gdprCompliant ? (
                      <div className="p-2 rounded-lg bg-green-500/10">
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      </div>
                    ) : (
                      <div className="p-2 rounded-lg bg-yellow-500/10">
                        <AlertTriangle className="h-5 w-5 text-yellow-500" />
                      </div>
                    )}
                    <div>
                      <span className="font-medium text-primary">GDPR-Compliant Region</span>
                      <p className="text-sm text-muted-foreground">Data stored in EU-approved location</p>
                    </div>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-medium ${
                      dataResidency.complianceStatus.gdprCompliant
                        ? "bg-green-500/20 text-green-400"
                        : "bg-yellow-500/20 text-yellow-400"
                    }`}
                  >
                    {dataResidency.complianceStatus.gdprCompliant ? "Yes" : "No"}
                  </span>
                </div>

                <div className="flex items-center justify-between p-4 bg-background rounded-lg border border-border">
                  <div className="flex items-center gap-3">
                    {!dataResidency.complianceStatus.crossBorderTransfers ? (
                      <div className="p-2 rounded-lg bg-green-500/10">
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      </div>
                    ) : (
                      <div className="p-2 rounded-lg bg-yellow-500/10">
                        <AlertTriangle className="h-5 w-5 text-yellow-500" />
                      </div>
                    )}
                    <div>
                      <span className="font-medium text-primary">Cross-Border Transfers</span>
                      <p className="text-sm text-muted-foreground">Data transfer across national boundaries</p>
                    </div>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-medium ${
                      !dataResidency.complianceStatus.crossBorderTransfers
                        ? "bg-green-500/20 text-green-400"
                        : "bg-yellow-500/20 text-yellow-400"
                    }`}
                  >
                    {dataResidency.complianceStatus.crossBorderTransfers ? "Allowed" : "Restricted"}
                  </span>
                </div>

                {dataResidency.complianceStatus.dataLocalizedTo && (
                  <div className="flex items-center justify-between p-4 bg-background rounded-lg border border-border">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-accent/10">
                        <Key className="h-5 w-5 text-accent" />
                      </div>
                      <div>
                        <span className="font-medium text-primary">Data Localized To</span>
                        <p className="text-sm text-muted-foreground">Data confined to specific jurisdiction</p>
                      </div>
                    </div>
                    <span className="px-3 py-1 bg-accent/20 text-accent rounded-full text-xs font-medium">
                      {dataResidency.complianceStatus.dataLocalizedTo}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Link to Settings */}
            <div className="bg-accent/10 border border-accent/30 rounded-xl p-4">
              <div className="flex items-center gap-4">
                <div className="p-2 rounded-lg bg-accent/20">
                  <ExternalLink className="h-5 w-5 text-accent" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-primary">Update Data Residency Settings</p>
                  <p className="text-sm text-muted-foreground">
                    Visit Settings to change your data region and residency mode.
                  </p>
                </div>
                <Link
                  to="/settings"
                  className="px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors"
                >
                  Go to Settings
                </Link>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

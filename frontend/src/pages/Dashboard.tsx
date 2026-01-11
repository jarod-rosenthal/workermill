import { useState, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  RefreshCw,
  ExternalLink,
  CheckCircle,
  XCircle,
  Clock,
  Cpu,
  DollarSign,
  AlertCircle,
  Activity,
  Terminal,
  GitBranch,
  LogOut,
  Play,
  Power,
  PowerOff,
  Shield,
  Trash2,
  Ban,
  Zap,
  Book,
  Settings,
} from "lucide-react";
import { useAuthStore } from "../store/auth-store";

interface ControlCenterStats {
  totalWorkers: number;
  activeWorkers: number;
  queueDepth: number;
  periodCost: number;
  periodCompleted: number;
  periodFailed: number;
  cumulativeCost: number;
  countersResetAt: string | null;
}

interface WorkerTask {
  id: string;
  jiraKey: string;
  summary: string;
  status: string;
  retryCount: number;
  maxRetries: number;
}

interface Worker {
  id: string;
  displayName: string;
  persona: string;
  status: string;
  tasksCompleted: number;
  tasksFailed: number;
  totalCostUsd: number;
  currentTask: WorkerTask | null;
}

interface TaskStep {
  name: string;
  status: "done" | "active" | "pending";
}

interface TaskLog {
  timestamp: string;
  message: string;
  type: string;
  severity: string;
}

interface ActiveTask {
  id: string;
  jiraIssueKey: string;
  summary: string;
  status: string;
  workerName: string;
  workerPersona: string;
  workerModel?: string;
  retryCount: number;
  maxRetries: number;
  estimatedCostUsd: number;
  startedAt: string | null;
  createdAt: string;
  hasPr?: boolean;
  githubPrUrl?: string | null;
  githubRepo?: string;
  recentLogs: TaskLog[];
  steps: TaskStep[];
}

interface CompletedTask {
  id: string;
  jiraIssueKey: string;
  summary: string;
  status: string;
  workerModel?: string;
  costUsd: number;
  durationMinutes: number | null;
  completedAt: string;
  githubPrUrl: string | null;
}

interface ManagerStatus {
  enabled: boolean;
  modelId: string;
  reviewCount: number;
  approvalRate: number;
  queue: {
    awaitingReview: number;
    underReview: number;
    revisionNeeded: number;
  };
  stats?: {
    totalReviews: number;
    approved: number;
    rejected: number;
    revisionsRequested: number;
    avgDurationSeconds: number;
    totalCost: number;
  };
}

interface WatcherStatus {
  enabled: boolean;
  lastRunAt: string | null;
  stuckTasks: number;
  pendingRetries: number;
}

interface SystemStatus {
  systemEnabled: boolean;
  orchestrator: { running: boolean; desiredCount: number };
  executors: { running: number };
}

interface ControlCenterData {
  stats: ControlCenterStats;
  workers: Worker[];
  activeTasks: ActiveTask[];
  queuedTasks: ActiveTask[];
  recentCompleted: CompletedTask[];
  managerStatus?: ManagerStatus;
  systemStatus?: SystemStatus;
  watcherStatus?: WatcherStatus;
}

const API_BASE = import.meta.env.VITE_API_URL || "";

// Full Claude model options with exact version names
const MODEL_OPTIONS = [
  { value: "claude-opus-4-5-20251101", label: "Claude Opus 4.5", shortLabel: "Opus 4.5" },
  { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", shortLabel: "Sonnet 4" },
  { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet", shortLabel: "3.5 Sonnet" },
  { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku", shortLabel: "3.5 Haiku" },
  { value: "claude-haiku-4-20250414", label: "Claude Haiku 4", shortLabel: "Haiku 4" },
];

// Persona definitions with full details
const PERSONA_CONFIG: Record<
  string,
  { emoji: string; title: string; description: string; skills: string[] }
> = {
  frontend_developer: {
    emoji: "🎨",
    title: "Frontend Developer",
    description: "UI/UX implementation, React components, styling",
    skills: ["React", "TypeScript", "Tailwind CSS", "Accessibility"],
  },
  backend_developer: {
    emoji: "⚙️",
    title: "Backend Developer",
    description: "API development, database design, server logic",
    skills: ["Node.js", "Express", "PostgreSQL", "REST APIs"],
  },
  devops_engineer: {
    emoji: "🔧",
    title: "DevOps Engineer",
    description: "Infrastructure, CI/CD, deployment automation",
    skills: ["Terraform", "AWS", "Docker", "GitHub Actions"],
  },
  security_engineer: {
    emoji: "🔒",
    title: "Security Engineer",
    description: "Security audits, vulnerability fixes, compliance",
    skills: ["OWASP", "Penetration Testing", "IAM", "Encryption"],
  },
  qa_engineer: {
    emoji: "🧪",
    title: "QA Engineer",
    description: "Test writing, quality assurance, bug verification",
    skills: ["Jest", "Playwright", "Test Design", "Bug Triage"],
  },
  tech_writer: {
    emoji: "📝",
    title: "Technical Writer",
    description: "Documentation, API docs, user guides",
    skills: ["Markdown", "API Documentation", "User Guides"],
  },
  project_manager: {
    emoji: "📋",
    title: "Project Manager",
    description: "Task planning, coordination, status updates",
    skills: ["Jira", "Project Planning", "Stakeholder Management"],
  },
  manager: {
    emoji: "👔",
    title: "Virtual Manager",
    description: "Reviews PRs from workers, provides feedback, approves or requests revisions",
    skills: ["Code Review", "Quality Assurance", "Feedback", "Approval Workflow"],
  },
};

function formatCost(cost: number | string | undefined | null): string {
  if (cost === undefined || cost === null) return "0.00";
  return Number(cost).toFixed(2);
}

function formatModelName(modelId: string | undefined | null): string {
  if (!modelId) return "Sonnet 4";
  const option = MODEL_OPTIONS.find((m) => m.value === modelId);
  if (option) return option.shortLabel;
  // Fallback parsing
  const lower = modelId.toLowerCase();
  if (lower.includes("opus") && lower.includes("4-5")) return "Opus 4.5";
  if (lower.includes("opus")) return "Opus";
  if (lower.includes("haiku") && lower.includes("3-5")) return "Haiku 3.5";
  if (lower.includes("haiku")) return "Haiku 4";
  if (lower.includes("sonnet") && lower.includes("3-5")) return "Sonnet 3.5";
  if (lower.includes("sonnet")) return "Sonnet 4";
  return modelId;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const logout = useAuthStore((state) => state.logout);
  const user = useAuthStore((state) => state.user);

  const [data, setData] = useState<ControlCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [expandedTerminals, setExpandedTerminals] = useState<Set<string>>(
    new Set()
  );

  // System status
  const [systemEnabled, setSystemEnabled] = useState(true);
  const [systemToggleLoading, setSystemToggleLoading] = useState(false);
  const [watcherEnabled, setWatcherEnabled] = useState(false);
  const [watcherToggleLoading, setWatcherToggleLoading] = useState(false);
  const [orchestratorRunning, setOrchestratorRunning] = useState(false);
  const [orchestratorToggleLoading, setOrchestratorToggleLoading] = useState(false);

  // Manager settings
  const [managerModel, setManagerModel] = useState("claude-sonnet-4-20250514");
  const [managerModelLoading, setManagerModelLoading] = useState(false);

  // Action states
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resetCountersLoading, setResetCountersLoading] = useState(false);

  // Action buttons state
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  const [createTaskForm, setCreateTaskForm] = useState({
    jiraIssueKey: "",
    workerPersona: "backend_developer",
    workerModel: "claude-sonnet-4-20250514",
  });
  const [createLoading, setCreateLoading] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/control-center`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        if (response.status === 401) {
          logout();
          navigate("/login");
          return;
        }
        throw new Error("Failed to fetch data");
      }
      const result = await response.json();
      setData(result);
      setLastUpdated(new Date());
      setError(null);

      // Update local state from API response
      if (result.systemStatus) {
        setSystemEnabled(result.systemStatus.systemEnabled);
        setOrchestratorRunning(result.systemStatus.orchestrator?.running || false);
      }
      if (result.watcherStatus) {
        setWatcherEnabled(result.watcherStatus.enabled);
      }
      if (result.managerStatus?.modelId) {
        setManagerModel(result.managerStatus.modelId);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to load data";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [logout, navigate]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const toggleSystem = async () => {
    setSystemToggleLoading(true);
    try {
      const token = localStorage.getItem("accessToken");
      const endpoint = systemEnabled ? "disable" : "enable";
      const response = await fetch(`${API_BASE}/api/system/${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        setSystemEnabled(!systemEnabled);
      }
    } catch (err) {
      console.error("Failed to toggle system:", err);
    } finally {
      setSystemToggleLoading(false);
    }
  };

  const toggleWatcher = async () => {
    setWatcherToggleLoading(true);
    try {
      const token = localStorage.getItem("accessToken");
      const endpoint = watcherEnabled ? "disable" : "enable";
      const response = await fetch(`${API_BASE}/api/watcher/${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        setWatcherEnabled(!watcherEnabled);
        setActionSuccess(`Watcher ${endpoint}d successfully`);
        setTimeout(() => setActionSuccess(null), 3000);
      }
    } catch (err) {
      console.error("Failed to toggle watcher:", err);
    } finally {
      setWatcherToggleLoading(false);
    }
  };

  const toggleOrchestrator = async () => {
    setOrchestratorToggleLoading(true);
    try {
      const token = localStorage.getItem("accessToken");
      const endpoint = orchestratorRunning ? "stop" : "start";
      const response = await fetch(`${API_BASE}/api/orchestrator/${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        setOrchestratorRunning(!orchestratorRunning);
        setActionSuccess(`Orchestrator ${endpoint}ed successfully`);
        setTimeout(() => setActionSuccess(null), 3000);
      }
    } catch (err) {
      console.error("Failed to toggle orchestrator:", err);
    } finally {
      setOrchestratorToggleLoading(false);
    }
  };

  const handleManagerModelChange = async (modelId: string) => {
    setManagerModelLoading(true);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/manager/model`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ modelId }),
      });
      if (response.ok) {
        setManagerModel(modelId);
        setActionSuccess(`Manager model changed to ${formatModelName(modelId)}`);
        setTimeout(() => setActionSuccess(null), 3000);
      }
    } catch (err) {
      console.error("Failed to change manager model:", err);
    } finally {
      setManagerModelLoading(false);
    }
  };

  const handleResetCounters = async () => {
    if (!confirm("Reset all counters? This will start tracking from now. Historical data will not be deleted.")) {
      return;
    }
    setResetCountersLoading(true);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/control-center/reset-counters`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        setActionSuccess("All counters have been reset");
        setTimeout(() => setActionSuccess(null), 3000);
        fetchData();
      } else {
        const err = await response.json();
        setActionError(err.error || "Failed to reset counters");
        setTimeout(() => setActionError(null), 5000);
      }
    } catch (err) {
      setActionError("Failed to reset counters");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setResetCountersLoading(false);
    }
  };

  const handleCancelTask = async (taskId: string) => {
    setActionLoading(taskId);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/tasks/${taskId}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        setActionSuccess("Task cancelled successfully");
        setTimeout(() => setActionSuccess(null), 3000);
        fetchData();
      } else {
        const err = await response.json();
        setActionError(err.error || "Failed to cancel task");
        setTimeout(() => setActionError(null), 5000);
      }
    } catch (err) {
      setActionError("Failed to cancel task");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm("Delete this task from history? This cannot be undone.")) {
      return;
    }
    setActionLoading(taskId);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/tasks/${taskId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        setActionSuccess("Task deleted successfully");
        setTimeout(() => setActionSuccess(null), 3000);
        fetchData();
      } else {
        const err = await response.json();
        setActionError(err.error || "Failed to delete task");
        setTimeout(() => setActionError(null), 5000);
      }
    } catch (err) {
      setActionError("Failed to delete task");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateTask = async () => {
    setCreateLoading(true);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/tasks`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(createTaskForm),
      });
      if (response.ok) {
        setActionSuccess("Task created successfully");
        setTimeout(() => setActionSuccess(null), 3000);
        setShowCreateTaskModal(false);
        setCreateTaskForm({ jiraIssueKey: "", workerPersona: "backend_developer", workerModel: "claude-sonnet-4-20250514" });
        fetchData();
      } else {
        const err = await response.json();
        setActionError(err.error || "Failed to create task");
        setTimeout(() => setActionError(null), 5000);
      }
    } catch (err) {
      setActionError("Failed to create task");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setCreateLoading(false);
    }
  };

  const toggleTerminal = (taskId: string) => {
    setExpandedTerminals((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(taskId)) {
        newSet.delete(taskId);
      } else {
        newSet.add(taskId);
      }
      return newSet;
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "text-green-500";
      case "executing":
        return "text-blue-500";
      case "queued":
      case "claimed":
      case "environment_setup":
        return "text-yellow-500";
      case "failed":
        return "text-red-500";
      case "blocked":
        return "text-orange-500";
      case "cancelled":
        return "text-gray-500";
      default:
        return "text-muted-foreground";
    }
  };

  const getPersonaInfo = (persona: string) => {
    return (
      PERSONA_CONFIG[persona] || {
        emoji: "🤖",
        title: persona,
        description: "AI Worker",
        skills: [],
      }
    );
  };

  const formatRelativeTime = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <AlertCircle className="w-12 h-12 text-red-500" />
        <p className="text-lg text-red-500">{error}</p>
        <button
          onClick={fetchData}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              WorkerMill
            </h1>
            <p className="text-sm text-muted-foreground">
              AI Workers Control Center
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* System On/Off Toggle */}
            <button
              onClick={toggleSystem}
              disabled={systemToggleLoading}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                systemEnabled
                  ? "bg-green-500/10 text-green-500 border border-green-500/30 hover:bg-green-500/20"
                  : "bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20"
              } ${systemToggleLoading ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {systemToggleLoading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : systemEnabled ? (
                <Power className="w-4 h-4" />
              ) : (
                <PowerOff className="w-4 h-4" />
              )}
              {systemEnabled ? "System ON" : "System OFF"}
            </button>

            {/* Run Task Button */}
            <button
              onClick={() => setShowCreateTaskModal(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Play className="w-4 h-4" />
              Run Task
            </button>

            {/* Docs Link */}
            <Link
              to="/docs"
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Documentation"
            >
              <Book className="w-4 h-4" />
              Docs
            </Link>

            {/* Setup Link */}
            <Link
              to="/setup"
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Setup"
            >
              <Settings className="w-4 h-4" />
              Setup
            </Link>

            <button
              onClick={fetchData}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-5 h-5 text-muted-foreground" />
            </button>
            {lastUpdated && (
              <span className="text-xs text-muted-foreground">
                Updated {formatRelativeTime(lastUpdated.toISOString())}
              </span>
            )}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{user?.email}</span>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Success/Error Alerts */}
      {actionSuccess && (
        <div className="max-w-7xl mx-auto px-6 pt-4">
          <div className="bg-green-500/10 border border-green-500/30 text-green-500 px-4 py-3 rounded-lg flex items-center justify-between">
            {actionSuccess}
            <button onClick={() => setActionSuccess(null)} className="font-bold">&times;</button>
          </div>
        </div>
      )}
      {actionError && (
        <div className="max-w-7xl mx-auto px-6 pt-4">
          <div className="bg-red-500/10 border border-red-500/30 text-red-500 px-4 py-3 rounded-lg flex items-center justify-between">
            {actionError}
            <button onClick={() => setActionError(null)} className="font-bold">&times;</button>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Stats Grid */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">
                Stats since {data?.stats.countersResetAt ? formatRelativeTime(data.stats.countersResetAt) : "beginning"}
              </span>
            </div>
            <button
              onClick={handleResetCounters}
              disabled={resetCountersLoading}
              className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-muted hover:bg-muted/80 text-muted-foreground transition-colors disabled:opacity-50"
            >
              {resetCountersLoading ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
              Reset Counters
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <div>
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <Cpu className="w-4 h-4" />
                <span className="text-xs">Workers</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {data?.stats.activeWorkers || 0}
                <span className="text-sm text-muted-foreground font-normal">
                  /{data?.stats.totalWorkers || 0}
                </span>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <Activity className="w-4 h-4" />
                <span className="text-xs">Queue</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {data?.stats.queueDepth || 0}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span className="text-xs">Completed</span>
              </div>
              <div className="text-2xl font-bold text-green-500">
                {data?.stats.periodCompleted || 0}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <XCircle className="w-4 h-4 text-red-500" />
                <span className="text-xs">Failed</span>
              </div>
              <div className="text-2xl font-bold text-red-500">
                {data?.stats.periodFailed || 0}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <DollarSign className="w-4 h-4 text-accent" />
                <span className="text-xs">Period Cost</span>
              </div>
              <div className="text-2xl font-bold text-accent">
                ${formatCost(data?.stats.periodCost)}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <DollarSign className="w-4 h-4" />
                <span className="text-xs">Cumulative</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                ${formatCost(data?.stats.cumulativeCost)}
              </div>
            </div>
          </div>
        </div>

        {/* Virtual Manager Card with Controls */}
        <div className="bg-card border border-border rounded-xl p-4">
          {/* Header Row */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-xl">👔</span>
              <h3 className="font-semibold">Virtual Manager</h3>
              <span className="px-2 py-0.5 text-xs font-medium rounded bg-indigo-500/10 text-indigo-500">
                Active
              </span>

              {/* Watcher toggle */}
              <button
                onClick={toggleWatcher}
                disabled={watcherToggleLoading}
                className={`flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded transition-all cursor-pointer hover:opacity-80 ${
                  watcherEnabled
                    ? "bg-green-500/10 text-green-500 border border-green-500/30"
                    : "bg-gray-500/10 text-gray-500 border border-gray-500/30"
                } ${watcherToggleLoading ? "opacity-50" : ""}`}
                title={`Click to ${watcherEnabled ? "disable" : "enable"} watcher`}
              >
                {watcherToggleLoading ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <Shield className="w-3 h-3" />
                )}
                Watcher {watcherEnabled ? "Active" : "Off"}
              </button>

              {/* Orchestrator toggle */}
              <button
                onClick={toggleOrchestrator}
                disabled={orchestratorToggleLoading}
                className={`flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded transition-all cursor-pointer hover:opacity-80 ${
                  orchestratorRunning
                    ? "bg-blue-500/10 text-blue-500 border border-blue-500/30"
                    : "bg-gray-500/10 text-gray-500 border border-gray-500/30"
                } ${orchestratorToggleLoading ? "opacity-50" : ""}`}
                title={`Click to ${orchestratorRunning ? "stop" : "start"} orchestrator`}
              >
                {orchestratorToggleLoading ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <Zap className="w-3 h-3" />
                )}
                Orchestrator {orchestratorRunning ? "Running" : "Off"}
              </button>
            </div>

            {/* Model selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Model:</span>
              <select
                className="text-xs bg-muted border border-border rounded px-2 py-1 text-foreground"
                value={managerModel}
                onChange={(e) => handleManagerModelChange(e.target.value)}
                disabled={managerModelLoading}
              >
                {MODEL_OPTIONS.map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
              </select>
              {managerModelLoading && (
                <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>

          {/* Queue Stats */}
          <div className="grid grid-cols-3 gap-4 mb-4 pb-4 border-b border-border">
            <div>
              <div className="text-xs text-muted-foreground">Awaiting Review</div>
              <div className={`text-lg font-semibold ${(data?.managerStatus?.queue?.awaitingReview || 0) > 0 ? "text-purple-500" : ""}`}>
                {data?.managerStatus?.queue?.awaitingReview || 0}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Under Review</div>
              <div className={`text-lg font-semibold ${(data?.managerStatus?.queue?.underReview || 0) > 0 ? "text-indigo-500" : ""}`}>
                {data?.managerStatus?.queue?.underReview || 0}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Revision Needed</div>
              <div className={`text-lg font-semibold ${(data?.managerStatus?.queue?.revisionNeeded || 0) > 0 ? "text-orange-500" : ""}`}>
                {data?.managerStatus?.queue?.revisionNeeded || 0}
              </div>
            </div>
          </div>

          {/* Manager Stats (since reset) */}
          <div>
            <div className="text-xs text-muted-foreground mb-2">Manager Stats</div>
            <div className="grid grid-cols-6 gap-4">
              <div>
                <div className="text-xs text-muted-foreground">Reviews</div>
                <div className="text-lg font-semibold">
                  {data?.managerStatus?.stats?.totalReviews || 0}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Approved</div>
                <div className="text-lg font-semibold text-green-500">
                  {data?.managerStatus?.stats?.approved || 0}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Rejected</div>
                <div className="text-lg font-semibold text-red-500">
                  {data?.managerStatus?.stats?.rejected || 0}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Revisions</div>
                <div className="text-lg font-semibold text-orange-500">
                  {data?.managerStatus?.stats?.revisionsRequested || 0}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Avg Duration</div>
                <div className="text-lg font-semibold">
                  {(data?.managerStatus?.stats?.avgDurationSeconds || 0) > 0
                    ? `${Math.floor((data?.managerStatus?.stats?.avgDurationSeconds || 0) / 60)}m`
                    : "-"}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Manager Cost</div>
                <div className="text-lg font-semibold">
                  ${formatCost(data?.managerStatus?.stats?.totalCost)}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Active Tasks */}
          <div className="bg-card border border-border rounded-xl">
            <div className="p-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary" />
                Active Tasks
              </h2>
            </div>
            <div className="divide-y divide-border max-h-96 overflow-y-auto">
              {data?.activeTasks && data.activeTasks.length > 0 ? (
                data.activeTasks.map((task) => {
                  const personaInfo = getPersonaInfo(task.workerPersona);
                  return (
                    <div key={task.id} className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{personaInfo.emoji}</span>
                            <span className="font-medium text-foreground">
                              {task.jiraIssueKey}
                            </span>
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full border ${getStatusColor(
                                task.status
                              )} bg-current/10`}
                            >
                              {task.status}
                            </span>
                            {task.workerModel && (
                              <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                                {formatModelName(task.workerModel)}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground truncate max-w-md">
                            {task.summary}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-right text-xs text-muted-foreground">
                            <div>Retry {task.retryCount}/{task.maxRetries}</div>
                            <div>${formatCost(task.estimatedCostUsd)}</div>
                          </div>
                          {/* Cancel button */}
                          <button
                            onClick={() => handleCancelTask(task.id)}
                            disabled={actionLoading === task.id}
                            className="p-1.5 hover:bg-red-500/10 rounded text-red-500"
                            title="Cancel Task"
                          >
                            {actionLoading === task.id ? (
                              <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                              <Ban className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Progress steps */}
                      <div className="flex items-center gap-1 mt-2">
                        {task.steps.map((step, idx) => (
                          <div
                            key={idx}
                            className={`h-1 flex-1 rounded-full ${
                              step.status === "done"
                                ? "bg-green-500"
                                : step.status === "active"
                                ? "bg-primary animate-pulse"
                                : "bg-muted"
                            }`}
                            title={step.name}
                          />
                        ))}
                      </div>

                      {/* Terminal toggle */}
                      <button
                        onClick={() => toggleTerminal(task.id)}
                        className="flex items-center gap-1 mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Terminal className="w-3 h-3" />
                        {expandedTerminals.has(task.id) ? "Hide" : "Show"} logs
                      </button>

                      {/* Terminal logs */}
                      {expandedTerminals.has(task.id) && (
                        <div className="mt-2 bg-black/50 rounded-lg p-3 font-mono text-xs max-h-40 overflow-y-auto">
                          {task.recentLogs && task.recentLogs.length > 0 ? (
                            task.recentLogs.map((log, idx) => (
                              <div
                                key={idx}
                                className={`${
                                  log.severity === "error"
                                    ? "text-red-400"
                                    : log.severity === "warning"
                                    ? "text-yellow-400"
                                    : "text-green-400"
                                }`}
                              >
                                <span className="text-muted-foreground">
                                  [{new Date(log.timestamp).toLocaleTimeString()}]
                                </span>{" "}
                                {log.message}
                              </div>
                            ))
                          ) : (
                            <div className="text-muted-foreground">
                              No logs available
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="p-8 text-center text-muted-foreground">
                  <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No active tasks</p>
                </div>
              )}
            </div>
          </div>

          {/* Task Queue */}
          <div className="bg-card border border-border rounded-xl">
            <div className="p-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Clock className="w-5 h-5 text-yellow-500" />
                Task Queue
                {data?.queuedTasks && data.queuedTasks.length > 0 && (
                  <span className="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-yellow-500/10 text-yellow-500">
                    {data.queuedTasks.length}
                  </span>
                )}
              </h2>
            </div>
            <div className="divide-y divide-border max-h-96 overflow-y-auto">
              {data?.queuedTasks && data.queuedTasks.length > 0 ? (
                data.queuedTasks.map((task) => {
                  const personaInfo = getPersonaInfo(task.workerPersona);
                  return (
                    <div key={task.id} className="p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{personaInfo.emoji}</span>
                            <span className="font-medium text-foreground">
                              {task.jiraIssueKey}
                            </span>
                            <span className="text-xs px-2 py-0.5 rounded-full border text-yellow-500 bg-yellow-500/10">
                              queued
                            </span>
                            {task.workerModel && (
                              <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                                {formatModelName(task.workerModel)}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground truncate max-w-md">
                            {task.summary}
                          </p>
                          <div className="text-xs text-muted-foreground mt-1">
                            Queued {formatRelativeTime(task.createdAt)}
                            {task.githubRepo && (
                              <span className="ml-2">
                                <GitBranch className="w-3 h-3 inline" /> {task.githubRepo}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {/* Cancel button */}
                          <button
                            onClick={() => handleCancelTask(task.id)}
                            disabled={actionLoading === task.id}
                            className="p-1.5 hover:bg-red-500/10 rounded text-red-500"
                            title="Cancel Task"
                          >
                            {actionLoading === task.id ? (
                              <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                              <Ban className="w-4 h-4" />
                            )}
                          </button>
                          {/* Delete button */}
                          <button
                            onClick={() => handleDeleteTask(task.id)}
                            disabled={actionLoading === task.id}
                            className="p-1.5 hover:bg-red-500/10 rounded text-red-500"
                            title="Delete Task"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-8 text-center text-muted-foreground">
                  <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No tasks in queue</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Recent Completed */}
        <div className="bg-card border border-border rounded-xl">
          <div className="p-4 border-b border-border">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              Recently Completed
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="text-left p-3">Task</th>
                  <th className="text-left p-3">Model</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">Duration</th>
                  <th className="text-left p-3">Cost</th>
                  <th className="text-left p-3">Completed</th>
                  <th className="text-left p-3">PR</th>
                  <th className="text-left p-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data?.recentCompleted && data.recentCompleted.length > 0 ? (
                  data.recentCompleted.map((task) => (
                    <tr key={task.id} className="hover:bg-muted/30">
                      <td className="p-3">
                        <div className="font-medium text-foreground">
                          {task.jiraIssueKey}
                        </div>
                        <div className="text-xs text-muted-foreground truncate max-w-xs">
                          {task.summary}
                        </div>
                      </td>
                      <td className="p-3">
                        <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                          {formatModelName(task.workerModel)}
                        </span>
                      </td>
                      <td className="p-3">
                        <span
                          className={`flex items-center gap-1 ${getStatusColor(
                            task.status
                          )}`}
                        >
                          {task.status === "completed" ? (
                            <CheckCircle className="w-4 h-4" />
                          ) : (
                            <XCircle className="w-4 h-4" />
                          )}
                          {task.status}
                        </span>
                      </td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {task.durationMinutes
                          ? `${task.durationMinutes}m`
                          : "-"}
                      </td>
                      <td className="p-3 text-sm font-medium">
                        ${formatCost(task.costUsd)}
                      </td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {formatRelativeTime(task.completedAt)}
                      </td>
                      <td className="p-3">
                        {task.githubPrUrl ? (
                          <a
                            href={task.githubPrUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-primary hover:underline"
                          >
                            <GitBranch className="w-4 h-4" />
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="p-3">
                        <button
                          onClick={() => handleDeleteTask(task.id)}
                          disabled={actionLoading === task.id}
                          className="p-1.5 hover:bg-red-500/10 rounded text-red-500"
                          title="Delete Task"
                        >
                          {actionLoading === task.id ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">
                      No completed tasks yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Create Task Modal */}
      {showCreateTaskModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-lg w-full max-w-md">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <Play className="w-4 h-4" />
                Run AI Task
              </h3>
              <button
                onClick={() => setShowCreateTaskModal(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Jira Issue Key
                </label>
                <input
                  type="text"
                  placeholder="e.g., PROJ-123"
                  value={createTaskForm.jiraIssueKey}
                  onChange={(e) =>
                    setCreateTaskForm((prev) => ({
                      ...prev,
                      jiraIssueKey: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Worker Persona
                </label>
                <select
                  value={createTaskForm.workerPersona}
                  onChange={(e) =>
                    setCreateTaskForm((prev) => ({
                      ...prev,
                      workerPersona: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {Object.entries(PERSONA_CONFIG)
                    .filter(([key]) => key !== "manager")
                    .map(([key, config]) => (
                      <option key={key} value={key}>
                        {config.emoji} {config.title}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Claude Model
                </label>
                <select
                  value={createTaskForm.workerModel}
                  onChange={(e) =>
                    setCreateTaskForm((prev) => ({
                      ...prev,
                      workerModel: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {MODEL_OPTIONS.map((model) => (
                    <option key={model.value} value={model.value}>
                      {model.label} ({model.value})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground mt-1">
                  Full model ID will be used: {createTaskForm.workerModel}
                </p>
              </div>
            </div>
            <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
              <button
                onClick={() => setShowCreateTaskModal(false)}
                className="px-4 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateTask}
                disabled={createLoading || !createTaskForm.jiraIssueKey}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {createLoading && (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                )}
                Run Task
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

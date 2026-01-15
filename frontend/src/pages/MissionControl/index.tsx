import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../store/auth-store";
import { TopBar } from "./TopBar";
import { LeftRail } from "./LeftRail";
import { MissionCenter } from "./MissionCenter";
import { RightRail } from "./RightRail";
import { BottomBar } from "./BottomBar";
import "./styles.css";

// Shared interfaces (same as Dashboard)
export interface ControlCenterStats {
  totalWorkers: number;
  activeWorkers: number;
  queueDepth: number;
  periodCost: number;
  periodCompleted: number;
  periodFailed: number;
  cumulativeCost: number;
  countersResetAt: string | null;
}

export interface TaskStep {
  name: string;
  status: "done" | "active" | "pending" | "waiting";
  icon: string;
}

export type WorkflowMode = "default" | "review" | "auto_deploy" | "manager" | "review_manager" | "deploy_manager";

export interface TaskLog {
  timestamp: string;
  message: string;
  type: string;
  severity: string;
}

export interface RalphProgressData {
  currentStory: number;
  totalStories: number;
  currentStoryDescription: string;
  completedStories?: number;
  status?: "planning" | "executing" | "completed" | "failed" | "unknown";
}

export interface ActiveTask {
  id: string;
  jiraIssueKey: string;
  summary: string;
  status: string;
  workerName: string;
  workerPersona: string;
  workerModel?: string;
  workerProvider?: string;
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
  workflowMode?: WorkflowMode;
  workflowModeName?: string;
  managerEnabled?: boolean;
  revisionCount?: number;
  reviewFeedback?: string;
  managerEcsTaskId?: string | null;
  isRalphTask?: boolean;
  ralphProgress?: RalphProgressData | null;
  hasCheckpoint?: boolean;
  checkpointStage?: string | null;
  resumeCount?: number;
  checkpointSavedAt?: string | null;
}

export interface CompletedTask {
  id: string;
  jiraIssueKey: string;
  summary: string;
  status: string;
  workerModel?: string;
  workerPersona?: string;
  workerProvider?: string;
  costUsd: number;
  durationMinutes: number | null;
  createdAt: string;
  completedAt: string;
  githubPrUrl: string | null;
  ecsTaskId: string | null;
  retryCount?: number;
  errorMessage?: string;
  workflowMode?: WorkflowMode;
  workflowModeName?: string;
  managerEnabled?: boolean;
}

export interface ManagerStatus {
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

export interface WatcherStatus {
  enabled: boolean;
  lastRunAt: string | null;
  stuckTasks: number;
  pendingRetries: number;
}

export interface SystemStatus {
  systemEnabled: boolean;
  orchestrator: { running: boolean; desiredCount: number };
  executors: { running: number };
}

export interface ControlCenterData {
  stats: ControlCenterStats;
  workers: any[];
  activeTasks: ActiveTask[];
  queuedTasks: ActiveTask[];
  recentCompleted: CompletedTask[];
  managerStatus?: ManagerStatus;
  systemStatus?: SystemStatus;
  watcherStatus?: WatcherStatus;
}

export interface Alert {
  id: string;
  type: "error" | "warning" | "info";
  title: string;
  message: string;
  timestamp: Date;
  dismissed: boolean;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  unlockedAt?: Date;
}

// Achievement definitions
export const ACHIEVEMENTS: Achievement[] = [
  { id: "first-task", title: "First Launch", description: "Complete your first task", icon: "🚀" },
  { id: "ten-tasks", title: "Getting Started", description: "Complete 10 tasks", icon: "⭐" },
  { id: "zero-failures", title: "Perfect Day", description: "No failures today", icon: "🎯" },
  { id: "cost-saver", title: "Budget Hero", description: "Under budget this week", icon: "💰" },
  { id: "speed-demon", title: "Speed Demon", description: "Task completed 50% faster", icon: "⚡" },
  { id: "streak-3", title: "On a Roll", description: "3 successful tasks in a row", icon: "🔥" },
];

const API_BASE = import.meta.env.VITE_API_URL || "";

export default function MissionControl() {
  const navigate = useNavigate();
  const logout = useAuthStore((state) => state.logout);

  // Core data state
  const [data, setData] = useState<ControlCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // System control state
  const [systemEnabled, setSystemEnabled] = useState(true);
  const [orchestratorRunning, setOrchestratorRunning] = useState(false);
  const [watcherEnabled, setWatcherEnabled] = useState(false);
  const [managerEnabled, setManagerEnabled] = useState(false);
  const [managerModel, setManagerModel] = useState("claude-sonnet-4-5-20250929");

  // SSE connection state
  const [sseConnected, setSseConnected] = useState(false);

  // UI state
  const [leftRailCollapsed, setLeftRailCollapsed] = useState(false);
  const [rightRailCollapsed, setRightRailCollapsed] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const stored = localStorage.getItem("missionControl.soundEnabled");
    return stored ? JSON.parse(stored) : false;
  });

  // Alerts state (derived from task failures and cost thresholds)
  const [alerts, setAlerts] = useState<Alert[]>([]);

  // Achievements state (persisted in localStorage)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [unlockedAchievements, _setUnlockedAchievements] = useState<string[]>(() => {
    const stored = localStorage.getItem("missionControl.achievements");
    return stored ? JSON.parse(stored) : [];
  });

  // Daily stats (persisted in localStorage)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [dailyStats, _setDailyStats] = useState(() => {
    const stored = localStorage.getItem("missionControl.dailyStats");
    const today = new Date().toDateString();
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.date === today) {
        return parsed;
      }
    }
    return { date: today, completed: 0, failed: 0, cost: 0, streak: 0 };
  });

  // Persist sound preference
  useEffect(() => {
    localStorage.setItem("missionControl.soundEnabled", JSON.stringify(soundEnabled));
  }, [soundEnabled]);

  // Persist achievements
  useEffect(() => {
    localStorage.setItem("missionControl.achievements", JSON.stringify(unlockedAchievements));
  }, [unlockedAchievements]);

  // Persist daily stats
  useEffect(() => {
    localStorage.setItem("missionControl.dailyStats", JSON.stringify(dailyStats));
  }, [dailyStats]);

  // Fetch initial data
  const fetchData = useCallback(async () => {
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/control-center`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
        },
        cache: "no-store",
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
      if (result.managerStatus) {
        setManagerEnabled(result.managerStatus.enabled);
        if (result.managerStatus.modelId) {
          setManagerModel(result.managerStatus.modelId);
        }
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to load data";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [logout, navigate]);

  // SSE streaming for real-time updates
  useEffect(() => {
    fetchData();

    const token = localStorage.getItem("accessToken");
    if (!token) return;

    const eventSource = new EventSource(
      `${API_BASE}/api/control-center/stream?token=${encodeURIComponent(token)}`
    );

    eventSource.onopen = () => {
      setSseConnected(true);
      setError(null);
    };

    eventSource.onmessage = (event) => {
      try {
        const update = JSON.parse(event.data);

        if (update.type === "connected") {
          setSseConnected(true);
          return;
        }

        if (update.type === "update") {
          setLastUpdated(new Date());

          setData((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              stats: {
                ...prev.stats,
                ...update.stats,
              },
              activeTasks: update.activeTasks.map((task: any) => ({
                ...task,
                workerName: task.workerPersona,
                createdAt: task.startedAt || task.createdAt || new Date().toISOString(),
                recentLogs: [],
              })),
              queuedTasks: update.queuedTasks.map((task: any) => ({
                ...task,
                workerName: task.workerPersona,
                recentLogs: [],
              })),
              recentCompleted: update.recentCompleted,
            };
          });
        }
      } catch (err) {
        console.error("Failed to parse SSE message:", err);
      }
    };

    eventSource.onerror = () => {
      setSseConnected(false);
    };

    return () => {
      eventSource.close();
    };
  }, [fetchData]);

  // Generate alerts from data
  useEffect(() => {
    if (!data) return;

    const newAlerts: Alert[] = [];

    // Check for failed tasks
    const failedTasks = data.recentCompleted.filter(
      (t) => t.status === "failed" && new Date(t.completedAt) > new Date(Date.now() - 3600000)
    );
    failedTasks.forEach((task) => {
      newAlerts.push({
        id: `failed-${task.id}`,
        type: "error",
        title: "Task Failed",
        message: `${task.jiraIssueKey}: ${task.errorMessage || "Unknown error"}`,
        timestamp: new Date(task.completedAt),
        dismissed: false,
      });
    });

    // Check cost threshold (example: alert if period cost > $50)
    if (data.stats.periodCost > 50) {
      newAlerts.push({
        id: "cost-alert",
        type: "warning",
        title: "Cost Spike",
        message: `Period cost is $${data.stats.periodCost.toFixed(2)} - above threshold`,
        timestamp: new Date(),
        dismissed: false,
      });
    }

    setAlerts((prev) => {
      // Keep dismissed state for existing alerts
      const dismissedIds = new Set(prev.filter((a) => a.dismissed).map((a) => a.id));
      return newAlerts.map((a) => ({
        ...a,
        dismissed: dismissedIds.has(a.id),
      }));
    });
  }, [data]);

  // Derive system status
  const getSystemStatus = (): "nominal" | "attention" | "critical" => {
    if (!data) return "attention";
    if (alerts.some((a) => a.type === "error" && !a.dismissed)) return "critical";
    if (alerts.some((a) => a.type === "warning" && !a.dismissed)) return "attention";
    if (!sseConnected) return "attention";
    return "nominal";
  };

  // Handle alert dismissal
  const dismissAlert = (alertId: string) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === alertId ? { ...a, dismissed: true } : a))
    );
  };

  // Handle system toggle
  const toggleSystem = async () => {
    try {
      const token = localStorage.getItem("accessToken");
      const endpoint = systemEnabled ? "disable" : "enable";
      await fetch(`${API_BASE}/api/orchestrator/${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      setSystemEnabled(!systemEnabled);
    } catch (err) {
      console.error("Failed to toggle system:", err);
    }
  };

  // Handle orchestrator toggle
  const toggleOrchestrator = async () => {
    try {
      const token = localStorage.getItem("accessToken");
      const endpoint = orchestratorRunning ? "stop" : "start";
      await fetch(`${API_BASE}/api/orchestrator/${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      setOrchestratorRunning(!orchestratorRunning);
    } catch (err) {
      console.error("Failed to toggle orchestrator:", err);
    }
  };

  if (loading) {
    return (
      <div className="mission-control-loading">
        <div className="loading-spinner" />
        <p>Initializing Mission Control...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mission-control-error">
        <p>Failed to load Mission Control</p>
        <button onClick={fetchData}>Retry</button>
      </div>
    );
  }

  return (
    <div className="mission-control">
      {/* Top Bar - Fixed header with global status */}
      <TopBar
        systemStatus={getSystemStatus()}
        sseConnected={sseConnected}
        lastUpdated={lastUpdated}
        stats={data?.stats}
        soundEnabled={soundEnabled}
        onToggleSound={() => setSoundEnabled(!soundEnabled)}
      />

      {/* Main Content Area */}
      <div className="mission-control-main">
        {/* Left Rail - System status, workers, queue */}
        <LeftRail
          collapsed={leftRailCollapsed}
          onToggleCollapse={() => setLeftRailCollapsed(!leftRailCollapsed)}
          systemEnabled={systemEnabled}
          orchestratorRunning={orchestratorRunning}
          watcherEnabled={watcherEnabled}
          managerEnabled={managerEnabled}
          managerModel={managerModel}
          onToggleSystem={toggleSystem}
          onToggleOrchestrator={toggleOrchestrator}
          workers={data?.workers || []}
          queuedTasks={data?.queuedTasks || []}
          stats={data?.stats}
        />

        {/* Mission Center - Active tasks with progress */}
        <MissionCenter
          activeTasks={data?.activeTasks || []}
          queuedTasks={data?.queuedTasks || []}
          soundEnabled={soundEnabled}
        />

        {/* Right Rail - Costs, alerts, achievements */}
        <RightRail
          collapsed={rightRailCollapsed}
          onToggleCollapse={() => setRightRailCollapsed(!rightRailCollapsed)}
          stats={data?.stats}
          alerts={alerts}
          onDismissAlert={dismissAlert}
          achievements={ACHIEVEMENTS}
          unlockedAchievements={unlockedAchievements}
          dailyStats={dailyStats}
        />
      </div>

      {/* Bottom Bar - Live feed, pipeline, actions */}
      <BottomBar
        recentCompleted={data?.recentCompleted || []}
        activeTasks={data?.activeTasks || []}
        stats={data?.stats}
        onRefresh={fetchData}
      />
    </div>
  );
}

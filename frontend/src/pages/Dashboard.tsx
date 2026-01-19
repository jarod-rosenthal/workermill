import { useState, useEffect, useCallback, useRef } from "react";
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
  Cog,
  GitPullRequest,
  Users,
  User,
  Eye,
  X,
  Rocket,
  GitMerge,
  Pause,
  Search,
  ChevronRight,
  PanelLeftClose,
  ChevronDown,
  Wrench,
  Sliders,
  Star,
  RotateCcw,
  LayoutDashboard,
  Send,
  FolderKanban,
  PauseCircle,
  Network,
} from "lucide-react";
import { ThemeToggle } from "../components/ThemeToggle";
import { RalphProgress, RalphProgressCompact } from "../components/RalphProgress";
import { CheckpointStatus, CheckpointStatusBadge } from "../components/CheckpointStatus";
import { LogSearch } from "../components/LogSearch";
import { useAuthStore } from "../store/auth-store";
import { OnboardingWizard, useOnboardingState } from "../components/OnboardingWizard";
import { DashboardSkeleton } from "../components/ui/skeleton";
import {
  ErrorBoundaryWithRetry,
  DashboardErrorFallback,
} from "../components/ErrorBoundary";
import { CoordinationFeed } from "../components/CoordinationFeed";
import { EmbeddedDependencyGraph } from "../components/DependencyGraph";
import { useCoordinationStore } from "../store/coordination-store";

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
  status: "done" | "active" | "pending" | "waiting";
  icon: "queued" | "executing" | "pr_created" | "review" | "complete" | "deployed" | "manager_review" | "waiting" | "approved" | "deploying";
}

type WorkflowMode = "default" | "review" | "auto_deploy" | "manager" | "review_manager" | "deploy_manager";

interface TaskLog {
  timestamp: string;
  message: string;
  type: string;
  severity: string;
}

interface RalphProgressData {
  currentStory: number;
  totalStories: number;
  currentStoryDescription: string;
  completedStories?: number;
  status?: "planning" | "executing" | "completed" | "failed" | "unknown";
}

interface ActiveTask {
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
  // Workflow mode fields
  workflowMode?: WorkflowMode;
  workflowModeName?: string;
  managerEnabled?: boolean;
  revisionCount?: number;
  reviewFeedback?: string;
  // Manager task info
  managerEcsTaskId?: string | null;
  // Ralph execution info
  isRalphTask?: boolean;
  ralphProgress?: RalphProgressData | null;
  // Checkpoint info (Phase 5)
  hasCheckpoint?: boolean;
  checkpointStage?: string | null;
  resumeCount?: number;
  checkpointSavedAt?: string | null;
  // Plan approval (PRD orchestration)
  planJson?: {
    strategy: "single" | "multi";
    reasoning: string;
    primaryPersona?: string;
    stories?: Array<{
      index: number;
      title: string;
      persona: string;
      scope: string;
      acceptanceCriteria: string[];
      dependencies: number[];
      estimatedComplexity: "small" | "medium" | "large";
    }>;
    qualityGates: string[];
  } | null;
  planStatus?: string | null;
  planFeedback?: string | null;
  // Parent task info
  childTaskIds?: string[];
  parentTaskId?: string | null;
}

interface CompletedTask {
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
  // Workflow mode fields
  workflowMode?: WorkflowMode;
  workflowModeName?: string;
  managerEnabled?: boolean;
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

// Full Claude model options with exact version names (Anthropic official models only)
const MODEL_OPTIONS = [
  { value: "claude-opus-4-5-20251101", label: "Claude Opus 4.5", shortLabel: "Opus 4.5" },
  { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5", shortLabel: "Sonnet 4.5" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", shortLabel: "Haiku 4.5" },
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
  const num = Number(cost);
  if (isNaN(num)) return "0.00";
  return num.toFixed(2);
}

function formatModelName(modelId: string | undefined | null): string {
  if (!modelId) return "Sonnet 4";
  const option = MODEL_OPTIONS.find((m) => m.value === modelId);
  if (option) return option.shortLabel;
  // Fallback parsing for any model ID format
  const lower = modelId.toLowerCase();
  if (lower.includes("opus") && lower.includes("4-5")) return "Opus 4.5";
  if (lower.includes("opus")) return "Opus 4";
  if (lower.includes("haiku")) return "Haiku 3.5"; // Only real Haiku is 3.5
  if (lower.includes("sonnet") && lower.includes("3-5")) return "Sonnet 3.5";
  if (lower.includes("sonnet")) return "Sonnet 4";
  return modelId;
}

function formatProviderName(provider: string | undefined | null): { name: string; icon: string } {
  switch (provider) {
    case "openai":
      return { name: "OpenAI", icon: "🔷" };
    case "google":
      return { name: "Gemini", icon: "🔵" };
    case "ollama":
      return { name: "Ollama", icon: "🏠" };
    default:
      return { name: "Claude", icon: "🤖" };
  }
}

export default function Dashboard() {
  const navigate = useNavigate();
  const logout = useAuthStore((state) => state.logout);
  const user = useAuthStore((state) => state.user);

  // Always start fresh - no cached data to avoid showing stale data on refresh
  // Fresh data loads in <1 second, so showing loading state is better than stale data
  const [data, setData] = useState<ControlCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Streaming logs state - includes full log details
  interface StreamingLog {
    timestamp: number;
    message: string;
    logType?: string;
    severity?: string;
    command?: string;
    exitCode?: number;
  }
  const [streamingLogs, setStreamingLogs] = useState<Record<string, StreamingLog[]>>({});
  const logEventSources = useRef<Record<string, EventSource>>({});
  const terminalRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Cursor tracking for SSE resume (using refs to avoid re-renders)
  const terminalCursorsRef = useRef<Record<string, string | null>>({});
  const terminalSeenEventIdsRef = useRef<Record<string, Set<string>>>({});
  // Polling fallback timers
  const pollIntervalsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  // Track which terminals are actively streaming (state updates used, value reserved for future UI indicators)
  const [_streamingTerminals, setStreamingTerminals] = useState<Set<string>>(new Set());

  // Track hidden terminals (for active tasks that user manually collapsed)
  const [hiddenTerminals, setHiddenTerminals] = useState<Set<string>>(new Set());
  // Track shown terminals (for completed tasks that user manually expanded)
  const [shownTerminals, setShownTerminals] = useState<Set<string>>(new Set());

  // Task detail modal
  const [selectedTask, setSelectedTask] = useState<CompletedTask | null>(null);

  // System status
  const [systemEnabled, setSystemEnabled] = useState(true);
  const [systemToggleLoading, setSystemToggleLoading] = useState(false);
  const [watcherEnabled, setWatcherEnabled] = useState(false);
  const [watcherToggleLoading, setWatcherToggleLoading] = useState(false);
  const [orchestratorRunning, setOrchestratorRunning] = useState(false);
  const [orchestratorToggleLoading, setOrchestratorToggleLoading] = useState(false);

  // Action states
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resetCountersLoading, setResetCountersLoading] = useState(false);

  // Action buttons state
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [createTaskForm, setCreateTaskForm] = useState({
    jiraIssueKey: "",
    workerPersona: "backend_developer",
    workerModel: "claude-sonnet-4-5-20250929",
  });
  const [createLoading, setCreateLoading] = useState(false);

  // SSE connection state
  const [_sseConnected, setSseConnected] = useState(false);

  // Sidebar states
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLogSearchOpen, setIsLogSearchOpen] = useState(false);

  // Right sidebar state for coordination feed
  const [selectedParentTaskId, setSelectedParentTaskId] = useState<string | null>(null);
  const setCoordinationCollapsed = useCoordinationStore((s) => s.setCollapsed);

  // Onboarding state
  const { shouldShowOnboarding, dismissOnboarding } = useOnboardingState();

  const fetchData = useCallback(async () => {
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/control-center`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
        },
        cache: 'no-store',
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
      setError(null);

      // Update local state from API response
      if (result.systemStatus) {
        setSystemEnabled(result.systemStatus.systemEnabled);
        setOrchestratorRunning(result.systemStatus.orchestrator?.running || false);
      }
      if (result.watcherStatus) {
        setWatcherEnabled(result.watcherStatus.enabled);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to load data";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [logout, navigate]);

  // Handle bfcache restoration - reset state when page is restored from cache
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        // Page was restored from bfcache - reset to loading state and refetch
        setData(null);
        setLoading(true);
        fetchData();
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, [fetchData]);

  // SSE streaming for real-time updates
  useEffect(() => {
    // First fetch full data
    fetchData();

    const token = localStorage.getItem("accessToken");
    if (!token) return;

    // Create EventSource for SSE stream
    // Note: EventSource doesn't support custom headers, so we use query param for auth
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
          // Update stats
          setData((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              stats: {
                ...prev.stats,
                ...update.stats,
              },
              // Use task data directly from API - it includes steps based on workflow type
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
      // EventSource will automatically reconnect
    };

    return () => {
      eventSource.close();
    };
  }, [fetchData]);

  // Fetch terminal logs from REST API (same as OnCallShift)
  // Used for initial load and as polling fallback when SSE disconnects
  const fetchTerminalLogs = useCallback(async (taskId: string) => {
    try {
      const token = localStorage.getItem("accessToken");
      const cursor = terminalCursorsRef.current[taskId];
      const url = cursor
        ? `${API_BASE}/api/control-center/logs/${taskId}?limit=100&since=${encodeURIComponent(cursor)}`
        : `${API_BASE}/api/control-center/logs/${taskId}?limit=100`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const result = await response.json();
        const logs = result.logs || [];
        if (logs.length > 0) {
          // Initialize seen IDs set if needed
          if (!terminalSeenEventIdsRef.current[taskId]) {
            terminalSeenEventIdsRef.current[taskId] = new Set();
          }
          const seen = terminalSeenEventIdsRef.current[taskId];

          const logLines: StreamingLog[] = logs
            .filter((log: { id?: string; timestamp: string; cursor?: string }) => {
              // Build event ID for deduplication (same format as OnCallShift)
              const eventId = log.cursor ||
                (log.timestamp && log.id
                  ? `${new Date(log.timestamp).toISOString()}|${log.id}`
                  : null);
              if (eventId && seen.has(eventId)) {
                return false; // Skip duplicate
              }
              if (eventId) {
                seen.add(eventId);
              }
              return true;
            })
            .map((log: { timestamp: string; message: string; cursor?: string; logType?: string; severity?: string; command?: string; exitCode?: number }) => ({
              timestamp: new Date(log.timestamp).getTime(),
              message: log.message,
              logType: log.logType,
              severity: log.severity,
              command: log.command,
              exitCode: log.exitCode,
            }));

          if (logLines.length > 0) {
            setStreamingLogs((prev) => {
              // If no cursor (initial fetch), REPLACE logs (same as OnCallShift)
              // If cursor exists (polling), APPEND new logs
              const prevLines = cursor ? (prev[taskId] || []) : [];
              const nextLines = [...prevLines, ...logLines];
              // Keep last 1000 lines for memory bounding
              return {
                ...prev,
                [taskId]: nextLines.length > 1000 ? nextLines.slice(-1000) : nextLines,
              };
            });
          }

          // Update cursor from last log
          const lastLog = logs[logs.length - 1];
          if (lastLog?.cursor) {
            terminalCursorsRef.current[taskId] = lastLog.cursor;
          } else if (lastLog?.timestamp && lastLog?.id) {
            terminalCursorsRef.current[taskId] = `${new Date(lastLog.timestamp).toISOString()}|${lastLog.id}`;
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch terminal logs:", err);
    }
  }, []);

  const startPolling = useCallback((taskId: string, intervalMs = 5000) => {
    if (pollIntervalsRef.current[taskId]) return;
    const interval = setInterval(() => fetchTerminalLogs(taskId), intervalMs);
    pollIntervalsRef.current[taskId] = interval;
  }, [fetchTerminalLogs]);

  const stopPolling = useCallback((taskId: string) => {
    const interval = pollIntervalsRef.current[taskId];
    if (interval) {
      clearInterval(interval);
      delete pollIntervalsRef.current[taskId];
    }
  }, []);

  // Start SSE log streaming for a task - uses database stream (same as OnCallShift)
  const startLogStream = useCallback((taskId: string) => {
    // Don't start if already streaming
    if (logEventSources.current[taskId]) return;

    const token = localStorage.getItem("accessToken");
    if (!token) return;

    // Build URL with cursor for resume support (same as OnCallShift)
    const tokenParam = `token=${encodeURIComponent(token)}`;
    const sinceCursor = terminalCursorsRef.current[taskId];
    const sinceParam = sinceCursor ? `since=${encodeURIComponent(sinceCursor)}` : "";
    const query = [tokenParam, sinceParam].filter(Boolean).join("&");
    const url = `${API_BASE}/api/control-center/logs/${taskId}/stream?${query}`;

    // CRITICAL: Fetch initial logs FIRST, then connect to SSE for new logs (same as OnCallShift)
    fetchTerminalLogs(taskId);

    const eventSource = new EventSource(url);

    // Handle ping events (keep-alive)
    eventSource.addEventListener("ping", () => {
      // Connection is alive, nothing to do
    });

    // Handle log events - works for both CloudWatch and database streams
    const onLogEvent = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        // Event ID for deduplication and cursor tracking (same as OnCallShift)
        const eventId =
          event.lastEventId ||
          data.cursor ||
          (data.timestamp && data.id
            ? `${new Date(data.timestamp).toISOString()}|${data.id}`
            : null);

        // Deduplication: track seen event IDs
        if (eventId) {
          if (!terminalSeenEventIdsRef.current[taskId]) {
            terminalSeenEventIdsRef.current[taskId] = new Set();
          }
          const seen = terminalSeenEventIdsRef.current[taskId];
          if (seen.has(eventId)) {
            return; // Skip duplicates
          }
          seen.add(eventId);
          // Keep memory bounded - remove old entries if too many
          if (seen.size > 1000) {
            terminalSeenEventIdsRef.current[taskId] = new Set(Array.from(seen).slice(-500));
          }
        }

        const logLine: StreamingLog = {
          timestamp: new Date(data.timestamp).getTime(),
          message: data.message,
          // CloudWatch logs don't have these fields, but database logs do
          logType: data.logType,
          severity: data.severity,
          command: data.command,
          exitCode: data.exitCode,
        };

        setStreamingLogs((prev) => {
          const prevLines = prev[taskId] || [];
          const nextLines = [...prevLines, logLine];
          // Keep last 1000 lines for memory bounding
          return {
            ...prev,
            [taskId]: nextLines.length > 1000 ? nextLines.slice(-1000) : nextLines,
          };
        });

        if (eventId) {
          terminalCursorsRef.current[taskId] = eventId;
        }
      } catch (err) {
        console.error("Error parsing log SSE data:", err);
      }
    };

    eventSource.addEventListener("log", onLogEvent);

    // Handle Ralph progress events
    eventSource.addEventListener("ralph_progress", (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        // Update the task's Ralph progress in the data state
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            activeTasks: prev.activeTasks.map((task) =>
              task.id === taskId
                ? {
                    ...task,
                    isRalphTask: true,
                    ralphProgress: {
                      currentStory: data.currentStory,
                      totalStories: data.totalStories,
                      currentStoryDescription: data.currentStoryDescription,
                      status: "executing" as const,
                    },
                  }
                : task
            ),
          };
        });
      } catch (err) {
        console.error("Error parsing Ralph progress SSE data:", err);
      }
    });

    eventSource.onopen = () => {
      stopPolling(taskId); // Stop fallback polling once SSE opens
      setStreamingTerminals((prev) => new Set([...prev, taskId]));
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "status") {
          // Task status changed - refresh main data
          fetchData();
        } else if (data.type === "complete") {
          // Task completed - close stream
          eventSource.close();
          delete logEventSources.current[taskId];
          setStreamingTerminals((prev) => {
            const newSet = new Set(prev);
            newSet.delete(taskId);
            return newSet;
          });
          stopPolling(taskId);
        }
      } catch (err) {
        console.error("Error parsing SSE data:", err);
      }
    };

    eventSource.onerror = () => {
      // Let EventSource auto-reconnect; use polling while disconnected
      setStreamingTerminals((prev) => {
        const newSet = new Set(prev);
        newSet.delete(taskId);
        return newSet;
      });
      startPolling(taskId); // Fall back to polling
    };

    logEventSources.current[taskId] = eventSource;
  }, [fetchTerminalLogs, fetchData, startPolling, stopPolling]);

  // Stop SSE log streaming for a task
  const stopLogStream = useCallback((taskId: string) => {
    const eventSource = logEventSources.current[taskId];
    if (eventSource) {
      eventSource.close();
      delete logEventSources.current[taskId];
    }
    stopPolling(taskId);
    setStreamingTerminals((prev) => {
      const newSet = new Set(prev);
      newSet.delete(taskId);
      return newSet;
    });
  }, [stopPolling]);

  // Log streaming for active tasks (auto-connect unless hidden)
  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    if (!token || !data?.activeTasks) return;

    // Get all active task IDs that should have streaming enabled
    const activeTaskIds = data.activeTasks
      .filter((task) => !hiddenTerminals.has(task.id))
      .map((task) => task.id);

    // Start streaming for active tasks
    activeTaskIds.forEach((taskId) => {
      startLogStream(taskId);
    });

    // Close connections for hidden terminals
    Object.keys(logEventSources.current).forEach((taskId) => {
      if (hiddenTerminals.has(taskId) || !activeTaskIds.includes(taskId)) {
        stopLogStream(taskId);
      }
    });
  }, [data?.activeTasks, hiddenTerminals, startLogStream, stopLogStream]);

  // Cleanup SSE connections on unmount
  useEffect(() => {
    return () => {
      Object.keys(logEventSources.current).forEach((taskId) => {
        logEventSources.current[taskId].close();
      });
      logEventSources.current = {};
      Object.values(pollIntervalsRef.current).forEach((interval) => clearInterval(interval));
      pollIntervalsRef.current = {};
      terminalSeenEventIdsRef.current = {};
    };
  }, []);

  // Note: We intentionally don't cache data to sessionStorage
  // Fresh data loads quickly and showing stale data on refresh causes confusion

  // Auto-scroll terminal to bottom when new logs arrive
  useEffect(() => {
    Object.keys(streamingLogs).forEach((taskId) => {
      const terminalEl = terminalRefs.current[taskId];
      if (terminalEl) {
        terminalEl.scrollTop = terminalEl.scrollHeight;
      }
    });
  }, [streamingLogs]);

  const handleLogout = () => {
    logout();
    navigate("/");
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

    // Optimistically update task status to cancelled to prevent UI flash
    setData((prevData) => {
      if (!prevData) return prevData;
      return {
        ...prevData,
        activeTasks: prevData.activeTasks.map((t) =>
          t.id === taskId ? { ...t, status: "cancelled" } : t
        ),
        queuedTasks: prevData.queuedTasks.filter((t) => t.id !== taskId),
      };
    });

    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/tasks/${taskId}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        setActionSuccess("Task cancelled successfully");
        setTimeout(() => setActionSuccess(null), 3000);
        // Fetch fresh data to get accurate state
        fetchData();
      } else {
        const err = await response.json();
        setActionError(err.error || "Failed to cancel task");
        setTimeout(() => setActionError(null), 5000);
        // Revert optimistic update on error
        fetchData();
      }
    } catch (err) {
      setActionError("Failed to cancel task");
      setTimeout(() => setActionError(null), 5000);
      // Revert optimistic update on error
      fetchData();
    } finally {
      setActionLoading(null);
    }
  };

  const handleRetryTask = async (taskId: string) => {
    setActionLoading(taskId);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/tasks/${taskId}/retry`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        setActionSuccess("Task requeued for retry");
        setTimeout(() => setActionSuccess(null), 3000);
        fetchData();
      } else {
        const err = await response.json();
        setActionError(err.error || "Failed to retry task");
        setTimeout(() => setActionError(null), 5000);
      }
    } catch (err) {
      setActionError("Failed to retry task");
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

    // Optimistically remove task from local state to prevent UI flash
    setData((prevData) => {
      if (!prevData) return prevData;
      return {
        ...prevData,
        activeTasks: prevData.activeTasks.filter((t) => t.id !== taskId),
        queuedTasks: prevData.queuedTasks.filter((t) => t.id !== taskId),
        recentCompleted: prevData.recentCompleted.filter((t) => t.id !== taskId),
      };
    });

    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/tasks/${taskId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        setActionSuccess("Task deleted successfully");
        setTimeout(() => setActionSuccess(null), 3000);
        // Sync with server in background (task already removed from UI)
        fetchData();
      } else {
        const err = await response.json();
        setActionError(err.error || "Failed to delete task");
        setTimeout(() => setActionError(null), 5000);
        // Restore data on error by refetching
        fetchData();
      }
    } catch (err) {
      setActionError("Failed to delete task");
      setTimeout(() => setActionError(null), 5000);
      // Restore data on error by refetching
      fetchData();
    } finally {
      setActionLoading(null);
    }
  };

  // Pause all child tasks for a parent workflow
  const handlePauseAllChildren = async (parentTaskId: string) => {
    setActionLoading(parentTaskId);
    try {
      const token = localStorage.getItem("accessToken");
      // Get all child task IDs first
      const response = await fetch(`${API_BASE}/api/tasks/${parentTaskId}/children`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const { children } = await response.json();
        // Send pause command to each running child
        const pausePromises = children
          .filter((child: { status: string }) => ["executing", "environment_setup"].includes(child.status))
          .map((child: { id: string }) =>
            fetch(`${API_BASE}/api/coordination/commands`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                taskId: child.id,
                command: "pause",
              }),
            })
          );
        await Promise.all(pausePromises);
        setActionSuccess(`Paused ${pausePromises.length} child tasks`);
        setTimeout(() => setActionSuccess(null), 3000);
        fetchData();
      }
    } catch (err) {
      setActionError("Failed to pause child tasks");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setActionLoading(null);
    }
  };

  // Answer a coordination question
  const handleAnswerQuestion = async (messageId: string, answer: string) => {
    try {
      const token = localStorage.getItem("accessToken");
      await fetch(`${API_BASE}/api/coordination/answer`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messageId, answer }),
      });
    } catch (err) {
      console.error("Failed to send answer:", err);
    }
  };

  // Plan approval handlers for PRD orchestration
  const handleApprovePlan = async (taskId: string) => {
    setActionLoading(taskId);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/tasks/${taskId}/plan/approve`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ executionMode: "autonomous" }),
      });
      if (response.ok) {
        setActionSuccess("Plan approved! Task queued for execution.");
        setTimeout(() => setActionSuccess(null), 3000);
        fetchData();
      } else {
        const err = await response.json();
        setActionError(err.error || "Failed to approve plan");
        setTimeout(() => setActionError(null), 5000);
      }
    } catch (err) {
      setActionError("Failed to approve plan");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setActionLoading(null);
    }
  };

  const [planFeedbackInput, setPlanFeedbackInput] = useState<{ [taskId: string]: string }>({});
  const [showFeedbackInput, setShowFeedbackInput] = useState<string | null>(null);

  const handleRequestPlanChanges = async (taskId: string) => {
    const feedback = planFeedbackInput[taskId];
    if (!feedback?.trim()) {
      setActionError("Please provide feedback for the planner");
      setTimeout(() => setActionError(null), 3000);
      return;
    }
    setActionLoading(taskId);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/tasks/${taskId}/plan/request-changes`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ feedback }),
      });
      if (response.ok) {
        setActionSuccess("Feedback sent! Planner will revise the plan.");
        setTimeout(() => setActionSuccess(null), 3000);
        setShowFeedbackInput(null);
        setPlanFeedbackInput((prev) => ({ ...prev, [taskId]: "" }));
        fetchData();
      } else {
        const err = await response.json();
        setActionError(err.error || "Failed to request changes");
        setTimeout(() => setActionError(null), 5000);
      }
    } catch (err) {
      setActionError("Failed to request changes");
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
        setCreateTaskForm({ jiraIssueKey: "", workerPersona: "backend_developer", workerModel: "claude-sonnet-4-5-20250929" });
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

  const toggleTerminal = (taskId: string, taskStatus: string) => {
    const completedStatuses = ["completed", "deployed", "failed", "cancelled"];
    const isCompletedTask = completedStatuses.includes(taskStatus);

    if (isCompletedTask) {
      // For completed tasks: toggle shownTerminals (default is hidden)
      setShownTerminals((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(taskId)) {
          newSet.delete(taskId);
        } else {
          newSet.add(taskId);
        }
        return newSet;
      });
    } else {
      // For active tasks: toggle hiddenTerminals (default is shown)
      setHiddenTerminals((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(taskId)) {
          newSet.delete(taskId);
        } else {
          newSet.add(taskId);
        }
        return newSet;
      });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
      case "deployed":
        return "text-green-500";
      case "executing":
        return "text-blue-500";
      case "planning":
        return "text-cyan-500";
      case "pending_plan_approval":
        return "text-amber-500";
      case "queued":
      case "claimed":
      case "environment_setup":
        return "text-yellow-500";
      case "failed":
        return "text-red-500";
      case "blocked":
      case "revision_needed":
      case "escalated":
        return "text-orange-500";
      case "cancelled":
        return "text-gray-500";
      case "pr_created":
      case "review_pending":
      case "review_requested":
        return "text-purple-500";
      case "manager_review":
        return "text-indigo-500";
      case "review_approved":
      case "pr_approved":
        return "text-blue-500";
      case "review_rejected":
        return "text-red-400";
      case "deployment_pending":
      case "deploying":
        return "text-blue-400";
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

  // Workflow mode badge styling
  const getWorkflowModeBadge = (mode?: WorkflowMode) => {
    switch (mode) {
      case "default":
        return { label: "Standard", color: "bg-gray-500/20 text-gray-400 border-gray-500/30", icon: GitPullRequest };
      case "review":
        return { label: "Auto Review", color: "bg-purple-500/20 text-purple-400 border-purple-500/30", icon: Users };
      case "auto_deploy":
        return { label: "Auto-Deploy", color: "bg-green-500/20 text-green-400 border-green-500/30", icon: Rocket };
      case "manager":
        return { label: "Manager", color: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30", icon: Wrench };
      case "review_manager":
        return { label: "Auto Review + Manager", color: "bg-purple-500/20 text-purple-400 border-purple-500/30", icon: Users };
      case "deploy_manager":
        return { label: "Deploy + Manager", color: "bg-green-500/20 text-green-400 border-green-500/30", icon: Rocket };
      default:
        return { label: "Standard", color: "bg-gray-500/20 text-gray-400 border-gray-500/30", icon: GitPullRequest };
    }
  };

  const formatTimestamp = (dateStr: string | null): { date: string; time: string } | null => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    return {
      date: date.toLocaleDateString("en-US", {
        month: "numeric",
        day: "numeric",
        year: "numeric",
      }),
      time: date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }),
    };
  };

  // Only show full-page loading on very first mount (no data at all)
  // This prevents flickering when data already exists from SSE updates
  if (loading && !data) {
    return <DashboardSkeleton />;
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
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Background effects */}
      <div className="fixed inset-0 bg-grid-pattern pointer-events-none opacity-50" />
      <div className="fixed inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5 pointer-events-none" />

      {/* Floating orbs */}
      <div className="orb orb-primary w-[600px] h-[600px] -top-40 -left-40 opacity-30" />
      <div className="orb orb-accent w-[500px] h-[500px] top-1/3 -right-40 opacity-30" style={{ animationDelay: '-4s' }} />
      <div className="orb orb-primary w-[400px] h-[400px] bottom-20 left-1/4 opacity-20" style={{ animationDelay: '-2s' }} />

      {/* Header */}
      <header className="border-b border-border/30 glass-strong sticky top-0 z-10">
        <div className="max-w-full mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <Link to="/" className="group flex-shrink-0">
            <h1 className="text-xl font-bold text-gradient-animated group-hover:opacity-80 transition-opacity">
              WorkerMill
            </h1>
          </Link>

          {/* Stats Bar - Compact horizontal stats */}
          <div className="flex items-center gap-2 flex-1 justify-center">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20">
              <Cpu className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-primary">{data?.stats.activeWorkers || 0}/{data?.stats.totalWorkers || 0}</span>
              <span className="text-xs text-muted-foreground">Workers</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
              <Activity className="w-4 h-4 text-yellow-500" />
              <span className="text-sm font-semibold text-yellow-500">{data?.stats.queueDepth || 0}</span>
              <span className="text-xs text-muted-foreground">Queued</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
              <Zap className="w-4 h-4 text-cyan-500" />
              <span className="text-sm font-semibold text-cyan-500">{data?.activeTasks?.length || 0}</span>
              <span className="text-xs text-muted-foreground">Active</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span className="text-sm font-semibold text-green-500">{data?.stats.periodCompleted || 0}</span>
              <span className="text-xs text-muted-foreground">Done</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20">
              <XCircle className="w-4 h-4 text-red-500" />
              <span className="text-sm font-semibold text-red-500">{data?.stats.periodFailed || 0}</span>
              <span className="text-xs text-muted-foreground">Failed</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20">
              <DollarSign className="w-4 h-4 text-accent" />
              <span className="text-sm font-semibold text-accent">${formatCost(data?.stats.cumulativeCost)}</span>
              <span className="text-xs text-muted-foreground">Cost</span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
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
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-blue-500/10 text-blue-500 border border-blue-500/30 hover:bg-blue-500/20 transition-all"
            >
              <Play className="w-4 h-4" />
              Run Task
            </button>

            {/* Projects Link */}
            <Link
              to="/projects"
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Projects"
            >
              <FolderKanban className="w-4 h-4" />
              Projects
            </Link>

            {/* Docs Link */}
            <Link
              to="/docs"
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Documentation"
            >
              <Book className="w-4 h-4" />
              Docs
            </Link>

            {/* Settings Menu */}
            <div className="relative">
              <button
                onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                onBlur={() => setTimeout(() => setShowSettingsMenu(false), 150)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Settings"
              >
                <Settings className="w-4 h-4" />
                Settings
                <ChevronDown className={`w-3 h-3 transition-transform ${showSettingsMenu ? 'rotate-180' : ''}`} />
              </button>
              {showSettingsMenu && (
                <div className="absolute right-0 mt-1 w-48 rounded-lg border border-border bg-card shadow-lg py-1 z-50">
                  <Link
                    to="/views"
                    className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                    onClick={() => setShowSettingsMenu(false)}
                  >
                    <LayoutDashboard className="w-4 h-4" />
                    Views
                  </Link>
                  <Link
                    to="/mission-control"
                    className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                    onClick={() => setShowSettingsMenu(false)}
                  >
                    <Rocket className="w-4 h-4" />
                    Mission Control
                  </Link>
                  <div className="border-t border-border my-1" />
                  <Link
                    to="/profile"
                    className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                    onClick={() => setShowSettingsMenu(false)}
                  >
                    <User className="w-4 h-4" />
                    Profile
                  </Link>
                  <Link
                    to="/settings"
                    className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                    onClick={() => setShowSettingsMenu(false)}
                  >
                    <Sliders className="w-4 h-4" />
                    Organization Settings
                  </Link>
                  <Link
                    to="/personas"
                    className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                    onClick={() => setShowSettingsMenu(false)}
                  >
                    <Cog className="w-4 h-4" />
                    Persona Studio
                  </Link>
                  <Link
                    to="/setup"
                    className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                    onClick={() => setShowSettingsMenu(false)}
                  >
                    <Wrench className="w-4 h-4" />
                    Setup Wizard
                  </Link>
                </div>
              )}
            </div>

            <ThemeToggle />
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

      {/* 3-Column Layout */}
      <div className="relative flex min-h-[calc(100vh-80px)]">
        {/* Left Sidebar - Virtual Manager */}
        <aside className={`${leftSidebarOpen ? 'w-56' : 'w-12'} flex-shrink-0 border-r border-border/30 glass-strong transition-all duration-300 relative`}>
          <button
            onClick={() => setLeftSidebarOpen(!leftSidebarOpen)}
            className="absolute -right-3 top-4 z-10 p-1.5 rounded-full bg-muted border border-border hover:bg-muted/80 transition-colors"
            title={leftSidebarOpen ? "Collapse Manager" : "Expand Manager"}
          >
            {leftSidebarOpen ? <PanelLeftClose className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>

          {leftSidebarOpen ? (
            <div className="p-3 space-y-3">
              {/* Manager Header */}
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center text-base">
                  👔
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-foreground">Virtual Manager</h3>
                  <span className="text-[10px] text-muted-foreground">AI Code Review</span>
                </div>
              </div>

              {/* Service Toggles */}
              <div className="space-y-2">
                <button
                  onClick={toggleWatcher}
                  disabled={watcherToggleLoading}
                  className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg transition-all ${
                    watcherEnabled
                      ? "bg-green-500/10 text-green-500 border border-green-500/30 hover:bg-green-500/20"
                      : "bg-gray-500/10 text-gray-400 border border-gray-500/30 hover:bg-gray-500/20"
                  } ${watcherToggleLoading ? "opacity-50" : ""}`}
                >
                  <span className="flex items-center gap-2">
                    {watcherToggleLoading ? (
                      <RefreshCw className="w-3 h-3 animate-spin" />
                    ) : (
                      <Shield className="w-3 h-3" />
                    )}
                    Watcher
                  </span>
                  <span className={`px-1.5 py-0.5 text-[10px] rounded ${watcherEnabled ? 'bg-green-500/20' : 'bg-gray-500/20'}`}>
                    {watcherEnabled ? "ON" : "OFF"}
                  </span>
                </button>

                <button
                  onClick={toggleOrchestrator}
                  disabled={orchestratorToggleLoading}
                  className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg transition-all ${
                    orchestratorRunning
                      ? "bg-blue-500/10 text-blue-500 border border-blue-500/30 hover:bg-blue-500/20"
                      : "bg-gray-500/10 text-gray-400 border border-gray-500/30 hover:bg-gray-500/20"
                  } ${orchestratorToggleLoading ? "opacity-50" : ""}`}
                >
                  <span className="flex items-center gap-2">
                    {orchestratorToggleLoading ? (
                      <RefreshCw className="w-3 h-3 animate-spin" />
                    ) : (
                      <Zap className="w-3 h-3" />
                    )}
                    Orchestrator
                  </span>
                  <span className={`px-1.5 py-0.5 text-[10px] rounded ${orchestratorRunning ? 'bg-blue-500/20' : 'bg-gray-500/20'}`}>
                    {orchestratorRunning ? "ON" : "OFF"}
                  </span>
                </button>
              </div>

              {/* Queue Stats */}
              <div className="border-t border-border pt-2">
                <h4 className="text-[10px] font-medium text-muted-foreground mb-1">Review Queue</h4>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">Awaiting</span>
                    <span className={`text-xs font-semibold ${(data?.managerStatus?.queue?.awaitingReview || 0) > 0 ? "text-purple-500" : ""}`}>
                      {data?.managerStatus?.queue?.awaitingReview || 0}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">Under Review</span>
                    <span className={`text-xs font-semibold ${(data?.managerStatus?.queue?.underReview || 0) > 0 ? "text-indigo-500" : ""}`}>
                      {data?.managerStatus?.queue?.underReview || 0}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">Needs Revision</span>
                    <span className={`text-xs font-semibold ${(data?.managerStatus?.queue?.revisionNeeded || 0) > 0 ? "text-orange-500" : ""}`}>
                      {data?.managerStatus?.queue?.revisionNeeded || 0}
                    </span>
                  </div>
                </div>
              </div>

              {/* Manager Stats */}
              <div className="border-t border-border pt-2">
                <h4 className="text-[10px] font-medium text-muted-foreground mb-1">Stats</h4>
                <div className="grid grid-cols-3 gap-1 text-[10px]">
                  <div>
                    <div className="text-muted-foreground">Reviews</div>
                    <div className="font-semibold text-xs">{data?.managerStatus?.stats?.totalReviews || 0}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Approved</div>
                    <div className="font-semibold text-xs text-green-500">{data?.managerStatus?.stats?.approved || 0}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Rejected</div>
                    <div className="font-semibold text-xs text-red-500">{data?.managerStatus?.stats?.rejected || 0}</div>
                  </div>
                </div>
              </div>

              {/* Reset Counters */}
              <div className="border-t border-border pt-2">
                <button
                  onClick={handleResetCounters}
                  disabled={resetCountersLoading}
                  className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] font-medium rounded bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {resetCountersLoading ? (
                    <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-2.5 h-2.5" />
                  )}
                  Reset
                </button>
              </div>
            </div>
          ) : (
            <div className="p-2 pt-12 space-y-3">
              <div className="p-2 rounded bg-indigo-500/10 text-center" title="Virtual Manager">
                <span className="text-lg">👔</span>
              </div>
              <div className={`p-2 rounded text-center ${watcherEnabled ? 'bg-green-500/10' : 'bg-gray-500/10'}`} title={`Watcher ${watcherEnabled ? 'ON' : 'OFF'}`}>
                <Shield className={`w-4 h-4 mx-auto ${watcherEnabled ? 'text-green-500' : 'text-gray-500'}`} />
              </div>
              <div className={`p-2 rounded text-center ${orchestratorRunning ? 'bg-blue-500/10' : 'bg-gray-500/10'}`} title={`Orchestrator ${orchestratorRunning ? 'ON' : 'OFF'}`}>
                <Zap className={`w-4 h-4 mx-auto ${orchestratorRunning ? 'text-blue-500' : 'text-gray-500'}`} />
              </div>
              <div className="p-2 rounded bg-purple-500/10 text-center" title="Awaiting Review">
                <Users className="w-4 h-4 mx-auto text-purple-500" />
                <div className="text-xs font-bold mt-1">{data?.managerStatus?.queue?.awaitingReview || 0}</div>
              </div>
            </div>
          )}
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-auto p-6 space-y-6">
          <ErrorBoundaryWithRetry fallback={<DashboardErrorFallback />}>
          {/* Search Bar */}
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search Jira tasks, ticket names, summaries..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-4 py-3 text-base bg-background border border-border/50 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-4 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <button
              onClick={() => setIsLogSearchOpen(true)}
              className="px-4 py-3 bg-primary/10 hover:bg-primary/20 text-primary rounded-xl border border-border/50 flex items-center gap-2 transition-colors whitespace-nowrap"
              title="Search all task logs"
            >
              <Terminal className="w-5 h-5" />
              Search Logs
            </button>
          </div>

          {/* Active Workflows */}
        <div className="card-elevated border border-border/50 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-border/50 bg-gradient-to-r from-primary/10 to-transparent">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Zap className="w-5 h-5 text-primary" />
                Active Workflows
                {data?.activeTasks && data.activeTasks.length > 0 && (
                  <span className="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-primary/20 text-primary animate-pulse">
                    {data.activeTasks.length} running
                  </span>
                )}
              </h2>
            </div>
            <div className="divide-y divide-border">
              {data?.activeTasks && data.activeTasks.length > 0 ? (
                data.activeTasks
                  .filter((task) => {
                    if (!searchQuery) return true;
                    const query = searchQuery.toLowerCase();
                    return (
                      task.jiraIssueKey.toLowerCase().includes(query) ||
                      task.summary.toLowerCase().includes(query) ||
                      task.workerPersona.toLowerCase().includes(query)
                    );
                  })
                  .map((task, index, filteredTasks) => {
                  // Find the first actively running (non-completed) task
                  const completedStatuses = ["completed", "deployed", "failed", "cancelled"];
                  const firstActiveIndex = filteredTasks.findIndex(t => !completedStatuses.includes(t.status));
                  const isFirstActiveTask = index === firstActiveIndex;
                  const isCompletedTask = completedStatuses.includes(task.status);

                  // Terminal visibility logic:
                  // - First active task: expanded by default (unless manually hidden)
                  // - Completed tasks: collapsed by default (unless manually shown)
                  // - Other active tasks: expanded by default (unless manually hidden)
                  const isTerminalVisible = isCompletedTask
                    ? shownTerminals.has(task.id)  // Completed: collapsed unless manually shown
                    : isFirstActiveTask
                      ? !hiddenTerminals.has(task.id)  // First active: visible unless manually hidden
                      : !hiddenTerminals.has(task.id);  // Other active: visible unless manually hidden
                  const workerId = task.id.slice(0, 8);
                  return (
                    <div key={task.id} className="p-4">
                      {/* Task Header */}
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          {/* Persona Icon + Name */}
                          <div className="flex items-center gap-3">
                            {/* Show Planner during planning phases */}
                            {(task.status === "planning" || task.status === "pending_plan_approval") ? (
                              <>
                                <span className="text-4xl">📋</span>
                                <span className="text-xl font-medium text-foreground">
                                  Project Manager
                                </span>
                                {task.status === "pending_plan_approval" && (
                                  <span className="text-primary text-sm">
                                    (awaiting your approval)
                                  </span>
                                )}
                              </>
                            ) : task.status === "manager_review" && task.managerEcsTaskId ? (
                              /* Show Virtual Manager when manager_review is active */
                              <>
                                <span className="text-4xl">👔</span>
                                <span className="text-xl font-medium text-foreground">
                                  Virtual Manager
                                </span>
                                <span className="text-muted-foreground text-sm">
                                  (reviewing {getPersonaInfo(task.workerPersona).title}'s PR)
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="text-4xl">
                                  {getPersonaInfo(task.workerPersona).emoji}
                                </span>
                                <span className="text-xl font-medium text-foreground">
                                  {getPersonaInfo(task.workerPersona).title}
                                </span>
                              </>
                            )}
                          </div>
                          <span className="text-muted-foreground">•</span>
                          <a
                            href={`https://oncallshift.atlassian.net/browse/${task.jiraIssueKey}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline font-medium flex items-center gap-1"
                          >
                            {task.jiraIssueKey}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                          <span className="text-muted-foreground">{task.summary}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Workflow Mode Badge */}
                          {(() => {
                            const badge = getWorkflowModeBadge(task.workflowMode);
                            const BadgeIcon = badge.icon;
                            return (
                              <span className={`text-xs px-2 py-0.5 rounded-full border flex items-center gap-1 ${badge.color}`}>
                                <BadgeIcon className="w-3 h-3" />
                                {badge.label}
                                {task.managerEnabled && task.workflowMode !== "manager" && task.workflowMode !== "review_manager" && task.workflowMode !== "deploy_manager" && (
                                  <Wrench className="w-3 h-3 ml-0.5" />
                                )}
                              </span>
                            );
                          })()}
                          {/* PRD Badge - Compact indicator + Orchestration Link */}
                          {/* Show for parent tasks: planning, pending_plan_approval, dispatching, or tasks with children */}
                          {(task.isRalphTask || task.status === "planning" || task.status === "pending_plan_approval" || task.status === "dispatching" || (task.childTaskIds && task.childTaskIds.length > 0)) && (
                            <>
                              {task.ralphProgress && (
                                <RalphProgressCompact progress={task.ralphProgress} />
                              )}
                              <Link
                                to={`/orchestration/${task.id}`}
                                className="text-xs px-2 py-0.5 rounded-full border border-primary/50 bg-primary/10 text-primary hover:bg-primary/20 flex items-center gap-1 transition-colors"
                                title="View PRD Orchestration Dashboard"
                              >
                                <LayoutDashboard className="w-3 h-3" />
                                Orchestration
                              </Link>
                              {/* Workflow Control Buttons */}
                              <button
                                onClick={() => {
                                  setSelectedParentTaskId(task.id);
                                  setCoordinationCollapsed(false);
                                }}
                                className={`text-xs px-2 py-0.5 rounded-full border flex items-center gap-1 transition-colors ${
                                  selectedParentTaskId === task.id
                                    ? "border-green-500/50 bg-green-500/10 text-green-500"
                                    : "border-border hover:bg-muted text-muted-foreground hover:text-foreground"
                                }`}
                                title="Open Coordination Feed"
                              >
                                <Activity className="w-3 h-3" />
                                Feed
                              </button>
                              {task.status === "dispatching" && (
                                <>
                                  <button
                                    onClick={() => handlePauseAllChildren(task.id)}
                                    disabled={actionLoading === task.id}
                                    className="text-xs px-2 py-0.5 rounded-full border border-yellow-500/50 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20 flex items-center gap-1 transition-colors"
                                    title="Pause All Child Tasks"
                                  >
                                    <PauseCircle className="w-3 h-3" />
                                    Pause All
                                  </button>
                                </>
                              )}
                            </>
                          )}
                          {/* Checkpoint Badge - Only show for in-progress tasks */}
                          {task.hasCheckpoint && task.status !== 'completed' && task.status !== 'failed' && (
                            <CheckpointStatusBadge checkpoint={{
                              hasCheckpoint: task.hasCheckpoint,
                              checkpointStage: task.checkpointStage || null,
                              resumeCount: task.resumeCount || 0,
                              checkpointSavedAt: task.checkpointSavedAt || null,
                            }} />
                          )}
                          {task.workerProvider && (
                            <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                              {formatProviderName(task.workerProvider).icon} {formatProviderName(task.workerProvider).name}
                            </span>
                          )}
                          {task.workerModel && (
                            <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                              {formatModelName(task.workerModel)}
                            </span>
                          )}
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${getStatusColor(task.status)} bg-current/10`}>
                            {task.status}
                          </span>
                        </div>
                      </div>

                      {/* Workflow Stage Progress - Horizontal with icons */}
                      <div className="flex items-center mb-4">
                        {task.steps.map((step, idx) => {
                          const StepIcon = step.icon === "queued" ? Clock :
                                          step.icon === "executing" ? Cog :
                                          step.icon === "pr_created" ? GitPullRequest :
                                          step.icon === "review" ? Users :
                                          step.icon === "manager_review" ? Users :
                                          step.icon === "approved" ? CheckCircle :
                                          step.icon === "deploying" ? Rocket :
                                          step.icon === "deployed" ? Rocket :
                                          step.icon === "complete" ? GitMerge :
                                          step.icon === "waiting" ? Pause :
                                          CheckCircle;
                          const isActive = step.status === "active";
                          const isDone = step.status === "done";
                          const isWaiting = step.status === "waiting";

                          return (
                            <div key={idx} className="flex items-center flex-1">
                              {/* Stage circle with icon */}
                              <div className="flex flex-col items-center">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                                  isDone ? "bg-primary border-primary text-primary-foreground" :
                                  isActive ? "bg-primary/20 border-primary text-primary animate-pulse" :
                                  isWaiting ? "bg-yellow-500/20 border-yellow-500 text-yellow-500" :
                                  "bg-muted border-border text-muted-foreground"
                                }`}>
                                  {isWaiting ? (
                                    <Pause className="w-5 h-5" />
                                  ) : (
                                    <StepIcon className={`w-5 h-5 ${isActive && step.icon === "executing" ? "animate-spin" : ""}`} style={{ animationDuration: "2s" }} />
                                  )}
                                </div>
                                <span className={`text-xs mt-1 whitespace-nowrap ${
                                  isDone || isActive ? "text-foreground" :
                                  isWaiting ? "text-yellow-500" :
                                  "text-muted-foreground"
                                }`}>
                                  {step.name}
                                </span>
                              </div>
                              {/* Connector line (not after last item) */}
                              {idx < task.steps.length - 1 && (
                                <div className={`flex-1 h-0.5 mx-2 ${
                                  isDone ? "bg-primary" :
                                  isWaiting ? "bg-yellow-500/50" :
                                  "bg-border"
                                }`} />
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Ralph Progress - Full display for Ralph tasks */}
                      {task.isRalphTask && task.ralphProgress && (
                        <RalphProgress progress={task.ralphProgress} className="mb-4" />
                      )}

                      {/* Checkpoint Status - Only show for in-progress tasks, not completed/failed */}
                      {task.hasCheckpoint && task.status !== 'completed' && task.status !== 'failed' && (
                        <CheckpointStatus checkpoint={{
                          hasCheckpoint: task.hasCheckpoint,
                          checkpointStage: task.checkpointStage || null,
                          resumeCount: task.resumeCount || 0,
                          checkpointSavedAt: task.checkpointSavedAt || null,
                        }} className="mb-4" />
                      )}

                      {/* Planning Status - Show when planner is analyzing */}
                      {task.status === "planning" && (
                        <div className="mb-4 p-4 border border-primary/30 rounded-lg bg-primary/5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                                <RefreshCw className="w-4 h-4 text-primary animate-spin" />
                              </div>
                              <div>
                                <h3 className="text-base font-semibold text-foreground">Analyzing PRD...</h3>
                                <p className="text-sm text-muted-foreground">
                                  Project Manager is creating an execution plan
                                </p>
                              </div>
                            </div>
                            <button
                              onClick={() => handleCancelTask(task.id)}
                              disabled={actionLoading === task.id}
                              className="flex items-center gap-2 px-4 py-2 text-red-500 hover:bg-red-500/10 rounded-lg"
                            >
                              {actionLoading === task.id ? (
                                <RefreshCw className="w-4 h-4 animate-spin" />
                              ) : (
                                <Ban className="w-4 h-4" />
                              )}
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Pending Plan Approval (no plan yet) - Show cancel option */}
                      {task.status === "pending_plan_approval" && !task.planJson && (
                        <div className="mb-4 p-4 border border-yellow-500/30 rounded-lg bg-yellow-500/5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center">
                                <AlertCircle className="w-4 h-4 text-yellow-500" />
                              </div>
                              <div>
                                <h3 className="text-base font-semibold text-foreground">Plan Not Available</h3>
                                <p className="text-sm text-muted-foreground">
                                  The execution plan is not loaded. Try refreshing the page.
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => window.location.reload()}
                                className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                              >
                                <RefreshCw className="w-4 h-4" />
                                Refresh
                              </button>
                              <button
                                onClick={() => handleCancelTask(task.id)}
                                disabled={actionLoading === task.id}
                                className="flex items-center gap-2 px-4 py-2 text-red-500 hover:bg-red-500/10 rounded-lg"
                              >
                                {actionLoading === task.id ? (
                                  <RefreshCw className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Ban className="w-4 h-4" />
                                )}
                                Cancel
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Plan Display - Shows for both pending approval (with buttons) and approved plans (read-only) */}
                      {task.planJson && (
                        <div className={`mb-4 p-4 border rounded-lg ${
                          task.status === "pending_plan_approval"
                            ? "border-primary/30 bg-primary/5"
                            : "border-green-500/30 bg-green-500/5"
                        }`}>
                          <div className="flex items-center gap-2 mb-3">
                            <Book className={`w-5 h-5 ${
                              task.status === "pending_plan_approval" ? "text-primary" : "text-green-500"
                            }`} />
                            <h3 className="text-lg font-semibold text-foreground">
                              {task.status === "pending_plan_approval" ? "Execution Plan Ready" : "Approved Execution Plan"}
                            </h3>
                            {task.status === "pending_plan_approval" ? (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                                Awaiting Approval
                              </span>
                            ) : (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-500 flex items-center gap-1">
                                <CheckCircle className="w-3 h-3" />
                                Approved
                              </span>
                            )}
                          </div>

                          {/* Two-column layout: Plan Details (left) | Dependency Graph (right) */}
                          <div className="flex gap-0 mb-4">
                            {/* Left Column - Plan Details */}
                            <div className={`space-y-3 ${task.planJson.stories && task.planJson.stories.length > 1 ? "flex-1 pr-4" : "flex-1"}`}>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-muted-foreground text-sm">Strategy:</span>
                                <span className={`text-sm font-medium px-2 py-0.5 rounded ${
                                  task.planJson.strategy === "multi"
                                    ? "bg-purple-500/20 text-purple-500"
                                    : "bg-blue-500/20 text-blue-500"
                                }`}>
                                  {task.planJson.strategy === "multi" ? "Multi-Story PRD" : "Single Task"}
                                </span>
                                {task.planJson.primaryPersona && (
                                  <span className="text-sm text-muted-foreground">
                                    → {getPersonaInfo(task.planJson.primaryPersona).emoji}{" "}
                                    {getPersonaInfo(task.planJson.primaryPersona).title}
                                  </span>
                                )}
                              </div>

                              <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded border border-border/50">
                                <span className="font-medium text-foreground">Reasoning:</span>{" "}
                                {task.planJson.reasoning}
                              </div>

                              {task.planJson.stories && task.planJson.stories.length > 0 && (
                                <div className="space-y-2">
                                  <span className="text-sm font-medium text-foreground">
                                    Stories ({task.planJson.stories.length}):
                                  </span>
                                  <div className="space-y-1">
                                    {task.planJson.stories.map((story, idx) => (
                                      <div
                                        key={idx}
                                        className="flex items-center gap-2 text-sm text-muted-foreground pl-2 border-l-2 border-border flex-wrap"
                                      >
                                        <span className="font-mono text-xs text-muted-foreground">
                                          {story.index}.
                                        </span>
                                        <span>{getPersonaInfo(story.persona).emoji}</span>
                                        <span className="text-foreground">{story.title}</span>
                                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                                          story.estimatedComplexity === "large"
                                            ? "bg-red-500/20 text-red-500"
                                            : story.estimatedComplexity === "medium"
                                              ? "bg-yellow-500/20 text-yellow-500"
                                              : "bg-green-500/20 text-green-500"
                                        }`}>
                                          {story.estimatedComplexity}
                                        </span>
                                        {story.dependencies.length > 0 && (
                                          <span className="text-xs text-muted-foreground">
                                            (needs: {story.dependencies.join(", ")})
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {task.planJson.qualityGates && task.planJson.qualityGates.length > 0 && (
                                <div className="text-sm">
                                  <span className="font-medium text-foreground">Quality Gates:</span>{" "}
                                  <span className="text-muted-foreground">
                                    {task.planJson.qualityGates.join(", ")}
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Vertical Divider + Right Column - Embedded Dependency Graph */}
                            {task.planJson.stories && task.planJson.stories.length > 1 && (
                              <>
                                <div className="w-px bg-border mx-2 self-stretch" />
                                <div className="flex-shrink-0 pl-2">
                                  <div className="flex items-center gap-2 mb-2">
                                    <Network className="w-4 h-4 text-primary" />
                                    <span className="text-sm font-medium text-foreground">Execution Flow</span>
                                  </div>
                                  <EmbeddedDependencyGraph stories={task.planJson.stories} />
                                </div>
                              </>
                            )}
                          </div>

                          {/* Action Buttons - Only show when pending approval */}
                          {task.status === "pending_plan_approval" && (
                            <>
                              {/* Feedback Input (when requesting changes) */}
                              {showFeedbackInput === task.id && (
                                <div className="mb-4">
                                  <textarea
                                    value={planFeedbackInput[task.id] || ""}
                                    onChange={(e) =>
                                      setPlanFeedbackInput((prev) => ({
                                        ...prev,
                                        [task.id]: e.target.value,
                                      }))
                                    }
                                    placeholder="Describe what changes you'd like to the plan..."
                                    className="w-full p-3 text-sm border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary focus:border-transparent"
                                    rows={3}
                                  />
                                </div>
                              )}

                              <div className="flex items-center gap-3">
                                <button
                                  onClick={() => handleApprovePlan(task.id)}
                                  disabled={actionLoading === task.id}
                                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-medium"
                                >
                                  {actionLoading === task.id ? (
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <CheckCircle className="w-4 h-4" />
                                  )}
                                  Approve & Execute
                                </button>

                                {showFeedbackInput === task.id ? (
                                  <>
                                    <button
                                      onClick={() => handleRequestPlanChanges(task.id)}
                                      disabled={actionLoading === task.id || !planFeedbackInput[task.id]?.trim()}
                                      className="flex items-center gap-2 px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 disabled:opacity-50 font-medium"
                                    >
                                      <Send className="w-4 h-4" />
                                      Send Feedback
                                    </button>
                                    <button
                                      onClick={() => setShowFeedbackInput(null)}
                                      className="px-4 py-2 text-muted-foreground hover:text-foreground"
                                    >
                                      Cancel
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    onClick={() => setShowFeedbackInput(task.id)}
                                    className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                                  >
                                    <Sliders className="w-4 h-4" />
                                    Request Changes
                                  </button>
                                )}

                                <button
                                  onClick={() => handleCancelTask(task.id)}
                                  disabled={actionLoading === task.id}
                                  className="ml-auto flex items-center gap-2 px-4 py-2 text-red-500 hover:bg-red-500/10 rounded-lg"
                                >
                                  <Ban className="w-4 h-4" />
                                  Cancel
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {/* Terminal Toggle Button */}
                      <div className="flex items-center justify-between mb-2">
                        <button
                          onClick={() => toggleTerminal(task.id, task.status)}
                          className="flex items-center gap-2 px-2 py-1 text-xs rounded border border-border hover:bg-muted transition-colors"
                        >
                          <Terminal className="w-3 h-3" />
                          {isTerminalVisible ? "Hide" : "Show"} Terminal Output
                          {isTerminalVisible && (
                            <span className="flex items-center gap-1 text-green-500">
                              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                              LIVE
                            </span>
                          )}
                        </button>
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

                      {/* Terminal Output - streaming from CloudWatch */}
                      {isTerminalVisible && (
                        <div className="mt-2 terminal-bg border rounded-lg overflow-hidden">
                          {/* Terminal header */}
                          <div className="flex items-center justify-between px-3 py-1.5 terminal-header border-b">
                            <div className="flex items-center gap-2">
                              <div className="flex gap-1.5">
                                <div className="w-3 h-3 rounded-full bg-red-500" />
                                <div className="w-3 h-3 rounded-full bg-yellow-500" />
                                <div className="w-3 h-3 rounded-full bg-green-500" />
                              </div>
                              <span className="text-xs text-gray-400 font-mono">
                                worker-{workerId}
                              </span>
                              <span className="text-xs text-green-400 font-mono">
                                [streaming]
                              </span>
                            </div>
                            <button
                              onClick={() => {
                                const terminalEl = terminalRefs.current[task.id];
                                if (terminalEl) terminalEl.scrollTop = terminalEl.scrollHeight;
                              }}
                              className="text-gray-400 hover:text-white p-1"
                              title="Refresh logs"
                            >
                              <RefreshCw className="w-3 h-3" />
                            </button>
                          </div>
                          {/* Terminal content */}
                          <div
                            ref={(el) => { terminalRefs.current[task.id] = el; }}
                            className="p-3 h-72 overflow-y-auto font-mono text-xs terminal-text leading-relaxed terminal-bg"
                          >
                            {streamingLogs[task.id] && streamingLogs[task.id].length > 0 ? (
                              streamingLogs[task.id]
                              .map((log) => ({
                                ...log,
                                // Strip whitespace and collapse multiple newlines to single newlines
                                message: log.message.trim().replace(/\n{2,}/g, '\n')
                              }))
                              .filter((log) => log.message.length > 0) // Skip empty messages
                              .map((log, idx) => {
                                // Color based on message content
                                const msg = log.message;
                                const colorClass =
                                  msg.includes("[ERROR]") || msg.includes("Error") || msg.includes("error:")
                                    ? "text-red-400"
                                    : msg.includes("[WARN]") || msg.includes("Warning")
                                      ? "text-yellow-400"
                                      : msg.includes("[worker]") || msg.includes("Claude") || msg.includes("Starting")
                                        ? "text-cyan-400"
                                        : msg.includes("[SUCCESS]") || msg.includes("Completed") || msg.includes("success")
                                          ? "text-green-400"
                                          : msg.startsWith("$") || msg.includes("npm ") || msg.includes("git ")
                                            ? "text-purple-400"
                                            : "text-gray-300";

                                return (
                                  <div key={idx} className={`whitespace-pre-wrap break-all ${colorClass}`}>
                                    {msg}
                                  </div>
                                );
                              })
                            ) : (
                              <div className="text-gray-500 flex items-center gap-2">
                                <RefreshCw className="w-3 h-3 animate-spin" />
                                Loading logs...
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="p-12 text-center">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                    <Clock className="w-8 h-8 text-primary/50" />
                  </div>
                  <p className="text-muted-foreground font-medium">No active workflows</p>
                  <p className="text-sm text-muted-foreground/60 mt-1">Workflows will appear here when workers are executing</p>
                </div>
              )}
            </div>
          </div>

        {/* All Tasks */}
        <div className="card-elevated border border-border/50 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border/50 bg-gradient-to-r from-muted/30 to-transparent flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Clock className="w-5 h-5 text-muted-foreground" />
              All Tasks
              {searchQuery && (
                <span className="text-sm font-normal text-muted-foreground">
                  (filtered)
                </span>
              )}
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="text-left p-3">Task</th>
                  <th className="text-left p-3">Time</th>
                  <th className="text-left p-3 min-w-[300px]">Summary</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">Workflow</th>
                  <th className="text-left p-3">Model</th>
                  <th className="text-left p-3">Persona</th>
                  <th className="text-left p-3">Links</th>
                  <th className="text-left p-3">Retries</th>
                  <th className="text-left p-3">Cost</th>
                  <th className="text-left p-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data?.recentCompleted && data.recentCompleted.length > 0 ? (
                  data.recentCompleted
                    .filter((task) => {
                      if (!searchQuery) return true;
                      const query = searchQuery.toLowerCase();
                      return (
                        task.jiraIssueKey.toLowerCase().includes(query) ||
                        task.summary.toLowerCase().includes(query) ||
                        task.status.toLowerCase().includes(query) ||
                        (task.workerPersona && task.workerPersona.toLowerCase().includes(query))
                      );
                    })
                    .map((task) => {
                    const personaInfo = getPersonaInfo(task.workerPersona || "");
                    const prNumber = task.githubPrUrl?.match(/\/pull\/(\d+)/)?.[1];
                    return (
                      <tr key={task.id} className="hover:bg-muted/30">
                        {/* Task - Clickable Jira key */}
                        <td className="p-3">
                          <a
                            href={`https://oncallshift.atlassian.net/browse/${task.jiraIssueKey}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-primary hover:underline flex items-center gap-1"
                          >
                            {task.jiraIssueKey}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </td>
                        {/* Time */}
                        <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                          {(() => {
                            const ts = formatTimestamp(task.createdAt);
                            if (!ts) return "-";
                            return (
                              <div className="leading-tight">
                                <div>{ts.date}</div>
                                <div>{ts.time}</div>
                              </div>
                            );
                          })()}
                        </td>
                        {/* Summary */}
                        <td className="p-3">
                          <div className="text-sm text-foreground truncate max-w-md">
                            {task.summary}
                          </div>
                        </td>
                        {/* Status */}
                        <td className="p-3">
                          <div className="flex flex-col gap-0.5">
                            <span
                              className={`flex items-center gap-1 ${getStatusColor(task.status)}`}
                            >
                              {task.status === "completed" || task.status === "deployed" ? (
                                <CheckCircle className="w-4 h-4" />
                              ) : task.status === "failed" || task.status === "review_rejected" ? (
                                <XCircle className="w-4 h-4" />
                              ) : task.status === "cancelled" ? (
                                <XCircle className="w-4 h-4" />
                              ) : task.status === "review_requested" || task.status === "pr_created" ? (
                                <GitBranch className="w-4 h-4" />
                              ) : task.status === "manager_review" ? (
                                <Users className="w-4 h-4" />
                              ) : task.status === "review_approved" || task.status === "pr_approved" ? (
                                <Star className="w-4 h-4" />
                              ) : task.status === "deploying" || task.status === "deployment_pending" ? (
                                <Rocket className="w-4 h-4 animate-pulse" />
                              ) : task.status === "executing" ? (
                                <Activity className="w-4 h-4 animate-pulse" />
                              ) : task.status === "revision_needed" ? (
                                <RefreshCw className="w-4 h-4" />
                              ) : task.status === "planning" ? (
                                <Cog className="w-4 h-4 animate-spin" />
                              ) : task.status === "pending_plan_approval" ? (
                                <Eye className="w-4 h-4" />
                              ) : ["queued", "claimed", "environment_setup"].includes(task.status) ? (
                                <Clock className="w-4 h-4 animate-pulse" />
                              ) : (
                                <Clock className="w-4 h-4" />
                              )}
                              {task.status === "planning" ? "Planning" :
                               task.status === "pending_plan_approval" ? "Awaiting Approval" :
                               task.status === "environment_setup" ? "Setting Up" :
                               task.status === "review_requested" ? "Review Requested" :
                               task.status === "pr_created" ? "PR Created" :
                               task.status === "manager_review" ? "Manager Review" :
                               task.status === "review_approved" ? "Approved" :
                               task.status === "pr_approved" ? "PR Approved" :
                               task.status === "review_rejected" ? "Rejected" :
                               task.status === "revision_needed" ? "Revision Needed" :
                               task.status === "deployment_pending" ? "Deployment Pending" :
                               task.status.replace(/_/g, " ").charAt(0).toUpperCase() + task.status.replace(/_/g, " ").slice(1)}
                            </span>
                          </div>
                        </td>
                        {/* Workflow */}
                        <td className="p-3">
                          {(() => {
                            const badge = getWorkflowModeBadge(task.workflowMode);
                            const BadgeIcon = badge.icon;
                            return (
                              <span className={`text-xs px-2 py-0.5 rounded-full border flex items-center gap-1 whitespace-nowrap ${badge.color}`}>
                                <BadgeIcon className="w-3 h-3" />
                                {badge.label}
                              </span>
                            );
                          })()}
                        </td>
                        {/* Model */}
                        <td className="p-3">
                          <span className={`text-sm ${
                            task.workerModel?.includes("opus") ? "text-purple-400" :
                            task.workerModel?.includes("sonnet") ? "text-cyan-400" :
                            "text-green-400"
                          }`}>
                            {formatModelName(task.workerModel)}
                          </span>
                        </td>
                        {/* Persona */}
                        <td className="p-3">
                          <span className="text-sm text-muted-foreground">
                            {personaInfo.title.toLowerCase()}
                          </span>
                        </td>
                        {/* Links (PR + Logs) */}
                        <td className="p-3">
                          <div className="flex items-center gap-2 text-sm">
                            {task.githubPrUrl && prNumber && (
                              <a
                                href={task.githubPrUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-purple-400 hover:underline"
                              >
                                <GitBranch className="w-3 h-3" />
                                PR#{prNumber}
                              </a>
                            )}
                            {task.githubPrUrl && prNumber && task.ecsTaskId && (
                              <span className="text-muted-foreground">→</span>
                            )}
                            {task.ecsTaskId && (
                              <a
                                href={`https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#logsV2:log-groups/log-group/$252Fecs$252Fworkermill-dev$252Fworker/log-events/worker$252Fworker$252F${task.ecsTaskId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-cyan-500 hover:underline"
                              >
                                Logs
                              </a>
                            )}
                            {!task.ecsTaskId && !task.githubPrUrl && (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </div>
                        </td>
                        {/* Retries */}
                        <td className="p-3 text-sm text-muted-foreground">
                          {task.retryCount ?? 0}/3
                        </td>
                        {/* Cost */}
                        <td className="p-3 text-sm font-medium">
                          ${formatCost(task.costUsd)}
                        </td>
                        {/* Actions */}
                        <td className="p-3">
                          <div className="flex items-center gap-1">
                            {/* View Details (Eye icon) */}
                            <button
                              onClick={() => setSelectedTask(task)}
                              className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
                              title="View Details"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            {/* Retry button for terminal/waiting states */}
                            {["failed", "completed", "no_changes", "review_requested", "escalated", "cancelled", "deployed", "pr_approved", "pr_created"].includes(task.status) && (
                              <button
                                onClick={() => handleRetryTask(task.id)}
                                disabled={actionLoading === task.id}
                                className="p-1.5 hover:bg-blue-500/10 rounded text-blue-400"
                                title="Retry Task"
                              >
                                {actionLoading === task.id ? (
                                  <RefreshCw className="w-4 h-4 animate-spin" />
                                ) : (
                                  <RotateCcw className="w-4 h-4" />
                                )}
                              </button>
                            )}
                            {["queued", "claimed", "executing", "environment_setup", "planning", "pending_plan_approval", "dispatching"].includes(task.status) ? (
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
                            ) : (
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
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={11} className="p-8 text-center text-muted-foreground">
                      No tasks yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
          </ErrorBoundaryWithRetry>
        </main>

        {/* Right Sidebar - Coordination Feed */}
        {selectedParentTaskId && (
          <CoordinationFeed
            parentTaskId={selectedParentTaskId}
            onAnswerQuestion={handleAnswerQuestion}
          />
        )}
      </div>

      {/* Create Task Modal */}
      {showCreateTaskModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card-elevated border border-border/50 rounded-xl w-full max-w-md glow-mixed">
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
                className="px-3 py-2 bg-blue-500/10 text-blue-500 border border-blue-500/30 rounded-lg hover:bg-blue-500/20 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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

      {/* Task Details Modal */}
      {selectedTask && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-xl w-full max-w-lg mx-4 shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-3">
                <a
                  href={`https://oncallshift.atlassian.net/browse/${selectedTask.jiraIssueKey}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline font-semibold flex items-center gap-1"
                >
                  {selectedTask.jiraIssueKey}
                  <ExternalLink className="w-3 h-3" />
                </a>
                <span className={`text-sm ${getStatusColor(selectedTask.status)}`}>
                  {selectedTask.status}
                </span>
              </div>
              <button
                onClick={() => setSelectedTask(null)}
                className="p-1 hover:bg-muted rounded transition-colors"
              >
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-4">
              {/* Summary */}
              <p className="text-foreground">{selectedTask.summary}</p>

              {/* Stats Grid */}
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">Retries</div>
                  <div className="font-semibold">{selectedTask.retryCount ?? 0}/3</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Cost</div>
                  <div className="font-semibold">${formatCost(selectedTask.costUsd)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Last Heartbeat</div>
                  <div className="font-semibold">Never</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Global Timeout</div>
                  <div className="font-semibold">Not set</div>
                </div>
              </div>

              {/* Error Message */}
              {selectedTask.status === "failed" && selectedTask.errorMessage && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-red-500 mb-1">
                    <AlertCircle className="w-4 h-4" />
                    <span className="font-semibold">Error</span>
                  </div>
                  <p className="text-red-400 text-sm font-mono">
                    {selectedTask.errorMessage || "Essential container in task exited"}
                  </p>
                </div>
              )}

              {/* Links */}
              {(selectedTask.githubPrUrl || selectedTask.ecsTaskId) && (
                <div className="flex items-center gap-4">
                  {selectedTask.githubPrUrl && (
                    <a
                      href={selectedTask.githubPrUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-sm text-purple-400 hover:underline"
                    >
                      <GitBranch className="w-4 h-4" />
                      View PR
                    </a>
                  )}
                  {selectedTask.ecsTaskId && (
                    <a
                      href={`https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#logsV2:log-groups/log-group/$252Fecs$252Fworkermill-dev$252Fworker/log-events/worker$252Fworker$252F${selectedTask.ecsTaskId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-sm text-cyan-500 hover:underline"
                    >
                      <Terminal className="w-4 h-4" />
                      View Logs
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end gap-2 p-4 border-t border-border">
              {selectedTask.status === "failed" && (
                <button
                  onClick={() => {
                    handleRetryTask(selectedTask.id);
                    setSelectedTask(null);
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Retry
                </button>
              )}
              <button
                onClick={() => setSelectedTask(null)}
                className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Onboarding Wizard */}
      {shouldShowOnboarding && (
        <OnboardingWizard
          onClose={dismissOnboarding}
          onComplete={dismissOnboarding}
        />
      )}

      {/* Log Search Modal */}
      <LogSearch
        isOpen={isLogSearchOpen}
        onClose={() => setIsLogSearchOpen(false)}
      />
    </div>
  );
}

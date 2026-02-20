import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  RefreshCw,
  ExternalLink,
  CheckCircle,
  XCircle,
  Clock,
  DollarSign,
  AlertCircle,
  Activity,
  Terminal,
  GitBranch,
  Play,
  Power,
  Trash2,
  Ban,
  Zap,
  Book,
  Layers,
  Cog,
  GitPullRequest,
  Users,
  Eye,
  X,
  Rocket,
  GitMerge,
  Pause,
  Search,
  ChevronDown,
  Wrench,
  Sliders,
  Star,
  RotateCcw,
  LayoutDashboard,
  Send,
  FolderKanban,
  BarChart3,
  PauseCircle,
  Network,
  MessageSquare,
  Wifi,
  WifiOff,
  Sparkles,
  Brain,
  BookOpen,
  TrendingUp,
  AlertTriangle,
  Target,
  Router,
  Library,
  Palette,
  FileSearch,
  Monitor,
  LayoutGrid,
  FileCode,
  ArrowRight,
} from "lucide-react";
import { RalphProgress, RalphProgressCompact } from "../../components/RalphProgress";
import type { PlanningProgressData } from "../../components/PlanningProgress";
import { PlanningTerminalBar } from "../../components/PlanningProgress";
import { ProfileDropdown } from "../../components/ProfileDropdown";
import { TerminalLogViewer } from "../../components/TerminalLogViewer";
import { CheckpointStatus, CheckpointStatusBadge } from "../../components/CheckpointStatus";
import { LogSearch } from "../../components/LogSearch";
import { OrgSwitcher } from "../../components/OrgSwitcher";
import { useAuthStore } from "../../store/auth-store";
import { OnboardingWizard, useOnboardingState } from "../../components/OnboardingWizard";
import { SetupBanner } from "../../components/SetupBanner";
import { DashboardSkeleton } from "../../components/ui/skeleton";
import {
  ErrorBoundaryWithRetry,
  DashboardErrorFallback,
} from "../../components/ErrorBoundary";
import { EmbeddedDependencyGraph } from "../../components/DependencyGraph";
import { useCoordinationStore, type ContextMessage, type ContextMessageType } from "../../store/coordination-store";
import { TokenBreakdown } from "../../components/TokenBreakdown";
import { BlockerAlert } from "../../components/BlockerAlert";
import {
  PlanningIcon,
  ApprovedIcon,
  ExpertsIcon,
  PRCreatedIcon,
  ReviewIcon,
  DeployedIcon,
  StepsIcon,
  TechLeadReviewIcon,
} from "../../components/icons";
import { LiveCodeViewer, type CodeFile } from "../../components/LiveCodeViewer";
import { useIssueTrackerConfig } from "../../hooks/useIssueTrackerConfig";
import { usePersonas } from "../../hooks/usePersonas";
import { buildTicketUrl } from "../../lib/utils";
import type { ControlCenterData, CompletedTask, ActiveTask, WorkflowMode } from "./types";
import { TERMINAL_STATUSES, API_BASE, PERSONA_CONFIG } from "./types";
import { formatCost, formatModelName, formatProviderName, getDerivedProviders, getDerivedModels, parseLogForError } from "./helpers";
import { EmbeddedCommunicationsFeed } from "./EmbeddedCommunicationsFeed";

export default function Dashboard() {
  const navigate = useNavigate();
  const logout = useAuthStore((state) => state.logout);
  const _user = useAuthStore((state) => state.user);
  const organization = useAuthStore((state) => state.organization);
  const isFreePlan = !organization?.plan || organization.plan === "free";

  // Coordination store for blocker alerts
  const coordinationMessages = useCoordinationStore((s) => s.messages);

  // Detect active rate limit blockers across all tasks
  const rateLimitBlockers = useMemo(() => {
    const blockers = coordinationMessages.filter(
      (m: ContextMessage) =>
        (m.messageType === "blocker_detected" ||
          (m.messageType === "blocker" && m.metadata?.isEscalated === true)) &&
        m.metadata?.errorCategory === "rate_limit",
    );
    const resolvedIds = new Set(
      coordinationMessages
        .filter(
          (m: ContextMessage) =>
            m.messageType === "blocker_resolved" ||
            (m.messageType === "answer" && m.metadata?.blockerAction),
        )
        .map(
          (m: ContextMessage) =>
            (m.metadata?.blockerId as string) || m.id,
        )
        .filter(Boolean),
    );
    return blockers.filter((m: ContextMessage) => !resolvedIds.has(m.id));
  }, [coordinationMessages]);

  // Persona metadata from API with fallback
  const personas = usePersonas();
  const personaEmojis = Object.fromEntries(
    Object.entries(personas).map(([slug, meta]) => [slug, meta.emoji || ""]),
  );
  const personaMap = Object.fromEntries(
    Object.entries(personas).map(([slug, meta]) => [
      slug,
      { emoji: meta.emoji || "", shortLabel: meta.shortLabel || slug },
    ]),
  );

  // Always start fresh - no cached data to avoid showing stale data on refresh
  // Fresh data loads in <1 second, so showing loading state is better than stale data
  const [data, setData] = useState<ControlCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Planning progress stored separately so polling `setData(result)` can't wipe it out
  const [planningProgress, setPlanningProgress] = useState<Record<string, PlanningProgressData>>({});
  // Streaming logs state - includes full log details
  interface StreamingLog {
    timestamp: number;
    message: string;
    logType?: string;
    severity?: string;
    command?: string;
    exitCode?: number;
    metadata?: {
      errorType?: "fatal" | "recoverable";
      [key: string]: unknown;
    };
  }

  interface ParsedError {
    timestamp: number;
    type: "error" | "warning";
    category: string; // TypeScript, Git, npm, Test, Network, etc.
    message: string;
    file?: string;
    line?: number;
    logIndex: number; // Index in streamingLogs array for jumping
  }

  const [streamingLogs, setStreamingLogs] = useState<Record<string, StreamingLog[]>>({});
  const [parsedErrors, setParsedErrors] = useState<Record<string, ParsedError[]>>({});
  // Persisted errors from database (survives client re-init)
  const [persistedErrors, setPersistedErrors] = useState<Record<string, ParsedError[]>>({});
  // Track which comms panels are expanded
  const [errorPanelExpanded, setErrorPanelExpanded] = useState<Record<string, boolean>>({});
  // Track unread comms message count per task (shown as badge on Comms panel)
  const [unreadCommsCount, setUnreadCommsCount] = useState<Record<string, number>>({});
  // Track whether comms panel has already auto-expanded per task (only expand once)
  const hasAutoExpandedCommsRef = useRef<Record<string, boolean>>({});
  // Track previous error counts to detect new errors
  const prevErrorCountsRef = useRef<Record<string, number>>({});
  // Track previous comms message counts to detect new messages (mirrors error auto-expand pattern)
  const prevCommsCountsRef = useRef<Record<string, number>>({});
  const logEventSources = useRef<Record<string, EventSource>>({});
  const terminalRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Cursor tracking for SSE resume (using refs to avoid re-renders)
  const terminalCursorsRef = useRef<Record<string, string | null>>({});
  const terminalSeenEventIdsRef = useRef<Record<string, Set<string>>>({});
  // Polling fallback timers
  const pollIntervalsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  // Track which terminals are actively streaming (state updates used, value reserved for future UI indicators)
  const [_streamingTerminals, setStreamingTerminals] = useState<Set<string>>(new Set());

  // Real-time cost tracking for trend indicator and ceiling warnings
  const prevCostsRef = useRef<Record<string, number>>({});
  const costCeilingInfoRef = useRef<Record<string, { percent: number; ceiling: number }>>({});

  // Track last log received time per task for worker offline detection
  const lastLogTimeRef = useRef<Record<string, number>>({});
  const [workerOffline, setWorkerOffline] = useState<Record<string, boolean>>({});

  // Track hidden terminals (for active tasks that user manually collapsed)
  const [hiddenTerminals, setHiddenTerminals] = useState<Set<string>>(new Set());
  // Track shown terminals (for completed tasks that user manually expanded)
  const [shownTerminals, setShownTerminals] = useState<Set<string>>(new Set());
  // Auto-scroll toggle for terminal output
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);

  // Live Code Viewer state
  const [codeFiles, setCodeFiles] = useState<Record<string, Record<string, CodeFile>>>({});
  const [selectedCodeFile, setSelectedCodeFile] = useState<Record<string, string | null>>({});
  const [terminalTab, setTerminalTab] = useState<Record<string, "terminal" | "code">>({});
  const userSelectedFileRef = useRef<Record<string, boolean>>({});

  // Task detail modal
  const [selectedTask, setSelectedTask] = useState<CompletedTask | null>(null);
  const [taskModalTab, setTaskModalTab] = useState<"details" | "logs">("details");

  // System status
  const [systemEnabled, setSystemEnabled] = useState(true);
  const [systemToggleLoading, setSystemToggleLoading] = useState(false);

  // Auto-workflow toggles (from org settings)
  const [autoReviewEnabled, setAutoReviewEnabled] = useState(false);
  const [autoDeployEnabled, setAutoDeployEnabled] = useState(false);
  const [autoImproveEnabled, setAutoImproveEnabled] = useState(false);
  const [remoteAgentOnly, setRemoteAgentOnly] = useState(false);
  const [hasRemoteAgent, setHasRemoteAgent] = useState(false);
  const [remoteAgentOnline, setRemoteAgentOnline] = useState(false);
  const [remoteAgentHostname, setRemoteAgentHostname] = useState<string | null>(null);
  const [autoToggleLoading, setAutoToggleLoading] = useState<"review" | "deploy" | "improve" | "localMode" | null>(null);

  // Action states
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [_resetCountersLoading, setResetCountersLoading] = useState(false);

  // Action buttons state
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  const [taskSource, setTaskSource] = useState<"external" | "internal">("external");
  const [createTaskForm, setCreateTaskForm] = useState({
    jiraIssueKey: "",
    workerPersona: "", // Empty = auto/dynamic routing (Epic/Multi-Provider modes)
  });
  const [createLoading, setCreateLoading] = useState(false);
  const [costEstimate, setCostEstimate] = useState<{
    tier: string;
    costRange: { min: number; max: number };
    tokenRange: { min: number; max: number };
    confidence: string;
    tierDescription: string;
    historicalBasis: number;
  } | null>(null);
  const [costEstimateLoading, setCostEstimateLoading] = useState(false);

  // Internal project state for Run Task modal
  const [internalProjects, setInternalProjects] = useState<Array<{ id: string; key: string; name: string }>>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [internalTasks, setInternalTasks] = useState<Array<{ taskKey: string; title: string; persona: string | null; columnType: string }>>([]);
  const [selectedTaskKey, setSelectedTaskKey] = useState<string>("");
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(false);

  // SSE connection state
  const [_sseConnected, setSseConnected] = useState(false);

  // Log search state
  const [isLogSearchOpen, setIsLogSearchOpen] = useState(false);

  // Talk to Worker state - now task-scoped
  const [isTalkOpen, setIsTalkOpen] = useState(false);
  const [talkMessage, setTalkMessage] = useState("");
  const [talkLoading, setTalkLoading] = useState(false);
  const [talkTargetTaskId, setTalkTargetTaskId] = useState<string | null>(null);
  const [talkTargetTaskTitle, setTalkTargetTaskTitle] = useState<string>("");
  const [isEfficiencyDropdownOpen, setIsEfficiencyDropdownOpen] = useState(false);
  const efficiencyDropdownRef = useRef<HTMLDivElement>(null);

  // Actions dropdown state for All Tasks table
  const [openActionMenu, setOpenActionMenu] = useState<string | null>(null);

  // Issue tracker configuration (fetched and cached via shared hook)
  const issueTrackerConfig = useIssueTrackerConfig();

  // Keyboard shortcut for search (Cmd/Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsLogSearchOpen(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);


  // Close efficiency dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (efficiencyDropdownRef.current && !efficiencyDropdownRef.current.contains(event.target as Node)) {
        setIsEfficiencyDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Parse errors from streaming logs, task-level errors, and persisted errors
  useEffect(() => {
    const newParsedErrors: Record<string, ParsedError[]> = {};
    const tasksWithNewErrors: string[] = [];

    // Helper to create a dedup key for errors
    const errorKey = (e: ParsedError) => `${e.timestamp}|${e.message}`;

    // First, add task-level errors (from task.errorMessage) as the primary error
    // These are the most important - they explain why the task failed
    if (data?.activeTasks) {
      for (const task of data.activeTasks) {
        if (task.status === "failed") {
          // Show the task-level error if available, otherwise show generic failure message
          const errorMsg = task.errorMessage || "Task failed - check logs for details";
          const errors: ParsedError[] = [{
            timestamp: task.completedAt ? new Date(task.completedAt).getTime() : Date.now(),
            type: "error",
            category: "Task Failed",
            message: errorMsg,
            logIndex: -1, // -1 indicates task-level error (not from logs)
          }];
          newParsedErrors[task.id] = errors;
        }
      }
    }

    // Then, add errors parsed from streaming logs
    for (const [taskId, logs] of Object.entries(streamingLogs)) {
      const errors: ParsedError[] = newParsedErrors[taskId] || [];

      logs.forEach((log, idx) => {
        const parsed = parseLogForError(log.message, log.severity, log.logType);
        if (parsed) {
          errors.push({
            timestamp: log.timestamp,
            type: parsed.type,
            category: parsed.category,
            message: parsed.message,
            file: parsed.file,
            line: parsed.line,
            logIndex: idx,
          });
        }
      });
      if (errors.length > 0) {
        newParsedErrors[taskId] = errors;
      }
    }

    // Finally, merge in persisted errors (from database) - survives client re-init
    // Deduplicate by timestamp+message to avoid showing same error twice
    for (const [taskId, persisted] of Object.entries(persistedErrors)) {
      const existing = newParsedErrors[taskId] || [];
      const existingKeys = new Set(existing.map(errorKey));

      // Add persisted errors that aren't already in the list
      const newFromPersisted = persisted.filter(e => !existingKeys.has(errorKey(e)));
      if (newFromPersisted.length > 0) {
        const merged = [...existing, ...newFromPersisted];
        // Sort by timestamp
        merged.sort((a, b) => a.timestamp - b.timestamp);
        newParsedErrors[taskId] = merged;
      }
    }

    // Check for new errors and track counts
    for (const [taskId, errors] of Object.entries(newParsedErrors)) {
      const prevCount = prevErrorCountsRef.current[taskId] || 0;
      if (errors.length > prevCount) {
        tasksWithNewErrors.push(taskId);
      }
      prevErrorCountsRef.current[taskId] = errors.length;
    }

    setParsedErrors(newParsedErrors);

    // Auto-expand error panels for tasks with new errors
    if (tasksWithNewErrors.length > 0) {
      setErrorPanelExpanded(prev => {
        const updated = { ...prev };
        tasksWithNewErrors.forEach(taskId => {
          updated[taskId] = true;
        });
        return updated;
      });
    }
  }, [streamingLogs, data?.activeTasks, persistedErrors]);

  // Auto-expand comms panel when new coordination messages arrive (mirrors error auto-expand pattern)
  // Runs at component level so it works regardless of isTerminalVisible
  useEffect(() => {
    if (!data?.activeTasks) return;

    const activeTaskIds = new Set(data.activeTasks.map((t) => t.id));

    for (const taskId of activeTaskIds) {
      const taskMessages = coordinationMessages.filter(
        (m) => m.parentTaskId === taskId && m.messageType !== "story_ready"
      );
      const count = taskMessages.length;
      const prevCount = prevCommsCountsRef.current[taskId] || 0;

      if (count > prevCount && prevCount > 0) {
        // New message arrived after initial load — increment unread badge
        if (hasAutoExpandedCommsRef.current[taskId]) {
          setUnreadCommsCount((prev) => ({
            ...prev,
            [taskId]: (prev[taskId] || 0) + (count - prevCount),
          }));
        }
      }

      if (count > 0 && !hasAutoExpandedCommsRef.current[taskId]) {
        // First message(s) for this task — auto-expand
        hasAutoExpandedCommsRef.current[taskId] = true;

        // Make the terminal section visible — but NOT for terminal-status tasks
        // (tasks in pr_approved/review_approved/etc. should stay collapsed)
        const task = data.activeTasks.find((t) => t.id === taskId);
        if (task && !TERMINAL_STATUSES.includes(task.status)) {
          setHiddenTerminals((prev) => {
            if (!prev.has(taskId)) return prev;
            const next = new Set(prev);
            next.delete(taskId);
            return next;
          });
        }

        // Expand the side panel
        setErrorPanelExpanded((prev) => ({ ...prev, [taskId]: true }));
      }

      prevCommsCountsRef.current[taskId] = count;
    }
  }, [coordinationMessages, data?.activeTasks]);

  // Auto-collapse terminals when tasks transition to terminal status
  // Removes stale entries from shownTerminals so completed tasks stay collapsed
  useEffect(() => {
    if (!data?.activeTasks) return;
    const terminalTaskIds = data.activeTasks
      .filter((t) => TERMINAL_STATUSES.includes(t.status))
      .map((t) => t.id);
    if (terminalTaskIds.length === 0) return;

    setShownTerminals((prev) => {
      const toRemove = terminalTaskIds.filter((id) => prev.has(id));
      if (toRemove.length === 0) return prev;
      const next = new Set(prev);
      for (const id of toRemove) next.delete(id);
      return next;
    });
  }, [data?.activeTasks]);

  // Onboarding state
  const { shouldShowOnboarding, dismissOnboarding, resetOnboarding } = useOnboardingState();

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
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to load data";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [logout, navigate]);

  // Fetch org settings for auto-workflow toggles
  const fetchOrgSettings = useCallback(async () => {
    try {
      const token = localStorage.getItem("accessToken");
      if (!token) return;

      const response = await fetch(`${API_BASE}/api/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const settings = await response.json();
        setAutoReviewEnabled(settings.autoReviewEnabled ?? false);
        setAutoDeployEnabled(settings.autoDeployEnabled ?? false);
        setAutoImproveEnabled(settings.autoImproveEnabled ?? false);
        setRemoteAgentOnly(settings.remoteAgentOnly ?? false);
        setHasRemoteAgent(settings.hasRemoteAgent ?? false);
        setRemoteAgentOnline(settings.remoteAgentOnline ?? false);
        setRemoteAgentHostname(settings.remoteAgentHostname ?? null);
      }
    } catch (err) {
      console.error("Failed to fetch org settings:", err);
    }
  }, []);

  // Toggle auto-review setting
  const toggleAutoReview = async () => {
    setAutoToggleLoading("review");
    try {
      const token = localStorage.getItem("accessToken");
      const newValue = !autoReviewEnabled;
      const response = await fetch(`${API_BASE}/api/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ autoReviewEnabled: newValue }),
      });

      if (response.ok) {
        setAutoReviewEnabled(newValue);
        setActionSuccess(`PR-Review ${newValue ? "enabled" : "disabled"}`);
        setTimeout(() => setActionSuccess(null), 3000);
      } else {
        const err = await response.json();
        setActionError(err.error || "Failed to update PR-Review setting");
        setTimeout(() => setActionError(null), 5000);
      }
    } catch (_err) {
      setActionError("Failed to update PR-Review setting");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setAutoToggleLoading(null);
    }
  };

  // Toggle auto-deploy setting
  const toggleAutoDeploy = async () => {
    setAutoToggleLoading("deploy");
    try {
      const token = localStorage.getItem("accessToken");
      const newValue = !autoDeployEnabled;
      const response = await fetch(`${API_BASE}/api/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ autoDeployEnabled: newValue }),
      });

      if (response.ok) {
        setAutoDeployEnabled(newValue);
        setActionSuccess(`Auto-deploy ${newValue ? "enabled" : "disabled"}`);
        setTimeout(() => setActionSuccess(null), 3000);
      } else {
        const err = await response.json();
        setActionError(err.error || "Failed to update auto-deploy setting");
        setTimeout(() => setActionError(null), 5000);
      }
    } catch (_err) {
      setActionError("Failed to update auto-deploy setting");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setAutoToggleLoading(null);
    }
  };

  // Toggle auto-improve setting
  const toggleAutoImprove = async () => {
    setAutoToggleLoading("improve");
    try {
      const token = localStorage.getItem("accessToken");
      const newValue = !autoImproveEnabled;
      const response = await fetch(`${API_BASE}/api/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ autoImproveEnabled: newValue }),
      });

      if (response.ok) {
        setAutoImproveEnabled(newValue);
        setActionSuccess(`Anneal ${newValue ? "enabled" : "disabled"}`);
        setTimeout(() => setActionSuccess(null), 3000);
      } else {
        const err = await response.json();
        setActionError(err.error || "Failed to update anneal setting");
        setTimeout(() => setActionError(null), 5000);
      }
    } catch (_err) {
      setActionError("Failed to update anneal setting");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setAutoToggleLoading(null);
    }
  };

  // Toggle local mode (remote agent only) setting
  const toggleLocalMode = async () => {
    setAutoToggleLoading("localMode");
    try {
      const token = localStorage.getItem("accessToken");
      const newValue = !remoteAgentOnly;
      const response = await fetch(`${API_BASE}/api/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ remoteAgentOnly: newValue }),
      });

      if (response.ok) {
        setRemoteAgentOnly(newValue);
        setActionSuccess(`Local Mode ${newValue ? "enabled" : "disabled"}`);
        setTimeout(() => setActionSuccess(null), 3000);
      } else {
        const err = await response.json();
        setActionError(err.error || "Failed to update Local Mode setting");
        setTimeout(() => setActionError(null), 5000);
      }
    } catch (_err) {
      setActionError("Failed to update Local Mode setting");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setAutoToggleLoading(null);
    }
  };

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
    // First fetch full data and org settings
    fetchData();
    fetchOrgSettings();

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
          // Update systemEnabled from SSE for real-time maintenance mode sync
          if (update.systemStatus) {
            setSystemEnabled(update.systemStatus.systemEnabled);
          }

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
              systemStatus: update.systemStatus,
            };
          });
        }

        // Handle real-time cost updates for immediate cost tracking
        if (update.type === "cost") {
          const { taskId, estimatedCostUsd, costCeilingPercent, perTaskCostCeilingUsd } = update;

          // Track cost trend (is it increasing?)
          const prevCost = prevCostsRef.current[taskId] || 0;
          const costIncreased = estimatedCostUsd > prevCost;
          prevCostsRef.current[taskId] = estimatedCostUsd;

          // Store ceiling info for display
          if (costCeilingPercent !== undefined && perTaskCostCeilingUsd) {
            costCeilingInfoRef.current[taskId] = {
              percent: costCeilingPercent,
              ceiling: perTaskCostCeilingUsd,
            };
          }

          // Update task with new cost and trend indicator
          setData((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              activeTasks: prev.activeTasks.map((task) =>
                task.id === taskId
                  ? {
                      ...task,
                      estimatedCostUsd,
                      costTrend: costIncreased ? "up" : undefined,
                      costCeilingPercent,
                    }
                  : task
              ),
            };
          });

          // Clear cost trend after 2 seconds
          if (costIncreased) {
            setTimeout(() => {
              setData((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  activeTasks: prev.activeTasks.map((task) =>
                    task.id === taskId ? { ...task, costTrend: undefined } : task
                  ),
                };
              });
            }, 2000);
          }
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
  }, [fetchData, fetchOrgSettings]);

  // Fetch persisted errors from API (survives client re-init)
  const fetchPersistedErrors = useCallback(async (taskId: string) => {
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/control-center/errors/${taskId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const result = await response.json();
        const errors: ParsedError[] = (result.errors || []).map((e: {
          timestamp: number;
          type: string;
          category: string;
          message: string;
          file?: string;
          line?: number;
        }) => ({
          timestamp: e.timestamp,
          type: e.type as "error" | "warning",
          category: e.category,
          message: e.message,
          file: e.file,
          line: e.line,
          logIndex: -2, // -2 indicates persisted error (from database)
        }));

        if (errors.length > 0) {
          setPersistedErrors(prev => ({
            ...prev,
            [taskId]: errors,
          }));
        }
      }
    } catch (err) {
      console.error("Failed to fetch persisted errors:", err);
    }
  }, []);

  // Fetch terminal logs from REST API
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
              // Build event ID for deduplication
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
            .map((log: { timestamp: string; message: string; cursor?: string; logType?: string; severity?: string; command?: string; exitCode?: number; metadata?: { errorType?: "fatal" | "recoverable"; [key: string]: unknown } }) => ({
              timestamp: new Date(log.timestamp).getTime(),
              message: log.message,
              logType: log.logType,
              severity: log.severity,
              command: log.command,
              exitCode: log.exitCode,
              metadata: log.metadata,
            }));

          if (logLines.length > 0) {
            setStreamingLogs((prev) => {
              // If no cursor (initial fetch), REPLACE logs
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

  // Start SSE log streaming for a task - uses database stream
  const startLogStream = useCallback((taskId: string) => {
    // Don't start if already streaming
    if (logEventSources.current[taskId]) return;

    const token = localStorage.getItem("accessToken");
    if (!token) return;

    // Build URL with cursor for resume support
    const tokenParam = `token=${encodeURIComponent(token)}`;
    const sinceCursor = terminalCursorsRef.current[taskId];
    const sinceParam = sinceCursor ? `since=${encodeURIComponent(sinceCursor)}` : "";
    const query = [tokenParam, sinceParam].filter(Boolean).join("&");
    const url = `${API_BASE}/api/control-center/logs/${taskId}/stream?${query}`;

    // CRITICAL: Fetch initial logs FIRST, then connect to SSE for new logs
    fetchTerminalLogs(taskId);
    // Also fetch persisted errors (survives client re-init)
    fetchPersistedErrors(taskId);

    const eventSource = new EventSource(url);

    // Handle ping events (keep-alive)
    eventSource.addEventListener("ping", () => {
      // Connection is alive, nothing to do
    });

    // Handle log events - works for both CloudWatch and database streams
    const onLogEvent = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        // Event ID for deduplication and cursor tracking
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
          metadata: data.metadata,
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

        // Track last log time for worker offline detection
        lastLogTimeRef.current[taskId] = Date.now();
        setWorkerOffline((prev) => prev[taskId] ? { ...prev, [taskId]: false } : prev);

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

    // Handle planning progress events (stored separately so polling can't wipe it)
    eventSource.addEventListener("planning_progress", (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        setPlanningProgress((prev) => ({
          ...prev,
          [taskId]: {
            phase: data.phase,
            elapsedSeconds: data.elapsedSeconds,
            detail: data.detail,
            charsGenerated: data.charsGenerated,
            toolCallCount: data.toolCallCount,
          } as PlanningProgressData,
        }));
      } catch (err) {
        console.error("Error parsing planning progress SSE data:", err);
      }
    });

    // Handle code events for Live Code Viewer (ephemeral, in-memory only)
    eventSource.addEventListener("code_event", (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        // Normalize: strip /workspace/worktrees/<expert>/ or /workspace/<repo>/ prefix
        const rawPath = data.filePath as string;
        const filePath =
          rawPath.replace(
            /^\/workspace\/worktrees\/[^/]+\//, "",
          ).replace(
            /^\/workspace\/[^/]+\//, "",
          ) || rawPath;
        const toolName = data.toolName as "Write" | "Edit";

        setCodeFiles((prev) => {
          const taskFiles = { ...(prev[taskId] || {}) };
          const existing = taskFiles[filePath];
          const now = Date.now();

          if (toolName === "Write") {
            taskFiles[filePath] = {
              filePath,
              content: data.content,
              patches: existing?.patches || [],
              lastTouched: now,
              lastToolName: "Write",
              expert: data.expert,
            };
          } else {
            // Edit — append patch
            const patches = [...(existing?.patches || [])];
            patches.push({
              oldStr: data.oldStr || "",
              newStr: data.newStr || "",
              expert: data.expert,
              timestamp: data.timestamp,
            });
            // Bound patches to 20 per file
            const bounded = patches.length > 20 ? patches.slice(-20) : patches;
            taskFiles[filePath] = {
              filePath,
              content: existing?.content,
              patches: bounded,
              lastTouched: now,
              lastToolName: "Edit",
              expert: data.expert || existing?.expert,
            };
          }

          // Bound to 50 files per task
          const fileEntries = Object.entries(taskFiles);
          if (fileEntries.length > 50) {
            const sorted = fileEntries.sort(
              ([, a], [, b]) => b.lastTouched - a.lastTouched,
            );
            const trimmed = Object.fromEntries(sorted.slice(0, 50));
            return { ...prev, [taskId]: trimmed };
          }

          return { ...prev, [taskId]: taskFiles };
        });

        // Auto-select file if user hasn't manually selected one for this task
        if (!userSelectedFileRef.current[taskId]) {
          setSelectedCodeFile((prev) => ({
            ...prev,
            [taskId]: filePath,
          }));
        }
      } catch (err) {
        console.error("Error parsing code event SSE data:", err);
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
  }, [fetchTerminalLogs, fetchPersistedErrors, fetchData, startPolling, stopPolling]);

  // Stop SSE log streaming for a task
  const stopLogStream = useCallback((taskId: string) => {
    const eventSource = logEventSources.current[taskId];
    if (eventSource) {
      eventSource.close();
      delete logEventSources.current[taskId];
    }
    stopPolling(taskId);
    // Clean up memory: remove seen event IDs and cursor tracking for this task
    delete terminalSeenEventIdsRef.current[taskId];
    delete terminalCursorsRef.current[taskId];
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

    // Start streaming for active tasks (skip terminal states — no new logs expected)
    // For retried tasks, seed cursor to skip old logs (history available via All Tasks)
    const terminalStatuses = ["failed", "completed", "deployed", "cancelled", "pr_approved", "review_approved", "review_requested", "blocked", "escalated"];
    activeTaskIds.forEach((taskId) => {
      const task = data.activeTasks.find((t) => t.id === taskId);
      if (task && terminalStatuses.includes(task.status)) return;
      if (!terminalCursorsRef.current[taskId]) {
        if (task && task.retryCount > 0 && task.updatedAt) {
          // Use updatedAt (set on retry) as cursor start — skip all pre-retry logs
          terminalCursorsRef.current[taskId] = `${new Date(task.updatedAt).toISOString()}|00000000-0000-0000-0000-000000000000`;
        }
      }
      startLogStream(taskId);
    });

    // Close connections for hidden terminals, removed tasks, and tasks that moved to terminal status
    Object.keys(logEventSources.current).forEach((taskId) => {
      const task = data.activeTasks.find((t) => t.id === taskId);
      const isTerminal = task && terminalStatuses.includes(task.status);
      if (hiddenTerminals.has(taskId) || !activeTaskIds.includes(taskId) || isTerminal) {
        stopLogStream(taskId);
      }
    });

    // Clean up streamingLogs and parsedErrors for tasks no longer active (memory optimization)
    const activeTaskIdSet = new Set(data.activeTasks.map((t) => t.id));
    setStreamingLogs((prev) => {
      const cleaned: Record<string, StreamingLog[]> = {};
      for (const taskId of Object.keys(prev)) {
        if (activeTaskIdSet.has(taskId)) {
          cleaned[taskId] = prev[taskId];
        }
      }
      if (Object.keys(cleaned).length !== Object.keys(prev).length) {
        return cleaned;
      }
      return prev;
    });
    setParsedErrors((prev) => {
      const cleaned: Record<string, ParsedError[]> = {};
      for (const taskId of Object.keys(prev)) {
        if (activeTaskIdSet.has(taskId)) {
          cleaned[taskId] = prev[taskId];
        }
      }
      if (Object.keys(cleaned).length !== Object.keys(prev).length) {
        return cleaned;
      }
      return prev;
    });
    setCodeFiles((prev) => {
      const cleaned: Record<string, Record<string, CodeFile>> = {};
      for (const taskId of Object.keys(prev)) {
        if (activeTaskIdSet.has(taskId)) {
          cleaned[taskId] = prev[taskId];
        }
      }
      if (Object.keys(cleaned).length !== Object.keys(prev).length) {
        return cleaned;
      }
      return prev;
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

  // Worker offline detection: check if executing tasks haven't received logs for 60s
  // Only applies to "executing" status — planning runs in-process (no worker container)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const executingIds = (data?.activeTasks ?? [])
        .filter((t) => t.status === "executing")
        .map((t) => t.id);
      const updates: Record<string, boolean> = {};
      for (const taskId of executingIds) {
        const lastTime = lastLogTimeRef.current[taskId];
        const isOffline = lastTime != null && now - lastTime > 120_000;
        updates[taskId] = isOffline;
      }
      setWorkerOffline((prev) => {
        const changed = executingIds.some((id) => prev[id] !== updates[id]);
        return changed ? { ...prev, ...updates } : prev;
      });
    }, 5_000);
    return () => clearInterval(interval);
  }, [data?.activeTasks]);

  // Note: We intentionally don't cache data to sessionStorage
  // Fresh data loads quickly and showing stale data on refresh causes confusion

  // Auto-scroll terminal to bottom when new logs arrive (if enabled)
  useEffect(() => {
    if (!autoScrollEnabled) return;
    Object.keys(streamingLogs).forEach((taskId) => {
      const terminalEl = terminalRefs.current[taskId];
      if (terminalEl) {
        terminalEl.scrollTop = terminalEl.scrollHeight;
      }
    });
  }, [streamingLogs, autoScrollEnabled]);

  const _handleLogout = () => {
    logout();
    navigate("/");
  };

  const toggleSystem = async () => {
    // Confirmation dialog before entering maintenance mode
    if (systemEnabled) {
      const confirmed = window.confirm(
        "Enter maintenance mode?\n\n" +
          "- The orchestrator will stop processing tasks\n" +
          "- New tasks will continue to queue\n" +
          "- Queued tasks will resume when you exit maintenance mode"
      );
      if (!confirmed) return;
    }

    setSystemToggleLoading(true);
    try {
      const token = localStorage.getItem("accessToken");
      const endpoint = systemEnabled ? "disable" : "enable";

      // Toggle main system - the API now handles orchestrator start/stop automatically
      const response = await fetch(`${API_BASE}/api/system/${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const newState = !systemEnabled;
        setSystemEnabled(newState);

        // Also toggle watcher to match system state
        const watcherEndpoint = newState ? "start" : "stop";
        await fetch(`${API_BASE}/api/orchestrator/watcher/${watcherEndpoint}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
    } catch (err) {
      console.error("Failed to toggle system:", err);
    } finally {
      setSystemToggleLoading(false);
    }
  };

  const _handleResetCounters = async () => {
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
    } catch (_err) {
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
    } catch (_err) {
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
    } catch (_err) {
      setActionError("Failed to retry task");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeployTask = async (taskId: string) => {
    setActionLoading(taskId);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/control-center/tasks/${taskId}/deploy`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        setActionSuccess("Task queued for deployment");
        setTimeout(() => setActionSuccess(null), 3000);
        fetchData();
      } else {
        const err = await response.json();
        setActionError(err.error || "Failed to queue deploy");
        setTimeout(() => setActionError(null), 5000);
      }
    } catch (_err) {
      setActionError("Failed to queue deploy");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setActionLoading(null);
    }
  };

  const handleReviewTask = async (taskId: string) => {
    setActionLoading(taskId);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/control-center/tasks/${taskId}/review`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        setActionSuccess("Task queued for review");
        setTimeout(() => setActionSuccess(null), 3000);
        fetchData();
      } else {
        const err = await response.json();
        setActionError(err.error || "Failed to queue review");
        setTimeout(() => setActionError(null), 5000);
      }
    } catch (_err) {
      setActionError("Failed to queue review");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setActionLoading(null);
    }
  };


  // Handle retrying PR creation for failed tasks
  const handleRetryPR = async (taskId: string) => {
    setActionLoading(taskId);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/control-center/tasks/${taskId}/retry-pr`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        setActionSuccess("PR creation retry initiated");
        setTimeout(() => setActionSuccess(null), 3000);
        fetchData();
      } else {
        const err = await response.json();
        setActionError(err.error || "Failed to retry PR creation");
        setTimeout(() => setActionError(null), 5000);
      }
    } catch (_err) {
      setActionError("Failed to retry PR creation");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setActionLoading(null);
    }
  };

  // Handle answering a worker's question from the communications feed
  const handleAnswerQuestion = async (messageId: string, answer: string) => {
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/coordination/answer`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messageId,
          answer,
          persona: "dashboard", // Human operator from dashboard
        }),
      });

      if (response.status === 401) {
        logout();
        navigate("/login");
        return;
      }

      if (!response.ok) {
        const err = await response.json();
        console.error("Failed to send answer:", err);
        setActionError(err.error || "Failed to send answer");
        setTimeout(() => setActionError(null), 5000);
      } else {
        setActionSuccess("Answer sent to worker");
        setTimeout(() => setActionSuccess(null), 3000);
      }
    } catch (err) {
      console.error("Failed to send answer:", err);
      setActionError("Failed to send answer");
      setTimeout(() => setActionError(null), 5000);
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
    } catch (_err) {
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
    } catch (_err) {
      setActionError("Failed to pause child tasks");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setActionLoading(null);
    }
  };

  // Talk to Worker - send message to a specific task (task-scoped)
  const handleTalkToWorker = async (immediate: boolean = true) => {
    if (!talkMessage.trim() || !talkTargetTaskId) return;

    setTalkLoading(true);
    try {
      const token = localStorage.getItem("accessToken");
      const taskId = talkTargetTaskId;
      const message = talkMessage.trim();

      // Helper to send a command
      const sendCommand = (type: string, content?: string) =>
        fetch(`${API_BASE}/api/coordination/commands`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ taskId, type, content }),
        });

      if (immediate) {
        // Immediate delivery: pause -> resume with message
        // This ensures message is delivered at the next checkpoint
        // 1. Send pause command
        await sendCommand("pause", "Pausing for user message");

        // 2. Brief delay to let pause register
        await new Promise((resolve) => setTimeout(resolve, 500));

        // 3. Send resume with the message as content - this delivers it immediately
        await sendCommand("resume", message);

        setActionSuccess(`Message sent to worker (immediate delivery)`);
      } else {
        // Queued delivery: just send message command, will be picked up at next story
        await sendCommand("message", message);
        setActionSuccess(`Message queued for worker (will be delivered at next story)`);
      }

      setTimeout(() => setActionSuccess(null), 3000);

      // Clear and close
      setTalkMessage("");
      setTalkTargetTaskId(null);
      setTalkTargetTaskTitle("");
      setIsTalkOpen(false);
    } catch (_err) {
      setActionError("Failed to send message to worker");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setTalkLoading(false);
    }
  };

  // Open Talk modal for a specific task
  const openTalkModal = (taskId: string, taskTitle: string) => {
    setTalkTargetTaskId(taskId);
    setTalkTargetTaskTitle(taskTitle);
    setIsTalkOpen(true);
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
    } catch (_err) {
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
    } catch (_err) {
      setActionError("Failed to request changes");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setActionLoading(null);
    }
  };

  // Fetch projects for internal task creation
  const fetchInternalProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/projects`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setInternalProjects(data.projects.filter((p: { isArchived: boolean }) => !p.isArchived));
      }
    } catch (err) {
      console.error("Failed to fetch projects:", err);
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  // Fetch tasks for a specific project (only Ready/Backlog tasks that aren't assigned)
  const fetchProjectTasks = useCallback(async (projectId: string) => {
    if (!projectId) {
      setInternalTasks([]);
      return;
    }
    setTasksLoading(true);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/projects/${projectId}/board`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        // Flatten tasks from columns, filter to ready/backlog tasks without workerTaskId
        const availableTasks: Array<{ taskKey: string; title: string; persona: string | null; columnType: string }> = [];
        for (const column of data.columns) {
          if (column.columnType === "backlog") {
            for (const task of column.tasks) {
              if (!task.workerTaskId) {
                availableTasks.push({
                  taskKey: task.taskKey,
                  title: task.title,
                  persona: task.persona,
                  columnType: column.columnType,
                });
              }
            }
          }
        }
        setInternalTasks(availableTasks);
      }
    } catch (err) {
      console.error("Failed to fetch project tasks:", err);
    } finally {
      setTasksLoading(false);
    }
  }, []);

  // Load projects when switching to internal source
  useEffect(() => {
    if (taskSource === "internal" && internalProjects.length === 0) {
      fetchInternalProjects();
    }
  }, [taskSource, internalProjects.length, fetchInternalProjects]);

  // Load tasks when project is selected
  useEffect(() => {
    if (selectedProjectId) {
      fetchProjectTasks(selectedProjectId);
      setSelectedTaskKey("");
    }
  }, [selectedProjectId, fetchProjectTasks]);

  const handleCreateTask = async () => {
    setCreateLoading(true);
    try {
      const token = localStorage.getItem("accessToken");

      if (taskSource === "internal") {
        // Assign internal task to worker
        const response = await fetch(`${API_BASE}/api/projects/${selectedProjectId}/tasks/${selectedTaskKey}/assign`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
        if (response.ok) {
          setActionSuccess("Task assigned to worker successfully");
          setTimeout(() => setActionSuccess(null), 3000);
          setShowCreateTaskModal(false);
          setTaskSource("external");
          setSelectedProjectId("");
          setSelectedTaskKey("");
          setInternalTasks([]);
          fetchData();
        } else {
          const err = await response.json();
          setActionError(err.error || "Failed to assign task");
          setTimeout(() => setActionError(null), 5000);
        }
      } else {
        // Create task from Jira/Linear issue
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
          setCreateTaskForm({ jiraIssueKey: "", workerPersona: "" });
          setCostEstimate(null);
          fetchData();
        } else {
          const err = await response.json();
          setActionError(err.error || "Failed to create task");
          setTimeout(() => setActionError(null), 5000);
        }
      }
    } catch (_err) {
      setActionError("Failed to create task");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setCreateLoading(false);
    }
  };

  const fetchCostEstimate = async (jiraKey: string) => {
    if (!jiraKey || jiraKey.length < 3) {
      setCostEstimate(null);
      return;
    }

    setCostEstimateLoading(true);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/analytics/estimate-cost/${jiraKey}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setCostEstimate({
          tier: data.assessment.tier,
          costRange: data.assessment.estimatedCostRange,
          tokenRange: data.assessment.estimatedTokenRange,
          confidence: data.assessment.confidence,
          tierDescription: data.assessment.tierDescription,
          historicalBasis: data.historicalBasis || 0,
        });
      } else {
        setCostEstimate(null);
      }
    } catch {
      setCostEstimate(null);
    } finally {
      setCostEstimateLoading(false);
    }
  };

  const toggleTerminal = (taskId: string, taskStatus: string) => {
    const isCompletedTask = TERMINAL_STATUSES.includes(taskStatus);

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

  // Helper to detect Epic tasks
  function isEpicTask(task: ActiveTask): boolean {
    return task.pipelineVersion === "v2" ||
      task.isRalphTask === true ||
      task.isEpicWorkflow === true ||
      task.executionMode === "parallel" ||
      task.executionMode === "multi-expert" ||
      (task.childTaskIds !== undefined && task.childTaskIds.length > 0);
  }

  // Helper for Epic progress calculation
  function _getEpicProgress(task: ActiveTask): number {
    // Use Epic progress from API (calculated from child task statuses)
    if (task.epicProgress !== undefined && task.storiesTotal && task.storiesTotal > 0) {
      return task.epicProgress;
    }

    // Legacy: Use Ralph progress if available
    if (task.ralphProgress) {
      const { completedStories = 0, totalStories } = task.ralphProgress;
      return totalStories > 0 ? Math.round((completedStories / totalStories) * 100) : 0;
    }

    // Fallback: show 0% if we have stories in the plan
    if (task.planJson?.stories && task.planJson.stories.length > 0) {
      return 0;
    }

    return 0;
  }

  // Workflow mode badge styling
  const _getWorkflowModeBadge = (mode?: WorkflowMode) => {
    switch (mode) {
      case "default":
        return { label: "Standard", color: "bg-gray-500/20 text-gray-400 border-gray-500/30", icon: GitPullRequest };
      case "review":
        return { label: "PR-Review", color: "bg-purple-500/20 text-purple-400 border-purple-500/30", icon: Users };
      case "auto_deploy":
        return { label: "Auto-Deploy", color: "bg-green-500/20 text-green-400 border-green-500/30", icon: Rocket };
      case "manager":
        return { label: "Manager", color: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30", icon: Wrench };
      case "review_manager":
        return { label: "PR-Review + Anneal", color: "bg-purple-500/20 text-purple-400 border-purple-500/30", icon: Users };
      case "deploy_manager":
        return { label: "Deploy + Manager", color: "bg-green-500/20 text-green-400 border-green-500/30", icon: Rocket };
      default:
        return { label: "Standard", color: "bg-gray-500/20 text-gray-400 border-gray-500/30", icon: GitPullRequest };
    }
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
    <div className="min-h-screen bg-background relative overflow-hidden" data-testid="dashboard">
      {/* Background effects */}
      <div className="fixed inset-0 bg-grid-pattern pointer-events-none opacity-50" />
      <div className="fixed inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5 pointer-events-none" />

      {/* Header */}
      <header className="border-b border-border/30 glass-strong sticky top-0 z-10">
        <div className="max-w-full mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-shrink-0">
            <Link to="/" className="group flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center shadow-lg shadow-teal-500/20">
                <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <span className="text-lg font-semibold tracking-tight text-foreground group-hover:opacity-80 transition-opacity">
                WorkerMill
              </span>
            </Link>

            {/* Org Switcher - appears when user has multiple orgs */}
            <OrgSwitcher />

            {/* Divider */}
            <div className="w-px h-6 bg-border/50" />

            {/* System On/Off Toggle - Maintenance Mode */}
            <button
              onClick={toggleSystem}
              disabled={systemToggleLoading}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                systemEnabled
                  ? "bg-green-500/10 text-green-500 border border-green-500/30 hover:bg-green-500/20"
                  : "bg-yellow-500/10 text-yellow-600 border border-yellow-500/30 hover:bg-yellow-500/20"
              } ${systemToggleLoading ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {systemToggleLoading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : systemEnabled ? (
                <Power className="w-4 h-4" />
              ) : (
                <Wrench className="w-4 h-4" />
              )}
              {systemEnabled ? "System ON" : "Maintenance Mode"}
            </button>

            {/* Run Task Button */}
            <button
              onClick={() => setShowCreateTaskModal(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-blue-500/10 text-blue-500 border border-blue-500/30 hover:bg-blue-500/20 transition-all"
              data-testid="create-task-btn"
            >
              <Play className="w-4 h-4" />
              Run Task
            </button>

          </div>

          {/* Stats Bar - Compact horizontal stats */}
          <div className="flex items-center gap-2 flex-1 justify-center">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
              <Activity className="w-4 h-4 text-yellow-500" />
              <span className="text-sm font-semibold text-yellow-500">{data?.stats.queueDepth || 0}</span>
              <span className="text-xs text-muted-foreground">Queued</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
              <Zap className="w-4 h-4 text-cyan-500" />
              <span className="text-sm font-semibold text-cyan-500">{data?.stats.activeWorkers || 0}</span>
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

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Personas Link */}
            <Link
              to="/personas"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <Users className="w-4 h-4 text-amber-500" />
              <span className="text-sm font-medium">Personas</span>
            </Link>

            {/* Boards Link */}
            <Link
              to="/boards"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <LayoutGrid className="w-4 h-4 text-indigo-500" />
              <span className="text-sm font-medium">Boards</span>
            </Link>

            {/* Insights Dropdown */}
            <div ref={efficiencyDropdownRef} className="relative">
              <button
                onClick={() => setIsEfficiencyDropdownOpen(!isEfficiencyDropdownOpen)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors ${isEfficiencyDropdownOpen ? 'bg-muted text-foreground' : ''}`}
              >
                <Zap className="w-4 h-4 text-green-500" />
                <span className="text-sm font-medium">Insights</span>
                {isFreePlan && <span className="text-[10px] font-semibold bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">PRO</span>}
                <ChevronDown className={`w-3 h-3 transition-transform ${isEfficiencyDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              {isEfficiencyDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-48 rounded-xl bg-card border border-border shadow-xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="py-1">
                    {isFreePlan ? (
                      <>
                        <Link
                          to="/pricing"
                          onClick={() => setIsEfficiencyDropdownOpen(false)}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
                        >
                          <BarChart3 className="w-4 h-4 text-green-500/50" />
                          Analytics
                          <span className="text-[10px] font-semibold bg-primary/20 text-primary px-1.5 py-0.5 rounded-full ml-auto">PRO</span>
                        </Link>
                        <Link
                          to="/pricing"
                          onClick={() => setIsEfficiencyDropdownOpen(false)}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
                        >
                          <DollarSign className="w-4 h-4 text-emerald-500/50" />
                          Cost Intelligence
                          <span className="text-[10px] font-semibold bg-primary/20 text-primary px-1.5 py-0.5 rounded-full ml-auto">PRO</span>
                        </Link>
                        <Link
                          to="/pricing"
                          onClick={() => setIsEfficiencyDropdownOpen(false)}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
                        >
                          <Brain className="w-4 h-4 text-purple-500/50" />
                          Memory Management
                          <span className="text-[10px] font-semibold bg-primary/20 text-primary px-1.5 py-0.5 rounded-full ml-auto">PRO</span>
                        </Link>
                        <Link
                          to="/pricing"
                          onClick={() => setIsEfficiencyDropdownOpen(false)}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
                        >
                          <BookOpen className="w-4 h-4 text-blue-500/50" />
                          Skill Library
                          <span className="text-[10px] font-semibold bg-primary/20 text-primary px-1.5 py-0.5 rounded-full ml-auto">PRO</span>
                        </Link>
                        <Link
                          to="/pricing"
                          onClick={() => setIsEfficiencyDropdownOpen(false)}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
                        >
                          <Target className="w-4 h-4 text-rose-500/50" />
                          Directive Analytics
                          <span className="text-[10px] font-semibold bg-primary/20 text-primary px-1.5 py-0.5 rounded-full ml-auto">PRO</span>
                        </Link>
                      </>
                    ) : (
                      <>
                        <Link
                          to="/analytics"
                          onClick={() => setIsEfficiencyDropdownOpen(false)}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
                        >
                          <BarChart3 className="w-4 h-4 text-green-500" />
                          Analytics
                        </Link>
                        <Link
                          to="/cost-intelligence"
                          onClick={() => setIsEfficiencyDropdownOpen(false)}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
                        >
                          <DollarSign className="w-4 h-4 text-emerald-500" />
                          Cost Intelligence
                          <span className="text-[10px] font-medium bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full ml-auto">Beta</span>
                        </Link>
                        <Link
                          to="/memory"
                          onClick={() => setIsEfficiencyDropdownOpen(false)}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
                        >
                          <Brain className="w-4 h-4 text-purple-500" />
                          Memory Management
                          <span className="text-[10px] font-medium bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full ml-auto">Beta</span>
                        </Link>
                        <Link
                          to="/skills"
                          onClick={() => setIsEfficiencyDropdownOpen(false)}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
                        >
                          <BookOpen className="w-4 h-4 text-blue-500" />
                          Skill Library
                          <span className="text-[10px] font-medium bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full ml-auto">Beta</span>
                        </Link>
                        <Link
                          to="/directive-effectiveness"
                          onClick={() => setIsEfficiencyDropdownOpen(false)}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
                        >
                          <Target className="w-4 h-4 text-rose-500" />
                          Directive Analytics
                          <span className="text-[10px] font-medium bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full ml-auto">Beta</span>
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="w-px h-6 bg-border/50" />

            {/* Profile Dropdown */}
            <ProfileDropdown onShowQuickStart={resetOnboarding} />
          </div>
        </div>
      </header>

      {/* Maintenance Mode Banner */}
      {!systemEnabled && (
        <div className="bg-yellow-500/10 border-b border-yellow-500/30 px-4 py-3">
          <div className="max-w-full mx-auto flex items-center gap-3 px-2">
            <div className="flex-shrink-0">
              <Wrench className="w-5 h-5 text-yellow-500" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
                System Maintenance in Progress
              </p>
              <p className="text-xs text-yellow-600/80 dark:text-yellow-400/80 mt-0.5">
                New tasks will be queued and will automatically resume when maintenance completes.
              </p>
            </div>
            <div className="flex-shrink-0 flex items-center gap-3">
              {(data?.stats?.queueDepth ?? 0) > 0 && (
                <span className="text-xs text-yellow-600/80 dark:text-yellow-400/80">
                  {data?.stats?.queueDepth} task{(data?.stats?.queueDepth ?? 0) !== 1 ? "s" : ""} queued
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 text-xs font-medium">
                <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
                Maintenance Mode
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Setup Incomplete Banner */}
      <div className="max-w-7xl mx-auto px-6 pt-4">
        <SetupBanner onContinueSetup={resetOnboarding} />
      </div>

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

      {/* Main Layout - Flex container for main content + sidebar */}
      <div className="flex min-h-[calc(100vh-80px)]">
        {/* Main Content */}
        <main className="flex-1 overflow-auto p-6 space-y-6">
          <ErrorBoundaryWithRetry fallback={<DashboardErrorFallback />}>
          {/* Rate limit banner — shown above task list when any task is rate-limited */}
          {rateLimitBlockers.length > 0 && (
            <div className="mb-4 bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
                <div>
                  <span className="font-medium text-foreground">
                    Anthropic usage limit reached
                  </span>
                  <span className="text-sm text-muted-foreground ml-2">
                    {rateLimitBlockers.length} task
                    {rateLimitBlockers.length > 1 ? "s" : ""} paused
                  </span>
                </div>
              </div>
              <button
                onClick={async () => {
                  for (const blocker of rateLimitBlockers) {
                    try {
                      await fetch(
                        `${API_BASE}/api/coordination/blocker-response`,
                        {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${localStorage.getItem("accessToken")}`,
                          },
                          body: JSON.stringify({
                            parentTaskId: blocker.parentTaskId,
                            blockerId: blocker.id,
                            action: "retry",
                          }),
                        },
                      );
                    } catch {
                      /* ignore individual failures */
                    }
                  }
                  fetchData();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/20 text-amber-500 hover:bg-amber-500/30 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Retry All
              </button>
            </div>
          )}

          {/* Active Workflows */}
          <div className="card-elevated border border-border/50 rounded-xl overflow-hidden" data-testid="task-list">
            <div className="p-4 border-b border-border/50 bg-gradient-to-r from-primary/10 to-transparent flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Zap className="w-5 h-5 text-primary" />
                Active Workflows
                {data?.activeTasks && data.activeTasks.length > 0 && (
                  <span className="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-primary/20 text-primary animate-pulse">
                    {data.activeTasks.length} running
                  </span>
                )}
              </h2>
              <div className="flex items-center gap-2">
                {/* Local Mode Toggle - auto-detects remote agent, shows connection status */}
                {(() => {
                  const isEffectivelyLocal = remoteAgentOnly || (hasRemoteAgent && remoteAgentOnline);
                  const connectionLost = hasRemoteAgent && !remoteAgentOnline && !remoteAgentOnly;
                  const label = connectionLost
                    ? "Local (Disconnected)"
                    : isEffectivelyLocal
                      ? "Local ON"
                      : "Local OFF";
                  const colorClass = connectionLost
                    ? "bg-red-500/20 text-red-400 border border-red-500/50"
                    : isEffectivelyLocal
                      ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/50"
                      : "bg-muted/50 text-muted-foreground border border-border hover:border-cyan-500/30";
                  const title = connectionLost
                    ? `Remote agent ${remoteAgentHostname || "unknown"} is offline — last heartbeat stale`
                    : isEffectivelyLocal
                      ? `Local mode: tasks run on remote agent${remoteAgentHostname ? ` (${remoteAgentHostname})` : ""}`
                      : "No remote agent connected — tasks run on cloud ECS";

                  return (
                    <button
                      onClick={toggleLocalMode}
                      disabled={autoToggleLoading === "localMode"}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors ${colorClass} ${autoToggleLoading === "localMode" ? "opacity-50 cursor-not-allowed" : ""}`}
                      title={title}
                    >
                      {autoToggleLoading === "localMode" ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : connectionLost ? (
                        <WifiOff className="w-3.5 h-3.5" />
                      ) : (
                        <Monitor className="w-3.5 h-3.5" />
                      )}
                      {label}
                    </button>
                  );
                })()}

                {/* PR-Review Toggle */}
                <button
                  onClick={toggleAutoReview}
                  disabled={autoToggleLoading === "review"}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors ${
                    autoReviewEnabled
                      ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/50"
                      : "bg-muted/50 text-muted-foreground border border-border hover:border-indigo-500/30"
                  } ${autoToggleLoading === "review" ? "opacity-50 cursor-not-allowed" : ""}`}
                  title={autoReviewEnabled ? "AI PR review enabled for all tasks" : "Click to enable AI PR review"}
                >
                  {autoToggleLoading === "review" ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                  PR-Review {autoReviewEnabled ? "ON" : "OFF"}
                </button>

                {/* Auto-Deploy Toggle */}
                <button
                  onClick={toggleAutoDeploy}
                  disabled={autoToggleLoading === "deploy"}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors ${
                    autoDeployEnabled
                      ? "bg-green-500/20 text-green-400 border border-green-500/50"
                      : "bg-muted/50 text-muted-foreground border border-border hover:border-green-500/30"
                  } ${autoToggleLoading === "deploy" ? "opacity-50 cursor-not-allowed" : ""}`}
                  title={autoDeployEnabled ? "Auto-deploy enabled for all tasks" : "Click to enable auto-deploy"}
                >
                  {autoToggleLoading === "deploy" ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Rocket className="w-3.5 h-3.5" />
                  )}
                  Deploy {autoDeployEnabled ? "ON" : "OFF"}
                </button>

                {/* Anneal Toggle */}
                <button
                  onClick={toggleAutoImprove}
                  disabled={autoToggleLoading === "improve"}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors ${
                    autoImproveEnabled
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/50"
                      : "bg-muted/50 text-muted-foreground border border-border hover:border-amber-500/30"
                  } ${autoToggleLoading === "improve" ? "opacity-50 cursor-not-allowed" : ""}`}
                  title={autoImproveEnabled ? "Anneal enabled - iteratively refines and improves WorkerMill" : "Click to enable annealing"}
                >
                  {autoToggleLoading === "improve" ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  Anneal {autoImproveEnabled ? "ON" : "OFF"}
                </button>

                {/* Search Button */}
                <button
                  onClick={() => setIsLogSearchOpen(true)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-background hover:bg-muted/50 border border-border/50 rounded-lg text-muted-foreground hover:text-foreground transition-colors text-sm"
                  title="Search all task logs"
                >
                  <Search className="w-4 h-4" />
                  <span>Search tasks and logs...</span>
                </button>
              </div>
            </div>
            <div className="divide-y divide-border">
              {data?.activeTasks && data.activeTasks.length > 0 ? (
                data.activeTasks.map((task, index, filteredTasks) => {
                  // Find the first actively running (non-terminal) task
                  const firstActiveIndex = filteredTasks.findIndex(t => !TERMINAL_STATUSES.includes(t.status));
                  const isFirstActiveTask = index === firstActiveIndex;
                  const isCompletedTask = TERMINAL_STATUSES.includes(task.status);

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
                  const isActivelyRunning = ["executing", "environment_setup", "dispatching", "planning"].includes(task.status);
                  return (
                    <div
                      key={task.id}
                      className={`p-4 ${isActivelyRunning ? "animate-tile-scroll" : ""}`}
                      style={isActivelyRunning ? {
                        backgroundImage: "repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(59,130,246,0.04) 3px, rgba(59,130,246,0.04) 6px)",
                        backgroundSize: "8px 8px",
                      } : undefined}
                      data-testid="task-card"
                    >
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
                              /* Show Tech Lead when manager_review is active */
                              <>
                                <span className="text-4xl">👔</span>
                                <span className="text-xl font-medium text-foreground">
                                  Tech Lead
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
                          {(() => {
                            const url = buildTicketUrl(
                              task.jiraIssueKey,
                              issueTrackerConfig ?? undefined,
                              task.cardBoardId && task.cardId ? { boardId: task.cardBoardId, cardId: task.cardId } : null,
                            );
                            const isExt = url?.startsWith("http");
                            return url ? (
                              <a
                                href={url}
                                {...(isExt ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                                className="text-primary hover:underline font-medium flex items-center gap-1"
                              >
                                {task.jiraIssueKey}
                                {isExt && <ExternalLink className="w-3 h-3" />}
                              </a>
                            ) : (
                              <span className="font-medium">{task.jiraIssueKey}</span>
                            );
                          })()}
                          <span className="text-muted-foreground">{task.summary}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Workflow Mode Badge - Shows compound labels for all active modifiers */}
                          {(() => {
                            const isLocal = !!task.claimedByAgent || remoteAgentOnly || (hasRemoteAgent && remoteAgentOnline);
                            const isReview = task.skipManagerReview === false;
                            const isDeploy = !!task.deploymentEnabled;
                            const hasManager = !!task.managerEnabled;

                            // Build compound label parts
                            const parts: string[] = [];

                            if (isLocal) parts.push("Local");
                            if (isReview) parts.push("PR-Review");
                            if (isDeploy) parts.push("Deploy");
                            if (hasManager) parts.push("Anneal");

                            // Show compound badge if any modifiers are present
                            if (parts.length > 0) {
                              const label = parts.join(" + ");
                              return (
                                <span className="text-xs px-2 py-0.5 rounded-full border flex items-center gap-1 bg-purple-500/20 text-purple-400 border-purple-500/30">
                                  <Zap className="w-3 h-3" />
                                  {label}
                                </span>
                              );
                            }

                            // No modifiers - don't show a badge
                            return null;
                          })()}
                          {/* PRD Progress indicator */}
                          {(task.isRalphTask || task.status === "planning" || task.status === "pending_plan_approval" || task.status === "dispatching" || (task.childTaskIds && task.childTaskIds.length > 0) || (task.planJson?.steps && task.planJson.steps.length > 1)) && (
                            <>
                              {task.ralphProgress && (
                                <RalphProgressCompact progress={task.ralphProgress} />
                              )}
                              {task.status === "dispatching" && (
                                <button
                                  onClick={() => handlePauseAllChildren(task.id)}
                                  disabled={actionLoading === task.id}
                                  className="text-xs px-2 py-0.5 rounded-full border border-yellow-500/50 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20 flex items-center gap-1 transition-colors"
                                  title="Pause All Child Tasks"
                                >
                                  <PauseCircle className="w-3 h-3" />
                                  Pause All
                                </button>
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
                          {/* Show all models used (planning + execution) with "+" separator */}
                          {(() => {
                            const models = getDerivedModels(task);
                            if (models.length === 0) return null;
                            return (
                              <span className="text-xs px-2 py-0.5 rounded-full border border-border bg-muted text-muted-foreground flex items-center gap-1">
                                {models.map((m, i) => (
                                  <span key={`${m}-${i}`} className="flex items-center">
                                    {i > 0 && <span className="mx-0.5 text-muted-foreground/50">+</span>}
                                    <span>{m}</span>
                                  </span>
                                ))}
                              </span>
                            );
                          })()}
                          {/* Remote Agent Badge */}
                          {task.claimedByAgent && (
                            <span className="text-xs px-2 py-0.5 rounded-full border flex items-center gap-1 bg-indigo-500/20 text-indigo-400 border-indigo-500/30" title={`Running on remote agent: ${task.claimedByAgent}`}>
                              <Wifi className="w-3 h-3" />
                              {task.claimedByAgent}
                            </span>
                          )}
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${getStatusColor(task.status)} bg-current/10`} data-testid="task-status">
                            {task.status}
                          </span>
                          {/* Rate limit badge — visible without expanding */}
                          {coordinationMessages.some(
                            (m: ContextMessage) =>
                              m.parentTaskId === task.id &&
                              (m.messageType === "blocker_detected" ||
                                (m.messageType === "blocker" &&
                                  m.metadata?.isEscalated === true)) &&
                              m.metadata?.errorCategory === "rate_limit",
                          ) && (
                            <span className="text-xs px-2 py-0.5 rounded-full border bg-amber-500/20 text-amber-500 border-amber-500/30 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              Usage Limit
                            </span>
                          )}
                          {/* Real-time Cost Badge with trend and ceiling warning */}
                          {task.estimatedCostUsd > 0 && (
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 transition-all ${
                                task.costCeilingPercent && task.costCeilingPercent >= 95
                                  ? "bg-red-500/20 text-red-500 border border-red-500/50 animate-pulse"
                                  : task.costCeilingPercent && task.costCeilingPercent >= 80
                                    ? "bg-amber-500/20 text-amber-500 border border-amber-500/50"
                                    : "bg-green-500/10 text-green-500 border border-green-500/30"
                              }`}
                              title={
                                task.costCeilingPercent
                                  ? `${task.costCeilingPercent.toFixed(0)}% of cost ceiling`
                                  : "Estimated cost"
                              }
                            >
                              {task.costCeilingPercent && task.costCeilingPercent >= 80 ? (
                                <AlertTriangle className="w-3 h-3" />
                              ) : (
                                <DollarSign className="w-3 h-3" />
                              )}
                              {formatCost(task.estimatedCostUsd)}
                              {task.costTrend === "up" && (
                                <TrendingUp className="w-3 h-3 animate-bounce" />
                              )}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Workflow Stage Progress - Horizontal with icons */}
                      <div className="flex items-center mb-4">
                        {task.steps.map((step, idx) => {
                          const StepIcon = step.icon === "queued" ? Clock :
                                          step.icon === "executing" ? Cog :
                                          step.icon === "pr_created" ? PRCreatedIcon :
                                          step.icon === "review" ? ReviewIcon :
                                          step.icon === "manager_review" ? ReviewIcon :
                                          step.icon === "approved" ? ApprovedIcon :
                                          step.icon === "deploying" ? DeployedIcon :
                                          step.icon === "deployed" ? DeployedIcon :
                                          step.icon === "complete" ? GitMerge :
                                          step.icon === "waiting" ? Pause :
                                          step.icon === "experts" ? ExpertsIcon :
                                          step.icon === "coordinating" ? ExpertsIcon :
                                          step.icon === "epic" ? Zap :
                                          step.icon === "planning" ? PlanningIcon :
                                          step.icon === "steps" ? StepsIcon :
                                          step.icon === "tech_lead_review" ? TechLeadReviewIcon :
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
                                {/* Show progress under Steps stage */}
                                {step.isParallelStage && (task.storiesTotal || task.ralphProgress) && (
                                  <span className="text-xs text-primary font-medium">
                                    {task.storiesTotal
                                      ? `${task.storiesCompleted || 0}/${task.storiesTotal}`
                                      : task.ralphProgress
                                        ? `${task.ralphProgress.completedStories || 0}/${task.ralphProgress.totalStories}`
                                        : ''
                                    }
                                  </span>
                                )}
                                {/* Show revision counter under Tech Lead Review stage */}
                                {step.isReviewStage && (
                                  <span className="text-xs text-amber-500 font-medium">
                                    {(task.revisionCount ?? 0) + 1}/{task.maxReviewRevisions || 3}
                                  </span>
                                )}
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

                      {/* Active Blocker Alert - Shows when there's an unresolved blocker */}
                      {(() => {
                        const taskMessages = coordinationMessages.filter((m: ContextMessage) => m.parentTaskId === task.id);
                        // Look for escalated blockers - either "blocker_detected" type OR "blocker" type with isEscalated metadata
                        const blockerDetectedMessages = taskMessages.filter((m: ContextMessage) =>
                          m.messageType === "blocker_detected" ||
                          (m.messageType === "blocker" && m.metadata?.isEscalated === true)
                        );
                        const resolvedBlockerIds = new Set(
                          taskMessages
                            .filter((m: ContextMessage) =>
                              m.messageType === "blocker_resolved" ||
                              (m.messageType === "answer" && m.metadata?.blockerAction)
                            )
                            .map((m: ContextMessage) => (m.metadata?.blockerId as string) || m.id)
                            .filter(Boolean)
                        );
                        const activeBlockers = blockerDetectedMessages.filter((m: ContextMessage) => !resolvedBlockerIds.has(m.id));

                        if (activeBlockers.length === 0) return null;

                        return (
                          <div className="mb-4 space-y-3">
                            {activeBlockers.map((blocker: ContextMessage) => (
                              <BlockerAlert
                                key={blocker.id}
                                taskId={task.id}
                                parentTaskId={task.id}
                                blocker={{
                                  id: blocker.id,
                                  storyIndex: (blocker.metadata?.storyIndex as number) ?? 0,
                                  storyTitle: (blocker.metadata?.storyTitle as string) ?? "Unknown Story",
                                  errorCategory: (blocker.metadata?.errorCategory as string) ?? "unknown",
                                  // Summary is in metadata (new format) or use content (old format)
                                  summary: (blocker.metadata?.summary as string) ?? blocker.content,
                                  // Full error is in fullErrorMessage (new format) or content (old format)
                                  errorMessage: (blocker.metadata?.fullErrorMessage as string) ?? blocker.content,
                                  affectedFiles: (blocker.metadata?.affectedFiles as string[]) ?? [],
                                  autoRetryAttempts: (blocker.metadata?.autoRetryAttempts as number) ?? 0,
                                  maxAutoRetries: (blocker.metadata?.maxAutoRetries as number) ?? 3,
                                  dependentStories: (blocker.metadata?.dependentStories as number[]) ?? [],
                                  createdAt: blocker.createdAt,
                                }}
                                onResolved={() => fetchData()}
                              />
                            ))}
                          </div>
                        );
                      })()}

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

                      {/* Plan Display - Only shows for pending approval */}
                      {task.planJson && task.status === "pending_plan_approval" && (
                        <div className="mb-4 border rounded-lg border-primary/30 bg-primary/5">
                          {/* Header */}
                          <div className="flex items-center gap-2 p-4">
                            {isEpicTask(task) ? (
                              <Layers className="w-5 h-5 text-primary" />
                            ) : (
                              <Book className="w-5 h-5 text-primary" />
                            )}
                            <h3 className="text-lg font-semibold text-foreground">
                              Execution Plan Ready
                            </h3>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                              Awaiting Approval
                            </span>
                          </div>

                          {/* Plan content */}
                          <div className="px-4 pb-4">
                          {/* Execution Flow Diagram - Top, Full Width */}
                          {task.planJson.stories && task.planJson.stories.length > 1 && (
                            <div className="mb-4 p-4 bg-muted/30 rounded-lg border border-border/50">
                              <div className="flex items-center gap-2 mb-3">
                                <Network className="w-4 h-4 text-primary" />
                                <span className="text-sm font-medium text-foreground">Execution Flow</span>
                              </div>
                              <div className="flex justify-center">
                                <EmbeddedDependencyGraph stories={task.planJson.stories} parentTaskStatus={task.status} personaMap={personaMap} />
                              </div>
                            </div>
                          )}

                          {/* Plan Details - Below Diagram */}
                          <div className="space-y-3 mb-4">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-muted-foreground text-sm">Strategy:</span>
                              <span className={`text-sm font-medium px-2 py-0.5 rounded ${
                                task.planJson.strategy === "multi" || (task.planJson.steps && task.planJson.steps.length > 1)
                                  ? "bg-purple-500/20 text-purple-500"
                                  : "bg-blue-500/20 text-blue-500"
                              }`}>
                                {task.planJson.strategy === "multi" ? "Multi-Story" :
                                 task.planJson.steps && task.planJson.steps.length > 1 ? `Multi-Persona (${task.planJson.steps.length} steps)` :
                                 "Single Task"}
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
                              <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded border border-border/50">
                                <span className="font-medium text-foreground">Quality Gates:</span>{" "}
                                {task.planJson.qualityGates.join(", ")}
                              </div>
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
                        <div className="flex items-center gap-2">
                          {/* Talk to Worker Button - only show for running tasks */}
                          {["executing", "environment_setup", "dispatching"].includes(task.status) && (
                            <button
                              onClick={() => openTalkModal(task.id, task.jiraIssueKey || task.summary || "Task")}
                              className="p-1.5 hover:bg-cyan-500/10 rounded text-cyan-500"
                              title="Send message to this worker"
                            >
                              <MessageSquare className="w-4 h-4" />
                            </button>
                          )}
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

                      {/* Color Legend */}
                      {isTerminalVisible && (
                        <div className="flex flex-wrap items-center gap-3 mb-2 text-xs text-muted-foreground">
                          <span className="font-medium">Legend:</span>
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-red-400" />
                            <span>Fatal Errors</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-yellow-400" />
                            <span>Warnings</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-cyan-400" />
                            <span>Worker/System</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-green-400" />
                            <span>Success</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-purple-400" />
                            <span>Commands</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-gray-300" />
                            <span>Default</span>
                          </span>
                        </div>
                      )}

                      {/* Providers Legend - below color legend */}
                      {isTerminalVisible && (() => {
                        const providers =
                          task.providersUsed && task.providersUsed.length > 0
                            ? task.providersUsed
                            : getDerivedProviders(task);
                        if (providers.length === 0) return null;
                        return (
                          <div className="flex flex-wrap items-center gap-3 mb-2 text-xs text-muted-foreground">
                            <span className="font-medium">Providers:</span>
                            {providers.map((p) => {
                              const { name, icon } = formatProviderName(p);
                              return (
                                <span key={p} className="flex items-center gap-1">
                                  <span>{icon}</span>
                                  <span>{name}</span>
                                </span>
                              );
                            })}
                          </div>
                        );
                      })()}

                      {/* Terminal Output with Error Panel - side by side */}
                      {isTerminalVisible && (
                        <div className="mt-2 flex gap-2">
                          {/* Terminal - takes remaining space after error panel */}
                          <div className="terminal-bg border rounded-lg overflow-hidden flex-1 min-w-0">
                            {/* Terminal header with tabs */}
                            <div className="flex items-center justify-between px-3 py-1.5 terminal-header border-b">
                              <div className="flex items-center gap-2">
                                <div className="flex gap-1.5">
                                  <div className="w-3 h-3 rounded-full bg-red-500" />
                                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                                  <div className="w-3 h-3 rounded-full bg-green-500" />
                                </div>
                                {/* Terminal / Live Code tabs */}
                                <div className="flex items-center gap-0.5 ml-1">
                                  <button
                                    onClick={() => setTerminalTab((prev) => ({ ...prev, [task.id]: "terminal" }))}
                                    className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-t transition-colors ${
                                      (terminalTab[task.id] || "terminal") === "terminal"
                                        ? "bg-background border-b-2 border-primary text-foreground"
                                        : "text-muted-foreground hover:text-foreground"
                                    }`}
                                  >
                                    <Terminal className="w-3 h-3" />
                                    Terminal
                                  </button>
                                  <button
                                    onClick={() => setTerminalTab((prev) => ({ ...prev, [task.id]: "code" }))}
                                    className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-t transition-colors ${
                                      terminalTab[task.id] === "code"
                                        ? "bg-background border-b-2 border-primary text-foreground"
                                        : "text-muted-foreground hover:text-foreground"
                                    }`}
                                  >
                                    <FileCode className="w-3 h-3" />
                                    Live Code
                                    {codeFiles[task.id] && Object.keys(codeFiles[task.id]).length > 0 && (
                                      <span className="px-1 py-0.5 text-[10px] rounded-full bg-primary/20 text-primary">
                                        {Object.keys(codeFiles[task.id]).length}
                                      </span>
                                    )}
                                  </button>
                                </div>
                                <span className={`text-xs font-mono ${workerOffline[task.id] ? "text-orange-400" : "text-green-400"}`}>
                                  {workerOffline[task.id] ? "[worker offline]" : "[streaming]"}
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                {(terminalTab[task.id] || "terminal") === "terminal" && (
                                  <>
                                    <button
                                      onClick={() => setAutoScrollEnabled(!autoScrollEnabled)}
                                      className={`text-xs px-2 py-0.5 rounded ${autoScrollEnabled ? "bg-green-600 text-white" : "bg-gray-600 text-gray-300"}`}
                                      title={autoScrollEnabled ? "Auto-scroll ON - click to disable" : "Auto-scroll OFF - click to enable"}
                                    >
                                      {autoScrollEnabled ? "Auto-scroll ON" : "Auto-scroll OFF"}
                                    </button>
                                    <button
                                      onClick={() => {
                                        const terminalEl = terminalRefs.current[task.id];
                                        if (terminalEl) terminalEl.scrollTop = terminalEl.scrollHeight;
                                      }}
                                      className="text-gray-400 hover:text-white p-1"
                                      title="Scroll to bottom"
                                    >
                                      <RefreshCw className="w-3 h-3" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                            {/* Terminal content — always mounted, hidden via CSS to keep SSE alive */}
                            <div
                              ref={(el) => { terminalRefs.current[task.id] = el; }}
                              className={`p-3 h-96 overflow-y-auto font-mono text-xs terminal-text leading-relaxed terminal-bg ${(terminalTab[task.id] || "terminal") !== "terminal" ? "hidden" : ""}`}
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
                                  // Color based on structured severity field first, then message content
                                  // IMPORTANT: Only show red for explicitly "fatal" errors
                                  // Unclassified errors (during execution) show as muted orange
                                  // Recoverable errors show as muted orange
                                  const msg = log.message;
                                  const isFatalError = log.metadata?.errorType === "fatal";
                                  const isError = log.severity === "error" || log.logType === "error" || msg.includes("[ERROR]") || msg.includes("Error") || msg.includes("error:");
                                  const colorClass =
                                    isError && isFatalError
                                      ? "text-red-400" // Only fatal errors are bright red
                                      : isError
                                        ? "text-orange-300/70" // Unclassified and recoverable errors are muted
                                        : log.severity === "warning" || log.logType === "warning" || msg.includes("[WARN]") || msg.includes("Warning")
                                          ? "text-yellow-400"
                                          : msg.includes("[worker]") || msg.includes("Claude") || msg.includes("Starting")
                                            ? "text-cyan-400"
                                            : msg.includes("[SUCCESS]") || msg.includes("Completed") || msg.includes("success")
                                              ? "text-green-400"
                                              : msg.startsWith("$") || msg.includes("npm ") || msg.includes("git ")
                                                ? "text-purple-400"
                                                : "text-gray-300";

                                  return (
                                    <div
                                      key={idx}
                                      data-log-index={idx}
                                      className={`whitespace-pre-wrap break-all ${colorClass}`}
                                    >
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
                            {/* Live Code Viewer — shown when code tab is active */}
                            {terminalTab[task.id] === "code" && (
                              <LiveCodeViewer
                                files={codeFiles[task.id] || {}}
                                selectedFile={selectedCodeFile[task.id] || null}
                                onSelectFile={(filePath) => {
                                  userSelectedFileRef.current[task.id] = true;
                                  setSelectedCodeFile((prev) => ({ ...prev, [task.id]: filePath }));
                                }}
                                personaEmojis={personaEmojis}
                              />
                            )}
                          </div>

                          {/* Side Panel - Communications Feed */}
                          <div className={`border rounded-lg overflow-hidden bg-card transition-all ${errorPanelExpanded[task.id] ? "w-[30%]" : "w-12"}`}>
                            {/* Panel header - clickable to toggle when collapsed */}
                            {!errorPanelExpanded[task.id] ? (
                              <div
                                className="flex flex-col items-center gap-1 w-full py-2 cursor-pointer hover:bg-muted/70 transition-colors bg-muted/50"
                                onClick={() => {
                                  setErrorPanelExpanded(prev => ({ ...prev, [task.id]: true }));
                                  setUnreadCommsCount(prev => ({ ...prev, [task.id]: 0 }));
                                }}
                              >
                                <MessageSquare className={`w-4 h-4 ${unreadCommsCount[task.id] > 0 ? "text-cyan-400 animate-pulse" : "text-primary"}`} />
                                {unreadCommsCount[task.id] > 0 && (
                                  <span className="text-[10px] font-bold text-cyan-400">{unreadCommsCount[task.id]}</span>
                                )}
                                <ChevronDown className="w-3 h-3 text-muted-foreground -rotate-90" />
                              </div>
                            ) : (
                              <>
                                {/* Header */}
                                <div className="flex items-center border-b bg-muted/30">
                                  <div className="flex-1 flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-foreground">
                                    <MessageSquare className={`w-3.5 h-3.5 ${unreadCommsCount[task.id] > 0 ? "text-cyan-400 animate-pulse" : ""}`} />
                                    Comms
                                    {unreadCommsCount[task.id] > 0 && (
                                      <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-cyan-500/20 text-cyan-400 animate-pulse">
                                        {unreadCommsCount[task.id]}
                                      </span>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => setErrorPanelExpanded(prev => ({ ...prev, [task.id]: false }))}
                                    className="px-2 py-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                                    title="Collapse panel"
                                  >
                                    <ChevronDown className="w-4 h-4 rotate-90" />
                                  </button>
                                </div>

                                {/* Communications Feed */}
                                <EmbeddedCommunicationsFeed
                                  taskId={task.id}
                                  isTerminal={TERMINAL_STATUSES.includes(task.status)}
                                  isChildTask={!!task.parentTaskId}
                                  onAnswerQuestion={handleAnswerQuestion}
                                />
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="p-12 text-center" data-testid="empty-state">
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
        <div className="card-elevated border border-border/50 rounded-xl overflow-visible">
          <div className="p-4 border-b border-border/50 bg-gradient-to-r from-muted/30 to-transparent flex items-center justify-between rounded-t-xl">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Clock className="w-5 h-5 text-muted-foreground" />
              All Tasks
            </h2>
          </div>
          <div className="overflow-x-auto overflow-y-visible rounded-b-xl min-h-[280px]">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="text-left p-3">Task</th>
                  <th className="text-left p-3">Summary</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">Workflow</th>
                  <th className="text-left p-3">Model</th>
                  <th className="text-left p-3">Links</th>
                  <th className="text-left p-3">Retries</th>
                  <th className="text-left p-3">Cost</th>
                  <th className="text-left p-3">Quality</th>
                  <th className="text-left p-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data?.recentCompleted && data.recentCompleted.length > 0 ? (
                  data.recentCompleted.map((task) => {
                    // Support both GitHub (/pull/123) and Bitbucket (/pull-requests/123) URL formats
                    const prNumber = task.githubPrUrl?.match(/\/pull(?:-requests)?\/(\d+)/)?.[1];
                    return (
                      <tr
                        key={task.id}
                        className="hover:bg-muted/30 cursor-pointer transition-colors"
                        onClick={() => setSelectedTask(task)}
                      >
                        {/* Task - Clickable issue key */}
                        <td className="p-3">
                          {(() => {
                            const url = buildTicketUrl(
                              task.jiraIssueKey,
                              issueTrackerConfig ?? undefined,
                              task.cardBoardId && task.cardId ? { boardId: task.cardBoardId, cardId: task.cardId } : null,
                            );
                            const isExt = url?.startsWith("http");
                            return url ? (
                              <a
                                href={url}
                                {...(isExt ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                                className="font-medium text-primary hover:underline flex items-center gap-1"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {task.jiraIssueKey}
                                {isExt && <ExternalLink className="w-3 h-3" />}
                              </a>
                            ) : (
                              <span className="font-medium">{task.jiraIssueKey}</span>
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
                              ) : task.status === "escalated" ? (
                                <AlertCircle className="w-4 h-4" />
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
                               task.status === "escalated" ? "Escalated" :
                               task.status.replace(/_/g, " ").charAt(0).toUpperCase() + task.status.replace(/_/g, " ").slice(1)}
                            </span>
                            {/* Show revision badge for tasks past execution */}
                            {["pr_created", "review_requested", "pr_approved", "reviewing", "consolidating", "deployed", "completed", "revision_needed"].includes(task.status) && (
                              <span className="text-xs text-amber-500">
                                Rev {(task.revisionCount ?? 0) + 1}/{task.maxReviewRevisions || 3}
                              </span>
                            )}
                          </div>
                        </td>
                        {/* Workflow Badge - compound label for completed tasks */}
                        <td className="p-3">
                          {(() => {
                            const isLocal = !!task.claimedByAgent;
                            const isReview = task.skipManagerReview === false;
                            const isDeploy = !!task.deploymentEnabled;
                            const hasManager = !!task.managerEnabled;

                            const parts: string[] = [];
                            if (isLocal) parts.push("Local");
                            if (isReview) parts.push("PR-Review");
                            if (isDeploy) parts.push("Deploy");
                            if (hasManager) parts.push("Anneal");

                            if (parts.length > 0) {
                              return (
                                <span className="text-xs px-2 py-0.5 rounded-full border flex items-center gap-1 w-fit bg-muted/50 text-muted-foreground border-border">
                                  {parts.join(" + ")}
                                </span>
                              );
                            }
                            return <span className="text-xs text-muted-foreground">—</span>;
                          })()}
                        </td>
                        {/* Model */}
                        <td className="p-3">
                          <div className="flex flex-col gap-0.5">
                          <span className={`text-sm flex items-center gap-1.5 ${
                            task.workerModel?.includes("opus") ? "text-purple-400" :
                            task.workerModel?.includes("sonnet") ? "text-cyan-400" :
                            "text-green-400"
                          }`}>
                            {formatModelName(task.workerModel)}
                          </span>
                          </div>
                        </td>
                        {/* Links (PR + Logs) */}
                        <td className="p-3" onClick={(e) => e.stopPropagation()}>
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
                            {!task.githubPrUrl && task.githubBranch && (
                              <span className="flex items-center gap-1 text-cyan-400 text-xs">
                                <GitBranch className="w-3 h-3" />
                                {task.githubBranch.length > 30 ? task.githubBranch.slice(0, 30) + '...' : task.githubBranch}
                              </span>
                            )}
                            {!task.githubPrUrl && !task.githubBranch && (
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
                          {`$${formatCost(task.costUsd)}`}
                        </td>
                        {/* Quality */}
                        <td className="p-3 text-sm">
                          {task.qualityScore != null ? (
                            <span className={`font-medium ${
                              task.qualityScore >= 90 ? 'text-emerald-500' :
                              task.qualityScore >= 70 ? 'text-yellow-500' :
                              task.qualityScore >= 50 ? 'text-orange-500' :
                              'text-red-500'
                            }`}>
                              {task.qualityScore}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        {/* Actions */}
                        <td className="p-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            {/* Actions dropdown */}
                            <div className="relative">
                              <button
                                onClick={() => setOpenActionMenu(openActionMenu === task.id ? null : task.id)}
                                className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
                                title="Actions"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              {/* Dropdown Menu */}
                              {openActionMenu === task.id && (
                                <div className="absolute right-0 top-full mt-1 z-50 bg-background border border-border rounded-lg shadow-lg py-1 min-w-[140px]">
                                  <button
                                    onClick={() => {
                                      setSelectedTask(task);
                                      setOpenActionMenu(null);
                                    }}
                                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2"
                                  >
                                    <Eye className="w-4 h-4" />
                                    Details
                                  </button>
                                  {/* Retry - only for failed/cancelled/escalated states */}
                                  {["failed", "escalated", "cancelled"].includes(task.status) && (
                                    <button
                                      onClick={() => {
                                        handleRetryTask(task.id);
                                        setOpenActionMenu(null);
                                      }}
                                      disabled={actionLoading === task.id}
                                      className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2 text-blue-400"
                                    >
                                      {actionLoading === task.id ? (
                                        <RefreshCw className="w-4 h-4 animate-spin" />
                                      ) : (
                                        <RotateCcw className="w-4 h-4" />
                                      )}
                                      Retry
                                    </button>
                                  )}
                                  {/* Deploy - merge PR and deploy without re-running the full task */}
                                  {task.githubPrUrl &&
                                    ["failed", "completed", "review_requested", "pr_approved", "escalated", "cancelled"].includes(task.status) && (
                                      <button
                                        onClick={() => {
                                          handleDeployTask(task.id);
                                          setOpenActionMenu(null);
                                        }}
                                        disabled={actionLoading === task.id}
                                        className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2 text-green-400"
                                      >
                                        {actionLoading === task.id ? (
                                          <RefreshCw className="w-4 h-4 animate-spin" />
                                        ) : (
                                          <Rocket className="w-4 h-4" />
                                        )}
                                        Deploy
                                      </button>
                                    )}
                                  {/* Review - run Tech Lead review on existing PR */}
                                  {task.githubPrUrl &&
                                    ["failed", "completed", "review_requested", "pr_approved", "deployed", "escalated", "cancelled"].includes(task.status) && (
                                      <button
                                        onClick={() => {
                                          handleReviewTask(task.id);
                                          setOpenActionMenu(null);
                                        }}
                                        disabled={actionLoading === task.id}
                                        className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2 text-violet-400"
                                      >
                                        {actionLoading === task.id ? (
                                          <RefreshCw className="w-4 h-4 animate-spin" />
                                        ) : (
                                          <FileSearch className="w-4 h-4" />
                                        )}
                                        Review
                                      </button>
                                    )}
                                  <div className="border-t border-border my-1" />
                                  {["queued", "claimed", "executing", "environment_setup", "planning", "pending_plan_approval", "dispatching"].includes(task.status) ? (
                                    <button
                                      onClick={() => {
                                        handleCancelTask(task.id);
                                        setOpenActionMenu(null);
                                      }}
                                      disabled={actionLoading === task.id}
                                      className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2 text-red-500"
                                    >
                                      {actionLoading === task.id ? (
                                        <RefreshCw className="w-4 h-4 animate-spin" />
                                      ) : (
                                        <Ban className="w-4 h-4" />
                                      )}
                                      Cancel
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => {
                                        handleDeleteTask(task.id);
                                        setOpenActionMenu(null);
                                      }}
                                      disabled={actionLoading === task.id}
                                      className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2 text-red-500"
                                    >
                                      {actionLoading === task.id ? (
                                        <RefreshCw className="w-4 h-4 animate-spin" />
                                      ) : (
                                        <Trash2 className="w-4 h-4" />
                                      )}
                                      Delete
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={11} className="p-12 text-center">
                      <div className="max-w-md mx-auto">
                        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                          <Rocket className="w-7 h-7 text-primary/60" />
                        </div>
                        <p className="text-foreground font-medium mb-1">No tasks yet</p>
                        <p className="text-sm text-muted-foreground mb-4">
                          Run your first AI task from a board card, or create one directly with the <strong>Run Task</strong> button above.
                        </p>
                        <div className="flex items-center justify-center gap-3">
                          <a
                            href="/boards"
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                          >
                            Go to Boards <ArrowRight className="w-3.5 h-3.5" />
                          </a>
                          <span className="text-muted-foreground/40">|</span>
                          <a
                            href="/docs/quick-start"
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Quick Start Guide <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
          </ErrorBoundaryWithRetry>
        </main>
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
                onClick={() => {
                  setShowCreateTaskModal(false);
                  setTaskSource("external");
                  setSelectedProjectId("");
                  setSelectedTaskKey("");
                  setCostEstimate(null);
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </div>
            <div className="p-4 space-y-4">
              {/* Task Source Selector */}
              <div>
                <label className="block text-sm font-medium mb-2">Task Source</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTaskSource("external")}
                    className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border transition-all ${
                      taskSource === "external"
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <Layers className="w-4 h-4" />
                    <span className="text-sm font-medium">Jira / Linear</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTaskSource("internal")}
                    className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border transition-all ${
                      taskSource === "internal"
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <FolderKanban className="w-4 h-4" />
                    <span className="text-sm font-medium">Internal Project</span>
                  </button>
                </div>
              </div>

              {taskSource === "external" ? (
                <>
                  {/* External: Jira/Linear Issue Key */}
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Issue Key
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="e.g., PROJ-123"
                        value={createTaskForm.jiraIssueKey}
                        onChange={(e) => {
                          setCreateTaskForm((prev) => ({
                            ...prev,
                            jiraIssueKey: e.target.value,
                          }));
                          setCostEstimate(null);
                        }}
                        className="flex-1 px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      <button
                        type="button"
                        onClick={() => fetchCostEstimate(createTaskForm.jiraIssueKey)}
                        disabled={!createTaskForm.jiraIssueKey || costEstimateLoading}
                        className="px-3 py-2 bg-purple-500/10 text-purple-500 border border-purple-500/30 rounded-lg hover:bg-purple-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                      >
                        {costEstimateLoading ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <DollarSign className="w-4 h-4" />
                        )}
                        <span className="text-sm">Estimate</span>
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Jira or Linear issue key (e.g., ACME-123 or PROJECT-456)
                    </p>
                    {/* Cost Estimate Display */}
                    {costEstimate && (
                      <div className="mt-3 p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-purple-400">
                            Complexity: <span className="capitalize">{costEstimate.tier}</span>
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {costEstimate.historicalBasis >= 5
                              ? `Based on ${costEstimate.historicalBasis} past tasks`
                              : `${costEstimate.confidence} confidence`}
                          </span>
                        </div>
                        <div className="text-center py-2">
                          <span className="text-muted-foreground text-sm">Estimated Cost:</span>
                          <div className="font-bold text-xl text-green-400">
                            ${costEstimate.costRange.min.toFixed(2)} - ${costEstimate.costRange.max.toFixed(2)}
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 text-center">
                          {costEstimate.tierDescription}
                        </p>
                      </div>
                    )}
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
                      <option value="">🤖 Auto (Dynamic Routing)</option>
                      {Object.entries(PERSONA_CONFIG)
                        .filter(([key]) => key !== "manager")
                        .map(([key, config]) => (
                          <option key={key} value={key}>
                            {config.emoji} {config.title}
                          </option>
                        ))}
                    </select>
                  </div>
                </>
              ) : (
                <>
                  {/* Internal: Project and Task Selection */}
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Project
                    </label>
                    <select
                      value={selectedProjectId}
                      onChange={(e) => setSelectedProjectId(e.target.value)}
                      disabled={projectsLoading}
                      className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                    >
                      <option value="">
                        {projectsLoading ? "Loading projects..." : "Select a project"}
                      </option>
                      {internalProjects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.key} - {project.name}
                        </option>
                      ))}
                    </select>
                    {internalProjects.length === 0 && !projectsLoading && (
                      <p className="text-xs text-muted-foreground mt-1">
                        No projects found.{" "}
                        <Link to="/projects" className="text-primary hover:underline">
                          Create one
                        </Link>
                      </p>
                    )}
                  </div>
                  {selectedProjectId && (
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Task
                      </label>
                      <select
                        value={selectedTaskKey}
                        onChange={(e) => setSelectedTaskKey(e.target.value)}
                        disabled={tasksLoading}
                        className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                      >
                        <option value="">
                          {tasksLoading ? "Loading tasks..." : "Select a task"}
                        </option>
                        {internalTasks.map((task) => (
                          <option key={task.taskKey} value={task.taskKey}>
                            {task.taskKey} - {task.title}
                            {task.persona && ` (${PERSONA_CONFIG[task.persona]?.emoji || ""} ${task.persona})`}
                          </option>
                        ))}
                      </select>
                      {internalTasks.length === 0 && !tasksLoading && (
                        <p className="text-xs text-muted-foreground mt-1">
                          No available tasks in Ready or Backlog columns.{" "}
                          <Link to={`/projects/${selectedProjectId}`} className="text-primary hover:underline">
                            Create tasks on the board
                          </Link>
                        </p>
                      )}
                      {selectedTaskKey && (
                        <div className="mt-2">
                          <p className="text-xs text-muted-foreground mb-1">
                            Task will use configured persona, model, and GitHub
                            repo settings.
                          </p>
                          <button
                            onClick={() =>
                              fetchCostEstimate(selectedTaskKey)
                            }
                            disabled={costEstimateLoading}
                            className="text-xs flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-muted transition-colors"
                          >
                            {costEstimateLoading ? (
                              <RefreshCw className="w-3 h-3 animate-spin" />
                            ) : (
                              <DollarSign className="w-3 h-3" />
                            )}
                            Estimate Cost
                          </button>
                          {costEstimate && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              <span className="font-medium">
                                {costEstimate.tier}
                              </span>
                              {" — "}
                              {typeof costEstimate.costRange === "object"
                                ? `$${costEstimate.costRange.min.toFixed(2)} - $${costEstimate.costRange.max.toFixed(2)}`
                                : costEstimate.costRange}
                              {costEstimate.confidence && (
                                <span className="text-muted-foreground/60">
                                  {" "}
                                  ({costEstimate.confidence})
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowCreateTaskModal(false);
                  setTaskSource("external");
                  setSelectedProjectId("");
                  setSelectedTaskKey("");
                }}
                className="px-4 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateTask}
                disabled={
                  createLoading ||
                  (taskSource === "external" && !createTaskForm.jiraIssueKey) ||
                  (taskSource === "internal" && (!selectedProjectId || !selectedTaskKey))
                }
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
          <div className="bg-card border border-border rounded-xl w-full max-w-5xl mx-4 shadow-2xl max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
              <div className="flex items-center gap-3">
                {(() => {
                  const url = buildTicketUrl(
                    selectedTask.jiraIssueKey,
                    issueTrackerConfig ?? undefined,
                    selectedTask.cardBoardId && selectedTask.cardId ? { boardId: selectedTask.cardBoardId, cardId: selectedTask.cardId } : null,
                  );
                  const isExt = url?.startsWith("http");
                  return url ? (
                    <a
                      href={url}
                      {...(isExt ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                      className="text-primary hover:underline font-semibold flex items-center gap-1"
                    >
                      {selectedTask.jiraIssueKey}
                      {isExt && <ExternalLink className="w-3 h-3" />}
                    </a>
                  ) : (
                    <span className="font-semibold">{selectedTask.jiraIssueKey}</span>
                  );
                })()}
                <span className={`text-sm ${getStatusColor(selectedTask.status)}`}>
                  {selectedTask.status}
                </span>
              </div>
              <button
                onClick={() => {
                  setSelectedTask(null);
                  setTaskModalTab("details");
                }}
                className="p-1 hover:bg-muted rounded transition-colors"
              >
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border shrink-0">
              <button
                onClick={() => setTaskModalTab("details")}
                className={`px-4 py-2.5 text-sm font-medium transition-colors ${
                  taskModalTab === "details"
                    ? "text-primary border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Details
              </button>
              <button
                onClick={() => setTaskModalTab("logs")}
                className={`px-4 py-2.5 text-sm font-medium transition-colors flex items-center gap-2 ${
                  taskModalTab === "logs"
                    ? "text-primary border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Terminal className="w-4 h-4" />
                Logs
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-auto">
              {taskModalTab === "details" ? (
                <div className="p-4 space-y-4">
                  {/* Summary */}
                  <p className="text-foreground">{selectedTask.summary}</p>

                  {/* Stats Grid */}
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <div className="text-muted-foreground">Retries</div>
                      <div className="font-semibold">{selectedTask.retryCount ?? 0}/3</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Cost</div>
                      <div className="font-semibold">${formatCost(selectedTask.costUsd)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Duration</div>
                      <div className="font-semibold">
                        {(() => {
                          if (selectedTask.durationMinutes) return `${selectedTask.durationMinutes}m`;
                          if (selectedTask.startedAt && selectedTask.completedAt) {
                            const mins = Math.round((new Date(selectedTask.completedAt).getTime() - new Date(selectedTask.startedAt).getTime()) / 60000);
                            if (mins < 60) return `${mins}m`;
                            return `${Math.floor(mins / 60)}h ${mins % 60}m`;
                          }
                          if (selectedTask.startedAt && !selectedTask.completedAt) {
                            const mins = Math.round((Date.now() - new Date(selectedTask.startedAt).getTime()) / 60000);
                            return `${mins}m (running)`;
                          }
                          return "N/A";
                        })()}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Created</div>
                      <div className="font-semibold text-xs">{new Date(selectedTask.createdAt).toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Completed</div>
                      <div className="font-semibold text-xs">{selectedTask.completedAt ? new Date(selectedTask.completedAt).toLocaleString() : "Running"}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Last Heartbeat</div>
                      <div className="font-semibold text-xs">{selectedTask.lastHeartbeatAt ? new Date(selectedTask.lastHeartbeatAt).toLocaleString() : "Never"}</div>
                    </div>
                  </div>

                  {/* Token Usage Breakdown */}
                  <div className="border-t border-border pt-4">
                    <TokenBreakdown taskId={selectedTask.id} />
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
                  {selectedTask.githubPrUrl && (
                    <div className="flex items-center gap-4">
                      <a
                        href={selectedTask.githubPrUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-sm text-purple-400 hover:underline"
                      >
                        <GitBranch className="w-4 h-4" />
                        View PR
                      </a>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4">
                  <TerminalLogViewer taskId={selectedTask.id} height="500px" />
                  {selectedTask.status === "planning" && planningProgress[selectedTask.id] && (
                    <PlanningTerminalBar progress={planningProgress[selectedTask.id]} />
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end gap-2 p-4 border-t border-border shrink-0">
              {/* Retry - for failed/escalated/cancelled */}
              {["failed", "escalated", "cancelled"].includes(selectedTask.status) && (
                <button
                  onClick={() => {
                    handleRetryTask(selectedTask.id);
                    setSelectedTask(null);
                    setTaskModalTab("details");
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  Retry
                </button>
              )}
              <button
                onClick={() => {
                  setSelectedTask(null);
                  setTaskModalTab("details");
                }}
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

      {/* Talk to Worker Modal - Task-Scoped */}
      {isTalkOpen && talkTargetTaskId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => {
              setIsTalkOpen(false);
              setTalkMessage("");
              setTalkTargetTaskId(null);
              setTalkTargetTaskTitle("");
            }}
          />

          {/* Modal */}
          <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-cyan-500/10 rounded-lg">
                  <MessageSquare className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Talk to Worker</h2>
                  <p className="text-sm text-muted-foreground">
                    Send a message to <span className="font-medium text-cyan-400">{talkTargetTaskTitle}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsTalkOpen(false);
                  setTalkMessage("");
                  setTalkTargetTaskId(null);
                  setTalkTargetTaskTitle("");
                }}
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-4">
              <label className="block text-sm font-medium text-muted-foreground mb-2">
                Your message will be delivered to Claude at the next checkpoint.
              </label>
              <textarea
                value={talkMessage}
                onChange={(e) => setTalkMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && talkMessage.trim()) {
                    e.preventDefault();
                    handleTalkToWorker(true);
                  }
                }}
                placeholder="Type your message to the worker..."
                className="w-full h-32 px-4 py-3 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 resize-none"
                autoFocus
                disabled={talkLoading}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Press Ctrl+Enter for immediate delivery, or choose a delivery method below.
              </p>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between p-4 border-t border-border bg-muted/30 rounded-b-xl">
              <button
                onClick={() => {
                  setIsTalkOpen(false);
                  setTalkMessage("");
                  setTalkTargetTaskId(null);
                  setTalkTargetTaskTitle("");
                }}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
              >
                Cancel
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleTalkToWorker(false)}
                  disabled={!talkMessage.trim() || talkLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 text-foreground border border-border rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Queue message for next story (no interruption)"
                >
                  {talkLoading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Clock className="w-4 h-4" />
                      Queue
                    </>
                  )}
                </button>
                <button
                  onClick={() => handleTalkToWorker(true)}
                  disabled={!talkMessage.trim() || talkLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Pause worker and deliver message immediately at next checkpoint"
                >
                  {talkLoading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4" />
                      Send Now
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

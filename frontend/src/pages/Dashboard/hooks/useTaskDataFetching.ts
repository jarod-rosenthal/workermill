import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../../store/auth-store";
import type { ControlCenterData } from "../types";
import { API_BASE } from "../types";

export function useTaskDataFetching() {
  const navigate = useNavigate();
  const logout = useAuthStore((state) => state.logout);

  // Always start fresh - no cached data to avoid showing stale data on refresh
  const [data, setData] = useState<ControlCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // System status
  const [systemEnabled, setSystemEnabled] = useState(true);
  const [systemToggleLoading, setSystemToggleLoading] = useState(false);

  // Remote agent state (from org settings, used for task badges)
  const [remoteAgentOnly, setRemoteAgentOnly] = useState(false);
  const [hasRemoteAgent, setHasRemoteAgent] = useState(false);
  const [remoteAgentOnline, setRemoteAgentOnline] = useState(false);

  // SSE connection state
  const [_sseConnected, setSseConnected] = useState(false);

  // Real-time cost tracking for trend indicator and ceiling warnings
  const prevCostsRef = useRef<Record<string, number>>({});
  const costCeilingInfoRef = useRef<Record<string, { percent: number; ceiling: number }>>({});
  const mainEventSourceRef = useRef<EventSource | null>(null);

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
        setRemoteAgentOnly(settings.remoteAgentOnly ?? false);
        setHasRemoteAgent(settings.hasRemoteAgent ?? false);
        setRemoteAgentOnline(settings.remoteAgentOnline ?? false);
      }
    } catch (err) {
      console.error("Failed to fetch org settings:", err);
    }
  }, []);

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
    const eventSource = new EventSource(
      `${API_BASE}/api/control-center/stream?token=${encodeURIComponent(token)}`
    );
    mainEventSourceRef.current = eventSource;

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
              activeTasks: update.activeTasks.map((task: Record<string, unknown>) => ({
                ...task,
                workerName: task.workerPersona,
                createdAt: task.startedAt || task.createdAt || new Date().toISOString(),
                recentLogs: [],
              })),
              queuedTasks: update.queuedTasks.map((task: Record<string, unknown>) => ({
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
      mainEventSourceRef.current = null;
    };
  }, [fetchData, fetchOrgSettings]);

  // Pause SSE streams when tab is hidden to avoid wasting DB connections on background tabs
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        // Close main SSE stream
        mainEventSourceRef.current?.close();
        mainEventSourceRef.current = null;
        setSseConnected(false);
      } else {
        // Tab became visible — refetch data and let existing useEffects reconnect SSE
        fetchData();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [fetchData]);

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

  return {
    data,
    setData,
    loading,
    error,
    fetchData,
    systemEnabled,
    systemToggleLoading,
    toggleSystem,
    remoteAgentOnly,
    hasRemoteAgent,
    remoteAgentOnline,
    mainEventSourceRef,
    setSseConnected,
  };
}

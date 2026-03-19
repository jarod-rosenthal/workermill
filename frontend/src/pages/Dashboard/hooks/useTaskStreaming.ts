import { useState, useEffect, useCallback, useRef } from "react";
import type { PlanningProgressData } from "../../../components/PlanningProgress";
import type { DiffFile } from "../../../components/LiveCodeViewer";
import type { ControlCenterData } from "../types";
import { API_BASE } from "../types";
import { parseLogForError } from "../helpers";

export interface StreamingLog {
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

export interface ParsedError {
  timestamp: number;
  type: "error" | "warning";
  category: string;
  message: string;
  file?: string;
  line?: number;
  logIndex: number;
}

interface UseTaskStreamingParams {
  data: ControlCenterData | null;
  setData: React.Dispatch<React.SetStateAction<ControlCenterData | null>>;
  fetchData: () => Promise<void>;
  hiddenTerminals: Set<string>;
  mainEventSourceRef: React.MutableRefObject<EventSource | null>;
  setSseConnected: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useTaskStreaming({
  data,
  setData,
  fetchData,
  hiddenTerminals,
}: UseTaskStreamingParams) {
  // Planning progress stored separately so polling `setData(result)` can't wipe it out
  const [planningProgress, setPlanningProgress] = useState<Record<string, PlanningProgressData>>({});
  const [streamingLogs, setStreamingLogs] = useState<Record<string, StreamingLog[]>>({});
  const [, setParsedErrors] = useState<Record<string, ParsedError[]>>({});
  // Persisted errors from database (survives client re-init)
  const [persistedErrors, setPersistedErrors] = useState<Record<string, ParsedError[]>>({});
  // Track which comms panels are expanded
  const [errorPanelExpanded, setErrorPanelExpanded] = useState<Record<string, boolean>>({});
  // Track previous error counts to detect new errors
  const prevErrorCountsRef = useRef<Record<string, number>>({});

  const logEventSources = useRef<Record<string, EventSource>>({});
  const terminalRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Cursor tracking for SSE resume (using refs to avoid re-renders)
  const terminalCursorsRef = useRef<Record<string, string | null>>({});
  const terminalSeenEventIdsRef = useRef<Record<string, Set<string>>>({});
  // Polling fallback timers
  const pollIntervalsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  // Track which terminals are actively streaming
  const [_streamingTerminals, setStreamingTerminals] = useState<Set<string>>(new Set());

  // Track last log received time per task for worker offline detection
  const lastLogTimeRef = useRef<Record<string, number>>({});
  const [workerOffline, setWorkerOffline] = useState<Record<string, boolean>>({});

  // Auto-scroll toggle for terminal output
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);

  // Live Code Viewer state
  const [codeFiles, setCodeFiles] = useState<Record<string, Record<string, DiffFile>>>({});
  const [selectedCodeFile, setSelectedCodeFile] = useState<Record<string, string | null>>({});
  const [terminalTab, setTerminalTab] = useState<Record<string, "terminal" | "code">>({});
  const userSelectedFileRef = useRef<Record<string, boolean>>({});

  // Parse errors from streaming logs, task-level errors, and persisted errors
  useEffect(() => {
    const newParsedErrors: Record<string, ParsedError[]> = {};
    const tasksWithNewErrors: string[] = [];

    // Helper to create a dedup key for errors
    const errorKey = (e: ParsedError) => `${e.timestamp}|${e.message}`;

    // First, add task-level errors (from task.errorMessage) as the primary error
    if (data?.activeTasks) {
      for (const task of data.activeTasks) {
        if (task.status === "failed") {
          const errorMsg = task.errorMessage || "Task failed - check logs for details";
          const errors: ParsedError[] = [{
            timestamp: task.completedAt ? new Date(task.completedAt).getTime() : Date.now(),
            type: "error",
            category: "Task Failed",
            message: errorMsg,
            logIndex: -1,
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
    for (const [taskId, persisted] of Object.entries(persistedErrors)) {
      const existing = newParsedErrors[taskId] || [];
      const existingKeys = new Set(existing.map(errorKey));

      const newFromPersisted = persisted.filter(e => !existingKeys.has(errorKey(e)));
      if (newFromPersisted.length > 0) {
        const merged = [...existing, ...newFromPersisted];
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
          logIndex: -2,
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
              const eventId = log.cursor ||
                (log.timestamp && log.id
                  ? `${new Date(log.timestamp).toISOString()}|${log.id}`
                  : null);
              if (eventId && seen.has(eventId)) {
                return false;
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
              const prevLines = cursor ? (prev[taskId] || []) : [];
              const nextLines = [...prevLines, ...logLines];
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
    if (logEventSources.current[taskId]) return;

    const token = localStorage.getItem("accessToken");
    if (!token) return;

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

    // Handle log events
    const onLogEvent = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        const eventId =
          event.lastEventId ||
          data.cursor ||
          (data.timestamp && data.id
            ? `${new Date(data.timestamp).toISOString()}|${data.id}`
            : null);

        // Deduplication
        if (eventId) {
          if (!terminalSeenEventIdsRef.current[taskId]) {
            terminalSeenEventIdsRef.current[taskId] = new Set();
          }
          const seen = terminalSeenEventIdsRef.current[taskId];
          if (seen.has(eventId)) {
            return;
          }
          seen.add(eventId);
          if (seen.size > 1000) {
            terminalSeenEventIdsRef.current[taskId] = new Set(Array.from(seen).slice(-500));
          }
        }

        const logLine: StreamingLog = {
          timestamp: new Date(data.timestamp).getTime(),
          message: data.message,
          logType: data.logType,
          severity: data.severity,
          command: data.command,
          exitCode: data.exitCode,
          metadata: data.metadata,
        };

        setStreamingLogs((prev) => {
          const prevLines = prev[taskId] || [];
          const nextLines = [...prevLines, logLine];
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

    // Handle planning progress events
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

    // Handle code events for Live Code Viewer
    eventSource.addEventListener("code_event", (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
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
              before: "",
              after: data.content || "",
              lastTouched: now,
              lastToolName: "Write",
              expert: data.expert,
            };
          } else {
            if (existing) {
              taskFiles[filePath] = {
                ...existing,
                after: data.newStr || "",
                lastTouched: now,
                lastToolName: "Edit",
                expert: data.expert || existing.expert,
              };
            } else {
              taskFiles[filePath] = {
                filePath,
                before: data.oldStr || "",
                after: data.newStr || "",
                lastTouched: now,
                lastToolName: "Edit",
                expert: data.expert,
              };
            }
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
      stopPolling(taskId);
      setStreamingTerminals((prev) => new Set([...prev, taskId]));
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "status") {
          fetchData();
        } else if (data.type === "complete") {
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
      setStreamingTerminals((prev) => {
        const newSet = new Set(prev);
        newSet.delete(taskId);
        return newSet;
      });
      startPolling(taskId);
    };

    logEventSources.current[taskId] = eventSource;
  }, [fetchTerminalLogs, fetchPersistedErrors, fetchData, setData, startPolling, stopPolling]);

  // Stop SSE log streaming for a task
  const stopLogStream = useCallback((taskId: string) => {
    const eventSource = logEventSources.current[taskId];
    if (eventSource) {
      eventSource.close();
      delete logEventSources.current[taskId];
    }
    stopPolling(taskId);
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

    const activeTaskIds = data.activeTasks
      .filter((task) => !hiddenTerminals.has(task.id))
      .map((task) => task.id);

    const terminalStatuses = ["failed", "completed", "deployed", "cancelled", "pr_approved", "review_approved", "review_requested", "blocked", "escalated"];
    activeTaskIds.forEach((taskId) => {
      const task = data.activeTasks.find((t) => t.id === taskId);
      if (task && terminalStatuses.includes(task.status)) return;
      if (!terminalCursorsRef.current[taskId]) {
        if (task && task.retryCount > 0 && task.updatedAt) {
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

    // Clean up streamingLogs and parsedErrors for tasks no longer active
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
      const cleaned: Record<string, Record<string, DiffFile>> = {};
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

  // Worker offline detection
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

  // Auto-scroll terminal to bottom when new logs arrive
  useEffect(() => {
    if (!autoScrollEnabled) return;
    Object.keys(streamingLogs).forEach((taskId) => {
      const terminalEl = terminalRefs.current[taskId];
      if (terminalEl) {
        terminalEl.scrollTop = terminalEl.scrollHeight;
      }
    });
  }, [streamingLogs, autoScrollEnabled]);

  return {
    planningProgress,
    streamingLogs,
    errorPanelExpanded,
    setErrorPanelExpanded,
    logEventSources,
    terminalRefs,
    workerOffline,
    autoScrollEnabled,
    setAutoScrollEnabled,
    codeFiles,
    selectedCodeFile,
    setSelectedCodeFile,
    terminalTab,
    setTerminalTab,
    userSelectedFileRef,
    startLogStream,
    stopLogStream,
  };
}

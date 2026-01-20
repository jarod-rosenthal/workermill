import { useEffect, useRef, useCallback, useMemo } from "react";
import { useOrchestrationStore } from "../orchestration-store";
import type {
  ContextMessage,
  ContextMessageType,
} from "../orchestration-store";

const API_BASE = import.meta.env.VITE_API_URL || "";
const RECONNECT_DELAY = 5000;
const MAX_CONCURRENT_STREAMS = 5; // Cap concurrent log streams

interface LogEvent {
  type: "log";
  id: string;
  timestamp: string;
  message: string;
  logType?: string;
  severity?: string;
}

interface ContextEvent {
  id: string;
  taskId: string;
  persona: string;
  messageType: ContextMessageType;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

/**
 * Hook for managing SSE subscriptions to:
 * 1. Task log streams (for active tab + executing tasks in tabbed terminal)
 * 2. Coordination context stream (for sidebar feed)
 */
export function useOrchestrationStreams(parentTaskId: string | undefined) {
  // Use stable selectors instead of the whole store
  const activeTerminalTabId = useOrchestrationStore((s) => s.activeTerminalTabId);
  const isContextConnected = useOrchestrationStore((s) => s.isContextConnected);
  const getChildrenArray = useOrchestrationStore((s) => s.getChildrenArray);
  const setContextConnected = useOrchestrationStore((s) => s.setContextConnected);
  const addContextMessage = useOrchestrationStore((s) => s.addContextMessage);
  const appendChildLogs = useOrchestrationStore((s) => s.appendChildLogs);
  const updateChild = useOrchestrationStore((s) => s.updateChild);

  // Refs for managing connections
  const contextSourceRef = useRef<EventSource | null>(null);
  const logSourcesRef = useRef<Map<string, EventSource>>(new Map());
  const reconnectTimeoutsRef = useRef<Map<string, number>>(new Map());
  const isContextConnectingRef = useRef(false);

  // Compute which tasks need active log streams
  // Priority: 1) Active tab, 2) Executing tasks
  const tasksToStream = useMemo(() => {
    const children = getChildrenArray();
    const executingIds = children
      .filter((c) =>
        ["executing", "environment_setup", "claimed"].includes(c.status)
      )
      .map((c) => c.id);

    const set = new Set(executingIds);
    if (activeTerminalTabId) {
      set.add(activeTerminalTabId);
    }

    // Cap at MAX_CONCURRENT_STREAMS to prevent resource exhaustion
    // Keep active tab + most recent executing tasks
    if (set.size > MAX_CONCURRENT_STREAMS) {
      const prioritizedIds: string[] = [];
      if (activeTerminalTabId) {
        prioritizedIds.push(activeTerminalTabId);
      }
      for (const id of executingIds) {
        if (
          id !== activeTerminalTabId &&
          prioritizedIds.length < MAX_CONCURRENT_STREAMS
        ) {
          prioritizedIds.push(id);
        }
      }
      return new Set(prioritizedIds);
    }

    return set;
  }, [getChildrenArray, activeTerminalTabId]);

  // Connect to coordination context stream
  const connectContextStream = useCallback(() => {
    if (!parentTaskId) return;

    // Prevent multiple simultaneous connection attempts
    if (isContextConnectingRef.current) return;
    isContextConnectingRef.current = true;

    // Close existing connection
    if (contextSourceRef.current) {
      contextSourceRef.current.close();
      contextSourceRef.current = null;
    }

    const token = localStorage.getItem("accessToken");
    const url = `${API_BASE}/api/coordination/context/${parentTaskId}/stream`;

    // Note: EventSource doesn't support custom headers, so we use URL params
    // The backend should accept token via query param for SSE
    const es = new EventSource(`${url}?token=${token}`, {
      withCredentials: true,
    });

    es.onopen = () => {
      isContextConnectingRef.current = false;
      setContextConnected(true);
      console.log("[Orchestration] Context stream connected");
    };

    es.onerror = () => {
      isContextConnectingRef.current = false;
      setContextConnected(false);
      console.log("[Orchestration] Context stream error, will reconnect...");

      // Close the failed connection
      es.close();
      if (contextSourceRef.current === es) {
        contextSourceRef.current = null;
      }

      // Clear any existing reconnect timeout
      const existingTimeout = reconnectTimeoutsRef.current.get("context");
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      // Schedule reconnection
      const timeout = window.setTimeout(() => {
        reconnectTimeoutsRef.current.delete("context");
        connectContextStream();
      }, RECONNECT_DELAY);
      reconnectTimeoutsRef.current.set("context", timeout);
    };

    // Handle context events
    es.addEventListener("context", (event) => {
      try {
        const data: ContextEvent = JSON.parse(event.data);
        const contextMessage: ContextMessage = {
          id: data.id,
          taskId: data.taskId,
          persona: data.persona as ContextMessage["persona"],
          messageType: data.messageType,
          content: data.content,
          metadata: data.metadata,
          createdAt: data.createdAt,
        };
        addContextMessage(contextMessage);
      } catch (err) {
        console.error("[Orchestration] Failed to parse context event:", err);
      }
    });

    // Handle connected event
    es.addEventListener("connected", () => {
      console.log("[Orchestration] Context stream initialized");
    });

    contextSourceRef.current = es;
  }, [parentTaskId, setContextConnected, addContextMessage]);

  // Connect to log stream for a specific task
  const connectLogStream = useCallback(
    (taskId: string) => {
      // Skip synthetic IDs like "planned-0" - only connect for real UUID task IDs
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(taskId)) {
        return;
      }

      // Skip if already connected
      if (logSourcesRef.current.has(taskId)) {
        return;
      }

      const token = localStorage.getItem("accessToken");
      const url = `${API_BASE}/api/control-center/logs/${taskId}/stream`;

      const es = new EventSource(`${url}?token=${token}`, {
        withCredentials: true,
      });

      es.onopen = () => {
        console.log(`[Orchestration] Log stream connected for task ${taskId}`);
      };

      es.onerror = () => {
        console.log(
          `[Orchestration] Log stream error for task ${taskId}, will reconnect...`
        );

        // Close and remove the failed connection
        es.close();
        logSourcesRef.current.delete(taskId);

        // Clear any existing reconnect timeout
        const existingTimeout = reconnectTimeoutsRef.current.get(
          `log-${taskId}`
        );
        if (existingTimeout) {
          clearTimeout(existingTimeout);
        }

        // Schedule reconnection - will reconnect if still needed
        const timeout = window.setTimeout(() => {
          reconnectTimeoutsRef.current.delete(`log-${taskId}`);
        }, RECONNECT_DELAY);
        reconnectTimeoutsRef.current.set(`log-${taskId}`, timeout);
      };

      // Handle log events
      es.addEventListener("log", (event) => {
        try {
          const data: LogEvent = JSON.parse(event.data);
          appendChildLogs(taskId, [data.message]);
        } catch (err) {
          console.error("[Orchestration] Failed to parse log event:", err);
        }
      });

      // Handle status changes
      es.addEventListener("status", (event) => {
        try {
          const data = JSON.parse(event.data);
          updateChild(taskId, { status: data.status });
        } catch (err) {
          console.error("[Orchestration] Failed to parse status event:", err);
        }
      });

      // Handle completion
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "complete") {
            updateChild(taskId, { status: data.status });
            // Close stream on completion
            es.close();
            logSourcesRef.current.delete(taskId);
          }
        } catch {
          // Ignore parse errors for non-JSON messages
        }
      };

      logSourcesRef.current.set(taskId, es);
    },
    [appendChildLogs, updateChild]
  );

  // Disconnect log stream for a specific task
  const disconnectLogStream = useCallback((taskId: string) => {
    const es = logSourcesRef.current.get(taskId);
    if (es) {
      es.close();
      logSourcesRef.current.delete(taskId);
    }

    // Clear any pending reconnect
    const timeoutKey = `log-${taskId}`;
    const timeout = reconnectTimeoutsRef.current.get(timeoutKey);
    if (timeout) {
      clearTimeout(timeout);
      reconnectTimeoutsRef.current.delete(timeoutKey);
    }
  }, []);

  // Connect to context stream on mount - only depends on parentTaskId
  useEffect(() => {
    if (parentTaskId) {
      connectContextStream();
    }

    return () => {
      // Cleanup context stream
      if (contextSourceRef.current) {
        contextSourceRef.current.close();
        contextSourceRef.current = null;
      }

      // Clear context reconnect timeout
      const contextTimeout = reconnectTimeoutsRef.current.get("context");
      if (contextTimeout) {
        clearTimeout(contextTimeout);
        reconnectTimeoutsRef.current.delete("context");
      }
    };
  }, [parentTaskId]); // Only reconnect when parentTaskId changes

  // Manage log streams based on tasksToStream set
  // This connects to active tab + all executing tasks
  useEffect(() => {
    // Connect to all tasks that need streaming
    tasksToStream.forEach((taskId) => {
      connectLogStream(taskId);
    });

    // Disconnect from tasks that no longer need streaming
    logSourcesRef.current.forEach((_, taskId) => {
      if (!tasksToStream.has(taskId)) {
        disconnectLogStream(taskId);
      }
    });
  }, [tasksToStream, connectLogStream, disconnectLogStream]);

  // Cleanup all streams on unmount
  useEffect(() => {
    return () => {
      // Close all log streams
      logSourcesRef.current.forEach((es) => es.close());
      logSourcesRef.current.clear();

      // Close context stream
      if (contextSourceRef.current) {
        contextSourceRef.current.close();
        contextSourceRef.current = null;
      }

      // Clear all timeouts
      reconnectTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      reconnectTimeoutsRef.current.clear();
    };
  }, []);

  // Manual reconnect function
  const reconnectContext = useCallback(() => {
    // Clear any pending reconnect first
    const existingTimeout = reconnectTimeoutsRef.current.get("context");
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      reconnectTimeoutsRef.current.delete("context");
    }
    isContextConnectingRef.current = false;
    connectContextStream();
  }, [connectContextStream]);

  return {
    isContextConnected,
    reconnectContext,
  };
}

import { useEffect, useRef, useCallback } from "react";
import { useOrchestrationStore } from "../orchestration-store";
import type { ContextMessage, ContextMessageType } from "../orchestration-store";

const API_BASE = import.meta.env.VITE_API_URL || "";
const RECONNECT_DELAY = 5000;

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
 * 1. Task log streams (for expanded story terminals)
 * 2. Coordination context stream (for sidebar feed)
 */
export function useOrchestrationStreams(parentTaskId: string | undefined) {
  const store = useOrchestrationStore();

  // Refs for managing connections
  const contextSourceRef = useRef<EventSource | null>(null);
  const logSourcesRef = useRef<Map<string, EventSource>>(new Map());
  const reconnectTimeoutsRef = useRef<Map<string, number>>(new Map());

  // Get the currently expanded story ID
  const expandedStoryId = store.expandedStoryId;

  // Connect to coordination context stream
  const connectContextStream = useCallback(() => {
    if (!parentTaskId) return;

    // Close existing connection
    if (contextSourceRef.current) {
      contextSourceRef.current.close();
    }

    const token = localStorage.getItem("accessToken");
    const url = `${API_BASE}/api/coordination/context/${parentTaskId}/stream`;

    // Note: EventSource doesn't support custom headers, so we use URL params
    // The backend should accept token via query param for SSE
    const es = new EventSource(`${url}?token=${token}`, {
      withCredentials: true,
    });

    es.onopen = () => {
      store.setContextConnected(true);
      console.log("[Orchestration] Context stream connected");
    };

    es.onerror = () => {
      store.setContextConnected(false);
      console.log("[Orchestration] Context stream error, reconnecting...");

      // Clear any existing reconnect timeout
      const existingTimeout = reconnectTimeoutsRef.current.get("context");
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      // Schedule reconnection
      const timeout = window.setTimeout(() => {
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
        store.addContextMessage(contextMessage);
      } catch (err) {
        console.error("[Orchestration] Failed to parse context event:", err);
      }
    });

    // Handle connected event
    es.addEventListener("connected", () => {
      console.log("[Orchestration] Context stream initialized");
    });

    contextSourceRef.current = es;
  }, [parentTaskId, store]);

  // Connect to log stream for a specific task
  const connectLogStream = useCallback(
    (taskId: string) => {
      // Skip synthetic IDs like "planned-0" - only connect for real UUID task IDs
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(taskId)) {
        console.log(
          `[Orchestration] Skipping log stream for non-UUID task ${taskId}`
        );
        return;
      }

      // Close existing connection for this task
      const existing = logSourcesRef.current.get(taskId);
      if (existing) {
        existing.close();
        logSourcesRef.current.delete(taskId);
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
          `[Orchestration] Log stream error for task ${taskId}, reconnecting...`
        );

        // Clear any existing reconnect timeout
        const existingTimeout = reconnectTimeoutsRef.current.get(
          `log-${taskId}`
        );
        if (existingTimeout) {
          clearTimeout(existingTimeout);
        }

        // Only reconnect if this task is still expanded
        if (store.expandedStoryId === taskId) {
          const timeout = window.setTimeout(() => {
            connectLogStream(taskId);
          }, RECONNECT_DELAY);
          reconnectTimeoutsRef.current.set(`log-${taskId}`, timeout);
        }
      };

      // Handle log events
      es.addEventListener("log", (event) => {
        try {
          const data: LogEvent = JSON.parse(event.data);
          store.appendChildLogs(taskId, [data.message]);
        } catch (err) {
          console.error("[Orchestration] Failed to parse log event:", err);
        }
      });

      // Handle status changes
      es.addEventListener("status", (event) => {
        try {
          const data = JSON.parse(event.data);
          store.updateChild(taskId, { status: data.status });
        } catch (err) {
          console.error("[Orchestration] Failed to parse status event:", err);
        }
      });

      // Handle completion
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "complete") {
            store.updateChild(taskId, { status: data.status });
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
    [store]
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

  // Connect to context stream on mount
  useEffect(() => {
    if (parentTaskId) {
      connectContextStream();
    }

    return () => {
      // Cleanup context stream
      if (contextSourceRef.current) {
        contextSourceRef.current.close();
      }

      // Clear context reconnect timeout
      const contextTimeout = reconnectTimeoutsRef.current.get("context");
      if (contextTimeout) {
        clearTimeout(contextTimeout);
      }
    };
  }, [parentTaskId, connectContextStream]);

  // Manage log stream based on expanded story
  useEffect(() => {
    // If a story is expanded, connect to its log stream
    if (expandedStoryId) {
      connectLogStream(expandedStoryId);
    }

    // Cleanup: disconnect all log streams except the expanded one
    logSourcesRef.current.forEach((_, taskId) => {
      if (taskId !== expandedStoryId) {
        disconnectLogStream(taskId);
      }
    });

    return () => {
      // On unmount, disconnect the current log stream
      if (expandedStoryId) {
        disconnectLogStream(expandedStoryId);
      }
    };
  }, [expandedStoryId, connectLogStream, disconnectLogStream]);

  // Cleanup all streams on unmount
  useEffect(() => {
    return () => {
      // Close all log streams
      logSourcesRef.current.forEach((es) => es.close());
      logSourcesRef.current.clear();

      // Close context stream
      if (contextSourceRef.current) {
        contextSourceRef.current.close();
      }

      // Clear all timeouts
      reconnectTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      reconnectTimeoutsRef.current.clear();
    };
  }, []);

  // Manual reconnect functions
  const reconnectContext = useCallback(() => {
    connectContextStream();
  }, [connectContextStream]);

  const reconnectLogs = useCallback(() => {
    if (expandedStoryId) {
      connectLogStream(expandedStoryId);
    }
  }, [expandedStoryId, connectLogStream]);

  return {
    isContextConnected: store.isContextConnected,
    reconnectContext,
    reconnectLogs,
  };
}

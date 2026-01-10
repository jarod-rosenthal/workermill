import { useState, useEffect, useCallback, useRef } from "react";

export interface Stats {
  totalWorkers: number;
  activeWorkers: number;
  queueDepth: number;
  todayCost: number;
  todayCompleted: number;
  todayFailed: number;
  cumulativeCost: number;
}

export interface Worker {
  id: string;
  displayName: string;
  persona: string;
  status: string;
  tasksCompleted: number;
  tasksFailed: number;
  totalCostUsd: number;
  currentTask: {
    id: string;
    externalKey: string;
    summary: string;
    status: string;
  } | null;
}

export interface TaskStep {
  current: number;
  total: number;
  label: string;
}

export interface ActiveTask {
  id: string;
  externalKey: string;
  summary: string;
  status: string;
  workerName: string;
  workerPersona: string;
  workerModel?: string;
  estimatedCostUsd: number;
  startedAt: string | null;
  hasPr: boolean;
  gitPrUrl: string | null;
  steps: TaskStep;
}

export interface CompletedTask {
  id: string;
  externalKey: string;
  summary: string;
  status: string;
  workerModel?: string;
  costUsd: number;
  durationMinutes: number | null;
  completedAt: string;
  gitPrUrl: string | null;
}

export interface ControlCenterData {
  stats: Stats;
  workers: Worker[];
  activeTasks: ActiveTask[];
  recentCompleted: CompletedTask[];
}

interface UseControlCenterOptions {
  apiUrl?: string;
  apiKey?: string;
  pollingInterval?: number;
  useSSE?: boolean;
}

export function useControlCenter(options: UseControlCenterOptions = {}) {
  const {
    apiUrl = "",
    apiKey,
    pollingInterval = 5000,
    useSSE = true,
  } = options;

  const [data, setData] = useState<ControlCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [connected, setConnected] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const getAuthHeaders = useCallback(() => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    return headers;
  }, [apiKey]);

  const fetchData = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/v1/control-center`, {
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`);
      }

      const result = await response.json();
      setData(result);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [apiUrl, getAuthHeaders]);

  // Setup SSE connection
  const setupSSE = useCallback(() => {
    if (!useSSE) return;

    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const url = new URL(`${apiUrl}/api/v1/control-center/stream`);
    if (apiKey) {
      url.searchParams.set("token", apiKey);
    }

    const es = new EventSource(url.toString());

    es.onopen = () => {
      setConnected(true);
      setError(null);
    };

    es.addEventListener("control_center_update", (event) => {
      try {
        const payload = JSON.parse(event.data);
        setData(payload);
        setLastUpdated(new Date());
      } catch (err) {
        console.error("Failed to parse SSE data:", err);
      }
    });

    es.addEventListener("ping", () => {
      // Keep-alive, no action needed
    });

    es.onerror = () => {
      setConnected(false);
      // Fallback to polling on error
      if (!pollIntervalRef.current) {
        pollIntervalRef.current = setInterval(fetchData, pollingInterval);
      }
    };

    eventSourceRef.current = es;
  }, [apiUrl, apiKey, useSSE, fetchData, pollingInterval]);

  // Initialize
  useEffect(() => {
    fetchData();

    if (useSSE) {
      setupSSE();
    } else {
      pollIntervalRef.current = setInterval(fetchData, pollingInterval);
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [fetchData, setupSSE, useSSE, pollingInterval]);

  const refresh = useCallback(() => {
    fetchData();
  }, [fetchData]);

  return {
    data,
    loading,
    error,
    lastUpdated,
    connected,
    refresh,
  };
}

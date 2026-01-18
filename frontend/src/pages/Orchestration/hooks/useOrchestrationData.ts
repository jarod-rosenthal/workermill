import { useEffect, useCallback, useState, useRef, useMemo } from "react";
import { useOrchestrationStore } from "../orchestration-store";
import type { ParentTask, ChildTask } from "../orchestration-store";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface ApiParentTask {
  id: string;
  jiraIssueKey: string;
  summary: string;
  status: string;
  workerPersona: string;
  workerModel: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  estimatedCostUsd?: number;
  planJson?: unknown;
}

interface ApiChildTask {
  id: string;
  storyIndex: number;
  storyTitle: string;
  persona: string;
  model: string;
  status: string;
  dependencies?: string[];
  description?: string;
  githubPrUrl?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  estimatedCostUsd?: number;
}

interface ChildrenResponse {
  parentTaskId: string;
  jiraIssueKey: string;
  summary: string;
  status: string;
  isParentTask: boolean;
  isPlanningPhase?: boolean;
  childCount: number;
  children: ApiChildTask[];
}

/**
 * Hook for fetching orchestration data (parent task + children)
 * Provides initial data load and manual refresh capability
 */
export function useOrchestrationData(parentTaskId: string | undefined) {
  // Get stable action references from store (these don't change between renders)
  const setParentTask = useOrchestrationStore((state) => state.setParentTask);
  const setChildren = useOrchestrationStore((state) => state.setChildren);
  const touchLastUpdate = useOrchestrationStore((state) => state.touchLastUpdate);
  const setStoreError = useOrchestrationStore((state) => state.setError);
  const parentTask = useOrchestrationStore((state) => state.parentTask);
  // Select the raw children Map - this will trigger re-renders when it changes
  const childrenMap = useOrchestrationStore((state) => state.children);
  // Also track lastUpdate to ensure we re-render after data changes
  const lastUpdate = useOrchestrationStore((state) => state.lastUpdate);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasFetchedDetailsRef = useRef(false);

  // Get auth headers
  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem("accessToken");
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }, []);

  // Transform API data to store format
  const transformParentTask = useCallback(
    (apiTask: ApiParentTask): ParentTask => ({
      id: apiTask.id,
      jiraIssueKey: apiTask.jiraIssueKey,
      summary: apiTask.summary,
      status: apiTask.status,
      workerPersona: apiTask.workerPersona as ParentTask["workerPersona"],
      workerModel: apiTask.workerModel,
      createdAt: apiTask.createdAt,
      startedAt: apiTask.startedAt,
      completedAt: apiTask.completedAt,
      estimatedCostUsd: apiTask.estimatedCostUsd || 0,
      childCount: 0, // Will be set from response
      planJson: apiTask.planJson as ParentTask["planJson"],
    }),
    []
  );

  const transformChildTask = useCallback(
    (apiTask: ApiChildTask, parentJiraKey: string): ChildTask => ({
      id: apiTask.id,
      jiraIssueKey: `${parentJiraKey}-S${apiTask.storyIndex}`,
      summary: apiTask.storyTitle,
      status: apiTask.status as ChildTask["status"],
      workerPersona: apiTask.persona as ChildTask["workerPersona"],
      workerModel: apiTask.model,
      createdAt: new Date().toISOString(), // Planned stories don't have createdAt yet
      startedAt: apiTask.startedAt ?? undefined,
      completedAt: apiTask.completedAt ?? undefined,
      estimatedCostUsd: apiTask.estimatedCostUsd || 0,
      githubPrUrl: apiTask.githubPrUrl ?? undefined,
      storyIndex: apiTask.storyIndex,
      storyDependencies: apiTask.dependencies?.map((d) => {
        // Parse dependency like "story-1" to get index 1
        const match = d.match(/story-(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      }).filter(Boolean),
      terminalLines: [], // Will be populated by log streaming
    }),
    []
  );

  // Fetch data
  const fetchData = useCallback(async () => {
    if (!parentTaskId) {
      setError("No parent task ID provided");
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(
        `${API_BASE}/api/tasks/${parentTaskId}/children`,
        {
          headers: getAuthHeaders(),
        }
      );

      if (response.status === 401) {
        setError("Authentication required");
        setIsLoading(false);
        return;
      }

      if (response.status === 404) {
        setError("Task not found");
        setIsLoading(false);
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.statusText}`);
      }

      const data: ChildrenResponse = await response.json();

      // Use parent task info from children endpoint response
      const parentJiraKey = data.jiraIssueKey || "Unknown";

      // Set parent task with data from response (will be augmented by fetchParentDetails)
      setParentTask({
        id: parentTaskId,
        jiraIssueKey: parentJiraKey,
        summary: data.summary || "PRD Workflow",
        status: data.status || "executing",
        workerPersona: "project_manager",
        workerModel: "unknown",
        createdAt: new Date().toISOString(),
        estimatedCostUsd: 0,
        childCount: data.childCount,
      });

      // Transform and set children with parent jira key
      const children = data.children.map((c) => transformChildTask(c, parentJiraKey));
      setChildren(children);
      touchLastUpdate();
      setStoreError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      setStoreError(message);
    } finally {
      setIsLoading(false);
    }
  }, [
    parentTaskId,
    getAuthHeaders,
    transformChildTask,
    setParentTask,
    setChildren,
    touchLastUpdate,
    setStoreError,
  ]);

  // Fetch parent task details separately if needed
  const fetchParentDetails = useCallback(async () => {
    if (!parentTaskId) return;

    try {
      const response = await fetch(`${API_BASE}/api/tasks/${parentTaskId}`, {
        headers: getAuthHeaders(),
      });

      if (!response.ok) return;

      const task = await response.json();
      const transformedTask = transformParentTask(task);
      transformedTask.childCount = parentTask?.childCount || 0;
      setParentTask(transformedTask);
    } catch {
      // Silent fail - we already have basic info
    }
  }, [parentTaskId, getAuthHeaders, transformParentTask, parentTask?.childCount, setParentTask]);

  // Reset fetch tracking when parentTaskId changes
  useEffect(() => {
    hasFetchedDetailsRef.current = false;
  }, [parentTaskId]);

  // Initial fetch on mount
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch parent details once after initial load (avoid infinite loop)
  useEffect(() => {
    if (!isLoading && parentTask && !hasFetchedDetailsRef.current) {
      hasFetchedDetailsRef.current = true;
      fetchParentDetails();
    }
  }, [isLoading, fetchParentDetails, parentTask]);

  // Manual refresh function
  const refresh = useCallback(() => {
    fetchData();
  }, [fetchData]);

  // Compute children array and stats from the raw Map (memoized)
  const childrenArray = useMemo(() => {
    const children = Array.from(childrenMap.values());
    // Sort by story index
    return children.sort((a, b) => {
      if (a.storyIndex && b.storyIndex) {
        return a.storyIndex - b.storyIndex;
      }
      return 0;
    });
  }, [childrenMap, lastUpdate]);

  const stats = useMemo(() => {
    const children = Array.from(childrenMap.values());
    return {
      totalStories: children.length,
      planned: children.filter((c) => c.status === "planned").length,
      queued: children.filter((c) => ["queued", "claimed"].includes(c.status)).length,
      running: children.filter((c) => ["environment_setup", "executing"].includes(c.status)).length,
      blocked: children.filter((c) => c.status === "blocked").length,
      completed: children.filter((c) => ["completed", "deployed", "pr_created", "review_requested"].includes(c.status)).length,
      failed: children.filter((c) => ["failed", "cancelled"].includes(c.status)).length,
      totalCostUsd: children.reduce((sum, c) => sum + (c.estimatedCostUsd || 0), 0),
    };
  }, [childrenMap, lastUpdate]);

  return {
    isLoading,
    error,
    refresh,
    parentTask,
    children: childrenArray,
    stats,
  };
}

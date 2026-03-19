import { useState, useEffect, useCallback } from "react";
import { API_BASE } from "../types";

export interface BrowseIssueItem {
  key: string;
  summary: string;
  status: string | null;
  labels: string[];
  assignee: { displayName: string; accountId: string } | null;
  issueType: string | null;
  priority: string | null;
  project: { key: string; name: string } | null;
}

interface UseTaskCreationParams {
  isProPlan: boolean;
  fetchData: () => Promise<void>;
  setActionSuccess: (msg: string | null) => void;
  setActionError: (msg: string | null) => void;
}

export function useTaskCreation({
  isProPlan,
  fetchData,
  setActionSuccess,
  setActionError,
}: UseTaskCreationParams) {
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  const [taskSource, setTaskSource] = useState<"external" | "internal" | "browse">(isProPlan ? "internal" : "external");
  const [createTaskForm, setCreateTaskForm] = useState({
    jiraIssueKey: "",
    workerPersona: "",
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

  // Browse issues state (works with any configured issue tracker)
  const [browseIssues, setBrowseIssues] = useState<BrowseIssueItem[]>([]);
  const [browseIssuesLoading, setBrowseIssuesLoading] = useState(false);
  const [browseSearch, setBrowseSearch] = useState("");
  const [selectedBrowseIssueKey, setSelectedBrowseIssueKey] = useState("");

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

  // Fetch tasks for a specific project
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

  // Fetch issues from the org's configured issue tracker (Jira, Linear, GitHub Issues, or internal boards)
  const fetchBrowseIssues = useCallback(async (query?: string) => {
    setBrowseIssuesLoading(true);
    try {
      const token = localStorage.getItem("accessToken");
      const params = new URLSearchParams({ maxResults: "20" });
      if (query) params.set("q", query);
      const response = await fetch(`${API_BASE}/api/issues?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setBrowseIssues(data.issues || []);
      } else {
        setBrowseIssues([]);
      }
    } catch (err) {
      console.error("Failed to fetch issues:", err);
      setBrowseIssues([]);
    } finally {
      setBrowseIssuesLoading(false);
    }
  }, []);

  // Load projects when switching to internal source
  useEffect(() => {
    if (taskSource === "internal" && internalProjects.length === 0) {
      fetchInternalProjects();
    }
  }, [taskSource, internalProjects.length, fetchInternalProjects]);

  // Load issues when switching to browse source
  useEffect(() => {
    if (taskSource === "browse") {
      fetchBrowseIssues();
    }
  }, [taskSource, fetchBrowseIssues]);

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

      if (taskSource === "browse") {
        // Submit the selected issue key as an external task
        const response = await fetch(`${API_BASE}/api/tasks`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ jiraIssueKey: selectedBrowseIssueKey, workerPersona: createTaskForm.workerPersona }),
        });
        if (response.ok) {
          setActionSuccess("Task created from issue");
          setTimeout(() => setActionSuccess(null), 3000);
          setShowCreateTaskModal(false);
          setSelectedBrowseIssueKey("");
          setBrowseSearch("");
          setBrowseIssues([]);
          setCostEstimate(null);
          fetchData();
        } else {
          const err = await response.json();
          setActionError(err.error || "Failed to create task");
          setTimeout(() => setActionError(null), 5000);
        }
      } else if (taskSource === "internal") {
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

  return {
    showCreateTaskModal,
    setShowCreateTaskModal,
    taskSource,
    setTaskSource,
    createTaskForm,
    setCreateTaskForm,
    createLoading,
    costEstimate,
    setCostEstimate,
    costEstimateLoading,
    internalProjects,
    selectedProjectId,
    setSelectedProjectId,
    internalTasks,
    selectedTaskKey,
    setSelectedTaskKey,
    projectsLoading,
    tasksLoading,
    handleCreateTask,
    fetchCostEstimate,
    // Browse issues
    browseIssues,
    browseIssuesLoading,
    browseSearch,
    setBrowseSearch,
    selectedBrowseIssueKey,
    setSelectedBrowseIssueKey,
    fetchBrowseIssues,
  };
}

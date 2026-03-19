import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../../store/auth-store";
import type { ControlCenterData } from "../types";
import { API_BASE } from "../types";

interface UseTaskActionsParams {
  setData: React.Dispatch<React.SetStateAction<ControlCenterData | null>>;
  fetchData: () => Promise<void>;
}

export function useTaskActions({ setData, fetchData }: UseTaskActionsParams) {
  const navigate = useNavigate();
  const logout = useAuthStore((state) => state.logout);

  // Action states
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [_resetCountersLoading, setResetCountersLoading] = useState(false);

  // Plan feedback state
  const [planFeedbackInput, setPlanFeedbackInput] = useState<{ [taskId: string]: string }>({});
  const [showFeedbackInput, setShowFeedbackInput] = useState<string | null>(null);

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
        fetchData();
      } else {
        const err = await response.json();
        setActionError(err.error || "Failed to cancel task");
        setTimeout(() => setActionError(null), 5000);
        fetchData();
      }
    } catch (_err) {
      setActionError("Failed to cancel task");
      setTimeout(() => setActionError(null), 5000);
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
      const response = await fetch(`${API_BASE}/api/control-center/tasks/${taskId}/trigger-review`, {
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

  const _handleRetryPR = async (taskId: string) => {
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
  const handleAnswerQuestion = useCallback(async (messageId: string, answer: string) => {
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
          persona: "dashboard",
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
  }, [logout, navigate]);

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm("Delete this task from history? This cannot be undone.")) {
      return;
    }
    setActionLoading(taskId);

    // Optimistically remove task from local state
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
        fetchData();
      } else {
        const err = await response.json();
        setActionError(err.error || "Failed to delete task");
        setTimeout(() => setActionError(null), 5000);
        fetchData();
      }
    } catch (_err) {
      setActionError("Failed to delete task");
      setTimeout(() => setActionError(null), 5000);
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
      const response = await fetch(`${API_BASE}/api/tasks/${parentTaskId}/children`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const { children } = await response.json();
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

  // Plan approval handlers
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

  return {
    actionLoading,
    actionSuccess,
    setActionSuccess,
    actionError,
    setActionError,
    planFeedbackInput,
    setPlanFeedbackInput,
    showFeedbackInput,
    setShowFeedbackInput,
    handleCancelTask,
    handleRetryTask,
    handleDeployTask,
    handleReviewTask,
    handleAnswerQuestion,
    handleDeleteTask,
    handlePauseAllChildren,
    handleApprovePlan,
    handleRequestPlanChanges,
  };
}

import { useCallback, useEffect } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw, AlertCircle } from "lucide-react";

import { useAuthStore } from "../../store/auth-store";
import { useOrchestrationStore } from "./orchestration-store";
import { useOrchestrationData } from "./hooks/useOrchestrationData";
import { useOrchestrationStreams } from "./hooks/useOrchestrationStreams";

import { WorkflowHeader } from "./components/WorkflowHeader";
import { StoryLanes } from "./components/StoryLanes";
import { CoordinationFeed } from "./components/CoordinationFeed";
import { DependencyGraph } from "./components/DependencyGraph";

// Import shared dark-ops styles from MissionControl
import "../MissionControl/styles/dark-ops.css";

const API_BASE = import.meta.env.VITE_API_URL || "";

export default function Orchestration() {
  const { parentTaskId } = useParams<{ parentTaskId: string }>();
  const navigate = useNavigate();
  const logout = useAuthStore((state) => state.logout);
  const store = useOrchestrationStore();

  // Fetch initial data and set up polling
  const { isLoading, error, refresh, parentTask, children, stats } =
    useOrchestrationData(parentTaskId);

  // Set up SSE streams for logs and coordination
  const { isContextConnected, reconnectContext } =
    useOrchestrationStreams(parentTaskId);

  // Get auth headers for API calls
  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem("accessToken");
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }, []);

  // Handle pause all workers
  const handlePauseAll = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/orchestrator/stop`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (response.status === 401) {
        logout();
        navigate("/login");
      }
    } catch (err) {
      console.error("Failed to pause all workers:", err);
    }
  }, [getAuthHeaders, logout, navigate]);

  // Handle cancel workflow
  const handleCancelWorkflow = useCallback(async () => {
    if (!parentTaskId) return;

    // Confirm with user
    if (!window.confirm("Are you sure you want to cancel this workflow? This will cancel all child tasks.")) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/tasks/${parentTaskId}/cancel`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (response.status === 401) {
        logout();
        navigate("/login");
      }
      if (response.ok) {
        refresh();
      }
    } catch (err) {
      console.error("Failed to cancel workflow:", err);
    }
  }, [parentTaskId, getAuthHeaders, logout, navigate, refresh]);

  // Toggle story expansion
  const handleToggleStory = useCallback(
    (storyId: string) => {
      store.toggleStory(storyId);
    },
    [store]
  );

  // Feed filter change
  const handleFeedFilterChange = useCallback(
    (filter: Parameters<typeof store.setFeedFilter>[0]) => {
      store.setFeedFilter(filter);
    },
    [store]
  );

  // Toggle feed collapse
  const handleToggleFeed = useCallback(() => {
    store.toggleFeed();
  }, [store]);

  // Toggle dependency graph
  const handleToggleGraph = useCallback(() => {
    store.toggleDependencyGraph();
  }, [store]);

  // Handle answering a question in the coordination feed
  const handleAnswerQuestion = useCallback(
    async (messageId: string, answer: string) => {
      if (!parentTaskId) return;

      try {
        const response = await fetch(`${API_BASE}/api/coordination/commands`, {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({
            parentTaskId,
            type: "answer",
            messageId,
            content: answer,
          }),
        });

        if (response.status === 401) {
          logout();
          navigate("/login");
        }

        if (!response.ok) {
          console.error("Failed to send answer:", await response.text());
        }
      } catch (err) {
        console.error("Failed to send answer:", err);
      }
    },
    [parentTaskId, getAuthHeaders, logout, navigate]
  );

  // Get stable reset function reference
  const reset = useOrchestrationStore((state) => state.reset);

  // Reset store on unmount only
  useEffect(() => {
    return () => {
      reset();
    };
  }, [reset]);

  // Error state
  if (error && !parentTask) {
    return (
      <div className="mission-control">
        <div className="mc-pulse">
          <Link
            to="/mission-control"
            className="flex items-center gap-2 text-[var(--mc-text-secondary)] hover:text-[var(--mc-text-primary)]"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Mission Control
          </Link>
        </div>

        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="mc-tile p-8 text-center">
            <AlertCircle className="w-12 h-12 text-[var(--mc-status-danger)] mx-auto mb-4" />
            <h2 className="text-[var(--mc-text-lg)] font-semibold text-[var(--mc-text-primary)] mb-2">
              {error === "Task not found" ? "Workflow Not Found" : "Error Loading Workflow"}
            </h2>
            <p className="text-[var(--mc-text-secondary)] mb-4">{error}</p>
            <div className="flex items-center justify-center gap-4">
              <button onClick={refresh} className="mc-btn mc-btn-secondary">
                <RefreshCw className="w-4 h-4 mr-2" />
                Try Again
              </button>
              <Link to="/mission-control" className="mc-btn mc-btn-primary">
                Go to Mission Control
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mission-control">
      {/* Header */}
      <div className="mc-pulse">
        <Link
          to="/mission-control"
          className="flex items-center gap-2 text-[var(--mc-text-secondary)] hover:text-[var(--mc-text-primary)]"
        >
          <ArrowLeft className="w-4 h-4" />
          Mission Control
        </Link>

        <div className="mc-pulse-divider" />

        <span className="mc-pulse-logo">
          PRD <span>Orchestration</span>
        </span>

        <div className="flex-1" />

        {/* Refresh Button */}
        <button
          onClick={refresh}
          className="mc-btn mc-btn-ghost"
          title="Refresh Data"
          disabled={isLoading}
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Main Layout - 2 columns */}
      <div className="mc-layout">
        {/* Left Column: Workflow Header + Story Lanes */}
        <div className="mc-layout-main">
          <WorkflowHeader
            parentTask={parentTask}
            stats={stats}
            executionMode={store.executionMode}
            isLoading={isLoading}
            showDependencyGraph={store.showDependencyGraph}
            onPauseAll={handlePauseAll}
            onCancelWorkflow={handleCancelWorkflow}
            onToggleGraph={handleToggleGraph}
          />

          <StoryLanes
            children={children}
            expandedStoryId={store.expandedStoryId}
            onToggleStory={handleToggleStory}
            isLoading={isLoading}
          />
        </div>

        {/* Right Column: Coordination Feed */}
        <div className="mc-layout-sidebar">
          <CoordinationFeed
            messages={store.getFilteredContextMessages()}
            filterType={store.feedFilterType}
            isCollapsed={store.isFeedCollapsed}
            isConnected={isContextConnected}
            onFilterChange={handleFeedFilterChange}
            onToggleCollapse={handleToggleFeed}
            onReconnect={reconnectContext}
            onAnswerQuestion={handleAnswerQuestion}
          />
        </div>
      </div>

      {/* Dependency Graph Modal */}
      {store.showDependencyGraph && (
        <DependencyGraph
          stories={children}
          onClose={handleToggleGraph}
        />
      )}

      {/* Back to Dashboard Link */}
      <Link
        to="/dashboard"
        className="fixed bottom-4 right-4 flex items-center gap-1 text-[var(--mc-text-xs)] text-[var(--mc-text-muted)] hover:text-[var(--mc-text-primary)] transition-colors"
      >
        <ArrowLeft className="w-3 h-3" />
        Classic View
      </Link>
    </div>
  );
}

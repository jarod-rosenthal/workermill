import { useCallback, useEffect, useState, useMemo } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw, AlertCircle, Layers } from "lucide-react";

import { useAuthStore } from "../../store/auth-store";
import { useOrchestrationStore } from "./orchestration-store";
import { ThemeToggle } from "../../components/ThemeToggle";
import { useOrchestrationData } from "./hooks/useOrchestrationData";
import { useOrchestrationStreams } from "./hooks/useOrchestrationStreams";

import { WorkflowHeader } from "./components/WorkflowHeader";
import { CoordinationFeed } from "./components/CoordinationFeed";
import { EmbeddedDependencyGraph, type PlanStory } from "../../components/DependencyGraph";
import { TabbedTerminalPanel } from "./components/TabbedTerminalPanel";
import { CommandBar, type ViewMode, type StatusFilter } from "./components/CommandBar";
import { AttentionPanel } from "./components/AttentionPanel";
import { CompactWorkflowCard } from "./components/CompactWorkflowCard";

// Import shared dark-ops styles from MissionControl
import "../MissionControl/styles/dark-ops.css";

const API_BASE = import.meta.env.VITE_API_URL || "";

export default function Orchestration() {
  const { parentTaskId } = useParams<{ parentTaskId: string }>();
  const navigate = useNavigate();
  const logout = useAuthStore((state) => state.logout);

  // Use stable selectors to prevent unnecessary re-renders
  const activeTerminalTabId = useOrchestrationStore((s) => s.activeTerminalTabId);
  const unreadTasks = useOrchestrationStore((s) => s.unreadTasks);
  const isTerminalPanelCollapsed = useOrchestrationStore((s) => s.isTerminalPanelCollapsed);
  const terminalPanelHeight = useOrchestrationStore((s) => s.terminalPanelHeight);
  const feedFilterType = useOrchestrationStore((s) => s.feedFilterType);
  const isFeedCollapsed = useOrchestrationStore((s) => s.isFeedCollapsed);
  const showDependencyGraph = useOrchestrationStore((s) => s.showDependencyGraph);
  const executionMode = useOrchestrationStore((s) => s.executionMode);
  const getFilteredContextMessages = useOrchestrationStore((s) => s.getFilteredContextMessages);

  // Store actions (stable references)
  const setActiveTerminalTab = useOrchestrationStore((s) => s.setActiveTerminalTab);
  const toggleTerminalPanel = useOrchestrationStore((s) => s.toggleTerminalPanel);
  const setTerminalPanelHeight = useOrchestrationStore((s) => s.setTerminalPanelHeight);
  const setFeedFilter = useOrchestrationStore((s) => s.setFeedFilter);
  const toggleFeed = useOrchestrationStore((s) => s.toggleFeed);
  const toggleDependencyGraph = useOrchestrationStore((s) => s.toggleDependencyGraph);
  const reset = useOrchestrationStore((s) => s.reset);

  // Fetch initial data and set up polling
  const { isLoading, error, refresh, parentTask, children, stats } =
    useOrchestrationData(parentTaskId);

  // Set up SSE streams for logs and coordination
  const { isContextConnected, reconnectContext } =
    useOrchestrationStreams(parentTaskId);

  // Local UI state for redesigned components
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

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

  // Select story terminal tab
  const handleSelectStory = useCallback(
    (storyId: string) => {
      setActiveTerminalTab(storyId);
    },
    [setActiveTerminalTab]
  );

  // Toggle card expansion
  const handleToggleCardExpand = useCallback((storyId: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(storyId)) {
        next.delete(storyId);
      } else {
        next.add(storyId);
      }
      return next;
    });
  }, []);

  // Open terminal for a story
  const handleOpenTerminal = useCallback(
    (storyId: string) => {
      setActiveTerminalTab(storyId);
      if (isTerminalPanelCollapsed) {
        toggleTerminalPanel();
      }
    },
    [setActiveTerminalTab, isTerminalPanelCollapsed, toggleTerminalPanel]
  );

  // Toggle terminal panel
  const handleToggleTerminalPanel = useCallback(() => {
    toggleTerminalPanel();
  }, [toggleTerminalPanel]);

  // Set terminal panel height
  const handleTerminalPanelHeightChange = useCallback(
    (height: number) => {
      setTerminalPanelHeight(height);
    },
    [setTerminalPanelHeight]
  );

  // Keyboard shortcut: Ctrl+` to toggle terminal panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+` (backtick) to toggle terminal panel
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        toggleTerminalPanel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleTerminalPanel]);

  // Feed filter change
  const handleFeedFilterChange = useCallback(
    (filter: Parameters<typeof setFeedFilter>[0]) => {
      setFeedFilter(filter);
    },
    [setFeedFilter]
  );

  // Toggle feed collapse
  const handleToggleFeed = useCallback(() => {
    toggleFeed();
  }, [toggleFeed]);

  // Toggle dependency graph
  const handleToggleGraph = useCallback(() => {
    toggleDependencyGraph();
  }, [toggleDependencyGraph]);

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

  // Reset store on unmount only
  useEffect(() => {
    return () => {
      reset();
    };
  }, [reset]);

  // Get plan stories from parent task's planJson, merged with child status
  const planStories = useMemo((): PlanStory[] => {
    // First try to use planJson.stories from parent (has correct dependency data)
    const planJsonStories = (parentTask?.planJson as { stories?: PlanStory[] } | null)?.stories;

    if (planJsonStories && planJsonStories.length > 0) {
      // Merge with child task status
      return planJsonStories.map((story) => {
        // Find matching child task by storyIndex
        const childTask = children.find((c) => c.storyIndex === story.index);
        return {
          ...story,
          status: childTask?.status ?? story.status,
        };
      });
    }

    // Fallback: derive from children (less accurate for dependencies)
    return children.map((child) => ({
      index: child.storyIndex ?? 0,
      title: child.summary || "",
      persona: child.workerPersona,
      scope: "",
      acceptanceCriteria: [],
      dependencies: child.storyDependencies || [],
      estimatedComplexity: "medium" as const,
      status: child.status,
    }));
  }, [parentTask, children]);

  // Filter and search stories
  const filteredStories = useMemo(() => {
    let result = children;

    // Apply status filter
    if (statusFilter !== "all") {
      result = result.filter((story) => {
        switch (statusFilter) {
          case "attention":
            return story.status === "blocked" || story.status === "failed";
          case "running":
            return ["executing", "environment_setup", "claimed"].includes(story.status);
          case "completed":
            return ["completed", "deployed", "pr_created", "review_requested"].includes(story.status);
          case "failed":
            return ["failed", "cancelled"].includes(story.status);
          default:
            return true;
        }
      });
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (story) =>
          story.summary.toLowerCase().includes(query) ||
          story.jiraIssueKey.toLowerCase().includes(query) ||
          story.workerPersona.toLowerCase().includes(query) ||
          (story.currentFile && story.currentFile.toLowerCase().includes(query))
      );
    }

    return result;
  }, [children, statusFilter, searchQuery]);

  // Error state
  if (error && !parentTask) {
    return (
      <div className="mission-control">
        <div className="mc-pulse">
          <Link
            to="/dashboard"
            className="flex items-center gap-2 text-[var(--mc-text-secondary)] hover:text-[var(--mc-text-primary)]"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
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
              <Link to="/dashboard" className="mc-btn mc-btn-primary">
                Go to Dashboard
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
          to="/dashboard"
          className="flex items-center gap-2 text-[var(--mc-text-secondary)] hover:text-[var(--mc-text-primary)]"
        >
          <ArrowLeft className="w-4 h-4" />
          Dashboard
        </Link>

        <div className="mc-pulse-divider" />

        <span className="mc-pulse-logo">
          PRD <span>Orchestration</span>
        </span>

        <div className="flex-1" />

        {/* Theme Toggle */}
        <ThemeToggle />

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

      {/* Redesigned Main Layout - 3 columns with bottom terminal */}
      <div className="mc-layout-redesigned">
        {/* Left Column: Attention Panel */}
        <div className="mc-layout-attention">
          <AttentionPanel
            parentTask={parentTask}
            stories={children}
            stats={stats}
            onSelectStory={handleSelectStory}
          />
        </div>

        {/* Center Column: Workflow Header + Command Bar + Workflow Cards */}
        <div className="mc-layout-main">
          <WorkflowHeader
            parentTask={parentTask}
            stats={stats}
            executionMode={executionMode}
            isLoading={isLoading}
            showDependencyGraph={showDependencyGraph}
            onPauseAll={handlePauseAll}
            onCancelWorkflow={handleCancelWorkflow}
            onToggleGraph={handleToggleGraph}
          />

          <CommandBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            stories={children}
          />

          {/* Workflow Cards List */}
          <div className="mc-theater">
            <div className="mc-theater-header">
              <span className="mc-theater-title">
                Stories
                <span className="mc-theater-count">{filteredStories.length}</span>
              </span>
            </div>

            {isLoading && children.length === 0 ? (
              <div className="flex flex-col gap-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="mc-tile p-4">
                    <div className="flex items-center gap-4">
                      <div className="mc-skeleton w-8 h-8 rounded-full" />
                      <div className="flex-1">
                        <div className="mc-skeleton w-24 h-4 mb-2" />
                        <div className="mc-skeleton w-48 h-3" />
                      </div>
                      <div className="mc-skeleton w-20 h-4" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredStories.length === 0 ? (
              <div className="mc-empty">
                <div className="mc-empty-icon">
                  <Layers />
                </div>
                <div className="mc-empty-title">
                  {searchQuery || statusFilter !== "all"
                    ? "No matching stories"
                    : "No stories yet"}
                </div>
                <div className="mc-empty-desc">
                  {searchQuery || statusFilter !== "all"
                    ? "Try adjusting your search or filters"
                    : "The Project Manager is analyzing the PRD and will create stories shortly"}
                </div>
              </div>
            ) : (
              <div className={`mc-workflow-list ${viewMode === "list" ? "list-view" : ""}`}>
                {filteredStories.map((story) => (
                  <CompactWorkflowCard
                    key={story.id}
                    story={story}
                    isSelected={activeTerminalTabId === story.id}
                    isExpanded={expandedCards.has(story.id)}
                    onSelect={() => handleSelectStory(story.id)}
                    onToggleExpand={() => handleToggleCardExpand(story.id)}
                    onOpenTerminal={() => handleOpenTerminal(story.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Coordination Feed */}
        <div className="mc-layout-sidebar">
          <CoordinationFeed
            messages={getFilteredContextMessages()}
            filterType={feedFilterType}
            isCollapsed={isFeedCollapsed}
            isConnected={isContextConnected}
            onFilterChange={handleFeedFilterChange}
            onToggleCollapse={handleToggleFeed}
            onReconnect={reconnectContext}
            onAnswerQuestion={handleAnswerQuestion}
          />
        </div>

        {/* Bottom: Tabbed Terminal Panel */}
        <TabbedTerminalPanel
          children={children}
          activeTabId={activeTerminalTabId}
          onTabSelect={handleSelectStory}
          unreadTasks={unreadTasks}
          isCollapsed={isTerminalPanelCollapsed}
          onToggleCollapse={handleToggleTerminalPanel}
          height={terminalPanelHeight}
          onHeightChange={handleTerminalPanelHeightChange}
          parentTaskId={parentTaskId}
        />
      </div>

      {/* Dependency Graph Modal */}
      {showDependencyGraph && planStories.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-[var(--mc-bg-surface)] border border-[var(--mc-border-default)] rounded-lg shadow-2xl max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--mc-border-subtle)] bg-[var(--mc-bg-elevated)]">
              <div>
                <h2 className="text-[var(--mc-text-lg)] font-semibold text-[var(--mc-text-primary)]">
                  Workflow Execution Graph
                </h2>
                {parentTask && (
                  <p className="text-[var(--mc-text-xs)] text-[var(--mc-text-muted)] mt-0.5">
                    {parentTask.jiraIssueKey} - {parentTask.summary}
                  </p>
                )}
              </div>
              <button
                onClick={handleToggleGraph}
                className="mc-btn mc-btn-ghost p-1"
                title="Close"
              >
                <span className="text-xl">&times;</span>
              </button>
            </div>

            {/* Graph Content */}
            <div className="flex-1 overflow-auto p-4">
              <EmbeddedDependencyGraph
                stories={planStories}
                parentTaskStatus={parentTask?.status}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

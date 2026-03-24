import { useState, useEffect, useRef, useMemo } from "react";
import {
  RefreshCw,
  AlertCircle,
  Wrench,
  AlertTriangle,
} from "lucide-react";
import { LogSearch } from "../../components/LogSearch";
import { useAuthStore } from "../../store/auth-store";
import { TrialBanner } from "../../components/TrialBanner";
import { GettingStartedChecklist } from "../../components/GettingStartedChecklist";
import { DashboardSkeleton } from "../../components/ui/skeleton";
import {
  ErrorBoundaryWithRetry,
  DashboardErrorFallback,
} from "../../components/ErrorBoundary";
import { useCoordinationStore, type ContextMessage } from "../../store/coordination-store";
import { useIssueTrackerConfig } from "../../hooks/useIssueTrackerConfig";
import { usePersonas } from "../../hooks/usePersonas";
import type { CompletedTask, ActiveTask } from "./types";
import { TERMINAL_STATUSES, API_BASE, PERSONA_CONFIG } from "./types";
import { useTaskDataFetching, useTaskStreaming, useTaskActions, useTaskCreation, useTalkToWorker } from "./hooks";
import { DashboardHeader } from "./components/DashboardHeader";
import { ActiveTasksSection } from "./components/ActiveTasksSection";
import { AllTasksSection } from "./components/AllTasksSection";
import { CreateTaskModal } from "./components/CreateTaskModal";
import { TaskDetailsModal } from "./components/TaskDetailsModal";
import { TalkToWorkerModal } from "./components/TalkToWorkerModal";

export default function Dashboard() {
  const _organization = useAuthStore((state) => state.organization);

  // Coordination store for blocker alerts
  const coordinationMessages = useCoordinationStore((s) => s.messages);

  // Detect active rate limit blockers across all tasks
  const rateLimitBlockers = useMemo(() => {
    const blockers = coordinationMessages.filter(
      (m: ContextMessage) =>
        (m.messageType === "blocker_detected" ||
          (m.messageType === "blocker" && m.metadata?.isEscalated === true)) &&
        m.metadata?.errorCategory === "rate_limit",
    );
    const resolvedIds = new Set(
      coordinationMessages
        .filter(
          (m: ContextMessage) =>
            m.messageType === "blocker_resolved" ||
            (m.messageType === "answer" && m.metadata?.blockerAction),
        )
        .map(
          (m: ContextMessage) =>
            (m.metadata?.blockerId as string) || m.id,
        )
        .filter(Boolean),
    );
    return blockers.filter((m: ContextMessage) => !resolvedIds.has(m.id));
  }, [coordinationMessages]);

  // Persona metadata from API with fallback
  const personas = usePersonas();
  const personaEmojis = Object.fromEntries(
    Object.entries(personas).map(([slug, meta]) => [slug, meta.emoji || ""]),
  );
  const personaMap = Object.fromEntries(
    Object.entries(personas).map(([slug, meta]) => [
      slug,
      { emoji: meta.emoji || "", shortLabel: meta.shortLabel || slug },
    ]),
  );

  const _isProPlan = false;

  // --- Hooks ---
  const {
    data, setData, loading, error, fetchData,
    systemEnabled, systemToggleLoading, toggleSystem,
    remoteAgentOnly, hasRemoteAgent, remoteAgentOnline,
    mainEventSourceRef, setSseConnected,
  } = useTaskDataFetching();

  const [hiddenTerminals, setHiddenTerminals] = useState<Set<string>>(new Set());
  const [shownTerminals, setShownTerminals] = useState<Set<string>>(new Set());
  const [unreadCommsCount, setUnreadCommsCount] = useState<Record<string, number>>({});
  const hasAutoExpandedCommsRef = useRef<Record<string, boolean>>({});
  const prevCommsCountsRef = useRef<Record<string, number>>({});
  const autoCollapsedRef = useRef<Set<string>>(new Set());

  const {
    planningProgress, streamingLogs,
    errorPanelExpanded, setErrorPanelExpanded,
    terminalRefs, workerOffline,
    autoScrollEnabled, setAutoScrollEnabled,
    codeFiles, selectedCodeFile, setSelectedCodeFile,
    terminalTab, setTerminalTab, userSelectedFileRef,
  } = useTaskStreaming({ data, setData, fetchData, hiddenTerminals, mainEventSourceRef, setSseConnected });

  const {
    actionLoading, actionSuccess, setActionSuccess, actionError, setActionError,
    planFeedbackInput, setPlanFeedbackInput, showFeedbackInput, setShowFeedbackInput,
    handleCancelTask, handleRetryTask, handleDeployTask, handleReviewTask,
    handleAnswerQuestion, handleDeleteTask, handlePauseAllChildren,
    handleApprovePlan, handleRequestPlanChanges,
  } = useTaskActions({ setData, fetchData });

  const {
    showCreateTaskModal, setShowCreateTaskModal,
    taskSource, setTaskSource, createTaskForm, setCreateTaskForm,
    createLoading, costEstimate, setCostEstimate, costEstimateLoading,
    internalProjects, selectedProjectId, setSelectedProjectId,
    internalTasks, selectedTaskKey, setSelectedTaskKey,
    projectsLoading, tasksLoading, handleCreateTask, fetchCostEstimate,
    browseIssues, browseIssuesLoading, browseSearch, setBrowseSearch,
    selectedBrowseIssueKey, setSelectedBrowseIssueKey, fetchBrowseIssues,
  } = useTaskCreation({ isProPlan: false, fetchData, setActionSuccess, setActionError });

  const {
    isTalkOpen, talkMessage, setTalkMessage, talkLoading,
    talkTargetTaskId, talkTargetTaskTitle,
    handleTalkToWorker, openTalkModal, closeTalkModal,
  } = useTalkToWorker({ setActionSuccess, setActionError });

  // Local UI state
  const [selectedTask, setSelectedTask] = useState<CompletedTask | null>(null);
  const [taskModalTab, setTaskModalTab] = useState<"details" | "logs">("details");
  const [isLogSearchOpen, setIsLogSearchOpen] = useState(false);
  const [isEfficiencyDropdownOpen, setIsEfficiencyDropdownOpen] = useState(false);
  const efficiencyDropdownRef = useRef<HTMLDivElement>(null);
  const [openActionMenu, setOpenActionMenu] = useState<string | null>(null);
  const issueTrackerConfig = useIssueTrackerConfig();

  // Keyboard shortcut for search (Cmd/Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsLogSearchOpen(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Close efficiency dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (efficiencyDropdownRef.current && !efficiencyDropdownRef.current.contains(event.target as Node)) {
        setIsEfficiencyDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Auto-expand comms panel when new coordination messages arrive
  useEffect(() => {
    if (!data?.activeTasks) return;
    const activeTaskIds = new Set(data.activeTasks.map((t) => t.id));
    for (const taskId of activeTaskIds) {
      const taskMessages = coordinationMessages.filter((m) => m.parentTaskId === taskId && m.messageType !== "story_ready");
      const count = taskMessages.length;
      const prevCount = prevCommsCountsRef.current[taskId] || 0;
      if (count > prevCount && prevCount > 0) {
        if (hasAutoExpandedCommsRef.current[taskId]) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- accumulating unread counts from SSE
          setUnreadCommsCount((prev) => ({ ...prev, [taskId]: (prev[taskId] || 0) + (count - prevCount) }));
        }
      }
      if (count > 0 && !hasAutoExpandedCommsRef.current[taskId]) {
        hasAutoExpandedCommsRef.current[taskId] = true;
        const task = data.activeTasks.find((t) => t.id === taskId);
        if (task && !TERMINAL_STATUSES.includes(task.status)) {
          setHiddenTerminals((prev) => { if (!prev.has(taskId)) return prev; const next = new Set(prev); next.delete(taskId); return next; });
        }
        setErrorPanelExpanded((prev) => ({ ...prev, [taskId]: true }));
      }
      prevCommsCountsRef.current[taskId] = count;
    }
  }, [coordinationMessages, data?.activeTasks, setErrorPanelExpanded]);

  // Auto-collapse terminals once when tasks first transition to terminal status
  useEffect(() => {
    if (!data?.activeTasks) return;
    const newlyTerminal = data.activeTasks
      .filter((t) => TERMINAL_STATUSES.includes(t.status) && !autoCollapsedRef.current.has(t.id));
    if (newlyTerminal.length === 0) return;
    for (const t of newlyTerminal) autoCollapsedRef.current.add(t.id);
    setShownTerminals((prev) => {
      const toRemove = newlyTerminal.filter((t) => prev.has(t.id));
      if (toRemove.length === 0) return prev;
      const next = new Set(prev);
      for (const t of toRemove) next.delete(t.id);
      return next;
    });
  }, [data?.activeTasks]);

  // --- Helper functions ---
  const toggleTerminal = (taskId: string, taskStatus: string) => {
    const isCompletedTask = TERMINAL_STATUSES.includes(taskStatus);
    if (isCompletedTask) {
      setShownTerminals((prev) => { const s = new Set(prev); if (s.has(taskId)) s.delete(taskId); else s.add(taskId); return s; });
    } else {
      setHiddenTerminals((prev) => { const s = new Set(prev); if (s.has(taskId)) s.delete(taskId); else s.add(taskId); return s; });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed": case "deployed": return "text-green-500";
      case "executing": return "text-blue-500";
      case "planning": return "text-cyan-500";
      case "pending_plan_approval": return "text-amber-500";
      case "queued": case "claimed": case "environment_setup": return "text-yellow-500";
      case "failed": return "text-red-500";
      case "blocked": case "revision_needed": case "escalated": return "text-orange-500";
      case "cancelled": return "text-gray-500";
      case "pr_created": case "review_pending": case "review_requested": return "text-purple-500";
      case "manager_review": return "text-indigo-500";
      case "review_approved": case "pr_approved": return "text-blue-500";
      case "review_rejected": return "text-red-400";
      case "integration_check": return "text-teal-500";
      case "deployment_pending": case "deploying": return "text-blue-400";
      default: return "text-muted-foreground";
    }
  };

  const getPersonaInfo = (persona: string) =>
    PERSONA_CONFIG[persona] || { emoji: "\u{1F916}", title: persona, description: "AI Worker", skills: [] };

  function isEpicTask(task: ActiveTask): boolean {
    return task.pipelineVersion === "v2" || task.isRalphTask === true || task.isEpicWorkflow === true ||
      task.executionMode === "parallel" || task.executionMode === "multi-expert" ||
      (task.childTaskIds !== undefined && task.childTaskIds.length > 0);
  }

  // --- Early returns ---
  if (loading && !data) return <DashboardSkeleton />;
  if (error && !data) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <AlertCircle className="w-12 h-12 text-red-500" />
        <p className="text-lg text-red-500">{error}</p>
        <button onClick={fetchData} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">Retry</button>
      </div>
    );
  }

  // --- Main render ---
  return (
    <div className="min-h-screen bg-background relative overflow-hidden" data-testid="dashboard">
      <div className="fixed inset-0 bg-grid-pattern pointer-events-none opacity-50" />
      <div className="fixed inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5 pointer-events-none" />

      <DashboardHeader
        data={data}
        isProPlan={false}
        systemEnabled={systemEnabled}
        systemToggleLoading={systemToggleLoading}
        toggleSystem={toggleSystem}
        setShowCreateTaskModal={setShowCreateTaskModal}
        isEfficiencyDropdownOpen={isEfficiencyDropdownOpen}
        setIsEfficiencyDropdownOpen={setIsEfficiencyDropdownOpen}
        efficiencyDropdownRef={efficiencyDropdownRef}
      />

      {/* Maintenance Mode Banner */}
      {!systemEnabled && (
        <div className="bg-yellow-500/10 border-b border-yellow-500/30 px-4 py-3">
          <div className="max-w-full mx-auto flex items-center gap-3 px-2">
            <div className="flex-shrink-0"><Wrench className="w-5 h-5 text-yellow-500" /></div>
            <div className="flex-1">
              <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400">System Maintenance in Progress</p>
              <p className="text-xs text-yellow-600/80 dark:text-yellow-400/80 mt-0.5">New tasks will be queued and will automatically resume when maintenance completes.</p>
            </div>
            <div className="flex-shrink-0 flex items-center gap-3">
              {(data?.stats?.queueDepth ?? 0) > 0 && (
                <span className="text-xs text-yellow-600/80 dark:text-yellow-400/80">{data?.stats?.queueDepth} task{(data?.stats?.queueDepth ?? 0) !== 1 ? "s" : ""} queued</span>
              )}
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 text-xs font-medium">
                <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />Maintenance Mode
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-6 pt-4"><TrialBanner /></div>
      <div className="max-w-7xl mx-auto px-6"><GettingStartedChecklist /></div>

      {/* Success/Error Alerts */}
      {actionSuccess && (
        <div className="max-w-7xl mx-auto px-6 pt-4">
          <div className="bg-green-500/10 border border-green-500/30 text-green-500 px-4 py-3 rounded-lg flex items-center justify-between">
            {actionSuccess}
            <button onClick={() => setActionSuccess(null)} className="font-bold">&times;</button>
          </div>
        </div>
      )}
      {actionError && (
        <div className="max-w-7xl mx-auto px-6 pt-4">
          <div className="bg-red-500/10 border border-red-500/30 text-red-500 px-4 py-3 rounded-lg flex items-center justify-between">
            {actionError}
            <button onClick={() => setActionError(null)} className="font-bold">&times;</button>
          </div>
        </div>
      )}

      <div className="flex min-h-[calc(100vh-80px)]">
        <main className="flex-1 overflow-auto p-6 space-y-6">
          <ErrorBoundaryWithRetry fallback={<DashboardErrorFallback />}>
          {/* Rate limit banner */}
          {rateLimitBlockers.length > 0 && (
            <div className="mb-4 bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
                <div>
                  <span className="font-medium text-foreground">Anthropic usage limit reached</span>
                  <span className="text-sm text-muted-foreground ml-2">{rateLimitBlockers.length} task{rateLimitBlockers.length > 1 ? "s" : ""} paused</span>
                </div>
              </div>
              <button
                onClick={async () => {
                  for (const blocker of rateLimitBlockers) {
                    try { await fetch(`${API_BASE}/api/coordination/blocker-response`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("accessToken")}` }, body: JSON.stringify({ parentTaskId: blocker.parentTaskId, blockerId: blocker.id, action: "retry" }) }); } catch { /* ignore */ }
                  }
                  fetchData();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/20 text-amber-500 hover:bg-amber-500/30 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />Retry All
              </button>
            </div>
          )}

          {/* Active Workflows */}
          <ActiveTasksSection
            activeTasks={data?.activeTasks}
            setIsLogSearchOpen={setIsLogSearchOpen}
            shownTerminals={shownTerminals}
            hiddenTerminals={hiddenTerminals}
            toggleTerminal={toggleTerminal}
            getStatusColor={getStatusColor}
            isEpicTask={isEpicTask}
            issueTrackerConfig={issueTrackerConfig}
            coordinationMessages={coordinationMessages}
            actionLoading={actionLoading}
            handleCancelTask={handleCancelTask}
            handlePauseAllChildren={handlePauseAllChildren}
            handleApprovePlan={handleApprovePlan}
            handleRequestPlanChanges={handleRequestPlanChanges}
            handleAnswerQuestion={handleAnswerQuestion}
            showFeedbackInput={showFeedbackInput}
            setShowFeedbackInput={setShowFeedbackInput}
            planFeedbackInput={planFeedbackInput}
            setPlanFeedbackInput={setPlanFeedbackInput}
            openTalkModal={openTalkModal}
            terminalTab={terminalTab}
            setTerminalTab={setTerminalTab}
            streamingLogs={streamingLogs}
            workerOffline={workerOffline}
            autoScrollEnabled={autoScrollEnabled}
            setAutoScrollEnabled={setAutoScrollEnabled}
            terminalRefs={terminalRefs}
            codeFiles={codeFiles}
            selectedCodeFile={selectedCodeFile}
            setSelectedCodeFile={setSelectedCodeFile}
            userSelectedFileRef={userSelectedFileRef}
            errorPanelExpanded={errorPanelExpanded}
            setErrorPanelExpanded={setErrorPanelExpanded}
            unreadCommsCount={unreadCommsCount}
            setUnreadCommsCount={setUnreadCommsCount}
            personaEmojis={personaEmojis}
            personaMap={personaMap}
            fetchData={fetchData}
          />

          <AllTasksSection
            recentCompleted={data?.recentCompleted}
            actionLoading={actionLoading}
            openActionMenu={openActionMenu}
            setOpenActionMenu={setOpenActionMenu}
            setSelectedTask={setSelectedTask}
            getStatusColor={getStatusColor}
            issueTrackerConfig={issueTrackerConfig}
            handleRetryTask={handleRetryTask}
            handleDeployTask={handleDeployTask}
            handleReviewTask={handleReviewTask}
            handleCancelTask={handleCancelTask}
            handleDeleteTask={handleDeleteTask}
          />
          </ErrorBoundaryWithRetry>
        </main>
      </div>

      {showCreateTaskModal && (
        <CreateTaskModal showCreateTaskModal={showCreateTaskModal} taskSource={taskSource} setTaskSource={setTaskSource} createTaskForm={createTaskForm} setCreateTaskForm={setCreateTaskForm} createLoading={createLoading} costEstimate={costEstimate} setCostEstimate={setCostEstimate} costEstimateLoading={costEstimateLoading} internalProjects={internalProjects} selectedProjectId={selectedProjectId} setSelectedProjectId={setSelectedProjectId} internalTasks={internalTasks} selectedTaskKey={selectedTaskKey} setSelectedTaskKey={setSelectedTaskKey} projectsLoading={projectsLoading} tasksLoading={tasksLoading} handleCreateTask={handleCreateTask} fetchCostEstimate={fetchCostEstimate} browseIssues={browseIssues} browseIssuesLoading={browseIssuesLoading} browseSearch={browseSearch} setBrowseSearch={setBrowseSearch} selectedBrowseIssueKey={selectedBrowseIssueKey} setSelectedBrowseIssueKey={setSelectedBrowseIssueKey} fetchBrowseIssues={fetchBrowseIssues} onClose={() => { setShowCreateTaskModal(false); setTaskSource("external"); setSelectedProjectId(""); setSelectedTaskKey(""); setSelectedBrowseIssueKey(""); setBrowseSearch(""); setCostEstimate(null); }} />
      )}

      {selectedTask && (
        <TaskDetailsModal selectedTask={selectedTask} taskModalTab={taskModalTab} setTaskModalTab={setTaskModalTab} planningProgress={planningProgress} getStatusColor={getStatusColor} issueTrackerConfig={issueTrackerConfig} handleRetryTask={handleRetryTask} onClose={() => { setSelectedTask(null); setTaskModalTab("details"); }} />
      )}

      <LogSearch isOpen={isLogSearchOpen} onClose={() => setIsLogSearchOpen(false)} />

      {isTalkOpen && talkTargetTaskId && (
        <TalkToWorkerModal talkTargetTaskTitle={talkTargetTaskTitle} talkMessage={talkMessage} setTalkMessage={setTalkMessage} talkLoading={talkLoading} handleTalkToWorker={handleTalkToWorker} onClose={closeTalkModal} />
      )}
    </div>
  );
}

import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  RefreshCw,
  ExternalLink,
  CheckCircle,
  Clock,
  DollarSign,
  AlertCircle,
  Terminal,
  Ban,
  Zap,
  Book,
  Layers,
  Cog,
  GitMerge,
  Pause,
  Search,
  ChevronDown,
  Sliders,
  Send,
  PauseCircle,
  Network,
  MessageSquare,
  TrendingUp,
  AlertTriangle,
  FileCode,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import { RalphProgress, RalphProgressCompact } from "../../../components/RalphProgress";
import { CheckpointStatus, CheckpointStatusBadge } from "../../../components/CheckpointStatus";
import { EmbeddedDependencyGraph } from "../../../components/DependencyGraph";
import { BlockerAlert } from "../../../components/BlockerAlert";
import {
  PlanningIcon,
  ApprovedIcon,
  ExpertsIcon,
  PRCreatedIcon,
  ReviewIcon,
  DeployedIcon,
  StepsIcon,
  TechLeadReviewIcon,
} from "../../../components/icons";
import { LiveCodeViewer } from "../../../components/LiveCodeViewer";
import type { DiffFile } from "../../../components/LiveCodeViewer";
import type { ContextMessage } from "../../../store/coordination-store";
import { buildTicketUrl } from "../../../lib/utils";
import type { IssueTrackerConfig } from "../../../lib/utils";
import type { ActiveTask } from "../types";
import { TERMINAL_STATUSES, PERSONA_CONFIG } from "../types";
import { formatCost, formatProviderName, getDerivedProviders, getDerivedModels } from "../helpers";
import { EmbeddedCommunicationsFeed } from "../EmbeddedCommunicationsFeed";
import type { StreamingLog } from "../hooks";

export interface ActiveTasksSectionProps {
  activeTasks: ActiveTask[] | undefined;
  setIsLogSearchOpen: (open: boolean) => void;
  shownTerminals: Set<string>;
  hiddenTerminals: Set<string>;
  toggleTerminal: (taskId: string, taskStatus: string) => void;
  getStatusColor: (status: string) => string;
  isEpicTask: (task: ActiveTask) => boolean;
  issueTrackerConfig: IssueTrackerConfig | null;
  coordinationMessages: ContextMessage[];
  actionLoading: string | null;
  handleCancelTask: (taskId: string) => void;
  handlePauseAllChildren: (taskId: string) => void;
  handleApprovePlan: (taskId: string) => void;
  handleRequestPlanChanges: (taskId: string) => void;
  handleAnswerQuestion: (taskId: string, answer: string) => void;
  showFeedbackInput: string | null;
  setShowFeedbackInput: (taskId: string | null) => void;
  planFeedbackInput: Record<string, string>;
  setPlanFeedbackInput: Dispatch<SetStateAction<Record<string, string>>>;
  openTalkModal: (taskId: string, title: string) => void;
  terminalTab: Record<string, "terminal" | "code">;
  setTerminalTab: Dispatch<SetStateAction<Record<string, "terminal" | "code">>>;
  streamingLogs: Record<string, StreamingLog[]>;
  workerOffline: Record<string, boolean>;
  autoScrollEnabled: boolean;
  setAutoScrollEnabled: (enabled: boolean) => void;
  terminalRefs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  codeFiles: Record<string, Record<string, DiffFile>>;
  selectedCodeFile: Record<string, string | null>;
  setSelectedCodeFile: Dispatch<SetStateAction<Record<string, string | null>>>;
  userSelectedFileRef: MutableRefObject<Record<string, boolean>>;
  errorPanelExpanded: Record<string, boolean>;
  setErrorPanelExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
  unreadCommsCount: Record<string, number>;
  setUnreadCommsCount: Dispatch<SetStateAction<Record<string, number>>>;
  personaEmojis: Record<string, string>;
  personaMap: Record<string, { emoji: string; shortLabel: string }>;
  fetchData: () => Promise<void>;
}

const getPersonaInfo = (persona: string) =>
  PERSONA_CONFIG[persona] || { emoji: "\u{1F916}", title: persona, description: "AI Worker", skills: [] };

export function ActiveTasksSection({
  activeTasks,
  setIsLogSearchOpen,
  shownTerminals,
  hiddenTerminals,
  toggleTerminal,
  getStatusColor,
  isEpicTask,
  issueTrackerConfig,
  coordinationMessages,
  actionLoading,
  handleCancelTask,
  handlePauseAllChildren,
  handleApprovePlan,
  handleRequestPlanChanges,
  handleAnswerQuestion,
  showFeedbackInput,
  setShowFeedbackInput,
  planFeedbackInput,
  setPlanFeedbackInput,
  openTalkModal,
  terminalTab,
  setTerminalTab,
  streamingLogs,
  workerOffline,
  autoScrollEnabled,
  setAutoScrollEnabled,
  terminalRefs,
  codeFiles,
  selectedCodeFile,
  setSelectedCodeFile,
  userSelectedFileRef,
  errorPanelExpanded,
  setErrorPanelExpanded,
  unreadCommsCount,
  setUnreadCommsCount,
  personaEmojis,
  personaMap,
  fetchData,
}: ActiveTasksSectionProps) {
  return (
    <div className="card-elevated border border-border/50 rounded-xl overflow-hidden" data-testid="task-list">
      <div className="p-4 border-b border-border/50 bg-gradient-to-r from-primary/10 to-transparent flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Zap className="w-5 h-5 text-primary" />Active Workflows
          {activeTasks && activeTasks.length > 0 && (
            <span className="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-primary/20 text-primary animate-pulse">{activeTasks.length} running</span>
          )}
        </h2>
        <button onClick={() => setIsLogSearchOpen(true)} className="flex items-center gap-2 px-3 py-1.5 bg-background border border-border/50 rounded-lg text-sm transition-colors text-muted-foreground hover:text-foreground hover:bg-muted/50" title="Search all task logs">
          <Search className="w-4 h-4" /><span>Search tasks and logs...</span>
        </button>
      </div>
      <div className="divide-y divide-border">
        {activeTasks && activeTasks.length > 0 ? (
          activeTasks.map((task, index, filteredTasks) => {
            const firstActiveIndex = filteredTasks.findIndex(t => !TERMINAL_STATUSES.includes(t.status));
            const isCompletedTask = TERMINAL_STATUSES.includes(task.status);
            const isTerminalVisible = isCompletedTask ? shownTerminals.has(task.id) : !hiddenTerminals.has(task.id);
            const isActivelyRunning = ["executing", "environment_setup", "dispatching", "planning"].includes(task.status);
            void firstActiveIndex; // used for logic parity
            return (
              <div key={task.id} className={`p-4 ${isActivelyRunning ? "animate-tile-scroll" : ""}`}
                style={isActivelyRunning ? { backgroundImage: "repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(59,130,246,0.04) 3px, rgba(59,130,246,0.04) 6px)", backgroundSize: "8px 8px" } : undefined}
                data-testid="task-card"
              >
                {/* Task Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-3">
                      {(task.status === "planning" || task.status === "pending_plan_approval") ? (
                        <><span className="text-4xl">{"\u{1F4CB}"}</span><span className="text-xl font-medium text-foreground">Project Manager</span>
                          {task.status === "pending_plan_approval" && <span className="text-primary text-sm">(awaiting your approval)</span>}</>
                      ) : task.status === "manager_review" && task.managerEcsTaskId ? (
                        <><span className="text-4xl">{"\u{1F454}"}</span><span className="text-xl font-medium text-foreground">Tech Lead</span>
                          <span className="text-muted-foreground text-sm">(reviewing {getPersonaInfo(task.workerPersona).title}'s PR)</span></>
                      ) : (
                        <><span className="text-4xl">{getPersonaInfo(task.workerPersona).emoji}</span><span className="text-xl font-medium text-foreground">{getPersonaInfo(task.workerPersona).title}</span></>
                      )}
                    </div>
                    <span className="text-muted-foreground">{"\u2022"}</span>
                    {(() => { const url = buildTicketUrl(task.jiraIssueKey, issueTrackerConfig ?? undefined, task.cardBoardId && task.cardId ? { boardId: task.cardBoardId, cardId: task.cardId } : null); const isExt = url?.startsWith("http"); return url ? <a href={url} {...(isExt ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="text-primary hover:underline font-medium flex items-center gap-1">{task.jiraIssueKey}{isExt && <ExternalLink className="w-3 h-3" />}</a> : <span className="font-medium">{task.jiraIssueKey}</span>; })()}
                    <span className="text-muted-foreground">{task.summary}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {(() => { const isLocal = !!task.claimedByAgent; const isReview = task.skipManagerReview === false; const isDeploy = !!task.deploymentEnabled; const hasManager = !!task.managerEnabled; const parts: string[] = []; if (isLocal) parts.push("Local"); if (isReview) parts.push("PR-Review"); if (isDeploy) parts.push("Deploy"); if (hasManager) parts.push("Anneal"); if (parts.length > 0) { return <span className="text-xs px-2 py-0.5 rounded-full border flex items-center gap-1 bg-purple-500/20 text-purple-400 border-purple-500/30"><Zap className="w-3 h-3" />{parts.join(" + ")}</span>; } return null; })()}
                    {(task.isRalphTask || task.status === "planning" || task.status === "pending_plan_approval" || task.status === "dispatching" || (task.childTaskIds && task.childTaskIds.length > 0) || (task.planJson?.steps && task.planJson.steps.length > 1)) && (
                      <>{task.ralphProgress && <RalphProgressCompact progress={task.ralphProgress} />}
                        {task.status === "dispatching" && <button onClick={() => handlePauseAllChildren(task.id)} disabled={actionLoading === task.id} className="text-xs px-2 py-0.5 rounded-full border border-yellow-500/50 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20 flex items-center gap-1 transition-colors" title="Pause All Child Tasks"><PauseCircle className="w-3 h-3" />Pause All</button>}</>
                    )}
                    {task.hasCheckpoint && task.status !== 'completed' && task.status !== 'failed' && <CheckpointStatusBadge checkpoint={{ hasCheckpoint: task.hasCheckpoint, checkpointStage: task.checkpointStage || null, resumeCount: task.resumeCount || 0, checkpointSavedAt: task.checkpointSavedAt || null }} />}
                    {(() => { const models = getDerivedModels(task); if (models.length === 0) return null; return <span className="text-xs px-2 py-0.5 rounded-full border border-border bg-muted text-muted-foreground flex items-center gap-1">{models.map((m, i) => <span key={`${m}-${i}`} className="flex items-center">{i > 0 && <span className="mx-0.5 text-muted-foreground/50">+</span>}<span>{m}</span></span>)}</span>; })()}
                    {task.claimedByAgent && <span className="text-xs px-2 py-0.5 rounded-full border flex items-center gap-1 bg-indigo-500/20 text-indigo-400 border-indigo-500/30" title={`Running on remote agent: ${task.claimedByAgent}`}><Wifi className="w-3 h-3" />{task.claimedByAgent}</span>}
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${getStatusColor(task.status)} bg-current/10`} data-testid="task-status">{task.status}</span>
                    {coordinationMessages.some((m: ContextMessage) => m.parentTaskId === task.id && (m.messageType === "blocker_detected" || (m.messageType === "blocker" && m.metadata?.isEscalated === true)) && m.metadata?.errorCategory === "rate_limit") && <span className="text-xs px-2 py-0.5 rounded-full border bg-amber-500/20 text-amber-500 border-amber-500/30 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Usage Limit</span>}
                    {task.estimatedCostUsd > 0 && (
                      <span className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 transition-all ${task.costCeilingPercent && task.costCeilingPercent >= 95 ? "bg-red-500/20 text-red-500 border border-red-500/50 animate-pulse" : task.costCeilingPercent && task.costCeilingPercent >= 80 ? "bg-amber-500/20 text-amber-500 border border-amber-500/50" : "bg-green-500/10 text-green-500 border border-green-500/30"}`} title={task.costCeilingPercent ? `~${task.costCeilingPercent.toFixed(0)}% of cost ceiling (estimated API token equivalent)` : "Estimated API token equivalent — not actual billing"}>
                        {task.costCeilingPercent && task.costCeilingPercent >= 80 ? <AlertTriangle className="w-3 h-3" /> : <DollarSign className="w-3 h-3" />}
                        {formatCost(task.estimatedCostUsd)}{task.costTrend === "up" && <TrendingUp className="w-3 h-3 animate-bounce" />}
                      </span>
                    )}
                  </div>
                </div>

                {/* Workflow Stage Progress */}
                <div className="flex items-center mb-4">
                  {task.steps.map((step, idx) => {
                    const StepIcon = step.icon === "queued" ? Clock : step.icon === "executing" ? Cog : step.icon === "pr_created" ? PRCreatedIcon : step.icon === "review" ? ReviewIcon : step.icon === "manager_review" ? ReviewIcon : step.icon === "approved" ? ApprovedIcon : step.icon === "deploying" ? DeployedIcon : step.icon === "deployed" ? DeployedIcon : step.icon === "complete" ? GitMerge : step.icon === "waiting" ? Pause : step.icon === "experts" ? ExpertsIcon : step.icon === "coordinating" ? ExpertsIcon : step.icon === "epic" ? Zap : step.icon === "planning" ? PlanningIcon : step.icon === "steps" ? StepsIcon : step.icon === "integration_check" ? ShieldCheck : step.icon === "tech_lead_review" ? TechLeadReviewIcon : CheckCircle;
                    const isActive = step.status === "active"; const isDone = step.status === "done"; const isWaiting = step.status === "waiting";
                    return (
                      <div key={idx} className="flex items-center flex-1">
                        <div className="flex flex-col items-center">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${isDone ? "bg-primary border-primary text-primary-foreground" : isActive ? "bg-primary/20 border-primary text-primary animate-pulse" : isWaiting ? "bg-yellow-500/20 border-yellow-500 text-yellow-500" : "bg-muted border-border text-muted-foreground"}`}>
                            {isWaiting ? <Pause className="w-5 h-5" /> : <StepIcon className={`w-5 h-5 ${isActive && step.icon === "executing" ? "animate-spin" : ""}`} style={{ animationDuration: "2s" }} />}
                          </div>
                          <span className={`text-xs mt-1 whitespace-nowrap ${isDone || isActive ? "text-foreground" : isWaiting ? "text-yellow-500" : "text-muted-foreground"}`}>{step.name}</span>
                          {step.isParallelStage && (task.storiesTotal || task.ralphProgress) && <span className="text-xs text-primary font-medium">{task.storiesTotal ? `${task.storiesCompleted || 0}/${task.storiesTotal}` : task.ralphProgress ? `${task.ralphProgress.completedStories || 0}/${task.ralphProgress.totalStories}` : ''}</span>}
                          {step.isReviewStage && <span className="text-xs text-amber-500 font-medium">{task.revisionCount ?? 0}/{task.maxReviewRevisions || 3}</span>}
                        </div>
                        {idx < task.steps.length - 1 && <div className={`flex-1 h-0.5 mx-2 ${isDone ? "bg-primary" : isWaiting ? "bg-yellow-500/50" : "bg-border"}`} />}
                      </div>
                    );
                  })}
                </div>

                {task.isRalphTask && task.ralphProgress && <RalphProgress progress={task.ralphProgress} className="mb-4" />}
                {task.hasCheckpoint && task.status !== 'completed' && task.status !== 'failed' && <CheckpointStatus checkpoint={{ hasCheckpoint: task.hasCheckpoint, checkpointStage: task.checkpointStage || null, resumeCount: task.resumeCount || 0, checkpointSavedAt: task.checkpointSavedAt || null }} className="mb-4" />}

                {/* Blocker alerts */}
                {(() => {
                  const taskMessages = coordinationMessages.filter((m: ContextMessage) => m.parentTaskId === task.id);
                  const blockerDetectedMessages = taskMessages.filter((m: ContextMessage) => m.messageType === "blocker_detected" || (m.messageType === "blocker" && m.metadata?.isEscalated === true));
                  const resolvedBlockerIds = new Set(taskMessages.filter((m: ContextMessage) => m.messageType === "blocker_resolved" || (m.messageType === "answer" && m.metadata?.blockerAction)).map((m: ContextMessage) => (m.metadata?.blockerId as string) || m.id).filter(Boolean));
                  const activeBlockers = blockerDetectedMessages.filter((m: ContextMessage) => !resolvedBlockerIds.has(m.id));
                  if (activeBlockers.length === 0) return null;
                  return <div className="mb-4 space-y-3">{activeBlockers.map((blocker: ContextMessage) => <BlockerAlert key={blocker.id} taskId={task.id} parentTaskId={task.id} blocker={{ id: blocker.id, storyIndex: (blocker.metadata?.storyIndex as number) ?? 0, storyTitle: (blocker.metadata?.storyTitle as string) ?? "Unknown Story", errorCategory: (blocker.metadata?.errorCategory as string) ?? "unknown", summary: (blocker.metadata?.summary as string) ?? blocker.content, errorMessage: (blocker.metadata?.fullErrorMessage as string) ?? blocker.content, affectedFiles: (blocker.metadata?.affectedFiles as string[]) ?? [], autoRetryAttempts: (blocker.metadata?.autoRetryAttempts as number) ?? 0, maxAutoRetries: (blocker.metadata?.maxAutoRetries as number) ?? 3, dependentStories: (blocker.metadata?.dependentStories as number[]) ?? [], createdAt: blocker.createdAt }} onResolved={() => fetchData()} />)}</div>;
                })()}

                {/* Pending plan approval (no plan yet) */}
                {task.status === "pending_plan_approval" && !task.planJson && (
                  <div className="mb-4 p-4 border border-yellow-500/30 rounded-lg bg-yellow-500/5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center"><AlertCircle className="w-4 h-4 text-yellow-500" /></div>
                        <div><h3 className="text-base font-semibold text-foreground">Plan Not Available</h3><p className="text-sm text-muted-foreground">The execution plan is not loaded. Try refreshing the page.</p></div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => window.location.reload()} className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"><RefreshCw className="w-4 h-4" />Refresh</button>
                        <button onClick={() => handleCancelTask(task.id)} disabled={actionLoading === task.id} className="flex items-center gap-2 px-4 py-2 text-red-500 hover:bg-red-500/10 rounded-lg">{actionLoading === task.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}Cancel</button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Plan Display */}
                {task.planJson && task.status === "pending_plan_approval" && (
                  <div className="mb-4 border rounded-lg border-primary/30 bg-primary/5">
                    <div className="flex items-center gap-2 p-4">
                      {isEpicTask(task) ? <Layers className="w-5 h-5 text-primary" /> : <Book className="w-5 h-5 text-primary" />}
                      <h3 className="text-lg font-semibold text-foreground">Execution Plan Ready</h3>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary">Awaiting Approval</span>
                    </div>
                    <div className="px-4 pb-4">
                      {task.planJson.stories && task.planJson.stories.length > 1 && (
                        <div className="mb-4 p-4 bg-muted/30 rounded-lg border border-border/50">
                          <div className="flex items-center gap-2 mb-3"><Network className="w-4 h-4 text-primary" /><span className="text-sm font-medium text-foreground">Execution Flow</span></div>
                          <div className="flex justify-center"><EmbeddedDependencyGraph stories={task.planJson.stories} parentTaskStatus={task.status} personaMap={personaMap} /></div>
                        </div>
                      )}
                      <div className="space-y-3 mb-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-muted-foreground text-sm">Strategy:</span>
                          <span className={`text-sm font-medium px-2 py-0.5 rounded ${task.planJson.strategy === "multi" || (task.planJson.steps && task.planJson.steps.length > 1) ? "bg-purple-500/20 text-purple-500" : "bg-blue-500/20 text-blue-500"}`}>
                            {task.planJson.strategy === "multi" ? "Multi-Story" : task.planJson.steps && task.planJson.steps.length > 1 ? `Multi-Persona (${task.planJson.steps.length} steps)` : "Single Task"}
                          </span>
                          {task.planJson.primaryPersona && <span className="text-sm text-muted-foreground">{"\u2192"} {getPersonaInfo(task.planJson.primaryPersona).emoji} {getPersonaInfo(task.planJson.primaryPersona).title}</span>}
                        </div>
                        <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded border border-border/50"><span className="font-medium text-foreground">Reasoning:</span> {task.planJson.reasoning}</div>
                        {task.planJson.stories && task.planJson.stories.length > 0 && (
                          <div className="space-y-2">
                            <span className="text-sm font-medium text-foreground">Stories ({task.planJson.stories.length}):</span>
                            <div className="space-y-1">{task.planJson.stories.map((story, idx) => (
                              <div key={idx} className="flex items-center gap-2 text-sm text-muted-foreground pl-2 border-l-2 border-border flex-wrap">
                                <span className="font-mono text-xs text-muted-foreground">{story.index}.</span>
                                <span>{getPersonaInfo(story.persona).emoji}</span><span className="text-foreground">{story.title}</span>
                                <span className={`text-xs px-1.5 py-0.5 rounded ${story.estimatedComplexity === "large" ? "bg-red-500/20 text-red-500" : story.estimatedComplexity === "medium" ? "bg-yellow-500/20 text-yellow-500" : "bg-green-500/20 text-green-500"}`}>{story.estimatedComplexity}</span>
                                {story.dependencies.length > 0 && <span className="text-xs text-muted-foreground">(needs: {story.dependencies.join(", ")})</span>}
                              </div>
                            ))}</div>
                          </div>
                        )}
                        {task.planJson.qualityGates && task.planJson.qualityGates.length > 0 && <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded border border-border/50"><span className="font-medium text-foreground">Quality Gates:</span> {task.planJson.qualityGates.join(", ")}</div>}
                      </div>
                      {task.status === "pending_plan_approval" && (
                        <>
                          {showFeedbackInput === task.id && <div className="mb-4"><textarea value={planFeedbackInput[task.id] || ""} onChange={(e) => setPlanFeedbackInput((prev) => ({ ...prev, [task.id]: e.target.value }))} placeholder="Describe what changes you'd like to the plan..." className="w-full p-3 text-sm border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary focus:border-transparent" rows={3} /></div>}
                          <div className="flex items-center gap-3">
                            <button onClick={() => handleApprovePlan(task.id)} disabled={actionLoading === task.id} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-medium">{actionLoading === task.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}Approve & Execute</button>
                            {showFeedbackInput === task.id ? (
                              <><button onClick={() => handleRequestPlanChanges(task.id)} disabled={actionLoading === task.id || !planFeedbackInput[task.id]?.trim()} className="flex items-center gap-2 px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 disabled:opacity-50 font-medium"><Send className="w-4 h-4" />Send Feedback</button><button onClick={() => setShowFeedbackInput(null)} className="px-4 py-2 text-muted-foreground hover:text-foreground">Cancel</button></>
                            ) : (
                              <button onClick={() => setShowFeedbackInput(task.id)} className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"><Sliders className="w-4 h-4" />Request Changes</button>
                            )}
                            <button onClick={() => handleCancelTask(task.id)} disabled={actionLoading === task.id} className="ml-auto flex items-center gap-2 px-4 py-2 text-red-500 hover:bg-red-500/10 rounded-lg"><Ban className="w-4 h-4" />Cancel</button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Terminal Toggle */}
                <div className="flex items-center justify-between mb-2">
                  <button onClick={() => toggleTerminal(task.id, task.status)} className="flex items-center gap-2 px-2 py-1 text-xs rounded border border-border hover:bg-muted transition-colors">
                    <Terminal className="w-3 h-3" />{isTerminalVisible ? "Hide" : "Show"} Terminal Output
                    {isTerminalVisible && <span className="flex items-center gap-1 text-green-500"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />LIVE</span>}
                  </button>
                  <div className="flex items-center gap-2">
                    {["executing", "environment_setup", "dispatching"].includes(task.status) && <button onClick={() => openTalkModal(task.id, task.jiraIssueKey || task.summary || "Task")} className="p-1.5 hover:bg-cyan-500/10 rounded text-cyan-500" title="Send message to this worker"><MessageSquare className="w-4 h-4" /></button>}
                    <button onClick={() => handleCancelTask(task.id)} disabled={actionLoading === task.id} className="p-1.5 hover:bg-red-500/10 rounded text-red-500" title="Cancel Task">{actionLoading === task.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}</button>
                  </div>
                </div>

                {/* Terminal + Side Panel */}
                {isTerminalVisible && (
                  <>
                    <div className="flex flex-wrap items-center gap-3 mb-2 text-xs text-muted-foreground">
                      <span className="font-medium">Legend:</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" /><span>Fatal Errors</span></span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400" /><span>Warnings</span></span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-400" /><span>Worker/System</span></span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400" /><span>Success</span></span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-400" /><span>Commands</span></span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300" /><span>Default</span></span>
                    </div>
                    {(() => { const providers = task.providersUsed && task.providersUsed.length > 0 ? task.providersUsed : getDerivedProviders(task); if (providers.length === 0) return null; return <div className="flex flex-wrap items-center gap-3 mb-2 text-xs text-muted-foreground"><span className="font-medium">Providers:</span>{providers.map((p) => { const { name, icon } = formatProviderName(p); return <span key={p} className="flex items-center gap-1"><span>{icon}</span><span>{name}</span></span>; })}</div>; })()}
                    <div className="mt-2 flex gap-2">
                      <div className="terminal-bg border rounded-lg overflow-hidden flex-1 min-w-0">
                        <div className="flex items-center justify-between px-3 py-1.5 terminal-header border-b">
                          <div className="flex items-center gap-2">
                            <div className="flex gap-1.5"><div className="w-3 h-3 rounded-full bg-red-500" /><div className="w-3 h-3 rounded-full bg-yellow-500" /><div className="w-3 h-3 rounded-full bg-green-500" /></div>
                            <div className="flex items-center gap-0.5 ml-1">
                              <button onClick={() => setTerminalTab((prev) => ({ ...prev, [task.id]: "terminal" }))} className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-t transition-colors ${(terminalTab[task.id] || "terminal") === "terminal" ? "bg-background border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"}`}><Terminal className="w-3 h-3" />Terminal</button>
                              <button onClick={() => setTerminalTab((prev) => ({ ...prev, [task.id]: "code" }))} className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-t transition-colors ${terminalTab[task.id] === "code" ? "bg-background border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"}`}><FileCode className="w-3 h-3" />Live Code{codeFiles[task.id] && Object.keys(codeFiles[task.id]).length > 0 && <span className="px-1 py-0.5 text-[10px] rounded-full bg-primary/20 text-primary">{Object.keys(codeFiles[task.id]).length}</span>}</button>
                            </div>
                            <span className={`text-xs font-mono ${workerOffline[task.id] ? "text-orange-400" : "text-green-400"}`}>{workerOffline[task.id] ? "[worker offline]" : "[streaming]"}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            {(terminalTab[task.id] || "terminal") === "terminal" && (
                              <><button onClick={() => setAutoScrollEnabled(!autoScrollEnabled)} className={`text-xs px-2 py-0.5 rounded ${autoScrollEnabled ? "bg-green-600 text-white" : "bg-gray-600 text-gray-300"}`} title={autoScrollEnabled ? "Auto-scroll ON - click to disable" : "Auto-scroll OFF - click to enable"}>{autoScrollEnabled ? "Auto-scroll ON" : "Auto-scroll OFF"}</button>
                              <button onClick={() => { const el = terminalRefs.current[task.id]; if (el) el.scrollTop = el.scrollHeight; }} className="text-gray-400 hover:text-white p-1" title="Scroll to bottom"><RefreshCw className="w-3 h-3" /></button></>
                            )}
                          </div>
                        </div>
                        <div ref={(el) => { terminalRefs.current[task.id] = el; }} className={`p-3 h-96 overflow-y-auto font-mono text-xs terminal-text leading-relaxed terminal-bg ${(terminalTab[task.id] || "terminal") !== "terminal" ? "hidden" : ""}`}>
                          {streamingLogs[task.id] && streamingLogs[task.id].length > 0 ? (
                            streamingLogs[task.id].map((log) => ({ ...log, message: log.message.trim().replace(/\n{2,}/g, '\n') })).filter((log) => log.message.length > 0).map((log, idx) => {
                              const msg = log.message; const isFatalError = log.metadata?.errorType === "fatal"; const isError = log.severity === "error" || log.logType === "error" || msg.includes("[ERROR]") || msg.includes("Error") || msg.includes("error:");
                              const colorClass = isError && isFatalError ? "text-red-400" : isError ? "text-orange-300/70" : log.severity === "warning" || log.logType === "warning" || msg.includes("[WARN]") || msg.includes("Warning") ? "text-yellow-400" : msg.includes("[worker]") || msg.includes("Claude") || msg.includes("Starting") ? "text-cyan-400" : msg.includes("[SUCCESS]") || msg.includes("Completed") || msg.includes("success") ? "text-green-400" : msg.startsWith("$") || msg.includes("npm ") || msg.includes("git ") ? "text-purple-400" : "text-gray-300";
                              return <div key={idx} data-log-index={idx} className={`whitespace-pre-wrap break-all ${colorClass}`}>{msg}</div>;
                            })
                          ) : <div className="text-gray-500 flex items-center gap-2"><RefreshCw className="w-3 h-3 animate-spin" />Loading logs...</div>}
                        </div>
                        {terminalTab[task.id] === "code" && <LiveCodeViewer files={codeFiles[task.id] || {}} selectedFile={selectedCodeFile[task.id] || null} onSelectFile={(filePath) => { userSelectedFileRef.current[task.id] = true; setSelectedCodeFile((prev) => ({ ...prev, [task.id]: filePath })); }} personaEmojis={personaEmojis} />}
                      </div>
                      <div className={`border rounded-lg overflow-hidden bg-card transition-all ${errorPanelExpanded[task.id] ? "w-[30%]" : "w-12"}`}>
                        {!errorPanelExpanded[task.id] ? (
                          <div className="flex flex-col items-center gap-1 w-full py-2 cursor-pointer hover:bg-muted/70 transition-colors bg-muted/50" onClick={() => { setErrorPanelExpanded(prev => ({ ...prev, [task.id]: true })); setUnreadCommsCount(prev => ({ ...prev, [task.id]: 0 })); }}>
                            <MessageSquare className={`w-4 h-4 ${unreadCommsCount[task.id] > 0 ? "text-cyan-400 animate-pulse" : "text-primary"}`} />
                            {unreadCommsCount[task.id] > 0 && <span className="text-[10px] font-bold text-cyan-400">{unreadCommsCount[task.id]}</span>}
                            <ChevronDown className="w-3 h-3 text-muted-foreground -rotate-90" />
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center border-b bg-muted/30">
                              <div className="flex-1 flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-foreground">
                                <MessageSquare className={`w-3.5 h-3.5 ${unreadCommsCount[task.id] > 0 ? "text-cyan-400 animate-pulse" : ""}`} />Comms
                                {unreadCommsCount[task.id] > 0 && <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-cyan-500/20 text-cyan-400 animate-pulse">{unreadCommsCount[task.id]}</span>}
                              </div>
                              <button onClick={() => setErrorPanelExpanded(prev => ({ ...prev, [task.id]: false }))} className="px-2 py-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors" title="Collapse panel"><ChevronDown className="w-4 h-4 rotate-90" /></button>
                            </div>
                            <EmbeddedCommunicationsFeed taskId={task.id} parentTaskId={task.parentTaskId} isTerminal={TERMINAL_STATUSES.includes(task.status)} isChildTask={!!task.parentTaskId} onAnswerQuestion={handleAnswerQuestion} />
                          </>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })
        ) : (
          <div className="p-12 text-center" data-testid="empty-state">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center"><Clock className="w-8 h-8 text-primary/50" /></div>
            <p className="text-muted-foreground font-medium">No active workflows</p>
            <p className="text-sm text-muted-foreground/60 mt-1">Workflows will appear here when workers are executing</p>
          </div>
        )}
      </div>
    </div>
  );
}

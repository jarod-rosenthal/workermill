import {
  RefreshCw,
  ExternalLink,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Activity,
  GitBranch,
  Trash2,
  Ban,
  Users,
  Eye,
  Rocket,
  Star,
  RotateCcw,
  Cog,
  FileSearch,
  ArrowRight,
} from "lucide-react";
import { buildTicketUrl, type IssueTrackerConfig } from "../../../lib/utils";
import type { CompletedTask } from "../types";
import { formatCost, formatModelName } from "../helpers";

interface AllTasksSectionProps {
  recentCompleted: CompletedTask[] | undefined;
  actionLoading: string | null;
  openActionMenu: string | null;
  setOpenActionMenu: (id: string | null) => void;
  setSelectedTask: (task: CompletedTask) => void;
  getStatusColor: (status: string) => string;
  issueTrackerConfig: IssueTrackerConfig | null | undefined;
  handleRetryTask: (taskId: string) => void;
  handleDeployTask: (taskId: string) => void;
  handleReviewTask: (taskId: string) => void;
  handleCancelTask: (taskId: string) => void;
  handleDeleteTask: (taskId: string) => void;
}

export function AllTasksSection({
  recentCompleted,
  actionLoading,
  openActionMenu,
  setOpenActionMenu,
  setSelectedTask,
  getStatusColor,
  issueTrackerConfig,
  handleRetryTask,
  handleDeployTask,
  handleReviewTask,
  handleCancelTask,
  handleDeleteTask,
}: AllTasksSectionProps) {
  return (
    <div className="card-elevated border border-border/50 rounded-xl overflow-visible">
      <div className="p-4 border-b border-border/50 bg-gradient-to-r from-muted/30 to-transparent flex items-center justify-between rounded-t-xl">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Clock className="w-5 h-5 text-muted-foreground" />
          All Tasks
        </h2>
      </div>
      <div className="overflow-x-auto overflow-y-visible rounded-b-xl min-h-[280px]">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr className="text-xs text-muted-foreground border-b border-border">
              <th className="text-left p-3">Task</th>
              <th className="text-left p-3">Summary</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Workflow</th>
              <th className="text-left p-3">Model</th>
              <th className="text-left p-3">Links</th>
              <th className="text-left p-3">Retries</th>
              <th className="text-left p-3" title="Estimated API token equivalent — actual cost depends on your auth method">Est. Cost</th>
              <th className="text-left p-3">Quality</th>
              <th className="text-left p-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {recentCompleted && recentCompleted.length > 0 ? (
              recentCompleted.map((task) => {
                const prNumber = task.githubPrUrl?.match(/\/pull(?:-requests)?\/(\d+)/)?.[1];
                return (
                  <tr
                    key={task.id}
                    className="hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => setSelectedTask(task)}
                  >
                    <td className="p-3">
                      {(() => {
                        const url = buildTicketUrl(
                          task.jiraIssueKey,
                          issueTrackerConfig ?? undefined,
                          task.cardBoardId && task.cardId ? { boardId: task.cardBoardId, cardId: task.cardId } : null,
                        );
                        const isExt = url?.startsWith("http");
                        return url ? (
                          <a
                            href={url}
                            {...(isExt ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                            className="font-medium text-primary hover:underline flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {task.jiraIssueKey}
                            {isExt && <ExternalLink className="w-3 h-3" />}
                          </a>
                        ) : (
                          <span className="font-medium">{task.jiraIssueKey}</span>
                        );
                      })()}
                    </td>
                    <td className="p-3">
                      <div className="text-sm text-foreground truncate max-w-md">
                        {task.summary}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-col gap-0.5">
                        <span className={`flex items-center gap-1 ${getStatusColor(task.status)}`}>
                          {task.status === "completed" || task.status === "deployed" ? (
                            <CheckCircle className="w-4 h-4" />
                          ) : task.status === "failed" || task.status === "review_rejected" ? (
                            <XCircle className="w-4 h-4" />
                          ) : task.status === "cancelled" ? (
                            <XCircle className="w-4 h-4" />
                          ) : task.status === "review_requested" || task.status === "pr_created" ? (
                            <GitBranch className="w-4 h-4" />
                          ) : task.status === "manager_review" ? (
                            <Users className="w-4 h-4" />
                          ) : task.status === "review_approved" || task.status === "pr_approved" ? (
                            <Star className="w-4 h-4" />
                          ) : task.status === "deploying" || task.status === "deployment_pending" ? (
                            <Rocket className="w-4 h-4 animate-pulse" />
                          ) : task.status === "executing" ? (
                            <Activity className="w-4 h-4 animate-pulse" />
                          ) : task.status === "revision_needed" ? (
                            <RefreshCw className="w-4 h-4" />
                          ) : task.status === "planning" ? (
                            <Cog className="w-4 h-4 animate-spin" />
                          ) : task.status === "pending_plan_approval" ? (
                            <Eye className="w-4 h-4" />
                          ) : task.status === "escalated" ? (
                            <AlertCircle className="w-4 h-4" />
                          ) : ["queued", "claimed", "environment_setup"].includes(task.status) ? (
                            <Clock className="w-4 h-4 animate-pulse" />
                          ) : (
                            <Clock className="w-4 h-4" />
                          )}
                          {task.status === "planning" ? "Planning" :
                           task.status === "pending_plan_approval" ? "Awaiting Approval" :
                           task.status === "environment_setup" ? "Setting Up" :
                           task.status === "review_requested" ? "Review Requested" :
                           task.status === "pr_created" ? "PR Created" :
                           task.status === "manager_review" ? "Manager Review" :
                           task.status === "review_approved" ? "Approved" :
                           task.status === "pr_approved" ? "PR Approved" :
                           task.status === "review_rejected" ? "Rejected" :
                           task.status === "revision_needed" ? "Revision Needed" :
                           task.status === "deployment_pending" ? "Deployment Pending" :
                           task.status === "escalated" ? "Escalated" :
                           task.status.replace(/_/g, " ").charAt(0).toUpperCase() + task.status.replace(/_/g, " ").slice(1)}
                        </span>
                        {["pr_created", "review_requested", "pr_approved", "reviewing", "consolidating", "deployed", "completed", "revision_needed"].includes(task.status) && (
                          <span className="text-xs text-amber-500">
                            Rev {task.revisionCount ?? 0}/{task.maxReviewRevisions || 3}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      {(() => {
                        const isLocal = !!task.claimedByAgent;
                        const isReview = task.skipManagerReview === false;
                        const isDeploy = !!task.deploymentEnabled;
                        const hasManager = !!task.managerEnabled;

                        const parts: string[] = [];
                        if (isLocal) parts.push("Local");
                        if (isReview) parts.push("PR-Review");
                        if (isDeploy) parts.push("Deploy");
                        if (hasManager) parts.push("Anneal");

                        if (parts.length > 0) {
                          return (
                            <span className="text-xs px-2 py-0.5 rounded-full border flex items-center gap-1 w-fit bg-muted/50 text-muted-foreground border-border">
                              {parts.join(" + ")}
                            </span>
                          );
                        }
                        return <span className="text-xs text-muted-foreground">{"\u2014"}</span>;
                      })()}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-col gap-0.5">
                      <span className={`text-sm flex items-center gap-1.5 ${
                        task.workerModel?.includes("opus") ? "text-purple-400" :
                        task.workerModel?.includes("sonnet") ? "text-cyan-400" :
                        "text-green-400"
                      }`}>
                        {formatModelName(task.workerModel)}
                      </span>
                      </div>
                    </td>
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2 text-sm">
                        {task.githubPrUrl && prNumber && (
                          <a
                            href={task.githubPrUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-purple-400 hover:underline"
                          >
                            <GitBranch className="w-3 h-3" />
                            PR#{prNumber}
                          </a>
                        )}
                        {!task.githubPrUrl && task.githubBranch && (
                          <span className="flex items-center gap-1 text-cyan-400 text-xs">
                            <GitBranch className="w-3 h-3" />
                            {task.githubBranch.length > 30 ? task.githubBranch.slice(0, 30) + '...' : task.githubBranch}
                          </span>
                        )}
                        {!task.githubPrUrl && !task.githubBranch && (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-sm text-muted-foreground">
                      {task.retryCount ?? 0}/3
                    </td>
                    <td className="p-3 text-sm font-medium" title="Estimated API token equivalent">
                      {`~$${formatCost(task.costUsd)}`}
                    </td>
                    <td className="p-3 text-sm">
                      {task.qualityScore != null ? (
                        <span className={`font-medium ${
                          task.qualityScore >= 90 ? 'text-emerald-500' :
                          task.qualityScore >= 70 ? 'text-yellow-500' :
                          task.qualityScore >= 50 ? 'text-orange-500' :
                          'text-red-500'
                        }`}>
                          {task.qualityScore}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <div className="relative">
                          <button
                            onClick={() => setOpenActionMenu(openActionMenu === task.id ? null : task.id)}
                            className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
                            title="Actions"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {openActionMenu === task.id && (
                            <div className="absolute right-0 top-full mt-1 z-50 bg-background border border-border rounded-lg shadow-lg py-1 min-w-[140px]">
                              <button
                                onClick={() => {
                                  setSelectedTask(task);
                                  setOpenActionMenu(null);
                                }}
                                className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2"
                              >
                                <Eye className="w-4 h-4" />
                                Details
                              </button>
                              {["failed", "escalated", "cancelled"].includes(task.status) && (
                                <button
                                  onClick={() => {
                                    handleRetryTask(task.id);
                                    setOpenActionMenu(null);
                                  }}
                                  disabled={actionLoading === task.id}
                                  className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2 text-blue-400"
                                >
                                  {actionLoading === task.id ? (
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <RotateCcw className="w-4 h-4" />
                                  )}
                                  Retry
                                </button>
                              )}
                              {task.githubPrUrl &&
                                ["failed", "completed", "review_requested", "pr_approved", "escalated", "cancelled"].includes(task.status) && (
                                  <button
                                    onClick={() => {
                                      handleDeployTask(task.id);
                                      setOpenActionMenu(null);
                                    }}
                                    disabled={actionLoading === task.id}
                                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2 text-green-400"
                                  >
                                    {actionLoading === task.id ? (
                                      <RefreshCw className="w-4 h-4 animate-spin" />
                                    ) : (
                                      <Rocket className="w-4 h-4" />
                                    )}
                                    Deploy
                                  </button>
                                )}
                              {task.githubPrUrl &&
                                ["failed", "completed", "review_requested", "pr_approved", "deployed", "escalated", "cancelled"].includes(task.status) && (
                                  <button
                                    onClick={() => {
                                      handleReviewTask(task.id);
                                      setOpenActionMenu(null);
                                    }}
                                    disabled={actionLoading === task.id}
                                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2 text-violet-400"
                                  >
                                    {actionLoading === task.id ? (
                                      <RefreshCw className="w-4 h-4 animate-spin" />
                                    ) : (
                                      <FileSearch className="w-4 h-4" />
                                    )}
                                    Review
                                  </button>
                                )}
                              <div className="border-t border-border my-1" />
                              {["queued", "claimed", "executing", "environment_setup", "planning", "pending_plan_approval", "dispatching"].includes(task.status) ? (
                                <button
                                  onClick={() => {
                                    handleCancelTask(task.id);
                                    setOpenActionMenu(null);
                                  }}
                                  disabled={actionLoading === task.id}
                                  className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2 text-red-500"
                                >
                                  {actionLoading === task.id ? (
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Ban className="w-4 h-4" />
                                  )}
                                  Cancel
                                </button>
                              ) : (
                                <button
                                  onClick={() => {
                                    handleDeleteTask(task.id);
                                    setOpenActionMenu(null);
                                  }}
                                  disabled={actionLoading === task.id}
                                  className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2 text-red-500"
                                >
                                  {actionLoading === task.id ? (
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-4 h-4" />
                                  )}
                                  Delete
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={11} className="p-12 text-center">
                  <div className="max-w-md mx-auto">
                    <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                      <Rocket className="w-7 h-7 text-primary/60" />
                    </div>
                    <p className="text-foreground font-medium mb-1">No tasks yet</p>
                    <p className="text-sm text-muted-foreground mb-4">
                      Run your first AI task from a board card, or create one directly with the <strong>Run Task</strong> button above.
                    </p>
                    <div className="flex items-center justify-center gap-3">
                      <a
                        href="/boards"
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                      >
                        Go to Boards <ArrowRight className="w-3.5 h-3.5" />
                      </a>
                      <span className="text-muted-foreground/40">|</span>
                      <a
                        href="/docs/quick-start"
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Quick Start Guide <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

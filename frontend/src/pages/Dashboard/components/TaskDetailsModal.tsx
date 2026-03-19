import {
  ExternalLink,
  AlertCircle,
  Terminal,
  GitBranch,
  RotateCcw,
  X,
} from "lucide-react";
import type { PlanningProgressData } from "../../../components/PlanningProgress";
import { PlanningTerminalBar } from "../../../components/PlanningProgress";
import { TerminalLogViewer } from "../../../components/TerminalLogViewer";
import { TokenBreakdown } from "../../../components/TokenBreakdown";
import { buildTicketUrl, type IssueTrackerConfig } from "../../../lib/utils";
import type { CompletedTask } from "../types";
import { formatCost } from "../helpers";

interface TaskDetailsModalProps {
  selectedTask: CompletedTask;
  taskModalTab: "details" | "logs";
  setTaskModalTab: (tab: "details" | "logs") => void;
  planningProgress: Record<string, PlanningProgressData>;
  getStatusColor: (status: string) => string;
  issueTrackerConfig: IssueTrackerConfig | null | undefined;
  handleRetryTask: (taskId: string) => void;
  onClose: () => void;
}

export function TaskDetailsModal({
  selectedTask,
  taskModalTab,
  setTaskModalTab,
  planningProgress,
  getStatusColor,
  issueTrackerConfig,
  handleRetryTask,
  onClose,
}: TaskDetailsModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-xl w-full max-w-5xl mx-4 shadow-2xl max-h-[90vh] flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            {(() => {
              const url = buildTicketUrl(
                selectedTask.jiraIssueKey,
                issueTrackerConfig ?? undefined,
                selectedTask.cardBoardId && selectedTask.cardId ? { boardId: selectedTask.cardBoardId, cardId: selectedTask.cardId } : null,
              );
              const isExt = url?.startsWith("http");
              return url ? (
                <a
                  href={url}
                  {...(isExt ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  className="text-primary hover:underline font-semibold flex items-center gap-1"
                >
                  {selectedTask.jiraIssueKey}
                  {isExt && <ExternalLink className="w-3 h-3" />}
                </a>
              ) : (
                <span className="font-semibold">{selectedTask.jiraIssueKey}</span>
              );
            })()}
            <span className={`text-sm ${getStatusColor(selectedTask.status)}`}>
              {selectedTask.status}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-muted rounded transition-colors"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border shrink-0">
          <button
            onClick={() => setTaskModalTab("details")}
            className={`px-4 py-2.5 text-sm font-medium transition-colors ${
              taskModalTab === "details"
                ? "text-primary border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Details
          </button>
          <button
            onClick={() => setTaskModalTab("logs")}
            className={`px-4 py-2.5 text-sm font-medium transition-colors flex items-center gap-2 ${
              taskModalTab === "logs"
                ? "text-primary border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Terminal className="w-4 h-4" />
            Logs
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-auto">
          {taskModalTab === "details" ? (
            <div className="p-4 space-y-4">
              <p className="text-foreground">{selectedTask.summary}</p>

              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">Retries</div>
                  <div className="font-semibold">{selectedTask.retryCount ?? 0}/3</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Cost</div>
                  <div className="font-semibold">${formatCost(selectedTask.costUsd)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Duration</div>
                  <div className="font-semibold">
                    {(() => {
                      if (selectedTask.durationMinutes) return `${selectedTask.durationMinutes}m`;
                      if (selectedTask.startedAt && selectedTask.completedAt) {
                        const mins = Math.round((new Date(selectedTask.completedAt).getTime() - new Date(selectedTask.startedAt).getTime()) / 60000);
                        if (mins < 60) return `${mins}m`;
                        return `${Math.floor(mins / 60)}h ${mins % 60}m`;
                      }
                      if (selectedTask.startedAt && !selectedTask.completedAt) {
                        const mins = Math.round((Date.now() - new Date(selectedTask.startedAt).getTime()) / 60000);
                        return `${mins}m (running)`;
                      }
                      return "N/A";
                    })()}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Created</div>
                  <div className="font-semibold text-xs">{new Date(selectedTask.createdAt).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Completed</div>
                  <div className="font-semibold text-xs">{selectedTask.completedAt ? new Date(selectedTask.completedAt).toLocaleString() : "Running"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Last Heartbeat</div>
                  <div className="font-semibold text-xs">{selectedTask.lastHeartbeatAt ? new Date(selectedTask.lastHeartbeatAt).toLocaleString() : "Never"}</div>
                </div>
              </div>

              <div className="border-t border-border pt-4">
                <TokenBreakdown taskId={selectedTask.id} />
              </div>

              {selectedTask.status === "failed" && selectedTask.errorMessage && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-red-500 mb-1">
                    <AlertCircle className="w-4 h-4" />
                    <span className="font-semibold">Error</span>
                  </div>
                  <p className="text-red-400 text-sm font-mono">
                    {selectedTask.errorMessage || "Essential container in task exited"}
                  </p>
                </div>
              )}

              {selectedTask.githubPrUrl && (
                <div className="flex items-center gap-4">
                  <a
                    href={selectedTask.githubPrUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-sm text-purple-400 hover:underline"
                  >
                    <GitBranch className="w-4 h-4" />
                    View PR
                  </a>
                </div>
              )}
            </div>
          ) : (
            <div className="p-4">
              <TerminalLogViewer taskId={selectedTask.id} height="500px" />
              {selectedTask.status === "planning" && planningProgress[selectedTask.id] && (
                <PlanningTerminalBar progress={planningProgress[selectedTask.id]} />
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-border shrink-0">
          {["failed", "escalated", "cancelled"].includes(selectedTask.status) && (
            <button
              onClick={() => {
                handleRetryTask(selectedTask.id);
                onClose();
              }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Retry
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

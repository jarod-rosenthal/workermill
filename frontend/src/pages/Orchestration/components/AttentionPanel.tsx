import { useState, useMemo } from "react";
import {
  AlertTriangle,
  XCircle,
  Clock,
  CheckCircle,
  ChevronRight,
  ChevronLeft,
  DollarSign,
  Zap,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import type { ChildTask, WorkflowStats, ParentTask } from "../orchestration-store";
import { PERSONA_CONFIGS } from "../../../types/mission-control";

interface AttentionPanelProps {
  parentTask: ParentTask | null;
  stories: ChildTask[];
  stats: WorkflowStats;
  onSelectStory: (storyId: string) => void;
  onRetryStory?: (storyId: string) => void;
}

interface AttentionItem {
  id: string;
  type: "blocked" | "failed" | "pending_approval";
  story: ChildTask;
  message: string;
  timestamp: string;
}

/**
 * AttentionPanel - Left sidebar showing items needing attention
 * Implements attention-first architecture from UX plan
 */
export function AttentionPanel({
  parentTask,
  stories,
  stats,
  onSelectStory,
  onRetryStory,
}: AttentionPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Build attention items list
  const attentionItems = useMemo((): AttentionItem[] => {
    const items: AttentionItem[] = [];

    stories.forEach((story) => {
      if (story.status === "blocked") {
        items.push({
          id: story.id,
          type: "blocked",
          story,
          message: story.blockedReason || "Blocked by dependency",
          timestamp: story.startedAt || story.createdAt,
        });
      } else if (story.status === "failed" || story.status === "cancelled") {
        items.push({
          id: story.id,
          type: "failed",
          story,
          message: "Task failed - click to view logs",
          timestamp: story.completedAt || story.startedAt || story.createdAt,
        });
      }
    });

    // Sort by timestamp descending (most recent first)
    items.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return items;
  }, [stories]);

  // Format relative time
  const formatRelativeTime = (timestamp: string): string => {
    const diff = Date.now() - new Date(timestamp).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return "just now";
  };

  // Format cost
  const formatCost = (cost: number | string | null | undefined): string => {
    if (cost == null) return "$0.00";
    const numCost = typeof cost === "number" ? cost : parseFloat(String(cost));
    if (isNaN(numCost) || numCost === 0) return "$0.00";
    if (numCost < 0.01) return "<$0.01";
    return `$${numCost.toFixed(2)}`;
  };

  if (isCollapsed) {
    return (
      <div className="mc-attention-panel collapsed">
        <button
          onClick={() => setIsCollapsed(false)}
          className="mc-attention-panel-expand"
          title="Expand Panel"
        >
          <ChevronRight className="w-4 h-4" />
          {attentionItems.length > 0 && (
            <span className="mc-attention-panel-badge">
              {attentionItems.length}
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="mc-attention-panel">
      {/* Panel Header */}
      <div className="mc-attention-panel-header">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-[var(--mc-status-warning)]" />
          <span className="mc-attention-panel-title">Attention</span>
          {attentionItems.length > 0 && (
            <span className="mc-attention-panel-count">{attentionItems.length}</span>
          )}
        </div>
        <button
          onClick={() => setIsCollapsed(true)}
          className="mc-btn mc-btn-ghost"
          title="Collapse Panel"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {/* Attention Items */}
      <div className="mc-attention-panel-items">
        {attentionItems.length === 0 ? (
          <div className="mc-attention-panel-empty">
            <CheckCircle className="w-5 h-5 text-[var(--mc-status-live)]" />
            <span>All clear!</span>
          </div>
        ) : (
          attentionItems.map((item) => {
            const persona = PERSONA_CONFIGS[item.story.workerPersona];
            return (
              <button
                key={item.id}
                onClick={() => onSelectStory(item.id)}
                className={`mc-attention-item ${item.type}`}
              >
                <div className="mc-attention-item-header">
                  <span className="mc-attention-item-type">
                    {item.type === "blocked" ? (
                      <>
                        <Clock className="w-3 h-3" /> Blocked
                      </>
                    ) : item.type === "failed" ? (
                      <>
                        <XCircle className="w-3 h-3" /> Failed
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-3 h-3" /> Pending
                      </>
                    )}
                  </span>
                  <span className="mc-attention-item-time">
                    {formatRelativeTime(item.timestamp)}
                  </span>
                </div>
                <div className="mc-attention-item-story">
                  <span className="mc-attention-item-index">
                    Story {item.story.storyIndex}
                  </span>
                  <span className="mc-attention-item-persona">
                    {persona?.emoji}
                  </span>
                </div>
                <div className="mc-attention-item-message">{item.message}</div>
                {item.type === "failed" && onRetryStory && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRetryStory(item.id);
                    }}
                    className="mc-attention-item-action"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Retry
                  </button>
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Divider */}
      <div className="mc-attention-panel-divider" />

      {/* Quick Stats */}
      <div className="mc-attention-panel-stats">
        <div className="mc-attention-panel-stats-title">Quick Stats</div>

        <div className="mc-attention-stat">
          <div className="mc-attention-stat-row">
            <span className="mc-attention-stat-label">
              <Clock className="w-3 h-3" /> Queued
            </span>
            <span className="mc-attention-stat-value">{stats.queued}</span>
          </div>
        </div>

        <div className="mc-attention-stat">
          <div className="mc-attention-stat-row">
            <span className="mc-attention-stat-label">
              <Zap className="w-3 h-3" /> Running
            </span>
            <span className="mc-attention-stat-value active">{stats.running}</span>
          </div>
        </div>

        <div className="mc-attention-stat">
          <div className="mc-attention-stat-row">
            <span className="mc-attention-stat-label">
              <CheckCircle className="w-3 h-3" /> Completed
            </span>
            <span className="mc-attention-stat-value live">{stats.completed}</span>
          </div>
        </div>

        <div className="mc-attention-stat">
          <div className="mc-attention-stat-row">
            <span className="mc-attention-stat-label">
              <DollarSign className="w-3 h-3" /> Cost
            </span>
            <span className="mc-attention-stat-value">
              {formatCost(stats.totalCostUsd)}
            </span>
          </div>
        </div>
      </div>

      {/* Parent Task Info */}
      {parentTask && (
        <>
          <div className="mc-attention-panel-divider" />
          <div className="mc-attention-panel-parent">
            <div className="mc-attention-panel-stats-title">Parent Task</div>
            <a
              href={`https://oncallshift.atlassian.net/browse/${parentTask.jiraIssueKey}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mc-attention-parent-link"
            >
              {parentTask.jiraIssueKey}
              <ExternalLink className="w-3 h-3" />
            </a>
            <div className="mc-attention-parent-summary">
              {parentTask.summary}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

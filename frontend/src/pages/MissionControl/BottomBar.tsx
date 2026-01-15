import { RefreshCw, Pause, RotateCcw, CheckCircle, XCircle, Clock, ArrowRight } from "lucide-react";
import type { ControlCenterStats, ActiveTask, CompletedTask } from "./index";

interface BottomBarProps {
  recentCompleted: CompletedTask[];
  activeTasks: ActiveTask[];
  stats?: ControlCenterStats;
  onRefresh: () => void;
}

export function BottomBar({ recentCompleted, activeTasks, stats: _stats, onRefresh }: BottomBarProps) {
  // Generate live feed items from completed tasks
  const feedItems = recentCompleted.slice(0, 6).map((task) => ({
    id: task.id,
    time: new Date(task.completedAt).toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    type: task.status === "completed" ? "success" : "error",
    message: `${task.jiraIssueKey} ${task.status === "completed" ? "completed" : "failed"}`,
    cost: task.costUsd,
  }));

  // Calculate pipeline stages
  const buildingCount = activeTasks.filter((t) => t.status === "executing").length;
  const reviewCount = activeTasks.filter((t) => t.status === "awaiting_review" || t.status === "under_review").length;
  const deployingCount = activeTasks.filter((t) => t.status === "deploying").length;

  // Generate velocity data (mock for now - would come from analytics API)
  const velocityData = [3, 5, 4, 7, 6, 8, 5];
  const maxVelocity = Math.max(...velocityData);
  const totalTasks = velocityData.reduce((a, b) => a + b, 0);

  return (
    <footer className="bottom-bar">
      {/* Live Feed */}
      <div className="bottom-bar-section live-feed">
        <span className="bottom-bar-section-title">Live Feed</span>
        <div className="live-feed-items">
          {feedItems.length === 0 ? (
            <div className="live-feed-item">
              <Clock className="w-3 h-3 live-feed-icon info" />
              <span className="live-feed-message">No recent activity</span>
            </div>
          ) : (
            feedItems.map((item) => (
              <div key={item.id} className="live-feed-item">
                <span className="live-feed-time">{item.time}</span>
                {item.type === "success" ? (
                  <CheckCircle className="w-3 h-3 live-feed-icon success" />
                ) : (
                  <XCircle className="w-3 h-3 live-feed-icon error" />
                )}
                <span className="live-feed-message">{item.message}</span>
                <span className="live-feed-cost">${item.cost?.toFixed(2) || "0.00"}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Pipeline Status */}
      <div className="bottom-bar-section">
        <span className="bottom-bar-section-title">Pipeline</span>
        <div className="mini-pipeline">
          <div className={`mini-pipeline-stage ${buildingCount > 0 ? "active" : "complete"}`}>
            <span>Build</span>
            {buildingCount > 0 && <span>({buildingCount})</span>}
          </div>
          <ArrowRight className="w-3 h-3 mini-pipeline-arrow" />
          <div className={`mini-pipeline-stage ${reviewCount > 0 ? "active" : ""}`}>
            <span>Review</span>
            {reviewCount > 0 && <span>({reviewCount})</span>}
          </div>
          <ArrowRight className="w-3 h-3 mini-pipeline-arrow" />
          <div className={`mini-pipeline-stage ${deployingCount > 0 ? "active" : ""}`}>
            <span>Deploy</span>
            {deployingCount > 0 && <span>({deployingCount})</span>}
          </div>
        </div>
        <span className="mini-pipeline-count">
          {reviewCount} awaiting review
        </span>
      </div>

      {/* Velocity Chart */}
      <div className="bottom-bar-section velocity-section">
        <span className="bottom-bar-section-title">Velocity (7d)</span>
        <div className="velocity-chart">
          {velocityData.map((value, i) => (
            <div
              key={i}
              className="velocity-bar"
              style={{ height: `${(value / maxVelocity) * 100}%` }}
              title={`${value} tasks`}
            />
          ))}
        </div>
        <span className="velocity-label">
          <span>{totalTasks}</span> tasks this week
        </span>
      </div>

      {/* Action Bar */}
      <div className="bottom-bar-section action-bar">
        <span className="bottom-bar-section-title">Actions</span>
        <div className="action-bar-buttons">
          <button className="action-bar-btn" onClick={onRefresh}>
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
          <button className="action-bar-btn">
            <Pause className="w-3 h-3" />
            Pause All
          </button>
          <button className="action-bar-btn">
            <RotateCcw className="w-3 h-3" />
            Retry Failed
          </button>
        </div>
      </div>
    </footer>
  );
}

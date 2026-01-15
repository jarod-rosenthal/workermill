import { ChevronLeft, ChevronRight, AlertTriangle, AlertCircle, X, CheckCircle } from "lucide-react";
import type { ControlCenterStats, Alert, Achievement } from "./index";

interface RightRailProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  stats?: ControlCenterStats;
  alerts: Alert[];
  onDismissAlert: (alertId: string) => void;
  achievements: Achievement[];
  unlockedAchievements: string[];
  dailyStats: {
    date: string;
    completed: number;
    failed: number;
    cost: number;
    streak: number;
  };
}

export function RightRail({
  collapsed,
  onToggleCollapse,
  stats,
  alerts,
  onDismissAlert,
  achievements,
  unlockedAchievements,
  dailyStats,
}: RightRailProps) {
  const periodCost = stats?.periodCost || 0;
  const cumulativeCost = stats?.cumulativeCost || 0;

  // Calculate budget percentage (example: $100 daily budget)
  const dailyBudget = 100;
  const budgetUsed = (periodCost / dailyBudget) * 100;
  const budgetClass = budgetUsed > 90 ? "danger" : budgetUsed > 70 ? "warning" : "";

  // Calculate ROI (example: $60/hr developer rate, 8hr saved per $1 of AI cost)
  const hourlyRate = 60;
  const hoursPerDollar = 0.5; // Conservative estimate
  const savedAmount = cumulativeCost * hoursPerDollar * hourlyRate;
  const roiPercent = cumulativeCost > 0 ? Math.round((savedAmount / cumulativeCost - 1) * 100) : 0;

  const activeAlerts = alerts.filter((a) => !a.dismissed);

  return (
    <aside className={`right-rail ${collapsed ? "collapsed" : ""}`}>
      <div className="right-rail-header">
        <span className="right-rail-title">Metrics</span>
        <button className="right-rail-toggle" onClick={onToggleCollapse}>
          {collapsed ? (
            <ChevronLeft className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </button>
      </div>

      <div className="right-rail-content">
        {/* Cost Tracker */}
        <div className="mc-panel">
          <div className="mc-panel-header">
            <span className="mc-panel-title">Cost Tracker</span>
          </div>
          <div className="mc-panel-content">
            <div className="cost-tracker">
              <div className="cost-tracker-main">
                <span className="cost-tracker-amount">${periodCost.toFixed(2)}</span>
                <span className={`cost-tracker-trend ${periodCost < 50 ? "down" : "up"}`}>
                  {periodCost < 50 ? "↓" : "↑"} Today
                </span>
              </div>

              <div className="cost-tracker-budget">
                <div className="cost-tracker-budget-bar">
                  <div
                    className={`cost-tracker-budget-fill ${budgetClass}`}
                    style={{ width: `${Math.min(budgetUsed, 100)}%` }}
                  />
                </div>
                <span className="cost-tracker-budget-label">
                  Budget: {budgetUsed.toFixed(0)}% of ${dailyBudget}
                </span>
              </div>

              <div className="cost-tracker-roi">
                <span className="cost-tracker-roi-label">Estimated ROI</span>
                <span className="cost-tracker-roi-value">
                  {roiPercent > 0 ? `${roiPercent}%` : "N/A"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Alert Center */}
        <div className="mc-panel">
          <div className="mc-panel-header">
            <span className="mc-panel-title">
              Alerts ({activeAlerts.length})
            </span>
          </div>
          <div className="mc-panel-content">
            <div className="alert-center">
              {activeAlerts.length === 0 ? (
                <div className="alert-empty">
                  <CheckCircle className="w-4 h-4 alert-empty-icon" />
                  <span>No active alerts</span>
                </div>
              ) : (
                activeAlerts.slice(0, 5).map((alert) => (
                  <div key={alert.id} className={`alert-item ${alert.type}`}>
                    {alert.type === "error" ? (
                      <AlertCircle className="alert-icon" />
                    ) : (
                      <AlertTriangle className="alert-icon" />
                    )}
                    <div className="alert-content">
                      <div className="alert-title">{alert.title}</div>
                      <div className="alert-message">{alert.message}</div>
                    </div>
                    <button
                      className="alert-dismiss"
                      onClick={() => onDismissAlert(alert.id)}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Achievement Panel */}
        <div className="mc-panel">
          <div className="mc-panel-header">
            <span className="mc-panel-title">Today's Stats</span>
          </div>
          <div className="mc-panel-content">
            <div className="achievement-panel">
              <div className="achievement-stats">
                <div className="achievement-stat">
                  <span className="achievement-stat-value">
                    {stats?.periodCompleted || dailyStats.completed}
                  </span>
                  <span className="achievement-stat-label">Completed</span>
                </div>
                <div className="achievement-stat">
                  <span className="achievement-stat-value">
                    {stats?.periodFailed || dailyStats.failed}
                  </span>
                  <span className="achievement-stat-label">Failed</span>
                </div>
                <div className="achievement-stat">
                  <span className="achievement-stat-value">${periodCost.toFixed(0)}</span>
                  <span className="achievement-stat-label">Spent</span>
                </div>
                <div className="achievement-stat">
                  <span className="achievement-stat-value">{dailyStats.streak}</span>
                  <span className="achievement-stat-label">Streak</span>
                </div>
              </div>

              <div className="achievement-badges">
                {achievements.map((achievement) => (
                  <div
                    key={achievement.id}
                    className={`achievement-badge ${
                      unlockedAchievements.includes(achievement.id) ? "unlocked" : ""
                    }`}
                    title={`${achievement.title}: ${achievement.description}`}
                  >
                    {achievement.icon}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

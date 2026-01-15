import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ControlCenterStats, ActiveTask } from "./index";

interface LeftRailProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  systemEnabled: boolean;
  orchestratorRunning: boolean;
  watcherEnabled: boolean;
  managerEnabled: boolean;
  managerModel: string;
  onToggleSystem: () => void;
  onToggleOrchestrator: () => void;
  workers: any[];
  queuedTasks: ActiveTask[];
  stats?: ControlCenterStats;
}

export function LeftRail({
  collapsed,
  onToggleCollapse,
  systemEnabled,
  orchestratorRunning,
  watcherEnabled,
  managerEnabled,
  onToggleSystem,
  onToggleOrchestrator,
  workers: _workers,
  queuedTasks,
  stats,
}: LeftRailProps) {
  const activeWorkerCount = stats?.activeWorkers || 0;
  const totalWorkerCapacity = stats?.totalWorkers || 5;
  const workerPercentage = (activeWorkerCount / totalWorkerCapacity) * 100;

  // Generate radar dot positions for queued tasks
  const getRadarDotPositions = (count: number) => {
    const positions: { x: number; y: number }[] = [];
    const radius = 28;
    const centerOffset = 40;

    for (let i = 0; i < Math.min(count, 8); i++) {
      const angle = (i / Math.min(count, 8)) * 2 * Math.PI - Math.PI / 2;
      positions.push({
        x: centerOffset + radius * Math.cos(angle),
        y: centerOffset + radius * Math.sin(angle),
      });
    }
    return positions;
  };

  const radarDots = getRadarDotPositions(queuedTasks.length);

  return (
    <aside className={`left-rail ${collapsed ? "collapsed" : ""}`}>
      <div className="left-rail-header">
        <span className="left-rail-title">System</span>
        <button className="left-rail-toggle" onClick={onToggleCollapse}>
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </button>
      </div>

      <div className="left-rail-content">
        {/* System Status Panel */}
        <div className="mc-panel">
          <div className="mc-panel-header">
            <span className="mc-panel-title">Status</span>
          </div>
          <div className="mc-panel-content">
            <div className="system-status-item">
              <div className="system-status-label">
                <span
                  className={`system-status-indicator ${orchestratorRunning ? "on" : "off"}`}
                />
                <span>Orchestrator</span>
              </div>
              {!collapsed && (
                <button className="system-status-toggle" onClick={onToggleOrchestrator}>
                  {orchestratorRunning ? "Stop" : "Start"}
                </button>
              )}
            </div>

            <div className="system-status-item">
              <div className="system-status-label">
                <span className={`system-status-indicator ${watcherEnabled ? "on" : "off"}`} />
                <span>Watcher</span>
              </div>
            </div>

            <div className="system-status-item">
              <div className="system-status-label">
                <span className={`system-status-indicator ${managerEnabled ? "on" : "off"}`} />
                <span>Manager</span>
              </div>
            </div>

            <div className="system-status-item">
              <div className="system-status-label">
                <span className={`system-status-indicator ${systemEnabled ? "on" : "off"}`} />
                <span>System</span>
              </div>
              {!collapsed && (
                <button className="system-status-toggle" onClick={onToggleSystem}>
                  {systemEnabled ? "Disable" : "Enable"}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Worker Fleet Panel */}
        <div className="mc-panel">
          <div className="mc-panel-header">
            <span className="mc-panel-title">Workers</span>
          </div>
          <div className="mc-panel-content">
            <div className="worker-fleet">
              <div className="worker-fleet-bar">
                <div
                  className="worker-fleet-fill"
                  style={{ width: `${workerPercentage}%` }}
                />
              </div>
              {!collapsed && (
                <div className="worker-fleet-label">
                  <span>{activeWorkerCount}</span>/{totalWorkerCapacity} Active
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Queue Radar */}
        <div className="mc-panel">
          <div className="mc-panel-header">
            <span className="mc-panel-title">Queue</span>
          </div>
          <div className="mc-panel-content">
            <div className="queue-radar">
              <div className="queue-radar-visual">
                {radarDots.map((pos, i) => (
                  <div
                    key={i}
                    className="queue-radar-dot"
                    style={{
                      left: `${pos.x}px`,
                      top: `${pos.y}px`,
                      animationDelay: `${i * 0.2}s`,
                    }}
                  />
                ))}
                <span className="queue-radar-count">{queuedTasks.length}</span>
              </div>
              {!collapsed && <span className="queue-radar-label">in queue</span>}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Volume2, VolumeX, Settings, BarChart3, ArrowLeft } from "lucide-react";
import type { ControlCenterStats } from "./index";

interface TopBarProps {
  systemStatus: "nominal" | "attention" | "critical";
  sseConnected: boolean;
  lastUpdated: Date | null;
  stats?: ControlCenterStats;
  soundEnabled: boolean;
  onToggleSound: () => void;
}

export function TopBar({
  systemStatus,
  sseConnected,
  lastUpdated: _lastUpdated,
  stats,
  soundEnabled,
  onToggleSound,
}: TopBarProps) {
  const [currentTime, setCurrentTime] = useState(new Date());

  // Update clock every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatUTCTime = (date: Date) => {
    return date.toISOString().substring(11, 19);
  };

  const getStatusConfig = () => {
    switch (systemStatus) {
      case "nominal":
        return {
          label: "ALL SYSTEMS NOMINAL",
          className: "status-nominal",
          dotColor: "bg-mc-success",
        };
      case "attention":
        return {
          label: "ATTENTION REQUIRED",
          className: "status-attention",
          dotColor: "bg-mc-warning",
        };
      case "critical":
        return {
          label: "CRITICAL ALERT",
          className: "status-critical",
          dotColor: "bg-mc-error",
        };
    }
  };

  const statusConfig = getStatusConfig();

  return (
    <header className="topbar">
      {/* Left section - Logo and back link */}
      <div className="topbar-left">
        <Link to="/dashboard" className="topbar-back" title="Back to Dashboard">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="topbar-logo">
          <span className="topbar-logo-icon">⚡</span>
          <span className="topbar-logo-text">WORKERMILL MISSION CONTROL</span>
        </div>
      </div>

      {/* Center section - System status */}
      <div className="topbar-center">
        <div className={`topbar-status ${statusConfig.className}`}>
          <span className={`topbar-status-dot ${statusConfig.dotColor}`} />
          <span className="topbar-status-label">{statusConfig.label}</span>
        </div>
      </div>

      {/* Right section - Quick metrics, time, actions */}
      <div className="topbar-right">
        {/* Quick metrics */}
        <div className="topbar-metrics">
          <div className="topbar-metric">
            <span className="topbar-metric-value">{stats?.activeWorkers || 0}</span>
            <span className="topbar-metric-label">Active</span>
          </div>
          <div className="topbar-metric-divider" />
          <div className="topbar-metric">
            <span className="topbar-metric-value">{stats?.queueDepth || 0}</span>
            <span className="topbar-metric-label">Queue</span>
          </div>
          <div className="topbar-metric-divider" />
          <div className="topbar-metric">
            <span className="topbar-metric-value">${stats?.periodCost?.toFixed(2) || "0.00"}</span>
            <span className="topbar-metric-label">Today</span>
          </div>
          <div className="topbar-metric-divider" />
          <div className="topbar-metric">
            <span className="topbar-metric-value">
              {stats
                ? Math.round(
                    (stats.periodCompleted / (stats.periodCompleted + stats.periodFailed || 1)) * 100
                  )
                : 0}
              %
            </span>
            <span className="topbar-metric-label">Success</span>
          </div>
        </div>

        {/* Connection indicator */}
        <div className={`topbar-connection ${sseConnected ? "connected" : "disconnected"}`}>
          <span className="topbar-connection-dot" />
          <span className="topbar-connection-label">{sseConnected ? "LIVE" : "OFFLINE"}</span>
        </div>

        {/* UTC Clock */}
        <div className="topbar-clock">
          <span className="topbar-clock-time">{formatUTCTime(currentTime)}</span>
          <span className="topbar-clock-label">UTC</span>
        </div>

        {/* Quick actions */}
        <div className="topbar-actions">
          <button
            onClick={onToggleSound}
            className={`topbar-action ${soundEnabled ? "active" : ""}`}
            title={soundEnabled ? "Mute sounds" : "Enable sounds"}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <Link to="/analytics" className="topbar-action" title="Analytics">
            <BarChart3 className="w-4 h-4" />
          </Link>
          <Link to="/settings" className="topbar-action" title="Settings">
            <Settings className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}

import { useState } from 'react';
import {
  Power,
  Pause,
  AlertOctagon,
  Zap,
  DollarSign,
  Layers,
  Clock,
  CheckCircle,
  Command,
} from 'lucide-react';
import type { ControlCenterStats, SystemStatus } from '../../../types/mission-control';

interface PulseProps {
  stats: ControlCenterStats;
  systemStatus: SystemStatus;
  viewMode: 'compact' | 'expanded';
  onPauseAll: () => void;
  onKillAll: () => void;
  onToggleSystem: () => void;
  onToggleViewMode: () => void;
  onOpenCommandPalette: () => void;
}

export function Pulse({
  stats,
  systemStatus,
  viewMode,
  onPauseAll,
  onKillAll,
  onToggleSystem,
  onToggleViewMode,
  onOpenCommandPalette,
}: PulseProps) {
  const [showKillConfirm, setShowKillConfirm] = useState(false);

  const spendDelta = stats.todaySpend - stats.yesterdaySpend;
  const spendDeltaPercent =
    stats.yesterdaySpend > 0
      ? ((spendDelta / stats.yesterdaySpend) * 100).toFixed(0)
      : 0;

  const handleKillClick = () => {
    if (showKillConfirm) {
      onKillAll();
      setShowKillConfirm(false);
    } else {
      setShowKillConfirm(true);
      setTimeout(() => setShowKillConfirm(false), 3000);
    }
  };

  return (
    <header className="mc-pulse">
      {/* Logo */}
      <div className="mc-pulse-logo">
        <Zap className="w-5 h-5 text-[var(--mc-status-active)]" />
        MISSION <span>CONTROL</span>
      </div>

      <div className="mc-pulse-divider" />

      {/* System Status */}
      <div className="flex items-center gap-2">
        <div
          className={`mc-status-dot ${systemStatus.systemEnabled ? 'live' : 'muted'}`}
        />
        <span className="text-[var(--mc-text-xs)] font-semibold uppercase tracking-wider">
          {systemStatus.systemEnabled ? 'SYSTEM LIVE' : 'SYSTEM OFF'}
        </span>
      </div>

      <div className="mc-pulse-divider" />

      {/* Stats */}
      <div className="mc-pulse-stats">
        {/* Today's Spend */}
        <div className="mc-pulse-stat">
          <div className="mc-pulse-stat-value flex items-center">
            <DollarSign className="w-3.5 h-3.5 mr-0.5 text-[var(--mc-text-muted)]" />
            {stats.todaySpend.toFixed(2)}
            {spendDelta !== 0 && (
              <span
                className={`mc-pulse-stat-delta ${
                  spendDelta > 0 ? 'positive' : 'negative'
                }`}
              >
                {spendDelta > 0 ? '↑' : '↓'} {Math.abs(Number(spendDeltaPercent))}%
              </span>
            )}
          </div>
          <div className="mc-pulse-stat-label">Today</div>
        </div>

        {/* Active Slots */}
        <div className="mc-pulse-stat">
          <div className="mc-pulse-stat-value flex items-center">
            <Layers className="w-3.5 h-3.5 mr-0.5 text-[var(--mc-text-muted)]" />
            {stats.activeWorkers}/{stats.maxWorkers}
          </div>
          <div className="mc-pulse-stat-label">Slots</div>
        </div>

        {/* Queue Depth */}
        <div className="mc-pulse-stat">
          <div className="mc-pulse-stat-value flex items-center">
            <Clock className="w-3.5 h-3.5 mr-0.5 text-[var(--mc-text-muted)]" />
            {stats.queueDepth}
          </div>
          <div className="mc-pulse-stat-label">Queued</div>
        </div>

        {/* Success Rate */}
        <div className="mc-pulse-stat">
          <div className="mc-pulse-stat-value flex items-center gap-2">
            <div className="flex items-center gap-1 h-4">
              {/* Mini progress bar */}
              <div className="w-16 h-1.5 bg-[var(--mc-border-default)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--mc-status-live)] rounded-full transition-all duration-300"
                  style={{ width: `${stats.successRate24h}%` }}
                />
              </div>
              <span className="text-[var(--mc-text-xs)]">
                {stats.successRate24h.toFixed(0)}%
              </span>
            </div>
          </div>
          <div className="mc-pulse-stat-label">24hr Success</div>
        </div>

        {/* Completed Today */}
        <div className="mc-pulse-stat">
          <div className="mc-pulse-stat-value flex items-center">
            <CheckCircle className="w-3.5 h-3.5 mr-0.5 text-[var(--mc-status-live)]" />
            {stats.completedToday}
          </div>
          <div className="mc-pulse-stat-label">Completed</div>
        </div>
      </div>

      {/* Controls */}
      <div className="mc-pulse-controls">
        {/* Command Palette Trigger */}
        <button
          onClick={onOpenCommandPalette}
          className="mc-btn-ghost flex items-center gap-1 px-2"
          title="Command Palette (⌘K)"
        >
          <Command className="w-4 h-4" />
          <span className="text-[var(--mc-text-xs)] font-mono">⌘K</span>
        </button>

        <div className="mc-pulse-divider" />

        {/* View Mode Toggle */}
        <button
          onClick={onToggleViewMode}
          className={`mc-btn-secondary text-[var(--mc-text-xs)] px-2 py-1 ${
            viewMode === 'compact' ? 'bg-[var(--mc-bg-active)]' : ''
          }`}
        >
          {viewMode === 'compact' ? 'COMPACT' : 'EXPANDED'}
        </button>

        <div className="mc-pulse-divider" />

        {/* Pause All */}
        <button
          onClick={onPauseAll}
          className="mc-btn-secondary px-2 py-1"
          title="Pause All Workers"
        >
          <Pause className="w-4 h-4" />
        </button>

        {/* System Toggle */}
        <button
          onClick={onToggleSystem}
          className={`mc-btn-secondary px-2 py-1 ${
            systemStatus.systemEnabled
              ? 'text-[var(--mc-status-live)]'
              : 'text-[var(--mc-text-muted)]'
          }`}
          title={systemStatus.systemEnabled ? 'Disable System' : 'Enable System'}
        >
          <Power className="w-4 h-4" />
        </button>

        {/* Kill Switch */}
        <button
          onClick={handleKillClick}
          className={`mc-btn-kill text-[var(--mc-text-xs)] px-3 py-1 ${
            showKillConfirm ? 'animate-pulse' : ''
          }`}
        >
          <AlertOctagon className="w-4 h-4" />
          {showKillConfirm ? 'CONFIRM' : 'KILL'}
        </button>
      </div>
    </header>
  );
}

import { useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Wifi, WifiOff } from 'lucide-react';

import { useAuthStore } from '../../store/auth-store';
import { useMissionControlStore } from '../../store/mission-control-store';
import { useMissionControlStreams } from './hooks/useMissionControlStreams';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

import { Pulse } from './components/Pulse';
import { PersonaLens } from './components/PersonaLens';
import { ActiveTheater } from './components/ActiveTheater';
import { TriageRail } from './components/TriageRail';
import { ManagerPanel } from './components/ManagerPanel';
import { CommandPalette, getDefaultCommands } from './components/CommandPalette';
import { QueueList, RecentList } from './components/QueueList';

import type { WorkerPersona } from '../../types/mission-control';

import './styles/dark-ops.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function MissionControl() {
  const navigate = useNavigate();
  const logout = useAuthStore((state) => state.logout);
  const store = useMissionControlStore();
  const { isConnected, reconnect } = useMissionControlStreams();

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onOpenCommandPalette: () => store.toggleCommandPalette(),
  });

  // Get filtered tasks
  const filteredTasks = store.getFilteredActiveTasks();
  const taskCountByPersona = store.getTaskCountByPersona();

  // Cost history map
  const costHistoryMap = useMemo(() => {
    const map = new Map<string, number[]>();
    store.costHistory.forEach((history, taskId) => {
      map.set(
        taskId,
        history.map((p) => p.cost)
      );
    });
    return map;
  }, [store.costHistory]);

  // Get auth token helper
  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('accessToken');
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }, []);

  // API actions
  const handlePauseAll = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/orchestrator/stop`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (response.status === 401) {
        logout();
        navigate('/login');
      }
    } catch (err) {
      console.error('Failed to pause all:', err);
    }
  }, [getAuthHeaders, logout, navigate]);

  const handleKillAll = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/orchestrator/stop`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (response.status === 401) {
        logout();
        navigate('/login');
      }
    } catch (err) {
      console.error('Failed to kill all:', err);
    }
  }, [getAuthHeaders, logout, navigate]);

  const handleToggleSystem = useCallback(async () => {
    try {
      const endpoint = store.systemStatus.systemEnabled
        ? `${API_BASE}/api/system/disable`
        : `${API_BASE}/api/system/enable`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (response.status === 401) {
        logout();
        navigate('/login');
      }
    } catch (err) {
      console.error('Failed to toggle system:', err);
    }
  }, [store.systemStatus.systemEnabled, getAuthHeaders, logout, navigate]);

  const handlePauseTask = useCallback(
    async (taskId: string) => {
      try {
        await fetch(`${API_BASE}/api/tasks/${taskId}/cancel`, {
          method: 'POST',
          headers: getAuthHeaders(),
        });
      } catch (err) {
        console.error('Failed to pause task:', err);
      }
    },
    [getAuthHeaders]
  );

  const handleCancelTask = useCallback(
    async (taskId: string) => {
      try {
        await fetch(`${API_BASE}/api/tasks/${taskId}/cancel`, {
          method: 'POST',
          headers: getAuthHeaders(),
        });
      } catch (err) {
        console.error('Failed to cancel task:', err);
      }
    },
    [getAuthHeaders]
  );

  const handleTriageAction = useCallback(
    async (itemId: string, actionId: string) => {
      console.log('Triage action:', itemId, actionId);
      // Remove from triage list optimistically
      store.removeTriageItem(itemId);
    },
    [store]
  );

  const handleManagerApprove = useCallback(async () => {
    if (!store.managerAnalysis) return;
    try {
      await fetch(`${API_BASE}/api/tasks/${store.managerAnalysis.taskId}/approve`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      store.setManagerAnalysis(null);
    } catch (err) {
      console.error('Failed to approve:', err);
    }
  }, [store, getAuthHeaders]);

  const handleManagerRequestChanges = useCallback(async () => {
    if (!store.managerAnalysis) return;
    try {
      await fetch(
        `${API_BASE}/api/tasks/${store.managerAnalysis.taskId}/request-changes`,
        {
          method: 'POST',
          headers: getAuthHeaders(),
        }
      );
      store.setManagerAnalysis(null);
    } catch (err) {
      console.error('Failed to request changes:', err);
    }
  }, [store, getAuthHeaders]);

  const handleChangeManagerModel = useCallback(
    async (model: string) => {
      try {
        await fetch(`${API_BASE}/api/manager/model`, {
          method: 'PATCH',
          headers: getAuthHeaders(),
          body: JSON.stringify({ model }),
        });
        store.setManagerModel(model);
      } catch (err) {
        console.error('Failed to change manager model:', err);
      }
    },
    [store, getAuthHeaders]
  );

  // Command palette commands
  const commands = useMemo(
    () =>
      getDefaultCommands({
        pauseAll: handlePauseAll,
        pauseBackend: () => console.log('pause backend'),
        pauseDevOps: () => console.log('pause devops'),
        resumeAll: () => console.log('resume all'),
        killAll: handleKillAll,
        filterSecurity: () => store.setFilters(['security_engineer']),
        filterDevOps: () => store.setFilters(['devops_engineer']),
        filterBackend: () => store.setFilters(['backend_developer']),
        clearFilters: () => store.clearFilters(),
        toggleCompact: () =>
          store.setViewMode(store.viewMode === 'compact' ? 'expanded' : 'compact'),
        toggleTriage: () => store.toggleTriageRail(),
        toggleManager: () => store.toggleManagerPanel(),
        startOrchestrator: async () => {
          await fetch(`${API_BASE}/api/orchestrator/start`, {
            method: 'POST',
            headers: getAuthHeaders(),
          });
        },
        stopOrchestrator: async () => {
          await fetch(`${API_BASE}/api/orchestrator/stop`, {
            method: 'POST',
            headers: getAuthHeaders(),
          });
        },
        watcherOn: async () => {
          await fetch(`${API_BASE}/api/watcher/enable`, {
            method: 'POST',
            headers: getAuthHeaders(),
          });
        },
        watcherOff: async () => {
          await fetch(`${API_BASE}/api/watcher/disable`, {
            method: 'POST',
            headers: getAuthHeaders(),
          });
        },
        goToTask: (key: string) => console.log('go to task:', key),
      }),
    [handlePauseAll, handleKillAll, store, getAuthHeaders]
  );

  const handleCommandExecute = useCallback(
    (commandId: string) => {
      switch (commandId) {
        case 'pause_all':
          handlePauseAll();
          break;
        case 'kill_all':
          handleKillAll();
          break;
        case 'filter_security':
          store.setFilters(['security_engineer']);
          break;
        case 'filter_devops':
          store.setFilters(['devops_engineer']);
          break;
        case 'filter_backend':
          store.setFilters(['backend_developer']);
          break;
        case 'clear_filters':
          store.clearFilters();
          break;
        case 'toggle_compact':
          store.setViewMode(store.viewMode === 'compact' ? 'expanded' : 'compact');
          break;
        case 'toggle_triage':
          store.toggleTriageRail();
          break;
        case 'toggle_manager':
          store.toggleManagerPanel();
          break;
        case 'start_orchestrator':
          fetch(`${API_BASE}/api/orchestrator/start`, {
            method: 'POST',
            headers: getAuthHeaders(),
          });
          break;
        case 'stop_orchestrator':
          fetch(`${API_BASE}/api/orchestrator/stop`, {
            method: 'POST',
            headers: getAuthHeaders(),
          });
          break;
        case 'watcher_on':
          fetch(`${API_BASE}/api/watcher/enable`, {
            method: 'POST',
            headers: getAuthHeaders(),
          });
          break;
        case 'watcher_off':
          fetch(`${API_BASE}/api/watcher/disable`, {
            method: 'POST',
            headers: getAuthHeaders(),
          });
          break;
        default:
          console.log('Unknown command:', commandId);
      }
    },
    [handlePauseAll, handleKillAll, store, getAuthHeaders]
  );

  return (
    <div className="mission-control">
      {/* Header / Pulse */}
      <Pulse
        stats={store.stats}
        systemStatus={store.systemStatus}
        viewMode={store.viewMode}
        onPauseAll={handlePauseAll}
        onKillAll={handleKillAll}
        onToggleSystem={handleToggleSystem}
        onToggleViewMode={() =>
          store.setViewMode(store.viewMode === 'compact' ? 'expanded' : 'compact')
        }
        onOpenCommandPalette={() => store.toggleCommandPalette()}
      />

      {/* Persona Filter Bar */}
      <PersonaLens
        activeFilters={store.activeFilters}
        taskCountByPersona={taskCountByPersona}
        onToggleFilter={(persona: WorkerPersona) => store.toggleFilter(persona)}
        onClearFilters={() => store.clearFilters()}
      />

      {/* Main Layout */}
      <div className="mc-layout">
        {/* Main Content */}
        <div className="mc-layout-main">
          {/* Active Theater */}
          <ActiveTheater
            tasks={filteredTasks}
            viewMode={store.viewMode}
            expandedTileId={store.expandedTileId}
            costHistoryMap={costHistoryMap}
            onExpandTile={(taskId) => store.expandTile(taskId)}
            onCollapseTile={() => store.collapseTile()}
            onPauseTask={handlePauseTask}
            onCancelTask={handleCancelTask}
          />

          {/* Queue and Recent */}
          <div className="grid grid-cols-2 gap-4">
            <QueueList
              tasks={store.queuedTasks}
              onSelectTask={(taskId) => console.log('Select queued task:', taskId)}
            />
            <RecentList
              tasks={store.recentCompleted}
              onSelectTask={(taskId) => console.log('Select completed task:', taskId)}
            />
          </div>
        </div>

        {/* Sidebar */}
        <div className="mc-layout-sidebar">
          {/* Triage Rail */}
          {store.triageRailVisible && (
            <TriageRail items={store.triageItems} onAction={handleTriageAction} />
          )}

          {/* Manager Panel */}
          {store.managerPanelVisible && (
            <ManagerPanel
              analysis={store.managerAnalysis}
              model={store.managerModel}
              queueCount={store.managerQueueCount}
              onApprove={handleManagerApprove}
              onRequestChanges={handleManagerRequestChanges}
              onChangeModel={handleChangeManagerModel}
            />
          )}
        </div>
      </div>

      {/* Command Palette */}
      <CommandPalette
        isOpen={store.commandPaletteOpen}
        onClose={() => store.closeCommandPalette()}
        onExecute={handleCommandExecute}
        commands={commands}
      />

      {/* Connection Status */}
      <div className="fixed bottom-4 left-4 flex items-center gap-2 text-[var(--mc-text-xs)]">
        {isConnected ? (
          <>
            <Wifi className="w-3 h-3 text-[var(--mc-status-live)]" />
            <span className="text-[var(--mc-text-muted)]">Connected</span>
          </>
        ) : (
          <button
            onClick={reconnect}
            className="flex items-center gap-2 text-[var(--mc-status-danger)] hover:underline"
          >
            <WifiOff className="w-3 h-3" />
            <span>Disconnected - Click to reconnect</span>
          </button>
        )}
      </div>

      {/* Back to Classic Link */}
      <Link
        to="/dashboard"
        className="fixed bottom-4 right-4 flex items-center gap-1 text-[var(--mc-text-xs)] text-[var(--mc-text-muted)] hover:text-[var(--mc-text-primary)] transition-colors"
      >
        <ArrowLeft className="w-3 h-3" />
        Classic View
      </Link>
    </div>
  );
}

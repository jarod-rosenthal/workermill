import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  MissionControlTask,
  TriageItem,
  ManagerAnalysis,
  ControlCenterStats,
  SystemStatus,
  WorkerPersona,
  ViewMode,
  CostDataPoint,
} from '../types/mission-control';

// Maximum log lines per task (memory bounded)
const MAX_LOG_LINES_PER_TASK = 100;
const MAX_COST_HISTORY_POINTS = 20;

interface MissionControlState {
  // View State
  viewMode: ViewMode;
  activeFilters: WorkerPersona[];
  expandedTileId: string | null;
  commandPaletteOpen: boolean;
  triageRailVisible: boolean;
  managerPanelVisible: boolean;
  selectedTriageId: string | null;

  // Data State
  systemStatus: SystemStatus;
  stats: ControlCenterStats;
  activeTasks: Map<string, MissionControlTask>;
  queuedTasks: MissionControlTask[];
  recentCompleted: MissionControlTask[];
  triageItems: TriageItem[];
  managerAnalysis: ManagerAnalysis | null;
  managerModel: string;
  managerQueueCount: number;

  // Cost Tracking (sparkline data)
  costHistory: Map<string, CostDataPoint[]>;

  // Connection State
  isConnected: boolean;
  lastUpdate: number;

  // Actions - View
  setViewMode: (mode: ViewMode) => void;
  toggleFilter: (persona: WorkerPersona) => void;
  setFilters: (personas: WorkerPersona[]) => void;
  clearFilters: () => void;
  expandTile: (taskId: string) => void;
  collapseTile: () => void;
  toggleCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleTriageRail: () => void;
  toggleManagerPanel: () => void;
  selectTriage: (id: string | null) => void;

  // Actions - Data
  setSystemStatus: (status: SystemStatus) => void;
  setStats: (stats: ControlCenterStats) => void;
  setActiveTasks: (tasks: MissionControlTask[]) => void;
  updateTask: (taskId: string, update: Partial<MissionControlTask>) => void;
  appendTaskLogs: (taskId: string, lines: string[]) => void;
  setQueuedTasks: (tasks: MissionControlTask[]) => void;
  setRecentCompleted: (tasks: MissionControlTask[]) => void;
  setTriageItems: (items: TriageItem[]) => void;
  addTriageItem: (item: TriageItem) => void;
  removeTriageItem: (id: string) => void;
  setManagerAnalysis: (analysis: ManagerAnalysis | null) => void;
  setManagerModel: (model: string) => void;
  setManagerQueueCount: (count: number) => void;

  // Actions - Cost Tracking
  recordCostSnapshot: (taskId: string, cost: number) => void;
  getCostHistory: (taskId: string) => number[];

  // Actions - Connection
  setConnected: (connected: boolean) => void;
  touchLastUpdate: () => void;

  // Computed
  getFilteredActiveTasks: () => MissionControlTask[];
  getTaskCountByPersona: () => Record<WorkerPersona, number>;
}

export const useMissionControlStore = create<MissionControlState>()(
  subscribeWithSelector((set, get) => ({
    // Initial View State
    viewMode: 'expanded',
    activeFilters: [],
    expandedTileId: null,
    commandPaletteOpen: false,
    triageRailVisible: true,
    managerPanelVisible: true,
    selectedTriageId: null,

    // Initial Data State
    systemStatus: {
      systemEnabled: false,
      orchestratorRunning: false,
      watcherEnabled: false,
    },
    stats: {
      activeWorkers: 0,
      maxWorkers: 10,
      queueDepth: 0,
      todaySpend: 0,
      yesterdaySpend: 0,
      completedToday: 0,
      failedToday: 0,
      avgCycleTimeMinutes: 0,
      successRate24h: 0,
    },
    activeTasks: new Map(),
    queuedTasks: [],
    recentCompleted: [],
    triageItems: [],
    managerAnalysis: null,
    managerModel: 'claude-sonnet-4-5-20250929',
    managerQueueCount: 0,

    // Cost Tracking
    costHistory: new Map(),

    // Connection State
    isConnected: false,
    lastUpdate: 0,

    // View Actions
    setViewMode: (mode) => set({ viewMode: mode }),

    toggleFilter: (persona) =>
      set((state) => {
        const filters = [...state.activeFilters];
        const index = filters.indexOf(persona);
        if (index >= 0) {
          filters.splice(index, 1);
        } else {
          filters.push(persona);
        }
        return { activeFilters: filters };
      }),

    setFilters: (personas) => set({ activeFilters: personas }),

    clearFilters: () => set({ activeFilters: [] }),

    expandTile: (taskId) => set({ expandedTileId: taskId }),

    collapseTile: () => set({ expandedTileId: null }),

    toggleCommandPalette: () =>
      set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),

    closeCommandPalette: () => set({ commandPaletteOpen: false }),

    toggleTriageRail: () =>
      set((state) => ({ triageRailVisible: !state.triageRailVisible })),

    toggleManagerPanel: () =>
      set((state) => ({ managerPanelVisible: !state.managerPanelVisible })),

    selectTriage: (id) => set({ selectedTriageId: id }),

    // Data Actions
    setSystemStatus: (status) => set({ systemStatus: status }),

    setStats: (stats) => set({ stats }),

    setActiveTasks: (tasks) => {
      const taskMap = new Map<string, MissionControlTask>();
      tasks.forEach((task) => {
        // Preserve existing terminal lines if we have them
        const existing = get().activeTasks.get(task.id);
        if (existing && existing.terminalLines.length > 0) {
          task.terminalLines = existing.terminalLines;
        }
        taskMap.set(task.id, task);
      });
      set({ activeTasks: taskMap });
    },

    updateTask: (taskId, update) =>
      set((state) => {
        const task = state.activeTasks.get(taskId);
        if (!task) return state;

        const updatedTask = { ...task, ...update };
        const newMap = new Map(state.activeTasks);
        newMap.set(taskId, updatedTask);
        return { activeTasks: newMap };
      }),

    appendTaskLogs: (taskId, lines) =>
      set((state) => {
        const task = state.activeTasks.get(taskId);
        if (!task) return state;

        const newLines = [...task.terminalLines, ...lines];
        // Keep only last N lines
        const trimmedLines =
          newLines.length > MAX_LOG_LINES_PER_TASK
            ? newLines.slice(-MAX_LOG_LINES_PER_TASK)
            : newLines;

        const updatedTask = { ...task, terminalLines: trimmedLines };
        const newMap = new Map(state.activeTasks);
        newMap.set(taskId, updatedTask);
        return { activeTasks: newMap };
      }),

    setQueuedTasks: (tasks) => set({ queuedTasks: tasks }),

    setRecentCompleted: (tasks) => set({ recentCompleted: tasks }),

    setTriageItems: (items) => set({ triageItems: items }),

    addTriageItem: (item) =>
      set((state) => ({ triageItems: [item, ...state.triageItems] })),

    removeTriageItem: (id) =>
      set((state) => ({
        triageItems: state.triageItems.filter((item) => item.id !== id),
        selectedTriageId:
          state.selectedTriageId === id ? null : state.selectedTriageId,
      })),

    setManagerAnalysis: (analysis) => set({ managerAnalysis: analysis }),

    setManagerModel: (model) => set({ managerModel: model }),

    setManagerQueueCount: (count) => set({ managerQueueCount: count }),

    // Cost Tracking
    recordCostSnapshot: (taskId, cost) =>
      set((state) => {
        const history = state.costHistory.get(taskId) || [];
        const now = Date.now();
        const lastPoint = history[history.length - 1];
        const velocity = lastPoint
          ? (cost - lastPoint.cost) / ((now - lastPoint.timestamp) / 1000)
          : 0;

        const newPoint: CostDataPoint = { timestamp: now, cost, velocity };
        const newHistory = [...history, newPoint];

        // Keep only last N points
        const trimmedHistory =
          newHistory.length > MAX_COST_HISTORY_POINTS
            ? newHistory.slice(-MAX_COST_HISTORY_POINTS)
            : newHistory;

        const newMap = new Map(state.costHistory);
        newMap.set(taskId, trimmedHistory);
        return { costHistory: newMap };
      }),

    getCostHistory: (taskId) => {
      const history = get().costHistory.get(taskId) || [];
      return history.map((p) => p.cost);
    },

    // Connection
    setConnected: (connected) => set({ isConnected: connected }),

    touchLastUpdate: () => set({ lastUpdate: Date.now() }),

    // Computed
    getFilteredActiveTasks: () => {
      const state = get();
      const tasks = Array.from(state.activeTasks.values());

      if (state.activeFilters.length === 0) {
        return tasks;
      }

      return tasks.filter((task) =>
        state.activeFilters.includes(task.workerPersona)
      );
    },

    getTaskCountByPersona: () => {
      const tasks = Array.from(get().activeTasks.values());
      const counts: Record<WorkerPersona, number> = {
        frontend_developer: 0,
        backend_developer: 0,
        devops_engineer: 0,
        security_engineer: 0,
        qa_engineer: 0,
        tech_writer: 0,
        project_manager: 0,
      };

      tasks.forEach((task) => {
        if (task.workerPersona in counts) {
          counts[task.workerPersona]++;
        }
      });

      return counts;
    },
  }))
);

// Selector hooks for optimized re-renders
export const useViewMode = () =>
  useMissionControlStore((state) => state.viewMode);
export const useActiveFilters = () =>
  useMissionControlStore((state) => state.activeFilters);
export const useExpandedTileId = () =>
  useMissionControlStore((state) => state.expandedTileId);
export const useCommandPaletteOpen = () =>
  useMissionControlStore((state) => state.commandPaletteOpen);
export const useSystemStatus = () =>
  useMissionControlStore((state) => state.systemStatus);
export const useStats = () => useMissionControlStore((state) => state.stats);
export const useTriageItems = () =>
  useMissionControlStore((state) => state.triageItems);
export const useManagerAnalysis = () =>
  useMissionControlStore((state) => state.managerAnalysis);
export const useIsConnected = () =>
  useMissionControlStore((state) => state.isConnected);

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { WorkerPersona } from "../../types/mission-control";

// Maximum log lines per terminal (memory bounded)
const MAX_LOG_LINES_PER_STORY = 200;
const MAX_CONTEXT_MESSAGES = 500;

// Context message types matching backend
export type ContextMessageType =
  | "file_created"
  | "file_modified"
  | "decision"
  | "dependency"
  | "question"
  | "answer"
  | "completion"
  | "blocker"
  | "warning"
  | "progress";

// Child task (story) status
export type ChildTaskStatus =
  | "planned" // Virtual status for stories before approval
  | "queued"
  | "claimed"
  | "environment_setup"
  | "executing"
  | "pr_created"
  | "review_requested"
  | "blocked"
  | "completed"
  | "deployed"
  | "failed"
  | "cancelled";

// Parent task representing the PRD/Epic
export interface ParentTask {
  id: string;
  jiraIssueKey: string;
  summary: string;
  status: string;
  workerPersona: WorkerPersona;
  workerModel: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  estimatedCostUsd: number;
  childCount: number;
  planJson?: {
    stories?: Array<{
      id: string;
      title: string;
      persona: WorkerPersona;
      description?: string;
      dependencies?: string[];
    }>;
  } | null;
}

// Child task (individual story)
export interface ChildTask {
  id: string;
  jiraIssueKey: string;
  summary: string;
  status: ChildTaskStatus;
  workerPersona: WorkerPersona;
  workerModel: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  estimatedCostUsd: number;
  githubPrUrl?: string;
  githubPrNumber?: number;
  branchName?: string;
  currentFile?: string;
  terminalLines: string[];
  dependencies?: string[];
  storyIndex?: number; // 1-based index for display
  storyDependencies?: number[]; // Array of story indices this depends on
  blockedReason?: string;
}

// Context message from sibling workers
export interface ContextMessage {
  id: string;
  taskId: string;
  persona: WorkerPersona;
  messageType: ContextMessageType;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

// Aggregate stats for workflow
export interface WorkflowStats {
  totalStories: number;
  planned: number;
  queued: number;
  running: number;
  blocked: number;
  completed: number;
  failed: number;
  totalCostUsd: number;
}

// Execution mode
export type ExecutionMode = "autonomous" | "supervised";

// LocalStorage keys for terminal panel persistence
const STORAGE_KEYS = {
  terminalPanelHeight: "workermill:orchestration:terminalPanelHeight",
  isTerminalPanelCollapsed: "workermill:orchestration:isTerminalPanelCollapsed",
};

// Store state interface
interface OrchestrationState {
  // Data State
  parentTask: ParentTask | null;
  children: Map<string, ChildTask>;
  contextMessages: ContextMessage[];
  executionMode: ExecutionMode;

  // UI State
  activeTerminalTabId: string | null; // Replaces expandedStoryId
  unreadTasks: Set<string>; // Tasks with new output since last viewed
  isTerminalPanelCollapsed: boolean;
  terminalPanelHeight: number;
  feedFilterType: ContextMessageType | "all";
  isFeedCollapsed: boolean;
  showDependencyGraph: boolean;

  // Legacy alias for backward compatibility during migration
  expandedStoryId: string | null;

  // Connection State
  isConnected: boolean;
  isContextConnected: boolean;
  lastUpdate: number;
  error: string | null;

  // Computed getters
  getChildrenArray: () => ChildTask[];
  getStats: () => WorkflowStats;
  getFilteredContextMessages: () => ContextMessage[];

  // Actions - Data
  setParentTask: (task: ParentTask) => void;
  setChildren: (children: ChildTask[]) => void;
  updateChild: (childId: string, update: Partial<ChildTask>) => void;
  appendChildLogs: (childId: string, lines: string[]) => void;
  addContextMessage: (msg: ContextMessage) => void;
  clearContextMessages: () => void;

  // Actions - UI (Terminal Panel)
  setActiveTerminalTab: (taskId: string | null) => void;
  markTaskAsRead: (taskId: string) => void;
  addUnreadTask: (taskId: string) => void;
  toggleTerminalPanel: () => void;
  setTerminalPanelHeight: (height: number) => void;

  // Actions - UI (Legacy + Other)
  toggleStory: (storyId: string) => void;
  collapseAllStories: () => void;
  setFeedFilter: (filter: ContextMessageType | "all") => void;
  toggleFeed: () => void;
  setExecutionMode: (mode: ExecutionMode) => void;
  toggleDependencyGraph: () => void;

  // Actions - Connection
  setConnected: (connected: boolean) => void;
  setContextConnected: (connected: boolean) => void;
  setError: (error: string | null) => void;
  touchLastUpdate: () => void;

  // Actions - Reset
  reset: () => void;
}

// Load persisted terminal panel state from localStorage
const getPersistedTerminalPanelHeight = (): number => {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.terminalPanelHeight);
    if (stored) {
      const height = parseInt(stored, 10);
      if (!isNaN(height) && height >= 150 && height <= 600) {
        return height;
      }
    }
  } catch {
    // Ignore localStorage errors
  }
  return 280; // Default height
};

const getPersistedTerminalPanelCollapsed = (): boolean => {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.isTerminalPanelCollapsed);
    if (stored !== null) {
      return stored === "true";
    }
  } catch {
    // Ignore localStorage errors
  }
  return false; // Default: not collapsed
};

const initialState = {
  parentTask: null,
  children: new Map<string, ChildTask>(),
  contextMessages: [],
  executionMode: "autonomous" as ExecutionMode,
  activeTerminalTabId: null as string | null,
  unreadTasks: new Set<string>(),
  isTerminalPanelCollapsed: getPersistedTerminalPanelCollapsed(),
  terminalPanelHeight: getPersistedTerminalPanelHeight(),
  expandedStoryId: null as string | null, // Legacy alias
  feedFilterType: "all" as const,
  isFeedCollapsed: false,
  showDependencyGraph: false,
  isConnected: false,
  isContextConnected: false,
  lastUpdate: 0,
  error: null,
};

export const useOrchestrationStore = create<OrchestrationState>()(
  subscribeWithSelector((set, get) => ({
    ...initialState,

    // Computed - get children as sorted array
    getChildrenArray: () => {
      const children = Array.from(get().children.values());
      // Sort by status priority: running > blocked > queued > planned > completed > failed
      const statusPriority: Record<ChildTaskStatus, number> = {
        executing: 0,
        environment_setup: 1,
        claimed: 2,
        blocked: 3,
        queued: 4,
        planned: 5, // Planned stories (before approval)
        pr_created: 6,
        review_requested: 7,
        completed: 8,
        deployed: 9,
        failed: 10,
        cancelled: 11,
      };
      return children.sort((a, b) => {
        // Primary sort by story index if available
        if (a.storyIndex && b.storyIndex) {
          return a.storyIndex - b.storyIndex;
        }
        // Otherwise sort by status priority
        const priorityDiff =
          (statusPriority[a.status] ?? 99) - (statusPriority[b.status] ?? 99);
        if (priorityDiff !== 0) return priorityDiff;
        // Secondary sort by created time
        return (
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      });
    },

    // Computed - aggregate stats
    getStats: () => {
      const children = Array.from(get().children.values());
      return {
        totalStories: children.length,
        planned: children.filter((c) => c.status === "planned").length,
        queued: children.filter((c) =>
          ["queued", "claimed"].includes(c.status)
        ).length,
        running: children.filter((c) =>
          ["environment_setup", "executing"].includes(c.status)
        ).length,
        blocked: children.filter((c) => c.status === "blocked").length,
        completed: children.filter((c) =>
          ["completed", "deployed", "pr_created", "review_requested"].includes(
            c.status
          )
        ).length,
        failed: children.filter((c) =>
          ["failed", "cancelled"].includes(c.status)
        ).length,
        totalCostUsd: children.reduce(
          (sum, c) => sum + (c.estimatedCostUsd || 0),
          0
        ),
      };
    },

    // Computed - filtered context messages
    getFilteredContextMessages: () => {
      const { contextMessages, feedFilterType } = get();
      if (feedFilterType === "all") return contextMessages;
      return contextMessages.filter((m) => m.messageType === feedFilterType);
    },

    // Data Actions
    setParentTask: (task) => set({ parentTask: task }),

    setChildren: (children) => {
      const childMap = new Map<string, ChildTask>();
      children.forEach((child) => {
        // Preserve existing terminal lines if we have them
        const existing = get().children.get(child.id);
        if (existing && existing.terminalLines.length > 0) {
          child.terminalLines = existing.terminalLines;
        }
        childMap.set(child.id, child);
      });
      set({ children: childMap });
    },

    updateChild: (childId, update) =>
      set((state) => {
        const child = state.children.get(childId);
        if (!child) return state;

        const updatedChild = { ...child, ...update };
        const newMap = new Map(state.children);
        newMap.set(childId, updatedChild);
        return { children: newMap };
      }),

    appendChildLogs: (childId, lines) =>
      set((state) => {
        const child = state.children.get(childId);
        if (!child) return state;

        const newLines = [...child.terminalLines, ...lines];
        const trimmedLines =
          newLines.length > MAX_LOG_LINES_PER_STORY
            ? newLines.slice(-MAX_LOG_LINES_PER_STORY)
            : newLines;

        const updatedChild = { ...child, terminalLines: trimmedLines };
        const newMap = new Map(state.children);
        newMap.set(childId, updatedChild);

        // Mark task as unread if it's not the active tab
        const newUnreadTasks = new Set(state.unreadTasks);
        if (state.activeTerminalTabId !== childId) {
          newUnreadTasks.add(childId);
        }

        return { children: newMap, unreadTasks: newUnreadTasks };
      }),

    addContextMessage: (msg) =>
      set((state) => {
        // Avoid duplicates
        if (state.contextMessages.some((m) => m.id === msg.id)) {
          return state;
        }

        const newMessages = [...state.contextMessages, msg];
        // Keep bounded
        const trimmed =
          newMessages.length > MAX_CONTEXT_MESSAGES
            ? newMessages.slice(-MAX_CONTEXT_MESSAGES)
            : newMessages;

        return { contextMessages: trimmed };
      }),

    clearContextMessages: () => set({ contextMessages: [] }),

    // UI Actions - Terminal Panel
    setActiveTerminalTab: (taskId) =>
      set((state) => {
        // Mark task as read when selecting it
        const newUnreadTasks = new Set(state.unreadTasks);
        if (taskId) {
          newUnreadTasks.delete(taskId);
        }
        return {
          activeTerminalTabId: taskId,
          expandedStoryId: taskId, // Keep legacy alias in sync
          unreadTasks: newUnreadTasks,
        };
      }),

    markTaskAsRead: (taskId) =>
      set((state) => {
        const newUnreadTasks = new Set(state.unreadTasks);
        newUnreadTasks.delete(taskId);
        return { unreadTasks: newUnreadTasks };
      }),

    addUnreadTask: (taskId) =>
      set((state) => {
        if (state.activeTerminalTabId === taskId) return state;
        const newUnreadTasks = new Set(state.unreadTasks);
        newUnreadTasks.add(taskId);
        return { unreadTasks: newUnreadTasks };
      }),

    toggleTerminalPanel: () =>
      set((state) => {
        const newCollapsed = !state.isTerminalPanelCollapsed;
        // Persist to localStorage
        try {
          localStorage.setItem(
            STORAGE_KEYS.isTerminalPanelCollapsed,
            String(newCollapsed)
          );
        } catch {
          // Ignore localStorage errors
        }
        return { isTerminalPanelCollapsed: newCollapsed };
      }),

    setTerminalPanelHeight: (height) =>
      set(() => {
        // Clamp height to valid range
        const clampedHeight = Math.max(150, Math.min(600, height));
        // Persist to localStorage
        try {
          localStorage.setItem(
            STORAGE_KEYS.terminalPanelHeight,
            String(clampedHeight)
          );
        } catch {
          // Ignore localStorage errors
        }
        return { terminalPanelHeight: clampedHeight };
      }),

    // UI Actions - Legacy (delegates to new actions)
    toggleStory: (storyId) =>
      set((state) => {
        const newActiveId =
          state.activeTerminalTabId === storyId ? null : storyId;
        // Mark task as read when selecting it
        const newUnreadTasks = new Set(state.unreadTasks);
        if (newActiveId) {
          newUnreadTasks.delete(newActiveId);
        }
        return {
          activeTerminalTabId: newActiveId,
          expandedStoryId: newActiveId, // Keep legacy alias in sync
          unreadTasks: newUnreadTasks,
        };
      }),

    collapseAllStories: () =>
      set({ activeTerminalTabId: null, expandedStoryId: null }),

    setFeedFilter: (filter) => set({ feedFilterType: filter }),

    toggleFeed: () =>
      set((state) => ({ isFeedCollapsed: !state.isFeedCollapsed })),

    setExecutionMode: (mode) => set({ executionMode: mode }),

    toggleDependencyGraph: () =>
      set((state) => ({ showDependencyGraph: !state.showDependencyGraph })),

    // Connection Actions
    setConnected: (connected) => set({ isConnected: connected }),

    setContextConnected: (connected) => set({ isContextConnected: connected }),

    setError: (error) => set({ error }),

    touchLastUpdate: () => set({ lastUpdate: Date.now() }),

    // Reset - create fresh objects to avoid shared reference issues
    reset: () =>
      set({
        parentTask: null,
        children: new Map<string, ChildTask>(),
        contextMessages: [],
        executionMode: "autonomous" as ExecutionMode,
        activeTerminalTabId: null,
        unreadTasks: new Set<string>(),
        // Don't reset terminal panel state - it's persisted
        isTerminalPanelCollapsed: getPersistedTerminalPanelCollapsed(),
        terminalPanelHeight: getPersistedTerminalPanelHeight(),
        expandedStoryId: null,
        feedFilterType: "all" as const,
        isFeedCollapsed: false,
        showDependencyGraph: false,
        isConnected: false,
        isContextConnected: false,
        lastUpdate: 0,
        error: null,
      }),
  }))
);

// Selector hooks for optimized re-renders
export const useParentTask = () =>
  useOrchestrationStore((state) => state.parentTask);
export const useExpandedStoryId = () =>
  useOrchestrationStore((state) => state.expandedStoryId);
export const useActiveTerminalTabId = () =>
  useOrchestrationStore((state) => state.activeTerminalTabId);
export const useUnreadTasks = () =>
  useOrchestrationStore((state) => state.unreadTasks);
export const useIsTerminalPanelCollapsed = () =>
  useOrchestrationStore((state) => state.isTerminalPanelCollapsed);
export const useTerminalPanelHeight = () =>
  useOrchestrationStore((state) => state.terminalPanelHeight);
export const useIsConnected = () =>
  useOrchestrationStore((state) => state.isConnected);
export const useIsContextConnected = () =>
  useOrchestrationStore((state) => state.isContextConnected);
export const useExecutionMode = () =>
  useOrchestrationStore((state) => state.executionMode);
export const useFeedFilterType = () =>
  useOrchestrationStore((state) => state.feedFilterType);
export const useIsFeedCollapsed = () =>
  useOrchestrationStore((state) => state.isFeedCollapsed);
export const useShowDependencyGraph = () =>
  useOrchestrationStore((state) => state.showDependencyGraph);
export const useOrchestrationError = () =>
  useOrchestrationStore((state) => state.error);

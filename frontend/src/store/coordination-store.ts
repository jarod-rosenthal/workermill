import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

// Maximum context messages to keep
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

// Context message from sibling workers
export interface ContextMessage {
  id: string;
  taskId: string;
  persona: string;
  messageType: ContextMessageType;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

// Store state interface
interface CoordinationState {
  // Data
  messages: ContextMessage[];
  parentTaskId: string | null;

  // Connection
  isConnected: boolean;
  error: string | null;

  // UI State
  filterType: ContextMessageType | "all";
  isCollapsed: boolean;

  // Computed
  getFilteredMessages: () => ContextMessage[];

  // Actions
  addMessage: (msg: ContextMessage) => void;
  setMessages: (msgs: ContextMessage[]) => void;
  clearMessages: () => void;
  setParentTaskId: (taskId: string | null) => void;
  setConnected: (connected: boolean) => void;
  setError: (error: string | null) => void;
  setFilterType: (filter: ContextMessageType | "all") => void;
  toggleCollapsed: () => void;
  setCollapsed: (collapsed: boolean) => void;
  reset: () => void;
}

const initialState = {
  messages: [] as ContextMessage[],
  parentTaskId: null as string | null,
  isConnected: false,
  error: null as string | null,
  filterType: "all" as const,
  isCollapsed: true,
};

export const useCoordinationStore = create<CoordinationState>()(
  subscribeWithSelector((set, get) => ({
    ...initialState,

    // Computed - filtered messages
    getFilteredMessages: () => {
      const { messages, filterType } = get();
      if (filterType === "all") return messages;
      return messages.filter((m) => m.messageType === filterType);
    },

    // Actions
    addMessage: (msg) =>
      set((state) => {
        // Avoid duplicates
        if (state.messages.some((m) => m.id === msg.id)) {
          return state;
        }

        const newMessages = [...state.messages, msg];
        // Keep bounded
        const trimmed =
          newMessages.length > MAX_CONTEXT_MESSAGES
            ? newMessages.slice(-MAX_CONTEXT_MESSAGES)
            : newMessages;

        return { messages: trimmed };
      }),

    setMessages: (msgs) => set({ messages: msgs }),

    clearMessages: () => set({ messages: [] }),

    setParentTaskId: (taskId) => set({ parentTaskId: taskId }),

    setConnected: (connected) => set({ isConnected: connected }),

    setError: (error) => set({ error }),

    setFilterType: (filter) => set({ filterType: filter }),

    toggleCollapsed: () =>
      set((state) => ({ isCollapsed: !state.isCollapsed })),

    setCollapsed: (collapsed) => set({ isCollapsed: collapsed }),

    reset: () =>
      set({
        messages: [],
        parentTaskId: null,
        isConnected: false,
        error: null,
        filterType: "all",
        isCollapsed: true,
      }),
  }))
);

// Selector hooks for optimized re-renders
export const useCoordinationMessages = () =>
  useCoordinationStore((s) => s.messages);
export const useCoordinationConnected = () =>
  useCoordinationStore((s) => s.isConnected);
export const useCoordinationCollapsed = () =>
  useCoordinationStore((s) => s.isCollapsed);
export const useCoordinationFilterType = () =>
  useCoordinationStore((s) => s.filterType);

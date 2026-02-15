import { create } from "zustand";
import { subscribeWithSelector, persist } from "zustand/middleware";

// Maximum context messages to keep in memory (reduced for browser performance)
const MAX_CONTEXT_MESSAGES = 200;

// Maximum messages to persist to localStorage (smaller for faster load)
const MAX_PERSISTED_MESSAGES = 100;

// Default retention days (matches org default taskRetentionDays)
const DEFAULT_RETENTION_DAYS = 90;

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
  | "blocker_detected"   // Escalated blocker requiring human intervention
  | "blocker_resolved"   // User resolved a blocker (retry/skip/abort)
  | "warning"
  | "progress"
  | "story_ready"
  | "story_claimed"
  | "consultation"
  | "constraints"
  | "revision_requested"
  | "user_message"       // User message from dashboard (Talk to Worker)
  | "worker_ack"         // Worker acknowledgment of user message
  | "expert_response";   // Expert mid-execution message to user

// Context message from sibling workers
export interface ContextMessage {
  id: string;
  taskId: string;
  parentTaskId?: string; // Track which parent task this message belongs to
  persona: string;
  messageType: ContextMessageType;
  content: string;
  metadata?: Record<string, unknown>;
  sessionId?: string; // For threading: "{persona}-story-{storyIndex}"
  createdAt: string;
}

// Store state interface
interface CoordinationState {
  // Data
  messages: ContextMessage[];
  parentTaskId: string | null;
  activeStreams: string[]; // Track which parent tasks we're streaming from
  retentionDays: number; // Configured retention period

  // Connection
  isConnected: boolean;
  error: string | null;

  // UI State
  filterType: ContextMessageType | "all" | "important";
  filterParentTaskId: string | null; // Filter to specific parent task
  isCollapsed: boolean;
  viewMode: "flat" | "threaded"; // flat = chronological, threaded = grouped by sessionId

  // Computed
  getFilteredMessages: () => ContextMessage[];
  getMessagesForParentTask: (parentTaskId: string) => ContextMessage[];

  // Actions
  addMessage: (msg: ContextMessage, parentTaskId?: string) => void;
  setMessages: (msgs: ContextMessage[]) => void;
  clearMessages: () => void;
  clearMessagesForTask: (parentTaskId: string) => void;
  setParentTaskId: (taskId: string | null) => void;
  setConnected: (connected: boolean) => void;
  setError: (error: string | null) => void;
  setFilterType: (filter: ContextMessageType | "all" | "important") => void;
  setFilterParentTaskId: (taskId: string | null) => void;
  toggleCollapsed: () => void;
  setViewMode: (mode: "flat" | "threaded") => void;
  setCollapsed: (collapsed: boolean) => void;
  addActiveStream: (parentTaskId: string) => void;
  removeActiveStream: (parentTaskId: string) => void;
  setRetentionDays: (days: number) => void;
  cleanupOldMessages: () => void;
  dedupeMessages: () => void;
  reset: () => void;
}

const initialState = {
  messages: [] as ContextMessage[],
  parentTaskId: null as string | null,
  activeStreams: [] as string[],
  retentionDays: DEFAULT_RETENTION_DAYS,
  isConnected: false,
  error: null as string | null,
  filterType: "important" as const, // Default to important messages only
  filterParentTaskId: null as string | null,
  isCollapsed: true, // Default to collapsed
  viewMode: "threaded" as const, // Default to threaded view for better organization
};

export const useCoordinationStore = create<CoordinationState>()(
  persist(
    subscribeWithSelector((set, get) => ({
      ...initialState,

      // Computed - filtered messages (by type and optionally by parent task)
      getFilteredMessages: () => {
        const { messages, filterType, filterParentTaskId } = get();
        let filtered = messages;

        // Filter by parent task if set
        if (filterParentTaskId) {
          filtered = filtered.filter(
            (m) => m.parentTaskId === filterParentTaskId
          );
        }

        // Always exclude story_ready — internal coordination data, not team collaboration
        filtered = filtered.filter((m) => m.messageType !== "story_ready");

        // Filter by message type
        if (filterType === "important") {
          // Important = collaboration messages only (decisions, questions, answers, blockers, completions)
          const importantTypes: ContextMessageType[] = [
            "decision",
            "question",
            "answer",
            "blocker",
            "blocker_detected",
            "blocker_resolved",
            "completion",
            "consultation",
            "revision_requested",
            "warning",
            "user_message",
            "worker_ack",
          ];
          filtered = filtered.filter((m) => importantTypes.includes(m.messageType));
        } else if (filterType !== "all") {
          filtered = filtered.filter((m) => m.messageType === filterType);
        }

        return filtered;
      },

      // Get messages for a specific parent task
      getMessagesForParentTask: (parentTaskId: string) => {
        const { messages } = get();
        return messages.filter((m) => m.parentTaskId === parentTaskId);
      },

      // Actions
      addMessage: (msg, parentTaskId) =>
        set((state) => {
          // Avoid duplicates by ID
          if (state.messages.some((m) => m.id === msg.id)) {
            return state;
          }

          // Add parentTaskId to message if provided
          const messageWithParent = parentTaskId
            ? { ...msg, parentTaskId }
            : msg;

          // Also avoid content duplicates within the same parent task and persona
          // (worker sometimes posts the same message multiple times with different IDs)
          const isDuplicateContent = state.messages.some(
            (m) =>
              m.parentTaskId === messageWithParent.parentTaskId &&
              m.persona === messageWithParent.persona &&
              m.messageType === messageWithParent.messageType &&
              m.content === messageWithParent.content
          );
          if (isDuplicateContent) {
            return state;
          }

          const newMessages = [...state.messages, messageWithParent];

          // Sort by createdAt to ensure chronological order
          newMessages.sort(
            (a, b) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );

          // Keep bounded
          const trimmed =
            newMessages.length > MAX_CONTEXT_MESSAGES
              ? newMessages.slice(-MAX_CONTEXT_MESSAGES)
              : newMessages;

          return { messages: trimmed };
        }),

      setMessages: (msgs) => set({ messages: msgs }),

      clearMessages: () => set({ messages: [] }),

      clearMessagesForTask: (parentTaskId: string) =>
        set((state) => ({
          messages: state.messages.filter(
            (m) => m.parentTaskId !== parentTaskId
          ),
        })),

      setParentTaskId: (taskId) => set({ parentTaskId: taskId }),

      setConnected: (connected) => set({ isConnected: connected }),

      setError: (error) => set({ error }),

      setFilterType: (filter) => set({ filterType: filter }),

      setFilterParentTaskId: (taskId) => set({ filterParentTaskId: taskId }),

      toggleCollapsed: () =>
        set((state) => ({ isCollapsed: !state.isCollapsed })),

      setViewMode: (mode) => set({ viewMode: mode }),

      setCollapsed: (collapsed) => set({ isCollapsed: collapsed }),

      addActiveStream: (parentTaskId) =>
        set((state) => ({
          activeStreams: state.activeStreams.includes(parentTaskId)
            ? state.activeStreams
            : [...state.activeStreams, parentTaskId],
        })),

      removeActiveStream: (parentTaskId) =>
        set((state) => ({
          activeStreams: state.activeStreams.filter((id) => id !== parentTaskId),
        })),

      setRetentionDays: (days) => set({ retentionDays: days }),

      // Clean up messages older than retention period
      cleanupOldMessages: () =>
        set((state) => {
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - state.retentionDays);

          const filtered = state.messages.filter(
            (m) => new Date(m.createdAt) > cutoffDate
          );

          // Only update if there were messages to clean
          if (filtered.length !== state.messages.length) {
            return { messages: filtered };
          }
          return state;
        }),

      // Remove duplicate messages (same content within same parent task and persona)
      dedupeMessages: () =>
        set((state) => {
          const seen = new Set<string>();
          const deduped = state.messages.filter((m) => {
            const key = `${m.parentTaskId}|${m.persona}|${m.messageType}|${m.content}`;
            if (seen.has(key)) {
              return false;
            }
            seen.add(key);
            return true;
          });

          if (deduped.length !== state.messages.length) {
            return { messages: deduped };
          }
          return state;
        }),

      reset: () =>
        set({
          messages: [],
          parentTaskId: null,
          activeStreams: [],
          isConnected: false,
          error: null,
          filterType: "important",
          filterParentTaskId: null,
          isCollapsed: false,
        }),
    })),
    {
      name: "workermill-coordination-feed",
      // Only persist recent messages to localStorage (smaller cap for faster load)
      partialize: (state) => ({
        messages: state.messages.slice(-MAX_PERSISTED_MESSAGES),
        retentionDays: state.retentionDays,
      }),
    }
  )
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

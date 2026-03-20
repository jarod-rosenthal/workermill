import React from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { connectToCoordinationStream, disconnectSSE, ConnectionState, subscribeToSSEState } from '@/lib/sse-client';
import { ContextMessage, ContextMessageType } from '@/types/coordination';
import { STORAGE_KEYS } from '@/constants/config';

// Message key for deduplication - based on exact 4-field match rule from spec
type MessageKey = string;

// Generate a unique key for deduplication based on the 4 required fields
const getMessageKey = (message: ContextMessage): MessageKey => {
  return `${message.parent_task_id}|${message.persona}|${message.message_type}|${message.content}`;
};

// Coordination store state interface
interface CoordinationState {
  // Data
  messages: ContextMessage[];
  messageKeys: Set<MessageKey>; // For efficient deduplication lookup
  currentTaskId: string | null; // Currently connected task

  // UI state
  isLoading: boolean;
  error: string | null;
  sseConnected: boolean;

  // Actions
  addMessage: (message: ContextMessage) => void;
  setMessages: (messages: ContextMessage[]) => void;
  clearMessages: () => void;
  setCurrentTaskId: (taskId: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setSseConnected: (connected: boolean) => void;

  // SSE management
  connectToTask: (parentTaskId: string) => void;
  disconnectSSE: () => void;

  // Computed getters
  getMessagesByType: (type: ContextMessageType) => ContextMessage[];
  getMessagesByPersona: (persona: string) => ContextMessage[];
  getRecentMessages: (count?: number) => ContextMessage[];
}

// Maximum message limits
const MAX_MEMORY_MESSAGES = 200;
const MAX_PERSISTED_MESSAGES = 100;

// SSE connection cleanup function
let sseStateUnsubscribe: (() => void) | null = null;

export const useCoordinationStore = create<CoordinationState>()(
  persist(
    (set, get) => ({
      // Initial state
      messages: [],
      messageKeys: new Set(),
      currentTaskId: null,
      isLoading: false,
      error: null,
      sseConnected: false,

      // Add message with deduplication
      addMessage: (message: ContextMessage) => {
        const key = getMessageKey(message);

        // Check if message is duplicate
        if (get().messageKeys.has(key)) {
          console.log('Duplicate coordination message discarded:', { key, message: message.content.substring(0, 50) });
          return;
        }

        set((state) => {
          const newMessages = [...state.messages, message];
          const newKeys = new Set(state.messageKeys).add(key);

          // Apply memory cap - evict oldest messages if exceeded
          if (newMessages.length > MAX_MEMORY_MESSAGES) {
            const messagesToRemove = newMessages.slice(0, newMessages.length - MAX_MEMORY_MESSAGES);
            const remainingMessages = newMessages.slice(-MAX_MEMORY_MESSAGES);

            // Remove keys for evicted messages
            messagesToRemove.forEach((msg) => {
              newKeys.delete(getMessageKey(msg));
            });

            return {
              messages: remainingMessages,
              messageKeys: newKeys,
            };
          }

          return {
            messages: newMessages,
            messageKeys: newKeys,
          };
        });
      },

      setMessages: (messages: ContextMessage[]) => {
        // Rebuild message keys set
        const keys = new Set(messages.map(getMessageKey));

        set({
          messages,
          messageKeys: keys,
        });
      },

      clearMessages: () => {
        set({
          messages: [],
          messageKeys: new Set(),
        });
      },

      setCurrentTaskId: (currentTaskId) => set({ currentTaskId }),
      setLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
      setSseConnected: (sseConnected) => set({ sseConnected }),

      // Connect to coordination stream for a specific task
      connectToTask: (parentTaskId: string) => {
        // Clean up previous connection
        if (sseStateUnsubscribe) {
          sseStateUnsubscribe();
        }

        // Set up SSE state monitoring
        sseStateUnsubscribe = subscribeToSSEState((connectionState) => {
          const isConnected = connectionState === ConnectionState.CONNECTED;
          get().setSseConnected(isConnected);
        });

        // Clear messages when connecting to a different task
        if (get().currentTaskId !== parentTaskId) {
          get().clearMessages();
        }

        set({ currentTaskId: parentTaskId, isLoading: true, error: null });

        // Connect to coordination stream
        connectToCoordinationStream(
          parentTaskId,
          (event) => {
            try {
              const data = JSON.parse(event.data);

              // Handle different SSE event types
              switch (data.type) {
                case 'coordination_message':
                  if (data.message) {
                    get().addMessage(data.message);
                  }
                  break;

                case 'coordination_history':
                  // Full history refresh
                  if (data.messages && Array.isArray(data.messages)) {
                    // Sort messages chronologically (oldest first)
                    const sortedMessages = data.messages.sort((a: ContextMessage, b: ContextMessage) => {
                      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
                    });
                    get().setMessages(sortedMessages);
                  }
                  break;

                default:
                  console.log('Unknown coordination SSE event type:', data.type);
              }

              // Clear loading state on first message
              set({ isLoading: false, error: null });
            } catch (error) {
              console.error('Error parsing coordination SSE message:', error);
              set({ error: 'Failed to parse coordination data' });
            }
          },
          (error) => {
            console.error('Coordination SSE connection error:', error);
            set({
              isLoading: false,
              error: error instanceof Error ? error.message : 'Connection failed',
            });
          }
        );
      },

      // Disconnect from SSE
      disconnectSSE: () => {
        disconnectSSE();
        if (sseStateUnsubscribe) {
          sseStateUnsubscribe();
          sseStateUnsubscribe = null;
        }
        set({
          currentTaskId: null,
          sseConnected: false,
          isLoading: false,
        });
      },

      // Computed getters
      getMessagesByType: (type: ContextMessageType) => {
        return get().messages.filter((message) => message.message_type === type);
      },

      getMessagesByPersona: (persona: string) => {
        return get().messages.filter((message) => message.persona === persona);
      },

      getRecentMessages: (count = 20) => {
        const messages = get().messages;
        // Return most recent messages (already in chronological order)
        return messages.slice(-count);
      },
    }),
    {
      name: STORAGE_KEYS.COORDINATION,
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist data, not loading/error states
      partialize: (state) => {
        // Apply persistence cap - only persist the most recent messages
        const messagesToPersist = state.messages.slice(-MAX_PERSISTED_MESSAGES);

        return {
          messages: messagesToPersist,
          // Don't persist messageKeys set - it will be rebuilt on load
        };
      },
      // Reconstruct messageKeys set on hydration
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Rebuild message keys from persisted messages
          const keys = new Set(state.messages.map(getMessageKey));
          state.messageKeys = keys;
        }
      },
    }
  )
);

// Helper hook to automatically connect to coordination stream for a task
export const useCoordinationSSE = (parentTaskId: string | null) => {
  const { connectToTask, disconnectSSE: disconnect } = useCoordinationStore();

  React.useEffect(() => {
    if (parentTaskId) {
      connectToTask(parentTaskId);
    } else {
      disconnect();
    }

    // Cleanup on unmount or task change
    return () => disconnect();
  }, [parentTaskId, connectToTask, disconnect]);
};

// Export store actions for external use
export const coordinationActions = {
  connectToTask: (parentTaskId: string) => useCoordinationStore.getState().connectToTask(parentTaskId),
  disconnectSSE: () => useCoordinationStore.getState().disconnectSSE(),
  clearMessages: () => useCoordinationStore.getState().clearMessages(),
};
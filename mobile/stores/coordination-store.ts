import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ContextMessage, ContextMessageType } from '@/types/coordination';
import { createCoordinationSSE, SSEClient, SSEEvent } from '@/lib/sse-client';
import { STORAGE_KEYS } from '@/constants/config';

export interface CoordinationState {
  // Data
  messages: ContextMessage[];
  lastUpdated: string | null;

  // Connection state
  isSSEConnected: boolean;
  sseError: string | null;
  currentParentTaskId: string | null;

  // SSE client instance
  sseClient: SSEClient | null;

  // Actions
  connectSSE: (parentTaskId: string, token: string) => void;
  disconnectSSE: () => void;
  addMessage: (message: ContextMessage) => void;
  clearMessages: () => void;

  // Convenience getters
  getMessagesByParentTask: (parentTaskId: string) => ContextMessage[];
  getMessagesByType: (type: ContextMessageType) => ContextMessage[];
  getMessagesByPersona: (persona: string) => ContextMessage[];
}

// Constants for message limits
const MAX_MEMORY_MESSAGES = 200;
const MAX_PERSISTED_MESSAGES = 100;

// Helper function for 4-field deduplication
const isDuplicateMessage = (existingMessages: ContextMessage[], newMessage: ContextMessage): boolean => {
  return existingMessages.some(existing =>
    existing.parentTaskId === newMessage.parentTaskId &&
    existing.persona === newMessage.persona &&
    existing.messageType === newMessage.messageType &&
    existing.content === newMessage.content
  );
};

// Helper function to enforce message limits
const enforceMessageLimits = (messages: ContextMessage[]): { memory: ContextMessage[], persisted: ContextMessage[] } => {
  // Sort by timestamp descending (newest first)
  const sortedMessages = [...messages].sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // Memory messages (newest 200)
  const memoryMessages = sortedMessages.slice(0, MAX_MEMORY_MESSAGES);

  // Persisted messages (newest 100)
  const persistedMessages = sortedMessages.slice(0, MAX_PERSISTED_MESSAGES);

  return { memory: memoryMessages, persisted: persistedMessages };
};

export const useCoordinationStore = create<CoordinationState>()(
  persist(
    (set, get) => ({
      // Initial state
      messages: [],
      lastUpdated: null,
      isSSEConnected: false,
      sseError: null,
      currentParentTaskId: null,
      sseClient: null,

      // Actions
      connectSSE: (parentTaskId: string, token: string) => {
        // Disconnect existing connection if different parent task
        const currentClient = get().sseClient;
        if (currentClient && get().currentParentTaskId !== parentTaskId) {
          get().disconnectSSE();
        }

        // Don't reconnect if already connected to the same parent task
        if (get().currentParentTaskId === parentTaskId && get().isSSEConnected) {
          return;
        }

        const sseClient = createCoordinationSSE(parentTaskId, token, {
          onEvent: (event: SSEEvent) => {
            if (event.type === 'coordination_message') {
              get().addMessage(event.data as ContextMessage);
            }
          },
          onStateChange: (state) => {
            set({
              isSSEConnected: state === 'connected',
              sseError: state === 'error' ? 'Connection failed' : null
            });
          },
          onError: (error) => {
            set({
              sseError: error.message,
              isSSEConnected: false
            });
          }
        });

        set({
          sseClient,
          currentParentTaskId: parentTaskId
        });

        sseClient.connect();
      },

      disconnectSSE: () => {
        const { sseClient } = get();
        if (sseClient) {
          sseClient.destroy();
          set({
            sseClient: null,
            currentParentTaskId: null,
            isSSEConnected: false,
            sseError: null
          });
        }
      },

      addMessage: (message: ContextMessage) => {
        set(state => {
          // Check for duplicates using 4-field comparison
          if (isDuplicateMessage(state.messages, message)) {
            console.log('Discarding duplicate coordination message:', {
              parentTaskId: message.parentTaskId,
              persona: message.persona,
              messageType: message.messageType,
              content: message.content.substring(0, 100) + '...'
            });
            return state; // No change for duplicates
          }

          // Add the new message
          const newMessages = [message, ...state.messages];

          // Enforce limits
          const { memory } = enforceMessageLimits(newMessages);

          return {
            messages: memory,
            lastUpdated: new Date().toISOString()
          };
        });
      },

      clearMessages: () => {
        set({
          messages: [],
          lastUpdated: new Date().toISOString()
        });
      },

      // Convenience getters
      getMessagesByParentTask: (parentTaskId: string) => {
        return get().messages.filter(message => message.parentTaskId === parentTaskId);
      },

      getMessagesByType: (type: ContextMessageType) => {
        return get().messages.filter(message => message.messageType === type);
      },

      getMessagesByPersona: (persona: string) => {
        return get().messages.filter(message => message.persona === persona);
      },
    }),
    {
      name: STORAGE_KEYS.COORDINATION,
      storage: createJSONStorage(() => AsyncStorage),
      // Custom partialize to enforce persisted message limit
      partialize: (state) => {
        const { persisted } = enforceMessageLimits(state.messages);
        return {
          messages: persisted,
          lastUpdated: state.lastUpdated,
        };
      },
      // Custom onRehydrateStorage to enforce memory limit on load
      onRehydrateStorage: () => (state) => {
        if (state && state.messages) {
          const { memory } = enforceMessageLimits(state.messages);
          state.messages = memory;
        }
      },
    }
  )
);
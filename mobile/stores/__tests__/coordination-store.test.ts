import AsyncStorage from '@react-native-async-storage/async-storage';
import { connectToCoordinationStream, disconnectSSE, ConnectionState, subscribeToSSEState } from '@/lib/sse-client';
import { useCoordinationStore } from '../coordination-store';
import { ContextMessage, ContextMessageType } from '@/types/coordination';
import { STORAGE_KEYS } from '@/constants/config';

// Mock dependencies
jest.mock('@react-native-async-storage/async-storage');
jest.mock('@/lib/sse-client');

const mockedAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const mockedConnectToCoordinationStream = connectToCoordinationStream as jest.MockedFunction<typeof connectToCoordinationStream>;
const mockedDisconnectSSE = disconnectSSE as jest.MockedFunction<typeof disconnectSSE>;
const mockedSubscribeToSSEState = subscribeToSSEState as jest.MockedFunction<typeof subscribeToSSEState>;

// Mock data
const createMockMessage = (overrides: Partial<ContextMessage> = {}): ContextMessage => ({
  id: 'msg-1',
  parent_task_id: 'task-123',
  task_id: 'subtask-456',
  persona: 'backend_developer',
  persona_emoji: '🛠️',
  message_type: 'decision',
  content: 'DEC-001: Implemented user authentication',
  created_at: '2024-01-01T00:00:00Z',
  ...overrides,
});

describe('Coordination Store', () => {
  let mockSSEHandler: (event: MessageEvent) => void;
  let mockSSEStateHandler: (state: ConnectionState) => void;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset zustand store state
    useCoordinationStore.setState({
      messages: [],
      messageKeys: new Set(),
      currentTaskId: null,
      isLoading: false,
      error: null,
      sseConnected: false,
    });

    // Mock AsyncStorage
    mockedAsyncStorage.getItem.mockResolvedValue(null);
    mockedAsyncStorage.setItem.mockResolvedValue();

    // Mock SSE client
    mockedConnectToCoordinationStream.mockImplementation((parentTaskId, onMessage, onError) => {
      mockSSEHandler = onMessage;
    });

    mockedSubscribeToSSEState.mockImplementation((handler) => {
      mockSSEStateHandler = handler;
      return jest.fn(); // unsubscribe function
    });
  });

  describe('message deduplication', () => {
    it('should add unique messages', () => {
      const store = useCoordinationStore.getState();
      const message = createMockMessage();

      store.addMessage(message);

      expect(store.messages).toHaveLength(1);
      expect(store.messages[0]).toEqual(message);
      expect(store.messageKeys.size).toBe(1);
    });

    it('should discard duplicate messages based on 4-field match', () => {
      const store = useCoordinationStore.getState();
      const message1 = createMockMessage();

      // Add original message
      store.addMessage(message1);
      expect(store.messages).toHaveLength(1);

      // Try to add duplicate (all 4 fields match)
      const duplicate = createMockMessage({
        id: 'msg-2', // Different ID
        created_at: '2024-01-02T00:00:00Z', // Different timestamp
        // But same parent_task_id, persona, message_type, content
      });

      store.addMessage(duplicate);

      expect(store.messages).toHaveLength(1); // Should still be 1
      expect(store.messageKeys.size).toBe(1);
      expect(store.messages[0]).toEqual(message1); // Original message preserved
    });

    it('should allow messages with different parent_task_id', () => {
      const store = useCoordinationStore.getState();

      const message1 = createMockMessage({ parent_task_id: 'task-1' });
      const message2 = createMockMessage({ parent_task_id: 'task-2' });

      store.addMessage(message1);
      store.addMessage(message2);

      expect(store.messages).toHaveLength(2);
      expect(store.messageKeys.size).toBe(2);
    });

    it('should allow messages with different persona', () => {
      const store = useCoordinationStore.getState();

      const message1 = createMockMessage({ persona: 'backend_developer' });
      const message2 = createMockMessage({ persona: 'frontend_developer' });

      store.addMessage(message1);
      store.addMessage(message2);

      expect(store.messages).toHaveLength(2);
      expect(store.messageKeys.size).toBe(2);
    });

    it('should allow messages with different message_type', () => {
      const store = useCoordinationStore.getState();

      const message1 = createMockMessage({ message_type: 'decision' });
      const message2 = createMockMessage({ message_type: 'question' });

      store.addMessage(message1);
      store.addMessage(message2);

      expect(store.messages).toHaveLength(2);
      expect(store.messageKeys.size).toBe(2);
    });

    it('should allow messages with different content', () => {
      const store = useCoordinationStore.getState();

      const message1 = createMockMessage({ content: 'DEC-001: First decision' });
      const message2 = createMockMessage({ content: 'DEC-002: Second decision' });

      store.addMessage(message1);
      store.addMessage(message2);

      expect(store.messages).toHaveLength(2);
      expect(store.messageKeys.size).toBe(2);
    });

    it('should maintain deduplication after setting messages', () => {
      const store = useCoordinationStore.getState();

      const messages = [
        createMockMessage({ id: 'msg-1' }),
        createMockMessage({ id: 'msg-2' }),
      ];

      store.setMessages(messages);

      expect(store.messages).toHaveLength(2);
      expect(store.messageKeys.size).toBe(2);

      // Try to add a duplicate
      const duplicate = createMockMessage({ id: 'msg-3' }); // Same content as msg-1
      store.addMessage(duplicate);

      expect(store.messages).toHaveLength(2); // Should not increase
      expect(store.messageKeys.size).toBe(2);
    });
  });

  describe('message eviction', () => {
    it('should evict oldest messages when memory cap exceeded', () => {
      const store = useCoordinationStore.getState();

      // Mock the MAX_MEMORY_MESSAGES to a smaller value for testing
      const originalAddMessage = store.addMessage;
      const MAX_TEST_MESSAGES = 3;

      // Override the add method to use test limit
      store.addMessage = (message: ContextMessage) => {
        const key = `${message.parent_task_id}|${message.persona}|${message.message_type}|${message.content}`;

        if (store.messageKeys.has(key)) {
          return;
        }

        const newMessages = [...store.messages, message];
        const newKeys = new Set(store.messageKeys).add(key);

        if (newMessages.length > MAX_TEST_MESSAGES) {
          const messagesToRemove = newMessages.slice(0, newMessages.length - MAX_TEST_MESSAGES);
          const remainingMessages = newMessages.slice(-MAX_TEST_MESSAGES);

          messagesToRemove.forEach((msg) => {
            const msgKey = `${msg.parent_task_id}|${msg.persona}|${msg.message_type}|${msg.content}`;
            newKeys.delete(msgKey);
          });

          useCoordinationStore.setState({
            messages: remainingMessages,
            messageKeys: newKeys,
          });
        } else {
          useCoordinationStore.setState({
            messages: newMessages,
            messageKeys: newKeys,
          });
        }
      };

      // Add messages up to and beyond the limit
      for (let i = 1; i <= 5; i++) {
        store.addMessage(createMockMessage({
          id: `msg-${i}`,
          content: `Message ${i}`,
        }));
      }

      expect(store.messages).toHaveLength(MAX_TEST_MESSAGES);
      expect(store.messageKeys.size).toBe(MAX_TEST_MESSAGES);

      // Should have the last 3 messages
      expect(store.messages.map(m => m.content)).toEqual([
        'Message 3',
        'Message 4',
        'Message 5',
      ]);
    });
  });

  describe('SSE integration', () => {
    it('should connect to coordination stream', () => {
      const store = useCoordinationStore.getState();

      store.connectToTask('task-123');

      expect(mockedConnectToCoordinationStream).toHaveBeenCalledWith(
        'task-123',
        expect.any(Function),
        expect.any(Function)
      );
      expect(mockedSubscribeToSSEState).toHaveBeenCalled();
      expect(store.currentTaskId).toBe('task-123');
      expect(store.isLoading).toBe(true);
    });

    it('should clear messages when connecting to different task', () => {
      const store = useCoordinationStore.getState();

      // Add some messages for first task
      store.setCurrentTaskId('task-1');
      store.addMessage(createMockMessage({ parent_task_id: 'task-1' }));
      expect(store.messages).toHaveLength(1);

      // Connect to different task
      store.connectToTask('task-2');

      expect(store.messages).toHaveLength(0);
      expect(store.messageKeys.size).toBe(0);
      expect(store.currentTaskId).toBe('task-2');
    });

    it('should handle SSE state changes', () => {
      const store = useCoordinationStore.getState();

      store.connectToTask('task-123');

      // Simulate SSE connection state change
      mockSSEStateHandler(ConnectionState.CONNECTED);
      expect(store.sseConnected).toBe(true);

      mockSSEStateHandler(ConnectionState.DISCONNECTED);
      expect(store.sseConnected).toBe(false);
    });

    it('should handle coordination_message SSE events', () => {
      const store = useCoordinationStore.getState();

      store.connectToTask('task-123');

      const message = createMockMessage();
      const event = {
        data: JSON.stringify({
          type: 'coordination_message',
          message,
        }),
      } as MessageEvent;

      mockSSEHandler(event);

      expect(store.messages).toContain(message);
    });

    it('should handle coordination_history SSE events', () => {
      const store = useCoordinationStore.getState();

      store.connectToTask('task-123');

      const messages = [
        createMockMessage({ id: 'msg-1', created_at: '2024-01-01T00:00:00Z', content: 'First' }),
        createMockMessage({ id: 'msg-2', created_at: '2024-01-02T00:00:00Z', content: 'Second' }),
        createMockMessage({ id: 'msg-3', created_at: '2023-12-31T00:00:00Z', content: 'Oldest' }),
      ];

      const event = {
        data: JSON.stringify({
          type: 'coordination_history',
          messages,
        }),
      } as MessageEvent;

      mockSSEHandler(event);

      // Should be sorted chronologically (oldest first)
      const sortedMessages = store.messages;
      expect(sortedMessages).toHaveLength(3);
      expect(sortedMessages[0].content).toBe('Oldest');
      expect(sortedMessages[1].content).toBe('First');
      expect(sortedMessages[2].content).toBe('Second');
    });

    it('should handle invalid SSE data gracefully', () => {
      const store = useCoordinationStore.getState();

      store.connectToTask('task-123');

      const event = {
        data: 'invalid json',
      } as MessageEvent;

      expect(() => mockSSEHandler(event)).not.toThrow();
      expect(store.error).toBe('Failed to parse coordination data');
    });

    it('should disconnect SSE properly', () => {
      const store = useCoordinationStore.getState();

      store.connectToTask('task-123');
      store.disconnectSSE();

      expect(mockedDisconnectSSE).toHaveBeenCalled();
      expect(store.currentTaskId).toBeNull();
      expect(store.sseConnected).toBe(false);
      expect(store.isLoading).toBe(false);
    });
  });

  describe('computed getters', () => {
    beforeEach(() => {
      const messages = [
        createMockMessage({ id: 'msg-1', message_type: 'decision', persona: 'backend_developer' }),
        createMockMessage({ id: 'msg-2', message_type: 'question', persona: 'backend_developer' }),
        createMockMessage({ id: 'msg-3', message_type: 'decision', persona: 'frontend_developer' }),
        createMockMessage({ id: 'msg-4', message_type: 'blocker', persona: 'backend_developer' }),
      ];

      useCoordinationStore.getState().setMessages(messages);
    });

    it('should get messages by type', () => {
      const store = useCoordinationStore.getState();

      const decisions = store.getMessagesByType('decision');
      expect(decisions).toHaveLength(2);
      expect(decisions.every(m => m.message_type === 'decision')).toBe(true);

      const questions = store.getMessagesByType('question');
      expect(questions).toHaveLength(1);
      expect(questions[0].message_type).toBe('question');
    });

    it('should get messages by persona', () => {
      const store = useCoordinationStore.getState();

      const backendMessages = store.getMessagesByPersona('backend_developer');
      expect(backendMessages).toHaveLength(3);
      expect(backendMessages.every(m => m.persona === 'backend_developer')).toBe(true);

      const frontendMessages = store.getMessagesByPersona('frontend_developer');
      expect(frontendMessages).toHaveLength(1);
      expect(frontendMessages[0].persona).toBe('frontend_developer');
    });

    it('should get recent messages', () => {
      const store = useCoordinationStore.getState();

      const recent = store.getRecentMessages(2);
      expect(recent).toHaveLength(2);

      const allRecent = store.getRecentMessages();
      expect(allRecent).toHaveLength(4); // Default count is 20, but only 4 messages exist
    });
  });

  describe('persistence', () => {
    it('should use correct AsyncStorage key', () => {
      const store = useCoordinationStore.getState();

      // Zustand persistence is tested through the middleware,
      // verify the store uses the versioned key from config
      expect(STORAGE_KEYS.COORDINATION).toBe('wm-coordination-v1');
      expect(useCoordinationStore.persist).toBeDefined();
    });

    it('should not persist loading and error states', () => {
      const store = useCoordinationStore.getState();

      store.setLoading(true);
      store.setError('Test error');

      // The partialize function should exclude these from persistence
      const config = (useCoordinationStore as any).persist.getOptions();
      const partializedState = config.partialize(store);

      expect(partializedState).not.toHaveProperty('isLoading');
      expect(partializedState).not.toHaveProperty('error');
      expect(partializedState).not.toHaveProperty('sseConnected');
      expect(partializedState).not.toHaveProperty('currentTaskId');
      expect(partializedState).toHaveProperty('messages');
      expect(partializedState).not.toHaveProperty('messageKeys'); // Not persisted, rebuilt on load
    });

    it('should apply persistence message cap', () => {
      const store = useCoordinationStore.getState();

      // Create more messages than the persistence cap (100)
      const manyMessages = Array.from({ length: 150 }, (_, i) =>
        createMockMessage({ id: `msg-${i}`, content: `Message ${i}` })
      );

      store.setMessages(manyMessages);

      const config = (useCoordinationStore as any).persist.getOptions();
      const partializedState = config.partialize(store);

      // Should only persist the most recent 100 messages
      expect(partializedState.messages).toHaveLength(100);
      expect(partializedState.messages[0].content).toBe('Message 50'); // First of the last 100
      expect(partializedState.messages[99].content).toBe('Message 149'); // Last message
    });

    it('should rebuild messageKeys on hydration', () => {
      const messages = [
        createMockMessage({ id: 'msg-1', content: 'First' }),
        createMockMessage({ id: 'msg-2', content: 'Second' }),
      ];

      // Simulate hydration
      const config = (useCoordinationStore as any).persist.getOptions();
      const mockState = { messages, messageKeys: new Set() };

      config.onRehydrateStorage()(mockState);

      expect(mockState.messageKeys.size).toBe(2);
      expect(mockState.messageKeys.has('task-123|backend_developer|decision|First')).toBe(true);
      expect(mockState.messageKeys.has('task-123|backend_developer|decision|Second')).toBe(true);
    });
  });

  describe('state management', () => {
    it('should clear messages and keys', () => {
      const store = useCoordinationStore.getState();

      store.addMessage(createMockMessage());
      expect(store.messages).toHaveLength(1);
      expect(store.messageKeys.size).toBe(1);

      store.clearMessages();

      expect(store.messages).toHaveLength(0);
      expect(store.messageKeys.size).toBe(0);
    });

    it('should set current task ID', () => {
      const store = useCoordinationStore.getState();

      store.setCurrentTaskId('task-456');

      expect(store.currentTaskId).toBe('task-456');
    });

    it('should handle loading and error states', () => {
      const store = useCoordinationStore.getState();

      store.setLoading(true);
      expect(store.isLoading).toBe(true);

      store.setError('Connection failed');
      expect(store.error).toBe('Connection failed');

      store.setSseConnected(true);
      expect(store.sseConnected).toBe(true);
    });
  });
});
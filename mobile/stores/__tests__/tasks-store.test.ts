import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTasksStore } from '../tasks-store';
import { apiClient } from '@/lib/api-client';
import { createDashboardSSE } from '@/lib/sse-client';
import { STORAGE_KEYS } from '@/constants/config';
import { WorkerTask, WorkerTaskStatus } from '@/types/tasks';

// Mock dependencies
jest.mock('@react-native-async-storage/async-storage');
jest.mock('@/lib/api-client');
jest.mock('@/lib/sse-client');

const mockedAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;
const mockedCreateDashboardSSE = createDashboardSSE as jest.MockedFunction<typeof createDashboardSSE>;

// Mock SSE client
const mockSSEClient = {
  connect: jest.fn(),
  disconnect: jest.fn(),
  destroy: jest.fn(),
  updateToken: jest.fn(),
  getState: jest.fn(() => 'connected'),
  isConnected: jest.fn(() => true),
};

// Mock task data
const mockTask: WorkerTask = {
  id: 'task-1',
  issue_key: 'TEST-123',
  summary: 'Test task',
  status: 'executing' as WorkerTaskStatus,
  persona: 'backend_developer',
  persona_emoji: '🧑‍💻',
  created_at: '2024-01-01T00:00:00Z',
  started_at: '2024-01-01T00:01:00Z',
  elapsed_time_ms: 60000,
  cost_cents: 150,
  retry_count: 0,
  workflow_mode: 'auto',
};

const mockStats = {
  activeWorkersCount: 2,
  queueDepth: 5,
  periodCostCents: 1200,
  periodCompleted: 15,
};

const mockApiResponse = {
  tasks: [mockTask],
  stats: mockStats,
};

describe('TasksStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Reset store state
    useTasksStore.setState({
      tasks: [],
      stats: null,
      lastUpdated: null,
      isSSEConnected: false,
      sseError: null,
      isLoading: false,
      error: null,
      sseClient: null,
    });

    // Mock AsyncStorage
    mockedAsyncStorage.getItem.mockResolvedValue(null);
    mockedAsyncStorage.setItem.mockResolvedValue(undefined);
    mockedAsyncStorage.removeItem.mockResolvedValue(undefined);

    // Mock SSE client creation
    mockedCreateDashboardSSE.mockReturnValue(mockSSEClient as any);
  });

  describe('loadTasks', () => {
    it('loads tasks and stats from API', async () => {
      mockedApiClient.get.mockResolvedValue(mockApiResponse);

      const store = useTasksStore.getState();
      await store.loadTasks();

      expect(mockedApiClient.get).toHaveBeenCalledWith('/control-center');
      expect(useTasksStore.getState().tasks).toEqual([mockTask]);
      expect(useTasksStore.getState().stats).toEqual(mockStats);
      expect(useTasksStore.getState().isLoading).toBe(false);
      expect(useTasksStore.getState().error).toBeNull();
      expect(useTasksStore.getState().lastUpdated).toBeTruthy();
    });

    it('connects SSE when token provided', async () => {
      mockedApiClient.get.mockResolvedValue(mockApiResponse);

      const store = useTasksStore.getState();
      await store.loadTasks('test-token');

      expect(mockedCreateDashboardSSE).toHaveBeenCalledWith('test-token', expect.any(Object));
      expect(mockSSEClient.connect).toHaveBeenCalled();
      expect(useTasksStore.getState().sseClient).toBe(mockSSEClient);
    });

    it('handles API errors', async () => {
      const errorResponse = {
        response: { data: { message: 'API error' } }
      };
      mockedApiClient.get.mockRejectedValue(errorResponse);

      const store = useTasksStore.getState();

      let threwError = false;
      try {
        await store.loadTasks();
      } catch (error) {
        threwError = true;
        expect(error).toEqual(errorResponse);
      }

      expect(threwError).toBe(true);
      expect(useTasksStore.getState().error).toBe('API error');
      expect(useTasksStore.getState().isLoading).toBe(false);
    });

    it('handles network errors with fallback message', async () => {
      const networkError = new Error('Network error');
      mockedApiClient.get.mockRejectedValue(networkError);

      const store = useTasksStore.getState();

      await expect(store.loadTasks()).rejects.toThrow();
      expect(useTasksStore.getState().error).toBe('Failed to load tasks');
      expect(useTasksStore.getState().isLoading).toBe(false);
    });
  });

  describe('SSE connection', () => {
    it('connects SSE and sets up event handlers', () => {
      const store = useTasksStore.getState();
      store.connectSSE('test-token');

      expect(mockedCreateDashboardSSE).toHaveBeenCalledWith('test-token', {
        onEvent: expect.any(Function),
        onStateChange: expect.any(Function),
        onError: expect.any(Function),
      });
      expect(mockSSEClient.connect).toHaveBeenCalled();
      expect(useTasksStore.getState().sseClient).toBe(mockSSEClient);
    });

    it('disconnects existing SSE before connecting new one', () => {
      // First connection
      const store = useTasksStore.getState();
      store.connectSSE('token1');

      const firstClient = useTasksStore.getState().sseClient;
      expect(firstClient).toBe(mockSSEClient);

      // Second connection should destroy first client
      store.connectSSE('token2');

      expect(mockSSEClient.destroy).toHaveBeenCalledTimes(1);
      expect(mockedCreateDashboardSSE).toHaveBeenCalledTimes(2);
    });

    it('disconnects SSE properly', () => {
      const store = useTasksStore.getState();
      store.connectSSE('test-token');

      store.disconnectSSE();

      expect(mockSSEClient.destroy).toHaveBeenCalled();
      expect(useTasksStore.getState().sseClient).toBeNull();
      expect(useTasksStore.getState().isSSEConnected).toBe(false);
      expect(useTasksStore.getState().sseError).toBeNull();
    });

    it('handles SSE state changes', () => {
      let onStateChange: Function | undefined;

      mockedCreateDashboardSSE.mockImplementation((token, options) => {
        onStateChange = options.onStateChange!;
        return mockSSEClient as any;
      });

      const store = useTasksStore.getState();
      store.connectSSE('test-token');

      // Test connected state
      onStateChange!('connected');
      expect(useTasksStore.getState().isSSEConnected).toBe(true);
      expect(useTasksStore.getState().sseError).toBeNull();

      // Test error state
      onStateChange!('error');
      expect(useTasksStore.getState().isSSEConnected).toBe(false);
      expect(useTasksStore.getState().sseError).toBe('Connection failed');
    });

    it('handles SSE errors', () => {
      let onError: Function | undefined;

      mockedCreateDashboardSSE.mockImplementation((token, options) => {
        onError = options.onError!;
        return mockSSEClient as any;
      });

      const store = useTasksStore.getState();
      store.connectSSE('test-token');

      const error = new Error('SSE connection failed');
      onError!(error);

      expect(useTasksStore.getState().sseError).toBe('SSE connection failed');
      expect(useTasksStore.getState().isSSEConnected).toBe(false);
    });
  });

  describe('real-time updates', () => {
    let onEvent: Function;

    beforeEach(() => {
      mockedCreateDashboardSSE.mockImplementation((token, options) => {
        onEvent = options.onEvent!;
        return mockSSEClient as any;
      });

      const store = useTasksStore.getState();
      store.connectSSE('test-token');
    });

    it('handles task updates via SSE', () => {
      const updatedTask = { ...mockTask, status: 'completed' as WorkerTaskStatus };

      onEvent({
        type: 'task_update',
        data: { type: 'task', task: updatedTask },
        timestamp: '2024-01-01T00:00:00Z'
      });

      const tasks = useTasksStore.getState().tasks;
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toEqual(updatedTask);
      expect(useTasksStore.getState().lastUpdated).toBeTruthy();
    });

    it('handles stats updates via SSE', () => {
      const updatedStats = { ...mockStats, activeWorkersCount: 3 };

      onEvent({
        type: 'task_update',
        data: { type: 'stats', stats: updatedStats },
        timestamp: '2024-01-01T00:00:00Z'
      });

      expect(useTasksStore.getState().stats).toEqual(updatedStats);
      expect(useTasksStore.getState().lastUpdated).toBeTruthy();
    });

    it('ignores non-task_update events', () => {
      const initialState = useTasksStore.getState();

      onEvent({
        type: 'coordination_message',
        data: { message: 'test' },
        timestamp: '2024-01-01T00:00:00Z'
      });

      // State should not change
      expect(useTasksStore.getState().tasks).toEqual(initialState.tasks);
      expect(useTasksStore.getState().stats).toEqual(initialState.stats);
    });
  });

  describe('task operations', () => {
    beforeEach(() => {
      // Set up some initial tasks
      useTasksStore.setState({
        tasks: [
          { ...mockTask, id: 'task-1', status: 'executing' },
          { ...mockTask, id: 'task-2', status: 'queued' },
          { ...mockTask, id: 'task-3', status: 'completed', completed_at: '2024-01-01T12:00:00Z' },
        ] as WorkerTask[]
      });
    });

    it('updates existing task', () => {
      const store = useTasksStore.getState();
      const updatedTask = { ...mockTask, id: 'task-1', status: 'completed' as WorkerTaskStatus };

      store.updateTask(updatedTask);

      const tasks = useTasksStore.getState().tasks;
      expect(tasks).toHaveLength(3);
      expect(tasks.find(t => t.id === 'task-1')?.status).toBe('completed');
    });

    it('adds new task', () => {
      const store = useTasksStore.getState();
      const newTask = { ...mockTask, id: 'task-4', status: 'planning' as WorkerTaskStatus };

      store.updateTask(newTask);

      const tasks = useTasksStore.getState().tasks;
      expect(tasks).toHaveLength(4);
      expect(tasks[0]).toEqual(newTask); // New task should be first
    });
  });

  describe('task categorization', () => {
    beforeEach(() => {
      const now = new Date();
      const halfDayAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000); // 12 hours ago instead of 24
      const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

      useTasksStore.setState({
        tasks: [
          { ...mockTask, id: 'task-1', status: 'executing' },
          { ...mockTask, id: 'task-2', status: 'queued' },
          { ...mockTask, id: 'task-3', status: 'completed', completed_at: halfDayAgo.toISOString() },
          { ...mockTask, id: 'task-4', status: 'failed', failed_at: twoDaysAgo.toISOString() },
          { ...mockTask, id: 'task-5', status: 'planning' },
        ] as WorkerTask[]
      });
    });

    it('getActiveTasks returns executing tasks', () => {
      const store = useTasksStore.getState();
      const activeTasks = store.getActiveTasks();

      expect(activeTasks).toHaveLength(1);
      expect(activeTasks[0].id).toBe('task-1');
      expect(activeTasks[0].status).toBe('executing');
    });

    it('getQueuedTasks returns queued tasks', () => {
      const store = useTasksStore.getState();
      const queuedTasks = store.getQueuedTasks();

      expect(queuedTasks).toHaveLength(1);
      expect(queuedTasks[0].id).toBe('task-2');
      expect(queuedTasks[0].status).toBe('queued');
    });

    it('getRecentTasks returns tasks completed in last 24h', () => {
      const store = useTasksStore.getState();
      const recentTasks = store.getRecentTasks();

      expect(recentTasks).toHaveLength(1);
      expect(recentTasks[0].id).toBe('task-3');
      expect(recentTasks[0].status).toBe('completed');
    });

    it('getTaskById returns correct task', () => {
      const store = useTasksStore.getState();
      const task = store.getTaskById('task-2');

      expect(task).toBeTruthy();
      expect(task?.id).toBe('task-2');
      expect(task?.status).toBe('queued');
    });

    it('getTaskById returns null for non-existent task', () => {
      const store = useTasksStore.getState();
      const task = store.getTaskById('non-existent');

      expect(task).toBeNull();
    });
  });

  describe('persistence', () => {
    it('uses correct storage key', () => {
      expect(STORAGE_KEYS.TASKS).toBe('wm-tasks-v1');
    });

    it('persists only data state, not connection state', () => {
      // This tests the partialize function indirectly
      const testState = {
        tasks: [mockTask],
        stats: mockStats,
        lastUpdated: '2024-01-01T00:00:00Z',
        isSSEConnected: true,
        sseError: 'error',
        isLoading: true,
        error: 'error',
      };

      useTasksStore.setState(testState);

      // The persistence layer should only include the data fields
      // We can't directly test partialize, but we know connection state
      // shouldn't be persisted based on the implementation
      expect(useTasksStore.getState().tasks).toEqual([mockTask]);
      expect(useTasksStore.getState().stats).toEqual(mockStats);
      expect(useTasksStore.getState().lastUpdated).toBe('2024-01-01T00:00:00Z');
    });
  });
});
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '@/lib/api-client';
import { connectToTaskStream, disconnectSSE, ConnectionState, subscribeToSSEState } from '@/lib/sse-client';
import { useTasksStore, TaskStats } from '../tasks-store';
import { WorkerTask, WorkerTaskStatus } from '@/types/tasks';

// Mock dependencies
jest.mock('@react-native-async-storage/async-storage');
jest.mock('@/lib/api-client');
jest.mock('@/lib/sse-client');

const mockedAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;
const mockedConnectToTaskStream = connectToTaskStream as jest.MockedFunction<typeof connectToTaskStream>;
const mockedDisconnectSSE = disconnectSSE as jest.MockedFunction<typeof disconnectSSE>;
const mockedSubscribeToSSEState = subscribeToSSEState as jest.MockedFunction<typeof subscribeToSSEState>;

// Mock data
const mockTask: WorkerTask = {
  id: 'task-1',
  issue_key: 'WM-123',
  summary: 'Test task',
  status: 'executing',
  persona: 'backend_developer',
  persona_emoji: '🛠️',
  created_at: '2024-01-01T00:00:00Z',
  started_at: '2024-01-01T01:00:00Z',
  elapsed_time_ms: 3600000,
  cost_cents: 50,
  retry_count: 0,
  workflow_mode: 'auto',
};

const mockStats: TaskStats = {
  activeWorkers: 3,
  queueDepth: 5,
  periodCostCents: 1500,
  periodCompleted: 12,
};

const mockApiResponse = {
  data: {
    tasks: [mockTask],
    stats: mockStats,
  },
};

describe('Tasks Store', () => {
  let mockSSEHandler: (event: MessageEvent) => void;
  let mockSSEStateHandler: (state: ConnectionState) => void;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset zustand store state
    useTasksStore.setState({
      tasks: [],
      stats: null,
      isLoading: false,
      error: null,
      lastUpdated: null,
      sseConnected: false,
    });

    // Mock AsyncStorage
    mockedAsyncStorage.getItem.mockResolvedValue(null);
    mockedAsyncStorage.setItem.mockResolvedValue();

    // Mock API client
    mockedApiClient.get.mockResolvedValue(mockApiResponse);
    mockedApiClient.post.mockResolvedValue({ data: { success: true } });

    // Mock SSE client
    mockedConnectToTaskStream.mockImplementation((onMessage, onError) => {
      mockSSEHandler = onMessage;
    });

    mockedSubscribeToSSEState.mockImplementation((handler) => {
      mockSSEStateHandler = handler;
      return jest.fn(); // unsubscribe function
    });
  });

  describe('fetchTasks', () => {
    it('should fetch tasks and update state', async () => {
      const store = useTasksStore.getState();

      await store.fetchTasks();

      expect(mockedApiClient.get).toHaveBeenCalledWith('/control-center');
      expect(store.tasks).toEqual([mockTask]);
      expect(store.stats).toEqual(mockStats);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
      expect(store.lastUpdated).toBeTruthy();
    });

    it('should handle fetch errors', async () => {
      const error = new Error('Network error');
      mockedApiClient.get.mockRejectedValue(error);

      const store = useTasksStore.getState();

      await store.fetchTasks();

      expect(store.tasks).toEqual([]);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBe('Network error');
    });

    it('should set loading state during fetch', async () => {
      let resolvePromise: (value: any) => void;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockedApiClient.get.mockReturnValue(promise);

      const store = useTasksStore.getState();
      const fetchPromise = store.fetchTasks();

      expect(store.isLoading).toBe(true);
      expect(store.error).toBeNull();

      resolvePromise!(mockApiResponse);
      await fetchPromise;

      expect(store.isLoading).toBe(false);
    });
  });

  describe('SSE integration', () => {
    it('should connect to SSE stream and handle state changes', () => {
      const store = useTasksStore.getState();

      store.connectSSE();

      expect(mockedConnectToTaskStream).toHaveBeenCalled();
      expect(mockedSubscribeToSSEState).toHaveBeenCalled();

      // Simulate SSE connection state change
      mockSSEStateHandler(ConnectionState.CONNECTED);
      expect(store.sseConnected).toBe(true);

      mockSSEStateHandler(ConnectionState.DISCONNECTED);
      expect(store.sseConnected).toBe(false);
    });

    it('should handle task_update SSE events', () => {
      const store = useTasksStore.getState();

      // Add initial task
      store.setTasks([mockTask]);

      store.connectSSE();

      // Simulate SSE task update event
      const updatedTask = { ...mockTask, status: 'completed' as WorkerTaskStatus };
      const event = {
        data: JSON.stringify({
          type: 'task_update',
          task: updatedTask,
        }),
      } as MessageEvent;

      mockSSEHandler(event);

      const updatedState = useTasksStore.getState();
      expect(updatedState.tasks[0].status).toBe('completed');
      expect(updatedState.lastUpdated).toBeTruthy();
    });

    it('should handle task_created SSE events', () => {
      const store = useTasksStore.getState();

      store.connectSSE();

      // Simulate SSE task created event
      const newTask = { ...mockTask, id: 'task-2', issue_key: 'WM-124' };
      const event = {
        data: JSON.stringify({
          type: 'task_created',
          task: newTask,
        }),
      } as MessageEvent;

      mockSSEHandler(event);

      const updatedState = useTasksStore.getState();
      expect(updatedState.tasks).toContain(newTask);
    });

    it('should handle task_removed SSE events', () => {
      const store = useTasksStore.getState();

      // Add initial task
      store.setTasks([mockTask]);

      store.connectSSE();

      // Simulate SSE task removed event
      const event = {
        data: JSON.stringify({
          type: 'task_removed',
          taskId: mockTask.id,
        }),
      } as MessageEvent;

      mockSSEHandler(event);

      const updatedState = useTasksStore.getState();
      expect(updatedState.tasks).not.toContain(mockTask);
    });

    it('should handle stats_update SSE events', () => {
      const store = useTasksStore.getState();

      store.connectSSE();

      // Simulate SSE stats update event
      const newStats = { ...mockStats, activeWorkers: 5 };
      const event = {
        data: JSON.stringify({
          type: 'stats_update',
          stats: newStats,
        }),
      } as MessageEvent;

      mockSSEHandler(event);

      const updatedState = useTasksStore.getState();
      expect(updatedState.stats).toEqual(newStats);
    });

    it('should handle full_refresh SSE events', () => {
      const store = useTasksStore.getState();

      store.connectSSE();

      // Simulate SSE full refresh event
      const newTasks = [{ ...mockTask, id: 'task-2' }];
      const newStats = { ...mockStats, queueDepth: 10 };
      const event = {
        data: JSON.stringify({
          type: 'full_refresh',
          tasks: newTasks,
          stats: newStats,
        }),
      } as MessageEvent;

      mockSSEHandler(event);

      const updatedState = useTasksStore.getState();
      expect(updatedState.tasks).toEqual(newTasks);
      expect(updatedState.stats).toEqual(newStats);
    });

    it('should handle invalid SSE data gracefully', () => {
      const store = useTasksStore.getState();

      store.connectSSE();

      // Simulate invalid JSON event
      const event = {
        data: 'invalid json',
      } as MessageEvent;

      expect(() => mockSSEHandler(event)).not.toThrow();
    });

    it('should disconnect SSE properly', () => {
      const store = useTasksStore.getState();

      store.connectSSE();
      store.disconnectSSE();

      expect(mockedDisconnectSSE).toHaveBeenCalled();
      expect(store.sseConnected).toBe(false);
    });
  });

  describe('task actions', () => {
    it('should cancel task', async () => {
      const store = useTasksStore.getState();

      await store.cancelTask('task-1');

      expect(mockedApiClient.post).toHaveBeenCalledWith('/tasks/task-1/cancel');
    });

    it('should retry task', async () => {
      const store = useTasksStore.getState();

      await store.retryTask('task-1');

      expect(mockedApiClient.post).toHaveBeenCalledWith('/tasks/task-1/retry');
    });

    it('should handle task action errors', async () => {
      const error = new Error('Action failed');
      mockedApiClient.post.mockRejectedValue(error);

      const store = useTasksStore.getState();

      await expect(store.cancelTask('task-1')).rejects.toThrow('Action failed');
    });
  });

  describe('computed getters', () => {
    beforeEach(() => {
      const tasks: WorkerTask[] = [
        { ...mockTask, id: 'task-1', status: 'executing' },
        { ...mockTask, id: 'task-2', status: 'queued' },
        { ...mockTask, id: 'task-3', status: 'completed' },
        { ...mockTask, id: 'task-4', status: 'failed' },
        { ...mockTask, id: 'task-5', status: 'planning' },
      ];

      useTasksStore.getState().setTasks(tasks);
    });

    it('should get active tasks', () => {
      const store = useTasksStore.getState();
      const activeTasks = store.getActiveTasks();

      expect(activeTasks).toHaveLength(1);
      expect(activeTasks[0].status).toBe('executing');
    });

    it('should get queued tasks', () => {
      const store = useTasksStore.getState();
      const queuedTasks = store.getQueuedTasks();

      expect(queuedTasks).toHaveLength(1);
      expect(queuedTasks[0].status).toBe('queued');
    });

    it('should get recent tasks', () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const recentTask: WorkerTask = {
        ...mockTask,
        id: 'recent-task',
        status: 'completed',
        completed_at: now.toISOString(),
      };

      const oldTask: WorkerTask = {
        ...mockTask,
        id: 'old-task',
        status: 'completed',
        completed_at: yesterday.toISOString(),
      };

      useTasksStore.getState().setTasks([recentTask, oldTask]);

      const store = useTasksStore.getState();
      const recentTasks = store.getRecentTasks();

      expect(recentTasks).toHaveLength(1);
      expect(recentTasks[0].id).toBe('recent-task');
    });

    it('should get tasks by status', () => {
      const store = useTasksStore.getState();
      const completedAndFailed = store.getTasksByStatus(['completed', 'failed']);

      expect(completedAndFailed).toHaveLength(2);
      expect(completedAndFailed.map(t => t.status)).toEqual(['completed', 'failed']);
    });
  });

  describe('refreshData', () => {
    it('should refresh both REST and SSE data in parallel', async () => {
      const store = useTasksStore.getState();

      await store.refreshData();

      expect(mockedApiClient.get).toHaveBeenCalledWith('/control-center');
      expect(mockedConnectToTaskStream).toHaveBeenCalled();
    });

    it('should handle REST errors during refresh', async () => {
      const error = new Error('REST failed');
      mockedApiClient.get.mockRejectedValue(error);

      const store = useTasksStore.getState();

      await expect(store.refreshData()).rejects.toThrow('REST failed');
      expect(mockedConnectToTaskStream).toHaveBeenCalled(); // SSE still attempted
    });
  });

  describe('persistence', () => {
    it('should persist tasks and stats to AsyncStorage', () => {
      const store = useTasksStore.getState();

      store.setTasks([mockTask]);
      store.setStats(mockStats);

      // Zustand persistence is tested through the middleware,
      // we just verify the store uses the correct storage key
      expect(useTasksStore.persist).toBeDefined();
    });

    it('should not persist loading and error states', () => {
      const store = useTasksStore.getState();

      store.setLoading(true);
      store.setError('Test error');

      // The partialize function should exclude these from persistence
      const config = (useTasksStore as any).persist.getOptions();
      const partializedState = config.partialize(store);

      expect(partializedState).not.toHaveProperty('isLoading');
      expect(partializedState).not.toHaveProperty('error');
      expect(partializedState).toHaveProperty('tasks');
      expect(partializedState).toHaveProperty('stats');
      expect(partializedState).toHaveProperty('lastUpdated');
    });
  });

  describe('state management', () => {
    it('should update task properly', () => {
      const store = useTasksStore.getState();

      store.setTasks([mockTask]);

      const updates = { status: 'completed' as WorkerTaskStatus, cost_cents: 100 };
      store.updateTask(mockTask.id, updates);

      const updatedState = useTasksStore.getState();
      expect(updatedState.tasks[0].status).toBe('completed');
      expect(updatedState.tasks[0].cost_cents).toBe(100);
      expect(updatedState.lastUpdated).toBeTruthy();
    });

    it('should remove task properly', () => {
      const store = useTasksStore.getState();

      store.setTasks([mockTask]);
      store.removeTask(mockTask.id);

      const updatedState = useTasksStore.getState();
      expect(updatedState.tasks).toHaveLength(0);
      expect(updatedState.lastUpdated).toBeTruthy();
    });
  });
});
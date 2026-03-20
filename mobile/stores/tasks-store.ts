import React from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '@/lib/api-client';
import { connectToTaskStream, disconnectSSE, ConnectionState, subscribeToSSEState } from '@/lib/sse-client';
import { WorkerTask, WorkerTaskStatus } from '@/types/tasks';
import { STORAGE_KEYS } from '@/constants/config';

// Task stats interface
export interface TaskStats {
  activeWorkers: number;
  queueDepth: number;
  periodCostCents: number;
  periodCompleted: number;
}

// Tasks store state interface
interface TasksState {
  // Data
  tasks: WorkerTask[];
  stats: TaskStats | null;

  // UI state
  isLoading: boolean;
  error: string | null;
  lastUpdated: string | null;
  sseConnected: boolean;

  // Actions
  setTasks: (tasks: WorkerTask[]) => void;
  updateTask: (taskId: string, updates: Partial<WorkerTask>) => void;
  removeTask: (taskId: string) => void;
  setStats: (stats: TaskStats) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setSseConnected: (connected: boolean) => void;

  // API methods
  fetchTasks: () => Promise<void>;
  connectSSE: () => void;
  disconnectSSE: () => void;
  refreshData: () => Promise<void>; // For pull-to-refresh

  // Task actions
  cancelTask: (taskId: string) => Promise<void>;
  retryTask: (taskId: string) => Promise<void>;

  // Computed getters
  getTasksByStatus: (status: WorkerTaskStatus[]) => WorkerTask[];
  getActiveTasks: () => WorkerTask[];
  getQueuedTasks: () => WorkerTask[];
  getRecentTasks: () => WorkerTask[];
}

// SSE connection cleanup function
let sseStateUnsubscribe: (() => void) | null = null;

export const useTasksStore = create<TasksState>()(
  persist(
    (set, get) => ({
      // Initial state
      tasks: [],
      stats: null,
      isLoading: false,
      error: null,
      lastUpdated: null,
      sseConnected: false,

      // Basic setters
      setTasks: (tasks) => set({ tasks, lastUpdated: new Date().toISOString() }),

      updateTask: (taskId, updates) =>
        set((state) => ({
          tasks: state.tasks.map((task) =>
            task.id === taskId ? { ...task, ...updates } : task
          ),
          lastUpdated: new Date().toISOString(),
        })),

      removeTask: (taskId) =>
        set((state) => ({
          tasks: state.tasks.filter((task) => task.id !== taskId),
          lastUpdated: new Date().toISOString(),
        })),

      setStats: (stats) => set({ stats }),
      setLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
      setSseConnected: (sseConnected) => set({ sseConnected }),

      // Fetch tasks from REST API
      fetchTasks: async () => {
        try {
          set({ isLoading: true, error: null });

          const response = await apiClient.get('/control-center');
          const data = response.data;

          set({
            tasks: data.tasks || [],
            stats: data.stats || null,
            isLoading: false,
            error: null,
            lastUpdated: new Date().toISOString(),
          });
        } catch (error) {
          console.error('Failed to fetch tasks:', error);
          set({
            isLoading: false,
            error: error instanceof Error ? error.message : 'Failed to load tasks',
          });
        }
      },

      // Connect to SSE stream
      connectSSE: () => {
        const state = get();

        // Set up SSE state monitoring
        if (sseStateUnsubscribe) {
          sseStateUnsubscribe();
        }

        sseStateUnsubscribe = subscribeToSSEState((connectionState) => {
          const isConnected = connectionState === ConnectionState.CONNECTED;
          get().setSseConnected(isConnected);
        });

        // Connect to task stream
        connectToTaskStream(
          (event) => {
            try {
              const data = JSON.parse(event.data);

              // Handle different SSE event types
              switch (data.type) {
                case 'task_update':
                  if (data.task) {
                    state.updateTask(data.task.id, data.task);
                  }
                  break;

                case 'task_created':
                  if (data.task) {
                    set((currentState) => ({
                      tasks: [...currentState.tasks, data.task],
                      lastUpdated: new Date().toISOString(),
                    }));
                  }
                  break;

                case 'task_removed':
                  if (data.taskId) {
                    state.removeTask(data.taskId);
                  }
                  break;

                case 'stats_update':
                  if (data.stats) {
                    state.setStats(data.stats);
                  }
                  break;

                case 'full_refresh':
                  // Full data refresh from server
                  if (data.tasks) {
                    state.setTasks(data.tasks);
                  }
                  if (data.stats) {
                    state.setStats(data.stats);
                  }
                  break;

                default:
                  console.log('Unknown SSE event type:', data.type);
              }
            } catch (error) {
              console.error('Error parsing SSE message:', error);
            }
          },
          (error) => {
            console.error('SSE connection error:', error);
            // Error state is handled by SSE client's state changes
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
        set({ sseConnected: false });
      },

      // Refresh data (for pull-to-refresh) - fires both REST and SSE in parallel
      refreshData: async () => {
        const state = get();

        // Start both operations in parallel
        const restPromise = state.fetchTasks();
        const ssePromise = Promise.resolve(state.connectSSE());

        try {
          // Wait only for REST to complete (SSE connection may still be establishing)
          await restPromise;
        } catch (error) {
          // fetchTasks already handles error state
          throw error;
        }

        // SSE connection continues in background
        await ssePromise;
      },

      // Cancel a task
      cancelTask: async (taskId: string) => {
        try {
          await apiClient.post(`/tasks/${taskId}/cancel`);
          // Task update will come through SSE
        } catch (error) {
          console.error('Failed to cancel task:', error);
          throw error;
        }
      },

      // Retry a task
      retryTask: async (taskId: string) => {
        try {
          await apiClient.post(`/tasks/${taskId}/retry`);
          // Task update will come through SSE
        } catch (error) {
          console.error('Failed to retry task:', error);
          throw error;
        }
      },

      // Computed getters
      getTasksByStatus: (statuses: WorkerTaskStatus[]) => {
        return get().tasks.filter((task) => statuses.includes(task.status));
      },

      getActiveTasks: () => {
        const activeStatuses: WorkerTaskStatus[] = [
          'executing',
          'consolidating',
          'deploying',
          'running',
          'integration_check',
        ];
        return get().getTasksByStatus(activeStatuses);
      },

      getQueuedTasks: () => {
        const queuedStatuses: WorkerTaskStatus[] = [
          'queued',
          'claimed',
          'environment_setup',
          'dispatching',
        ];
        return get().getTasksByStatus(queuedStatuses);
      },

      getRecentTasks: () => {
        const recentStatuses: WorkerTaskStatus[] = [
          'completed',
          'deployed',
          'failed',
          'cancelled',
          'review_rejected',
        ];
        const recentTasks = get().getTasksByStatus(recentStatuses);

        // Filter to tasks from last 24 hours
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        return recentTasks.filter((task) => {
          const taskDate = new Date(task.completed_at || task.failed_at || task.created_at);
          return taskDate > yesterday;
        });
      },
    }),
    {
      name: STORAGE_KEYS.TASKS,
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist data, not loading/error states
      partialize: (state) => ({
        tasks: state.tasks,
        stats: state.stats,
        lastUpdated: state.lastUpdated,
      }),
    }
  )
);

// Helper hook to automatically connect SSE on mount
export const useTasksSSE = () => {
  const { connectSSE, disconnectSSE: disconnect } = useTasksStore();

  // Connect on mount, disconnect on unmount
  React.useEffect(() => {
    connectSSE();
    return () => disconnect();
  }, [connectSSE, disconnect]);
};

// Export store actions for external use
export const tasksActions = {
  fetchTasks: () => useTasksStore.getState().fetchTasks(),
  connectSSE: () => useTasksStore.getState().connectSSE(),
  disconnectSSE: () => useTasksStore.getState().disconnectSSE(),
  refreshData: () => useTasksStore.getState().refreshData(),
  cancelTask: (taskId: string) => useTasksStore.getState().cancelTask(taskId),
  retryTask: (taskId: string) => useTasksStore.getState().retryTask(taskId),
};
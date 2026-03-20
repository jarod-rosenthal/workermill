import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WorkerTask, WorkerTaskStatus } from '@/types/tasks';
import { apiClient } from '@/lib/api-client';
import { createDashboardSSE, SSEClient, SSEEvent } from '@/lib/sse-client';
import { STORAGE_KEYS } from '@/constants/config';

export interface TaskStats {
  activeWorkersCount: number;
  queueDepth: number;
  periodCostCents: number;
  periodCompleted: number;
}

export interface TasksState {
  // Data
  tasks: WorkerTask[];
  stats: TaskStats | null;
  lastUpdated: string | null;

  // Connection state
  isSSEConnected: boolean;
  sseError: string | null;
  isLoading: boolean;
  error: string | null;

  // SSE client instance
  sseClient: SSEClient | null;

  // Actions
  loadTasks: (token?: string) => Promise<void>;
  connectSSE: (token: string) => void;
  disconnectSSE: () => void;
  updateTask: (task: WorkerTask) => void;
  updateStats: (stats: TaskStats) => void;

  // Convenience getters
  getActiveTasks: () => WorkerTask[];
  getQueuedTasks: () => WorkerTask[];
  getRecentTasks: () => WorkerTask[];
  getTaskById: (id: string) => WorkerTask | null;
}

// Helper functions for task categorization
const getActiveTasks = (tasks: WorkerTask[]): WorkerTask[] => {
  const activeStatuses: WorkerTaskStatus[] = [
    'executing',
    'consolidating',
    'deploying',
    'running',
    'integration_check'
  ];
  return tasks.filter(task => activeStatuses.includes(task.status));
};

const getQueuedTasks = (tasks: WorkerTask[]): WorkerTask[] => {
  const queuedStatuses: WorkerTaskStatus[] = [
    'queued',
    'claimed',
    'environment_setup',
    'dispatching'
  ];
  return tasks.filter(task => queuedStatuses.includes(task.status));
};

const getRecentTasks = (tasks: WorkerTask[]): WorkerTask[] => {
  const recentStatuses: WorkerTaskStatus[] = [
    'completed',
    'failed',
    'cancelled'
  ];

  const oneDayAgo = new Date();
  oneDayAgo.setHours(oneDayAgo.getHours() - 24);

  return tasks.filter(task => {
    if (!recentStatuses.includes(task.status)) return false;

    const completionTime = task.completed_at || task.failed_at;
    if (!completionTime) return false;

    return new Date(completionTime) > oneDayAgo;
  }).sort((a, b) => {
    // Sort by completion time descending (most recent first)
    const aTime = a.completed_at || a.failed_at || '';
    const bTime = b.completed_at || b.failed_at || '';
    return bTime.localeCompare(aTime);
  });
};

export const useTasksStore = create<TasksState>()(
  persist(
    (set, get) => ({
      // Initial state
      tasks: [],
      stats: null,
      lastUpdated: null,
      isSSEConnected: false,
      sseError: null,
      isLoading: false,
      error: null,
      sseClient: null,

      // Actions
      loadTasks: async (token?: string) => {
        set({ isLoading: true, error: null });

        try {
          const data = await apiClient.get<{
            tasks: WorkerTask[];
            stats: TaskStats;
          }>('/control-center');

          set({
            tasks: data.tasks,
            stats: data.stats,
            lastUpdated: new Date().toISOString(),
            isLoading: false,
            error: null
          });

          // If token provided, also connect SSE
          if (token) {
            get().connectSSE(token);
          }
        } catch (error: any) {
          const errorMessage = error.response?.data?.message || 'Failed to load tasks';
          set({
            isLoading: false,
            error: errorMessage
          });
          throw error;
        }
      },

      connectSSE: (token: string) => {
        // Disconnect existing connection
        get().disconnectSSE();

        const sseClient = createDashboardSSE(token, {
          onEvent: (event: SSEEvent) => {
            switch (event.type) {
              case 'task_update':
                if (event.data.type === 'stats') {
                  get().updateStats(event.data.stats);
                } else if (event.data.type === 'task') {
                  get().updateTask(event.data.task);
                }
                break;
              default:
                // Ignore other event types on dashboard SSE
                break;
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

        set({ sseClient });
        sseClient.connect();
      },

      disconnectSSE: () => {
        const { sseClient } = get();
        if (sseClient) {
          sseClient.destroy();
          set({
            sseClient: null,
            isSSEConnected: false,
            sseError: null
          });
        }
      },

      updateTask: (updatedTask: WorkerTask) => {
        set(state => {
          const existingIndex = state.tasks.findIndex(t => t.id === updatedTask.id);

          let newTasks;
          if (existingIndex >= 0) {
            // Update existing task
            newTasks = [...state.tasks];
            newTasks[existingIndex] = updatedTask;
          } else {
            // Add new task
            newTasks = [updatedTask, ...state.tasks];
          }

          return {
            tasks: newTasks,
            lastUpdated: new Date().toISOString()
          };
        });
      },

      updateStats: (stats: TaskStats) => {
        set({
          stats,
          lastUpdated: new Date().toISOString()
        });
      },

      // Convenience getters
      getActiveTasks: () => getActiveTasks(get().tasks),
      getQueuedTasks: () => getQueuedTasks(get().tasks),
      getRecentTasks: () => getRecentTasks(get().tasks),
      getTaskById: (id: string) => {
        return get().tasks.find(task => task.id === id) || null;
      },
    }),
    {
      name: STORAGE_KEYS.TASKS,
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist data, not connection state or clients
      partialize: (state) => ({
        tasks: state.tasks,
        stats: state.stats,
        lastUpdated: state.lastUpdated,
      }),
    }
  )
);
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTasksStore } from '@/stores/tasks-store';
import { useCoordinationStore } from '@/stores/coordination-store';
import { useAuthStore } from '@/stores/auth-store';
import { StatusBadge } from '@/components/StatusBadge';
import { TaskLogStream } from '@/components/TaskLogStream';
import { CoordinationFeed } from '@/components/CoordinationFeed';
import { DiffView } from '@/components/DiffView';
import { OfflineBanner } from '@/components/OfflineBanner';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button } from '@/components/ui/Button';
import { apiClient } from '@/lib/api-client';
import type { WorkerTask } from '@/types/tasks';

type TabType = 'logs' | 'coordination' | 'code';

interface TaskDetailHeaderProps {
  task: WorkerTask;
  onCancel: () => void;
  onRetry: () => void;
}

function TaskDetailHeader({ task, onCancel, onRetry }: TaskDetailHeaderProps) {
  const canCancel = ['queued', 'claimed', 'environment_setup', 'dispatching', 'planning', 'executing'].includes(task.status);
  const canRetry = ['failed', 'cancelled'].includes(task.status);

  const formatElapsedTime = (startedAt?: string): string => {
    if (!startedAt) return '';

    const start = new Date(startedAt).getTime();
    const end = task.completedAt ? new Date(task.completedAt).getTime() : Date.now();
    const seconds = Math.floor((end - start) / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  };

  const formatCost = (costUsd?: number): string => {
    if (!costUsd) return '';
    return `$${costUsd.toFixed(2)}`;
  };

  return (
    <View className="bg-white dark:bg-slate-850 border-b border-slate-200 dark:border-slate-700">
      <View className="p-4">
        {/* Issue Key and Summary */}
        <View className="flex-row items-start justify-between mb-3">
          <View className="flex-1 mr-3">
            {task.jiraIssueKey && (
              <Text className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {task.jiraIssueKey}
              </Text>
            )}
            <Text className="text-slate-600 dark:text-slate-400 text-base mt-1">
              {task.summary}
            </Text>
          </View>
          <StatusBadge status={task.status} />
        </View>

        {/* Metadata */}
        <View className="flex-row items-center mb-3">
          {task.workerPersona && (
            <Text className="text-slate-500 dark:text-slate-400 text-sm mr-4">
              🤖 {task.workerPersona}
            </Text>
          )}
          {task.startedAt && (
            <Text className="text-slate-500 dark:text-slate-400 text-sm mr-4">
              {formatElapsedTime(task.startedAt)}
            </Text>
          )}
          {(task.estimatedCostUsd || task.costUsd) && (
            <Text className="text-slate-500 dark:text-slate-400 text-sm">
              {formatCost(task.estimatedCostUsd ?? task.costUsd)}
            </Text>
          )}
        </View>

        {/* Actions */}
        {(canCancel || canRetry) && (
          <View className="flex-row gap-3">
            {canCancel && (
              <Button
                variant="outline"
                size="sm"
                onPress={onCancel}
                className="flex-1"
              >
                Cancel Task
              </Button>
            )}
            {canRetry && (
              <Button
                variant="primary"
                size="sm"
                onPress={onRetry}
                className="flex-1"
              >
                Retry Task
              </Button>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

interface TabBarProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  hasCoordinationError?: boolean;
  hasLogError?: boolean;
}

function TabBar({ activeTab, onTabChange, hasCoordinationError, hasLogError }: TabBarProps) {
  const tabs: { key: TabType; title: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'logs', title: 'Logs', icon: 'terminal-outline' },
    { key: 'coordination', title: 'Coordination', icon: 'people-outline' },
    { key: 'code', title: 'Code', icon: 'code-outline' },
  ];

  return (
    <View className="bg-white dark:bg-slate-850 border-b border-slate-200 dark:border-slate-700">
      <View className="flex-row">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          const hasError = (tab.key === 'coordination' && hasCoordinationError) ||
                          (tab.key === 'logs' && hasLogError);

          return (
            <TouchableOpacity
              key={tab.key}
              onPress={() => onTabChange(tab.key)}
              className="flex-1 items-center py-3"
              style={{ minHeight: 44 }}
              accessibilityRole="button"
              accessibilityLabel={`${tab.title} tab${isActive ? ', active' : ''}`}
            >
              <View className="flex-row items-center">
                <Ionicons
                  name={tab.icon}
                  size={16}
                  color={isActive ? '#6366f1' : hasError ? '#ef4444' : '#94a3b8'}
                />
                <Text
                  className={`ml-2 text-sm font-medium ${
                    isActive
                      ? 'text-brand-500'
                      : hasError
                      ? 'text-red-500'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {tab.title}
                </Text>
              </View>
              {isActive && (
                <View className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-500" />
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export default function TaskDetailScreen() {
  const { id: taskId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('logs');
  const [logSSEError] = useState<string | null>(null);
  const [coordinationSSEError] = useState<string | null>(null);

  const { getTaskById, loadTasks } = useTasksStore();
  const { getMessagesByParentTask, connectSSE, disconnectSSE, isSSEConnected } = useCoordinationStore();
  const { isAuthenticated } = useAuthStore();

  const task = getTaskById(taskId || '');
  const coordinationMessages = getMessagesByParentTask(taskId || '');

  // Initialize SSE connections when task loads
  useEffect(() => {
    if (!taskId || !isAuthenticated) return;

    const initializeConnections = async () => {
      try {
        const tokens = await apiClient.getStoredTokens();
        if (tokens.accessToken && task) {
          // Connect coordination SSE
          connectSSE(taskId, tokens.accessToken);
        }
      } catch (error) {
        console.error('Failed to initialize task SSE connections:', error);
      }
    };

    if (task) {
      initializeConnections();
    }

    // Cleanup on unmount
    return () => {
      disconnectSSE();
    };
  }, [taskId, task, isAuthenticated, connectSSE, disconnectSSE]);

  // Handle task actions
  const handleCancelTask = useCallback(() => {
    Alert.alert(
      'Cancel Task',
      'Are you sure you want to cancel this task? This action cannot be undone.',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiClient.post(`/tasks/${taskId}/cancel`);
              // Refresh task data
              await loadTasks();
              Alert.alert('Success', 'Task has been cancelled.');
            } catch (error) {
              console.error('Cancel task failed:', error);
              Alert.alert('Error', 'Failed to cancel task. Please try again.');
            }
          },
        },
      ]
    );
  }, [taskId, loadTasks]);

  const handleRetryTask = useCallback(() => {
    Alert.alert(
      'Retry Task',
      'This will restart the task from the beginning. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Retry',
          onPress: async () => {
            try {
              await apiClient.post(`/tasks/${taskId}/retry`);
              // Refresh task data
              await loadTasks();
              Alert.alert('Success', 'Task has been queued for retry.');
            } catch (error) {
              console.error('Retry task failed:', error);
              Alert.alert('Error', 'Failed to retry task. Please try again.');
            }
          },
        },
      ]
    );
  }, [taskId, loadTasks]);


  // Handle back navigation
  const handleGoBack = useCallback(() => {
    router.back();
  }, [router]);

  // Loading state
  if (!task) {
    return (
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-950">
        <View className="flex-1 justify-center items-center px-6">
          <ErrorState
            message="Task not found"
            onRetry={handleGoBack}
          />
        </View>
      </SafeAreaView>
    );
  }


  const renderTabContent = () => {
    switch (activeTab) {
      case 'logs':
        return (
          <View className="flex-1">
            {/* Offline indicator for logs SSE */}
            {logSSEError && (
              <OfflineBanner visible={true} />
            )}

            <TaskLogStream
              logs={[]}
              className="flex-1"
            />
          </View>
        );

      case 'coordination':
        return (
          <View className="flex-1">
            {/* Offline indicator for coordination SSE */}
            {!isSSEConnected && coordinationSSEError && (
              <OfflineBanner visible={true} />
            )}

            {coordinationMessages.length === 0 ? (
              <View className="flex-1 justify-center items-center px-6">
                <EmptyState
                  icon="people"
                  message="No coordination messages yet."
                />
              </View>
            ) : (
              <CoordinationFeed
                messages={coordinationMessages}
                className="flex-1"
              />
            )}
          </View>
        );

      case 'code':
        return (
          <View className="flex-1">
            <DiffView
              files={[]}
              className="flex-1"
            />
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-950">
      {/* Header with back button */}
      <View className="bg-white dark:bg-slate-850 border-b border-slate-200 dark:border-slate-700">
        <View className="flex-row items-center px-4 py-3">
          <TouchableOpacity
            onPress={handleGoBack}
            className="mr-3"
            style={{ minHeight: 44, minWidth: 44, justifyContent: 'center' }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={24} color="#6366f1" />
          </TouchableOpacity>
          <Text className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Task Details
          </Text>
        </View>
      </View>

      {/* Task Header */}
      <TaskDetailHeader
        task={task}
        onCancel={handleCancelTask}
        onRetry={handleRetryTask}
      />

      {/* Tab Bar */}
      <TabBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        hasCoordinationError={!!coordinationSSEError}
        hasLogError={!!logSSEError}
      />

      {/* Tab Content */}
      <View className="flex-1">
        {renderTabContent()}
      </View>
    </SafeAreaView>
  );
}
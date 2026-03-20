import React, { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  SectionList,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTasksStore } from '@/stores/tasks-store';
import { useAuthStore } from '@/stores/auth-store';
import { TaskListItem } from '@/components/TaskListItem';
import { StatsBar } from '@/components/StatsBar';
import { OfflineBanner } from '@/components/OfflineBanner';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { apiClient } from '@/lib/api-client';
import { WorkerTask } from '@/types/tasks';

interface TaskSection {
  title: string;
  data: WorkerTask[];
  collapsible?: boolean;
  collapsed?: boolean;
}

export default function DashboardScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [recentCollapsed, setRecentCollapsed] = useState(false);

  const {
    tasks,
    stats,
    isSSEConnected,
    sseError,
    isLoading,
    error,
    loadTasks,
    connectSSE,
    disconnectSSE,
    getActiveTasks,
    getQueuedTasks,
    getRecentTasks,
  } = useTasksStore();

  const { isAuthenticated, user } = useAuthStore();

  // Load tasks when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      if (isAuthenticated) {
        const initializeDashboard = async () => {
          try {
            const tokens = await apiClient.getStoredTokens();
            if (tokens.accessToken) {
              await loadTasks(tokens.accessToken);
            }
          } catch (error) {
            console.error('Failed to initialize dashboard:', error);
          }
        };

        initializeDashboard();
      }

      // Cleanup SSE when screen loses focus
      return () => {
        disconnectSSE();
      };
    }, [isAuthenticated])
  );

  // Pull to refresh handler
  const onRefresh = useCallback(async () => {
    if (!isAuthenticated) return;

    setRefreshing(true);

    try {
      const tokens = await apiClient.getStoredTokens();

      if (tokens.accessToken) {
        // Fire REST fetch and SSE reconnect in parallel
        const restPromise = loadTasks();
        const ssePromise = new Promise<void>((resolve) => {
          connectSSE(tokens.accessToken);
          // SSE connection is fire-and-forget, resolve immediately
          resolve();
        });

        await Promise.all([restPromise, ssePromise]);
      }
    } catch (error) {
      console.error('Refresh failed:', error);
      Alert.alert(
        'Refresh Failed',
        'Failed to refresh dashboard data. Please try again.',
        [{ text: 'OK' }]
      );
    } finally {
      setRefreshing(false);
    }
  }, [isAuthenticated, loadTasks, connectSSE]);

  // Task press handler
  const handleTaskPress = useCallback((task: WorkerTask) => {
    router.push(`/task/${task.id}`);
  }, [router]);

  // Prepare section data
  const activeTasks = getActiveTasks();
  const queuedTasks = getQueuedTasks();
  const recentTasks = getRecentTasks();

  const sections: TaskSection[] = [];

  if (activeTasks.length > 0) {
    sections.push({
      title: `Active (${activeTasks.length})`,
      data: activeTasks,
    });
  }

  if (queuedTasks.length > 0) {
    sections.push({
      title: `Queued (${queuedTasks.length})`,
      data: queuedTasks,
    });
  }

  if (recentTasks.length > 0) {
    sections.push({
      title: `Recent (${recentTasks.length})`,
      data: recentCollapsed ? [] : recentTasks,
      collapsible: true,
      collapsed: recentCollapsed,
    });
  }

  // Render section header
  const renderSectionHeader = ({ section }: { section: TaskSection }) => (
    <TouchableOpacity
      onPress={section.collapsible ? () => setRecentCollapsed(!recentCollapsed) : undefined}
      className="flex-row items-center justify-between py-3 px-4"
      accessibilityRole={section.collapsible ? 'button' : 'text'}
      accessibilityLabel={
        section.collapsible
          ? `${section.title} section, tap to ${section.collapsed ? 'expand' : 'collapse'}`
          : section.title
      }
      style={{ minHeight: section.collapsible ? 44 : 'auto' }}
    >
      <Text className="text-lg font-semibold text-slate-900 dark:text-slate-100">
        {section.title}
      </Text>
      {section.collapsible && (
        <Text className="text-slate-500 dark:text-slate-400 text-sm">
          {section.collapsed ? 'Show' : 'Hide'}
        </Text>
      )}
    </TouchableOpacity>
  );

  // Render task item
  const renderTaskItem = ({ item }: { item: WorkerTask }) => (
    <View className="px-4">
      <TaskListItem task={item} onPress={handleTaskPress} />
    </View>
  );

  // Check if we should show empty state
  const hasNoTasks = activeTasks.length === 0 && queuedTasks.length === 0 && recentTasks.length === 0;

  // Loading state (first time, no cached data)
  if (isLoading && tasks.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-950">
        <View className="flex-1 justify-center items-center">
          <Spinner />
        </View>
      </SafeAreaView>
    );
  }

  // Error state (no cached data)
  if (error && tasks.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-950">
        <View className="flex-1 justify-center items-center px-6">
          <ErrorState
            message="Could not load tasks"
            onRetry={onRefresh}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-950">
      {/* Offline Banner */}
      {!isSSEConnected && sseError && (
        <OfflineBanner visible={true} />
      )}

      {/* Stats Bar */}
      {stats && (
        <View className="px-4 pt-4 pb-2">
          <StatsBar
            activeWorkers={stats.activeWorkersCount}
            queueDepth={stats.queueDepth}
            periodCost={stats.periodCostCents}
            periodCompleted={stats.periodCompleted}
          />
        </View>
      )}

      {/* Task List */}
      {hasNoTasks ? (
        <View className="flex-1 justify-center items-center px-6">
          <EmptyState
            icon="inbox"
            message="No active tasks. Start a task from the Boards tab."
          />
        </View>
      ) : (
        <SectionList
          sections={sections}
          renderSectionHeader={renderSectionHeader}
          renderItem={renderTaskItem}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#6366f1"
              colors={['#6366f1']}
            />
          }
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 20 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}
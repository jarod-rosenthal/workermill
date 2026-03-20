import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { WorkerTask } from '../types/tasks';
import { StatusBadge } from './StatusBadge';

interface TaskListItemProps {
  task: WorkerTask;
  onPress: (taskId: string) => void;
}

function formatElapsedTime(elapsedMs: number): string {
  const seconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function formatCost(costCents?: number): string {
  if (!costCents) return '$0.00';
  return `$${(costCents / 100).toFixed(2)}`;
}

export function TaskListItem({ task, onPress }: TaskListItemProps) {
  const [liveElapsedTime, setLiveElapsedTime] = useState(task.elapsed_time_ms || 0);

  // Update elapsed time every second for active tasks
  useEffect(() => {
    const isActive = ['executing', 'consolidating', 'deploying', 'running', 'integration_check'].includes(task.status);

    if (!isActive || !task.started_at) {
      return;
    }

    const interval = setInterval(() => {
      const startTime = new Date(task.started_at!).getTime();
      const now = Date.now();
      setLiveElapsedTime(now - startTime);
    }, 1000);

    return () => clearInterval(interval);
  }, [task.status, task.started_at]);

  const displayElapsedTime = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'
    ? (task.elapsed_time_ms || 0)
    : liveElapsedTime;

  return (
    <TouchableOpacity
      onPress={() => onPress(task.id)}
      className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 mb-3 shadow-sm"
      style={{ minHeight: 48 }}
      accessibilityRole="button"
      accessibilityLabel={`Task ${task.issue_key}: ${task.summary}`}
    >
      <View className="flex-row justify-between items-start mb-2">
        <View className="flex-1 mr-3">
          <Text className="text-sm font-medium text-slate-600 dark:text-slate-400">
            {task.issue_key}
          </Text>
          <Text
            className="text-base font-semibold text-slate-900 dark:text-white mt-1"
            numberOfLines={2}
          >
            {task.summary}
          </Text>
        </View>
        <StatusBadge status={task.status} />
      </View>

      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center">
          <Text className="text-lg mr-2">
            {task.persona_emoji || '🤖'}
          </Text>
          <Text className="text-sm text-slate-600 dark:text-slate-400">
            {task.persona}
          </Text>
        </View>

        <View className="flex-row items-center space-x-4">
          <Text className="text-sm text-slate-500 dark:text-slate-400">
            {formatElapsedTime(displayElapsedTime)}
          </Text>
          <Text className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {formatCost(task.cost_cents)}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}
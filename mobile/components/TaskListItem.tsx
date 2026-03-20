import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { WorkerTask } from '../types/tasks';
import { StatusBadge } from './StatusBadge';

interface TaskListItemProps {
  task: WorkerTask;
  onPress?: (task: WorkerTask) => void;
  className?: string;
}

function formatElapsedTime(elapsedMs?: number): string {
  if (!elapsedMs) return '';

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
  if (!costCents) return '';
  return `$${(costCents / 100).toFixed(2)}`;
}

export function TaskListItem({ task, onPress, className }: TaskListItemProps) {
  const elapsedTime = formatElapsedTime(task.elapsed_time_ms);
  const cost = formatCost(task.cost_cents);

  return (
    <TouchableOpacity
      onPress={() => onPress?.(task)}
      className={`
        bg-white dark:bg-slate-850
        border border-slate-200 dark:border-slate-700
        rounded-lg p-4 mb-3
        ${className || ''}
      `}
      style={{ minHeight: 48 }}
      accessibilityRole="button"
      accessibilityLabel={`Task ${task.issue_key}: ${task.summary}`}
    >
      <View className="flex-row items-start justify-between mb-2">
        <View className="flex-1 mr-3">
          <Text
            className="text-slate-900 dark:text-slate-100 font-medium text-sm"
            numberOfLines={1}
          >
            {task.issue_key}
          </Text>
          <Text
            className="text-slate-600 dark:text-slate-400 text-sm mt-1"
            numberOfLines={2}
          >
            {task.summary}
          </Text>
        </View>
        <StatusBadge status={task.status} />
      </View>

      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center">
          <Text
            className="text-slate-500 dark:text-slate-400 text-xs mr-2"
            accessibilityLabel={`Worker: ${task.persona}`}
          >
            {task.persona_emoji || '🤖'} {task.persona}
          </Text>
        </View>

        <View className="flex-row items-center space-x-3">
          {elapsedTime && (
            <Text
              className="text-slate-500 dark:text-slate-400 text-xs"
              accessibilityLabel={`Duration: ${elapsedTime}`}
            >
              {elapsedTime}
            </Text>
          )}
          {cost && (
            <Text
              className="text-slate-500 dark:text-slate-400 text-xs font-medium"
              accessibilityLabel={`Cost: ${cost}`}
            >
              {cost}
            </Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}
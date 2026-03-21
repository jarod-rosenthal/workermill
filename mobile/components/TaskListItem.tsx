import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { WorkerTask } from '../types/tasks';
import { StatusBadge } from './StatusBadge';

interface TaskListItemProps {
  task: WorkerTask;
  onPress?: (task: WorkerTask) => void;
  className?: string;
}

function formatDuration(startedAt?: string, completedAt?: string): string {
  if (!startedAt) return '';

  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
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
}

function formatCost(costUsd?: number): string {
  if (!costUsd) return '';
  return `$${costUsd.toFixed(2)}`;
}

export function TaskListItem({ task, onPress, className }: TaskListItemProps) {
  const elapsedTime = formatDuration(task.startedAt, task.completedAt);
  const cost = formatCost(task.estimatedCostUsd ?? task.costUsd);

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
      accessibilityLabel={`Task ${task.jiraIssueKey || task.id}: ${task.summary}`}
    >
      <View className="flex-row items-start justify-between mb-2">
        <View className="flex-1 mr-3">
          {task.jiraIssueKey && (
            <Text
              className="text-slate-900 dark:text-slate-100 font-medium text-sm"
              numberOfLines={1}
            >
              {task.jiraIssueKey}
            </Text>
          )}
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
          {task.workerPersona && (
            <Text
              className="text-slate-500 dark:text-slate-400 text-xs mr-2"
              accessibilityLabel={`Worker: ${task.workerPersona}`}
            >
              🤖 {task.workerPersona}
            </Text>
          )}
        </View>

        <View className="flex-row items-center space-x-3">
          {elapsedTime ? (
            <Text
              className="text-slate-500 dark:text-slate-400 text-xs"
              accessibilityLabel={`Duration: ${elapsedTime}`}
            >
              {elapsedTime}
            </Text>
          ) : null}
          {cost ? (
            <Text
              className="text-slate-500 dark:text-slate-400 text-xs font-medium"
              accessibilityLabel={`Cost: ${cost}`}
            >
              {cost}
            </Text>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

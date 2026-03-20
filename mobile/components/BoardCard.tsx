import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Card } from '../types/boards';
import { StatusBadge } from './StatusBadge';
import { WorkerTaskStatus } from '../types/tasks';

interface BoardCardProps {
  card: Card;
  onPress: (cardId: string) => void;
  onLongPress?: (cardId: string) => void;
}

function getPriorityColor(priority: Card['priority']): string {
  switch (priority) {
    case 'urgent':
      return 'bg-red-500';
    case 'high':
      return 'bg-orange-500';
    case 'medium':
      return 'bg-yellow-500';
    case 'low':
      return 'bg-green-500';
    default:
      return 'bg-slate-500';
  }
}

export function BoardCard({ card, onPress, onLongPress }: BoardCardProps) {
  const completedChecklist = card.checklist_items.filter(item => item.completed).length;
  const totalChecklist = card.checklist_items.length;

  return (
    <TouchableOpacity
      onPress={() => onPress(card.id)}
      onLongPress={() => onLongPress?.(card.id)}
      className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 mb-3 shadow-sm"
      style={{ minHeight: 48 }}
      accessibilityRole="button"
      accessibilityLabel={`Card ${card.issue_key}: ${card.title}`}
    >
      {/* Priority color bar */}
      <View className={`absolute left-0 top-0 bottom-0 w-1 ${getPriorityColor(card.priority)} rounded-l-lg`} />

      {/* Card header */}
      <View className="flex-row justify-between items-start mb-2 ml-2">
        <View className="flex-1">
          <Text className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {card.issue_key}
          </Text>
          <Text
            className="text-sm font-semibold text-slate-900 dark:text-white mt-1"
            numberOfLines={2}
          >
            {card.title}
          </Text>
        </View>

        {/* Worker status indicator */}
        {card.linked_task_status && (
          <View className="ml-2">
            <StatusBadge status={card.linked_task_status as WorkerTaskStatus} />
          </View>
        )}
      </View>

      {/* Labels */}
      {card.labels.length > 0 && (
        <View className="flex-row flex-wrap gap-1 mb-2 ml-2">
          {card.labels.map((label) => (
            <View
              key={label.id}
              className="px-2 py-1 rounded-full"
              style={{ backgroundColor: label.color }}
            >
              <Text className="text-xs font-medium text-white">
                {label.name}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Checklist progress */}
      {totalChecklist > 0 && (
        <View className="flex-row items-center ml-2">
          <View className="flex-1 bg-slate-200 dark:bg-slate-600 rounded-full h-1 mr-2">
            <View
              className="bg-green-500 h-1 rounded-full"
              style={{ width: `${(completedChecklist / totalChecklist) * 100}%` }}
            />
          </View>
          <Text className="text-xs text-slate-500 dark:text-slate-400">
            {completedChecklist}/{totalChecklist}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}
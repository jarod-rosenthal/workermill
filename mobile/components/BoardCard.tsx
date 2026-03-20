import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Card as CardType, Label } from '../types/boards';
import { StatusBadge } from './StatusBadge';

interface BoardCardProps {
  card: CardType;
  onPress?: () => void;
  onLongPress?: () => void;
}

// Priority color mappings (left border indicator)
const priorityColors = {
  urgent: 'border-l-red-500',
  high: 'border-l-orange-500',
  medium: 'border-l-yellow-500',
  low: 'border-l-green-500',
};

function LabelChip({ label }: { label: Label }) {
  return (
    <View
      className="px-2 py-1 rounded-full mr-1 mb-1"
      style={{ backgroundColor: label.color }}
      accessibilityRole="text"
      accessibilityLabel={`Label: ${label.name}`}
    >
      <Text
        className="text-xs font-medium text-white"
        numberOfLines={1}
      >
        {label.name}
      </Text>
    </View>
  );
}

export function BoardCard({ card, onPress, onLongPress }: BoardCardProps) {
  const priorityColor = priorityColors[card.priority];

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      className="mb-3"
      style={{ minHeight: 48, minWidth: 48 }} // Minimum touch target
      accessibilityRole="button"
      accessibilityLabel={`Card ${card.issue_key}: ${card.title}`}
      accessibilityHint="Double tap to open card details, long press for options"
    >
      <View
        className={`
          bg-white dark:bg-slate-850
          border border-slate-200 dark:border-slate-700
          rounded-lg shadow-sm
          border-l-4 ${priorityColor}
        `}
      >
        {/* Header with issue key and worker status */}
        <View className="px-3 pt-3 pb-2">
          <View className="flex-row items-center justify-between mb-2">
            <Text
              className="text-xs font-mono text-slate-600 dark:text-slate-400"
              accessibilityRole="text"
            >
              {card.issue_key}
            </Text>
            {card.linked_task_status && (
              <StatusBadge status={card.linked_task_status as any} />
            )}
          </View>

          {/* Card title */}
          <Text
            className="text-sm font-medium text-slate-900 dark:text-slate-100 leading-5"
            numberOfLines={2}
            accessibilityRole="text"
          >
            {card.title}
          </Text>
        </View>

        {/* Labels section */}
        {card.labels.length > 0 && (
          <View className="px-3 pb-2">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="flex-row"
            >
              {card.labels.map((label) => (
                <LabelChip key={label.id} label={label} />
              ))}
            </ScrollView>
          </View>
        )}

        {/* Checklist progress indicator */}
        {card.checklist_items.length > 0 && (
          <View className="px-3 pb-3">
            <View className="flex-row items-center">
              <View className="flex-1 bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 mr-2">
                <View
                  className="bg-green-500 h-1.5 rounded-full"
                  style={{
                    width: `${(card.checklist_items.filter(item => item.completed).length / card.checklist_items.length) * 100}%`
                  }}
                />
              </View>
              <Text
                className="text-xs text-slate-600 dark:text-slate-400"
                accessibilityRole="text"
              >
                {card.checklist_items.filter(item => item.completed).length}/{card.checklist_items.length}
              </Text>
            </View>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}
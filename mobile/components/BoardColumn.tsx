import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Column, Card } from '../types/boards';
import { BoardCard } from './BoardCard';
import { EmptyState } from './ui/EmptyState';

interface BoardColumnProps {
  column: Column;
  onCardPress?: (card: Card) => void;
  onCardLongPress?: (card: Card) => void;
  onAddCard?: (columnId: string) => void;
}

export function BoardColumn({
  column,
  onCardPress,
  onCardLongPress,
  onAddCard
}: BoardColumnProps) {
  return (
    <View className="w-80 mr-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
      {/* Column header */}
      <View className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <View className="flex-row items-center justify-between">
          <Text
            className="text-base font-semibold text-slate-900 dark:text-slate-100"
            accessibilityRole="text"
          >
            {column.name}
          </Text>
          <View className="bg-slate-200 dark:bg-slate-700 px-2 py-1 rounded-full">
            <Text
              className="text-xs font-medium text-slate-600 dark:text-slate-400"
              accessibilityRole="text"
            >
              {column.cards.length}
            </Text>
          </View>
        </View>
      </View>

      {/* Column content */}
      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingVertical: 12 }}
        showsVerticalScrollIndicator={false}
        accessibilityRole="scrollbar"
        accessibilityLabel={`${column.name} column cards`}
      >
        {column.cards.length === 0 ? (
          <View className="py-8">
            <EmptyState
              icon="inbox"
              message="No cards"
            />
          </View>
        ) : (
          column.cards.map((card) => (
            <BoardCard
              key={card.id}
              card={card}
              onPress={() => onCardPress?.(card)}
              onLongPress={() => onCardLongPress?.(card)}
            />
          ))
        )}

        {/* Add card button */}
        {onAddCard && (
          <TouchableOpacity
            onPress={() => onAddCard(column.id)}
            className="mt-2 py-3 px-4 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg"
            style={{ minHeight: 48, minWidth: 48 }} // Minimum touch target
            accessibilityRole="button"
            accessibilityLabel={`Add card to ${column.name} column`}
          >
            <View className="flex-row items-center justify-center">
              <Text className="text-lg text-slate-400 dark:text-slate-500 mr-2">+</Text>
              <Text className="text-sm text-slate-600 dark:text-slate-400">
                Add card
              </Text>
            </View>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}
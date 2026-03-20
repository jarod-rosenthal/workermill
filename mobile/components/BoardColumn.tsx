import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Column, Card } from '../types/boards';
import { BoardCard } from './BoardCard';
import { EmptyState } from './ui/EmptyState';

interface BoardColumnProps {
  column: Column;
  onCardPress: (cardId: string) => void;
  onCardLongPress?: (cardId: string) => void;
  onAddCard?: (columnId: string) => void;
}

export function BoardColumn({ column, onCardPress, onCardLongPress, onAddCard }: BoardColumnProps) {
  return (
    <View className="w-72 bg-slate-50 dark:bg-slate-800 rounded-lg mr-4">
      {/* Column header */}
      <View className="flex-row items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
        <View className="flex-1">
          <Text className="text-lg font-semibold text-slate-900 dark:text-white">
            {column.name}
          </Text>
          <Text className="text-sm text-slate-500 dark:text-slate-400">
            {column.cards.length} {column.cards.length === 1 ? 'card' : 'cards'}
          </Text>
        </View>

        {onAddCard && (
          <TouchableOpacity
            onPress={() => onAddCard(column.id)}
            className="p-2"
            style={{ minHeight: 44, minWidth: 44 }}
            accessibilityRole="button"
            accessibilityLabel={`Add card to ${column.name}`}
          >
            <Ionicons name="add" size={24} className="text-slate-600 dark:text-slate-400" />
          </TouchableOpacity>
        )}
      </View>

      {/* Cards list */}
      <ScrollView
        className="flex-1 p-3"
        showsVerticalScrollIndicator={true}
        contentContainerStyle={{ flexGrow: 1 }}
      >
        {column.cards.length === 0 ? (
          <View className="flex-1 justify-center items-center py-8">
            <Text className="text-slate-400 dark:text-slate-500 text-center">
              No cards
            </Text>
            {onAddCard && (
              <TouchableOpacity
                onPress={() => onAddCard(column.id)}
                className="mt-4 bg-brand-500 px-4 py-2 rounded-lg"
                style={{ minHeight: 44 }}
                accessibilityRole="button"
                accessibilityLabel="Add first card"
              >
                <Text className="text-white font-medium">
                  Add Card
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          column.cards
            .sort((a, b) => a.position - b.position)
            .map((card) => (
              <BoardCard
                key={card.id}
                card={card}
                onPress={onCardPress}
                onLongPress={onCardLongPress}
              />
            ))
        )}
      </ScrollView>
    </View>
  );
}
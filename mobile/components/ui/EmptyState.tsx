import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  message: string;
}

export function EmptyState({ icon = 'document-outline', message }: EmptyStateProps) {
  return (
    <View className="flex-1 justify-center items-center px-8">
      <Ionicons
        name={icon}
        size={64}
        className="text-slate-400 dark:text-slate-500 mb-4"
      />
      <Text className="text-lg text-slate-400 dark:text-slate-500 text-center">
        {message}
      </Text>
    </View>
  );
}
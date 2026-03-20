import React from 'react';
import { View, Text } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

interface EmptyStateProps {
  icon: keyof typeof MaterialIcons.glyphMap;
  message: string;
  className?: string;
}

export function EmptyState({ icon, message, className }: EmptyStateProps) {
  return (
    <View
      className={`flex-1 justify-center items-center px-8 py-12 ${className || ''}`}
      accessibilityRole="text"
      accessibilityLabel={message}
    >
      <MaterialIcons
        name={icon}
        size={64}
        color="#94a3b8"
        className="mb-4"
        accessibilityHidden={true}
      />
      <Text className="text-slate-400 text-center text-base leading-6">
        {message}
      </Text>
    </View>
  );
}
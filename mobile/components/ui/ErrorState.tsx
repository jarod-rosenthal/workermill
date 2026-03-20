import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
  className?: string;
}

export function ErrorState({ message, onRetry, className }: ErrorStateProps) {
  return (
    <View
      className={`flex-1 justify-center items-center px-8 py-12 ${className || ''}`}
      accessibilityRole="text"
      accessibilityLabel={message}
    >
      <MaterialIcons
        name="error-outline"
        size={64}
        color="#ef4444"
        className="mb-4"
        accessibilityHidden={true}
      />
      <Text className="text-slate-600 dark:text-slate-400 text-center text-base leading-6 mb-6">
        {message}
      </Text>
      <TouchableOpacity
        onPress={onRetry}
        className="bg-brand-600 px-6 py-3 rounded-lg min-h-[48] justify-center items-center"
        style={{ minWidth: 48, minHeight: 48 }}
        accessibilityRole="button"
        accessibilityLabel="Try again"
      >
        <Text className="text-white font-medium text-base">
          Try again
        </Text>
      </TouchableOpacity>
    </View>
  );
}
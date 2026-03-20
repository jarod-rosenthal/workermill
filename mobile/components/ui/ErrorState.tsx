import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <View className="flex-1 justify-center items-center px-8">
      <Ionicons
        name="alert-circle-outline"
        size={64}
        className="text-red-500 dark:text-red-400 mb-4"
      />
      <Text className="text-lg text-slate-600 dark:text-slate-300 text-center mb-6">
        {message}
      </Text>
      {onRetry && (
        <TouchableOpacity
          onPress={onRetry}
          className="bg-brand-500 px-6 py-3 rounded-lg"
          style={{ minHeight: 48, minWidth: 48 }}
          accessibilityRole="button"
          accessibilityLabel="Try again"
        >
          <Text className="text-white font-medium text-center">
            Try again
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
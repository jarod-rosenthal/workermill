import React from 'react';
import { View, Text } from 'react-native';
import { ContextMessage } from '../types/coordination';
import { Badge } from './ui/Badge';

interface CoordinationMessageProps {
  message: ContextMessage;
}

function getMessageTypeVariant(type: string) {
  switch (type) {
    case 'decision':
      return 'success';
    case 'question':
      return 'info';
    case 'blocker':
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    case 'completion':
      return 'success';
    default:
      return 'default';
  }
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffMins < 1) {
    return 'Just now';
  } else if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}

export function CoordinationMessage({ message }: CoordinationMessageProps) {
  return (
    <View className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 mb-3">
      <View className="flex-row items-start justify-between mb-2">
        <View className="flex-row items-center flex-1">
          <Text className="text-lg mr-2">
            {message.persona_emoji || '🤖'}
          </Text>
          <Text className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {message.persona}
          </Text>
          <View className="ml-2">
            <Badge variant={getMessageTypeVariant(message.message_type)} size="sm">
              {message.message_type}
            </Badge>
          </View>
        </View>
        <Text className="text-xs text-slate-500 dark:text-slate-400 ml-2">
          {formatTimestamp(message.created_at)}
        </Text>
      </View>

      <Text className="text-base text-slate-900 dark:text-white leading-relaxed">
        {message.content}
      </Text>
    </View>
  );
}
import React from 'react';
import { View, Text } from 'react-native';
import { ContextMessage, ContextMessageType } from '../types/coordination';
import { Badge } from './ui/Badge';

interface CoordinationMessageProps {
  message: ContextMessage;
}

// Message type color mappings
const messageTypeColors: Record<ContextMessageType, { bg: string; text: string }> = {
  decision: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-800 dark:text-blue-200' },
  question: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-800 dark:text-purple-200' },
  blocker: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-800 dark:text-red-200' },
  completion: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-800 dark:text-green-200' },
  progress: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-800 dark:text-yellow-200' },
  error: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-800 dark:text-red-200' },
  warning: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-800 dark:text-orange-200' },
  info: { bg: 'bg-slate-100 dark:bg-slate-900/30', text: 'text-slate-800 dark:text-slate-200' },
};

// Message type display labels
const messageTypeLabels: Record<ContextMessageType, string> = {
  decision: 'Decision',
  question: 'Question',
  blocker: 'Blocker',
  completion: 'Completed',
  progress: 'Progress',
  error: 'Error',
  warning: 'Warning',
  info: 'Info',
};

function TypeBadge({ messageType }: { messageType: ContextMessageType }) {
  const colors = messageTypeColors[messageType];
  const label = messageTypeLabels[messageType];

  return (
    <View
      className={`px-2 py-1 rounded-full ${colors.bg}`}
      accessibilityRole="text"
      accessibilityLabel={`Message type: ${label}`}
    >
      <Text className={`text-xs font-medium ${colors.text}`}>
        {label}
      </Text>
    </View>
  );
}

export function CoordinationMessage({ message }: CoordinationMessageProps) {
  const timestamp = new Date(message.created_at).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  return (
    <View
      className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-lg p-4 mb-3"
      accessibilityRole="text"
      accessibilityLabel={`Coordination message from ${message.persona}`}
    >
      {/* Header with persona, type badge, and timestamp */}
      <View className="flex-row items-start justify-between mb-3">
        <View className="flex-row items-center flex-1 mr-3">
          {/* Persona emoji and name */}
          <View className="flex-row items-center mr-3">
            {message.persona_emoji && (
              <Text
                className="text-lg mr-2"
                accessibilityLabel={`Persona: ${message.persona}`}
              >
                {message.persona_emoji}
              </Text>
            )}
            <Text
              className="text-sm font-medium text-slate-900 dark:text-slate-100"
              accessibilityRole="text"
            >
              {message.persona}
            </Text>
          </View>

          {/* Type badge */}
          <TypeBadge messageType={message.message_type} />
        </View>

        {/* Timestamp */}
        <Text
          className="text-xs text-slate-500 dark:text-slate-400 font-mono"
          accessibilityRole="text"
          accessibilityLabel={`Time: ${timestamp}`}
        >
          {timestamp}
        </Text>
      </View>

      {/* Message content */}
      <Text
        className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed"
        accessibilityRole="text"
        selectable
      >
        {message.content}
      </Text>

      {/* Metadata (if present) */}
      {message.metadata && Object.keys(message.metadata).length > 0 && (
        <View className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
          <Text className="text-xs text-slate-500 dark:text-slate-400 italic">
            Additional context available
          </Text>
        </View>
      )}
    </View>
  );
}
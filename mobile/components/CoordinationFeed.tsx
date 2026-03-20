import React from 'react';
import { ScrollView, RefreshControl } from 'react-native';
import { ContextMessage } from '../types/coordination';
import { CoordinationMessage } from './CoordinationMessage';
import { EmptyState } from './ui/EmptyState';

interface CoordinationFeedProps {
  messages: ContextMessage[];
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function CoordinationFeed({ messages, onRefresh, refreshing = false }: CoordinationFeedProps) {
  if (messages.length === 0) {
    return (
      <EmptyState
        icon="chatbubbles-outline"
        message="No coordination messages yet."
      />
    );
  }

  // Sort messages chronologically (newest first for scrolling)
  const sortedMessages = [...messages].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <ScrollView
      className="flex-1 bg-slate-50 dark:bg-slate-900 p-4"
      showsVerticalScrollIndicator={true}
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        ) : undefined
      }
    >
      {sortedMessages.map((message) => (
        <CoordinationMessage key={message.id} message={message} />
      ))}
    </ScrollView>
  );
}
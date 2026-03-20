import React, { useEffect, useRef } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { ContextMessage } from '../types/coordination';
import { CoordinationMessage } from './CoordinationMessage';
import { EmptyState } from './ui/EmptyState';
import { ErrorState } from './ui/ErrorState';

interface CoordinationFeedProps {
  messages: ContextMessage[];
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  autoScroll?: boolean;
  className?: string;
}

export function CoordinationFeed({
  messages,
  loading = false,
  error = null,
  onRefresh,
  autoScroll = true,
  className
}: CoordinationFeedProps) {
  const scrollViewRef = useRef<ScrollView>(null);

  // Sort messages in chronological order (oldest first, as per spec)
  const sortedMessages = [...messages].sort((a, b) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  // Auto-scroll to bottom when new messages arrive (if enabled)
  useEffect(() => {
    if (autoScroll && scrollViewRef.current && messages.length > 0) {
      // Add a small delay to ensure the new message is rendered
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length, autoScroll]);

  // Error state
  if (error) {
    return (
      <View className={`flex-1 ${className || ''}`}>
        <ErrorState
          message={error}
          onRetry={onRefresh || (() => {})}
        />
      </View>
    );
  }

  // Empty state
  if (!loading && sortedMessages.length === 0) {
    return (
      <View className={`flex-1 ${className || ''}`}>
        <EmptyState
          icon="chat"
          message="No coordination messages yet."
        />
      </View>
    );
  }

  return (
    <View className={`flex-1 ${className || ''}`}>
      <ScrollView
        ref={scrollViewRef}
        className="flex-1"
        contentContainerStyle={{ padding: 16, flexGrow: 1 }}
        showsVerticalScrollIndicator={true}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={loading}
              onRefresh={onRefresh}
              tintColor="#6366f1"
              colors={["#6366f1"]}
            />
          ) : undefined
        }
        accessibilityRole="scrollbar"
        accessibilityLabel="Coordination messages feed"
      >
        {sortedMessages.length === 0 && loading ? (
          // Loading state when no messages yet
          <View className="flex-1 items-center justify-center">
            <Text className="text-slate-400 text-sm italic">
              Loading coordination messages...
            </Text>
          </View>
        ) : (
          // Message list
          <View>
            {sortedMessages.map((message, index) => (
              <CoordinationMessage
                key={`${message.id}-${index}`}
                message={message}
              />
            ))}

            {/* Loading indicator at bottom when refreshing */}
            {loading && sortedMessages.length > 0 && (
              <View className="py-4 items-center">
                <Text className="text-slate-400 text-sm italic">
                  Loading new messages...
                </Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
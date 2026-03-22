import React, { useEffect, useRef, useMemo } from 'react';
import { View, Text, FlatList, RefreshControl } from 'react-native';
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
  const flatListRef = useRef<FlatList<ContextMessage>>(null);

  // Sort messages in chronological order (oldest first, as per spec)
  const sortedMessages = useMemo(() =>
    [...messages].sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    ),
    [messages]
  );

  // Auto-scroll to bottom when new messages arrive (if enabled)
  useEffect(() => {
    if (autoScroll && flatListRef.current && messages.length > 0) {
      // Add a small delay to ensure the new message is rendered
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
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
      <FlatList
        ref={flatListRef}
        data={sortedMessages}
        renderItem={({ item }) => <CoordinationMessage message={item} />}
        keyExtractor={(item, index) => `${item.id}-${index}`}
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
        accessibilityRole="list"
        accessibilityLabel="Coordination messages feed"
        ListEmptyComponent={
          loading ? (
            <View className="flex-1 items-center justify-center">
              <Text className="text-slate-400 text-sm italic">
                Loading coordination messages...
              </Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          loading && sortedMessages.length > 0 ? (
            <View className="py-4 items-center">
              <Text className="text-slate-400 text-sm italic">
                Loading new messages...
              </Text>
            </View>
          ) : null
        }
        initialNumToRender={30}
        maxToRenderPerBatch={10}
        windowSize={7}
      />
    </View>
  );
}
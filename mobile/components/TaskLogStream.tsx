import React, { useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TaskLog } from '../types/tasks';

interface TaskLogStreamProps {
  logs: TaskLog[];
  className?: string;
}

interface LogEntry {
  id: string;
  timestamp: string;
  type: 'stdout' | 'stderr' | 'system';
  message: string;
}

// Convert TaskLog to LogEntry format for rendering
function formatLogEntry(log: TaskLog): LogEntry {
  let type: 'stdout' | 'stderr' | 'system' = 'system';

  // Determine log type from level and source
  if (log.level === 'error' || log.source === 'system') {
    if (log.level === 'error') {
      type = 'stderr';
    } else {
      type = 'system';
    }
  } else {
    type = 'stdout';
  }

  return {
    id: log.id,
    timestamp: log.timestamp,
    type,
    message: log.message
  };
}

function LogLine({ entry }: { entry: LogEntry }) {
  const timestamp = new Date(entry.timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  // Format message based on type
  const formatMessage = () => {
    switch (entry.type) {
      case 'stderr':
        return `[err] ${entry.message}`;
      case 'system':
        return `[sys] ${entry.message}`;
      case 'stdout':
      default:
        return entry.message;
    }
  };

  // Get text color based on type
  const getTextColor = () => {
    switch (entry.type) {
      case 'stderr':
        return 'text-amber-400'; // amber text for stderr
      case 'system':
        return 'text-slate-400'; // slate text for system
      case 'stdout':
      default:
        return 'text-white'; // white text for stdout
    }
  };

  const isSystemLog = entry.type === 'system';

  return (
    <View className="flex-row" accessibilityRole="text">
      {/* Timestamp */}
      <Text
        className="text-xs font-mono text-slate-500 mr-2 w-20"
        accessibilityLabel={`Time: ${timestamp}`}
      >
        {timestamp}
      </Text>

      {/* Log message */}
      <Text
        className={`text-xs font-mono flex-1 leading-4 ${getTextColor()} ${isSystemLog ? 'italic' : ''}`}
        accessibilityRole="text"
        selectable
      >
        {formatMessage()}
      </Text>
    </View>
  );
}

export function TaskLogStream({ logs, className }: TaskLogStreamProps) {
  const flatListRef = useRef<FlatList>(null);
  const [isAutoScrolling, setIsAutoScrolling] = useState(true);
  const logEntries = useMemo(() => logs.map(formatLogEntry), [logs]);

  useEffect(() => {
    if (flatListRef.current && logs.length > 0 && isAutoScrolling) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 50);
    }
  }, [logs.length, isAutoScrolling]);

  const handleScroll = (event: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const isAtBottom = contentOffset.y >= contentSize.height - layoutMeasurement.height - 50;
    setIsAutoScrolling(isAtBottom);
  };

  const scrollToBottom = () => {
    flatListRef.current?.scrollToEnd({ animated: true });
    setIsAutoScrolling(true);
  };

  return (
    <View
      className={`flex-1 ${className || ''}`}
      accessibilityRole="text"
      accessibilityLabel="Task execution logs"
    >
      <FlatList
        ref={flatListRef}
        data={logEntries}
        renderItem={({ item }) => <LogLine entry={item} />}
        keyExtractor={(item, index) => `${item.id}-${index}`}
        className="flex-1 bg-slate-950"
        contentContainerStyle={{ padding: 12, flexGrow: 1 }}
        onScroll={handleScroll}
        scrollEventThrottle={100}
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center">
            <Text className="text-slate-400 text-sm italic">
              Waiting for logs...
            </Text>
          </View>
        }
        initialNumToRender={50}
        maxToRenderPerBatch={20}
        windowSize={10}
      />
      {!isAutoScrolling && logEntries.length > 0 && (
        <TouchableOpacity
          onPress={scrollToBottom}
          className="absolute bottom-4 right-4 bg-brand-500 w-10 h-10 rounded-full items-center justify-center shadow-lg"
          style={{ minHeight: 44, minWidth: 44 }}
          accessibilityRole="button"
          accessibilityLabel="Scroll to latest logs"
        >
          <Ionicons name="arrow-down" size={20} color="white" />
        </TouchableOpacity>
      )}
    </View>
  );
}
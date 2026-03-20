import React, { useRef, useEffect } from 'react';
import { ScrollView, Text, View } from 'react-native';

export interface LogEntry {
  id: string;
  timestamp: string;
  type: 'stdout' | 'stderr' | 'system';
  message: string;
}

interface TaskLogStreamProps {
  logs: LogEntry[];
  autoScroll?: boolean;
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function getLogStyles(type: LogEntry['type']) {
  switch (type) {
    case 'stdout':
      return 'text-white';
    case 'stderr':
      return 'text-amber-400';
    case 'system':
      return 'text-slate-400 italic';
    default:
      return 'text-white';
  }
}

function getLogPrefix(type: LogEntry['type']): string {
  switch (type) {
    case 'stderr':
      return '[err] ';
    case 'system':
      return '[sys] ';
    default:
      return '';
  }
}

export function TaskLogStream({ logs, autoScroll = true }: TaskLogStreamProps) {
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (autoScroll && scrollViewRef.current) {
      // Scroll to bottom when new logs are added
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [logs, autoScroll]);

  if (logs.length === 0) {
    return (
      <View className="flex-1 bg-slate-950 justify-center items-center">
        <Text className="text-slate-400 text-center">
          Waiting for logs...
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollViewRef}
      className="flex-1 bg-slate-950 p-4"
      showsVerticalScrollIndicator={true}
    >
      {logs.map((log) => (
        <View key={log.id} className="mb-1 flex-row">
          <Text className="text-slate-500 text-xs font-mono mr-2">
            {formatTimestamp(log.timestamp)}
          </Text>
          <Text className={`font-mono text-sm flex-1 ${getLogStyles(log.type)}`}>
            {getLogPrefix(log.type)}{log.message}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}
import React, { useEffect, useRef } from 'react';
import { View, Text, ScrollView } from 'react-native';
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
  const scrollViewRef = useRef<ScrollView>(null);
  const logEntries = logs.map(formatLogEntry);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollViewRef.current && logs.length > 0) {
      scrollViewRef.current.scrollToEnd({ animated: true });
    }
  }, [logs.length]);

  return (
    <View
      className={`flex-1 ${className || ''}`}
      accessibilityRole="text"
      accessibilityLabel="Task execution logs"
    >
      <ScrollView
        ref={scrollViewRef}
        className="flex-1 bg-slate-950 p-3"
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={true}
      >
        {logEntries.length === 0 ? (
          <View className="flex-1 items-center justify-center">
            <Text className="text-slate-400 text-sm italic">
              Waiting for logs...
            </Text>
          </View>
        ) : (
          <View>
            {logEntries.map((entry, index) => (
              <LogLine key={`${entry.id}-${index}`} entry={entry} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
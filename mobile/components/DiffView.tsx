import React from 'react';
import { ScrollView, Text, View } from 'react-native';

// For now, we'll simplify the DiffView to avoid complex syntax highlighting deps
// In the future, this can be enhanced with proper syntax highlighting

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  lineNumber?: number;
}

export interface FileDiff {
  fileName: string;
  language: string;
  lines: DiffLine[];
}

interface DiffViewProps {
  diff: FileDiff;
}

function getLineStyle(type: DiffLine['type']) {
  switch (type) {
    case 'add':
      return 'bg-green-900/30 border-l-4 border-green-500';
    case 'remove':
      return 'bg-red-900/30 border-l-4 border-red-500';
    default:
      return 'bg-transparent';
  }
}

function getLinePrefix(type: DiffLine['type']): string {
  switch (type) {
    case 'add':
      return '+ ';
    case 'remove':
      return '- ';
    default:
      return '  ';
  }
}

export function DiffView({ diff }: DiffViewProps) {
  // If it's a simple file (no diff lines), show the filename
  if (diff.lines.length === 0) {
    return (
      <View className="bg-slate-950">
        <View className="bg-slate-800 px-4 py-2 border-b border-slate-700">
          <Text className="text-sm font-mono text-slate-300">
            {diff.fileName}
          </Text>
        </View>
        <View className="p-4">
          <Text className="text-slate-400 font-mono text-sm">
            // Empty file
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="bg-slate-950">
      {/* File header */}
      <View className="bg-slate-800 px-4 py-2 border-b border-slate-700">
        <Text className="text-sm font-mono text-slate-300">
          {diff.fileName}
        </Text>
      </View>

      {/* Diff content */}
      <ScrollView horizontal showsHorizontalScrollIndicator={true}>
        <View className="min-w-full">
          {diff.lines.map((line, index) => (
            <View key={index} className={`flex-row ${getLineStyle(line.type)}`}>
              <Text className="text-xs font-mono text-slate-500 w-12 text-right px-2 py-1">
                {line.lineNumber || index + 1}
              </Text>
              <Text className="flex-1 text-sm font-mono text-white px-2 py-1">
                {getLinePrefix(line.type)}{line.content}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
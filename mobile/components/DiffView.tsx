import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';

interface FileChange {
  filename: string;
  type: 'create' | 'edit' | 'delete';
  oldContent?: string;
  newContent?: string;
  diffLines?: DiffLine[];
}

interface DiffLine {
  type: 'add' | 'remove' | 'context';
  lineNumber?: number;
  content: string;
}

interface DiffViewProps {
  files: FileChange[];
  className?: string;
}

// Helper function to get file extension for basic language detection
function getFileLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';

  const languageMap: Record<string, string> = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'py': 'python',
    'rb': 'ruby',
    'go': 'go',
    'rs': 'rust',
    'java': 'java',
    'kt': 'kotlin',
    'swift': 'swift',
    'cpp': 'cpp',
    'c': 'c',
    'h': 'c',
    'hpp': 'cpp',
    'cs': 'csharp',
    'php': 'php',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'json': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'xml': 'xml',
    'sql': 'sql',
    'sh': 'bash',
    'md': 'markdown',
  };

  return languageMap[ext] || 'text';
}

// Helper function to generate diff lines from old/new content
function generateDiffLines(oldContent: string = '', newContent: string = ''): DiffLine[] {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const diffLines: DiffLine[] = [];

  // Simple diff algorithm (for demonstration - in real app would use proper diff library)
  const maxLines = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLines; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine === undefined) {
      // Line added
      diffLines.push({
        type: 'add',
        lineNumber: i + 1,
        content: newLine
      });
    } else if (newLine === undefined) {
      // Line removed
      diffLines.push({
        type: 'remove',
        lineNumber: i + 1,
        content: oldLine
      });
    } else if (oldLine === newLine) {
      // Line unchanged
      diffLines.push({
        type: 'context',
        lineNumber: i + 1,
        content: oldLine
      });
    } else {
      // Line changed (show as remove + add)
      diffLines.push({
        type: 'remove',
        lineNumber: i + 1,
        content: oldLine
      });
      diffLines.push({
        type: 'add',
        lineNumber: i + 1,
        content: newLine
      });
    }
  }

  return diffLines;
}

function FileTab({
  file,
  isSelected,
  onSelect
}: {
  file: FileChange;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const getTypeIcon = () => {
    switch (file.type) {
      case 'create':
        return '+';
      case 'delete':
        return '−';
      case 'edit':
      default:
        return '∆';
    }
  };

  const getTypeColor = () => {
    switch (file.type) {
      case 'create':
        return 'text-green-500';
      case 'delete':
        return 'text-red-500';
      case 'edit':
      default:
        return 'text-blue-500';
    }
  };

  return (
    <TouchableOpacity
      onPress={onSelect}
      className={`
        px-3 py-2 mr-2 rounded-t-lg border-b-2
        ${isSelected
          ? 'bg-slate-100 dark:bg-slate-800 border-blue-500'
          : 'bg-slate-50 dark:bg-slate-900 border-transparent'
        }
      `}
      style={{ minHeight: 44, minWidth: 44 }} // Minimum touch target
      accessibilityRole="tab"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={`${file.type} ${file.filename}`}
    >
      <View className="flex-row items-center">
        <Text className={`text-sm font-mono mr-1 ${getTypeColor()}`}>
          {getTypeIcon()}
        </Text>
        <Text
          className="text-sm font-mono text-slate-700 dark:text-slate-300"
          numberOfLines={1}
        >
          {file.filename.split('/').pop()}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function CodeContent({ content, language: _language }: { content: string; language: string }) {
  // Simple syntax highlighting for basic cases
  // In a real implementation, would use a proper syntax highlighting library
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={true}
      className="flex-1"
    >
      <View className="p-4">
        <Text
          className="text-xs font-mono text-slate-200 leading-5"
          selectable
        >
          {content}
        </Text>
      </View>
    </ScrollView>
  );
}

function DiffContent({ file }: { file: FileChange }) {
  const language = getFileLanguage(file.filename);
  const diffLines = file.diffLines || generateDiffLines(file.oldContent, file.newContent);

  // For new files, just show the content
  if (file.type === 'create' && file.newContent) {
    return (
      <View className="flex-1 bg-green-50 dark:bg-green-900/20">
        <CodeContent content={file.newContent} language={language} />
      </View>
    );
  }

  // For deleted files, show the old content
  if (file.type === 'delete' && file.oldContent) {
    return (
      <View className="flex-1 bg-red-50 dark:bg-red-900/20">
        <CodeContent content={file.oldContent} language={language} />
      </View>
    );
  }

  // For edited files, show line-by-line diff
  return (
    <ScrollView className="flex-1" showsVerticalScrollIndicator={true}>
      {diffLines.map((line, index) => {
        const bgColor = line.type === 'add'
          ? 'bg-green-50 dark:bg-green-900/20'
          : line.type === 'remove'
          ? 'bg-red-50 dark:bg-red-900/20'
          : 'bg-transparent';

        const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
        const prefixColor = line.type === 'add'
          ? 'text-green-600'
          : line.type === 'remove'
          ? 'text-red-600'
          : 'text-slate-500';

        return (
          <View key={index} className={`flex-row ${bgColor}`}>
            <Text className={`text-xs font-mono w-8 text-center ${prefixColor}`}>
              {prefix}
            </Text>
            <Text className={`text-xs font-mono w-12 text-right pr-2 text-slate-500`}>
              {line.lineNumber}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Text
                className="text-xs font-mono text-slate-800 dark:text-slate-200 min-w-full"
                selectable
              >
                {line.content}
              </Text>
            </ScrollView>
          </View>
        );
      })}
    </ScrollView>
  );
}

export function DiffView({ files, className }: DiffViewProps) {
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);

  if (files.length === 0) {
    return (
      <View className={`flex-1 items-center justify-center ${className || ''}`}>
        <Text className="text-slate-400 text-sm italic">
          No file changes yet.
        </Text>
      </View>
    );
  }

  const selectedFile = files[selectedFileIndex];

  return (
    <View className={`flex-1 ${className || ''}`}>
      {/* File tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8 }}
      >
        {files.map((file, index) => (
          <FileTab
            key={`${file.filename}-${index}`}
            file={file}
            isSelected={index === selectedFileIndex}
            onSelect={() => setSelectedFileIndex(index)}
          />
        ))}
      </ScrollView>

      {/* File header */}
      <View className="px-4 py-3 bg-white dark:bg-slate-850 border-b border-slate-200 dark:border-slate-700">
        <Text
          className="text-sm font-mono text-slate-900 dark:text-slate-100"
          accessibilityRole="text"
        >
          {selectedFile.filename}
        </Text>
        <Text className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          {selectedFile.type === 'create' && 'New file'}
          {selectedFile.type === 'delete' && 'Deleted file'}
          {selectedFile.type === 'edit' && 'Modified file'}
        </Text>
      </View>

      {/* Diff content */}
      <View className="flex-1 bg-slate-950">
        <DiffContent file={selectedFile} />
      </View>
    </View>
  );
}
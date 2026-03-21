import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
  RefreshControl,
  ActionSheetIOS,
  Platform,
  Switch,
} from 'react-native';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import MarkdownDisplay from 'react-native-markdown-display';
import { useBoardsStore } from '@/stores/boards-store';
import { Card, ChecklistItem, CardActivity } from '@/types/boards';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';

interface EditableFieldProps {
  label: string;
  value: string;
  onSave: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
}

function EditableField({ label, value, onSave, multiline, placeholder }: EditableFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);

  const handleSave = useCallback(() => {
    onSave(editValue.trim());
    setIsEditing(false);
  }, [editValue, onSave]);

  const handleCancel = useCallback(() => {
    setEditValue(value);
    setIsEditing(false);
  }, [value]);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  if (isEditing) {
    return (
      <View className="mb-4">
        <Text className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          {label}
        </Text>
        <TextInput
          value={editValue}
          onChangeText={setEditValue}
          placeholder={placeholder}
          placeholderTextColor="#9ca3af"
          className="px-3 py-3 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800"
          multiline={multiline}
          numberOfLines={multiline ? 4 : 1}
          textAlignVertical={multiline ? 'top' : 'center'}
          autoFocus
          accessibilityLabel={`Edit ${label.toLowerCase()}`}
        />
        <View className="flex-row mt-2">
          <TouchableOpacity
            onPress={handleSave}
            className="bg-blue-600 px-4 py-2 rounded-lg mr-2"
            style={{ minHeight: 44 }}
            accessibilityRole="button"
            accessibilityLabel="Save changes"
          >
            <Text className="text-white font-medium">Save</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleCancel}
            className="border border-slate-300 dark:border-slate-600 px-4 py-2 rounded-lg"
            style={{ minHeight: 44 }}
            accessibilityRole="button"
            accessibilityLabel="Cancel editing"
          >
            <Text className="text-slate-700 dark:text-slate-300 font-medium">Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View className="mb-4">
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-sm font-medium text-slate-700 dark:text-slate-300">
          {label}
        </Text>
        <TouchableOpacity
          onPress={() => setIsEditing(true)}
          className="p-1"
          style={{ minHeight: 44, minWidth: 44 }}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${label.toLowerCase()}`}
        >
          <Ionicons name="pencil" size={16} className="text-slate-500" />
        </TouchableOpacity>
      </View>
      {multiline && value ? (
        <View className="border border-slate-200 dark:border-slate-700 rounded-lg p-3">
          <MarkdownDisplay
            style={{
              body: { fontSize: 14, color: '#1e293b' },
              paragraph: { marginTop: 0, marginBottom: 8 },
            }}
          >
            {value || placeholder || 'No description'}
          </MarkdownDisplay>
        </View>
      ) : (
        <Text
          className={`text-slate-900 dark:text-slate-100 ${
            !value ? 'text-slate-500 dark:text-slate-400 italic' : ''
          }`}
          accessibilityRole="text"
        >
          {value || placeholder || 'Not set'}
        </Text>
      )}
    </View>
  );
}

interface PrioritySelectorProps {
  value: 'urgent' | 'high' | 'medium' | 'low';
  onSelect: (priority: 'urgent' | 'high' | 'medium' | 'low') => void;
}

const priorityOptions = [
  { key: 'urgent', label: 'Urgent', color: '#ef4444' },
  { key: 'high', label: 'High', color: '#f97316' },
  { key: 'medium', label: 'Medium', color: '#eab308' },
  { key: 'low', label: 'Low', color: '#22c55e' },
] as const;

function PrioritySelector({ value, onSelect }: PrioritySelectorProps) {

  const currentPriority = priorityOptions.find(p => p.key === value)!;

  const handlePress = useCallback(() => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...priorityOptions.map(p => p.label), 'Cancel'],
          cancelButtonIndex: priorityOptions.length,
          title: 'Select priority',
        },
        (buttonIndex) => {
          if (buttonIndex < priorityOptions.length) {
            onSelect(priorityOptions[buttonIndex].key);
          }
        }
      );
    } else {
      // Android
      Alert.alert(
        'Select Priority',
        '',
        [
          ...priorityOptions.map(p => ({
            text: p.label,
            onPress: () => onSelect(p.key),
          })),
          { text: 'Cancel', style: 'cancel' },
        ]
      );
    }
  }, [onSelect]);

  return (
    <View className="mb-4">
      <Text className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
        Priority
      </Text>
      <TouchableOpacity
        onPress={handlePress}
        className="flex-row items-center px-3 py-3 border border-slate-300 dark:border-slate-600 rounded-lg"
        style={{ minHeight: 48 }}
        accessibilityRole="button"
        accessibilityLabel={`Priority: ${currentPriority.label}. Tap to change`}
      >
        <View
          className="w-3 h-3 rounded-full mr-3"
          style={{ backgroundColor: currentPriority.color }}
        />
        <Text className="flex-1 text-slate-900 dark:text-slate-100">
          {currentPriority.label}
        </Text>
        <Ionicons name="chevron-down" size={16} className="text-slate-500" />
      </TouchableOpacity>
    </View>
  );
}

interface ChecklistSectionProps {
  items: ChecklistItem[];
  onToggleItem: (itemId: string, isCompleted: boolean) => void;
  onAddItem: (title: string) => void;
  onDeleteItem: (itemId: string) => void;
}

function ChecklistSection({ items, onToggleItem, onAddItem, onDeleteItem }: ChecklistSectionProps) {
  const [newItemText, setNewItemText] = useState('');
  const [isAddingItem, setIsAddingItem] = useState(false);

  const handleAddItem = useCallback(() => {
    if (!newItemText.trim()) return;

    onAddItem(newItemText.trim());
    setNewItemText('');
    setIsAddingItem(false);
  }, [newItemText, onAddItem]);

  const handleDeleteItem = useCallback((item: ChecklistItem) => {
    Alert.alert(
      'Delete Item',
      `Delete "${item.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => onDeleteItem(item.id) },
      ]
    );
  }, [onDeleteItem]);

  const completedCount = items.filter(item => item.isCompleted).length;

  return (
    <View className="mb-6">
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-sm font-medium text-slate-700 dark:text-slate-300">
          Checklist {items.length > 0 && `(${completedCount}/${items.length})`}
        </Text>
        <TouchableOpacity
          onPress={() => setIsAddingItem(true)}
          className="p-2"
          style={{ minHeight: 44, minWidth: 44 }}
          accessibilityRole="button"
          accessibilityLabel="Add checklist item"
        >
          <Ionicons name="add" size={16} className="text-slate-500" />
        </TouchableOpacity>
      </View>

      {items.length === 0 && !isAddingItem ? (
        <EmptyState
          icon="list"
          message="No checklist items."
        />
      ) : (
        <View>
          {items
            .sort((a, b) => a.position - b.position)
            .map((item) => (
              <View
                key={item.id}
                className="flex-row items-center py-2 border-b border-slate-100 dark:border-slate-800 last:border-b-0"
              >
                <Switch
                  value={item.isCompleted}
                  onValueChange={(isCompleted) => onToggleItem(item.id, isCompleted)}
                  trackColor={{ false: '#e2e8f0', true: '#22c55e' }}
                  thumbColor="#ffffff"
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: item.isCompleted }}
                  accessibilityLabel={`${item.isCompleted ? 'Completed' : 'Incomplete'}: ${item.title}`}
                />
                <Text
                  className={`flex-1 ml-3 ${
                    item.isCompleted
                      ? 'text-slate-500 dark:text-slate-400 line-through'
                      : 'text-slate-900 dark:text-slate-100'
                  }`}
                  accessibilityRole="text"
                >
                  {item.title}
                </Text>
                <TouchableOpacity
                  onPress={() => handleDeleteItem(item)}
                  className="p-2"
                  style={{ minHeight: 44, minWidth: 44 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete item: ${item.title}`}
                >
                  <Ionicons name="trash-outline" size={16} className="text-red-500" />
                </TouchableOpacity>
              </View>
            ))}
        </View>
      )}

      {isAddingItem && (
        <View className="mt-3">
          <TextInput
            value={newItemText}
            onChangeText={setNewItemText}
            placeholder="Enter checklist item"
            placeholderTextColor="#9ca3af"
            className="px-3 py-3 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800 mb-2"
            autoFocus
            accessibilityLabel="New checklist item"
          />
          <View className="flex-row">
            <TouchableOpacity
              onPress={handleAddItem}
              disabled={!newItemText.trim()}
              className={`px-4 py-2 rounded-lg mr-2 ${
                newItemText.trim()
                  ? 'bg-blue-600'
                  : 'bg-slate-300 dark:bg-slate-600'
              }`}
              style={{ minHeight: 44 }}
              accessibilityRole="button"
              accessibilityLabel="Save checklist item"
            >
              <Text className={`font-medium ${
                newItemText.trim() ? 'text-white' : 'text-slate-500'
              }`}>
                Add
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setIsAddingItem(false);
                setNewItemText('');
              }}
              className="border border-slate-300 dark:border-slate-600 px-4 py-2 rounded-lg"
              style={{ minHeight: 44 }}
              accessibilityRole="button"
              accessibilityLabel="Cancel adding item"
            >
              <Text className="text-slate-700 dark:text-slate-300 font-medium">Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

interface ActivitySectionProps {
  activities: CardActivity[];
  isLoading: boolean;
  onRefresh: () => void;
}

function ActivitySection({ activities, isLoading, onRefresh }: ActivitySectionProps) {
  const formatActivityMessage = useCallback((activity: CardActivity) => {
    switch (activity.action) {
      case 'created':
        return `Card created by ${activity.userName}`;
      case 'moved':
        return `Moved from ${activity.details?.fromColumn} to ${activity.details?.toColumn} by ${activity.userName}`;
      case 'edited':
        return `${activity.details?.fieldChanged} updated by ${activity.userName}`;
      case 'task_started':
        return 'AI task started';
      case 'task_completed':
        return 'AI task completed';
      case 'task_failed':
        return 'AI task failed';
      default:
        return `${activity.action} by ${activity.userName}`;
    }
  }, []);

  const getActivityIcon = useCallback((action: string) => {
    switch (action) {
      case 'created': return 'add-circle-outline';
      case 'moved': return 'arrow-forward-outline';
      case 'edited': return 'pencil-outline';
      case 'task_started': return 'play-outline';
      case 'task_completed': return 'checkmark-circle-outline';
      case 'task_failed': return 'close-circle-outline';
      default: return 'ellipse-outline';
    }
  }, []);

  const formatTimestamp = useCallback((timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  }, []);

  if (isLoading) {
    return (
      <View className="mb-6">
        <Text className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
          Activity
        </Text>
        <View className="justify-center items-center py-8">
          <Spinner />
        </View>
      </View>
    );
  }

  return (
    <View className="mb-6">
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-sm font-medium text-slate-700 dark:text-slate-300">
          Activity
        </Text>
        <TouchableOpacity
          onPress={onRefresh}
          className="p-2"
          style={{ minHeight: 44, minWidth: 44 }}
          accessibilityRole="button"
          accessibilityLabel="Refresh activity"
        >
          <Ionicons name="refresh" size={16} className="text-slate-500" />
        </TouchableOpacity>
      </View>

      {activities.length === 0 ? (
        <EmptyState
          icon="timer"
          message="No activity yet."
        />
      ) : (
        <View>
          {activities.map((activity) => (
            <View
              key={activity.id}
              className="flex-row py-3 border-b border-slate-100 dark:border-slate-800 last:border-b-0"
            >
              <Ionicons
                name={getActivityIcon(activity.action) as any}
                size={16}
                className="text-slate-500 mr-3 mt-1"
              />
              <View className="flex-1">
                <Text
                  className="text-sm text-slate-900 dark:text-slate-100 mb-1"
                  accessibilityRole="text"
                >
                  {formatActivityMessage(activity)}
                </Text>
                <Text
                  className="text-xs text-slate-500 dark:text-slate-400"
                  accessibilityRole="text"
                >
                  {formatTimestamp(activity.createdAt)}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export default function CardDetailScreen() {
  const { id: boardId, cardId } = useLocalSearchParams<{ id: string; cardId: string }>();
  const {
    currentBoard,
    isBoardLoading,
    error,
    loadBoard,
    updateCard,
    addChecklistItem,
    updateChecklistItem,
    deleteChecklistItem,
    getCardActivity,
    runCardAsTask,
    cancelCardTask,
    deleteCard,
    moveCard,
  } = useBoardsStore();

  const [activities, setActivities] = useState<CardActivity[]>([]);
  const [isLoadingActivity, setIsLoadingActivity] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Get the current card from the board data
  const card = useMemo(() => {
    if (!currentBoard || !cardId) return null;
    for (const column of currentBoard.columns) {
      const foundCard = column.cards.find(c => c.id === cardId);
      if (foundCard) return foundCard;
    }
    return null;
  }, [currentBoard, cardId]);

  // Load board data when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      if (boardId) {
        loadBoard(boardId).catch(() => {}); // Error handled by store
      }
    }, [boardId, loadBoard])
  );

  const loadActivity = useCallback(async () => {
    if (!boardId || !cardId) return;

    setIsLoadingActivity(true);
    try {
      const activityData = await getCardActivity(boardId, cardId);
      setActivities(activityData);
    } catch (error) {
      // Error handled by store
    } finally {
      setIsLoadingActivity(false);
    }
  }, [boardId, cardId, getCardActivity]);

  // Load activity data when card is available
  useEffect(() => {
    if (boardId && cardId && card) {
      loadActivity();
    }
  }, [boardId, cardId, card, loadActivity]);

  const handleRefresh = useCallback(async () => {
    if (!boardId) return;

    setIsRefreshing(true);
    try {
      await Promise.all([
        loadBoard(boardId),
        loadActivity(),
      ]);
    } catch (error) {
      // Error handled by store
    } finally {
      setIsRefreshing(false);
    }
  }, [boardId, loadBoard, loadActivity]);

  const handleUpdateCard = useCallback(async (field: keyof Card, value: any) => {
    if (!boardId || !cardId) return;

    try {
      await updateCard(boardId, cardId, { [field]: value });
      // Reload activity to show the edit activity
      loadActivity();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update card');
    }
  }, [boardId, cardId, updateCard, loadActivity]);

  const handleToggleChecklistItem = useCallback(async (itemId: string, isCompleted: boolean) => {
    if (!boardId || !cardId) return;

    try {
      await updateChecklistItem(boardId, cardId, itemId, { isCompleted });
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update checklist item');
    }
  }, [boardId, cardId, updateChecklistItem]);

  const handleAddChecklistItem = useCallback(async (text: string) => {
    if (!boardId || !cardId) return;

    try {
      await addChecklistItem(boardId, cardId, text);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to add checklist item');
    }
  }, [boardId, cardId, addChecklistItem]);

  const handleDeleteChecklistItem = useCallback(async (itemId: string) => {
    if (!boardId || !cardId) return;

    try {
      await deleteChecklistItem(boardId, cardId, itemId);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to delete checklist item');
    }
  }, [boardId, cardId, deleteChecklistItem]);

  const handleRunAsTask = useCallback(async () => {
    if (!boardId || !cardId) return;

    try {
      await runCardAsTask(boardId, cardId);
      Alert.alert('Success', 'Task has been created and will start running');
      // Reload data to show task status
      handleRefresh();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to run card as task');
    }
  }, [boardId, cardId, runCardAsTask, handleRefresh]);

  const handleCancelTask = useCallback(async () => {
    if (!boardId || !cardId) return;

    Alert.alert(
      'Cancel Task',
      'Are you sure you want to cancel the running task?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            try {
              await cancelCardTask(boardId, cardId);
              Alert.alert('Success', 'Task has been cancelled');
              handleRefresh();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to cancel task');
            }
          },
        },
      ]
    );
  }, [boardId, cardId, cancelCardTask, handleRefresh]);

  const handleDeleteCard = useCallback(async () => {
    if (!boardId || !cardId || !card) return;

    Alert.alert(
      'Delete Card',
      `Are you sure you want to delete "${card.title}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteCard(boardId, cardId);
              router.back();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to delete card');
            }
          },
        },
      ]
    );
  }, [boardId, cardId, card, deleteCard]);

  const handleMoveCard = useCallback(() => {
    if (!currentBoard || !card) return;

    const columnOptions = currentBoard.columns
      .filter(col => col.id !== card.columnId)
      .map(col => col.name);

    if (columnOptions.length === 0) {
      Alert.alert('Info', 'No other columns available');
      return;
    }

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...columnOptions, 'Cancel'],
          cancelButtonIndex: columnOptions.length,
          title: 'Move card to column',
        },
        async (buttonIndex) => {
          if (buttonIndex < columnOptions.length) {
            const selectedColumn = currentBoard.columns.find(col => col.name === columnOptions[buttonIndex]);
            if (selectedColumn) {
              try {
                await moveCard(boardId!, cardId!, selectedColumn.id);
                handleRefresh();
              } catch (error: any) {
                Alert.alert('Error', error.message || 'Failed to move card');
              }
            }
          }
        }
      );
    } else {
      Alert.alert(
        'Move Card',
        'Select destination column:',
        [
          ...columnOptions.map(colName => ({
            text: colName,
            onPress: async () => {
              const selectedColumn = currentBoard.columns.find(col => col.name === colName);
              if (selectedColumn) {
                try {
                  await moveCard(boardId!, cardId!, selectedColumn.id);
                  handleRefresh();
                } catch (error: any) {
                  Alert.alert('Error', error.message || 'Failed to move card');
                }
              }
            },
          })),
          { text: 'Cancel', style: 'cancel' },
        ]
      );
    }
  }, [currentBoard, card, boardId, cardId, moveCard, handleRefresh]);

  if (isBoardLoading && !currentBoard) {
    return (
      <View className="flex-1 justify-center items-center bg-white dark:bg-slate-950">
        <Spinner />
      </View>
    );
  }

  if (error && !currentBoard) {
    return (
      <View className="flex-1 justify-center items-center bg-white dark:bg-slate-950 px-4">
        <ErrorState
          message="Could not load card"
          onRetry={() => router.back()}
        />
      </View>
    );
  }

  if (!card) {
    return (
      <View className="flex-1 justify-center items-center bg-white dark:bg-slate-950 px-4">
        <ErrorState
          message="Card not found"
          onRetry={() => router.back()}
        />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: card.issueKey,
          headerTitleStyle: {
            fontSize: 18,
            fontWeight: '600',
          },
          headerRight: () => (
            <TouchableOpacity
              onPress={() => {
                const options = [
                  'Run as AI Task',
                  ...(card.workerTaskId ? ['Cancel Task'] : []),
                  'Move to Column',
                  'Delete Card',
                  'Cancel'
                ];

                if (Platform.OS === 'ios') {
                  ActionSheetIOS.showActionSheetWithOptions(
                    {
                      options,
                      destructiveButtonIndex: options.indexOf('Delete Card'),
                      cancelButtonIndex: options.length - 1,
                    },
                    (buttonIndex) => {
                      switch (options[buttonIndex]) {
                        case 'Run as AI Task':
                          handleRunAsTask();
                          break;
                        case 'Cancel Task':
                          handleCancelTask();
                          break;
                        case 'Move to Column':
                          handleMoveCard();
                          break;
                        case 'Delete Card':
                          handleDeleteCard();
                          break;
                      }
                    }
                  );
                } else {
                  Alert.alert(
                    'Card Actions',
                    'Choose an action',
                    [
                      { text: 'Run as Task', onPress: handleRunAsTask },
                      ...(card.workerTaskId ? [{ text: 'Cancel Task', onPress: handleCancelTask }] : []),
                      { text: 'Move', onPress: handleMoveCard },
                      { text: 'Delete', style: 'destructive' as const, onPress: handleDeleteCard },
                      { text: 'Cancel', style: 'cancel' as const },
                    ]
                  );
                }
              }}
              className="p-2"
              style={{ minHeight: 44, minWidth: 44 }}
              accessibilityRole="button"
              accessibilityLabel="Card actions menu"
            >
              <Ionicons name="ellipsis-horizontal" size={24} className="text-blue-600" />
            </TouchableOpacity>
          ),
        }}
      />

      <ScrollView
        className="flex-1 bg-white dark:bg-slate-950"
        contentContainerStyle={{ padding: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            colors={['#6366f1']}
            tintColor="#6366f1"
          />
        }
      >
        {/* Worker status */}
        {card.workerStatus && (
          <View className="mb-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Worker Status
              </Text>
              <StatusBadge status={card.workerStatus as any} />
            </View>
            {card.workerTaskId && (
              <TouchableOpacity
                onPress={() => router.push(`/task/${card.workerTaskId}`)}
                className="mt-2 p-2 bg-blue-50 dark:bg-blue-950 rounded-lg"
                style={{ minHeight: 44 }}
                accessibilityRole="button"
                accessibilityLabel="View task details"
              >
                <Text className="text-blue-600 dark:text-blue-400 text-sm font-medium">
                  View Task Details →
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Editable fields */}
        <EditableField
          label="Title"
          value={card.title}
          onSave={(value) => handleUpdateCard('title', value)}
          placeholder="Enter card title"
        />

        <EditableField
          label="Description"
          value={card.description || ''}
          onSave={(value) => handleUpdateCard('description', value)}
          multiline
          placeholder="Add a description..."
        />

        <PrioritySelector
          value={card.priority}
          onSelect={(priority) => handleUpdateCard('priority', priority)}
        />

        {/* Labels section */}
        {card.labels.length > 0 && (
          <View className="mb-4">
            <Text className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Labels
            </Text>
            <View className="flex-row flex-wrap">
              {card.labels.map((label) => (
                <View
                  key={label.id}
                  className="px-2 py-1 rounded-full mr-2 mb-2"
                  style={{ backgroundColor: label.color }}
                >
                  <Text className="text-xs font-medium text-white">
                    {label.name}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Checklist */}
        <ChecklistSection
          items={card.checklistItems}
          onToggleItem={handleToggleChecklistItem}
          onAddItem={handleAddChecklistItem}
          onDeleteItem={handleDeleteChecklistItem}
        />

        {/* Dependencies */}
        {card.dependencies.length > 0 && (
          <View className="mb-6">
            <Text className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
              Dependencies
            </Text>
            {card.dependencies.map((dep) => (
              <View
                key={dep.cardId}
                className="flex-row items-center py-2 border border-slate-200 dark:border-slate-700 rounded-lg px-3 mb-2"
              >
                <Ionicons
                  name="link-outline"
                  size={16}
                  className="text-slate-500 mr-3"
                />
                <View className="flex-1">
                  <Text className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {dep.title}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Activity */}
        <ActivitySection
          activities={activities}
          isLoading={isLoadingActivity}
          onRefresh={loadActivity}
        />
      </ScrollView>
    </>
  );
}
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
  Modal,
  TextInput,
  ActionSheetIOS,
  Platform,
} from 'react-native';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBoardsStore } from '@/stores/boards-store';
import { Card } from '@/types/boards';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/ErrorState';
import { BoardColumn } from '@/components/BoardColumn';

interface NewCardModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: { title: string; description: string; priority: 'urgent' | 'high' | 'medium' | 'low' }) => void;
  isLoading: boolean;
  columnName?: string;
}

function NewCardModal({ visible, onClose, onSubmit, isLoading, columnName }: NewCardModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'urgent' | 'high' | 'medium' | 'low'>('medium');

  const handleSubmit = useCallback(() => {
    if (!title.trim()) {
      Alert.alert('Error', 'Card title is required');
      return;
    }

    onSubmit({
      title: title.trim(),
      description: description.trim(),
      priority,
    });
  }, [title, description, priority, onSubmit]);

  const handleClose = useCallback(() => {
    setTitle('');
    setDescription('');
    setPriority('medium');
    onClose();
  }, [onClose]);

  const priorityOptions = [
    { key: 'urgent', label: 'Urgent', color: '#ef4444' },
    { key: 'high', label: 'High', color: '#f97316' },
    { key: 'medium', label: 'Medium', color: '#eab308' },
    { key: 'low', label: 'Low', color: '#22c55e' },
  ] as const;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View className="flex-1 bg-white dark:bg-slate-950">
        {/* Header */}
        <View className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <View className="flex-row items-center justify-between">
            <TouchableOpacity
              onPress={handleClose}
              className="p-2"
              style={{ minHeight: 44, minWidth: 44 }}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text className="text-base text-slate-600 dark:text-slate-400">Cancel</Text>
            </TouchableOpacity>

            <Text
              className="text-lg font-semibold text-slate-900 dark:text-slate-100"
              accessibilityRole="header"
            >
              New Card{columnName ? ` in ${columnName}` : ''}
            </Text>

            <TouchableOpacity
              onPress={handleSubmit}
              disabled={isLoading || !title.trim()}
              className="p-2"
              style={{ minHeight: 44, minWidth: 44 }}
              accessibilityRole="button"
              accessibilityLabel="Create card"
            >
              <Text
                className={`text-base font-medium ${
                  isLoading || !title.trim()
                    ? 'text-slate-400 dark:text-slate-600'
                    : 'text-blue-600 dark:text-blue-400'
                }`}
              >
                {isLoading ? 'Creating...' : 'Create'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Form */}
        <ScrollView className="flex-1 p-4">
          <View className="mb-4">
            <Text
              className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2"
              accessibilityRole="text"
            >
              Title *
            </Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Enter card title"
              placeholderTextColor="#9ca3af"
              className="px-3 py-3 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800"
              accessibilityLabel="Card title"
              accessibilityHint="Required field"
            />
          </View>

          <View className="mb-4">
            <Text
              className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2"
              accessibilityRole="text"
            >
              Description
            </Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Enter description (optional)"
              placeholderTextColor="#9ca3af"
              className="px-3 py-3 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800"
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              accessibilityLabel="Card description"
              accessibilityHint="Optional field"
            />
          </View>

          <View className="mb-4">
            <Text
              className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2"
              accessibilityRole="text"
            >
              Priority
            </Text>
            <View className="flex-row flex-wrap">
              {priorityOptions.map((option) => (
                <TouchableOpacity
                  key={option.key}
                  onPress={() => setPriority(option.key)}
                  className={`
                    flex-row items-center px-3 py-2 mr-2 mb-2 rounded-lg border
                    ${priority === option.key
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                      : 'border-slate-300 dark:border-slate-600'
                    }
                  `}
                  style={{ minHeight: 44, minWidth: 44 }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: priority === option.key }}
                  accessibilityLabel={`Priority ${option.label}`}
                >
                  <View
                    className="w-3 h-3 rounded-full mr-2"
                    style={{ backgroundColor: option.color }}
                  />
                  <Text
                    className={`text-sm ${
                      priority === option.key
                        ? 'text-blue-700 dark:text-blue-300 font-medium'
                        : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

export default function BoardDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    currentBoard,
    isBoardLoading,
    error,
    loadBoard,
    createCard,
    moveCard,
    runCardAsTask,
    cancelCardTask,
    deleteCard,
  } = useBoardsStore();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showNewCardModal, setShowNewCardModal] = useState(false);
  const [selectedColumnId, setSelectedColumnId] = useState<string>('');
  const [isCreatingCard, setIsCreatingCard] = useState(false);

  // Load board data when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      if (id) {
        loadBoard(id).catch(() => {}); // Error handled by store
      }
    }, [id, loadBoard])
  );

  const handleRefresh = useCallback(async () => {
    if (!id) return;

    setIsRefreshing(true);
    try {
      await loadBoard(id);
    } catch (error) {
      // Error handled by store
    } finally {
      setIsRefreshing(false);
    }
  }, [id, loadBoard]);

  const handleRetry = useCallback(() => {
    if (!id) return;
    loadBoard(id).catch(() => {}); // Error handled by store
  }, [id, loadBoard]);

  const handleCardPress = useCallback((card: Card) => {
    router.push(`/board/${card.boardId}/card/${card.id}`);
  }, []);

  const handleCardLongPress = useCallback((card: Card) => {
    const options = [
      'Edit Card',
      'Run as AI Task',
      ...(card.workerTaskId ? ['Cancel Task'] : []),
      'Move to Column',
      'Delete Card',
      'Cancel'
    ];

    const destructiveIndex = options.indexOf('Delete Card');
    const cancelIndex = options.length - 1;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          destructiveButtonIndex: destructiveIndex,
          cancelButtonIndex: cancelIndex,
        },
        async (buttonIndex) => {
          switch (options[buttonIndex]) {
            case 'Edit Card':
              router.push(`/board/${card.boardId}/card/${card.id}`);
              break;
            case 'Run as AI Task':
              handleRunCardAsTask(card);
              break;
            case 'Cancel Task':
              handleCancelCardTask(card);
              break;
            case 'Move to Column':
              handleMoveCard(card);
              break;
            case 'Delete Card':
              handleDeleteCard(card);
              break;
          }
        }
      );
    } else {
      // Android - show simple alert with basic options
      Alert.alert(
        card.title,
        'Choose an action',
        [
          { text: 'Edit', onPress: () => router.push(`/board/${card.boardId}/card/${card.id}`) },
          { text: 'Run as Task', onPress: () => handleRunCardAsTask(card) },
          ...(card.workerTaskId ? [{ text: 'Cancel Task', onPress: () => handleCancelCardTask(card) }] : []),
          { text: 'Delete', style: 'destructive' as const, onPress: () => handleDeleteCard(card) },
          { text: 'Cancel', style: 'cancel' as const },
        ]
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRunCardAsTask = useCallback(async (card: Card) => {
    try {
      await runCardAsTask(card.boardId, card.id);
      Alert.alert('Success', 'Task has been created and will start running');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to run card as task');
    }
  }, [runCardAsTask]);

  const handleCancelCardTask = useCallback(async (card: Card) => {
    Alert.alert(
      'Cancel Task',
      'Are you sure you want to cancel the running task for this card?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            try {
              await cancelCardTask(card.boardId, card.id);
              Alert.alert('Success', 'Task has been cancelled');
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to cancel task');
            }
          },
        },
      ]
    );
  }, [cancelCardTask]);

  const handleMoveCard = useCallback((card: Card) => {
    if (!currentBoard) return;

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
                await moveCard(card.boardId, card.id, selectedColumn.id);
              } catch (error: any) {
                Alert.alert('Error', error.message || 'Failed to move card');
              }
            }
          }
        }
      );
    } else {
      // Android - simple picker
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
                  await moveCard(card.boardId, card.id, selectedColumn.id);
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
  }, [currentBoard, moveCard]);

  const handleDeleteCard = useCallback((card: Card) => {
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
              await deleteCard(card.boardId, card.id);
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to delete card');
            }
          },
        },
      ]
    );
  }, [deleteCard]);

  const handleAddCard = useCallback((columnId: string) => {
    setSelectedColumnId(columnId);
    setShowNewCardModal(true);
  }, []);

  const handleCreateCard = useCallback(async (data: { title: string; description: string; priority: 'urgent' | 'high' | 'medium' | 'low' }) => {
    if (!id || !selectedColumnId) return;

    setIsCreatingCard(true);
    try {
      await createCard(id, selectedColumnId, data);
      setShowNewCardModal(false);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to create card');
    } finally {
      setIsCreatingCard(false);
    }
  }, [id, selectedColumnId, createCard]);

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
          message="Could not load board"
          onRetry={handleRetry}
        />
      </View>
    );
  }

  if (!currentBoard) {
    return (
      <View className="flex-1 justify-center items-center bg-white dark:bg-slate-950 px-4">
        <ErrorState
          message="Board not found"
          onRetry={handleRetry}
        />
      </View>
    );
  }

  const selectedColumn = currentBoard.columns.find(col => col.id === selectedColumnId);

  return (
    <>
      <Stack.Screen
        options={{
          title: currentBoard.name,
          headerTitleStyle: {
            fontSize: 18,
            fontWeight: '600',
          },
        }}
      />

      <View className="flex-1 bg-slate-100 dark:bg-slate-900">
        {/* Header stats */}
        <View className="px-4 py-3 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-700">
          <View className="flex-row items-center justify-between">
            <View>
              <Text
                className="text-sm font-mono text-slate-600 dark:text-slate-400"
                accessibilityRole="text"
              >
                {currentBoard.prefix}
              </Text>
              {currentBoard.description && (
                <Text
                  className="text-sm text-slate-600 dark:text-slate-400 mt-1"
                  numberOfLines={2}
                  accessibilityRole="text"
                >
                  {currentBoard.description}
                </Text>
              )}
            </View>

            <View className="flex-row items-center">
              <View className="flex-row items-center mr-4">
                <Ionicons
                  name="card-outline"
                  size={16}
                  className="text-slate-500 mr-1"
                  accessibilityHidden
                />
                <Text
                  className="text-sm text-slate-600 dark:text-slate-400"
                  accessibilityRole="text"
                >
                  {currentBoard.cardCount}
                </Text>
              </View>
              <View className="flex-row items-center">
                <Ionicons
                  name="grid-outline"
                  size={16}
                  className="text-slate-500 mr-1"
                  accessibilityHidden
                />
                <Text
                  className="text-sm text-slate-600 dark:text-slate-400"
                  accessibilityRole="text"
                >
                  {currentBoard.columnCount}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Kanban columns */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16 }}
          className="flex-1"
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              colors={['#6366f1']}
              tintColor="#6366f1"
            />
          }
          accessibilityRole="scrollbar"
          accessibilityLabel="Board columns"
        >
          {currentBoard.columns
            .sort((a, b) => a.position - b.position)
            .map((column) => (
              <BoardColumn
                key={column.id}
                column={column}
                onCardPress={handleCardPress}
                onCardLongPress={handleCardLongPress}
                onAddCard={handleAddCard}
              />
            ))}
        </ScrollView>

        {/* New Card Modal */}
        <NewCardModal
          visible={showNewCardModal}
          onClose={() => setShowNewCardModal(false)}
          onSubmit={handleCreateCard}
          isLoading={isCreatingCard}
          columnName={selectedColumn?.name}
        />
      </View>
    </>
  );
}
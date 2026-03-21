import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  Alert,
  RefreshControl,
  Modal,
} from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useBoardsStore } from '@/stores/boards-store';
import { Board } from '@/types/boards';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

interface BoardListItemProps {
  board: Board;
  onPress: () => void;
  onStarPress: () => void;
}

function BoardListItem({ board, onPress, onStarPress }: BoardListItemProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className="mb-3"
      style={{ minHeight: 48, minWidth: 48 }} // Minimum touch target
      accessibilityRole="button"
      accessibilityLabel={`Board ${board.prefix} - ${board.name}. ${board.cardCount} cards, ${board.columnCount} columns`}
      accessibilityHint="Double tap to open board"
    >
      <Card className="p-4">
        <View className="flex-row items-start justify-between">
          <View className="flex-1 mr-3">
            <View className="flex-row items-center mb-1">
              <Text
                className="text-sm font-mono text-slate-600 dark:text-slate-400 mr-2"
                accessibilityRole="text"
              >
                {board.prefix}
              </Text>
              <Text
                className="text-base font-semibold text-slate-900 dark:text-slate-100 flex-1"
                numberOfLines={1}
                accessibilityRole="text"
              >
                {board.name}
              </Text>
            </View>

            {board.description && (
              <Text
                className="text-sm text-slate-600 dark:text-slate-400 mb-2"
                numberOfLines={2}
                accessibilityRole="text"
              >
                {board.description}
              </Text>
            )}

            <View className="flex-row items-center">
              <View className="flex-row items-center mr-4">
                <Ionicons
                  name="card-outline"
                  size={14}
                  className="text-slate-500 mr-1"
                  accessibilityHidden
                />
                <Text
                  className="text-xs text-slate-500 dark:text-slate-400"
                  accessibilityRole="text"
                >
                  {board.cardCount} cards
                </Text>
              </View>
              <View className="flex-row items-center">
                <Ionicons
                  name="grid-outline"
                  size={14}
                  className="text-slate-500 mr-1"
                  accessibilityHidden
                />
                <Text
                  className="text-xs text-slate-500 dark:text-slate-400"
                  accessibilityRole="text"
                >
                  {board.columnCount} columns
                </Text>
              </View>
            </View>
          </View>

          <TouchableOpacity
            onPress={onStarPress}
            className="p-2"
            style={{ minHeight: 44, minWidth: 44 }} // Minimum touch target
            accessibilityRole="button"
            accessibilityLabel={board.isStarred ? "Unstar board" : "Star board"}
          >
            <Ionicons
              name={board.isStarred ? "star" : "star-outline"}
              size={20}
              color={board.isStarred ? "#facc15" : "#64748b"}
            />
          </TouchableOpacity>
        </View>
      </Card>
    </TouchableOpacity>
  );
}

interface NewBoardModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; description: string; prefix: string }) => void;
  isLoading: boolean;
}

function NewBoardModal({ visible, onClose, onSubmit, isLoading }: NewBoardModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [prefix, setPrefix] = useState('');

  const handleSubmit = useCallback(() => {
    if (!name.trim() || !prefix.trim()) {
      Alert.alert('Error', 'Board name and prefix are required');
      return;
    }

    onSubmit({
      name: name.trim(),
      description: description.trim(),
      prefix: prefix.trim().toUpperCase(),
    });
  }, [name, description, prefix, onSubmit]);

  const handleClose = useCallback(() => {
    setName('');
    setDescription('');
    setPrefix('');
    onClose();
  }, [onClose]);

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
              New Board
            </Text>

            <TouchableOpacity
              onPress={handleSubmit}
              disabled={isLoading || !name.trim() || !prefix.trim()}
              className="p-2"
              style={{ minHeight: 44, minWidth: 44 }}
              accessibilityRole="button"
              accessibilityLabel="Create board"
            >
              <Text
                className={`text-base font-medium ${
                  isLoading || !name.trim() || !prefix.trim()
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
        <View className="flex-1 p-4">
          <View className="mb-4">
            <Text
              className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2"
              accessibilityRole="text"
            >
              Board Name *
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Enter board name"
              placeholderTextColor="#9ca3af"
              className="px-3 py-3 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800"
              accessibilityLabel="Board name"
              accessibilityHint="Required field"
            />
          </View>

          <View className="mb-4">
            <Text
              className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2"
              accessibilityRole="text"
            >
              Prefix *
            </Text>
            <TextInput
              value={prefix}
              onChangeText={setPrefix}
              placeholder="Enter prefix (e.g., WM)"
              placeholderTextColor="#9ca3af"
              className="px-3 py-3 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800"
              autoCapitalize="characters"
              maxLength={10}
              accessibilityLabel="Board prefix"
              accessibilityHint="Required field, maximum 10 characters"
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
              numberOfLines={3}
              textAlignVertical="top"
              accessibilityLabel="Board description"
              accessibilityHint="Optional field"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function BoardsScreen() {
  const {
    boards,
    isLoading,
    error,
    loadBoards,
    createBoard,
    toggleBoardStar,
  } = useBoardsStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showNewBoardModal, setShowNewBoardModal] = useState(false);
  const [isCreatingBoard, setIsCreatingBoard] = useState(false);

  // Load boards when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      if (boards.length === 0 && !isLoading) {
        loadBoards().catch(() => {}); // Error handled by store
      }
    }, [boards.length, isLoading, loadBoards])
  );

  // Filter boards based on search query
  const filteredBoards = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return boards;

    return boards.filter(board =>
      board.name.toLowerCase().includes(query) ||
      board.prefix.toLowerCase().includes(query) ||
      board.description?.toLowerCase().includes(query)
    );
  }, [boards, searchQuery]);

  // Sort boards: starred first, then alphabetically
  const sortedBoards = useMemo(() => {
    return [...filteredBoards].sort((a, b) => {
      if (a.is_starred && !b.is_starred) return -1;
      if (!a.is_starred && b.is_starred) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [filteredBoards]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await loadBoards();
    } catch (error) {
      // Error handled by store
    } finally {
      setIsRefreshing(false);
    }
  }, [loadBoards]);

  const handleRetry = useCallback(() => {
    loadBoards().catch(() => {}); // Error handled by store
  }, [loadBoards]);

  const handleBoardPress = useCallback((board: Board) => {
    router.push(`/board/${board.id}`);
  }, []);

  const handleStarToggle = useCallback(async (board: Board) => {
    try {
      await toggleBoardStar(board.id, !board.isStarred);
    } catch (error) {
      Alert.alert('Error', 'Failed to update board star status');
    }
  }, [toggleBoardStar]);

  const handleCreateBoard = useCallback(async (data: { name: string; description: string; prefix: string }) => {
    setIsCreatingBoard(true);
    try {
      const newBoard = await createBoard(data);
      setShowNewBoardModal(false);
      // Navigate to the new board
      router.push(`/board/${newBoard.id}`);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to create board');
    } finally {
      setIsCreatingBoard(false);
    }
  }, [createBoard]);

  const renderBoardItem = useCallback(({ item }: { item: Board }) => (
    <BoardListItem
      board={item}
      onPress={() => handleBoardPress(item)}
      onStarPress={() => handleStarToggle(item)}
    />
  ), [handleBoardPress, handleStarToggle]);

  const renderEmptyComponent = useCallback(() => {
    if (searchQuery.trim()) {
      return (
        <EmptyState
          icon="search"
          message={`No boards found for "${searchQuery}"`}
        />
      );
    }

    return (
      <View className="flex-1 justify-center items-center px-4">
        <EmptyState
          icon="apps"
          message="No boards yet. Create your first board."
        />
        <Button
          onPress={() => setShowNewBoardModal(true)}
          variant="primary"
          className="mt-4"
        >
          New Board
        </Button>
      </View>
    );
  }, [searchQuery]);

  if (isLoading && boards.length === 0) {
    return (
      <View className="flex-1 justify-center items-center bg-white dark:bg-slate-950">
        <Spinner />
      </View>
    );
  }

  if (error && boards.length === 0) {
    return (
      <View className="flex-1 justify-center items-center bg-white dark:bg-slate-950 px-4">
        <ErrorState
          message="Could not load boards"
          onRetry={handleRetry}
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white dark:bg-slate-950">
      {/* Search bar */}
      <View className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <View className="flex-row items-center bg-slate-100 dark:bg-slate-800 rounded-lg px-3">
          <Ionicons
            name="search-outline"
            size={20}
            className="text-slate-400"
            accessibilityHidden
          />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search boards..."
            placeholderTextColor="#9ca3af"
            className="flex-1 py-3 px-3 text-slate-900 dark:text-slate-100"
            accessibilityLabel="Search boards"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              className="p-1"
              style={{ minHeight: 44, minWidth: 44 }}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Ionicons
                name="close-circle"
                size={20}
                className="text-slate-400"
              />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Board list */}
      <FlatList
        data={sortedBoards}
        renderItem={renderBoardItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            colors={['#6366f1']}
            tintColor="#6366f1"
          />
        }
        ListEmptyComponent={renderEmptyComponent}
        accessibilityRole="list"
        accessibilityLabel="Boards list"
      />

      {/* Floating Action Button */}
      {boards.length > 0 && (
        <TouchableOpacity
          onPress={() => setShowNewBoardModal(true)}
          className="absolute bottom-6 right-6 w-14 h-14 bg-blue-600 rounded-full shadow-lg items-center justify-center"
          style={{ minHeight: 56, minWidth: 56 }} // Larger than minimum for FAB
          accessibilityRole="button"
          accessibilityLabel="Create new board"
        >
          <Ionicons name="add" size={24} color="white" />
        </TouchableOpacity>
      )}

      {/* New Board Modal */}
      <NewBoardModal
        visible={showNewBoardModal}
        onClose={() => setShowNewBoardModal(false)}
        onSubmit={handleCreateBoard}
        isLoading={isCreatingBoard}
      />
    </View>
  );
}
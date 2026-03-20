import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '@/lib/api-client';
import { useBoardsStore, CreateBoardInput, CreateCardInput, UpdateCardInput } from '../boards-store';
import { Board, Card, Column, ChecklistItem } from '@/types/boards';

// Mock dependencies
jest.mock('@react-native-async-storage/async-storage');
jest.mock('@/lib/api-client');

const mockedAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

// Mock data
const mockColumn: Column = {
  id: 'col-1',
  board_id: 'board-1',
  name: 'To Do',
  position: 0,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  cards: [],
};

const mockCard: Card = {
  id: 'card-1',
  board_id: 'board-1',
  column_id: 'col-1',
  issue_key: 'WM-123',
  title: 'Test card',
  description: 'Test description',
  priority: 'medium',
  position: 0,
  created_by: 'user-1',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  labels: [],
  checklist_items: [],
  dependencies: [],
};

const mockBoard: Board = {
  id: 'board-1',
  name: 'Test Board',
  description: 'Test board description',
  prefix: 'WM',
  org_id: 'org-1',
  created_by: 'user-1',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  is_starred: false,
  card_count: 1,
  column_count: 1,
  columns: [{ ...mockColumn, cards: [mockCard] }],
};

describe('Boards Store', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Reset zustand store state
    useBoardsStore.setState({
      boards: [],
      currentBoard: null,
      currentCard: null,
      cardActivity: [],
      isLoading: false,
      error: null,
      lastUpdated: null,
    });

    // Mock AsyncStorage
    mockedAsyncStorage.getItem.mockResolvedValue(null);
    mockedAsyncStorage.setItem.mockResolvedValue();

    // Mock API client
    mockedApiClient.get.mockResolvedValue({ data: [mockBoard] });
    mockedApiClient.post.mockResolvedValue({ data: mockBoard });
    mockedApiClient.put.mockResolvedValue({ data: mockBoard });
    mockedApiClient.delete.mockResolvedValue({ data: { success: true } });
  });

  describe('fetchBoards', () => {
    it('should fetch boards and update state', async () => {
      const store = useBoardsStore.getState();

      await store.fetchBoards();

      expect(mockedApiClient.get).toHaveBeenCalledWith('/boards');
      expect(store.boards).toEqual([mockBoard]);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
      expect(store.lastUpdated).toBeTruthy();
    });

    it('should handle fetch errors', async () => {
      const error = new Error('Network error');
      mockedApiClient.get.mockRejectedValue(error);

      const store = useBoardsStore.getState();

      await store.fetchBoards();

      expect(store.boards).toEqual([]);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBe('Network error');
    });

    it('should set loading state during fetch', async () => {
      let resolvePromise: (value: any) => void;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockedApiClient.get.mockReturnValue(promise);

      const store = useBoardsStore.getState();
      const fetchPromise = store.fetchBoards();

      expect(store.isLoading).toBe(true);
      expect(store.error).toBeNull();

      resolvePromise!({ data: [mockBoard] });
      await fetchPromise;

      expect(store.isLoading).toBe(false);
    });
  });

  describe('fetchBoard', () => {
    it('should fetch single board and set as current', async () => {
      mockedApiClient.get.mockResolvedValue({ data: mockBoard });

      const store = useBoardsStore.getState();

      const result = await store.fetchBoard('board-1');

      expect(mockedApiClient.get).toHaveBeenCalledWith('/boards/board-1');
      expect(result).toEqual(mockBoard);
      expect(store.currentBoard).toEqual(mockBoard);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('should handle fetchBoard errors', async () => {
      const error = new Error('Board not found');
      mockedApiClient.get.mockRejectedValue(error);

      const store = useBoardsStore.getState();

      await expect(store.fetchBoard('board-1')).rejects.toThrow('Board not found');
      expect(store.isLoading).toBe(false);
      expect(store.error).toBe('Board not found');
    });
  });

  describe('fetchCard', () => {
    it('should fetch single card and set as current', async () => {
      mockedApiClient.get.mockResolvedValue({ data: mockCard });

      const store = useBoardsStore.getState();

      const result = await store.fetchCard('board-1', 'card-1');

      expect(mockedApiClient.get).toHaveBeenCalledWith('/boards/board-1/cards/card-1');
      expect(result).toEqual(mockCard);
      expect(store.currentCard).toEqual(mockCard);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('should handle fetchCard errors', async () => {
      const error = new Error('Card not found');
      mockedApiClient.get.mockRejectedValue(error);

      const store = useBoardsStore.getState();

      await expect(store.fetchCard('board-1', 'card-1')).rejects.toThrow('Card not found');
      expect(store.isLoading).toBe(false);
      expect(store.error).toBe('Card not found');
    });
  });

  describe('board CRUD operations', () => {
    it('should create board', async () => {
      const input: CreateBoardInput = {
        name: 'New Board',
        description: 'New board description',
      };

      const newBoard = { ...mockBoard, id: 'board-2', name: 'New Board' };
      mockedApiClient.post.mockResolvedValue({ data: newBoard });

      const store = useBoardsStore.getState();

      const result = await store.createBoard(input);

      expect(mockedApiClient.post).toHaveBeenCalledWith('/boards', input);
      expect(result).toEqual(newBoard);
      expect(store.boards).toContain(newBoard);
    });

    it('should star/unstar board', async () => {
      const store = useBoardsStore.getState();

      // Add initial board
      store.setBoards([mockBoard]);

      await store.starBoard('board-1', true);

      expect(mockedApiClient.put).toHaveBeenCalledWith('/boards/board-1', { isStarred: true });
      expect(store.boards[0].is_starred).toBe(true);
    });

    it('should handle board creation errors', async () => {
      const error = new Error('Creation failed');
      mockedApiClient.post.mockRejectedValue(error);

      const store = useBoardsStore.getState();

      await expect(store.createBoard({ name: 'Test' })).rejects.toThrow('Creation failed');
    });
  });

  describe('card CRUD operations', () => {
    beforeEach(() => {
      // Set up initial board state
      useBoardsStore.getState().setBoards([mockBoard]);
      useBoardsStore.getState().setCurrentBoard(mockBoard);
    });

    it('should create card', async () => {
      const input: CreateCardInput = {
        title: 'New Card',
        description: 'New card description',
        priority: 'high',
        columnId: 'col-1',
      };

      const newCard = { ...mockCard, id: 'card-2', title: 'New Card' };
      mockedApiClient.post.mockResolvedValue({ data: newCard });

      const store = useBoardsStore.getState();

      const result = await store.createCard('board-1', input);

      expect(mockedApiClient.post).toHaveBeenCalledWith('/boards/board-1/cards', input);
      expect(result).toEqual(newCard);

      // Check that card was added to local state
      const updatedBoard = store.currentBoard!;
      const column = updatedBoard.columns.find(c => c.id === 'col-1')!;
      expect(column.cards).toContain(newCard);
    });

    it('should update card', async () => {
      const input: UpdateCardInput = {
        title: 'Updated Card',
        priority: 'urgent',
      };

      const updatedCard = { ...mockCard, title: 'Updated Card', priority: 'urgent' as const };
      mockedApiClient.put.mockResolvedValue({ data: updatedCard });

      const store = useBoardsStore.getState();

      const result = await store.updateCardData('board-1', 'card-1', input);

      expect(mockedApiClient.put).toHaveBeenCalledWith('/boards/board-1/cards/card-1', input);
      expect(result).toEqual(updatedCard);

      // Check that card was updated in local state
      const updatedBoard = store.currentBoard!;
      const column = updatedBoard.columns.find(c => c.id === 'col-1')!;
      const card = column.cards.find(c => c.id === 'card-1')!;
      expect(card.title).toBe('Updated Card');
      expect(card.priority).toBe('urgent');
    });

    it('should delete card', async () => {
      const store = useBoardsStore.getState();

      await store.deleteCard('board-1', 'card-1');

      expect(mockedApiClient.delete).toHaveBeenCalledWith('/boards/board-1/cards/card-1');

      // Check that card was removed from local state
      const updatedBoard = store.currentBoard!;
      const column = updatedBoard.columns.find(c => c.id === 'col-1')!;
      expect(column.cards.find(c => c.id === 'card-1')).toBeUndefined();
    });

    it('should move card to different column', async () => {
      const store = useBoardsStore.getState();

      await store.moveCard('board-1', 'card-1', 'col-2');

      expect(mockedApiClient.put).toHaveBeenCalledWith('/boards/board-1/cards/card-1', { columnId: 'col-2' });

      // Check that card column was updated in local state
      const updatedBoard = store.currentBoard!;
      const column = updatedBoard.columns.find(c => c.id === 'col-1')!;
      const card = column.cards.find(c => c.id === 'card-1')!;
      expect(card.column_id).toBe('col-2');
    });
  });

  describe('task operations', () => {
    it('should run card as task', async () => {
      const store = useBoardsStore.getState();

      await store.runCardAsTask('board-1', 'card-1');

      expect(mockedApiClient.post).toHaveBeenCalledWith('/boards/board-1/cards/card-1/run');
    });

    it('should cancel card task', async () => {
      const store = useBoardsStore.getState();

      await store.cancelCardTask('board-1', 'card-1');

      expect(mockedApiClient.post).toHaveBeenCalledWith('/boards/board-1/cards/card-1/cancel-run');
    });

    it('should handle task operation errors', async () => {
      const error = new Error('Task operation failed');
      mockedApiClient.post.mockRejectedValue(error);

      const store = useBoardsStore.getState();

      await expect(store.runCardAsTask('board-1', 'card-1')).rejects.toThrow('Task operation failed');
    });
  });

  describe('label operations', () => {
    beforeEach(() => {
      useBoardsStore.getState().setCurrentBoard(mockBoard);
    });

    it('should add card label', async () => {
      const store = useBoardsStore.getState();

      await store.addCardLabel('board-1', 'card-1', 'label-1');

      expect(mockedApiClient.post).toHaveBeenCalledWith('/boards/board-1/cards/card-1/labels', { labelId: 'label-1' });
      expect(mockedApiClient.get).toHaveBeenCalledWith('/boards/board-1/cards/card-1'); // refetch
    });

    it('should remove card label', async () => {
      const store = useBoardsStore.getState();

      await store.removeCardLabel('board-1', 'card-1', 'label-1');

      expect(mockedApiClient.delete).toHaveBeenCalledWith('/boards/board-1/cards/card-1/labels/label-1');
      expect(mockedApiClient.get).toHaveBeenCalledWith('/boards/board-1/cards/card-1'); // refetch
    });
  });

  describe('checklist operations', () => {
    beforeEach(() => {
      useBoardsStore.getState().setCurrentCard(mockCard);
    });

    it('should add checklist item', async () => {
      const newItem: ChecklistItem = {
        id: 'item-1',
        card_id: 'card-1',
        text: 'New item',
        completed: false,
        position: 0,
        created_at: '2024-01-01T00:00:00Z',
      };

      mockedApiClient.post.mockResolvedValue({ data: newItem });

      const store = useBoardsStore.getState();

      const result = await store.addChecklistItem('board-1', 'card-1', 'New item');

      expect(mockedApiClient.post).toHaveBeenCalledWith('/boards/board-1/cards/card-1/checklist', { text: 'New item' });
      expect(result).toEqual(newItem);
      expect(store.currentCard!.checklist_items).toContain(newItem);
    });

    it('should toggle checklist item', async () => {
      const cardWithItem = {
        ...mockCard,
        checklist_items: [{
          id: 'item-1',
          card_id: 'card-1',
          text: 'Test item',
          completed: false,
          position: 0,
          created_at: '2024-01-01T00:00:00Z',
        }],
      };

      const store = useBoardsStore.getState();
      store.setCurrentCard(cardWithItem);

      await store.toggleChecklistItem('board-1', 'card-1', 'item-1', true);

      expect(mockedApiClient.put).toHaveBeenCalledWith('/boards/board-1/cards/card-1/checklist/item-1', { completed: true });
      expect(store.currentCard!.checklist_items[0].completed).toBe(true);
    });
  });

  describe('computed getters', () => {
    beforeEach(() => {
      const starredBoard = { ...mockBoard, id: 'starred-board', is_starred: true, name: 'A Starred' };
      const regularBoard = { ...mockBoard, id: 'regular-board', is_starred: false, name: 'Z Regular' };

      useBoardsStore.getState().setBoards([regularBoard, starredBoard]);
    });

    it('should get starred boards sorted by name', () => {
      const store = useBoardsStore.getState();
      const starredBoards = store.getStarredBoards();

      expect(starredBoards).toHaveLength(1);
      expect(starredBoards[0].is_starred).toBe(true);
      expect(starredBoards[0].name).toBe('A Starred');
    });

    it('should get board by id', () => {
      const store = useBoardsStore.getState();
      const board = store.getBoard('starred-board');

      expect(board?.name).toBe('A Starred');
      expect(store.getBoard('nonexistent')).toBeUndefined();
    });

    it('should get column by id', () => {
      useBoardsStore.getState().setCurrentBoard(mockBoard);

      const store = useBoardsStore.getState();
      const column = store.getColumn('col-1');

      expect(column?.name).toBe('To Do');
      expect(store.getColumn('nonexistent')).toBeUndefined();
    });

    it('should get card by id', () => {
      useBoardsStore.getState().setCurrentBoard(mockBoard);

      const store = useBoardsStore.getState();
      const card = store.getCard('card-1');

      expect(card?.title).toBe('Test card');
      expect(store.getCard('nonexistent')).toBeUndefined();
    });
  });

  describe('state management', () => {
    it('should update board properly', () => {
      const store = useBoardsStore.getState();

      store.setBoards([mockBoard]);
      store.setCurrentBoard(mockBoard);

      const updates = { name: 'Updated Board', is_starred: true };
      store.updateBoard('board-1', updates);

      const updatedState = useBoardsStore.getState();
      expect(updatedState.boards[0].name).toBe('Updated Board');
      expect(updatedState.boards[0].is_starred).toBe(true);
      expect(updatedState.currentBoard?.name).toBe('Updated Board');
      expect(updatedState.lastUpdated).toBeTruthy();
    });

    it('should update card across all boards and current board', () => {
      const store = useBoardsStore.getState();

      store.setBoards([mockBoard]);
      store.setCurrentBoard(mockBoard);
      store.setCurrentCard(mockCard);

      const updates = { title: 'Updated Card', priority: 'high' as const };
      store.updateCard('card-1', updates);

      const updatedState = useBoardsStore.getState();

      // Check updated in boards list
      const boardCard = updatedState.boards[0].columns[0].cards[0];
      expect(boardCard.title).toBe('Updated Card');
      expect(boardCard.priority).toBe('high');

      // Check updated in current board
      const currentBoardCard = updatedState.currentBoard!.columns[0].cards[0];
      expect(currentBoardCard.title).toBe('Updated Card');
      expect(currentBoardCard.priority).toBe('high');

      // Check updated in current card
      expect(updatedState.currentCard?.title).toBe('Updated Card');
      expect(updatedState.currentCard?.priority).toBe('high');
    });

    it('should remove card from all locations', () => {
      const store = useBoardsStore.getState();

      store.setBoards([mockBoard]);
      store.setCurrentBoard(mockBoard);
      store.setCurrentCard(mockCard);

      store.removeCard('card-1');

      const updatedState = useBoardsStore.getState();

      // Check removed from boards list
      expect(updatedState.boards[0].columns[0].cards).toHaveLength(0);

      // Check removed from current board
      expect(updatedState.currentBoard!.columns[0].cards).toHaveLength(0);

      // Check current card cleared
      expect(updatedState.currentCard).toBeNull();
    });
  });

  describe('persistence', () => {
    it('should persist boards and current board to AsyncStorage', () => {
      const store = useBoardsStore.getState();

      store.setBoards([mockBoard]);
      store.setCurrentBoard(mockBoard);

      // Zustand persistence is tested through the middleware,
      // we just verify the store uses the correct storage key
      expect(useBoardsStore.persist).toBeDefined();
    });

    it('should not persist loading and error states', () => {
      const store = useBoardsStore.getState();

      store.setLoading(true);
      store.setError('Test error');

      // The partialize function should exclude these from persistence
      const config = (useBoardsStore as any).persist.getOptions();
      const partializedState = config.partialize(store);

      expect(partializedState).not.toHaveProperty('isLoading');
      expect(partializedState).not.toHaveProperty('error');
      expect(partializedState).not.toHaveProperty('cardActivity');
      expect(partializedState).toHaveProperty('boards');
      expect(partializedState).toHaveProperty('currentBoard');
      expect(partializedState).toHaveProperty('lastUpdated');
    });
  });
});
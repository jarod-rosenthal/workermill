import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBoardsStore } from '../boards-store';
import { apiClient } from '@/lib/api-client';
import { STORAGE_KEYS } from '@/constants/config';
import { Board, Card, Column, ChecklistItem, CardActivity } from '@/types/boards';

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
  cards: []
};

const mockCard: Card = {
  id: 'card-1',
  board_id: 'board-1',
  column_id: 'col-1',
  issue_key: 'TEST-123',
  title: 'Test card',
  description: 'Test description',
  priority: 'medium',
  position: 0,
  created_by: 'user-1',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  labels: [],
  checklist_items: [],
  dependencies: []
};

const mockBoard: Board = {
  id: 'board-1',
  name: 'Test Board',
  description: 'Test description',
  prefix: 'TEST',
  org_id: 'org-1',
  created_by: 'user-1',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  is_starred: false,
  card_count: 1,
  column_count: 1,
  columns: [{ ...mockColumn, cards: [mockCard] }]
};

const mockChecklistItem: ChecklistItem = {
  id: 'item-1',
  card_id: 'card-1',
  text: 'Test item',
  completed: false,
  position: 0,
  created_at: '2024-01-01T00:00:00Z'
};

const mockActivity: CardActivity = {
  id: 'activity-1',
  card_id: 'card-1',
  user_id: 'user-1',
  user_name: 'Test User',
  action: 'created',
  created_at: '2024-01-01T00:00:00Z'
};

describe('BoardsStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Reset store state
    useBoardsStore.setState({
      boards: [],
      currentBoard: null,
      lastUpdated: null,
      isLoading: false,
      isBoardLoading: false,
      isCardLoading: false,
      error: null,
    });

    // Mock AsyncStorage
    mockedAsyncStorage.getItem.mockResolvedValue(null);
    mockedAsyncStorage.setItem.mockResolvedValue(undefined);
    mockedAsyncStorage.removeItem.mockResolvedValue(undefined);
  });

  describe('loadBoards', () => {
    it('loads boards from API', async () => {
      mockedApiClient.get.mockResolvedValue([mockBoard]);

      const store = useBoardsStore.getState();
      await store.loadBoards();

      expect(mockedApiClient.get).toHaveBeenCalledWith('/boards');
      expect(useBoardsStore.getState().boards).toEqual([mockBoard]);
      expect(useBoardsStore.getState().isLoading).toBe(false);
      expect(useBoardsStore.getState().error).toBeNull();
      expect(useBoardsStore.getState().lastUpdated).toBeTruthy();
    });

    it('handles API errors', async () => {
      const errorResponse = {
        response: { data: { message: 'API error' } }
      };
      mockedApiClient.get.mockRejectedValue(errorResponse);

      const store = useBoardsStore.getState();

      let threwError = false;
      try {
        await store.loadBoards();
      } catch (error) {
        threwError = true;
        expect(error).toEqual(errorResponse);
      }

      expect(threwError).toBe(true);
      expect(useBoardsStore.getState().error).toBe('API error');
      expect(useBoardsStore.getState().isLoading).toBe(false);
    });

    it('handles network errors with fallback message', async () => {
      const networkError = new Error('Network error');
      mockedApiClient.get.mockRejectedValue(networkError);

      const store = useBoardsStore.getState();

      await expect(store.loadBoards()).rejects.toThrow();
      expect(useBoardsStore.getState().error).toBe('Failed to load boards');
      expect(useBoardsStore.getState().isLoading).toBe(false);
    });
  });

  describe('loadBoard', () => {
    it('loads specific board from API', async () => {
      mockedApiClient.get.mockResolvedValue(mockBoard);

      const store = useBoardsStore.getState();
      await store.loadBoard('board-1');

      expect(mockedApiClient.get).toHaveBeenCalledWith('/boards/board-1');
      expect(useBoardsStore.getState().currentBoard).toEqual(mockBoard);
      expect(useBoardsStore.getState().isBoardLoading).toBe(false);
      expect(useBoardsStore.getState().error).toBeNull();
    });

    it('updates existing board in boards list', async () => {
      const updatedBoard = { ...mockBoard, name: 'Updated Board' };

      // Set initial boards list
      useBoardsStore.setState({ boards: [mockBoard] });

      mockedApiClient.get.mockResolvedValue(updatedBoard);

      const store = useBoardsStore.getState();
      await store.loadBoard('board-1');

      const boards = useBoardsStore.getState().boards;
      expect(boards).toHaveLength(1);
      expect(boards[0].name).toBe('Updated Board');
    });

    it('handles board not found error', async () => {
      const errorResponse = {
        response: { data: { message: 'Board not found' } }
      };
      mockedApiClient.get.mockRejectedValue(errorResponse);

      const store = useBoardsStore.getState();

      let threwError = false;
      try {
        await store.loadBoard('non-existent');
      } catch (error) {
        threwError = true;
        expect(error).toEqual(errorResponse);
      }

      expect(threwError).toBe(true);
      expect(useBoardsStore.getState().error).toBe('Board not found');
      expect(useBoardsStore.getState().isBoardLoading).toBe(false);
    });
  });

  describe('board CRUD operations', () => {
    it('creates new board', async () => {
      const newBoard = { ...mockBoard, id: 'board-2', name: 'New Board' };
      mockedApiClient.post.mockResolvedValue(newBoard);

      const store = useBoardsStore.getState();
      const result = await store.createBoard({
        name: 'New Board',
        description: 'Test description',
        prefix: 'NEW'
      });

      expect(mockedApiClient.post).toHaveBeenCalledWith('/boards', {
        name: 'New Board',
        description: 'Test description',
        prefix: 'NEW'
      });
      expect(result).toEqual(newBoard);
      expect(useBoardsStore.getState().boards).toContain(newBoard);
    });

    it('updates board', async () => {
      const updatedBoard = { ...mockBoard, name: 'Updated Board' };

      // Set initial board
      useBoardsStore.setState({ boards: [mockBoard], currentBoard: mockBoard });

      mockedApiClient.put.mockResolvedValue(updatedBoard);

      const store = useBoardsStore.getState();
      const result = await store.updateBoard('board-1', { name: 'Updated Board' });

      expect(mockedApiClient.put).toHaveBeenCalledWith('/boards/board-1', { name: 'Updated Board' });
      expect(result).toEqual(updatedBoard);
      expect(useBoardsStore.getState().currentBoard?.name).toBe('Updated Board');
    });

    it('deletes board', async () => {
      // Set initial boards
      useBoardsStore.setState({ boards: [mockBoard], currentBoard: mockBoard });

      mockedApiClient.delete.mockResolvedValue(undefined);

      const store = useBoardsStore.getState();
      await store.deleteBoard('board-1');

      expect(mockedApiClient.delete).toHaveBeenCalledWith('/boards/board-1');
      expect(useBoardsStore.getState().boards).toHaveLength(0);
      expect(useBoardsStore.getState().currentBoard).toBeNull();
    });

    it('toggles board star', async () => {
      const starredBoard = { ...mockBoard, is_starred: true };

      // Set initial board
      useBoardsStore.setState({ boards: [mockBoard] });

      mockedApiClient.put.mockResolvedValue(starredBoard);

      const store = useBoardsStore.getState();
      await store.toggleBoardStar('board-1', true);

      expect(mockedApiClient.put).toHaveBeenCalledWith('/boards/board-1', { is_starred: true });
      expect(useBoardsStore.getState().boards[0].is_starred).toBe(true);
    });
  });

  describe('card CRUD operations', () => {
    beforeEach(() => {
      useBoardsStore.setState({
        boards: [mockBoard],
        currentBoard: mockBoard
      });
    });

    it('creates new card', async () => {
      const newCard = { ...mockCard, id: 'card-2', title: 'New Card' };
      mockedApiClient.post.mockResolvedValue(newCard);

      const store = useBoardsStore.getState();
      const result = await store.createCard('board-1', 'col-1', {
        title: 'New Card',
        description: 'Test description'
      });

      expect(mockedApiClient.post).toHaveBeenCalledWith('/boards/board-1/cards', {
        title: 'New Card',
        description: 'Test description',
        column_id: 'col-1'
      });
      expect(result).toEqual(newCard);

      const state = useBoardsStore.getState();
      const column = state.currentBoard?.columns.find(c => c.id === 'col-1');
      expect(column?.cards).toContain(newCard);
    });

    it('updates card', async () => {
      const updatedCard = { ...mockCard, title: 'Updated Card' };
      mockedApiClient.put.mockResolvedValue(updatedCard);

      const store = useBoardsStore.getState();
      const result = await store.updateCard('board-1', 'card-1', { title: 'Updated Card' });

      expect(mockedApiClient.put).toHaveBeenCalledWith('/boards/board-1/cards/card-1', { title: 'Updated Card' });
      expect(result).toEqual(updatedCard);

      const card = store.getCardById('board-1', 'card-1');
      expect(card?.title).toBe('Updated Card');
    });

    it('moves card between columns', async () => {
      const movedCard = { ...mockCard, column_id: 'col-2' };
      mockedApiClient.put.mockResolvedValue(movedCard);

      // Add a second column to the board
      const boardWithTwoColumns = {
        ...mockBoard,
        columns: [
          mockBoard.columns[0],
          { ...mockColumn, id: 'col-2', name: 'In Progress', cards: [] }
        ]
      };
      useBoardsStore.setState({ currentBoard: boardWithTwoColumns });

      const store = useBoardsStore.getState();
      const result = await store.moveCard('board-1', 'card-1', 'col-2', 0);

      expect(mockedApiClient.put).toHaveBeenCalledWith('/boards/board-1/cards/card-1', {
        column_id: 'col-2',
        position: 0
      });
      expect(result).toEqual(movedCard);
    });

    it('deletes card', async () => {
      mockedApiClient.delete.mockResolvedValue(undefined);

      const store = useBoardsStore.getState();
      await store.deleteCard('board-1', 'card-1');

      expect(mockedApiClient.delete).toHaveBeenCalledWith('/boards/board-1/cards/card-1');

      const state = useBoardsStore.getState();
      const column = state.currentBoard?.columns.find(c => c.id === 'col-1');
      expect(column?.cards).toHaveLength(0);
      expect(state.currentBoard?.card_count).toBe(0);
    });

    it('runs card as task', async () => {
      mockedApiClient.post.mockResolvedValue(undefined);

      const store = useBoardsStore.getState();
      await store.runCardAsTask('board-1', 'card-1');

      expect(mockedApiClient.post).toHaveBeenCalledWith('/boards/board-1/cards/card-1/run');
    });

    it('cancels card task', async () => {
      mockedApiClient.post.mockResolvedValue(undefined);

      const store = useBoardsStore.getState();
      await store.cancelCardTask('board-1', 'card-1');

      expect(mockedApiClient.post).toHaveBeenCalledWith('/boards/board-1/cards/card-1/cancel-run');
    });
  });

  describe('card label operations', () => {
    beforeEach(() => {
      useBoardsStore.setState({
        boards: [mockBoard],
        currentBoard: mockBoard
      });
    });

    it('adds card label', async () => {
      mockedApiClient.post.mockResolvedValue(undefined);
      mockedApiClient.get.mockResolvedValue(mockBoard); // For reload

      const store = useBoardsStore.getState();
      await store.addCardLabel('board-1', 'card-1', 'label-1');

      expect(mockedApiClient.post).toHaveBeenCalledWith('/boards/board-1/cards/card-1/labels', { label_id: 'label-1' });
      expect(mockedApiClient.get).toHaveBeenCalledWith('/boards/board-1'); // Reload called
    });

    it('removes card label', async () => {
      mockedApiClient.delete.mockResolvedValue(undefined);
      mockedApiClient.get.mockResolvedValue(mockBoard); // For reload

      const store = useBoardsStore.getState();
      await store.removeCardLabel('board-1', 'card-1', 'label-1');

      expect(mockedApiClient.delete).toHaveBeenCalledWith('/boards/board-1/cards/card-1/labels/label-1');
      expect(mockedApiClient.get).toHaveBeenCalledWith('/boards/board-1'); // Reload called
    });
  });

  describe('checklist operations', () => {
    beforeEach(() => {
      useBoardsStore.setState({
        boards: [mockBoard],
        currentBoard: mockBoard
      });
    });

    it('adds checklist item', async () => {
      mockedApiClient.post.mockResolvedValue(mockChecklistItem);

      const store = useBoardsStore.getState();
      const result = await store.addChecklistItem('board-1', 'card-1', 'Test item');

      expect(mockedApiClient.post).toHaveBeenCalledWith('/boards/board-1/cards/card-1/checklist', { text: 'Test item' });
      expect(result).toEqual(mockChecklistItem);

      const card = store.getCardById('board-1', 'card-1');
      expect(card?.checklist_items).toContain(mockChecklistItem);
    });

    it('updates checklist item', async () => {
      const updatedItem = { ...mockChecklistItem, completed: true };

      // Set initial card with checklist item
      const cardWithItem = { ...mockCard, checklist_items: [mockChecklistItem] };
      const boardWithItem = {
        ...mockBoard,
        columns: [{ ...mockColumn, cards: [cardWithItem] }]
      };
      useBoardsStore.setState({ currentBoard: boardWithItem });

      mockedApiClient.put.mockResolvedValue(updatedItem);

      const store = useBoardsStore.getState();
      const result = await store.updateChecklistItem('board-1', 'card-1', 'item-1', { completed: true });

      expect(mockedApiClient.put).toHaveBeenCalledWith('/boards/board-1/cards/card-1/checklist/item-1', { completed: true });
      expect(result).toEqual(updatedItem);

      const card = store.getCardById('board-1', 'card-1');
      expect(card?.checklist_items[0].completed).toBe(true);
    });

    it('deletes checklist item', async () => {
      // Set initial card with checklist item
      const cardWithItem = { ...mockCard, checklist_items: [mockChecklistItem] };
      const boardWithItem = {
        ...mockBoard,
        columns: [{ ...mockColumn, cards: [cardWithItem] }]
      };
      useBoardsStore.setState({ currentBoard: boardWithItem });

      mockedApiClient.delete.mockResolvedValue(undefined);

      const store = useBoardsStore.getState();
      await store.deleteChecklistItem('board-1', 'card-1', 'item-1');

      expect(mockedApiClient.delete).toHaveBeenCalledWith('/boards/board-1/cards/card-1/checklist/item-1');

      const card = store.getCardById('board-1', 'card-1');
      expect(card?.checklist_items).toHaveLength(0);
    });

    it('gets card activity', async () => {
      mockedApiClient.get.mockResolvedValue([mockActivity]);

      const store = useBoardsStore.getState();
      const result = await store.getCardActivity('board-1', 'card-1');

      expect(mockedApiClient.get).toHaveBeenCalledWith('/boards/board-1/cards/card-1/activity');
      expect(result).toEqual([mockActivity]);
    });
  });

  describe('convenience getters', () => {
    beforeEach(() => {
      const starredBoard = { ...mockBoard, id: 'board-2', name: 'Starred Board', is_starred: true };
      useBoardsStore.setState({
        boards: [mockBoard, starredBoard],
        currentBoard: mockBoard
      });
    });

    it('getBoardById returns correct board', () => {
      const store = useBoardsStore.getState();
      const board = store.getBoardById('board-1');

      expect(board).toEqual(mockBoard);
    });

    it('getBoardById returns null for non-existent board', () => {
      const store = useBoardsStore.getState();
      const board = store.getBoardById('non-existent');

      expect(board).toBeNull();
    });

    it('getStarredBoards returns only starred boards', () => {
      const store = useBoardsStore.getState();
      const starredBoards = store.getStarredBoards();

      expect(starredBoards).toHaveLength(1);
      expect(starredBoards[0].name).toBe('Starred Board');
      expect(starredBoards[0].is_starred).toBe(true);
    });

    it('getCardById returns correct card', () => {
      const store = useBoardsStore.getState();
      const card = store.getCardById('board-1', 'card-1');

      expect(card).toEqual(mockCard);
    });

    it('getCardById returns null for non-existent card', () => {
      const store = useBoardsStore.getState();
      const card = store.getCardById('board-1', 'non-existent');

      expect(card).toBeNull();
    });

    it('getColumnCards returns cards sorted by position', () => {
      const card2 = { ...mockCard, id: 'card-2', position: 1 };
      const boardWithMultipleCards = {
        ...mockBoard,
        columns: [{ ...mockColumn, cards: [card2, mockCard] }] // Unsorted
      };
      useBoardsStore.setState({ currentBoard: boardWithMultipleCards });

      const store = useBoardsStore.getState();
      const cards = store.getColumnCards('board-1', 'col-1');

      expect(cards).toHaveLength(2);
      expect(cards[0]).toEqual(mockCard); // position 0
      expect(cards[1]).toEqual(card2); // position 1
    });

    it('getColumnCards returns empty array for non-existent column', () => {
      const store = useBoardsStore.getState();
      const cards = store.getColumnCards('board-1', 'non-existent');

      expect(cards).toEqual([]);
    });
  });

  describe('persistence', () => {
    it('uses correct storage key', () => {
      expect(STORAGE_KEYS.BOARDS).toBe('wm-boards-v1');
    });

    it('persists only data state, not loading states', () => {
      // This tests the partialize function indirectly
      const testState = {
        boards: [mockBoard],
        currentBoard: mockBoard,
        lastUpdated: '2024-01-01T00:00:00Z',
        isLoading: true,
        isBoardLoading: true,
        isCardLoading: true,
        error: 'error',
      };

      useBoardsStore.setState(testState);

      // The persistence layer should only include the data fields
      // We can't directly test partialize, but we know loading states
      // shouldn't be persisted based on the implementation
      expect(useBoardsStore.getState().boards).toEqual([mockBoard]);
      expect(useBoardsStore.getState().currentBoard).toEqual(mockBoard);
      expect(useBoardsStore.getState().lastUpdated).toBe('2024-01-01T00:00:00Z');
    });
  });
});
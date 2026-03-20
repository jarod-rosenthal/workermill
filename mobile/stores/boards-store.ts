import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '@/lib/api-client';
import { Board, Card, Column, Label, ChecklistItem, CardActivity } from '@/types/boards';
import { STORAGE_KEYS } from '@/constants/config';

// Board creation interface
export interface CreateBoardInput {
  name: string;
  description?: string;
}

// Card creation interface
export interface CreateCardInput {
  title: string;
  description?: string;
  priority?: 'urgent' | 'high' | 'medium' | 'low';
  columnId: string;
}

// Card update interface
export interface UpdateCardInput {
  title?: string;
  description?: string;
  priority?: 'urgent' | 'high' | 'medium' | 'low';
  columnId?: string;
}

// Boards store state interface
interface BoardsState {
  // Data
  boards: Board[];
  currentBoard: Board | null;
  currentCard: Card | null;
  cardActivity: CardActivity[];

  // UI state
  isLoading: boolean;
  error: string | null;
  lastUpdated: string | null;

  // Actions
  setBoards: (boards: Board[]) => void;
  setCurrentBoard: (board: Board | null) => void;
  setCurrentCard: (card: Card | null) => void;
  setCardActivity: (activity: CardActivity[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  updateBoard: (boardId: string, updates: Partial<Board>) => void;
  updateCard: (cardId: string, updates: Partial<Card>) => void;
  removeCard: (cardId: string) => void;
  addCard: (card: Card) => void;

  // API methods
  fetchBoards: () => Promise<void>;
  fetchBoard: (boardId: string) => Promise<Board>;
  fetchCard: (boardId: string, cardId: string) => Promise<Card>;
  fetchCardActivity: (boardId: string, cardId: string) => Promise<void>;

  // Board operations
  createBoard: (input: CreateBoardInput) => Promise<Board>;
  starBoard: (boardId: string, isStarred: boolean) => Promise<void>;

  // Card operations
  createCard: (boardId: string, input: CreateCardInput) => Promise<Card>;
  updateCardData: (boardId: string, cardId: string, input: UpdateCardInput) => Promise<Card>;
  deleteCard: (boardId: string, cardId: string) => Promise<void>;
  moveCard: (boardId: string, cardId: string, columnId: string) => Promise<void>;

  // Task operations
  runCardAsTask: (boardId: string, cardId: string) => Promise<void>;
  cancelCardTask: (boardId: string, cardId: string) => Promise<void>;

  // Label operations
  addCardLabel: (boardId: string, cardId: string, labelId: string) => Promise<void>;
  removeCardLabel: (boardId: string, cardId: string, labelId: string) => Promise<void>;

  // Checklist operations
  addChecklistItem: (boardId: string, cardId: string, text: string) => Promise<ChecklistItem>;
  toggleChecklistItem: (boardId: string, cardId: string, itemId: string, completed: boolean) => Promise<void>;

  // Computed getters
  getStarredBoards: () => Board[];
  getBoard: (boardId: string) => Board | undefined;
  getColumn: (columnId: string) => Column | undefined;
  getCard: (cardId: string) => Card | undefined;
}

export const useBoardsStore = create<BoardsState>()(
  persist(
    (set, get) => ({
      // Initial state
      boards: [],
      currentBoard: null,
      currentCard: null,
      cardActivity: [],
      isLoading: false,
      error: null,
      lastUpdated: null,

      // Basic setters
      setBoards: (boards) => set({ boards, lastUpdated: new Date().toISOString() }),
      setCurrentBoard: (currentBoard) => set({ currentBoard }),
      setCurrentCard: (currentCard) => set({ currentCard }),
      setCardActivity: (cardActivity) => set({ cardActivity }),
      setLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),

      updateBoard: (boardId, updates) =>
        set((state) => ({
          boards: state.boards.map((board) =>
            board.id === boardId ? { ...board, ...updates } : board
          ),
          currentBoard: state.currentBoard?.id === boardId
            ? { ...state.currentBoard, ...updates }
            : state.currentBoard,
          lastUpdated: new Date().toISOString(),
        })),

      updateCard: (cardId, updates) =>
        set((state) => {
          const updatedBoards = state.boards.map((board) => ({
            ...board,
            columns: board.columns.map((column) => ({
              ...column,
              cards: column.cards.map((card) =>
                card.id === cardId ? { ...card, ...updates } : card
              ),
            })),
          }));

          const updatedCurrentBoard = state.currentBoard ? {
            ...state.currentBoard,
            columns: state.currentBoard.columns.map((column) => ({
              ...column,
              cards: column.cards.map((card) =>
                card.id === cardId ? { ...card, ...updates } : card
              ),
            })),
          } : null;

          return {
            boards: updatedBoards,
            currentBoard: updatedCurrentBoard,
            currentCard: state.currentCard?.id === cardId
              ? { ...state.currentCard, ...updates }
              : state.currentCard,
            lastUpdated: new Date().toISOString(),
          };
        }),

      removeCard: (cardId) =>
        set((state) => {
          const updatedBoards = state.boards.map((board) => ({
            ...board,
            columns: board.columns.map((column) => ({
              ...column,
              cards: column.cards.filter((card) => card.id !== cardId),
            })),
          }));

          const updatedCurrentBoard = state.currentBoard ? {
            ...state.currentBoard,
            columns: state.currentBoard.columns.map((column) => ({
              ...column,
              cards: column.cards.filter((card) => card.id !== cardId),
            })),
          } : null;

          return {
            boards: updatedBoards,
            currentBoard: updatedCurrentBoard,
            currentCard: state.currentCard?.id === cardId ? null : state.currentCard,
            lastUpdated: new Date().toISOString(),
          };
        }),

      addCard: (card) =>
        set((state) => {
          const updatedBoards = state.boards.map((board) => {
            if (board.id !== card.board_id) return board;

            return {
              ...board,
              columns: board.columns.map((column) => {
                if (column.id !== card.column_id) return column;

                return {
                  ...column,
                  cards: [...column.cards, card],
                };
              }),
            };
          });

          const updatedCurrentBoard = state.currentBoard?.id === card.board_id ? {
            ...state.currentBoard,
            columns: state.currentBoard.columns.map((column) => {
              if (column.id !== card.column_id) return column;

              return {
                ...column,
                cards: [...column.cards, card],
              };
            }),
          } : state.currentBoard;

          return {
            boards: updatedBoards,
            currentBoard: updatedCurrentBoard,
            lastUpdated: new Date().toISOString(),
          };
        }),

      // Fetch all boards
      fetchBoards: async () => {
        try {
          set({ isLoading: true, error: null });

          const response = await apiClient.get('/boards');
          const boards = response.data;

          set({
            boards,
            isLoading: false,
            error: null,
            lastUpdated: new Date().toISOString(),
          });
        } catch (error) {
          console.error('Failed to fetch boards:', error);
          set({
            isLoading: false,
            error: error instanceof Error ? error.message : 'Failed to load boards',
          });
        }
      },

      // Fetch single board with columns and cards
      fetchBoard: async (boardId: string) => {
        try {
          set({ isLoading: true, error: null });

          const response = await apiClient.get(`/boards/${boardId}`);
          const board = response.data;

          // Update the board in the boards list and set as current
          set((state) => ({
            boards: state.boards.map((b) => (b.id === boardId ? board : b)),
            currentBoard: board,
            isLoading: false,
            error: null,
            lastUpdated: new Date().toISOString(),
          }));

          return board;
        } catch (error) {
          console.error('Failed to fetch board:', error);
          const errorMessage = error instanceof Error ? error.message : 'Failed to load board';
          set({
            isLoading: false,
            error: errorMessage,
          });
          throw error;
        }
      },

      // Fetch single card
      fetchCard: async (boardId: string, cardId: string) => {
        try {
          set({ isLoading: true, error: null });

          const response = await apiClient.get(`/boards/${boardId}/cards/${cardId}`);
          const card = response.data;

          set({
            currentCard: card,
            isLoading: false,
            error: null,
          });

          // Update the card in boards state as well
          get().updateCard(cardId, card);

          return card;
        } catch (error) {
          console.error('Failed to fetch card:', error);
          const errorMessage = error instanceof Error ? error.message : 'Failed to load card';
          set({
            isLoading: false,
            error: errorMessage,
          });
          throw error;
        }
      },

      // Fetch card activity
      fetchCardActivity: async (boardId: string, cardId: string) => {
        try {
          const response = await apiClient.get(`/boards/${boardId}/cards/${cardId}/activity`);
          const activity = response.data;

          set({ cardActivity: activity });
        } catch (error) {
          console.error('Failed to fetch card activity:', error);
          // Non-fatal error, just log it
        }
      },

      // Create new board
      createBoard: async (input: CreateBoardInput) => {
        try {
          const response = await apiClient.post('/boards', input);
          const board = response.data;

          // Add to boards list
          set((state) => ({
            boards: [...state.boards, board],
            lastUpdated: new Date().toISOString(),
          }));

          return board;
        } catch (error) {
          console.error('Failed to create board:', error);
          throw error;
        }
      },

      // Star/unstar board
      starBoard: async (boardId: string, isStarred: boolean) => {
        try {
          await apiClient.put(`/boards/${boardId}`, { isStarred });

          // Update local state
          get().updateBoard(boardId, { is_starred: isStarred });
        } catch (error) {
          console.error('Failed to star board:', error);
          throw error;
        }
      },

      // Create new card
      createCard: async (boardId: string, input: CreateCardInput) => {
        try {
          const response = await apiClient.post(`/boards/${boardId}/cards`, input);
          const card = response.data;

          // Add to local state
          get().addCard(card);

          return card;
        } catch (error) {
          console.error('Failed to create card:', error);
          throw error;
        }
      },

      // Update card
      updateCardData: async (boardId: string, cardId: string, input: UpdateCardInput) => {
        try {
          const response = await apiClient.put(`/boards/${boardId}/cards/${cardId}`, input);
          const card = response.data;

          // Update local state
          get().updateCard(cardId, card);

          return card;
        } catch (error) {
          console.error('Failed to update card:', error);
          throw error;
        }
      },

      // Delete card
      deleteCard: async (boardId: string, cardId: string) => {
        try {
          await apiClient.delete(`/boards/${boardId}/cards/${cardId}`);

          // Remove from local state
          get().removeCard(cardId);
        } catch (error) {
          console.error('Failed to delete card:', error);
          throw error;
        }
      },

      // Move card to different column
      moveCard: async (boardId: string, cardId: string, columnId: string) => {
        try {
          await apiClient.put(`/boards/${boardId}/cards/${cardId}`, { columnId });

          // Update local state
          get().updateCard(cardId, { column_id: columnId });
        } catch (error) {
          console.error('Failed to move card:', error);
          throw error;
        }
      },

      // Run card as AI task
      runCardAsTask: async (boardId: string, cardId: string) => {
        try {
          await apiClient.post(`/boards/${boardId}/cards/${cardId}/run`);
          // Task creation will be reflected in card updates via API
        } catch (error) {
          console.error('Failed to run card as task:', error);
          throw error;
        }
      },

      // Cancel card task
      cancelCardTask: async (boardId: string, cardId: string) => {
        try {
          await apiClient.post(`/boards/${boardId}/cards/${cardId}/cancel-run`);
          // Task cancellation will be reflected in card updates via API
        } catch (error) {
          console.error('Failed to cancel card task:', error);
          throw error;
        }
      },

      // Add label to card
      addCardLabel: async (boardId: string, cardId: string, labelId: string) => {
        try {
          await apiClient.post(`/boards/${boardId}/cards/${cardId}/labels`, { labelId });
          // Refetch card to get updated labels
          await get().fetchCard(boardId, cardId);
        } catch (error) {
          console.error('Failed to add card label:', error);
          throw error;
        }
      },

      // Remove label from card
      removeCardLabel: async (boardId: string, cardId: string, labelId: string) => {
        try {
          await apiClient.delete(`/boards/${boardId}/cards/${cardId}/labels/${labelId}`);
          // Refetch card to get updated labels
          await get().fetchCard(boardId, cardId);
        } catch (error) {
          console.error('Failed to remove card label:', error);
          throw error;
        }
      },

      // Add checklist item
      addChecklistItem: async (boardId: string, cardId: string, text: string) => {
        try {
          const response = await apiClient.post(`/boards/${boardId}/cards/${cardId}/checklist`, { text });
          const item = response.data;

          // Update local state
          const currentCard = get().currentCard;
          if (currentCard && currentCard.id === cardId) {
            get().setCurrentCard({
              ...currentCard,
              checklist_items: [...currentCard.checklist_items, item],
            });
          }

          return item;
        } catch (error) {
          console.error('Failed to add checklist item:', error);
          throw error;
        }
      },

      // Toggle checklist item
      toggleChecklistItem: async (boardId: string, cardId: string, itemId: string, completed: boolean) => {
        try {
          await apiClient.put(`/boards/${boardId}/cards/${cardId}/checklist/${itemId}`, { completed });

          // Update local state
          const currentCard = get().currentCard;
          if (currentCard && currentCard.id === cardId) {
            get().setCurrentCard({
              ...currentCard,
              checklist_items: currentCard.checklist_items.map((item) =>
                item.id === itemId ? { ...item, completed } : item
              ),
            });
          }
        } catch (error) {
          console.error('Failed to toggle checklist item:', error);
          throw error;
        }
      },

      // Computed getters
      getStarredBoards: () => {
        return get().boards
          .filter((board) => board.is_starred)
          .sort((a, b) => a.name.localeCompare(b.name));
      },

      getBoard: (boardId: string) => {
        return get().boards.find((board) => board.id === boardId);
      },

      getColumn: (columnId: string) => {
        const { boards, currentBoard } = get();

        // Search in current board first
        if (currentBoard) {
          const column = currentBoard.columns.find((col) => col.id === columnId);
          if (column) return column;
        }

        // Search in all boards
        for (const board of boards) {
          const column = board.columns.find((col) => col.id === columnId);
          if (column) return column;
        }

        return undefined;
      },

      getCard: (cardId: string) => {
        const { boards, currentBoard } = get();

        // Search in current board first
        if (currentBoard) {
          for (const column of currentBoard.columns) {
            const card = column.cards.find((c) => c.id === cardId);
            if (card) return card;
          }
        }

        // Search in all boards
        for (const board of boards) {
          for (const column of board.columns) {
            const card = column.cards.find((c) => c.id === cardId);
            if (card) return card;
          }
        }

        return undefined;
      },
    }),
    {
      name: STORAGE_KEYS.BOARDS,
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist data, not loading/error states
      partialize: (state) => ({
        boards: state.boards,
        currentBoard: state.currentBoard,
        lastUpdated: state.lastUpdated,
      }),
    }
  )
);

// Export store actions for external use
export const boardsActions = {
  fetchBoards: () => useBoardsStore.getState().fetchBoards(),
  fetchBoard: (boardId: string) => useBoardsStore.getState().fetchBoard(boardId),
  createBoard: (input: CreateBoardInput) => useBoardsStore.getState().createBoard(input),
  starBoard: (boardId: string, isStarred: boolean) => useBoardsStore.getState().starBoard(boardId, isStarred),
  createCard: (boardId: string, input: CreateCardInput) => useBoardsStore.getState().createCard(boardId, input),
};
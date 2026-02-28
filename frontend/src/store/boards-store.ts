import { create } from "zustand";
import type {
  Board,
  BoardDetail,
  Label,
  Column,
  Card,
  CreateBoardData,
  CreateColumnData,
  UpdateColumnData,
  CreateCardData,
  UpdateCardData,
  UpdateBoardData,
} from "../lib/boards-api";
import * as boardsApi from "../lib/boards-api";

interface BoardsState {
  boards: Board[];
  currentBoard: BoardDetail | null;
  labels: Label[];
  isLoading: boolean;
  error: string | null;

  // Board CRUD
  fetchBoards: () => Promise<void>;
  createBoard: (data: CreateBoardData) => Promise<Board>;
  deleteBoard: (id: string) => Promise<void>;
  starBoard: (id: string) => Promise<void>;

  // Board detail
  fetchBoardDetail: (boardId: string) => Promise<void>;
  updateBoard: (
    boardId: string,
    data: UpdateBoardData,
  ) => Promise<void>;

  // Column management
  addColumn: (boardId: string, data: CreateColumnData) => Promise<void>;
  updateColumn: (
    boardId: string,
    colId: string,
    data: UpdateColumnData,
  ) => Promise<void>;
  deleteColumn: (boardId: string, colId: string) => Promise<void>;
  reorderColumns: (boardId: string, columnIds: string[]) => Promise<void>;

  // Card management
  addCard: (boardId: string, data: CreateCardData) => Promise<Card>;
  updateCard: (
    boardId: string,
    cardId: string,
    data: UpdateCardData,
  ) => Promise<void>;
  deleteCard: (boardId: string, cardId: string) => Promise<void>;
  moveCard: (
    boardId: string,
    cardId: string,
    columnId: string,
    position: number,
  ) => Promise<void>;

  // Labels
  fetchLabels: () => Promise<void>;

  // Reset
  clearCurrentBoard: () => void;
}

export const useBoardsStore = create<BoardsState>((set, get) => ({
  boards: [],
  currentBoard: null,
  labels: [],
  isLoading: false,
  error: null,

  fetchBoards: async () => {
    set({ isLoading: true, error: null });
    try {
      const boards = await boardsApi.getBoards();
      set({ boards, isLoading: false });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch boards";
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  createBoard: async (data: CreateBoardData) => {
    set({ isLoading: true, error: null });
    try {
      const board = await boardsApi.createBoard(data);
      set((state) => ({
        boards: [...state.boards, board],
        isLoading: false,
      }));
      return board;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create board";
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  deleteBoard: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await boardsApi.deleteBoard(id);
      set((state) => ({
        boards: state.boards.filter((b) => b.id !== id),
        isLoading: false,
      }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete board";
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  starBoard: async (id: string) => {
    // Optimistic update
    set((state) => ({
      boards: state.boards.map((b) =>
        b.id === id ? { ...b, isStarred: !b.isStarred } : b,
      ),
    }));
    try {
      await boardsApi.starBoard(id);
    } catch (error) {
      // Revert on failure
      set((state) => ({
        boards: state.boards.map((b) =>
          b.id === id ? { ...b, isStarred: !b.isStarred } : b,
        ),
      }));
      throw error;
    }
  },

  fetchBoardDetail: async (boardId: string) => {
    set({ isLoading: true, error: null });
    try {
      const board = await boardsApi.getBoard(boardId);
      set({ currentBoard: board, isLoading: false });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch board";
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  updateBoard: async (boardId, data) => {
    try {
      await boardsApi.updateBoard(boardId, data);
      set((state) => ({
        currentBoard: state.currentBoard
          ? { ...state.currentBoard, ...data }
          : null,
        boards: state.boards.map((b) =>
          b.id === boardId ? { ...b, ...data } : b,
        ),
      }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update board";
      set({ error: message });
      throw error;
    }
  },

  addColumn: async (boardId, data) => {
    try {
      const column = await boardsApi.createColumn(boardId, data);
      set((state) => {
        if (!state.currentBoard || state.currentBoard.id !== boardId)
          return state;
        return {
          currentBoard: {
            ...state.currentBoard,
            columns: [...state.currentBoard.columns, { ...column, cards: [] }],
          },
        };
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to add column";
      set({ error: message });
      throw error;
    }
  },

  updateColumn: async (boardId, colId, data) => {
    try {
      await boardsApi.updateColumn(boardId, colId, data);
      set((state) => {
        if (!state.currentBoard) return state;
        return {
          currentBoard: {
            ...state.currentBoard,
            columns: state.currentBoard.columns.map((col) =>
              col.id === colId ? { ...col, ...data } : col,
            ),
          },
        };
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update column";
      set({ error: message });
      throw error;
    }
  },

  deleteColumn: async (boardId, colId) => {
    try {
      await boardsApi.deleteColumn(boardId, colId);
      set((state) => {
        if (!state.currentBoard) return state;
        return {
          currentBoard: {
            ...state.currentBoard,
            columns: state.currentBoard.columns.filter(
              (col) => col.id !== colId,
            ),
          },
        };
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete column";
      set({ error: message });
      throw error;
    }
  },

  reorderColumns: async (boardId, columnIds) => {
    const prev = get().currentBoard;
    // Optimistic reorder
    set((state) => {
      if (!state.currentBoard) return state;
      const colMap = new Map(
        state.currentBoard.columns.map((c) => [c.id, c]),
      );
      const reordered = columnIds
        .map((id) => colMap.get(id))
        .filter(Boolean) as Column[];
      return {
        currentBoard: { ...state.currentBoard, columns: reordered },
      };
    });
    try {
      await boardsApi.reorderColumns(boardId, columnIds);
    } catch {
      // Revert
      set({ currentBoard: prev });
    }
  },

  addCard: async (boardId, data) => {
    const card = await boardsApi.createCard(boardId, data);
    set((state) => {
      if (!state.currentBoard) return state;
      return {
        currentBoard: {
          ...state.currentBoard,
          columns: state.currentBoard.columns.map((col) =>
            col.id === data.columnId
              ? {
                  ...col,
                  cards: [
                    ...col.cards,
                    { ...card, labels: [], checklistItems: [], commentCount: 0 },
                  ],
                }
              : col,
          ),
        },
      };
    });
    return card;
  },

  updateCard: async (boardId, cardId, data) => {
    try {
      const updatedCard = await boardsApi.updateCard(boardId, cardId, data);
      set((state) => {
        if (!state.currentBoard) return state;
        return {
          currentBoard: {
            ...state.currentBoard,
            columns: state.currentBoard.columns.map((col) => ({
              ...col,
              cards: col.cards.map((card) =>
                card.id === cardId ? { ...card, ...updatedCard } : card,
              ),
            })),
          },
        };
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update card";
      set({ error: message });
      throw error;
    }
  },

  deleteCard: async (boardId, cardId) => {
    try {
      await boardsApi.deleteCard(boardId, cardId);
      set((state) => {
        if (!state.currentBoard) return state;
        return {
          currentBoard: {
            ...state.currentBoard,
            columns: state.currentBoard.columns.map((col) => ({
              ...col,
              cards: col.cards.filter((card) => card.id !== cardId),
            })),
          },
        };
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete card";
      set({ error: message });
      throw error;
    }
  },

  moveCard: async (
    boardId: string,
    cardId: string,
    columnId: string,
    position: number,
  ) => {
    const prev = get().currentBoard;

    // Optimistic update: move card locally
    set((state) => {
      if (!state.currentBoard) return state;
      let movedCard: Card | null = null;

      // Remove card from its current column
      const columnsWithoutCard = state.currentBoard.columns.map((col) => {
        const cardIndex = col.cards.findIndex((c) => c.id === cardId);
        if (cardIndex >= 0) {
          movedCard = { ...col.cards[cardIndex], columnId };
          return {
            ...col,
            cards: col.cards.filter((c) => c.id !== cardId),
          };
        }
        return col;
      });

      if (!movedCard) return state;

      // Insert card into target column at target position
      const columnsWithCard = columnsWithoutCard.map((col) => {
        if (col.id === columnId) {
          const newCards = [...col.cards];
          newCards.splice(position, 0, movedCard!);
          return { ...col, cards: newCards };
        }
        return col;
      });

      return {
        currentBoard: { ...state.currentBoard, columns: columnsWithCard },
      };
    });

    try {
      await boardsApi.moveCard(boardId, cardId, { columnId, position });
    } catch {
      // Revert on failure
      set({ currentBoard: prev });
    }
  },

  fetchLabels: async () => {
    try {
      const labels = await boardsApi.getLabels();
      set({ labels });
    } catch (error) {
      console.error("Failed to fetch labels:", error);
    }
  },

  clearCurrentBoard: () => {
    set({ currentBoard: null });
  },
}));

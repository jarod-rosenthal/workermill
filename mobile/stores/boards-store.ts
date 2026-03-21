import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Board, Card, ChecklistItem, CardActivity } from '@/types/boards';
import { apiClient } from '@/lib/api-client';
import { STORAGE_KEYS } from '@/constants/config';

export interface BoardsState {
  // Data
  boards: Board[];
  currentBoard: Board | null;
  lastUpdated: string | null;

  // Loading states
  isLoading: boolean;
  isBoardLoading: boolean;
  isCardLoading: boolean;
  error: string | null;

  // Actions - Board operations
  loadBoards: () => Promise<void>;
  loadBoard: (boardId: string) => Promise<void>;
  createBoard: (data: { name: string; description?: string; prefix: string }) => Promise<Board>;
  updateBoard: (boardId: string, data: Partial<Board>) => Promise<Board>;
  deleteBoard: (boardId: string) => Promise<void>;
  toggleBoardStar: (boardId: string, isStarred: boolean) => Promise<void>;

  // Actions - Card operations
  createCard: (boardId: string, columnId: string, data: { title: string; description?: string; priority?: 'urgent' | 'high' | 'medium' | 'low' }) => Promise<Card>;
  updateCard: (boardId: string, cardId: string, data: Partial<Card>) => Promise<Card>;
  moveCard: (boardId: string, cardId: string, columnId: string, position?: number) => Promise<Card>;
  deleteCard: (boardId: string, cardId: string) => Promise<void>;
  runCardAsTask: (boardId: string, cardId: string) => Promise<void>;
  cancelCardTask: (boardId: string, cardId: string) => Promise<void>;

  // Actions - Card components
  addCardLabel: (boardId: string, cardId: string, labelId: string) => Promise<void>;
  removeCardLabel: (boardId: string, cardId: string, labelId: string) => Promise<void>;
  addChecklistItem: (boardId: string, cardId: string, text: string) => Promise<ChecklistItem>;
  updateChecklistItem: (boardId: string, cardId: string, itemId: string, data: { text?: string; completed?: boolean }) => Promise<ChecklistItem>;
  deleteChecklistItem: (boardId: string, cardId: string, itemId: string) => Promise<void>;
  getCardActivity: (boardId: string, cardId: string) => Promise<CardActivity[]>;

  // Convenience getters
  getBoardById: (id: string) => Board | null;
  getStarredBoards: () => Board[];
  getCardById: (boardId: string, cardId: string) => Card | null;
  getColumnCards: (boardId: string, columnId: string) => Card[];
}

export const useBoardsStore = create<BoardsState>()(
  persist(
    (set, get) => ({
      // Initial state
      boards: [],
      currentBoard: null,
      lastUpdated: null,
      isLoading: false,
      isBoardLoading: false,
      isCardLoading: false,
      error: null,

      // Board operations
      loadBoards: async () => {
        set({ isLoading: true, error: null });

        try {
          const data = await apiClient.get<{ boards: Board[] }>('/boards');

          set({
            boards: data.boards || [],
            lastUpdated: new Date().toISOString(),
            isLoading: false,
            error: null
          });
        } catch (error: any) {
          const errorMessage = error.response?.data?.message || 'Failed to load boards';
          set({
            isLoading: false,
            error: errorMessage
          });
          throw error;
        }
      },

      loadBoard: async (boardId: string) => {
        set({ isBoardLoading: true, error: null });

        try {
          const board = await apiClient.get<Board>(`/boards/${boardId}`);

          set(state => ({
            currentBoard: board,
            // Update the board in the boards list if it exists
            boards: state.boards.map(b => b.id === boardId ? board : b),
            lastUpdated: new Date().toISOString(),
            isBoardLoading: false,
            error: null
          }));
        } catch (error: any) {
          const errorMessage = error.response?.data?.message || 'Failed to load board';
          set({
            isBoardLoading: false,
            error: errorMessage
          });
          throw error;
        }
      },

      createBoard: async (data) => {
        set({ isLoading: true, error: null });

        try {
          const board = await apiClient.post<Board>('/boards', data);

          set(state => ({
            boards: [board, ...state.boards],
            lastUpdated: new Date().toISOString(),
            isLoading: false,
            error: null
          }));

          return board;
        } catch (error: any) {
          const errorMessage = error.response?.data?.message || 'Failed to create board';
          set({
            isLoading: false,
            error: errorMessage
          });
          throw error;
        }
      },

      updateBoard: async (boardId: string, data: Partial<Board>) => {
        try {
          const board = await apiClient.put<Board>(`/boards/${boardId}`, data);

          set(state => ({
            boards: state.boards.map(b => b.id === boardId ? board : b),
            currentBoard: state.currentBoard?.id === boardId ? board : state.currentBoard,
            lastUpdated: new Date().toISOString()
          }));

          return board;
        } catch (error: any) {
          const errorMessage = error.response?.data?.message || 'Failed to update board';
          set({ error: errorMessage });
          throw error;
        }
      },

      deleteBoard: async (boardId: string) => {
        try {
          await apiClient.delete(`/boards/${boardId}`);

          set(state => ({
            boards: state.boards.filter(b => b.id !== boardId),
            currentBoard: state.currentBoard?.id === boardId ? null : state.currentBoard,
            lastUpdated: new Date().toISOString()
          }));
        } catch (error: any) {
          const errorMessage = error.response?.data?.message || 'Failed to delete board';
          set({ error: errorMessage });
          throw error;
        }
      },

      toggleBoardStar: async (boardId: string, isStarred: boolean) => {
        try {
          const board = await apiClient.put<Board>(`/boards/${boardId}`, { is_starred: isStarred });

          set(state => ({
            boards: state.boards.map(b => b.id === boardId ? board : b),
            currentBoard: state.currentBoard?.id === boardId ? board : state.currentBoard,
            lastUpdated: new Date().toISOString()
          }));
        } catch (error: any) {
          const errorMessage = error.response?.data?.message || 'Failed to update board';
          set({ error: errorMessage });
          throw error;
        }
      },

      // Card operations
      createCard: async (boardId: string, columnId: string, data) => {
        set({ isCardLoading: true, error: null });

        try {
          const card = await apiClient.post<Card>(`/boards/${boardId}/cards`, {
            ...data,
            column_id: columnId
          });

          // Update current board if it matches
          set(state => {
            if (state.currentBoard?.id === boardId) {
              const updatedBoard = {
                ...state.currentBoard,
                columns: state.currentBoard.columns.map(col =>
                  col.id === columnId
                    ? { ...col, cards: [card, ...col.cards] }
                    : col
                ),
                card_count: state.currentBoard.card_count + 1
              };

              return {
                currentBoard: updatedBoard,
                boards: state.boards.map(b => b.id === boardId ? updatedBoard : b),
                lastUpdated: new Date().toISOString(),
                isCardLoading: false,
                error: null
              };
            }

            return {
              lastUpdated: new Date().toISOString(),
              isCardLoading: false,
              error: null
            };
          });

          return card;
        } catch (error: any) {
          const errorMessage = error.response?.data?.message || 'Failed to create card';
          set({
            isCardLoading: false,
            error: errorMessage
          });
          throw error;
        }
      },

      updateCard: async (boardId: string, cardId: string, data: Partial<Card>) => {
        try {
          const card = await apiClient.put<Card>(`/boards/${boardId}/cards/${cardId}`, data);

          // Update current board if it matches
          set(state => {
            if (state.currentBoard?.id === boardId) {
              const updatedBoard = {
                ...state.currentBoard,
                columns: state.currentBoard.columns.map(col => ({
                  ...col,
                  cards: col.cards.map(c => c.id === cardId ? card : c)
                }))
              };

              return {
                currentBoard: updatedBoard,
                boards: state.boards.map(b => b.id === boardId ? updatedBoard : b),
                lastUpdated: new Date().toISOString()
              };
            }

            return {
              lastUpdated: new Date().toISOString()
            };
          });

          return card;
        } catch (error: any) {
          const errorMessage = error.response?.data?.message || 'Failed to update card';
          set({ error: errorMessage });
          throw error;
        }
      },

      moveCard: async (boardId: string, cardId: string, columnId: string, position) => {
        try {
          const card = await apiClient.put<Card>(`/boards/${boardId}/cards/${cardId}`, {
            column_id: columnId,
            position
          });

          // Update current board if it matches
          set(state => {
            if (state.currentBoard?.id === boardId) {
              // Remove card from old column and add to new column
              const oldCard = get().getCardById(boardId, cardId);
              if (!oldCard) return state;

              const updatedBoard = {
                ...state.currentBoard,
                columns: state.currentBoard.columns.map(col => {
                  if (col.id === oldCard.column_id && col.id !== columnId) {
                    // Remove from old column
                    return {
                      ...col,
                      cards: col.cards.filter(c => c.id !== cardId)
                    };
                  } else if (col.id === columnId) {
                    // Add to new column
                    const filteredCards = col.cards.filter(c => c.id !== cardId);
                    return {
                      ...col,
                      cards: [...filteredCards, card].sort((a, b) => a.position - b.position)
                    };
                  }
                  return col;
                })
              };

              return {
                currentBoard: updatedBoard,
                boards: state.boards.map(b => b.id === boardId ? updatedBoard : b),
                lastUpdated: new Date().toISOString()
              };
            }

            return {
              lastUpdated: new Date().toISOString()
            };
          });

          return card;
        } catch (error: any) {
          const errorMessage = error.response?.data?.message || 'Failed to move card';
          set({ error: errorMessage });
          throw error;
        }
      },

      deleteCard: async (boardId: string, cardId: string) => {
        try {
          await apiClient.delete(`/boards/${boardId}/cards/${cardId}`);

          // Update current board if it matches
          set(state => {
            if (state.currentBoard?.id === boardId) {
              const updatedBoard = {
                ...state.currentBoard,
                columns: state.currentBoard.columns.map(col => ({
                  ...col,
                  cards: col.cards.filter(c => c.id !== cardId)
                })),
                card_count: state.currentBoard.card_count - 1
              };

              return {
                currentBoard: updatedBoard,
                boards: state.boards.map(b => b.id === boardId ? updatedBoard : b),
                lastUpdated: new Date().toISOString()
              };
            }

            return {
              lastUpdated: new Date().toISOString()
            };
          });
        } catch (error: any) {
          const errorMessage = error.response?.data?.message || 'Failed to delete card';
          set({ error: errorMessage });
          throw error;
        }
      },

      runCardAsTask: async (boardId: string, cardId: string) => {
        try {
          await apiClient.post(`/boards/${boardId}/cards/${cardId}/run`);

          // The task creation will be reflected in the card's linked_task_id
          // via a subsequent loadBoard call or real-time update
        } catch (error: any) {
          const errorMessage = error.response?.data?.message || 'Failed to run card as task';
          set({ error: errorMessage });
          throw error;
        }
      },

      cancelCardTask: async (boardId: string, cardId: string) => {
        try {
          await apiClient.post(`/boards/${boardId}/cards/${cardId}/cancel-run`);

          // The task cancellation will be reflected in the card status
          // via a subsequent loadBoard call or real-time update
        } catch (error: any) {
          const errorMessage = error.response?.data?.message || 'Failed to cancel card task';
          set({ error: errorMessage });
          throw error;
        }
      },

      // Card component operations
      addCardLabel: async (boardId: string, cardId: string, labelId: string) => {
        try {
          await apiClient.post(`/boards/${boardId}/cards/${cardId}/labels`, { label_id: labelId });

          // Reload the card to get updated labels
          await get().loadBoard(boardId);
        } catch (error: any) {
          const errorMessage = error.response?.data?.message || 'Failed to add label';
          set({ error: errorMessage });
          throw error;
        }
      },

      removeCardLabel: async (boardId: string, cardId: string, labelId: string) => {
        try {
          await apiClient.delete(`/boards/${boardId}/cards/${cardId}/labels/${labelId}`);

          // Reload the card to get updated labels
          await get().loadBoard(boardId);
        } catch (error: any) {
          const errorMessage = error.response?.data?.message || 'Failed to remove label';
          set({ error: errorMessage });
          throw error;
        }
      },

      addChecklistItem: async (boardId: string, cardId: string, text: string) => {
        try {
          const item = await apiClient.post<ChecklistItem>(`/boards/${boardId}/cards/${cardId}/checklist`, { text });

          // Update current board if it matches
          set(state => {
            if (state.currentBoard?.id === boardId) {
              const updatedBoard = {
                ...state.currentBoard,
                columns: state.currentBoard.columns.map(col => ({
                  ...col,
                  cards: col.cards.map(card => {
                    if (card.id === cardId) {
                      return {
                        ...card,
                        checklist_items: [...card.checklist_items, item]
                      };
                    }
                    return card;
                  })
                }))
              };

              return {
                currentBoard: updatedBoard,
                boards: state.boards.map(b => b.id === boardId ? updatedBoard : b),
                lastUpdated: new Date().toISOString()
              };
            }

            return {
              lastUpdated: new Date().toISOString()
            };
          });

          return item;
        } catch (error: any) {
          const errorMessage = error.response?.data?.message || 'Failed to add checklist item';
          set({ error: errorMessage });
          throw error;
        }
      },

      updateChecklistItem: async (boardId: string, cardId: string, itemId: string, data) => {
        try {
          const item = await apiClient.put<ChecklistItem>(`/boards/${boardId}/cards/${cardId}/checklist/${itemId}`, data);

          // Update current board if it matches
          set(state => {
            if (state.currentBoard?.id === boardId) {
              const updatedBoard = {
                ...state.currentBoard,
                columns: state.currentBoard.columns.map(col => ({
                  ...col,
                  cards: col.cards.map(card => {
                    if (card.id === cardId) {
                      return {
                        ...card,
                        checklist_items: card.checklist_items.map(ci => ci.id === itemId ? item : ci)
                      };
                    }
                    return card;
                  })
                }))
              };

              return {
                currentBoard: updatedBoard,
                boards: state.boards.map(b => b.id === boardId ? updatedBoard : b),
                lastUpdated: new Date().toISOString()
              };
            }

            return {
              lastUpdated: new Date().toISOString()
            };
          });

          return item;
        } catch (error: any) {
          const errorMessage = error.response?.data?.message || 'Failed to update checklist item';
          set({ error: errorMessage });
          throw error;
        }
      },

      deleteChecklistItem: async (boardId: string, cardId: string, itemId: string) => {
        try {
          await apiClient.delete(`/boards/${boardId}/cards/${cardId}/checklist/${itemId}`);

          // Update current board if it matches
          set(state => {
            if (state.currentBoard?.id === boardId) {
              const updatedBoard = {
                ...state.currentBoard,
                columns: state.currentBoard.columns.map(col => ({
                  ...col,
                  cards: col.cards.map(card => {
                    if (card.id === cardId) {
                      return {
                        ...card,
                        checklist_items: card.checklist_items.filter(ci => ci.id !== itemId)
                      };
                    }
                    return card;
                  })
                }))
              };

              return {
                currentBoard: updatedBoard,
                boards: state.boards.map(b => b.id === boardId ? updatedBoard : b),
                lastUpdated: new Date().toISOString()
              };
            }

            return {
              lastUpdated: new Date().toISOString()
            };
          });
        } catch (error: any) {
          const errorMessage = error.response?.data?.message || 'Failed to delete checklist item';
          set({ error: errorMessage });
          throw error;
        }
      },

      getCardActivity: async (boardId: string, cardId: string) => {
        try {
          const activity = await apiClient.get<CardActivity[]>(`/boards/${boardId}/cards/${cardId}/activity`);
          return activity;
        } catch (error: any) {
          const errorMessage = error.response?.data?.message || 'Failed to load card activity';
          set({ error: errorMessage });
          throw error;
        }
      },

      // Convenience getters
      getBoardById: (id: string) => {
        return get().boards.find(board => board.id === id) || null;
      },

      getStarredBoards: () => {
        return get().boards.filter(board => board.is_starred).sort((a, b) => a.name.localeCompare(b.name));
      },

      getCardById: (boardId: string, cardId: string) => {
        const board = get().currentBoard?.id === boardId ? get().currentBoard : get().getBoardById(boardId);

        if (!board) return null;

        for (const column of board.columns) {
          const card = column.cards.find(c => c.id === cardId);
          if (card) return card;
        }

        return null;
      },

      getColumnCards: (boardId: string, columnId: string) => {
        const board = get().currentBoard?.id === boardId ? get().currentBoard : get().getBoardById(boardId);

        if (!board) return [];

        const column = board.columns.find(col => col.id === columnId);
        return column ? column.cards.sort((a, b) => a.position - b.position) : [];
      },
    }),
    {
      name: STORAGE_KEYS.BOARDS,
      storage: createJSONStorage(() => AsyncStorage),
      // Persist all data except loading states and errors
      partialize: (state) => ({
        boards: state.boards,
        currentBoard: state.currentBoard,
        lastUpdated: state.lastUpdated,
      }),
    }
  )
);
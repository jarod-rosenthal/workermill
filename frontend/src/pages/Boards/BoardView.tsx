import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  RefreshCw,
  Settings,
  Plus,
  Columns3,
  Play,
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useBoardsStore } from "../../store/boards-store";
import type { Card, Column } from "../../lib/boards-api";
import { runAllCards } from "../../lib/boards-api";
import ColumnHeader from "./ColumnHeader";
import CardItem from "./CardItem";
import CardDetail from "./CardDetail";

// ── Sortable Column Wrapper ────────────────────────────────────────────────

interface SortableColumnProps {
  column: Column;
  boardId: string;
  blockedCardIds: Set<string>;
  onAddCard: (columnId: string) => void;
  onCardClick: (card: Card) => void;
  onRenameColumn: (colId: string, name: string) => void;
  onDeleteColumn: (colId: string) => void;
  onSetWipLimit: (colId: string, limit: number | null) => void;
  onChangeColor: (colId: string, color: string | null) => void;
}

function SortableColumn({
  column,
  boardId: _boardId,
  blockedCardIds,
  onAddCard,
  onCardClick,
  onRenameColumn,
  onDeleteColumn,
  onSetWipLimit,
  onChangeColor,
}: SortableColumnProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `column-${column.id}`,
    data: { type: "column", column },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const cardIds = useMemo(
    () => column.cards.map((c) => c.id),
    [column.cards],
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={`flex-1 min-w-[240px] max-w-[400px] rounded-xl bg-muted/40 p-3 flex flex-col max-h-full ${
        isDragging ? "opacity-50 shadow-xl ring-2 ring-primary/30" : ""
      }`}
    >
      <ColumnHeader
        column={column}
        cardCount={column.cards.length}
        onAddCard={() => onAddCard(column.id)}
        onRename={(name) => onRenameColumn(column.id, name)}
        onDelete={() => onDeleteColumn(column.id)}
        onSetWipLimit={(limit) => onSetWipLimit(column.id, limit)}
        onChangeColor={(color) => onChangeColor(column.id, color)}
        dragHandleProps={listeners}
      />

      <SortableContext
        items={cardIds}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex-1 overflow-y-auto space-y-2.5 min-h-[40px] scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
          {column.cards.length === 0 && (
            <p className="text-xs text-muted-foreground/50 text-center py-6">
              No cards
            </p>
          )}
          {column.cards.map((card) => (
            <CardItem
              key={card.id}
              card={card}
              onClick={() => onCardClick(card)}
              isBlocked={blockedCardIds.has(card.id)}
              dependencyCount={card.dependencies?.length}
            />
          ))}
        </div>
      </SortableContext>

      {/* Inline add card at column bottom */}
      <button
        onClick={() => onAddCard(column.id)}
        className="mt-2 flex items-center gap-1.5 w-full px-2 py-1.5 rounded-lg text-xs text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/60 transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
        Add card
      </button>
    </div>
  );
}

// ── Main Board View ────────────────────────────────────────────────────────

export default function BoardView() {
  const { boardId } = useParams<{ boardId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    currentBoard,
    labels,
    isLoading,
    error,
    fetchBoardDetail,
    fetchLabels,
    moveCard,
    reorderColumns,
    addColumn,
    updateColumn,
    deleteColumn,
    addCard,
    updateCard,
    deleteCard,
    clearCurrentBoard,
  } = useBoardsStore();

  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [showAddCard, setShowAddCard] = useState<string | null>(null);
  const [newCardTitle, setNewCardTitle] = useState("");
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<"card" | "column" | null>(null);
  const [runAllLoading, setRunAllLoading] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  useEffect(() => {
    if (boardId) {
      fetchBoardDetail(boardId);
      fetchLabels();
    }
    return () => clearCurrentBoard();
  }, [boardId, fetchBoardDetail, fetchLabels, clearCurrentBoard]);

  // Poll board when active worker cards exist (or recently had active cards)
  const hasActiveWorkerCards = useMemo(() => {
    if (!currentBoard) return false;
    const activeStatuses = [
      "queued",
      "claimed",
      "environment_setup",
      "executing",
      "planning",
      "pr_created",
      "review_requested",
      "pr_approved",
      "dispatching",
    ];
    return currentBoard.columns.some((col) =>
      col.cards.some(
        (card) =>
          card.workerTaskId &&
          card.workerStatus &&
          activeStatuses.includes(card.workerStatus),
      ),
    );
  }, [currentBoard]);

  // Keep polling briefly after active cards disappear so we catch the final
  // column move (server moves cards on status change, client needs another
  // fetch to see the card in its new column).
  const [pollCooldown, setPollCooldown] = useState(false);
  const prevActive = useRef(false);

  useEffect(() => {
    // When active cards disappear, start a 30s cooldown poll
    if (prevActive.current && !hasActiveWorkerCards) {
      setPollCooldown(true);
      const timer = setTimeout(() => setPollCooldown(false), 30_000);
      return () => clearTimeout(timer);
    }
    prevActive.current = hasActiveWorkerCards;
  }, [hasActiveWorkerCards]);

  const shouldPoll = hasActiveWorkerCards || pollCooldown;

  useEffect(() => {
    if (!shouldPoll || !boardId) return;
    const interval = setInterval(() => {
      fetchBoardDetail(boardId);
    }, 5_000);
    return () => clearInterval(interval);
  }, [shouldPoll, boardId, fetchBoardDetail]);

  // Compute blocked card IDs: a card is blocked if it has dependencies
  // and any dependency card's workerStatus is not in a terminal state
  const blockedCardIds = useMemo(() => {
    if (!currentBoard) return new Set<string>();
    const doneStatuses = new Set(["completed", "deployed", "pr_approved", "review_approved"]);
    // Build a map of cardId -> workerStatus for fast lookup
    const cardStatusMap = new Map<string, string | null>();
    for (const col of currentBoard.columns) {
      for (const card of col.cards) {
        cardStatusMap.set(card.id, card.workerStatus);
      }
    }
    const blocked = new Set<string>();
    for (const col of currentBoard.columns) {
      for (const card of col.cards) {
        if (card.dependencies && card.dependencies.length > 0) {
          const anyIncomplete = card.dependencies.some((dep) => {
            const status = cardStatusMap.get(dep.cardId);
            return !status || !doneStatuses.has(status);
          });
          if (anyIncomplete) {
            blocked.add(card.id);
          }
        }
      }
    }
    return blocked;
  }, [currentBoard]);

  // Run all cards on the board
  const handleRunAll = useCallback(async () => {
    if (!boardId || runAllLoading) return;
    setRunAllLoading(true);
    try {
      const result = await runAllCards(boardId);
      const count = result?.tasksCreated ?? 0;
      alert(`Started ${count} AI worker task${count === 1 ? "" : "s"}`);
      fetchBoardDetail(boardId);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to run all cards";
      alert(msg);
    } finally {
      setRunAllLoading(false);
    }
  }, [boardId, runAllLoading, fetchBoardDetail]);

  // Auto-open card detail when ?card= query param is present
  useEffect(() => {
    const cardId = searchParams.get("card");
    if (!cardId || !currentBoard?.columns) return;

    for (const col of currentBoard.columns) {
      const card = col.cards.find((c) => c.id === cardId);
      if (card) {
        setSelectedCard(card);
        // Clear the query param so it doesn't re-trigger
        setSearchParams({}, { replace: true });
        break;
      }
    }
  }, [searchParams, currentBoard?.columns, setSearchParams]);

  const handleRefresh = useCallback(() => {
    if (boardId) fetchBoardDetail(boardId);
  }, [boardId, fetchBoardDetail]);

  // ── Drag handlers ──

  const findCard = useCallback(
    (cardId: string): { card: Card; column: Column } | null => {
      if (!currentBoard) return null;
      for (const col of currentBoard.columns) {
        const card = col.cards.find((c) => c.id === cardId);
        if (card) return { card, column: col };
      }
      return null;
    },
    [currentBoard],
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const id = String(active.id);
    if (id.startsWith("column-")) {
      setActiveId(id);
      setActiveType("column");
    } else {
      setActiveId(id);
      setActiveType("card");
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || !currentBoard || !boardId) return;

    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);

    // Only handle card dragging over columns here
    if (activeIdStr.startsWith("column-")) return;

    // Find what column the dragged card is in
    const activeResult = findCard(activeIdStr);
    if (!activeResult) return;

    // Determine target column
    let overColumnId: string | null = null;
    if (overIdStr.startsWith("column-")) {
      overColumnId = overIdStr.replace("column-", "");
    } else {
      const overResult = findCard(overIdStr);
      if (overResult) overColumnId = overResult.column.id;
    }

    if (!overColumnId || activeResult.column.id === overColumnId) return;

    // Move card to the new column (just append for now; final position set in handleDragEnd)
    const targetCol = currentBoard.columns.find((c) => c.id === overColumnId);
    if (!targetCol) return;

    moveCard(boardId, activeIdStr, overColumnId, targetCol.cards.length);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setActiveType(null);

    if (!over || !currentBoard || !boardId) return;

    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);

    // Column reorder
    if (activeIdStr.startsWith("column-") && overIdStr.startsWith("column-")) {
      const oldColId = activeIdStr.replace("column-", "");
      const newColId = overIdStr.replace("column-", "");
      if (oldColId !== newColId) {
        const columnIds = currentBoard.columns.map((c) => c.id);
        const oldIdx = columnIds.indexOf(oldColId);
        const newIdx = columnIds.indexOf(newColId);
        if (oldIdx !== -1 && newIdx !== -1) {
          const reordered = arrayMove(columnIds, oldIdx, newIdx);
          reorderColumns(boardId, reordered);
        }
      }
      return;
    }

    // Card reorder within same column
    if (!activeIdStr.startsWith("column-")) {
      const activeResult = findCard(activeIdStr);
      if (!activeResult) return;

      let targetColumnId = activeResult.column.id;
      let targetPosition = 0;

      if (overIdStr.startsWith("column-")) {
        targetColumnId = overIdStr.replace("column-", "");
        const col = currentBoard.columns.find((c) => c.id === targetColumnId);
        targetPosition = col?.cards.length ?? 0;
      } else {
        const overResult = findCard(overIdStr);
        if (overResult) {
          targetColumnId = overResult.column.id;
          targetPosition = overResult.column.cards.findIndex(
            (c) => c.id === overIdStr,
          );
          if (targetPosition < 0) targetPosition = 0;
        }
      }

      moveCard(boardId, activeIdStr, targetColumnId, targetPosition);
    }
  };

  // ── Card/Column CRUD ──

  const handleAddCard = async (columnId: string) => {
    setShowAddCard(columnId);
  };

  const handleSubmitCard = async (columnId: string) => {
    const trimmed = newCardTitle.trim();
    if (!trimmed || !boardId) return;
    try {
      await addCard(boardId, { columnId, title: trimmed });
      setNewCardTitle("");
      setShowAddCard(null);
    } catch {
      // Ignore
    }
  };

  const handleAddColumn = async () => {
    const trimmed = newColumnName.trim();
    if (!trimmed || !boardId) return;
    try {
      await addColumn(boardId, { name: trimmed });
      setNewColumnName("");
      setShowAddColumn(false);
    } catch {
      // Ignore
    }
  };

  const handleRenameColumn = async (colId: string, name: string) => {
    if (!boardId) return;
    await updateColumn(boardId, colId, { name });
  };

  const handleDeleteColumn = async (colId: string) => {
    if (!boardId) return;
    await deleteColumn(boardId, colId);
  };

  const handleSetWipLimit = async (
    colId: string,
    limit: number | null,
  ) => {
    if (!boardId) return;
    await updateColumn(boardId, colId, { wipLimit: limit });
  };

  const handleChangeColor = async (
    colId: string,
    color: string | null,
  ) => {
    if (!boardId) return;
    await updateColumn(boardId, colId, { color });
  };

  const handleCardUpdate = async (
    cardId: string,
    data: Record<string, unknown>,
  ) => {
    if (!boardId) return;
    await updateCard(boardId, cardId, data);
    // Refresh board and labels to get latest data (labels may have been created)
    await Promise.all([fetchBoardDetail(boardId), fetchLabels()]);
    // Update selected card if open
    if (selectedCard?.id === cardId) {
      const board = useBoardsStore.getState().currentBoard;
      if (board) {
        for (const col of board.columns) {
          const updated = col.cards.find((c) => c.id === cardId);
          if (updated) {
            setSelectedCard(updated);
            break;
          }
        }
      }
    }
  };

  const handleCardDelete = async (cardId: string) => {
    if (!boardId) return;
    await deleteCard(boardId, cardId);
    setSelectedCard(null);
  };

  // ── Drag overlay content ──

  const activeCard = useMemo(() => {
    if (activeType !== "card" || !activeId) return null;
    return findCard(activeId)?.card ?? null;
  }, [activeType, activeId, findCard]);

  const activeColumn = useMemo(() => {
    if (activeType !== "column" || !activeId || !currentBoard) return null;
    const colId = activeId.replace("column-", "");
    return currentBoard.columns.find((c) => c.id === colId) ?? null;
  }, [activeType, activeId, currentBoard]);

  const columnSortIds = useMemo(
    () =>
      currentBoard?.columns.map((c) => `column-${c.id}`) ?? [],
    [currentBoard],
  );

  if (isLoading && !currentBoard) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && !currentBoard) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500 mb-4">{error}</p>
          <Link
            to="/boards"
            className="text-primary hover:text-primary/80"
          >
            Back to Boards
          </Link>
        </div>
      </div>
    );
  }

  if (!currentBoard) return null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border/30 glass-strong sticky top-0 z-10">
        <div className="max-w-full mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/boards"
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="text-sm">Boards</span>
            </Link>
            <div className="h-6 w-px bg-border" />
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Columns3 className="h-5 w-5" />
              {currentBoard.name}
            </h1>
            {currentBoard.description && (
              <span className="text-sm text-muted-foreground hidden md:inline">
                {currentBoard.description}
              </span>
            )}
            {currentBoard.prdContent && (
              <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded text-xs font-medium">
                Full Build
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {currentBoard.prdContent && (
              <button
                onClick={handleRunAll}
                disabled={runAllLoading}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm rounded-lg flex items-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5" />
                {runAllLoading ? "Running..." : "Run All"}
              </button>
            )}
            <button
              onClick={handleRefresh}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
              title="Refresh"
            >
              <RefreshCw
                className={`w-4 h-4 text-muted-foreground ${isLoading ? "animate-spin" : ""}`}
              />
            </button>
            <Link
              to={`/boards/${boardId}/settings`}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
              title="Board Settings"
            >
              <Settings className="w-4 h-4 text-muted-foreground" />
            </Link>
          </div>
        </div>
      </header>

      {/* Board */}
      <main className="flex-1 overflow-x-auto px-3 py-4 md:p-6 bg-background/50">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={columnSortIds}
            strategy={horizontalListSortingStrategy}
          >
            <div className="flex gap-3 md:gap-5 items-start h-full">
              {currentBoard.columns.map((column) => (
                <SortableColumn
                  key={column.id}
                  column={column}
                  boardId={boardId!}
                  blockedCardIds={blockedCardIds}
                  onAddCard={handleAddCard}
                  onCardClick={setSelectedCard}
                  onRenameColumn={handleRenameColumn}
                  onDeleteColumn={handleDeleteColumn}
                  onSetWipLimit={handleSetWipLimit}
                  onChangeColor={handleChangeColor}
                />
              ))}

              {/* Add column placeholder */}
              {!showAddColumn ? (
                <button
                  onClick={() => setShowAddColumn(true)}
                  className="flex-shrink-0 min-w-[200px] w-[240px] rounded-xl border-2 border-dashed border-border/40 hover:border-border/70 p-4 flex items-center justify-center gap-2 text-sm text-muted-foreground/50 hover:text-muted-foreground transition-colors min-h-[100px]"
                >
                  <Plus className="w-4 h-4" />
                  Add column
                </button>
              ) : (
                <div className="flex-shrink-0 min-w-[200px] w-[240px] rounded-xl bg-muted/40 p-3">
                  <input
                    value={newColumnName}
                    onChange={(e) => setNewColumnName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddColumn();
                      if (e.key === "Escape") {
                        setShowAddColumn(false);
                        setNewColumnName("");
                      }
                    }}
                    placeholder="Column name..."
                    className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                    autoFocus
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={handleAddColumn}
                      className="px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => {
                        setShowAddColumn(false);
                        setNewColumnName("");
                      }}
                      className="px-3 py-1.5 text-sm rounded-lg hover:bg-muted text-muted-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Spacer for horizontal scroll */}
              <div className="flex-shrink-0 w-4" />
            </div>
          </SortableContext>

          {/* Drag overlay */}
          <DragOverlay>
            {activeCard && (
              <div className="w-[280px] rounded-lg border border-primary/40 bg-card p-3 shadow-2xl rotate-2 ring-1 ring-primary/20">
                {activeCard.issueKey && (
                  <p className="text-[10px] font-mono text-muted-foreground mb-0.5">{activeCard.issueKey}</p>
                )}
                <p className="text-sm font-medium">{activeCard.title}</p>
              </div>
            )}
            {activeColumn && (
              <div className="w-[280px] rounded-xl bg-muted/60 p-3 shadow-2xl opacity-90 ring-1 ring-primary/20">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  {activeColumn.name}
                </div>
                <div className="text-xs text-muted-foreground/60">
                  {activeColumn.cards.length} cards
                </div>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </main>

      {/* Add card input overlay */}
      {showAddCard && (
        <div
          className="fixed inset-0 z-20"
          onClick={() => {
            setShowAddCard(null);
            setNewCardTitle("");
          }}
        />
      )}
      {showAddCard && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 w-[360px] rounded-xl bg-card border border-border shadow-2xl p-4">
          <input
            value={newCardTitle}
            onChange={(e) => setNewCardTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmitCard(showAddCard);
              if (e.key === "Escape") {
                setShowAddCard(null);
                setNewCardTitle("");
              }
            }}
            placeholder="What needs to be done?"
            className="w-full px-3 py-2.5 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
            autoFocus
          />
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => handleSubmitCard(showAddCard)}
              className="px-4 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Add Card
            </button>
            <button
              onClick={() => {
                setShowAddCard(null);
                setNewCardTitle("");
              }}
              className="px-4 py-1.5 text-sm rounded-lg hover:bg-muted text-muted-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Card detail modal */}
      {selectedCard && boardId && (
        <CardDetail
          boardId={boardId}
          card={selectedCard}
          labels={labels}
          onClose={() => setSelectedCard(null)}
          onUpdate={(data) => handleCardUpdate(selectedCard.id, data)}
          onDelete={() => handleCardDelete(selectedCard.id)}
        />
      )}
    </div>
  );
}

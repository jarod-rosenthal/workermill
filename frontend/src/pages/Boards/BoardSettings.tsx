import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Trash2,
  Plus,
  GripVertical,
  Save,
  Settings,
} from "lucide-react";
import { useBoardsStore } from "../../store/boards-store";
import type { Column } from "../../lib/boards-api";

const COLUMN_COLORS = [
  null,
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

export default function BoardSettings() {
  const { boardId } = useParams<{ boardId: string }>();
  const navigate = useNavigate();
  const {
    currentBoard,
    isLoading,
    fetchBoardDetail,
    updateBoard,
    addColumn,
    updateColumn,
    deleteColumn,
    deleteBoard,
    clearCurrentBoard,
  } = useBoardsStore();

  const [boardName, setBoardName] = useState("");
  const [boardDescription, setBoardDescription] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingColumn, setEditingColumn] = useState<string | null>(null);
  const [editColumnData, setEditColumnData] = useState<{
    name: string;
    wipLimit: string;
    color: string | null;
  }>({ name: "", wipLimit: "", color: null });

  useEffect(() => {
    if (boardId) {
      fetchBoardDetail(boardId);
    }
    return () => clearCurrentBoard();
  }, [boardId, fetchBoardDetail, clearCurrentBoard]);

  useEffect(() => {
    if (currentBoard) {
      setBoardName(currentBoard.name);
      setBoardDescription(currentBoard.description ?? "");
    }
  }, [currentBoard]);

  const handleSaveBoard = async () => {
    if (!boardId) return;
    setSaving(true);
    try {
      await updateBoard(boardId, {
        name: boardName.trim(),
        description: boardDescription.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAddColumn = async () => {
    const trimmed = newColumnName.trim();
    if (!trimmed || !boardId) return;
    await addColumn(boardId, { name: trimmed });
    setNewColumnName("");
  };

  const handleStartEditColumn = (col: Column) => {
    setEditingColumn(col.id);
    setEditColumnData({
      name: col.name,
      wipLimit: col.wipLimit?.toString() ?? "",
      color: col.color,
    });
  };

  const handleSaveColumn = async (colId: string) => {
    if (!boardId) return;
    const wipNum = parseInt(editColumnData.wipLimit, 10);
    await updateColumn(boardId, colId, {
      name: editColumnData.name.trim() || undefined,
      wipLimit:
        editColumnData.wipLimit === "" || isNaN(wipNum) ? null : wipNum,
      color: editColumnData.color,
    });
    setEditingColumn(null);
  };

  const handleDeleteColumn = async (colId: string) => {
    if (!boardId) return;
    await deleteColumn(boardId, colId);
  };

  const handleDeleteBoard = async () => {
    if (!boardId) return;
    await deleteBoard(boardId);
    navigate("/boards");
  };

  if (!currentBoard && isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!currentBoard) return null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/30 glass-strong sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to={`/boards/${boardId}`}
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="text-sm">Back to Board</span>
            </Link>
            <div className="h-6 w-px bg-border" />
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Board Settings
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-10">
        {/* Board Details */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Board Details</h2>
          <div className="space-y-4 max-w-lg">
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                type="text"
                value={boardName}
                onChange={(e) => setBoardName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Description
              </label>
              <textarea
                value={boardDescription}
                onChange={(e) => setBoardDescription(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              />
            </div>
            <button
              onClick={handleSaveBoard}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </section>

        {/* Columns Management */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Columns</h2>
          <div className="space-y-2 mb-4">
            {currentBoard.columns.map((col) => (
              <div
                key={col.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card"
              >
                <GripVertical className="w-4 h-4 text-muted-foreground/50" />

                {/* Color indicator */}
                <div
                  className="w-4 h-4 rounded-full border border-border flex-shrink-0"
                  style={{
                    backgroundColor: col.color ?? "transparent",
                  }}
                />

                {editingColumn === col.id ? (
                  <>
                    <input
                      value={editColumnData.name}
                      onChange={(e) =>
                        setEditColumnData({
                          ...editColumnData,
                          name: e.target.value,
                        })
                      }
                      className="flex-1 px-2 py-1 text-sm rounded border border-border bg-background focus:outline-none"
                      autoFocus
                    />
                    <input
                      value={editColumnData.wipLimit}
                      onChange={(e) =>
                        setEditColumnData({
                          ...editColumnData,
                          wipLimit: e.target.value,
                        })
                      }
                      placeholder="WIP"
                      type="number"
                      min={0}
                      className="w-16 px-2 py-1 text-sm rounded border border-border bg-background focus:outline-none"
                    />
                    <div className="flex gap-1">
                      {COLUMN_COLORS.map((c) => (
                        <button
                          key={c ?? "none"}
                          onClick={() =>
                            setEditColumnData({
                              ...editColumnData,
                              color: c,
                            })
                          }
                          className={`w-5 h-5 rounded-full border ${
                            editColumnData.color === c
                              ? "border-foreground"
                              : "border-transparent"
                          }`}
                          style={{
                            backgroundColor: c ?? undefined,
                          }}
                        >
                          {!c && (
                            <span className="block w-full h-full rounded-full border border-border" />
                          )}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => handleSaveColumn(col.id)}
                      className="px-2 py-1 text-xs rounded bg-primary text-primary-foreground"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingColumn(null)}
                      className="px-2 py-1 text-xs rounded hover:bg-muted"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm font-medium">
                      {col.name}
                    </span>
                    {col.wipLimit && (
                      <span className="text-xs text-muted-foreground px-2 py-0.5 rounded bg-muted">
                        WIP: {col.wipLimit}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {col.cards?.length ?? 0} cards
                    </span>
                    <button
                      onClick={() => handleStartEditColumn(col)}
                      className="px-2 py-1 text-xs rounded hover:bg-muted text-muted-foreground"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteColumn(col.id)}
                      className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Add column */}
          <div className="flex items-center gap-2">
            <input
              value={newColumnName}
              onChange={(e) => setNewColumnName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddColumn();
              }}
              placeholder="New column name..."
              className="flex-1 max-w-xs px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <button
              onClick={handleAddColumn}
              disabled={!newColumnName.trim()}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              Add Column
            </button>
          </div>
        </section>

        {/* Danger Zone */}
        <section>
          <h2 className="text-lg font-semibold mb-4 text-red-500">
            Danger Zone
          </h2>
          <div className="p-4 rounded-lg border border-red-500/30 bg-red-500/5">
            {showDeleteConfirm ? (
              <div>
                <p className="text-sm text-red-500 mb-3">
                  This will permanently delete the board, all columns, cards,
                  and comments. This action cannot be undone.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={handleDeleteBoard}
                    className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600"
                  >
                    Confirm Delete
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium">Delete this board</h3>
                  <p className="text-sm text-muted-foreground">
                    Once deleted, there is no going back.
                  </p>
                </div>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg text-red-500 border border-red-500/30 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Board
                </button>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

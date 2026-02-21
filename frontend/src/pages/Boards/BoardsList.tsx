import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Plus,
  Star,
  MoreHorizontal,
  Trash2,
  Clock,
  Columns3,
  RefreshCw,
  ArrowLeft,
  LayoutGrid,
  CreditCard,
} from "lucide-react";
import { useBoardsStore } from "../../store/boards-store";
import CreateBoardDialog from "./CreateBoardDialog";

export default function BoardsList() {
  const navigate = useNavigate();
  const {
    boards,
    isLoading,
    error,
    fetchBoards,
    createBoard,
    deleteBoard,
    starBoard,
  } = useBoardsStore();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(
    null,
  );
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  useEffect(() => {
    fetchBoards();
  }, [fetchBoards]);

  const handleCreate = async (data: Parameters<typeof createBoard>[0]) => {
    const board = await createBoard(data);
    navigate(`/boards/${board.id}`);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteBoard(id);
      setShowDeleteConfirm(null);
    } catch {
      // handled by store
    }
  };

  const handleStar = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await starBoard(id);
    } catch {
      // handled by store
    }
  };

  const starred = boards.filter((b) => b.isStarred);
  const unstarred = boards.filter((b) => !b.isStarred);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/30 glass-strong sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/dashboard"
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="text-sm">Back to Dashboard</span>
            </Link>
            <div className="h-6 w-px bg-border" />
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <LayoutGrid className="h-5 w-5" />
              Boards
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => fetchBoards()}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
              title="Refresh"
            >
              <RefreshCw
                className={`w-5 h-5 text-muted-foreground ${isLoading ? "animate-spin" : ""}`}
              />
            </button>
            <button
              onClick={() => setShowCreateDialog(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              data-testid="create-board-btn"
            >
              <Plus className="w-4 h-4" />
              New Board
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500">
            {error}
          </div>
        )}

        {isLoading && boards.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : boards.length === 0 ? (
          <div className="text-center py-20" data-testid="empty-state">
            <LayoutGrid className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">No boards yet</h2>
            <p className="text-muted-foreground mb-6">
              Create your first board to start organizing tasks
            </p>
            <button
              onClick={() => setShowCreateDialog(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create Board
            </button>
          </div>
        ) : (
          <>
            {/* Starred boards */}
            {starred.length > 0 && (
              <section className="mb-10">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
                  Starred
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {starred.map((board) => (
                    <BoardCard
                      key={board.id}
                      board={board}
                      onStar={handleStar}
                      onMenuOpen={(id) =>
                        setOpenMenuId(openMenuId === id ? null : id)
                      }
                      isMenuOpen={openMenuId === board.id}
                      onDelete={(id) => {
                        setShowDeleteConfirm(id);
                        setOpenMenuId(null);
                      }}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* All boards */}
            <section>
              <h2 className="text-lg font-semibold mb-4">
                {starred.length > 0
                  ? `All Boards (${unstarred.length})`
                  : `All Boards (${boards.length})`}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {(starred.length > 0 ? unstarred : boards).map((board) => (
                  <BoardCard
                    key={board.id}
                    board={board}
                    onStar={handleStar}
                    onMenuOpen={(id) =>
                      setOpenMenuId(openMenuId === id ? null : id)
                    }
                    isMenuOpen={openMenuId === board.id}
                    onDelete={(id) => {
                      setShowDeleteConfirm(id);
                      setOpenMenuId(null);
                    }}
                  />
                ))}
              </div>
            </section>
          </>
        )}
      </main>

      {/* Create dialog */}
      <CreateBoardDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreate={handleCreate}
      />

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-xl border border-border w-full max-w-md p-6 mx-4">
            <h2 className="text-xl font-semibold mb-2">Delete Board</h2>
            <p className="text-muted-foreground mb-6">
              Are you sure you want to delete this board? All columns, cards,
              and comments will be permanently removed.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(showDeleteConfirm)}
                className="px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                Delete Board
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Click away to close menus */}
      {openMenuId && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setOpenMenuId(null)}
        />
      )}
    </div>
  );
}

// ── Board Card Component ───────────────────────────────────────────────────

// Stable accent color from board name
const ACCENT_COLORS = [
  "***REMOVED***3b82f6",
  "***REMOVED***8b5cf6",
  "***REMOVED***06b6d4",
  "***REMOVED***10b981",
  "***REMOVED***f59e0b",
  "***REMOVED***ef4444",
  "***REMOVED***ec4899",
  "***REMOVED***6366f1",
];

function getBoardAccent(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return ACCENT_COLORS[Math.abs(hash) % ACCENT_COLORS.length];
}

interface BoardCardProps {
  board: {
    id: string;
    name: string;
    description: string | null;
    isStarred: boolean;
    columnCount: number;
    cardCount: number;
    updatedAt: string;
  };
  onStar: (id: string, e: React.MouseEvent) => void;
  onMenuOpen: (id: string) => void;
  isMenuOpen: boolean;
  onDelete: (id: string) => void;
}

function BoardCard({
  board,
  onStar,
  onMenuOpen,
  isMenuOpen,
  onDelete,
}: BoardCardProps) {
  const accent = getBoardAccent(board.name);

  return (
    <div className="relative group rounded-xl border border-border/60 bg-card hover:border-primary/40 hover:shadow-[0_4px_16px_rgba(0,0,0,0.15)] transition-all duration-200" data-testid="board-card">
      <Link to={`/boards/${board.id}`} className="block p-4 pr-20">
        <div className="flex items-start gap-3 mb-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: accent + "18" }}
          >
            <Columns3 className="w-4.5 h-4.5" style={{ color: accent }} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-[15px] truncate leading-tight">{board.name}</h3>
            {board.description && (
              <p className="text-xs text-muted-foreground/70 line-clamp-1 mt-0.5">
                {board.description}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70">
          <span className="flex items-center gap-1">
            <Columns3 className="w-3 h-3" />
            {board.columnCount}
          </span>
          <span className="flex items-center gap-1">
            <CreditCard className="w-3 h-3" />
            {board.cardCount}
          </span>
          <span className="flex items-center gap-1 ml-auto">
            <Clock className="w-3 h-3" />
            {new Date(board.updatedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </span>
        </div>
      </Link>

      {/* Action buttons overlay */}
      <div className="absolute top-5 right-3 flex items-center gap-0.5">
        <button
          onClick={(e) => onStar(board.id, e)}
          className="p-1 rounded-md hover:bg-muted transition-colors"
          title={board.isStarred ? "Unstar" : "Star"}
        >
          <Star
            className={`w-3.5 h-3.5 ${
              board.isStarred
                ? "text-yellow-500 fill-yellow-500"
                : "text-muted-foreground/40 group-hover:text-muted-foreground"
            }`}
          />
        </button>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onMenuOpen(board.id);
          }}
          className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground/40 group-hover:text-muted-foreground"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>

        {isMenuOpen && (
          <div className="absolute right-0 top-full mt-1 w-40 rounded-lg border border-border bg-card shadow-xl py-1 z-50">
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete(board.id);
              }}
              className="flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-500/10 transition-colors w-full text-left"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

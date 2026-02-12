import { useState, useEffect, useCallback } from "react";
import {
  X,
  Calendar,
  Tag,
  CheckSquare,
  MessageSquare,
  Trash2,
  Plus,
  AlertCircle,
  ArrowUp,
  ArrowDown,
  Minus,
  User,
  Palette,
  Send,
  Play,
  Zap,
} from "lucide-react";
import type {
  Card,
  Label,
  Comment,
  ChecklistItem,
} from "../../lib/boards-api";
import * as boardsApi from "../../lib/boards-api";

interface CardDetailProps {
  boardId: string;
  card: Card;
  labels: Label[];
  onClose: () => void;
  onUpdate: (data: Record<string, unknown>) => Promise<void>;
  onDelete: () => Promise<void>;
}

const PRIORITIES: {
  value: Card["priority"];
  label: string;
  icon: React.ReactNode;
  color: string;
}[] = [
  {
    value: "urgent",
    label: "Urgent",
    icon: <AlertCircle className="w-4 h-4" />,
    color: "text-red-500",
  },
  {
    value: "high",
    label: "High",
    icon: <ArrowUp className="w-4 h-4" />,
    color: "text-orange-500",
  },
  {
    value: "medium",
    label: "Medium",
    icon: <Minus className="w-4 h-4" />,
    color: "text-yellow-500",
  },
  {
    value: "low",
    label: "Low",
    icon: <ArrowDown className="w-4 h-4" />,
    color: "text-blue-500",
  },
  { value: null, label: "None", icon: null, color: "text-muted-foreground" },
];

const COVER_COLORS = [
  null,
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#6b7280",
];

function getWorkerStatusStyle(status: string | null): string {
  switch (status) {
    case "executing":
    case "claimed":
    case "environment_setup":
    case "queued":
      return "bg-cyan-500/15 text-cyan-400";
    case "pr_created":
    case "review_requested":
      return "bg-purple-500/15 text-purple-400";
    case "completed":
    case "deployed":
      return "bg-green-500/15 text-green-400";
    case "failed":
    case "cancelled":
      return "bg-red-500/15 text-red-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function formatWorkerStatus(status: string | null): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "claimed":
    case "environment_setup":
      return "Starting";
    case "executing":
      return "Executing";
    case "pr_created":
      return "PR Created";
    case "review_requested":
      return "Review Requested";
    case "completed":
      return "Completed";
    case "deployed":
      return "Deployed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "planning":
      return "Planning";
    default:
      return status || "Unknown";
  }
}

export default function CardDetail({
  boardId,
  card,
  labels: orgLabels,
  onClose,
  onUpdate,
  onDelete,
}: CardDetailProps) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description ?? "");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [showPriorityPicker, setShowPriorityPicker] = useState(false);
  const [showLabelPicker, setShowLabelPicker] = useState(false);
  const [showCoverPicker, setShowCoverPicker] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Comments
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [loadingComments, setLoadingComments] = useState(true);

  // Checklist
  const [checklist, setChecklist] = useState<ChecklistItem[]>(
    card.checklistItems ?? [],
  );
  const [newChecklistItem, setNewChecklistItem] = useState("");
  const [showAddChecklist, setShowAddChecklist] = useState(false);

  // AI Worker
  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [workerTaskId, setWorkerTaskId] = useState(card.workerTaskId);

  // Fetch comments on mount
  const fetchComments = useCallback(async () => {
    try {
      const data = await boardsApi.getComments(boardId, card.id);
      setComments(data);
    } catch {
      // Ignore errors
    } finally {
      setLoadingComments(false);
    }
  }, [boardId, card.id]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // Close on Escape
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const handleTitleSave = async () => {
    setIsEditingTitle(false);
    const trimmed = title.trim();
    if (trimmed && trimmed !== card.title) {
      await onUpdate({ title: trimmed });
    } else {
      setTitle(card.title);
    }
  };

  const handleDescriptionSave = async () => {
    setIsEditingDescription(false);
    if (description !== (card.description ?? "")) {
      await onUpdate({ description: description || null });
    }
  };

  const handlePriorityChange = async (priority: Card["priority"]) => {
    setShowPriorityPicker(false);
    await onUpdate({ priority });
  };

  const handleDueDateChange = async (dateStr: string) => {
    await onUpdate({ dueDate: dateStr || null });
  };

  const handleCoverColorChange = async (color: string | null) => {
    setShowCoverPicker(false);
    await onUpdate({ coverColor: color });
  };

  const handleToggleLabel = async (labelId: string) => {
    const hasLabel = card.labels?.some((l) => l.id === labelId);
    try {
      if (hasLabel) {
        await boardsApi.removeCardLabel(boardId, card.id, labelId);
      } else {
        await boardsApi.addCardLabel(boardId, card.id, labelId);
      }
      // Refresh parent to get updated card
      await onUpdate({});
    } catch {
      // Ignore
    }
  };

  const handleAddComment = async () => {
    const trimmed = newComment.trim();
    if (!trimmed) return;
    try {
      const comment = await boardsApi.addComment(boardId, card.id, trimmed);
      setComments((prev) => [...prev, comment]);
      setNewComment("");
    } catch {
      // Ignore
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    try {
      await boardsApi.deleteComment(boardId, card.id, commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch {
      // Ignore
    }
  };

  const handleAddChecklistItem = async () => {
    const trimmed = newChecklistItem.trim();
    if (!trimmed) return;
    try {
      const item = await boardsApi.addChecklistItem(boardId, card.id, {
        title: trimmed,
      });
      setChecklist((prev) => [...prev, item]);
      setNewChecklistItem("");
    } catch {
      // Ignore
    }
  };

  const handleToggleChecklistItem = async (item: ChecklistItem) => {
    const updated = { ...item, isCompleted: !item.isCompleted };
    setChecklist((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
    try {
      await boardsApi.updateChecklistItem(boardId, card.id, item.id, {
        isCompleted: !item.isCompleted,
      });
    } catch {
      // Revert
      setChecklist((prev) =>
        prev.map((i) => (i.id === item.id ? item : i)),
      );
    }
  };

  const handleDeleteChecklistItem = async (itemId: string) => {
    try {
      await boardsApi.deleteChecklistItem(boardId, card.id, itemId);
      setChecklist((prev) => prev.filter((i) => i.id !== itemId));
    } catch {
      // Ignore
    }
  };

  const handleRunWithAI = async () => {
    setRunLoading(true);
    setRunError(null);
    try {
      const result = await boardsApi.runCard(boardId, card.id);
      setWorkerTaskId(result.workerTask.id);
      await onUpdate({});
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to start AI worker";
      setRunError(msg);
    } finally {
      setRunLoading(false);
    }
  };

  const currentPriority = PRIORITIES.find((p) => p.value === card.priority);
  const checklistDone = checklist.filter((i) => i.isCompleted).length;
  const checklistTotal = checklist.length;
  const checklistProgress =
    checklistTotal > 0 ? (checklistDone / checklistTotal) * 100 : 0;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-card rounded-xl border border-border w-full max-w-2xl mx-4 my-auto">
        {/* Cover color */}
        {card.coverColor && (
          <div
            className="h-8 rounded-t-xl"
            style={{ backgroundColor: card.coverColor }}
          />
        )}

        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 mb-6">
            <div className="flex-1">
              {isEditingTitle ? (
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={handleTitleSave}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleTitleSave();
                    if (e.key === "Escape") {
                      setTitle(card.title);
                      setIsEditingTitle(false);
                    }
                  }}
                  className="w-full text-xl font-semibold bg-background border border-primary rounded px-2 py-1 focus:outline-none"
                  autoFocus
                />
              ) : (
                <h2
                  className="text-xl font-semibold cursor-pointer hover:text-primary/80 transition-colors"
                  onClick={() => setIsEditingTitle(true)}
                  title="Click to edit"
                >
                  {card.title}
                </h2>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors flex-shrink-0"
            >
              <X className="w-5 h-5 text-muted-foreground" />
            </button>
          </div>

          <div className="grid grid-cols-[1fr,200px] gap-6">
            {/* Main content */}
            <div className="space-y-6">
              {/* Description */}
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">
                  Description
                </h3>
                {isEditingDescription ? (
                  <div>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={12}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y text-sm"
                      placeholder="Add a description..."
                      autoFocus
                    />
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={handleDescriptionSave}
                        className="px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {
                          setDescription(card.description ?? "");
                          setIsEditingDescription(false);
                        }}
                        className="px-3 py-1.5 text-sm rounded-lg hover:bg-muted"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="text-sm text-muted-foreground cursor-pointer hover:bg-muted/50 rounded-lg p-2 min-h-[60px] transition-colors"
                    onClick={() => setIsEditingDescription(true)}
                  >
                    {card.description || "Click to add a description..."}
                  </div>
                )}
              </div>

              {/* Labels on card */}
              {card.labels && card.labels.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">
                    Labels
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {card.labels.map((label) => (
                      <span
                        key={label.id}
                        className="text-xs font-medium px-2 py-1 rounded"
                        style={{
                          backgroundColor: label.color + "30",
                          color: label.color,
                        }}
                      >
                        {label.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Checklist */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                    <CheckSquare className="w-4 h-4" />
                    Checklist
                    {checklistTotal > 0 && (
                      <span className="text-xs">
                        ({checklistDone}/{checklistTotal})
                      </span>
                    )}
                  </h3>
                  <button
                    onClick={() => setShowAddChecklist(!showAddChecklist)}
                    className="text-xs text-primary hover:text-primary/80"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                {checklistTotal > 0 && (
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-3">
                    <div
                      className={`h-full rounded-full transition-all ${
                        checklistDone === checklistTotal
                          ? "bg-green-500"
                          : "bg-primary"
                      }`}
                      style={{ width: `${checklistProgress}%` }}
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  {checklist.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 group"
                    >
                      <input
                        type="checkbox"
                        checked={item.isCompleted}
                        onChange={() => handleToggleChecklistItem(item)}
                        className="rounded accent-primary"
                      />
                      <span
                        className={`text-sm flex-1 ${
                          item.isCompleted
                            ? "line-through text-muted-foreground"
                            : ""
                        }`}
                      >
                        {item.title}
                      </span>
                      <button
                        onClick={() => handleDeleteChecklistItem(item.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-all"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>

                {showAddChecklist && (
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      value={newChecklistItem}
                      onChange={(e) => setNewChecklistItem(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddChecklistItem();
                      }}
                      placeholder="Add an item..."
                      className="flex-1 px-2 py-1.5 text-sm rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
                      autoFocus
                    />
                    <button
                      onClick={handleAddChecklistItem}
                      className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>

              {/* Comments */}
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
                  <MessageSquare className="w-4 h-4" />
                  Comments
                </h3>

                {/* Add comment */}
                <div className="flex gap-2 mb-4">
                  <textarea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        handleAddComment();
                      }
                    }}
                    placeholder="Write a comment..."
                    rows={2}
                    className="flex-1 px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
                  />
                  <button
                    onClick={handleAddComment}
                    disabled={!newComment.trim()}
                    className="self-end p-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>

                {/* Comment list */}
                {loadingComments ? (
                  <div className="text-sm text-muted-foreground">
                    Loading comments...
                  </div>
                ) : comments.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    No comments yet
                  </div>
                ) : (
                  <div className="space-y-3">
                    {comments.map((comment) => (
                      <div
                        key={comment.id}
                        className="group rounded-lg bg-muted/50 p-3"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                              <User className="w-3 h-3 text-primary" />
                            </div>
                            <span className="text-sm font-medium">
                              {comment.authorName}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {new Date(comment.createdAt).toLocaleDateString(
                                "en-US",
                                {
                                  month: "short",
                                  day: "numeric",
                                  hour: "numeric",
                                  minute: "2-digit",
                                },
                              )}
                            </span>
                          </div>
                          <button
                            onClick={() => handleDeleteComment(comment.id)}
                            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-all"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                        <p className="text-sm whitespace-pre-wrap pl-8">
                          {comment.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-3">
              {/* Priority */}
              <div className="relative">
                <button
                  onClick={() => setShowPriorityPicker(!showPriorityPicker)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-muted transition-colors text-sm"
                >
                  {currentPriority?.icon && (
                    <span className={currentPriority.color}>
                      {currentPriority.icon}
                    </span>
                  )}
                  <span>
                    {currentPriority?.label ?? "Priority"}
                  </span>
                </button>
                {showPriorityPicker && (
                  <div className="absolute right-0 top-full mt-1 w-44 rounded-lg border border-border bg-card shadow-xl py-1 z-10">
                    {PRIORITIES.map((p) => (
                      <button
                        key={p.value ?? "none"}
                        onClick={() => handlePriorityChange(p.value)}
                        className={`flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors w-full text-left ${
                          card.priority === p.value ? "bg-muted" : ""
                        }`}
                      >
                        {p.icon && (
                          <span className={p.color}>{p.icon}</span>
                        )}
                        <span>{p.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Due date */}
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  <Calendar className="w-3.5 h-3.5 inline mr-1" />
                  Due Date
                </label>
                <input
                  type="date"
                  value={card.dueDate?.split("T")[0] ?? ""}
                  onChange={(e) => handleDueDateChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>

              {/* Labels */}
              <div className="relative">
                <button
                  onClick={() => setShowLabelPicker(!showLabelPicker)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-muted transition-colors text-sm"
                >
                  <Tag className="w-4 h-4" />
                  Labels
                </button>
                {showLabelPicker && (
                  <div className="absolute right-0 top-full mt-1 w-52 rounded-lg border border-border bg-card shadow-xl py-1 z-10 max-h-60 overflow-y-auto">
                    {orgLabels.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        No labels created yet
                      </div>
                    ) : (
                      orgLabels.map((label) => {
                        const isSelected = card.labels?.some(
                          (l) => l.id === label.id,
                        );
                        return (
                          <button
                            key={label.id}
                            onClick={() => handleToggleLabel(label.id)}
                            className={`flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors w-full text-left ${
                              isSelected ? "bg-muted" : ""
                            }`}
                          >
                            <span
                              className="w-3 h-3 rounded-full flex-shrink-0"
                              style={{ backgroundColor: label.color }}
                            />
                            <span className="flex-1 truncate">
                              {label.name}
                            </span>
                            {isSelected && (
                              <span className="text-primary text-xs">
                                &#10003;
                              </span>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>

              {/* Cover color */}
              <div className="relative">
                <button
                  onClick={() => setShowCoverPicker(!showCoverPicker)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-muted transition-colors text-sm"
                >
                  <Palette className="w-4 h-4" />
                  Cover Color
                </button>
                {showCoverPicker && (
                  <div className="absolute right-0 top-full mt-1 w-52 rounded-lg border border-border bg-card shadow-xl p-3 z-10">
                    <div className="flex flex-wrap gap-2">
                      {COVER_COLORS.map((color) => (
                        <button
                          key={color ?? "none"}
                          onClick={() => handleCoverColorChange(color)}
                          className={`w-8 h-8 rounded-lg border-2 transition-transform hover:scale-110 ${
                            color === card.coverColor
                              ? "border-foreground"
                              : "border-transparent"
                          }`}
                          style={{
                            backgroundColor: color ?? undefined,
                          }}
                        >
                          {!color && (
                            <span className="block w-full h-full rounded-md border border-border bg-muted text-[10px] flex items-center justify-center text-muted-foreground">
                              --
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Assignee */}
              {card.assigneeName && (
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">
                    <User className="w-3.5 h-3.5 inline mr-1" />
                    Assignee
                  </label>
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm">
                    <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                      <User className="w-3 h-3 text-primary" />
                    </div>
                    {card.assigneeName}
                  </div>
                </div>
              )}

              {/* AI Worker */}
              <div className="relative">
                {workerTaskId || card.workerTaskId ? (
                  <div className="px-3 py-2 rounded-lg border border-border text-sm">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                      <Zap className="w-3.5 h-3.5" />
                      AI Worker
                    </div>
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded ${getWorkerStatusStyle(card.workerStatus)}`}
                    >
                      {formatWorkerStatus(card.workerStatus)}
                    </span>
                  </div>
                ) : (
                  <button
                    onClick={handleRunWithAI}
                    disabled={runLoading}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-muted transition-colors text-sm"
                  >
                    <Play className="w-4 h-4" />
                    {runLoading ? "Starting..." : "Run with AI"}
                  </button>
                )}
                {runError && (
                  <p className="text-xs text-red-500 mt-1">{runError}</p>
                )}
              </div>

              {/* Delete */}
              <div className="pt-4 border-t border-border">
                {showDeleteConfirm ? (
                  <div className="space-y-2">
                    <p className="text-xs text-red-500">
                      Delete this card permanently?
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          await onDelete();
                          onClose();
                        }}
                        className="flex-1 px-3 py-1.5 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setShowDeleteConfirm(false)}
                        className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-muted"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors text-sm"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete Card
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

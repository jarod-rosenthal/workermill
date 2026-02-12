import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Calendar,
  CheckSquare,
  MessageSquare,
  AlertCircle,
  ArrowUp,
  ArrowDown,
  Minus,
} from "lucide-react";
import type { Card } from "../../lib/boards-api";

interface CardItemProps {
  card: Card;
  onClick: () => void;
}

const PRIORITY_CONFIG: Record<
  string,
  { icon: React.ReactNode; color: string; label: string }
> = {
  urgent: {
    icon: <AlertCircle className="w-3 h-3" />,
    color: "text-red-500",
    label: "Urgent",
  },
  high: {
    icon: <ArrowUp className="w-3 h-3" />,
    color: "text-orange-500",
    label: "High",
  },
  medium: {
    icon: <Minus className="w-3 h-3" />,
    color: "text-yellow-500",
    label: "Medium",
  },
  low: {
    icon: <ArrowDown className="w-3 h-3" />,
    color: "text-blue-500",
    label: "Low",
  },
};

function getCardWorkerStatusStyle(status: string | null): string {
  switch (status) {
    case "executing":
    case "claimed":
    case "environment_setup":
    case "queued":
    case "planning":
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

function getCardWorkerDotStyle(status: string | null): string {
  switch (status) {
    case "executing":
    case "claimed":
    case "environment_setup":
    case "queued":
    case "planning":
      return "bg-cyan-400 animate-pulse";
    case "pr_created":
    case "review_requested":
      return "bg-purple-400";
    case "completed":
    case "deployed":
      return "bg-green-400";
    case "failed":
    case "cancelled":
      return "bg-red-400";
    default:
      return "bg-muted-foreground";
  }
}

function getCardWorkerStatusLabel(status: string | null): string {
  switch (status) {
    case "queued":
    case "planning":
      return "AI";
    case "executing":
    case "claimed":
    case "environment_setup":
      return "AI Running";
    case "pr_created":
    case "review_requested":
      return "PR";
    case "completed":
    case "deployed":
      return "Done";
    case "failed":
    case "cancelled":
      return "Failed";
    default:
      return "AI";
  }
}

function isOverdue(dateStr: string): boolean {
  return new Date(dateStr) < new Date();
}

function formatDueDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.ceil(
    (date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays === 0) return "Due today";
  if (diffDays === 1) return "Due tomorrow";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function CardItem({ card, onClick }: CardItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id, data: { type: "card", card } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const priority = card.priority ? PRIORITY_CONFIG[card.priority] : null;
  const checklistTotal = card.checklistItems?.length ?? 0;
  const checklistDone =
    card.checklistItems?.filter((item) => item.isCompleted).length ?? 0;
  const checklistProgress =
    checklistTotal > 0 ? (checklistDone / checklistTotal) * 100 : 0;
  const overdue = card.dueDate ? isOverdue(card.dueDate) : false;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={`group rounded-lg border bg-card p-3 cursor-pointer transition-all hover:border-primary/50 hover:shadow-md ${
        isDragging
          ? "opacity-50 shadow-lg border-primary/50 rotate-2"
          : "border-border"
      }`}
    >
      {/* Cover color */}
      {card.coverColor && (
        <div
          className="h-2 rounded-t -mx-3 -mt-3 mb-2"
          style={{ backgroundColor: card.coverColor }}
        />
      )}

      {/* Labels */}
      {card.labels && card.labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {card.labels.map((label) => (
            <span
              key={label.id}
              className="text-[10px] font-medium px-1.5 py-0.5 rounded"
              style={{
                backgroundColor: label.color + "30",
                color: label.color,
              }}
            >
              {label.name}
            </span>
          ))}
        </div>
      )}

      {/* Title */}
      <p className="text-sm font-medium leading-snug mb-2">{card.title}</p>

      {/* Metadata row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Priority */}
        {priority && (
          <span
            className={`flex items-center gap-0.5 text-[10px] font-medium ${priority.color}`}
            title={priority.label}
          >
            {priority.icon}
          </span>
        )}

        {/* Due date */}
        {card.dueDate && (
          <span
            className={`flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${
              overdue
                ? "bg-red-500/15 text-red-400"
                : "bg-muted text-muted-foreground"
            }`}
          >
            <Calendar className="w-3 h-3" />
            {formatDueDate(card.dueDate)}
          </span>
        )}

        {/* Checklist progress */}
        {checklistTotal > 0 && (
          <span
            className={`flex items-center gap-1 text-[10px] font-medium ${
              checklistDone === checklistTotal
                ? "text-green-500"
                : "text-muted-foreground"
            }`}
          >
            <CheckSquare className="w-3 h-3" />
            {checklistDone}/{checklistTotal}
          </span>
        )}

        {/* Comment count */}
        {card.commentCount > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <MessageSquare className="w-3 h-3" />
            {card.commentCount}
          </span>
        )}

        {/* Worker status indicator */}
        {card.workerTaskId && (
          <span
            className={`flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${getCardWorkerStatusStyle(card.workerStatus)}`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${getCardWorkerDotStyle(card.workerStatus)}`}
            />
            {getCardWorkerStatusLabel(card.workerStatus)}
          </span>
        )}
      </div>

      {/* Checklist progress bar */}
      {checklistTotal > 0 && (
        <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
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
    </div>
  );
}

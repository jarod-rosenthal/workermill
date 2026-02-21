import { useState, useRef, useEffect } from "react";
import {
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Gauge,
  Palette,
  GripVertical,
} from "lucide-react";
import type { Column } from "../../lib/boards-api";

interface ColumnHeaderProps {
  column: Column;
  cardCount: number;
  onAddCard: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onSetWipLimit: (limit: number | null) => void;
  onChangeColor: (color: string | null) => void;
  dragHandleProps?: Record<string, unknown>;
}

const COLUMN_COLORS = [
  null,
  "***REMOVED***ef4444",
  "***REMOVED***f97316",
  "***REMOVED***eab308",
  "***REMOVED***22c55e",
  "***REMOVED***06b6d4",
  "***REMOVED***3b82f6",
  "***REMOVED***8b5cf6",
  "***REMOVED***ec4899",
];

export default function ColumnHeader({
  column,
  cardCount,
  onAddCard,
  onRename,
  onDelete,
  onSetWipLimit,
  onChangeColor,
  dragHandleProps,
}: ColumnHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(column.name);
  const [showMenu, setShowMenu] = useState(false);
  const [showWipInput, setShowWipInput] = useState(false);
  const [wipValue, setWipValue] = useState(
    column.wipLimit?.toString() ?? "",
  );
  const [showColorPicker, setShowColorPicker] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isOverWip =
    column.wipLimit !== null &&
    column.wipLimit !== undefined &&
    cardCount > column.wipLimit;

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
        setShowWipInput(false);
        setShowColorPicker(false);
      }
    };
    if (showMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMenu]);

  const handleRenameSubmit = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== column.name) {
      onRename(trimmed);
    }
    setIsEditing(false);
  };

  const handleWipSubmit = () => {
    const num = parseInt(wipValue, 10);
    if (wipValue === "" || wipValue === "0") {
      onSetWipLimit(null);
    } else if (!isNaN(num) && num > 0) {
      onSetWipLimit(num);
    }
    setShowWipInput(false);
    setShowMenu(false);
  };

  return (
    <div className="mb-3 pb-2.5 border-b border-border/30">
      {/* Color stripe */}
      {column.color && (
        <div
          className="h-1.5 rounded-full -mx-1 mb-3"
          style={{ backgroundColor: column.color }}
        />
      )}

      <div className="flex items-center gap-1.5 group/header">
        {/* Drag handle */}
        <div
          className="cursor-grab active:cursor-grabbing text-muted-foreground/30 opacity-0 group-hover/header:opacity-100 hover:text-muted-foreground transition-all -ml-1"
          {...dragHandleProps}
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>

        {/* Column name */}
        {isEditing ? (
          <input
            ref={inputRef}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameSubmit();
              if (e.key === "Escape") {
                setEditName(column.name);
                setIsEditing(false);
              }
            }}
            className="flex-1 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider rounded border border-primary bg-background focus:outline-none"
          />
        ) : (
          <span
            className="flex-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate cursor-pointer hover:text-foreground transition-colors"
            onDoubleClick={() => {
              setEditName(column.name);
              setIsEditing(true);
            }}
            title="Double-click to rename"
          >
            {column.name}
          </span>
        )}

        {/* Card count badge */}
        <span
          className={`text-[10px] font-bold tabular-nums min-w-[20px] text-center py-0.5 px-1.5 rounded-full ${
            isOverWip
              ? "bg-red-500/20 text-red-400"
              : "bg-border/50 text-muted-foreground"
          }`}
          title={
            column.wipLimit
              ? `${cardCount}/${column.wipLimit} (WIP limit)`
              : `${cardCount} cards`
          }
        >
          {cardCount}
          {column.wipLimit ? `/${column.wipLimit}` : ""}
        </span>

        {/* Add card button */}
        <button
          onClick={onAddCard}
          className="p-1 rounded hover:bg-background/60 transition-colors text-muted-foreground/50 hover:text-foreground"
          title="Add card"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>

        {/* Kebab menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1 rounded hover:bg-background/60 transition-colors text-muted-foreground/50 hover:text-foreground"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>

          {showMenu && (
            <div className="absolute right-0 top-full mt-1 w-52 rounded-lg border border-border bg-card shadow-xl py-1 z-50">
              <button
                onClick={() => {
                  setEditName(column.name);
                  setIsEditing(true);
                  setShowMenu(false);
                }}
                className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors w-full text-left"
              >
                <Pencil className="w-4 h-4" />
                Rename
              </button>

              {!showWipInput ? (
                <button
                  onClick={() => setShowWipInput(true)}
                  className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors w-full text-left"
                >
                  <Gauge className="w-4 h-4" />
                  Set WIP Limit
                  {column.wipLimit ? (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {column.wipLimit}
                    </span>
                  ) : null}
                </button>
              ) : (
                <div className="px-3 py-2 flex items-center gap-2">
                  <Gauge className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <input
                    type="number"
                    value={wipValue}
                    onChange={(e) => setWipValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleWipSubmit();
                    }}
                    placeholder="No limit"
                    min={0}
                    className="w-20 px-2 py-1 text-sm rounded border border-border bg-background focus:outline-none"
                    autoFocus
                  />
                  <button
                    onClick={handleWipSubmit}
                    className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground"
                  >
                    Set
                  </button>
                </div>
              )}

              {!showColorPicker ? (
                <button
                  onClick={() => setShowColorPicker(true)}
                  className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors w-full text-left"
                >
                  <Palette className="w-4 h-4" />
                  Change Color
                </button>
              ) : (
                <div className="px-3 py-2">
                  <div className="flex flex-wrap gap-1.5">
                    {COLUMN_COLORS.map((color) => (
                      <button
                        key={color ?? "none"}
                        onClick={() => {
                          onChangeColor(color);
                          setShowColorPicker(false);
                          setShowMenu(false);
                        }}
                        className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
                          color === column.color
                            ? "border-foreground"
                            : "border-transparent"
                        }`}
                        style={{
                          backgroundColor: color ?? undefined,
                        }}
                        title={color ?? "No color"}
                      >
                        {!color && (
                          <span className="block w-full h-full rounded-full border border-border bg-muted" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t border-border my-1" />

              <button
                onClick={() => {
                  onDelete();
                  setShowMenu(false);
                }}
                className="flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-500/10 transition-colors w-full text-left"
              >
                <Trash2 className="w-4 h-4" />
                Delete Column
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

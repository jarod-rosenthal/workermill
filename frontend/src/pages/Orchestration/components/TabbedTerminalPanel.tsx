import { useRef, useCallback, useState, useEffect } from "react";
import { ChevronDown, ChevronUp, GripHorizontal, Terminal } from "lucide-react";
import type { ChildTask } from "../orchestration-store";
import { TerminalTabBar } from "./TerminalTabBar";
import { StoryTerminal } from "./StoryTerminal";

interface TabbedTerminalPanelProps {
  children: ChildTask[];
  activeTabId: string | null;
  onTabSelect: (taskId: string) => void;
  unreadTasks: Set<string>;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  height: number;
  onHeightChange: (height: number) => void;
  parentTaskId?: string;
}

const MIN_HEIGHT = 150;
const MAX_HEIGHT = 600;
const COLLAPSED_HEIGHT = 36;

/**
 * Bottom panel containing tabbed terminal output
 * Features:
 * - Tab bar for switching between stories
 * - Drag handle for resizing
 * - Collapse/expand toggle
 */
export function TabbedTerminalPanel({
  children,
  activeTabId,
  onTabSelect,
  unreadTasks,
  isCollapsed,
  onToggleCollapse,
  height,
  onHeightChange,
  parentTaskId,
}: TabbedTerminalPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(height);

  // Get terminal lines for the active tab
  const activeChild = children.find((c) => c.id === activeTabId);
  const terminalLines = activeChild?.terminalLines ?? [];

  // Handle resize drag
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      dragStartY.current = e.clientY;
      dragStartHeight.current = height;
    },
    [height]
  );

  // Global mouse handlers for dragging
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Dragging UP increases height (negative deltaY = positive height change)
      const deltaY = dragStartY.current - e.clientY;
      const newHeight = Math.max(
        MIN_HEIGHT,
        Math.min(MAX_HEIGHT, dragStartHeight.current + deltaY)
      );
      onHeightChange(newHeight);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, onHeightChange]);

  // Count executing tasks for header indicator
  const executingCount = children.filter((c) =>
    ["executing", "environment_setup"].includes(c.status)
  ).length;

  return (
    <div
      ref={panelRef}
      className={`mc-terminal-panel ${isCollapsed ? "collapsed" : ""} ${isDragging ? "dragging" : ""}`}
      style={{ height: isCollapsed ? COLLAPSED_HEIGHT : height }}
    >
      {/* Resize handle */}
      {!isCollapsed && (
        <div
          className="mc-terminal-resize-handle"
          onMouseDown={handleDragStart}
        >
          <GripHorizontal className="w-4 h-4" />
        </div>
      )}

      {/* Header bar */}
      <div className="mc-terminal-panel-header">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-[var(--mc-text-muted)]" />
          <span className="text-[var(--mc-text-sm)] font-medium text-[var(--mc-text-secondary)]">
            Terminal
          </span>
          {executingCount > 0 && (
            <span className="mc-terminal-executing-badge">
              {executingCount} running
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Keyboard shortcut hint */}
          <span className="text-[var(--mc-text-xs)] text-[var(--mc-text-muted)] font-mono">
            Ctrl+`
          </span>

          {/* Collapse/Expand button */}
          <button
            onClick={onToggleCollapse}
            className="mc-btn mc-btn-ghost p-1"
            title={isCollapsed ? "Expand terminal" : "Collapse terminal"}
          >
            {isCollapsed ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Content (hidden when collapsed) */}
      {!isCollapsed && (
        <>
          {/* Tab bar */}
          <TerminalTabBar
            children={children}
            activeTabId={activeTabId}
            onTabSelect={onTabSelect}
            unreadTasks={unreadTasks}
            parentTaskId={parentTaskId}
          />

          {/* Terminal content */}
          <div className="mc-terminal-panel-content">
            {activeTabId ? (
              <StoryTerminal lines={terminalLines} isExpanded={true} />
            ) : (
              <div className="flex items-center justify-center h-full text-[var(--mc-text-muted)] text-[var(--mc-text-sm)]">
                Select a story tab to view terminal output
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

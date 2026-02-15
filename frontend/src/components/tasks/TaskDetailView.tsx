import { useRef, useEffect, useState, useCallback } from "react";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import { AlertTriangle, RotateCcw, SkipForward, StopCircle } from "lucide-react";
import { getLogColor } from "../log-viewer/log-colors";
import { StoryTree } from "./StoryTree";
import { DetailPane } from "./DetailPane";
import { TaskDetailFooter } from "./TaskDetailFooter";
import type { ContextMessage } from "../../store/coordination-store";
import type { StreamingLog, ParsedError, BlockerData } from "./mock-data";

export interface TaskDetailViewProps {
  task: { id: string; status: string; summary: string };
  logs: StreamingLog[];
  errors: ParsedError[];
  coordinationMessages: ContextMessage[];
  activeBlocker: BlockerData | null;
  isStreaming: boolean;
  onTalkClick: () => void;
  onBlockerAction: (action: "retry" | "skip" | "abort") => void;
  onStorySelect: (index: number | null) => void;
  selectedStoryIndex: number | null;
}

export function TaskDetailView({
  task,
  logs,
  errors,
  coordinationMessages,
  activeBlocker,
  isStreaming,
  onTalkClick,
  onBlockerAction,
  onStorySelect,
  selectedStoryIndex,
}: TaskDetailViewProps) {
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileTab, setMobileTab] = useState<"stories" | "logs" | "detail">("logs");

  // Responsive breakpoint
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 768px)");
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  // Auto-scroll log container
  useEffect(() => {
    const el = logContainerRef.current;
    if (el && isStreaming) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs.length, isStreaming]);

  const handleErrorClick = useCallback(
    (logIndex: number) => {
      const el = logContainerRef.current;
      if (!el) return;
      const line = el.querySelector(`[data-log-index="${logIndex}"]`);
      if (line) {
        line.scrollIntoView({ behavior: "smooth", block: "center" });
        line.classList.add("bg-yellow-500/10");
        setTimeout(() => line.classList.remove("bg-yellow-500/10"), 2000);
      }
    },
    [],
  );

  // Filter logs by selected story if applicable
  // For now, show all logs (story filtering requires log-level storyIndex metadata)
  const visibleLogs = logs;

  const logPanel = (
    <div className="flex flex-col h-full terminal-bg rounded-none">
      {/* Terminal header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border terminal-header shrink-0">
        <div className="flex gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
          <span className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
        </div>
        <span className="text-xs text-muted-foreground font-mono truncate">
          {task.summary}
        </span>
        {isStreaming && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-green-400">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            LIVE
          </span>
        )}
      </div>

      {/* Log lines */}
      <div ref={logContainerRef} className="flex-1 overflow-y-auto px-1 py-1 font-mono text-xs leading-relaxed">
        {visibleLogs.map((log, i) => {
          const { textClass, boxShadow } = getLogColor(log);
          return (
            <div
              key={i}
              data-log-index={i}
              className={`px-2 py-px hover:bg-white/[0.03] transition-colors ${textClass}`}
              style={{ boxShadow }}
            >
              {log.message}
            </div>
          );
        })}
      </div>
    </div>
  );

  // Mobile: tabs
  if (isMobile) {
    return (
      <div className="flex flex-col h-full bg-background">
        {/* Blocker bar */}
        {activeBlocker && (
          <BlockerBar blocker={activeBlocker} onAction={onBlockerAction} />
        )}

        {/* Tab bar */}
        <div className="flex border-b border-border shrink-0">
          {(["stories", "logs", "detail"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setMobileTab(tab)}
              className={`flex-1 px-3 py-2 text-xs font-medium capitalize transition-colors ${
                mobileTab === tab
                  ? "text-foreground border-b-2 border-primary"
                  : "text-muted-foreground"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {mobileTab === "stories" && (
            <StoryTree
              coordinationMessages={coordinationMessages}
              selectedStoryIndex={selectedStoryIndex}
              onStorySelect={onStorySelect}
            />
          )}
          {mobileTab === "logs" && logPanel}
          {mobileTab === "detail" && (
            <DetailPane
              coordinationMessages={coordinationMessages}
              errors={errors}
              selectedStoryIndex={selectedStoryIndex}
              onErrorClick={handleErrorClick}
            />
          )}
        </div>

        <TaskDetailFooter onTalkClick={onTalkClick} />
      </div>
    );
  }

  // Desktop: three resizable panes
  return (
    <div className="flex flex-col h-full bg-background">
      {/* Blocker bar */}
      {activeBlocker && (
        <BlockerBar blocker={activeBlocker} onAction={onBlockerAction} />
      )}

      {/* Three-pane layout */}
      <PanelGroup orientation="horizontal" className="flex-1">
        {/* Left: Story tree */}
        <Panel defaultSize={15} minSize={10} maxSize={25} collapsible>
          <div className="h-full border-r border-border bg-card/30">
            <StoryTree
              coordinationMessages={coordinationMessages}
              selectedStoryIndex={selectedStoryIndex}
              onStorySelect={onStorySelect}
            />
          </div>
        </Panel>

        <PanelResizeHandle className="w-px bg-border hover:bg-primary/50 transition-colors data-[separator=active]:bg-primary" />

        {/* Center: Terminal */}
        <Panel defaultSize={55} minSize={30}>
          {logPanel}
        </Panel>

        <PanelResizeHandle className="w-px bg-border hover:bg-primary/50 transition-colors data-[separator=active]:bg-primary" />

        {/* Right: Detail pane */}
        <Panel defaultSize={30} minSize={15} maxSize={45} collapsible>
          <div className="h-full border-l border-border bg-card/30">
            <DetailPane
              coordinationMessages={coordinationMessages}
              errors={errors}
              selectedStoryIndex={selectedStoryIndex}
              onErrorClick={handleErrorClick}
            />
          </div>
        </Panel>
      </PanelGroup>

      {/* Footer */}
      <TaskDetailFooter onTalkClick={onTalkClick} />
    </div>
  );
}

// --- Inline BlockerBar (simplified from BlockerAlert.tsx for the shell) ---

function BlockerBar({
  blocker,
  onAction,
}: {
  blocker: BlockerData;
  onAction: (action: "retry" | "skip" | "abort") => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-red-500/10 border-b border-red-500/30 shrink-0">
      <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium text-red-400">
          BLOCKER: Story {blocker.storyIndex}
        </span>
        <span className="text-xs text-muted-foreground ml-2 truncate">
          {blocker.summary || blocker.errorMessage.split("\n")[0]}
        </span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={() => onAction("retry")}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          Retry
        </button>
        <button
          onClick={() => onAction("skip")}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors"
        >
          <SkipForward className="w-3 h-3" />
          Skip
        </button>
        <button
          onClick={() => onAction("abort")}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
        >
          <StopCircle className="w-3 h-3" />
          Abort
        </button>
      </div>
    </div>
  );
}

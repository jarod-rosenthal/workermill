import { useEffect, useRef } from "react";

interface StoryTerminalProps {
  lines: string[];
  isExpanded: boolean;
}

/**
 * Terminal-style log viewer for a story
 * Auto-scrolls to bottom when new lines arrive
 */
export function StoryTerminal({ lines, isExpanded }: StoryTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);

  // Check if scroll is at bottom
  const isAtBottom = () => {
    const el = terminalRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  };

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    if (wasAtBottomRef.current && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines]);

  // Track scroll position
  const handleScroll = () => {
    wasAtBottomRef.current = isAtBottom();
  };

  if (!isExpanded) return null;

  // Classify line type for coloring
  const getLineClass = (line: string): string => {
    const lower = line.toLowerCase();
    if (lower.includes("error") || lower.includes("failed") || lower.includes("exception")) {
      return "error";
    }
    if (lower.includes("warning") || lower.includes("warn")) {
      return "warning";
    }
    if (line.startsWith("$") || line.startsWith(">") || line.startsWith("#")) {
      return "prompt";
    }
    return "";
  };

  return (
    <div
      ref={terminalRef}
      onScroll={handleScroll}
      className="mc-tile-terminal max-h-64 overflow-y-auto"
    >
      {lines.length === 0 ? (
        <div className="text-[var(--mc-text-muted)] italic">
          Waiting for logs...
        </div>
      ) : (
        lines.map((line, idx) => (
          <div
            key={idx}
            className={`mc-tile-terminal-line ${getLineClass(line)}`}
          >
            {line}
          </div>
        ))
      )}
    </div>
  );
}

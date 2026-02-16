import { useState, useEffect, useRef } from "react";
import { RefreshCw, ChevronUp, ChevronDown, AlertCircle } from "lucide-react";
import apiClient from "../lib/api-client";

interface LogEntry {
  id: string;
  timestamp: string;
  type: string;
  message: string;
  severity?: string;
  logType?: string;
  metadata?: {
    errorType?: "fatal" | "recoverable";
    [key: string]: unknown;
  };
}

interface TerminalLogViewerProps {
  taskId: string;
  height?: string;
}

/**
 * Reusable terminal log viewer component for displaying task logs.
 * Used in both active task terminals and historical task log viewing.
 */
export function TerminalLogViewer({ taskId, height = "400px" }: TerminalLogViewerProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logCount, setLogCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        setLoading(true);
        setError(null);
        // Fetch all logs for completed task viewing (no limit)
        const response = await apiClient.get(`/control-center/logs/${taskId}`);

        const fetchedLogs = response.data.logs || [];
        setLogs(fetchedLogs);
        setLogCount(fetchedLogs.length);
      } catch (err) {
        console.error("Failed to fetch logs:", err);
        setError("Failed to load task logs");
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, [taskId]);

  const scrollToTop = () => {
    containerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const scrollToBottom = () => {
    containerRef.current?.scrollTo({
      top: containerRef.current.scrollHeight,
      behavior: "smooth",
    });
  };

  /**
   * Get color class for log message based on severity and content.
   * Mirrors the logic from Dashboard.tsx for consistency.
   */
  const getLogColorClass = (log: LogEntry): string => {
    const msg = log.message;
    const isFatalError = log.metadata?.errorType === "fatal";
    const isError =
      log.severity === "error" ||
      log.logType === "error" ||
      msg.includes("[ERROR]") ||
      msg.includes("Error") ||
      msg.includes("error:");

    if (isError && isFatalError) {
      return "text-red-400"; // Fatal errors are bright red
    }
    if (isError) {
      return "text-orange-300/70"; // Recoverable/unclassified errors are muted
    }
    if (
      log.severity === "warning" ||
      log.logType === "warning" ||
      msg.includes("[WARN]") ||
      msg.includes("Warning")
    ) {
      return "text-yellow-400";
    }
    if (msg.includes("[worker]") || msg.includes("Claude") || msg.includes("Starting")) {
      return "text-cyan-400";
    }
    if (msg.includes("[SUCCESS]") || msg.includes("Completed") || msg.includes("success")) {
      return "text-green-400";
    }
    if (msg.startsWith("$") || msg.includes("npm ") || msg.includes("git ")) {
      return "text-purple-400";
    }
    return "text-gray-300";
  };

  if (loading) {
    return (
      <div
        className="bg-[#1a1b26] rounded-lg border border-border flex items-center justify-center"
        style={{ height }}
      >
        <div className="text-gray-400 flex items-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" />
          Loading logs...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="bg-[#1a1b26] rounded-lg border border-red-500/30 flex items-center justify-center"
        style={{ height }}
      >
        <div className="text-red-400 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="relative" style={{ height }}>
      {/* Terminal Header */}
      <div className="bg-[#1a1b26] border border-border rounded-t-lg px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500/80" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <div className="w-3 h-3 rounded-full bg-green-500/80" />
          </div>
          <span className="text-xs text-gray-500 ml-2">
            {logCount.toLocaleString()} log entries
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={scrollToTop}
            className="p-1 text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 rounded transition-colors"
            title="Scroll to top"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            onClick={scrollToBottom}
            className="p-1 text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 rounded transition-colors"
            title="Scroll to bottom"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Terminal Body */}
      <div
        ref={containerRef}
        className="bg-[#1a1b26] border-x border-b border-border rounded-b-lg overflow-y-auto font-mono text-xs leading-relaxed p-3"
        style={{ height: `calc(${height} - 40px)` }}
        data-testid="log-output"
      >
        {logs.length === 0 ? (
          <div className="text-gray-500 flex items-center justify-center h-full">
            No logs available for this task
          </div>
        ) : (
          logs
            .filter((log) => log.message.length > 0)
            .map((log, idx) => (
              <div
                key={log.id || idx}
                className={`whitespace-pre-wrap break-all ${getLogColorClass(log)}`}
              >
                {log.message}
              </div>
            ))
        )}
      </div>
    </div>
  );
}

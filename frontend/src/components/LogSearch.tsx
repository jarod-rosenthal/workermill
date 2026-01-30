import React, { useState, useEffect } from "react";
import axios from "axios";
import { useDebounce } from "../hooks/useDebounce";
import { Search, X, Loader2 } from "lucide-react";

interface SearchResult {
  id: string;
  taskId: string;
  jiraIssueKey: string;
  taskSummary: string;
  timestamp: string;
  type: string;
  message: string;
  severity: string;
  command?: string;
  filePath?: string;
  snippet: string;
  headline?: string;
}

interface TaskResult {
  id: string;
  jiraIssueKey: string;
  summary: string;
  status: string;
  createdAt: string;
}

interface SearchResponse {
  query: string;
  tasks: TaskResult[];
  results: SearchResult[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export const LogSearch: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<SearchResponse["pagination"] | null>(null);
  const [filters, setFilters] = useState<{
    type?: string;
    severity?: string;
  }>({});
  const [taskResults, setTaskResults] = useState<TaskResult[]>([]);
  const [activeTab, setActiveTab] = useState<"all" | "tasks" | "logs">("all");

  // Search history
  const HISTORY_KEY = "workermill_search_history";
  const MAX_HISTORY = 5;
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    } catch {
      return [];
    }
  });

  const addToHistory = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    const updated = [trimmed, ...searchHistory.filter((h) => h !== trimmed)].slice(
      0,
      MAX_HISTORY
    );
    setSearchHistory(updated);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  };

  // Debounced search query (300ms delay)
  const debouncedQuery = useDebounce(query, 300);

  // Escape key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen, onClose]);

  // Trigger search when debounced query or filters change
  useEffect(() => {
    if (debouncedQuery.trim()) {
      performSearch(debouncedQuery);
    } else {
      setResults([]);
      setPagination(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, filters.type, filters.severity]);

  const performSearch = async (searchQuery: string, offset = 0) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setPagination(null);
      return;
    }

    // Add to search history on first search (not load more)
    if (offset === 0) {
      addToHistory(searchQuery);
    }

    setLoading(true);
    setError(null);

    try {
      const params: Record<string, string | number> = {
        q: searchQuery,
        limit: 50,
        offset,
      };

      if (filters.type) params.type = filters.type;
      if (filters.severity) params.severity = filters.severity;

      const token = localStorage.getItem("accessToken");
      const response = await axios.get<SearchResponse>(
        "/api/control-center/search",
        {
          params,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      setResults((prev) =>
        offset === 0 ? response.data.results : [...prev, ...response.data.results]
      );
      setPagination(response.data.pagination);
      // Only update task results on first page (offset === 0)
      if (offset === 0) {
        setTaskResults(response.data.tasks || []);
      }
    } catch (err) {
      console.error("Search error:", err);
      setError("Failed to search logs. Please try again.");
      setResults([]);
      setTaskResults([]);
      setPagination(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    performSearch(query);
  };

  const handleLoadMore = () => {
    if (pagination?.hasMore) {
      performSearch(query, pagination.offset + pagination.limit);
    }
  };

  const handleClear = () => {
    setQuery("");
    setResults([]);
    setTaskResults([]);
    setPagination(null);
    setFilters({});
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "error":
        return "text-red-500 bg-red-500/10";
      case "warning":
        return "text-yellow-500 bg-yellow-500/10";
      case "info":
        return "text-blue-500 bg-blue-500/10";
      default:
        return "text-muted-foreground bg-muted";
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "bash_command":
        return "⌘";
      case "file_edit":
        return "✏️";
      case "file_read":
        return "📖";
      case "git_operation":
        return "🌿";
      case "pr_created":
        return "🔀";
      case "error":
        return "❌";
      default:
        return "📝";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "text-green-500 bg-green-500/10";
      case "running":
        return "text-blue-500 bg-blue-500/10";
      case "failed":
        return "text-red-500 bg-red-500/10";
      case "queued":
        return "text-yellow-500 bg-yellow-500/10";
      default:
        return "text-muted-foreground bg-muted";
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border bg-muted/50">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-foreground">
              Search Task Logs
            </h2>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Search form */}
          <form onSubmit={handleSearch} className="space-y-3">
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search for authentication, API calls, errors..."
                  className="w-full pl-10 pr-4 py-2 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-primary focus:border-transparent"
                  autoFocus
                />
              </div>
              {query && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="px-3 py-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
                  title="Clear search"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
              <button
                type="submit"
                disabled={loading || !query.trim()}
                className="px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed transition-all font-medium"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Search"
                )}
              </button>
            </div>

            {/* Filters */}
            <div className="flex gap-3 text-sm">
              <select
                value={filters.type || ""}
                onChange={(e) =>
                  setFilters((prev) => ({
                    ...prev,
                    type: e.target.value || undefined,
                  }))
                }
                className="px-3 py-1.5 bg-background border border-border rounded-lg text-foreground focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value="">All types</option>
                <option value="bash_command">Commands</option>
                <option value="file_edit">File edits</option>
                <option value="git_operation">Git operations</option>
                <option value="error">Errors</option>
              </select>

              <select
                value={filters.severity || ""}
                onChange={(e) =>
                  setFilters((prev) => ({
                    ...prev,
                    severity: e.target.value || undefined,
                  }))
                }
                className="px-3 py-1.5 bg-background border border-border rounded-lg text-foreground focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value="">All severities</option>
                <option value="error">Error</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
                <option value="debug">Debug</option>
              </select>
            </div>
          </form>

          {/* Search history chips */}
          {!query && searchHistory.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 items-center">
              <span className="text-xs text-muted-foreground">Recent:</span>
              {searchHistory.map((historyQuery, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setQuery(historyQuery)}
                  className="px-2 py-1 text-xs bg-muted text-muted-foreground rounded border border-border hover:bg-muted/80 hover:text-foreground transition-colors"
                >
                  {historyQuery}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-4 bg-card">
          {error && (
            <div className="p-4 bg-red-500/10 text-red-500 rounded-lg border border-red-500/20 mb-4">
              {error}
            </div>
          )}

          {pagination && (
            <div className="mb-3 text-sm text-muted-foreground">
              Found {pagination.total} log{pagination.total !== 1 ? "s" : ""}
              {taskResults.length > 0 && ` and ${taskResults.length} task${taskResults.length !== 1 ? "s" : ""}`}{" "}
              for "{query}"
            </div>
          )}

          {/* Tabs */}
          {(results.length > 0 || taskResults.length > 0) && (
            <div className="flex gap-1 mb-4 border-b border-border">
              <button
                onClick={() => setActiveTab("all")}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === "all"
                    ? "text-primary border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                All
              </button>
              <button
                onClick={() => setActiveTab("tasks")}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === "tasks"
                    ? "text-primary border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Tasks ({taskResults.length})
              </button>
              <button
                onClick={() => setActiveTab("logs")}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === "logs"
                    ? "text-primary border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Logs ({pagination?.total || 0})
              </button>
            </div>
          )}

          {/* Task Results */}
          {(activeTab === "all" || activeTab === "tasks") && taskResults.length > 0 && (
            <div className="mb-4">
              {activeTab === "all" && (
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Tasks</h3>
              )}
              <div className="space-y-2">
                {taskResults.map((task) => (
                  <a
                    key={task.id}
                    href={`/tasks/${task.id}`}
                    className="block border border-border rounded-lg p-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-primary font-medium">
                          {task.jiraIssueKey}
                        </span>
                        <span className="text-muted-foreground text-sm truncate max-w-md">
                          {task.summary}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(
                            task.status
                          )}`}
                        >
                          {task.status}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(task.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Log Results Header when showing all */}
          {activeTab === "all" && results.length > 0 && taskResults.length > 0 && (
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Logs</h3>
          )}

          {results.length === 0 && !loading && query && (
            <div className="text-center py-12 text-muted-foreground">
              No results found. Try a different search query.
            </div>
          )}

          {results.length === 0 && !loading && !query && (
            <div className="text-center py-12 text-muted-foreground">
              Enter a search query to find logs across all tasks
            </div>
          )}

          {(activeTab === "all" || activeTab === "logs") && (
            <div className="space-y-3">
              {results.map((result) => (
                <div
                  key={result.id}
                  className="border border-border rounded-lg p-4 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{getTypeIcon(result.type)}</span>
                      <a
                        href={`/tasks/${result.taskId}`}
                        className="text-primary hover:underline font-medium"
                      >
                        {result.jiraIssueKey}
                      </a>
                      <span className="text-muted-foreground text-sm">
                        {result.taskSummary}
                      </span>
                    </div>
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${getSeverityColor(
                        result.severity
                      )}`}
                    >
                      {result.severity}
                    </span>
                  </div>

                  <div
                    className="text-sm font-mono text-muted-foreground bg-muted/50 p-2 rounded mb-2 border border-border [&_mark]:bg-yellow-500/30 [&_mark]:text-foreground [&_mark]:rounded [&_mark]:px-0.5"
                    dangerouslySetInnerHTML={{
                      __html: result.headline || result.snippet,
                    }}
                  />

                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>
                      {new Date(result.timestamp).toLocaleString()}
                    </span>
                    {result.filePath && (
                      <span className="flex items-center gap-1">
                        📁 {result.filePath}
                      </span>
                    )}
                    {result.command && (
                      <span className="flex items-center gap-1">
                        $ {result.command.substring(0, 50)}
                        {result.command.length > 50 ? "..." : ""}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {(activeTab === "all" || activeTab === "logs") && pagination?.hasMore && (
            <div className="mt-4 text-center">
              <button
                onClick={handleLoadMore}
                disabled={loading}
                className="px-4 py-2 bg-muted text-muted-foreground rounded-lg hover:bg-muted/80 hover:text-foreground border border-border disabled:opacity-50 transition-colors"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                ) : null}
                {loading ? "Loading..." : "Load more"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

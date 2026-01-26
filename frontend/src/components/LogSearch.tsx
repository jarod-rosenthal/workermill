import React, { useState, useEffect } from "react";
import axios from "axios";
import { useDebounce } from "../hooks/useDebounce";

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
        return "text-[var(--mc-status-danger)] bg-[var(--mc-status-danger)]/10";
      case "warning":
        return "text-[var(--mc-status-warning)] bg-[var(--mc-status-warning)]/10";
      case "info":
        return "text-[var(--mc-status-info)] bg-[var(--mc-status-info)]/10";
      default:
        return "text-[var(--mc-text-muted)] bg-[var(--mc-bg-elevated)]";
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
        return "text-[var(--mc-status-success)] bg-[var(--mc-status-success)]/10";
      case "running":
        return "text-[var(--mc-status-active)] bg-[var(--mc-status-active)]/10";
      case "failed":
        return "text-[var(--mc-status-danger)] bg-[var(--mc-status-danger)]/10";
      case "queued":
        return "text-[var(--mc-status-warning)] bg-[var(--mc-status-warning)]/10";
      default:
        return "text-[var(--mc-text-muted)] bg-[var(--mc-bg-elevated)]";
    }
  };

  if (!isOpen) return null;

  return (
    <div className="mission-control fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--mc-bg-surface)] border border-[var(--mc-border-default)] rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-[var(--mc-border-subtle)] bg-[var(--mc-bg-elevated)]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-[var(--mc-text-primary)]">
              Search Task Logs
            </h2>
            <button
              onClick={onClose}
              className="text-[var(--mc-text-muted)] hover:text-[var(--mc-text-primary)] text-2xl font-bold transition-colors"
            >
              ×
            </button>
          </div>

          {/* Search form */}
          <form onSubmit={handleSearch} className="space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search for authentication, API calls, errors..."
                className="flex-1 px-4 py-2 bg-[var(--mc-bg-base)] border border-[var(--mc-border-default)] rounded-lg text-[var(--mc-text-primary)] placeholder:text-[var(--mc-text-muted)] focus:ring-2 focus:ring-[var(--mc-status-active)] focus:border-transparent"
                autoFocus
              />
              {query && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="px-3 py-2 text-[var(--mc-text-muted)] hover:text-[var(--mc-text-primary)] transition-colors"
                  title="Clear search"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-5 h-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
              <button
                type="submit"
                disabled={loading || !query.trim()}
                className="px-6 py-2 bg-[var(--mc-status-active)] text-white rounded-lg hover:opacity-90 disabled:bg-[var(--mc-bg-elevated)] disabled:text-[var(--mc-text-muted)] disabled:cursor-not-allowed transition-all"
              >
                {loading ? "Searching..." : "Search"}
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
                className="px-3 py-1 bg-[var(--mc-bg-base)] border border-[var(--mc-border-default)] rounded text-[var(--mc-text-primary)]"
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
                className="px-3 py-1 bg-[var(--mc-bg-base)] border border-[var(--mc-border-default)] rounded text-[var(--mc-text-primary)]"
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
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="text-xs text-[var(--mc-text-muted)]">Recent:</span>
              {searchHistory.map((historyQuery, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setQuery(historyQuery)}
                  className="px-2 py-1 text-xs bg-[var(--mc-bg-base)] text-[var(--mc-text-secondary)] rounded border border-[var(--mc-border-subtle)] hover:bg-[var(--mc-bg-elevated)] hover:text-[var(--mc-text-primary)] transition-colors"
                >
                  {historyQuery}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-4 bg-[var(--mc-bg-surface)]">
          {error && (
            <div className="p-4 bg-[var(--mc-status-danger)]/10 text-[var(--mc-status-danger)] rounded-lg border border-[var(--mc-status-danger)]/20">
              {error}
            </div>
          )}

          {pagination && (
            <div className="mb-3 text-sm text-[var(--mc-text-secondary)]">
              Found {pagination.total} log{pagination.total !== 1 ? "s" : ""}
              {taskResults.length > 0 && ` and ${taskResults.length} task${taskResults.length !== 1 ? "s" : ""}`}{" "}
              for "{query}"
            </div>
          )}

          {/* Tabs */}
          {(results.length > 0 || taskResults.length > 0) && (
            <div className="flex gap-1 mb-4 border-b border-[var(--mc-border-subtle)]">
              <button
                onClick={() => setActiveTab("all")}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === "all"
                    ? "text-[var(--mc-status-active)] border-b-2 border-[var(--mc-status-active)]"
                    : "text-[var(--mc-text-muted)] hover:text-[var(--mc-text-primary)]"
                }`}
              >
                All
              </button>
              <button
                onClick={() => setActiveTab("tasks")}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === "tasks"
                    ? "text-[var(--mc-status-active)] border-b-2 border-[var(--mc-status-active)]"
                    : "text-[var(--mc-text-muted)] hover:text-[var(--mc-text-primary)]"
                }`}
              >
                Tasks ({taskResults.length})
              </button>
              <button
                onClick={() => setActiveTab("logs")}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === "logs"
                    ? "text-[var(--mc-status-active)] border-b-2 border-[var(--mc-status-active)]"
                    : "text-[var(--mc-text-muted)] hover:text-[var(--mc-text-primary)]"
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
                <h3 className="text-sm font-medium text-[var(--mc-text-secondary)] mb-2">Tasks</h3>
              )}
              <div className="space-y-2">
                {taskResults.map((task) => (
                  <a
                    key={task.id}
                    href={`/tasks/${task.id}`}
                    className="block border border-[var(--mc-border-subtle)] rounded-lg p-3 hover:bg-[var(--mc-bg-elevated)] transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[var(--mc-status-info)] font-medium">
                          {task.jiraIssueKey}
                        </span>
                        <span className="text-[var(--mc-text-secondary)] text-sm truncate max-w-md">
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
                        <span className="text-xs text-[var(--mc-text-muted)]">
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
            <h3 className="text-sm font-medium text-[var(--mc-text-secondary)] mb-2">Logs</h3>
          )}

          {results.length === 0 && !loading && query && (
            <div className="text-center py-12 text-[var(--mc-text-muted)]">
              No results found. Try a different search query.
            </div>
          )}

          {results.length === 0 && !loading && !query && (
            <div className="text-center py-12 text-[var(--mc-text-muted)]">
              Enter a search query to find logs across all tasks
            </div>
          )}

          {(activeTab === "all" || activeTab === "logs") && (
            <div className="space-y-3">
              {results.map((result) => (
                <div
                  key={result.id}
                  className="border border-[var(--mc-border-subtle)] rounded-lg p-4 hover:bg-[var(--mc-bg-elevated)] transition-colors"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{getTypeIcon(result.type)}</span>
                      <a
                        href={`/tasks/${result.taskId}`}
                        className="text-[var(--mc-status-info)] hover:underline font-medium"
                      >
                        {result.jiraIssueKey}
                    </a>
                    <span className="text-[var(--mc-text-muted)] text-sm">
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
                  className="text-sm font-mono text-[var(--mc-text-secondary)] bg-[var(--mc-bg-elevated)] p-2 rounded mb-2 border border-[var(--mc-border-subtle)] [&_mark]:bg-[var(--mc-status-warning)] [&_mark]:text-[var(--mc-text-primary)] [&_mark]:rounded [&_mark]:px-0.5"
                  dangerouslySetInnerHTML={{
                    __html: result.headline || result.snippet,
                  }}
                />

                <div className="flex items-center gap-4 text-xs text-[var(--mc-text-muted)]">
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
                className="px-4 py-2 bg-[var(--mc-bg-elevated)] text-[var(--mc-text-secondary)] rounded hover:bg-[var(--mc-bg-surface)] border border-[var(--mc-border-subtle)] disabled:opacity-50 transition-colors"
              >
                {loading ? "Loading..." : "Load more"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

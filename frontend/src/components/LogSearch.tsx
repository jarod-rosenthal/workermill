import React, { useState } from "react";
import axios from "axios";

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
}

interface SearchResponse {
  query: string;
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

  const performSearch = async (searchQuery: string, offset = 0) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setPagination(null);
      return;
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

      const response = await axios.get<SearchResponse>(
        "/api/control-center/search",
        { params }
      );

      setResults(response.data.results);
      setPagination(response.data.pagination);
    } catch (err) {
      console.error("Search error:", err);
      setError("Failed to search logs. Please try again.");
      setResults([]);
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
              Found {pagination.total} result{pagination.total !== 1 ? "s" : ""}{" "}
              for "{query}"
            </div>
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

                <div className="text-sm font-mono text-[var(--mc-text-secondary)] bg-[var(--mc-bg-elevated)] p-2 rounded mb-2 border border-[var(--mc-border-subtle)]">
                  {result.snippet}
                </div>

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

          {pagination?.hasMore && (
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

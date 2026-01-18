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
        return "text-red-600 bg-red-50";
      case "warning":
        return "text-yellow-600 bg-yellow-50";
      case "info":
        return "text-blue-600 bg-blue-50";
      default:
        return "text-gray-600 bg-gray-50";
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-800">
              Search Task Logs
            </h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 text-2xl font-bold"
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
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoFocus
              />
              <button
                type="submit"
                disabled={loading || !query.trim()}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
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
                className="px-3 py-1 border border-gray-300 rounded"
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
                className="px-3 py-1 border border-gray-300 rounded"
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
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="p-4 bg-red-50 text-red-700 rounded-lg">
              {error}
            </div>
          )}

          {pagination && (
            <div className="mb-3 text-sm text-gray-600">
              Found {pagination.total} result{pagination.total !== 1 ? "s" : ""}{" "}
              for "{query}"
            </div>
          )}

          {results.length === 0 && !loading && query && (
            <div className="text-center py-12 text-gray-500">
              No results found. Try a different search query.
            </div>
          )}

          {results.length === 0 && !loading && !query && (
            <div className="text-center py-12 text-gray-400">
              Enter a search query to find logs across all tasks
            </div>
          )}

          <div className="space-y-3">
            {results.map((result) => (
              <div
                key={result.id}
                className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{getTypeIcon(result.type)}</span>
                    <a
                      href={`/tasks/${result.taskId}`}
                      className="text-blue-600 hover:underline font-medium"
                    >
                      {result.jiraIssueKey}
                    </a>
                    <span className="text-gray-500 text-sm">
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

                <div className="text-sm font-mono text-gray-700 bg-gray-50 p-2 rounded mb-2">
                  {result.snippet}
                </div>

                <div className="flex items-center gap-4 text-xs text-gray-500">
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
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50"
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

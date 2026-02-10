/**
 * Codebase Index Status Component
 *
 * Displays indexed repository status for Codebase RAG.
 * Shows indexing progress, file counts, and allows re-indexing or deletion.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Database,
  RefreshCw,
  Trash2,
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
  FileCode,
  GitBranch,
  AlertTriangle,
} from "lucide-react";
import { useAuthStore } from "../store/auth-store";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface IndexedRepository {
  repository: string;
  branch: string;
  status: "pending" | "indexing" | "ready" | "failed" | "stale";
  totalChunks: number;
  indexedFiles: number;
  lastIndexedCommit: string | null;
  completedAt: string | null;
  updatedAt: string;
  tokensUsed?: number;
  estimatedCostUsd?: number;
}

interface CodebaseStats {
  totalRepositories: number;
  totalChunks: number;
  totalTokensUsed: number;
  totalCostUsd: number;
  repositories: IndexedRepository[];
}

const STATUS_CONFIG = {
  pending: {
    icon: Clock,
    label: "Pending",
    className: "text-yellow-500 bg-yellow-500/10",
  },
  indexing: {
    icon: Loader2,
    label: "Indexing",
    className: "text-blue-500 bg-blue-500/10 animate-pulse",
  },
  ready: {
    icon: CheckCircle,
    label: "Ready",
    className: "text-green-500 bg-green-500/10",
  },
  failed: {
    icon: XCircle,
    label: "Failed",
    className: "text-red-500 bg-red-500/10",
  },
  stale: {
    icon: AlertTriangle,
    label: "Stale",
    className: "text-orange-500 bg-orange-500/10",
  },
};

export function CodebaseIndexStatus() {
  const { tokens } = useAuthStore();
  const [stats, setStats] = useState<CodebaseStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reindexing, setReindexing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    if (!tokens?.accessToken) return;

    try {
      const response = await fetch(`${API_BASE}/api/codebase/stats`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch codebase stats");
      }

      const data = await response.json();
      setStats(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stats");
    } finally {
      setLoading(false);
    }
  }, [tokens?.accessToken]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleReindex = async (repository: string, branch: string) => {
    if (!tokens?.accessToken) return;

    setReindexing(repository);
    try {
      const response = await fetch(`${API_BASE}/api/codebase/index`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          repository,
          branch,
          forceReindex: true,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to start reindexing");
      }

      // Refresh stats after starting reindex
      await fetchStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reindex");
    } finally {
      setReindexing(null);
    }
  };

  const handleDelete = async (repository: string, branch?: string) => {
    if (!tokens?.accessToken) return;

    if (!confirm(`Delete index for ${repository}? This cannot be undone.`)) {
      return;
    }

    setDeleting(repository);
    try {
      const url = branch
        ? `${API_BASE}/api/codebase/index/${encodeURIComponent(repository)}?branch=${encodeURIComponent(branch)}`
        : `${API_BASE}/api/codebase/index/${encodeURIComponent(repository)}`;

      const response = await fetch(url, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to delete index");
      }

      // Refresh stats after deletion
      await fetchStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
        <div className="flex items-center gap-2 text-red-500">
          <XCircle className="w-4 h-4" />
          <span className="text-sm">{error}</span>
        </div>
        <button
          onClick={fetchStats}
          className="mt-2 text-xs text-red-400 hover:text-red-300 underline"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!stats || stats.repositories.length === 0) {
    return (
      <div className="p-6 rounded-lg bg-muted/30 border border-border text-center">
        <Database className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          No repositories indexed yet.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Repositories will be automatically indexed when tasks run.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-3 rounded-lg bg-violet-500/10 border border-violet-500/20">
          <div className="text-2xl font-bold text-violet-400">
            {stats.totalRepositories}
          </div>
          <div className="text-xs text-muted-foreground">Repositories</div>
        </div>
        <div className="p-3 rounded-lg bg-violet-500/10 border border-violet-500/20">
          <div className="text-2xl font-bold text-violet-400">
            {stats.totalChunks.toLocaleString()}
          </div>
          <div className="text-xs text-muted-foreground">Code Chunks</div>
        </div>
        <div className="p-3 rounded-lg bg-violet-500/10 border border-violet-500/20">
          <div className="text-2xl font-bold text-violet-400">
            ${(stats.totalCostUsd ?? 0).toFixed(2)}
          </div>
          <div className="text-xs text-muted-foreground">Embedding Cost</div>
        </div>
      </div>

      {/* Repository List */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-foreground">
          Indexed Repositories
        </h4>
        {stats.repositories.map((repo) => {
          const statusConfig = STATUS_CONFIG[repo.status];
          const StatusIcon = statusConfig.icon;
          const isReindexing = reindexing === repo.repository;
          const isDeleting = deleting === repo.repository;

          return (
            <div
              key={`${repo.repository}-${repo.branch}`}
              className="p-3 rounded-lg bg-card border border-border"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <FileCode className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm font-medium text-foreground truncate">
                      {repo.repository}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${statusConfig.className}`}
                    >
                      <StatusIcon
                        className={`w-3 h-3 ${repo.status === "indexing" ? "animate-spin" : ""}`}
                      />
                      {statusConfig.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <GitBranch className="w-3 h-3" />
                      {repo.branch}
                    </span>
                    <span>{repo.indexedFiles} files</span>
                    <span>{repo.totalChunks} chunks</span>
                    {repo.completedAt && (
                      <span>
                        Last indexed:{" "}
                        {new Date(repo.completedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-2">
                  <button
                    onClick={() => handleReindex(repo.repository, repo.branch)}
                    disabled={isReindexing || repo.status === "indexing"}
                    className="p-1.5 rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Reindex"
                  >
                    <RefreshCw
                      className={`w-4 h-4 text-muted-foreground ${isReindexing ? "animate-spin" : ""}`}
                    />
                  </button>
                  <button
                    onClick={() => handleDelete(repo.repository, repo.branch)}
                    disabled={isDeleting}
                    className="p-1.5 rounded hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Delete index"
                  >
                    <Trash2
                      className={`w-4 h-4 text-muted-foreground hover:text-red-500 ${isDeleting ? "animate-pulse" : ""}`}
                    />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default CodebaseIndexStatus;

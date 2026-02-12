import { useState } from "react";
import {
  AlertTriangle,
  RotateCcw,
  SkipForward,
  StopCircle,
  ChevronDown,
  ChevronUp,
  FileCode,
  GitBranch,
  Clock,
  Loader2,
} from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface BlockerAlertProps {
  taskId: string;
  parentTaskId: string;
  blocker: {
    id: string;
    storyIndex: number;
    storyTitle: string;
    errorCategory: string;
    /** Human-readable summary of what went wrong */
    summary?: string;
    /** Full error output (may be long) */
    errorMessage: string;
    affectedFiles: string[];
    autoRetryAttempts: number;
    maxAutoRetries: number;
    dependentStories: number[];
    createdAt: string;
  };
  onResolved?: () => void;
}

export function BlockerAlert({
  taskId,
  parentTaskId,
  blocker,
  onResolved,
}: BlockerAlertProps) {
  const [expanded, setExpanded] = useState(true);
  const [showFullError, setShowFullError] = useState(false);
  const [guidance, setGuidance] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAction = async (action: "retry" | "skip" | "abort") => {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_BASE}/api/coordination/blocker-response`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("accessToken")}`,
          },
          body: JSON.stringify({
            parentTaskId,
            blockerId: blocker.id,
            action,
            guidance: action === "retry" ? guidance : undefined,
          }),
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to submit blocker response");
      }

      onResolved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatErrorCategory = (category: string) => {
    const categories: Record<string, { label: string; color: string }> = {
      typescript: { label: "TypeScript", color: "text-blue-500" },
      lint: { label: "Lint", color: "text-yellow-500" },
      test: { label: "Test Failure", color: "text-red-500" },
      build: { label: "Build", color: "text-orange-500" },
      auth: { label: "Authentication", color: "text-purple-500" },
      network: { label: "Network", color: "text-gray-500" },
      resource: { label: "Resource", color: "text-red-600" },
      unknown: { label: "Unknown", color: "text-gray-400" },
    };
    return categories[category] || categories.unknown;
  };

  const categoryInfo = formatErrorCategory(blocker.errorCategory);
  const timeSinceCreated = getTimeSince(blocker.createdAt);

  return (
    <div className="bg-red-500/10 border border-red-500/30 rounded-lg overflow-hidden" data-testid="blocker-alert">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-red-500/5"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">
                Story {blocker.storyIndex} Blocked
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full bg-opacity-20 ${categoryInfo.color}`}
              >
                {categoryInfo.label}
              </span>
            </div>
            <p className="text-sm text-muted-foreground truncate max-w-md">
              {blocker.storyTitle}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            {timeSinceCreated}
          </div>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4">
          {/* Summary - shown prominently */}
          {blocker.summary && (
            <div className="bg-background/50 rounded-md p-3">
              <h4 className="text-xs font-medium text-muted-foreground mb-2">
                What Went Wrong
              </h4>
              <div className="text-sm text-foreground whitespace-pre-wrap prose prose-sm dark:prose-invert max-w-none">
                {blocker.summary.split('\n').map((line, i) => (
                  <p key={i} className="mb-2 last:mb-0">
                    {line.startsWith('**') ? (
                      <strong>{line.replace(/\*\*/g, '')}</strong>
                    ) : line}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Full Error Details - collapsible */}
          <div className="bg-background/50 rounded-md p-3">
            <button
              onClick={() => setShowFullError(!showFullError)}
              className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground w-full"
            >
              {showFullError ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
              Technical Details
              {!showFullError && blocker.errorMessage.length > 100 && (
                <span className="text-muted-foreground/60">
                  ({Math.ceil(blocker.errorMessage.length / 100)} lines)
                </span>
              )}
            </button>
            {showFullError && (
              <pre className="mt-2 text-sm text-foreground whitespace-pre-wrap font-mono bg-background p-2 rounded border border-border overflow-x-auto max-h-60">
                {blocker.errorMessage}
              </pre>
            )}
          </div>

          {/* Affected Files */}
          {blocker.affectedFiles.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                <FileCode className="w-3 h-3" />
                Affected Files
              </h4>
              <div className="flex flex-wrap gap-2">
                {blocker.affectedFiles.map((file, idx) => (
                  <span
                    key={idx}
                    className="text-xs px-2 py-1 bg-background rounded border border-border font-mono"
                  >
                    {file}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Dependent Stories */}
          {blocker.dependentStories.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                <GitBranch className="w-3 h-3" />
                Blocked Stories
              </h4>
              <p className="text-sm text-yellow-500">
                Stories {blocker.dependentStories.join(", ")} are waiting on
                this story to complete
              </p>
            </div>
          )}

          {/* Retry Info */}
          <div className="text-xs text-muted-foreground">
            Auto-retry attempts: {blocker.autoRetryAttempts} /{" "}
            {blocker.maxAutoRetries}
          </div>

          {/* Guidance Input */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2">
              Guidance for Retry (optional)
            </label>
            <textarea
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
              placeholder="Provide additional context or instructions for the retry attempt..."
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder-muted-foreground text-sm resize-none"
              rows={2}
            />
          </div>

          {/* Error Display */}
          {error && (
            <div className="text-sm text-red-500 bg-red-500/10 px-3 py-2 rounded">
              {error}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => handleAction("retry")}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
              data-testid="blocker-retry"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4" />
              )}
              Retry Story
            </button>

            <button
              onClick={() => handleAction("skip")}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-4 py-2 bg-yellow-500/20 text-yellow-500 rounded-md hover:bg-yellow-500/30 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
              data-testid="blocker-skip"
            >
              <SkipForward className="w-4 h-4" />
              Skip Story
            </button>

            <button
              onClick={() => handleAction("abort")}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-4 py-2 bg-red-500/20 text-red-500 rounded-md hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
              data-testid="blocker-abort"
            >
              <StopCircle className="w-4 h-4" />
              Abort Epic
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function getTimeSince(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export default BlockerAlert;

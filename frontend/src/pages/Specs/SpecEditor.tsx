import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  RefreshCw,
  Sparkles,
  Rocket,
  Clock,
  Check,
  Pencil,
} from "lucide-react";
import { useSpecsStore } from "../../store/specs-store";
import apiClient from "../../lib/api-client";
import QualityScorePanel from "./QualityScorePanel";

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  draft: {
    label: "Draft",
    className: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  },
  validated: {
    label: "Validated",
    className: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  },
  decomposed: {
    label: "Decomposed",
    className: "bg-green-500/10 text-green-400 border-green-500/20",
  },
  archived: {
    label: "Archived",
    className: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  },
};

export default function SpecEditor() {
  const { specId } = useParams<{ specId: string }>();
  const navigate = useNavigate();

  const {
    currentSpec,
    versions,
    isLoading,
    isScoring,
    error,
    fetchSpec,
    updateSpec,
    scoreSpec,
    fetchVersions,
  } = useSpecsStore();

  // Local editor state
  const [content, setContent] = useState("");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [decomposeError, setDecomposeError] = useState<string | null>(null);
  const [isDecomposing, setIsDecomposing] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Load spec and versions on mount
  useEffect(() => {
    if (specId) {
      fetchSpec(specId);
      fetchVersions(specId);
    }
  }, [specId, fetchSpec, fetchVersions]);

  // Sync local content when spec loads
  useEffect(() => {
    if (currentSpec) {
      setContent(currentSpec.content ?? "");
      setTitleDraft(currentSpec.title);
    }
  }, [currentSpec]);

  // Auto-save content with debounce
  const debouncedSave = useCallback(
    (newContent: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        if (!specId) return;
        try {
          setIsSaving(true);
          await updateSpec(specId, { content: newContent });
          setLastSaved(new Date());
        } catch {
          // handled by store
        } finally {
          setIsSaving(false);
        }
      }, 2000);
    },
    [specId, updateSpec],
  );

  const handleContentChange = (value: string) => {
    setContent(value);
    debouncedSave(value);
  };

  // Title editing
  const startEditingTitle = () => {
    setIsEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  };

  const saveTitle = async () => {
    setIsEditingTitle(false);
    if (!specId || !titleDraft.trim() || titleDraft === currentSpec?.title)
      return;
    try {
      await updateSpec(specId, { title: titleDraft.trim() });
    } catch {
      // revert on error
      if (currentSpec) setTitleDraft(currentSpec.title);
    }
  };

  // Score handler
  const handleScore = async () => {
    if (!specId) return;
    try {
      await scoreSpec(specId);
    } catch {
      // handled by store
    }
  };

  // Decompose handler
  const handleDecompose = async () => {
    if (!specId || !currentSpec?.qualityScore) return;
    setDecomposeError(null);
    setIsDecomposing(true);
    try {
      const response = await apiClient.post("/prd/decompose", { specId });
      const boardId = response.data?.boardId ?? response.data?.board?.id;
      if (boardId) {
        navigate(`/boards/${boardId}`);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to decompose spec";
      setDecomposeError(message);
    } finally {
      setIsDecomposing(false);
    }
  };

  if (isLoading && !currentSpec) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!currentSpec) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-muted-foreground mb-4">
            Spec not found
          </p>
          <button
            onClick={() => navigate("/specs")}
            className="text-violet-400 hover:text-violet-300 transition-colors"
          >
            Back to Specs
          </button>
        </div>
      </div>
    );
  }

  const badge = STATUS_BADGES[currentSpec.status] ?? STATUS_BADGES.draft;
  const canDecompose = currentSpec.qualityScore != null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <header className="border-b border-border/30 glass-strong sticky top-0 z-10">
        <div className="max-w-full mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4 min-w-0">
            <button
              onClick={() => navigate("/specs")}
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="text-sm">Specs</span>
            </button>
            <div className="h-6 w-px bg-border shrink-0" />

            {/* Editable title */}
            {isEditingTitle ? (
              <input
                ref={titleInputRef}
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveTitle();
                  if (e.key === "Escape") {
                    setIsEditingTitle(false);
                    if (currentSpec) setTitleDraft(currentSpec.title);
                  }
                }}
                className="text-lg font-semibold bg-transparent border-b-2 border-violet-500 outline-none text-foreground min-w-0"
              />
            ) : (
              <button
                onClick={startEditingTitle}
                className="flex items-center gap-2 text-lg font-semibold text-foreground hover:text-violet-400 transition-colors truncate min-w-0"
                title="Click to edit title"
              >
                <span className="truncate">{currentSpec.title}</span>
                <Pencil className="w-3.5 h-3.5 opacity-50 shrink-0" />
              </button>
            )}

            {/* Status badge */}
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border shrink-0 ${badge.className}`}
            >
              {badge.label}
            </span>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={handleScore}
              disabled={isScoring}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isScoring ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {isScoring ? "Scoring..." : "Score"}
            </button>
            <button
              onClick={handleDecompose}
              disabled={!canDecompose || isDecomposing}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title={
                !canDecompose ? "Score the spec first before decomposing" : ""
              }
            >
              {isDecomposing ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Rocket className="w-4 h-4" />
              )}
              {isDecomposing ? "Decomposing..." : "Decompose"}
            </button>
          </div>
        </div>
      </header>

      {/* Error banners */}
      {error && (
        <div className="mx-6 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-sm">
          {error}
        </div>
      )}
      {decomposeError && (
        <div className="mx-6 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-sm">
          {decomposeError}
        </div>
      )}

      {/* Two-panel layout */}
      <div className="flex-1 flex min-h-0">
        {/* Left panel — editor (60%) */}
        <div className="w-[60%] flex flex-col border-r border-border/30">
          {/* Editor toolbar */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-border/20 bg-muted/20">
            <span className="text-xs text-muted-foreground">
              v{currentSpec.version}
            </span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              {isSaving ? (
                <>
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  Saving...
                </>
              ) : lastSaved ? (
                <>
                  <Check className="w-3 h-3 text-green-500" />
                  Saved{" "}
                  {lastSaved.toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </>
              ) : null}
            </span>
          </div>

          {/* Textarea */}
          <textarea
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            className="flex-1 w-full p-6 bg-transparent text-foreground font-mono text-sm resize-none outline-none placeholder:text-muted-foreground/40"
            placeholder="Write your specification here..."
            spellCheck={false}
          />
        </div>

        {/* Right panel — score + versions (40%) */}
        <div className="w-[40%] overflow-y-auto p-6 space-y-6">
          <QualityScorePanel spec={currentSpec} />

          {/* Version history */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">
              Version History
            </h3>
            {versions.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No previous versions
              </p>
            ) : (
              <div className="space-y-2">
                {versions.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-muted/30 transition-colors"
                  >
                    <span className="text-sm text-foreground">
                      v{v.version}
                    </span>
                    <div className="flex items-center gap-3">
                      {v.qualityScore != null && (
                        <span className="text-xs text-muted-foreground">
                          Score: {v.qualityScore}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(v.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

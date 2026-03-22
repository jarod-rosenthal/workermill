import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  X,
  FileText,
  Upload,
  Globe,
  GitBranch,
  Loader2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ExternalLink,
  Wrench,
  ArrowRight,
  Undo2,
  Check,
} from "lucide-react";
import type { CreateBoardData } from "../../lib/boards-api";
import {
  decomposePrdStreaming,
  proceedDecomposition,
  confirmFix,
  type DecomposeResult,
  type DependencyWarning,
  type DecompositionStreamEvent,
} from "../../lib/boards-api";

type DialogMode = "template" | "prd";
type PrdSource = "text" | "file" | "url" | "repo";
type PrdState = "input" | "loading" | "review" | "repairing" | "repair_review" | "success" | "error";

interface CreateBoardDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (data: CreateBoardData) => Promise<void>;
}

const TEMPLATES: {
  value: CreateBoardData["template"];
  label: string;
  description: string;
}[] = [
  {
    value: "empty",
    label: "Empty Board",
    description: "Start from scratch with no columns",
  },
  {
    value: "project",
    label: "Project Board",
    description: "To Do, In Progress, Review, Done",
  },
  {
    value: "bug_tracker",
    label: "Bug Tracker",
    description: "New, Triaging, In Fix, Testing, Resolved",
  },
];

const SOURCE_OPTIONS: {
  value: PrdSource;
  label: string;
  icon: typeof FileText;
}[] = [
  { value: "text", label: "Paste Text", icon: FileText },
  { value: "file", label: "Upload File", icon: Upload },
  { value: "url", label: "From URL", icon: Globe },
  { value: "repo", label: "From Repo", icon: GitBranch },
];

function autoDerivePrefix(boardName: string): string {
  const words = boardName
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[\s\-_]+/)
    .filter(Boolean);
  if (words.length >= 2) {
    return words
      .slice(0, 5)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  }
  const word = words[0] || "";
  if (word.length <= 3) return word.toUpperCase();
  return word.substring(0, 3).toUpperCase();
}

export default function CreateBoardDialog({
  open,
  onClose,
  onCreate,
}: CreateBoardDialogProps) {
  const navigate = useNavigate();

  // -- Shared state --
  const [mode, setMode] = useState<DialogMode>("template");
  const [error, setError] = useState<string | null>(null);

  // -- Template mode state --
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [prefixManuallyEdited, setPrefixManuallyEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [template, setTemplate] =
    useState<CreateBoardData["template"]>("project");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // -- PRD mode state --
  const [prdSource, setPrdSource] = useState<PrdSource>("text");
  const [prdState, setPrdState] = useState<PrdState>("input");
  const [prdContent, setPrdContent] = useState("");
  const [prdUrl, setPrdUrl] = useState("");
  const [prdRepo, setPrdRepo] = useState("");
  const [prdRepoPath, setPrdRepoPath] = useState("");
  const [prdBoardName, setPrdBoardName] = useState("");
  const [prdResult, setPrdResult] = useState<DecomposeResult | null>(null);
  const [streamText, setStreamText] = useState("");
  const [streamPhase, setStreamPhase] = useState("");
  const [streamChars, setStreamChars] = useState(0);
  const [specWarnings, setSpecWarnings] = useState<DependencyWarning[]>([]);
  const [specDiff, setSpecDiff] = useState("");
  const [decompositionId, setDecompositionId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamContainerRef = useRef<HTMLPreElement>(null);

  // Auto-scroll streaming text to bottom
  useEffect(() => {
    if (streamContainerRef.current) {
      streamContainerRef.current.scrollTop =
        streamContainerRef.current.scrollHeight;
    }
  }, [streamText]);

  if (!open) return null;

  const resetAll = () => {
    setMode("template");
    setError(null);
    setName("");
    setPrefix("");
    setPrefixManuallyEdited(false);
    setDescription("");
    setTemplate("project");
    setIsSubmitting(false);
    setPrdSource("text");
    setPrdState("input");
    setPrdContent("");
    setPrdUrl("");
    setPrdRepo("");
    setPrdRepoPath("");
    setPrdBoardName("");
    setPrdResult(null);
    setStreamText("");
    setStreamPhase("");
    setStreamChars(0);
    setSpecWarnings([]);
    setSpecDiff("");
    setDecompositionId(null);
  };

  const handleClose = () => {
    resetAll();
    onClose();
  };

  // -- Template submit --
  const handleTemplateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Board name is required");
      return;
    }

    setIsSubmitting(true);
    try {
      await onCreate({
        name: name.trim(),
        description: description.trim() || undefined,
        prefix: prefix || undefined,
        template,
      });
      resetAll();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create board",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // -- PRD file handler --
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      setPrdContent((ev.target?.result as string) || "");
    };
    reader.readAsText(file);
    // Reset the input so the same file can be selected again
    e.target.value = "";
  };

  // -- PRD decompose --
  const handleDecompose = async () => {
    setError(null);
    setStreamText("");
    setStreamPhase("");
    setStreamChars(0);

    // Validate inputs
    if (prdSource === "text" && !prdContent.trim()) {
      setError("Please paste your spec content");
      return;
    }
    if (prdSource === "file" && !prdContent.trim()) {
      setError("Please upload a file first");
      return;
    }
    if (prdSource === "url" && !prdUrl.trim()) {
      setError("Please enter a URL");
      return;
    }
    if (prdSource === "repo" && !prdRepo.trim()) {
      setError("Please enter a repository (owner/repo)");
      return;
    }

    setPrdState("loading");
    const newDecompositionId = crypto.randomUUID();
    setDecompositionId(newDecompositionId);
    try {
      const payload: Parameters<typeof decomposePrdStreaming>[0] = {
        source: prdSource,
        boardName: prdBoardName.trim() || undefined,
      };

      if (prdSource === "text" || prdSource === "file") {
        payload.content = prdContent;
      } else if (prdSource === "url") {
        payload.fileUrl = prdUrl.trim();
      } else if (prdSource === "repo") {
        payload.githubRepo = prdRepo.trim();
        payload.repoPath = prdRepoPath.trim() || undefined;
      }

      const result = await decomposePrdStreaming(payload, (event: DecompositionStreamEvent) => {
        // Capture decompositionId for later /proceed and /confirm-fix calls
        if (event.phase) {
          setStreamPhase(event.phase);
        }
        if (event.text) {
          setStreamText((prev) => prev + event.text);
        }
        if (event.charsGenerated != null) {
          setStreamChars(event.charsGenerated);
        }

        // Spec validation gate: pause on warnings
        if (event.phase === "spec_review" && event.warnings) {
          setSpecWarnings(event.warnings);
          setPrdState("review");
        }
        // Repair streaming text
        if (event.phase === "repairing_spec") {
          setPrdState("repairing");
        }
        // Repair complete: show diff
        if (event.phase === "repair_complete" && event.diff) {
          setSpecDiff(event.diff);
          if (event.warnings) setSpecWarnings(event.warnings);
          setPrdState("repair_review");
        }
      }, newDecompositionId);
      setPrdResult(result);
      setPrdState("success");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to decompose spec",
      );
      setPrdState("error");
    }
  };

  const handleViewBoard = () => {
    if (prdResult) {
      resetAll();
      onClose();
      navigate(`/boards/${prdResult.boardId}`);
    }
  };

  const handleRetry = () => {
    setError(null);
    setPrdState("input");
  };

  // -- Spec validation gate handlers --
  const handleProceedAnyway = async () => {
    if (!decompositionId) return;
    setPrdState("loading");
    setStreamPhase("calling_llm");
    setStreamText("");
    try {
      await proceedDecomposition(decompositionId, "proceed");
      // SSE continues — the onEvent callback will handle the rest
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to proceed");
      setPrdState("error");
    }
  };

  const handleFixIssues = async () => {
    if (!decompositionId) return;
    setPrdState("repairing");
    setStreamText("");
    try {
      await proceedDecomposition(decompositionId, "fix");
      // SSE continues — repair_complete will fire via onEvent
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start repair");
      setPrdState("error");
    }
  };

  const handleAcceptFix = async () => {
    if (!decompositionId) return;
    setPrdState("loading");
    setStreamPhase("calling_llm");
    setStreamText("");
    try {
      await confirmFix(decompositionId, "accept");
      // SSE continues — complete will fire via onEvent
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept fix");
      setPrdState("error");
    }
  };

  const handleRejectFix = async () => {
    if (!decompositionId) return;
    try {
      await confirmFix(decompositionId, "reject");
      // SSE will re-emit spec_review — onEvent callback handles it
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject fix");
      setPrdState("error");
    }
  };

  // -- Tab styling --
  const tabClass = (active: boolean) =>
    `flex-1 py-2 text-sm font-medium text-center rounded-lg transition-colors ${
      active
        ? "bg-primary text-primary-foreground"
        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
    }`;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-xl border border-border w-full max-w-lg p-6 mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Create New Board</h2>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-1 p-1 rounded-lg bg-muted/50 mb-4">
          <button
            type="button"
            className={tabClass(mode === "template")}
            onClick={() => {
              setMode("template");
              setError(null);
            }}
          >
            New Board
          </button>
          <button
            type="button"
            className={tabClass(mode === "prd")}
            onClick={() => {
              setMode("prd");
              setError(null);
            }}
          >
            Full Build
          </button>
        </div>

        {/* Error display */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Template mode */}
        {mode === "template" && (
          <form onSubmit={handleTemplateSubmit}>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Board Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!prefixManuallyEdited) {
                      setPrefix(autoDerivePrefix(e.target.value));
                    }
                  }}
                  placeholder="e.g., Sprint 42"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                  autoFocus
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Key Prefix
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={prefix}
                    onChange={(e) => {
                      setPrefix(
                        e.target.value
                          .toUpperCase()
                          .replace(/[^A-Z0-9]/g, "")
                          .slice(0, 10),
                      );
                      setPrefixManuallyEdited(true);
                    }}
                    placeholder="e.g., CM"
                    maxLength={10}
                    className="w-24 px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 uppercase"
                  />
                  <span className="text-sm text-muted-foreground">
                    Cards: {prefix || "XX"}-1, {prefix || "XX"}-2, ...
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Description (optional)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this board for?"
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Template
                </label>
                <div className="space-y-2">
                  {TEMPLATES.map((t) => (
                    <label
                      key={t.value}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        template === t.value
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="template"
                        value={t.value}
                        checked={template === t.value}
                        onChange={() => setTemplate(t.value)}
                        className="mt-0.5 accent-primary"
                      />
                      <div>
                        <div className="text-sm font-medium">{t.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {t.description}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isSubmitting ? "Creating..." : "Create Board"}
              </button>
            </div>
          </form>
        )}

        {/* PRD mode */}
        {mode === "prd" && (
          <div>
            {/* Loading / streaming state */}
            {(prdState === "loading" || prdState === "repairing") && (
              <div className="flex flex-col py-4">
                {/* Phase indicator */}
                <div className="flex items-center gap-2 mb-3">
                  <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                  <span className="text-sm font-medium text-foreground">
                    {streamPhase === "resolving_content" && "Resolving content..."}
                    {streamPhase === "validating_spec" && "Checking for dependency issues..."}
                    {streamPhase === "calling_llm" && "Calling LLM..."}
                    {streamPhase === "streaming" && "Streaming response..."}
                    {streamPhase === "repairing_spec" && "Repairing spec..."}
                    {streamPhase === "parsing" && "Parsing JSON..."}
                    {streamPhase === "creating_board" && "Creating board..."}
                    {!streamPhase && "Decomposing spec into cards..."}
                  </span>
                  {streamChars > 0 && (
                    <span className="text-xs text-muted-foreground ml-auto tabular-nums">
                      {streamChars.toLocaleString()} chars
                    </span>
                  )}
                </div>

                {/* Streaming text display */}
                {streamText ? (
                  <pre
                    ref={streamContainerRef}
                    className="rounded-lg bg-muted/50 border border-border p-3 text-xs text-muted-foreground font-mono whitespace-pre-wrap break-words max-h-60 overflow-y-auto"
                  >
                    {streamText}
                  </pre>
                ) : (
                  <div className="flex items-center justify-center py-8">
                    <p className="text-xs text-muted-foreground">
                      Waiting for response...
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Spec review state — warnings found */}
            {prdState === "review" && specWarnings.length > 0 && (
              <div className="flex flex-col py-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
                  <h3 className="text-sm font-semibold">
                    {specWarnings.length} issue{specWarnings.length !== 1 ? "s" : ""} found in your spec
                  </h3>
                </div>

                <div className="space-y-2 mb-4 max-h-60 overflow-y-auto">
                  {specWarnings.map((w, i) => (
                    <div
                      key={i}
                      className={`p-3 rounded-lg border text-sm ${
                        w.severity === "error"
                          ? "bg-red-500/10 border-red-500/30"
                          : "bg-amber-500/10 border-amber-500/30"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-medium uppercase px-1.5 py-0.5 rounded ${
                          w.severity === "error"
                            ? "bg-red-500/20 text-red-500"
                            : "bg-amber-500/20 text-amber-500"
                        }`}>
                          {w.severity}
                        </span>
                        <span className="text-xs text-muted-foreground font-mono">
                          {w.category}
                        </span>
                      </div>
                      <p className="text-foreground mb-1">{w.message}</p>
                      <p className="text-muted-foreground text-xs">{w.suggestion}</p>
                      {w.affectedPackages.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {w.affectedPackages.map((pkg) => (
                            <span key={pkg} className="text-xs font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              {pkg}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-3 py-2 rounded-lg border border-border hover:bg-muted transition-colors text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleProceedAnyway}
                    className="px-3 py-2 rounded-lg border border-border hover:bg-muted transition-colors text-sm flex items-center gap-1.5"
                  >
                    Proceed Anyway
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleFixIssues}
                    className="px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm flex items-center gap-1.5"
                  >
                    <Wrench className="w-3.5 h-3.5" />
                    Fix Issues
                  </button>
                </div>
              </div>
            )}

            {/* Repair review state — show diff */}
            {prdState === "repair_review" && (
              <div className="flex flex-col py-4">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                  <h3 className="text-sm font-semibold">
                    Spec repaired — review changes
                  </h3>
                </div>

                <pre className="rounded-lg bg-muted/50 border border-border p-3 text-xs font-mono whitespace-pre-wrap break-words max-h-60 overflow-y-auto mb-4">
                  {specDiff.split("\n").map((line, i) => {
                    let lineClass = "text-muted-foreground";
                    if (line.startsWith("+") && !line.startsWith("+++")) lineClass = "text-green-500";
                    else if (line.startsWith("-") && !line.startsWith("---")) lineClass = "text-red-500";
                    else if (line.startsWith("@@")) lineClass = "text-blue-400";
                    return (
                      <div key={i} className={lineClass}>
                        {line}
                      </div>
                    );
                  })}
                </pre>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleRejectFix}
                    className="px-3 py-2 rounded-lg border border-border hover:bg-muted transition-colors text-sm flex items-center gap-1.5"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={handleAcceptFix}
                    className="px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm flex items-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Accept &amp; Build
                  </button>
                </div>
              </div>
            )}

            {/* Success state */}
            {prdState === "success" && prdResult && (
              <div className="flex flex-col items-center py-8">
                <CheckCircle2 className="w-12 h-12 text-green-500 mb-4" />
                <h3 className="text-lg font-semibold mb-1">
                  Board Created
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {prdResult.boardName}
                </p>
                <div className="text-sm text-muted-foreground mb-6 text-center space-y-1">
                  <p>
                    {prdResult.cardCount} card
                    {prdResult.cardCount !== 1 ? "s" : ""} created with
                    prefix{" "}
                    <span className="font-mono text-foreground">
                      {prdResult.prefix}
                    </span>
                  </p>
                  {prdResult.trackerSync && (
                    <p className="text-xs">
                      Synced {prdResult.trackerSync.synced} issue
                      {prdResult.trackerSync.synced !== 1 ? "s" : ""} to{" "}
                      {prdResult.trackerSync.tracker}
                      {prdResult.trackerSync.failed > 0 && (
                        <span className="text-amber-500">
                          {" "}
                          ({prdResult.trackerSync.failed} failed)
                        </span>
                      )}
                    </p>
                  )}
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={handleViewBoard}
                    className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2"
                  >
                    View Board
                    <ExternalLink className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Error state */}
            {prdState === "error" && (
              <div className="flex flex-col items-center py-8">
                <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
                <h3 className="text-lg font-semibold mb-2">
                  Decomposition Failed
                </h3>
                <p className="text-sm text-muted-foreground mb-6 text-center max-w-sm">
                  {error || "An unexpected error occurred"}
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Try Again
                  </button>
                </div>
              </div>
            )}

            {/* Input state */}
            {prdState === "input" && (
              <>
                {/* Source selector */}
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2">
                    Source
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {SOURCE_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setPrdSource(opt.value)}
                          className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border text-xs font-medium transition-colors ${
                            prdSource === opt.value
                              ? "border-primary bg-primary/5 text-primary"
                              : "border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Content area */}
                <div className="space-y-4">
                  {/* Paste Text */}
                  {prdSource === "text" && (
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Spec Content
                      </label>
                      <textarea
                        value={prdContent}
                        onChange={(e) => setPrdContent(e.target.value)}
                        placeholder="Paste your spec or requirements here..."
                        rows={8}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none font-mono text-sm"
                        autoFocus
                      />
                    </div>
                  )}

                  {/* Upload File */}
                  {prdSource === "file" && (
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Upload Markdown File
                      </label>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".md,.markdown,.txt"
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full px-4 py-8 rounded-lg border-2 border-dashed border-border hover:border-primary/50 hover:bg-muted/30 transition-colors flex flex-col items-center gap-2"
                      >
                        <Upload className="w-6 h-6 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          Click to select a .md file
                        </span>
                      </button>
                      {prdContent && (
                        <div className="mt-2 p-2 rounded-lg bg-muted/50 text-xs text-muted-foreground">
                          File loaded ({prdContent.length.toLocaleString()}{" "}
                          characters)
                        </div>
                      )}
                    </div>
                  )}

                  {/* From URL */}
                  {prdSource === "url" && (
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Spec URL
                      </label>
                      <input
                        type="url"
                        value={prdUrl}
                        onChange={(e) => setPrdUrl(e.target.value)}
                        placeholder="https://example.com/prd.md"
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                        autoFocus
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        URL to a publicly accessible markdown file
                      </p>
                    </div>
                  )}

                  {/* From Repo */}
                  {prdSource === "repo" && (
                    <>
                      <div>
                        <label className="block text-sm font-medium mb-1">
                          Repository
                        </label>
                        <input
                          type="text"
                          value={prdRepo}
                          onChange={(e) => setPrdRepo(e.target.value)}
                          placeholder="owner/repo"
                          className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                          autoFocus
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">
                          File Path (optional)
                        </label>
                        <input
                          type="text"
                          value={prdRepoPath}
                          onChange={(e) => setPrdRepoPath(e.target.value)}
                          placeholder="docs/spec.md"
                          className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Path to the spec file in the repository. Defaults to
                          README.md.
                        </p>
                      </div>
                    </>
                  )}

                  {/* Board name override */}
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Board Name (optional)
                    </label>
                    <input
                      type="text"
                      value={prdBoardName}
                      onChange={(e) => setPrdBoardName(e.target.value)}
                      placeholder="Auto-derived from spec title"
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-3 mt-6">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDecompose}
                    className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Decompose
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

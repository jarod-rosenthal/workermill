import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { X, Loader2, AlertCircle } from "lucide-react";
import { useSpecsStore } from "../../store/specs-store";

interface CreateSpecDialogProps {
  onClose: () => void;
}

export default function CreateSpecDialog({ onClose }: CreateSpecDialogProps) {
  const navigate = useNavigate();
  const { templates, fetchTemplates, createSpec } = useSpecsStore();

  const [title, setTitle] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const selectedTemplate = selectedTemplateId
    ? templates.find((t) => t.id === selectedTemplateId)
    : null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    setIsCreating(true);
    try {
      const spec = await createSpec({
        title: title.trim(),
        templateId: selectedTemplateId ?? undefined,
        content: selectedTemplate?.content,
      });
      onClose();
      navigate(`/specs/${spec.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create spec");
    } finally {
      setIsCreating(false);
    }
  };

  // Preview: first 3 lines of template content
  const contentPreview = selectedTemplate
    ? selectedTemplate.content.split("\n").slice(0, 3).join("\n")
    : null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-xl border border-border w-full max-w-lg p-6 mx-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">New Specification</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleCreate} className="space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., User Authentication System"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              required
              autoFocus
            />
          </div>

          {/* Template selector */}
          <div>
            <label className="block text-sm font-medium mb-1">Template</label>
            <select
              value={selectedTemplateId ?? ""}
              onChange={(e) =>
                setSelectedTemplateId(e.target.value || null)
              }
              className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/50"
            >
              <option value="">Blank</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.isPublic ? " (public)" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Template preview */}
          {contentPreview && (
            <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
              <p className="text-xs font-medium text-muted-foreground mb-1.5">
                Template preview
              </p>
              <pre className="text-xs text-foreground/70 whitespace-pre-wrap font-mono leading-relaxed">
                {contentPreview}
                {selectedTemplate &&
                  selectedTemplate.content.split("\n").length > 3 && (
                    <span className="text-muted-foreground">...</span>
                  )}
              </pre>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isCreating}
              className="px-4 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors disabled:opacity-50"
            >
              {isCreating ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating...
                </span>
              ) : (
                "Create Spec"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

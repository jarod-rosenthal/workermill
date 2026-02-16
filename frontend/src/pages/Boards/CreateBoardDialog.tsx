import { useState } from "react";
import { X } from "lucide-react";
import type { CreateBoardData } from "../../lib/boards-api";

interface CreateBoardDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (data: CreateBoardData) => Promise<void>;
}

const TEMPLATES: { value: CreateBoardData["template"]; label: string; description: string }[] = [
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
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [prefixManuallyEdited, setPrefixManuallyEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState<CreateBoardData["template"]>("project");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
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
      setName("");
      setPrefix("");
      setPrefixManuallyEdited(false);
      setDescription("");
      setTemplate("project");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create board");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-xl border border-border w-full max-w-md p-6 mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Create New Board</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Board Name</label>
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
              <label className="block text-sm font-medium mb-1">Key Prefix</label>
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
              <label className="block text-sm font-medium mb-1">Description (optional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this board for?"
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Template</label>
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
                      <div className="text-xs text-muted-foreground">{t.description}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button
              type="button"
              onClick={onClose}
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
      </div>
    </div>
  );
}

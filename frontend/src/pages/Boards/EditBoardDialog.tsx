import { useState, useEffect } from "react";
import {
  X,
  Loader2,
  AlertCircle,
  Calendar,
  Shield,
  Plus,
  Trash2,
} from "lucide-react";
import type {
  Board,
  UpdateBoardData,
  BoardPriority,
  BoardStatus,
  QualityGate,
  OrgMember,
} from "../../lib/boards-api";
import { getOrgMembers } from "../../lib/boards-api";

interface EditBoardDialogProps {
  open: boolean;
  board: Board | null;
  onClose: () => void;
  onSave: (boardId: string, data: UpdateBoardData) => Promise<void>;
}

const PRIORITY_OPTIONS: { value: BoardPriority | ""; label: string; color: string }[] = [
  { value: "", label: "No priority", color: "" },
  { value: "urgent", label: "Urgent", color: "bg-red-500" },
  { value: "high", label: "High", color: "bg-orange-500" },
  { value: "medium", label: "Medium", color: "bg-yellow-500" },
  { value: "low", label: "Low", color: "bg-blue-500" },
];

const STATUS_OPTIONS: { value: BoardStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
];

export default function EditBoardDialog({
  open,
  board,
  onClose,
  onSave,
}: EditBoardDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<BoardPriority | "">("");
  const [dueDate, setDueDate] = useState("");
  const [assigneeId, setAssigneeId] = useState<string | "">("");
  const [status, setStatus] = useState<BoardStatus>("active");
  const [ciWorkflowPath, setCiWorkflowPath] = useState("");
  const [qualityGates, setQualityGates] = useState<QualityGate[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load board data when dialog opens
  useEffect(() => {
    if (open && board) {
      setName(board.name);
      setDescription(board.description || "");
      setPriority(board.priority || "");
      setDueDate(board.dueDate ? board.dueDate.split("T")[0] : "");
      setAssigneeId(board.assigneeId || "");
      setStatus(board.status || "active");
      setCiWorkflowPath(board.ciWorkflowPath || "");
      setQualityGates(board.qualityGateCommands || []);
      setError(null);

      // Fetch org members for assignee dropdown
      getOrgMembers().then(setMembers).catch(() => {});
    }
  }, [open, board]);

  if (!open || !board) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Board name is required");
      return;
    }

    setIsSaving(true);
    try {
      const data: UpdateBoardData = {
        name: name.trim(),
        description: description.trim() || null,
        priority: priority || null,
        dueDate: dueDate || null,
        assigneeId: assigneeId || null,
        status,
        ciWorkflowPath: ciWorkflowPath.trim() || null,
        qualityGateCommands: qualityGates.length > 0 ? qualityGates : null,
      };
      await onSave(board.id, data);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  const addQualityGate = () => {
    setQualityGates([...qualityGates, { name: "", trigger: "", commands: [""] }]);
  };

  const removeQualityGate = (idx: number) => {
    setQualityGates(qualityGates.filter((_, i) => i !== idx));
  };

  const updateGateField = (idx: number, field: keyof QualityGate, value: string | string[]) => {
    setQualityGates(qualityGates.map((g, i) => (i === idx ? { ...g, [field]: value } : g)));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-xl border border-border w-full max-w-lg p-6 mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Edit Epic</h2>
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

        <form onSubmit={handleSave} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Epic description..."
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            />
          </div>

          {/* Row: Status + Priority */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as BoardStatus)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as BoardPriority | "")}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Row: Due Date + Assignee */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                Due Date
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Assignee</label>
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.email}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* CI/CD Section */}
          <div className="border-t border-border/50 pt-4 mt-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
              <Shield className="w-4 h-4" />
              CI / Quality Gates
            </h3>

            <div className="mb-3">
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                CI Workflow Path
              </label>
              <input
                type="text"
                value={ciWorkflowPath}
                onChange={(e) => setCiWorkflowPath(e.target.value)}
                placeholder=".github/workflows/ci.yml"
                className="w-full px-3 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Quality Gate Commands
                </label>
                <button
                  type="button"
                  onClick={addQualityGate}
                  className="text-xs text-primary hover:text-primary/80 flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Add Gate
                </button>
              </div>

              {qualityGates.length === 0 && (
                <p className="text-xs text-muted-foreground/60 italic">
                  No quality gates configured
                </p>
              )}

              {qualityGates.map((gate, idx) => (
                <div
                  key={idx}
                  className="mb-3 p-3 rounded-lg border border-border/50 bg-muted/20 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      Gate {idx + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeQualityGate(idx)}
                      className="p-1 hover:bg-red-500/10 rounded text-red-500"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={gate.name}
                      onChange={(e) => updateGateField(idx, "name", e.target.value)}
                      placeholder="Name (e.g., backend)"
                      className="px-2 py-1 text-xs rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
                    />
                    <input
                      type="text"
                      value={gate.trigger}
                      onChange={(e) => updateGateField(idx, "trigger", e.target.value)}
                      placeholder="Trigger (e.g., api/**)"
                      className="px-2 py-1 text-xs rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
                    />
                  </div>
                  <textarea
                    value={gate.commands.join("\n")}
                    onChange={(e) =>
                      updateGateField(idx, "commands", e.target.value.split("\n"))
                    }
                    placeholder="Commands (one per line)"
                    rows={2}
                    className="w-full px-2 py-1 text-xs rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none font-mono"
                  />
                </div>
              ))}
            </div>
          </div>

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
              disabled={isSaving}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {isSaving ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </span>
              ) : (
                "Save Changes"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

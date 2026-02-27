import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Plus,
  Trash2,
  Clock,
  RefreshCw,
  ArrowLeft,
  FileText,
  ExternalLink,
} from "lucide-react";
import { useSpecsStore } from "../../store/specs-store";
import { useAuthStore } from "../../store/auth-store";
import CreateSpecDialog from "./CreateSpecDialog";

const STATUS_BADGES: Record<
  string,
  { label: string; className: string }
> = {
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

function QualityScoreBadge({ score }: { score: number | null }) {
  if (score == null) {
    return <span className="text-muted-foreground">—</span>;
  }
  let color = "text-red-500";
  if (score >= 85) color = "text-green-500";
  else if (score >= 70) color = "text-blue-500";
  else if (score >= 40) color = "text-amber-500";
  return <span className={`font-semibold ${color}`}>{score}</span>;
}

export default function SpecsList() {
  const navigate = useNavigate();
  const { specs, isLoading, error, fetchSpecs, deleteSpec } = useSpecsStore();
  const organization = useAuthStore((state) => state.organization);

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(
    null,
  );

  useEffect(() => {
    fetchSpecs();
  }, [fetchSpecs]);

  const handleDelete = async (id: string) => {
    try {
      await deleteSpec(id);
      setShowDeleteConfirm(null);
    } catch {
      // handled by store
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/30 glass-strong sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/dashboard"
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="text-sm">Back to Dashboard</span>
            </Link>
            <div className="h-6 w-px bg-border" />
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <FileText className="h-5 w-5 text-violet-500" />
              Specifications
              {organization?.name && (
                <span className="text-sm font-normal text-muted-foreground">
                  — {organization.name}
                </span>
              )}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => fetchSpecs()}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
              title="Refresh"
            >
              <RefreshCw
                className={`w-5 h-5 text-muted-foreground ${isLoading ? "animate-spin" : ""}`}
              />
            </button>
            <button
              onClick={() => setShowCreateDialog(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors"
              data-testid="create-spec-btn"
            >
              <Plus className="w-4 h-4" />
              New Spec
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500">
            {error}
          </div>
        )}

        {isLoading && specs.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : specs.length === 0 ? (
          <div className="text-center py-20" data-testid="empty-state">
            <FileText className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">
              No specifications yet
            </h2>
            <p className="text-muted-foreground mb-6">
              Create your first spec to start defining requirements
            </p>
            <button
              onClick={() => setShowCreateDialog(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create Spec
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-border/60 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/40 bg-muted/30">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Title
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Quality
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Template
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Board
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Updated
                  </th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {specs.map((spec) => {
                  const badge = STATUS_BADGES[spec.status] ??
                    STATUS_BADGES.draft;
                  return (
                    <tr
                      key={spec.id}
                      onClick={() => navigate(`/specs/${spec.id}`)}
                      className="border-b border-border/20 hover:bg-muted/20 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium text-foreground hover:text-violet-400 transition-colors">
                          {spec.title}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <QualityScoreBadge score={spec.qualityScore} />
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {spec.templateId ? (
                          <span className="text-foreground/70">
                            {spec.metadata?.templateName as string ?? "Template"}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {spec.boardId ? (
                          <Link
                            to={`/boards/${spec.boardId}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-violet-400 hover:text-violet-300 transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Board
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(spec.updatedAt).toLocaleDateString(
                            "en-US",
                            {
                              month: "short",
                              day: "numeric",
                            },
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowDeleteConfirm(spec.id);
                          }}
                          className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
                          title="Delete spec"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Create dialog */}
      {showCreateDialog && (
        <CreateSpecDialog onClose={() => setShowCreateDialog(false)} />
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-xl border border-border w-full max-w-md p-6 mx-4">
            <h2 className="text-xl font-semibold mb-2">Delete Specification</h2>
            <p className="text-muted-foreground mb-6">
              Are you sure you want to delete this specification? This action
              cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(showDeleteConfirm)}
                className="px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                Delete Spec
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

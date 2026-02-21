import { useState, useEffect } from "react";
import { Loader2, FileText } from "lucide-react";
import { authAPI } from "../lib/api-client";

export function TosModal() {
  const [open, setOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("workermill:tos-required", handler);
    return () => window.removeEventListener("workermill:tos-required", handler);
  }, []);

  const handleAccept = async () => {
    setLoading(true);
    setError(null);
    try {
      await authAPI.acceptTos();
      setOpen(false);
      setAgreed(false);
      window.location.reload();
    } catch {
      setError("Failed to accept Terms of Service. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-xl max-w-md w-full overflow-hidden">
        <div className="p-4 border-b border-border/50 flex items-center gap-2 bg-gradient-to-r from-blue-500/10 to-transparent">
          <FileText className="w-5 h-5 text-blue-500" />
          <h3 className="text-lg font-semibold text-foreground">Updated Terms of Service</h3>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            Our Terms of Service have been updated. Please review and accept
            the new terms to continue using WorkerMill.
          </p>

          <div className="flex gap-3 text-sm">
            <a
              href="/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline"
            >
              Terms of Service
            </a>
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline"
            >
              Privacy Policy
            </a>
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-1 rounded border-border"
            />
            <span className="text-sm text-foreground">
              I have read and agree to the updated Terms of Service and Privacy Policy.
            </span>
          </label>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <div className="p-4 border-t border-border/50 flex justify-end">
          <button
            onClick={handleAccept}
            disabled={!agreed || loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

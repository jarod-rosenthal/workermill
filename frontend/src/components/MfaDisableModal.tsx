import { useState } from "react";
import { X, Loader2, Shield, AlertTriangle, Eye, EyeOff } from "lucide-react";
import { TotpInput } from "./ui/TotpInput";

interface MfaDisableModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  accessToken: string;
}

const API_URL = import.meta.env.VITE_API_URL || "";

export function MfaDisableModal({ isOpen, onClose, onSuccess, accessToken }: MfaDisableModalProps) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleDisable = async () => {
    if (!password) {
      setError("Password is required");
      return;
    }

    if (totpCode.length !== 6) {
      setError("Please enter all 6 digits");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_URL}/api/profile/mfa/disable`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ password, code: totpCode }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to disable MFA");
        return;
      }

      onSuccess();
      onClose();
    } catch {
      setError("Failed to connect to server");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setPassword("");
    setTotpCode("");
    setError(null);
    onClose();
  };

  // Handle enter key to submit
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && password && totpCode.length === 6 && !loading) {
      handleDisable();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-xl max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-border/50 flex items-center justify-between bg-gradient-to-r from-red-500/10 to-transparent">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Shield className="w-5 h-5 text-red-500" />
            Disable Two-Factor Authentication
          </h3>
          <button
            onClick={handleClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6" onKeyDown={handleKeyDown}>
          {/* Warning */}
          <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-amber-500 font-medium">Warning</p>
              <p className="text-sm text-amber-500/80 mt-1">
                Disabling MFA will make your account less secure. You'll only need your password to log in.
              </p>
            </div>
          </div>

          {error && (
            <div className="p-4 text-sm text-red-400 bg-red-500/10 rounded-xl border border-red-500/20">
              {error}
            </div>
          )}

          {/* Password */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">
              Current Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                placeholder="Enter your password"
                className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all pr-12"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* TOTP Code */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">
              Authenticator Code
            </label>
            <p className="text-xs text-muted-foreground mb-3">
              Enter the 6-digit code from your authenticator app
            </p>
            <TotpInput
              value={totpCode}
              onChange={(code) => {
                setTotpCode(code);
                setError(null);
              }}
              disabled={loading}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleClose}
              className="flex-1 py-3 px-4 border border-border rounded-xl hover:bg-muted/50 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleDisable}
              disabled={!password || totpCode.length !== 6 || loading}
              className="flex-1 py-3 px-4 bg-red-500 text-white font-semibold rounded-xl hover:bg-red-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Disabling...
                </>
              ) : (
                "Disable MFA"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

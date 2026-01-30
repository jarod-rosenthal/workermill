import { useState } from "react";
import { X, Loader2, Copy, Check, Shield, Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { TotpInput } from "./ui/TotpInput";

interface MfaSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  accessToken: string;
}

interface SetupData {
  secretCode: string;
  totpUri: string;
  issuer: string;
  accountName: string;
}

const API_URL = import.meta.env.VITE_API_URL || "";

export function MfaSetupModal({ isOpen, onClose, onSuccess, accessToken }: MfaSetupModalProps) {
  const [step, setStep] = useState<"loading" | "scan" | "verify" | "success">("loading");
  const [setupData, setSetupData] = useState<SetupData | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // Start MFA setup when modal opens
  const startSetup = async () => {
    setStep("loading");
    setError(null);

    try {
      const res = await fetch(`${API_URL}/api/profile/mfa/setup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to setup MFA");
        return;
      }

      setSetupData(data);
      setStep("scan");
    } catch {
      setError("Failed to connect to server");
    }
  };

  // Initialize setup on first render when open
  useState(() => {
    if (isOpen) {
      startSetup();
    }
  });

  // Copy secret to clipboard
  const copySecret = async () => {
    if (!setupData?.secretCode) return;

    try {
      await navigator.clipboard.writeText(setupData.secretCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = setupData.secretCode;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Verify TOTP code
  const handleVerify = async () => {
    if (totpCode.length !== 6) {
      setError("Please enter all 6 digits");
      return;
    }

    setVerifying(true);
    setError(null);

    try {
      const res = await fetch(`${API_URL}/api/profile/mfa/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ code: totpCode }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Verification failed");
        setTotpCode("");
        return;
      }

      setStep("success");
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch {
      setError("Failed to verify code");
    } finally {
      setVerifying(false);
    }
  };

  // Handle TOTP code change - auto-submit when complete
  const handleCodeChange = (code: string) => {
    setTotpCode(code);
    setError(null);
  };

  // Handle enter key to submit
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && totpCode.length === 6 && !verifying) {
      handleVerify();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-xl max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-border/50 flex items-center justify-between bg-gradient-to-r from-green-500/10 to-transparent">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Shield className="w-5 h-5 text-green-500" />
            Enable Two-Factor Authentication
          </h3>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6" onKeyDown={handleKeyDown}>
          {step === "loading" && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
              <p className="text-muted-foreground">Setting up MFA...</p>
            </div>
          )}

          {step === "scan" && setupData && (
            <div className="space-y-6">
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 text-muted-foreground mb-4">
                  <Smartphone className="w-5 h-5" />
                  <span>Step 1: Scan QR Code</span>
                </div>
                <p className="text-sm text-muted-foreground mb-6">
                  Scan this QR code with your authenticator app (Google Authenticator, Authy, 1Password, etc.)
                </p>
              </div>

              {/* QR Code */}
              <div className="flex justify-center">
                <div className="p-4 bg-white rounded-xl">
                  <QRCodeSVG
                    value={setupData.totpUri}
                    size={200}
                    level="H"
                    includeMargin={false}
                  />
                </div>
              </div>

              {/* Manual entry */}
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground text-center">
                  Or enter this code manually:
                </p>
                <div className="flex items-center gap-2 bg-muted/30 rounded-lg p-3">
                  <code className="flex-1 text-sm font-mono break-all select-all">
                    {setupData.secretCode}
                  </code>
                  <button
                    onClick={copySecret}
                    className="p-2 hover:bg-muted rounded-lg transition-colors"
                    title="Copy to clipboard"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4 text-muted-foreground" />
                    )}
                  </button>
                </div>
              </div>

              <button
                onClick={() => setStep("verify")}
                className="w-full py-3 px-4 bg-gradient-to-r from-primary to-cyan-400 text-primary-foreground font-semibold rounded-xl hover:shadow-lg hover:shadow-primary/30 transition-all"
              >
                Continue to Verification
              </button>
            </div>
          )}

          {step === "verify" && (
            <div className="space-y-6">
              <div className="text-center">
                <p className="text-sm text-muted-foreground mb-2">
                  Step 2: Verify Setup
                </p>
                <p className="text-sm text-muted-foreground">
                  Enter the 6-digit code from your authenticator app to verify it's working correctly.
                </p>
              </div>

              {error && (
                <div className="p-4 text-sm text-red-400 bg-red-500/10 rounded-xl border border-red-500/20">
                  {error}
                </div>
              )}

              <TotpInput
                value={totpCode}
                onChange={handleCodeChange}
                disabled={verifying}
              />

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setStep("scan");
                    setTotpCode("");
                    setError(null);
                  }}
                  className="flex-1 py-3 px-4 border border-border rounded-xl hover:bg-muted/50 transition-all"
                >
                  Back
                </button>
                <button
                  onClick={handleVerify}
                  disabled={totpCode.length !== 6 || verifying}
                  className="flex-1 py-3 px-4 bg-gradient-to-r from-primary to-cyan-400 text-primary-foreground font-semibold rounded-xl hover:shadow-lg hover:shadow-primary/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {verifying ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    "Enable MFA"
                  )}
                </button>
              </div>
            </div>
          )}

          {step === "success" && (
            <div className="flex flex-col items-center justify-center py-8">
              <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
                <Check className="w-8 h-8 text-green-500" />
              </div>
              <h4 className="text-lg font-semibold text-foreground mb-2">MFA Enabled!</h4>
              <p className="text-sm text-muted-foreground text-center">
                Two-factor authentication has been enabled for your account.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

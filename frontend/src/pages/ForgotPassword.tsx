import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft,
  Sparkles,
  Mail,
  Lock,
  KeyRound,
  Loader2,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import { authAPI } from "../lib/api-client";
import { AxiosError } from "axios";

export default function ForgotPassword() {
  const navigate = useNavigate();

  const [step, setStep] = useState<"request" | "reset">("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [countdown, setCountdown] = useState(3);

  // Handle countdown and redirect after successful reset
  useEffect(() => {
    if (success && countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else if (success && countdown === 0) {
      navigate("/login?reset=true");
    }
  }, [success, countdown, navigate]);

  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email) {
      setError("Please enter your email address.");
      return;
    }

    setIsLoading(true);

    try {
      await authAPI.forgotPassword({ email });
      setStep("reset");
    } catch (err) {
      const axiosError = err as AxiosError<{ error: string }>;
      setError(axiosError.response?.data?.error || "Failed to send reset code. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!code) {
      setError("Please enter the verification code.");
      return;
    }

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsLoading(true);

    try {
      await authAPI.resetPassword({ email, code, newPassword });
      setSuccess(true);
    } catch (err) {
      const axiosError = err as AxiosError<{ error: string }>;
      setError(axiosError.response?.data?.error || "Failed to reset password. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleResendCode() {
    setIsResending(true);
    setError(null);

    try {
      await authAPI.forgotPassword({ email });
    } catch {
      // Silently handle — the API always returns 200
    } finally {
      setIsResending(false);
    }
  }

  // Success state
  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
        <div className="fixed inset-0 bg-grid-pattern pointer-events-none" />
        <div className="fixed inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/10 pointer-events-none" />
        <div className="orb orb-primary w-[400px] h-[400px] top-20 left-[10%]" />
        <div
          className="orb orb-accent w-[300px] h-[300px] bottom-20 right-[10%]"
          style={{ animationDelay: "-3s" }}
        />

        <div className="relative w-full max-w-md">
          <div className="absolute inset-0 bg-gradient-to-r from-green-500/20 to-emerald-500/20 rounded-2xl blur-xl transform scale-105" />

          <div className="relative card-elevated rounded-2xl border border-border/50 overflow-hidden p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">Password Reset!</h2>
            <p className="text-muted-foreground mb-4">
              Your password has been reset successfully. You can now log in with your new password.
            </p>
            <p className="text-sm text-muted-foreground">
              Redirecting to login in{" "}
              <span className="font-semibold text-primary">{countdown}</span> seconds...
            </p>
            <Link to="/login" className="mt-4 inline-block text-sm text-primary hover:underline">
              Go to login now
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background effects */}
      <div className="fixed inset-0 bg-grid-pattern pointer-events-none" />
      <div className="fixed inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/10 pointer-events-none" />
      <div className="orb orb-primary w-[400px] h-[400px] top-20 left-[10%]" />
      <div
        className="orb orb-accent w-[300px] h-[300px] bottom-20 right-[10%]"
        style={{ animationDelay: "-3s" }}
      />

      {/* Back to home link */}
      <Link
        to="/"
        className="absolute top-6 left-6 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Home
      </Link>

      {/* Card */}
      <div className="relative w-full max-w-md">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-accent/20 rounded-2xl blur-xl transform scale-105" />

        <div className="relative card-elevated rounded-2xl border border-border/50 overflow-hidden glow-mixed">
          {/* Header */}
          <div className="p-8 pb-6 text-center border-b border-border/50 bg-gradient-to-b from-muted/30 to-transparent">
            <Link to="/" className="inline-block">
              <h1 className="text-3xl font-bold text-gradient-animated mb-2">WorkerMill</h1>
            </Link>
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <Sparkles className="w-4 h-4 text-primary" />
              <span>AI Workers Control Center</span>
            </div>
          </div>

          {/* Form */}
          <div className="p-8">
            {step === "request" ? (
              <>
                <div className="text-center mb-6">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/20 flex items-center justify-center">
                    <KeyRound className="w-8 h-8 text-primary" />
                  </div>
                  <h2 className="text-xl font-semibold text-foreground mb-1">Forgot your password?</h2>
                  <p className="text-sm text-muted-foreground">
                    Enter your email and we'll send you a verification code to reset your password.
                  </p>
                </div>

                <form onSubmit={handleRequestCode} className="space-y-5">
                  {error && (
                    <div className="p-4 text-sm text-red-400 bg-red-500/10 rounded-xl border border-red-500/20 flex items-start gap-3">
                      <div className="w-2 h-2 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />
                      {error}
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <Mail className="w-4 h-4" />
                      Email
                    </label>
                    <input
                      type="email"
                      placeholder="name@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all placeholder:text-muted-foreground/50"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-3 px-4 bg-gradient-to-r from-primary to-cyan-400 text-primary-foreground font-semibold rounded-xl hover:shadow-lg hover:shadow-primary/30 transition-all duration-300 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none flex items-center justify-center gap-2"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      "Send Reset Code"
                    )}
                  </button>
                </form>
              </>
            ) : (
              <>
                <div className="text-center mb-6">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/20 flex items-center justify-center">
                    <Lock className="w-8 h-8 text-primary" />
                  </div>
                  <h2 className="text-xl font-semibold text-foreground mb-1">Reset your password</h2>
                  <p className="text-sm text-muted-foreground">
                    Code sent to <span className="text-foreground font-medium">{email}</span>
                  </p>
                </div>

                <form onSubmit={handleResetPassword} className="space-y-5">
                  {error && (
                    <div className="p-4 text-sm text-red-400 bg-red-500/10 rounded-xl border border-red-500/20 flex items-start gap-3">
                      <div className="w-2 h-2 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />
                      {error}
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <Mail className="w-4 h-4" />
                      Verification Code
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="Enter verification code"
                      value={code}
                      onChange={(e) => {
                        setCode(e.target.value);
                        setError(null);
                      }}
                      required
                      maxLength={10}
                      className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all placeholder:text-muted-foreground/50"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <Lock className="w-4 h-4" />
                      New Password
                    </label>
                    <input
                      type="password"
                      placeholder="At least 8 characters"
                      value={newPassword}
                      onChange={(e) => {
                        setNewPassword(e.target.value);
                        setError(null);
                      }}
                      required
                      minLength={8}
                      className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all placeholder:text-muted-foreground/50"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <Lock className="w-4 h-4" />
                      Confirm Password
                    </label>
                    <input
                      type="password"
                      placeholder="Confirm your new password"
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        setError(null);
                      }}
                      required
                      minLength={8}
                      className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all placeholder:text-muted-foreground/50"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-3 px-4 bg-gradient-to-r from-primary to-cyan-400 text-primary-foreground font-semibold rounded-xl hover:shadow-lg hover:shadow-primary/30 transition-all duration-300 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none flex items-center justify-center gap-2"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Resetting...
                      </>
                    ) : (
                      "Reset Password"
                    )}
                  </button>

                  {/* Resend code */}
                  <div className="text-center">
                    <button
                      type="button"
                      onClick={handleResendCode}
                      disabled={isResending}
                      className="text-sm text-primary hover:underline font-medium disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
                    >
                      {isResending ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-4 h-4" />
                          Resend code
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </>
            )}

            <div className="mt-6 pt-6 border-t border-border/50 text-center">
              <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground">
                Back to login
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

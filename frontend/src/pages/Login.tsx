import { useState, useEffect } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Sparkles, Mail, Lock, Loader2, X, CheckCircle2, AlertCircle } from "lucide-react";
import { authAPI } from "../lib/api-client";
import { useAuthStore } from "../store/auth-store";

export function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setTokens = useAuthStore((state) => state.setTokens);
  const setUser = useAuthStore((state) => state.setUser);
  const setOrganization = useAuthStore((state) => state.setOrganization);
  const setNeedsSetup = useAuthStore((state) => state.setNeedsSetup);

  // Get invite context from URL params
  const emailFromParams = searchParams.get("email") || "";
  const inviteToken = searchParams.get("invite") || "";

  const [email, setEmail] = useState(emailFromParams);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuccessMessage, setShowSuccessMessage] = useState<string | null>(null);
  const [showSessionExpired, setShowSessionExpired] = useState(false);

  // Check for session expired flag (set by 401 interceptor)
  useEffect(() => {
    const sessionExpired = sessionStorage.getItem("sessionExpired");
    if (sessionExpired === "true") {
      setShowSessionExpired(true);
      // Clear the flag so it doesn't show again on refresh
      sessionStorage.removeItem("sessionExpired");

      // Auto-dismiss after 8 seconds
      const timer = setTimeout(() => {
        setShowSessionExpired(false);
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, []);

  // Check for success query parameters
  useEffect(() => {
    if (searchParams.get("registered") === "true") {
      setShowSuccessMessage("Registration successful! Please check your email to verify your account.");
    } else if (searchParams.get("verified") === "true") {
      setShowSuccessMessage("Email verified successfully! You can now log in.");
    }

    if (showSuccessMessage) {
      // Auto-dismiss after 5 seconds
      const timer = setTimeout(() => {
        setShowSuccessMessage(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [searchParams, showSuccessMessage]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const response = await authAPI.login({ email, password });
      setTokens(response.tokens);

      // Fetch user info
      const me = await authAPI.getMe();
      setUser(me.user);
      setOrganization(me.organization);
      setNeedsSetup(me.needsSetup);

      // If user came from invite, redirect to accept it
      if (inviteToken) {
        navigate(`/invites/${inviteToken}`);
      } else if (me.needsSetup) {
        // Redirect to onboarding if user needs to set up their org
        navigate("/onboarding");
      } else {
        navigate("/dashboard");
      }
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || "Login failed. Please try again.";
      setError(errorMessage);
      // Check if user needs to verify email
      if (errorMessage.toLowerCase().includes("confirm") || errorMessage.toLowerCase().includes("verify")) {
        setNeedsVerification(true);
      } else {
        setNeedsVerification(false);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background effects */}
      <div className="fixed inset-0 bg-grid-pattern pointer-events-none" />
      <div className="fixed inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/10 pointer-events-none" />
      <div className="orb orb-primary w-[400px] h-[400px] top-20 left-[10%]" />
      <div className="orb orb-accent w-[300px] h-[300px] bottom-20 right-[10%]" style={{ animationDelay: '-3s' }} />

      {/* Back to home link */}
      <Link
        to="/"
        className="absolute top-6 left-6 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Home
      </Link>

      {/* Login card */}
      <div className="relative w-full max-w-md">
        {/* Glow effect behind card */}
        <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-accent/20 rounded-2xl blur-xl transform scale-105" />

        <div className="relative card-elevated rounded-2xl border border-border/50 overflow-hidden glow-mixed">
          {/* Header */}
          <div className="p-8 pb-6 text-center border-b border-border/50 bg-gradient-to-b from-muted/30 to-transparent">
            <Link to="/" className="inline-block">
              <h1 className="text-3xl font-bold text-gradient-animated mb-2">
                WorkerMill
              </h1>
            </Link>
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <Sparkles className="w-4 h-4 text-primary" />
              <span>AI Workers Control Center</span>
            </div>
          </div>

          {/* Form */}
          <div className="p-8">
            <div className="text-center mb-6">
              <h2 className="text-xl font-semibold text-foreground mb-1">Welcome back</h2>
              <p className="text-sm text-muted-foreground">
                {inviteToken
                  ? "Log in to accept your invitation"
                  : "Enter your credentials to access the dashboard"}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {showSessionExpired && (
                <div className="p-4 text-sm text-amber-400 bg-amber-500/10 rounded-xl border border-amber-500/20 flex items-start gap-3 relative animate-in fade-in slide-in-from-top-2 duration-300">
                  <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium">Session expired</span>
                    <p className="text-amber-400/80 mt-0.5">Your session has expired. Please log in again to continue.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSessionExpired(false)}
                    className="absolute top-3 right-3 text-amber-400 hover:text-amber-300 transition-colors"
                    aria-label="Dismiss message"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {showSuccessMessage && (
                <div className="p-4 text-sm text-emerald-400 bg-emerald-500/10 rounded-xl border border-emerald-500/20 flex items-start gap-3 relative">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                  <span>{showSuccessMessage}</span>
                  <button
                    type="button"
                    onClick={() => setShowSuccessMessage(null)}
                    className="absolute top-3 right-3 text-emerald-400 hover:text-emerald-300 transition-colors"
                    aria-label="Dismiss message"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {error && (
                <div className="p-4 text-sm text-red-400 bg-red-500/10 rounded-xl border border-red-500/20">
                  <div className="flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                  {needsVerification && email && (
                    <Link
                      to={inviteToken
                        ? `/verify-email?email=${encodeURIComponent(email)}&invite=${inviteToken}`
                        : `/verify-email?email=${encodeURIComponent(email)}`}
                      className="mt-3 block text-center text-primary hover:underline font-medium"
                    >
                      Verify your email now
                    </Link>
                  )}
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

              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Lock className="w-4 h-4" />
                  Password
                </label>
                <input
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
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
                    Logging in...
                  </>
                ) : (
                  "Login"
                )}
              </button>
            </form>

            <div className="mt-6 pt-6 border-t border-border/50 text-center">
              <p className="text-sm text-muted-foreground">
                Don't have an account?{" "}
                <Link to="/signup" className="text-primary hover:underline font-medium">
                  Sign up
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Sparkles, Mail, Lock, Loader2, X, CheckCircle2, AlertCircle, Shield } from "lucide-react";
import apiClient, { authAPI } from "../lib/api-client";
import { useAuthStore } from "../store/auth-store";
import { TotpInput } from "../components/ui/TotpInput";

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
    </svg>
  );
}


export function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setTokens = useAuthStore((state) => state.setTokens);
  const setUser = useAuthStore((state) => state.setUser);
  const setOrganization = useAuthStore((state) => state.setOrganization);
  const setNeedsSetup = useAuthStore((state) => state.setNeedsSetup);

  // Get invite context from URL params, with sessionStorage fallback
  const emailFromParams = searchParams.get("email") || "";
  const inviteTokenFromUrl = searchParams.get("invite") || "";
  // Check sessionStorage for invite token (set by AcceptInvite page)
  const inviteTokenFromStorage = sessionStorage.getItem("pendingInviteToken") || "";
  const inviteToken = inviteTokenFromUrl || inviteTokenFromStorage;

  const [email, setEmail] = useState(emailFromParams);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuccessMessage, setShowSuccessMessage] = useState<string | null>(null);
  const [showSessionExpired, setShowSessionExpired] = useState(false);
  const [githubLoading, setGithubLoading] = useState(false);

  // MFA challenge state
  const [mfaChallenge, setMfaChallenge] = useState<{
    session: string;
    email: string;
  } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaLoading, setMfaLoading] = useState(false);

  // LOCAL MODE: Auto-login for local development
  useEffect(() => {
    if (import.meta.env.VITE_LOCAL_MODE === "true") {
      const autoLogin = async () => {
        try {
          setIsLoading(true);
          // In local mode, the API auto-authenticates and returns user info
          const response = await apiClient.get("/auth/me");
          const { user, organization } = response.data;

          // Set mock tokens for local mode
          setTokens({
            accessToken: "local-dev-token",
            refreshToken: "local-dev-refresh",
            idToken: "local-dev-id",
            expiresIn: 86400,
          });
          setUser(user);
          setOrganization(organization);
          navigate("/");
        } catch (err) {
          console.error("Local mode auto-login failed:", err);
          setError("Local mode auto-login failed. Is the API running?");
        } finally {
          setIsLoading(false);
        }
      };
      autoLogin();
    }
  }, [navigate, setTokens, setUser, setOrganization]);

  // Handle GitHub login (direct OAuth)
  const handleGitHubLogin = async () => {
    setGithubLoading(true);

    if (inviteToken) {
      sessionStorage.setItem("pendingInviteToken", inviteToken);
    }

    try {
      const response = await authAPI.getGitHubAuthUrl(inviteToken);
      window.location.href = response.authorizeUrl;
    } catch (err) {
      console.error("Failed to get GitHub auth URL:", err);
      setError("Failed to initiate GitHub sign-in. Please try again.");
      setGithubLoading(false);
    }
  };

  // Check for session expired flag (set by 401 interceptor)
  useEffect(() => {
    const sessionExpired = sessionStorage.getItem("sessionExpired");
    if (sessionExpired === "true") {
      setShowSessionExpired(true);
      // Clear the flag so it doesn't show again on refresh
      sessionStorage.removeItem("sessionExpired");
      // Don't auto-dismiss - let user manually dismiss or it clears when they submit the form
    }
  }, []);

  // Check for success query parameters
  useEffect(() => {
    if (searchParams.get("registered") === "true") {
      setShowSuccessMessage("Registration successful! Please check your email to verify your account.");
    } else if (searchParams.get("verified") === "true") {
      setShowSuccessMessage("Email verified successfully! You can now log in.");
    } else if (searchParams.get("reset") === "true") {
      setShowSuccessMessage("Password reset successfully. Please sign in with your new password.");
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

      // Handle MFA challenge if required
      if ("challengeRequired" in response && response.challengeRequired) {
        setMfaChallenge({
          session: response.session,
          email: response.email,
        });
        setIsLoading(false);
        return;
      }

      // No MFA required, proceed with tokens
      if ("tokens" in response) {
        setTokens(response.tokens);

        // Fetch user info
        const me = await authAPI.getMe();
        setUser(me.user);
        setOrganization(me.organization);
        setNeedsSetup(me.needsSetup);

        // If user came from signup (verified=true) AND has invite, auto-accept it
        // They already accepted ToS during signup, so no need to show invite page again
        const cameFromSignup = searchParams.get("verified") === "true";
        if (inviteToken && cameFromSignup) {
          try {
            await apiClient.post(`/invites/${inviteToken}/accept`, { tosAccepted: true });
            // Clear the pending invite token
            sessionStorage.removeItem("pendingInviteToken");
            // Refresh auth state to get updated org membership
            const refreshedMe = await authAPI.getMe();
            setUser(refreshedMe.user);
            setOrganization(refreshedMe.organization);
            setNeedsSetup(refreshedMe.needsSetup);
            navigate("/dashboard");
          } catch {
            // If auto-accept fails (e.g., invite expired), redirect to invite page
            navigate(`/invites/${inviteToken}`);
          }
        } else if (inviteToken) {
          // Existing user with invite - redirect to accept page (they need to accept ToS)
          navigate(`/invites/${inviteToken}`);
        } else if (me.needsSetup) {
          // Redirect to onboarding if user needs to set up their org
          navigate("/onboarding");
        } else {
          navigate("/dashboard");
        }
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

  // Handle MFA challenge submission
  const handleMfaSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();

    if (!mfaChallenge || mfaCode.length !== 6) return;

    setMfaLoading(true);
    setError(null);

    try {
      const response = await authAPI.submitMfaChallenge({
        email: mfaChallenge.email,
        session: mfaChallenge.session,
        code: mfaCode,
      });

      setTokens(response.tokens);

      // Fetch user info
      const me = await authAPI.getMe();
      setUser(me.user);
      setOrganization(me.organization);
      setNeedsSetup(me.needsSetup);

      // If user came from signup (verified=true) AND has invite, auto-accept it
      const cameFromSignup = searchParams.get("verified") === "true";
      if (inviteToken && cameFromSignup) {
        try {
          await apiClient.post(`/invites/${inviteToken}/accept`, { tosAccepted: true });
          sessionStorage.removeItem("pendingInviteToken");
          const refreshedMe = await authAPI.getMe();
          setUser(refreshedMe.user);
          setOrganization(refreshedMe.organization);
          setNeedsSetup(refreshedMe.needsSetup);
          navigate("/dashboard");
        } catch {
          navigate(`/invites/${inviteToken}`);
        }
      } else if (inviteToken) {
        navigate(`/invites/${inviteToken}`);
      } else if (me.needsSetup) {
        navigate("/onboarding");
      } else {
        navigate("/dashboard");
      }
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || "Verification failed. Please try again.";
      setError(errorMessage);
      setMfaCode("");

      // If session expired, go back to login
      if (errorMessage.toLowerCase().includes("session expired") || errorMessage.toLowerCase().includes("start the login")) {
        setMfaChallenge(null);
        setPassword("");
      }
    } finally {
      setMfaLoading(false);
    }
  };

  // Cancel MFA challenge and go back to login
  const handleMfaCancel = () => {
    setMfaChallenge(null);
    setMfaCode("");
    setPassword("");
    setError(null);
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
            {/* MFA Challenge View */}
            {mfaChallenge ? (
              <div className="space-y-6">
                <div className="text-center">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <Shield className="w-8 h-8 text-primary" />
                  </div>
                  <h2 className="text-xl font-semibold text-foreground mb-1">Two-Factor Authentication</h2>
                  <p className="text-sm text-muted-foreground">
                    Enter the 6-digit code from your authenticator app
                  </p>
                </div>

                {error && (
                  <div className="p-4 text-sm text-red-400 bg-red-500/10 rounded-xl border border-red-500/20">
                    <div className="flex items-start gap-3">
                      <div className="w-2 h-2 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />
                      <span>{error}</span>
                    </div>
                  </div>
                )}

                <form onSubmit={handleMfaSubmit} className="space-y-6">
                  <TotpInput
                    value={mfaCode}
                    onChange={(code) => {
                      setMfaCode(code);
                      setError(null);
                    }}
                    disabled={mfaLoading}
                  />

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={handleMfaCancel}
                      className="flex-1 py-3 px-4 border border-border rounded-xl hover:bg-muted/50 transition-all"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={mfaCode.length !== 6 || mfaLoading}
                      className="flex-1 py-3 px-4 bg-gradient-to-r from-primary to-cyan-400 text-primary-foreground font-semibold rounded-xl hover:shadow-lg hover:shadow-primary/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {mfaLoading ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Verifying...
                        </>
                      ) : (
                        "Verify"
                      )}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              /* Regular Login View */
              <>
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
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Lock className="w-4 h-4" />
                    Password
                  </label>
                  <Link
                    to="/forgot-password"
                    className="text-sm text-primary hover:underline font-medium"
                  >
                    Forgot password?
                  </Link>
                </div>
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

              {/* GitHub SSO */}
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border/50"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-4 bg-card text-muted-foreground">or continue with</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleGitHubLogin}
                disabled={githubLoading}
                className="w-full py-3 px-4 bg-background/50 border border-border rounded-xl hover:bg-muted/50 transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {githubLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <GitHubIcon className="w-5 h-5" />
                )}
                <span className="font-medium">
                  {githubLoading ? "Redirecting to GitHub..." : "Continue with GitHub"}
                </span>
              </button>
            </form>

                <div className="mt-6 pt-6 border-t border-border/50 text-center">
                  <p className="text-sm text-muted-foreground">
                    Don't have an account?{" "}
                    <Link
                      to={inviteToken
                        ? `/signup?email=${encodeURIComponent(emailFromParams)}&invite=${inviteToken}`
                        : "/signup"}
                      className="text-primary hover:underline font-medium"
                    >
                      Sign up
                    </Link>
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

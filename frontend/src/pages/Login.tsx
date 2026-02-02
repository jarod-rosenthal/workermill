import { useState, useEffect } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Sparkles, Mail, Lock, Loader2, X, CheckCircle2, AlertCircle, Shield } from "lucide-react";
import apiClient, { authAPI } from "../lib/api-client";
import { useAuthStore } from "../store/auth-store";
import { TotpInput } from "../components/ui/TotpInput";

// SSO Provider Icons
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.4 11.4H0V0h11.4v11.4z" fill="#F25022"/>
      <path d="M24 11.4H12.6V0H24v11.4z" fill="#7FBA00"/>
      <path d="M11.4 24H0V12.6h11.4V24z" fill="#00A4EF"/>
      <path d="M24 24H12.6V12.6H24V24z" fill="#FFB900"/>
    </svg>
  );
}

interface SsoConfig {
  enabled: boolean;
  providers: { name: string; displayName: string }[];
  clientId: string;
  hostedUiBaseUrl: string;
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
  const [ssoConfig, setSsoConfig] = useState<SsoConfig | null>(null);
  const [ssoLoading, setSsoLoading] = useState<string | null>(null);

  // MFA challenge state
  const [mfaChallenge, setMfaChallenge] = useState<{
    session: string;
    email: string;
  } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaLoading, setMfaLoading] = useState(false);

  // Fetch SSO configuration on mount with retry logic
  useEffect(() => {
    let retryCount = 0;
    const maxRetries = 2;

    const fetchSsoConfig = async () => {
      try {
        const config = await authAPI.getSsoConfig();
        setSsoConfig(config);
      } catch (err) {
        // Retry on failure (Cognito can throttle)
        if (retryCount < maxRetries) {
          retryCount++;
          console.debug(`SSO config fetch failed, retrying (${retryCount}/${maxRetries})...`);
          setTimeout(fetchSsoConfig, 500 * retryCount);
        } else {
          console.debug("SSO not available:", err);
        }
      }
    };
    fetchSsoConfig();
  }, []);

  // Handle SSO login (non-Microsoft providers via Cognito)
  const handleSsoLogin = (providerName: string) => {
    if (!ssoConfig) return;

    setSsoLoading(providerName);

    const redirectUri = `${window.location.origin}/auth/callback`;
    const state = inviteToken ? btoa(JSON.stringify({ invite: inviteToken })) : "";

    // Also store in sessionStorage as backup (OAuth state can be unreliable)
    if (inviteToken) {
      sessionStorage.setItem("pendingInviteToken", inviteToken);
    }

    // Build OAuth authorize URL
    const params = new URLSearchParams({
      identity_provider: providerName,
      redirect_uri: redirectUri,
      response_type: "code",
      client_id: ssoConfig.clientId,
      scope: "email openid profile",
    });

    if (state) {
      params.set("state", state);
    }

    const authorizeUrl = `${ssoConfig.hostedUiBaseUrl}/oauth2/authorize?${params.toString()}`;
    window.location.href = authorizeUrl;
  };

  // Handle Microsoft Work account login (direct OAuth, bypasses Cognito)
  const handleMicrosoftLogin = async () => {
    setSsoLoading("Microsoft");

    // Store invite token for callback
    if (inviteToken) {
      sessionStorage.setItem("pendingInviteToken", inviteToken);
    }

    try {
      // Get Microsoft OAuth URL from backend
      const response = await authAPI.getMicrosoftAuthUrl(inviteToken);
      // Redirect to Microsoft directly
      window.location.href = response.authorizeUrl;
    } catch (err) {
      console.error("Failed to get Microsoft auth URL:", err);
      setError("Failed to initiate Microsoft sign-in. Please try again.");
      setSsoLoading(null);
    }
  };

  // Get icon for provider
  const getProviderIcon = (providerName: string) => {
    switch (providerName) {
      case "Google":
        return <GoogleIcon className="w-5 h-5" />;
      case "Microsoft":
        return <MicrosoftIcon className="w-5 h-5" />;
      default:
        return null;
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

              {/* SSO Providers */}
              {ssoConfig?.enabled && ssoConfig.providers.length > 0 && (
                <>
                  <div className="relative my-6">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-border/50"></div>
                    </div>
                    <div className="relative flex justify-center text-sm">
                      <span className="px-4 bg-card text-muted-foreground">or continue with</span>
                    </div>
                  </div>

                  <div className="grid gap-3">
                    {ssoConfig.providers.map((provider) => (
                      <button
                        key={provider.name}
                        type="button"
                        onClick={() =>
                          provider.name === "Microsoft"
                            ? handleMicrosoftLogin()
                            : handleSsoLogin(provider.name)
                        }
                        disabled={ssoLoading !== null}
                        className="w-full py-3 px-4 bg-background/50 border border-border rounded-xl hover:bg-muted/50 transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {ssoLoading === provider.name ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          getProviderIcon(provider.name)
                        )}
                        <span className="font-medium">
                          {ssoLoading === provider.name
                            ? `Redirecting to ${provider.displayName}...`
                            : provider.name === "Microsoft"
                            ? "Sign in with Microsoft (Work)"
                            : `Continue with ${provider.displayName}`}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
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

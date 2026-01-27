import { useState, useEffect } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Sparkles,
  Mail,
  Lock,
  Loader2,
  User,
  Building2,
  CheckCircle2,
  UserPlus,
} from "lucide-react";
import { authAPI } from "../lib/api-client";
import { AxiosError } from "axios";

// Google SSO Icon
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="***REMOVED***4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="***REMOVED***34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="***REMOVED***FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="***REMOVED***EA4335"/>
    </svg>
  );
}

interface SsoConfig {
  enabled: boolean;
  providers: { name: string; displayName: string }[];
  clientId: string;
  hostedUiBaseUrl: string;
}

export default function Signup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Get invite context from URL params
  const inviteEmail = searchParams.get("email") || "";
  const inviteToken = searchParams.get("invite") || "";
  const inviteOrgName = searchParams.get("org") || "";
  const isInviteFlow = Boolean(inviteToken && inviteEmail);

  const [formData, setFormData] = useState({
    email: inviteEmail,
    password: "",
    confirmPassword: "",
    name: "",
    organizationName: isInviteFlow ? "" : "", // Not needed for invite flow
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [ssoConfig, setSsoConfig] = useState<SsoConfig | null>(null);
  const [ssoLoading, setSsoLoading] = useState(false);

  // Fetch SSO configuration on mount with retry logic
  useEffect(() => {
    let retryCount = 0;
    const maxRetries = 2;

    const fetchSsoConfig = async () => {
      try {
        const config = await authAPI.getSsoConfig();
        // Only show Google for now (Microsoft not ready)
        if (config.enabled) {
          config.providers = config.providers.filter((p) => p.name === "Google");
        }
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

  // Handle Google SSO signup
  const handleGoogleSignup = () => {
    if (!ssoConfig) return;

    setSsoLoading(true);

    const redirectUri = `${window.location.origin}/auth/callback`;
    // Pass invite token in state if present
    const state = inviteToken ? btoa(JSON.stringify({ invite: inviteToken })) : "";

    // Also store in sessionStorage as backup (OAuth state can be unreliable)
    if (inviteToken) {
      sessionStorage.setItem("pendingInviteToken", inviteToken);
      console.log("[Signup] Stored invite token in sessionStorage:", inviteToken);
    }

    console.log("[Signup] inviteToken:", inviteToken);
    console.log("[Signup] state:", state);

    const params = new URLSearchParams({
      identity_provider: "Google",
      redirect_uri: redirectUri,
      response_type: "code",
      client_id: ssoConfig.clientId,
      scope: "email openid profile",
    });

    if (state) {
      params.set("state", state);
    }

    const authorizeUrl = `${ssoConfig.hostedUiBaseUrl}/oauth2/authorize?${params.toString()}`;
    console.log("[Signup] OAuth URL:", authorizeUrl);
    window.location.href = authorizeUrl;
  };

  // Handle countdown and redirect after successful signup
  useEffect(() => {
    if (success && countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else if (success && countdown === 0) {
      // Redirect to verify email page with email parameter (and invite token if present)
      const verifyUrl = inviteToken
        ? `/verify-email?email=${encodeURIComponent(formData.email)}&invite=${inviteToken}`
        : `/verify-email?email=${encodeURIComponent(formData.email)}`;
      navigate(verifyUrl);
    }
  }, [success, countdown, navigate, formData.email, inviteToken]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Client-side validation
    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (formData.password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    if (formData.name.trim().length < 2) {
      setError("Name must be at least 2 characters");
      return;
    }

    // Only validate org name if not in invite flow
    if (!isInviteFlow && formData.organizationName.trim().length < 2) {
      setError("Organization name must be at least 2 characters");
      return;
    }

    setIsLoading(true);

    try {
      // For invite flow, use a placeholder org name (user will join invited org after verification)
      await authAPI.signup({
        email: formData.email,
        password: formData.password,
        name: formData.name.trim(),
        organizationName: isInviteFlow ? `${formData.name.trim()}'s Organization` : formData.organizationName.trim(),
      });

      setSuccess(true);
    } catch (err) {
      const axiosError = err as AxiosError<{ error: string; details?: string }>;
      const status = axiosError.response?.status;
      const errorData = axiosError.response?.data;

      if (status === 409) {
        setError("Email already registered. Please use a different email or sign in.");
      } else if (status === 400) {
        setError(errorData?.details || errorData?.error || "Invalid input. Please check your information.");
      } else if (status === 500) {
        setError("Server error. Please try again later.");
      } else if (axiosError.code === "ERR_NETWORK") {
        setError("Network error. Please check your connection and try again.");
      } else {
        setError(errorData?.error || "Failed to create account. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  }

  // Success state UI
  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
        {/* Background effects */}
        <div className="fixed inset-0 bg-grid-pattern pointer-events-none" />
        <div className="fixed inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/10 pointer-events-none" />
        <div
          className="orb orb-primary w-[400px] h-[400px] top-20 left-[10%]"
        />
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
            <h2 className="text-2xl font-bold text-foreground mb-2">
              Account Created!
            </h2>
            <p className="text-muted-foreground mb-4">
              Your account has been created successfully. We've sent a verification code to your email.
            </p>
            {isInviteFlow && (
              <p className="text-sm text-muted-foreground mb-2">
                After verification, you'll join <span className="font-semibold text-primary">{inviteOrgName}</span>.
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Redirecting to verification in{" "}
              <span className="font-semibold text-primary">{countdown}</span>{" "}
              seconds...
            </p>
            <Link
              to={inviteToken
                ? `/verify-email?email=${encodeURIComponent(formData.email)}&invite=${inviteToken}`
                : `/verify-email?email=${encodeURIComponent(formData.email)}`}
              className="mt-4 inline-block text-sm text-primary hover:underline"
            >
              Enter verification code now
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
      <div
        className="orb orb-primary w-[400px] h-[400px] top-20 left-[10%]"
      />
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

      {/* Signup card */}
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
            {isInviteFlow ? (
              <div className="text-center mb-6">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-primary/20 flex items-center justify-center">
                  <UserPlus className="w-6 h-6 text-primary" />
                </div>
                <h2 className="text-xl font-semibold text-foreground mb-1">
                  Join {inviteOrgName}
                </h2>
                <p className="text-sm text-muted-foreground">
                  Create your account to accept the invitation
                </p>
              </div>
            ) : (
              <div className="text-center mb-6">
                <h2 className="text-xl font-semibold text-foreground mb-1">
                  Create your account
                </h2>
                <p className="text-sm text-muted-foreground">
                  Start automating your coding tasks with AI workers
                </p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-4 text-sm text-red-400 bg-red-500/10 rounded-xl border border-red-500/20 flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Full Name
                </label>
                <input
                  type="text"
                  placeholder="John Doe"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  required
                  className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all placeholder:text-muted-foreground/50"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  Email
                </label>
                <input
                  type="email"
                  placeholder="name@example.com"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  required
                  autoComplete="email"
                  readOnly={isInviteFlow}
                  className={`w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all placeholder:text-muted-foreground/50 ${
                    isInviteFlow ? "text-muted-foreground cursor-not-allowed" : ""
                  }`}
                />
                {isInviteFlow && (
                  <p className="text-xs text-muted-foreground">
                    Email from invitation link
                  </p>
                )}
              </div>

              {/* Hide organization field when joining via invite */}
              {!isInviteFlow && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Building2 className="w-4 h-4" />
                    Organization Name
                  </label>
                  <input
                    type="text"
                    placeholder="Acme Inc"
                    value={formData.organizationName}
                    onChange={(e) =>
                      setFormData({ ...formData, organizationName: e.target.value })
                    }
                    required
                    className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all placeholder:text-muted-foreground/50"
                  />
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Lock className="w-4 h-4" />
                  Password
                </label>
                <input
                  type="password"
                  placeholder="At least 8 characters"
                  value={formData.password}
                  onChange={(e) =>
                    setFormData({ ...formData, password: e.target.value })
                  }
                  required
                  autoComplete="new-password"
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
                  placeholder="Confirm your password"
                  value={formData.confirmPassword}
                  onChange={(e) =>
                    setFormData({ ...formData, confirmPassword: e.target.value })
                  }
                  required
                  autoComplete="new-password"
                  className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all placeholder:text-muted-foreground/50"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading || ssoLoading}
                className="w-full py-3 px-4 bg-gradient-to-r from-primary to-cyan-400 text-primary-foreground font-semibold rounded-xl hover:shadow-lg hover:shadow-primary/30 transition-all duration-300 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none flex items-center justify-center gap-2 mt-6"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Creating account...
                  </>
                ) : (
                  "Create account"
                )}
              </button>
            </form>

            {/* Google SSO Option */}
            {ssoConfig?.enabled && ssoConfig.providers.length > 0 && (
              <>
                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border/50" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleGoogleSignup}
                  disabled={isLoading || ssoLoading}
                  className="w-full py-3 px-4 bg-background/50 border border-border rounded-xl hover:bg-muted/50 transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {ssoLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <GoogleIcon className="w-5 h-5" />
                  )}
                  <span className="font-medium">
                    {ssoLoading ? "Redirecting to Google..." : "Sign up with Google"}
                  </span>
                </button>
              </>
            )}

            <div className="mt-6 pt-6 border-t border-border/50 text-center">
              <p className="text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link
                  to="/login"
                  className="text-primary hover:underline font-medium"
                >
                  Sign in
                </Link>
              </p>
            </div>

            <div className="mt-4 text-center text-xs text-muted-foreground">
              By signing up, you agree to our{" "}
              <a href="***REMOVED***" className="underline hover:text-foreground">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href="***REMOVED***" className="underline hover:text-foreground">
                Privacy Policy
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

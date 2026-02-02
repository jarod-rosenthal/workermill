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
  Gift,
} from "lucide-react";
import { authAPI, referralsAPI } from "../lib/api-client";
import { AxiosError } from "axios";

// SSO Provider Icons
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

function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.4 11.4H0V0h11.4v11.4z" fill="***REMOVED***F25022"/>
      <path d="M24 11.4H12.6V0H24v11.4z" fill="***REMOVED***7FBA00"/>
      <path d="M11.4 24H0V12.6h11.4V24z" fill="***REMOVED***00A4EF"/>
      <path d="M24 24H12.6V12.6H24V24z" fill="***REMOVED***FFB900"/>
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

  // Get referral code from URL params
  const referralCodeFromUrl = searchParams.get("ref") || "";

  const [formData, setFormData] = useState({
    email: inviteEmail,
    password: "",
    confirmPassword: "",
    name: "",
    organizationName: isInviteFlow ? "" : "", // Not needed for invite flow
    referralCode: referralCodeFromUrl,
    tosAccepted: false,
  });
  const [referralValid, setReferralValid] = useState<boolean | null>(null);
  const [referralMessage, setReferralMessage] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [userConfirmed, setUserConfirmed] = useState(false); // Track if user was auto-confirmed
  const [responseInviteToken, setResponseInviteToken] = useState<string | null>(null); // Invite token from API response
  const [countdown, setCountdown] = useState(3);
  const [ssoConfig, setSsoConfig] = useState<SsoConfig | null>(null);
  const [ssoLoading, setSsoLoading] = useState<string | null>(null);

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

  // Handle SSO signup (non-Microsoft providers via Cognito)
  const handleSsoSignup = (providerName: string) => {
    if (!ssoConfig) return;

    setSsoLoading(providerName);

    const redirectUri = `${window.location.origin}/auth/callback`;
    // Pass invite token in state if present
    const state = inviteToken ? btoa(JSON.stringify({ invite: inviteToken })) : "";

    // Also store in sessionStorage as backup (OAuth state can be unreliable)
    if (inviteToken) {
      sessionStorage.setItem("pendingInviteToken", inviteToken);
    }

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

  // Handle Microsoft Work account signup (direct OAuth, bypasses Cognito)
  const handleMicrosoftSignup = async () => {
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
      setError("Failed to initiate Microsoft sign-up. Please try again.");
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

  // Validate referral code when it changes
  useEffect(() => {
    const validateReferral = async () => {
      if (!formData.referralCode || formData.referralCode.length < 4) {
        setReferralValid(null);
        setReferralMessage("");
        return;
      }

      if (!formData.email || !formData.email.includes("@")) {
        // Need email to validate
        return;
      }

      try {
        const result = await referralsAPI.validateCode({
          code: formData.referralCode,
          email: formData.email,
        });

        setReferralValid(result.valid);
        if (result.valid && result.rewards) {
          setReferralMessage(result.rewards.description);
        } else if (!result.valid) {
          setReferralMessage(result.error || "Invalid referral code");
        }
      } catch {
        // Silently fail validation - will be checked on signup
        setReferralValid(null);
        setReferralMessage("");
      }
    };

    const debounce = setTimeout(validateReferral, 500);
    return () => clearTimeout(debounce);
  }, [formData.referralCode, formData.email]);

  // Handle countdown and redirect after successful signup
  useEffect(() => {
    if (success && countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else if (success && countdown === 0) {
      // Prefer invite token from API response (backend detected invite), fall back to URL param
      const effectiveInviteToken = responseInviteToken || inviteToken;

      if (userConfirmed) {
        // User was auto-confirmed (e.g., had a valid invite) - go straight to accept invite or login
        if (effectiveInviteToken) {
          // If invite flow, redirect to accept the invite
          navigate(`/invites/${effectiveInviteToken}`);
        } else {
          navigate("/login?verified=true");
        }
      } else {
        // User needs to verify email - redirect to verify email page
        const verifyUrl = effectiveInviteToken
          ? `/verify-email?email=${encodeURIComponent(formData.email)}&invite=${effectiveInviteToken}`
          : `/verify-email?email=${encodeURIComponent(formData.email)}`;
        navigate(verifyUrl);
      }
    }
  }, [success, countdown, navigate, formData.email, inviteToken, responseInviteToken, userConfirmed]);

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

    if (!formData.tosAccepted) {
      setError("You must accept the Terms of Service and Privacy Policy");
      return;
    }

    setIsLoading(true);

    try {
      // Build signup payload - only include organizationName if NOT in invite flow
      const signupPayload: Parameters<typeof authAPI.signup>[0] = {
        email: formData.email,
        password: formData.password,
        name: formData.name.trim(),
        organizationName: formData.organizationName.trim(), // Will be empty string for invite flow
        referralCode: formData.referralCode.trim() || undefined,
        tosAccepted: formData.tosAccepted,
      };

      // For invite flow, don't send organizationName - backend will detect pending invite
      if (isInviteFlow) {
        delete (signupPayload as Record<string, unknown>).organizationName;
      }

      const response = await authAPI.signup(signupPayload);

      // Check if user was auto-confirmed (e.g., had a valid invite)
      setUserConfirmed(response.userConfirmed ?? false);
      // Store invite token from response (backend detected pending invite for this email)
      if (response.inviteToken) {
        setResponseInviteToken(response.inviteToken);
      }
      setSuccess(true);
    } catch (err) {
      const axiosError = err as AxiosError<{ error: string; details?: string }>;
      const status = axiosError.response?.status;
      const errorData = axiosError.response?.data;

      if (status === 409) {
        setError("Email already registered. Please use a different email or sign in.");
      } else if (status === 403) {
        // Invite-only or other access restriction from pre-signup Lambda
        setError(errorData?.error || "Registration not allowed. Please contact your administrator.");
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
            {userConfirmed ? (
              // User was auto-confirmed (had valid invite)
              <>
                <p className="text-muted-foreground mb-4">
                  Your account has been created and verified successfully.
                </p>
                {isInviteFlow && (
                  <p className="text-sm text-muted-foreground mb-2">
                    You're joining <span className="font-semibold text-primary">{inviteOrgName}</span>.
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  Redirecting to {isInviteFlow ? "accept invitation" : "login"} in{" "}
                  <span className="font-semibold text-primary">{countdown}</span>{" "}
                  seconds...
                </p>
                <Link
                  to={inviteToken ? `/invites/${inviteToken}` : "/login"}
                  className="mt-4 inline-block text-sm text-primary hover:underline"
                >
                  {isInviteFlow ? "Accept invitation now" : "Go to login now"}
                </Link>
              </>
            ) : (
              // User needs to verify email
              <>
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
              </>
            )}
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

              {/* Referral code field (optional) */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Gift className="w-4 h-4" />
                  Referral Code
                  <span className="text-xs text-muted-foreground/70">(optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="Enter referral code"
                  value={formData.referralCode}
                  onChange={(e) =>
                    setFormData({ ...formData, referralCode: e.target.value.toUpperCase() })
                  }
                  maxLength={20}
                  className={`w-full px-4 py-3 rounded-xl bg-background/50 border transition-all placeholder:text-muted-foreground/50 ${
                    referralValid === true
                      ? "border-green-500 focus:border-green-500 focus:ring-2 focus:ring-green-500/20"
                      : referralValid === false
                      ? "border-red-500 focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
                      : "border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
                  } focus:outline-none`}
                />
                {referralMessage && (
                  <p className={`text-xs ${referralValid ? "text-green-500" : "text-red-400"}`}>
                    {referralMessage}
                  </p>
                )}
              </div>

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

              {/* Terms of Service Checkbox */}
              <div className="pt-2">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.tosAccepted}
                    onChange={(e) =>
                      setFormData({ ...formData, tosAccepted: e.target.checked })
                    }
                    className="mt-1 w-4 h-4 rounded border-border bg-background/50 text-primary focus:ring-primary/20 focus:ring-2 cursor-pointer"
                  />
                  <span className="text-sm text-muted-foreground">
                    I have read and agree to the{" "}
                    <Link
                      to="/terms"
                      target="_blank"
                      className="text-primary hover:underline"
                    >
                      Terms of Service
                    </Link>{" "}
                    and{" "}
                    <Link
                      to="/privacy"
                      target="_blank"
                      className="text-primary hover:underline"
                    >
                      Privacy Policy
                    </Link>
                  </span>
                </label>
              </div>

              <button
                type="submit"
                disabled={isLoading || ssoLoading !== null || !formData.tosAccepted}
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

            {/* SSO Providers */}
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

                <div className="grid gap-3">
                  {ssoConfig.providers.map((provider) => (
                    <button
                      key={provider.name}
                      type="button"
                      onClick={() =>
                        provider.name === "Microsoft"
                          ? handleMicrosoftSignup()
                          : handleSsoSignup(provider.name)
                      }
                      disabled={isLoading || ssoLoading !== null}
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
                          ? "Sign up with Microsoft (Work)"
                          : `Sign up with ${provider.displayName}`}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="mt-6 pt-6 border-t border-border/50 text-center">
              <p className="text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link
                  to={isInviteFlow
                    ? `/login?email=${encodeURIComponent(inviteEmail)}&invite=${inviteToken}`
                    : "/login"}
                  className="text-primary hover:underline font-medium"
                >
                  Sign in
                </Link>
              </p>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

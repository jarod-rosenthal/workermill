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

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
    </svg>
  );
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
  const [githubLoading, setGithubLoading] = useState(false);

  // Handle GitHub signup (direct OAuth)
  const handleGitHubSignup = async () => {
    setGithubLoading(true);

    if (inviteToken) {
      sessionStorage.setItem("pendingInviteToken", inviteToken);
    }

    try {
      const response = await authAPI.getGitHubAuthUrl(inviteToken);
      window.location.href = response.authorizeUrl;
    } catch (err) {
      console.error("Failed to get GitHub auth URL:", err);
      setError("Failed to initiate GitHub sign-up. Please try again.");
      setGithubLoading(false);
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
        // User was auto-confirmed (e.g., had a valid invite) - go to login first
        // After login, user will be redirected to accept invite (via sessionStorage token)
        if (effectiveInviteToken) {
          // Redirect to login with invite context - user needs to authenticate first
          navigate(`/login?email=${encodeURIComponent(formData.email)}&invite=${effectiveInviteToken}&verified=true`);
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
                  Redirecting to login in{" "}
                  <span className="font-semibold text-primary">{countdown}</span>{" "}
                  seconds...
                </p>
                <Link
                  to={inviteToken
                    ? `/login?email=${encodeURIComponent(formData.email)}&invite=${inviteToken}&verified=true`
                    : "/login?verified=true"}
                  className="mt-4 inline-block text-sm text-primary hover:underline"
                >
                  Go to login now
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
                disabled={isLoading || githubLoading || !formData.tosAccepted}
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

            {/* GitHub SSO */}
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
              onClick={handleGitHubSignup}
              disabled={isLoading || githubLoading}
              className="w-full py-3 px-4 bg-background/50 border border-border rounded-xl hover:bg-muted/50 transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {githubLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <GitHubIcon className="w-5 h-5" />
              )}
              <span className="font-medium">
                {githubLoading ? "Redirecting to GitHub..." : "Sign up with GitHub"}
              </span>
            </button>

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

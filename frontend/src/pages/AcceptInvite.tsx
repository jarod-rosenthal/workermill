import { useState, useEffect } from "react";
import { useNavigate, Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Sparkles,
  Loader2,
  CheckCircle2,
  XCircle,
  Building2,
  UserPlus,
  Clock,
  Shield,
} from "lucide-react";
import apiClient, { authAPI } from "../lib/api-client";
import { useAuthStore } from "../store/auth-store";
import { AxiosError } from "axios";

interface InviteDetails {
  id: string;
  email: string;
  role: string;
  organizationName: string;
  inviterName: string;
  expiresAt: string;
}

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isInitialized = useAuthStore((state) => state.isInitialized);
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const setOrganization = useAuthStore((state) => state.setOrganization);
  const setNeedsSetup = useAuthStore((state) => state.setNeedsSetup);

  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAccepting, setIsAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [tosAccepted, setTosAccepted] = useState(false);

  // Fetch invite details on mount
  useEffect(() => {
    async function fetchInvite() {
      if (!token) {
        setError("Invalid invitation link");
        setIsLoading(false);
        return;
      }

      // Store invite token in sessionStorage so it survives page refreshes/navigation
      // This ensures user doesn't lose invite context if they navigate away during login
      sessionStorage.setItem("pendingInviteToken", token);

      try {
        const response = await apiClient.get(`/invites/${token}`);
        setInvite(response.data);
      } catch (err) {
        const axiosError = err as AxiosError<{ error: string }>;
        const status = axiosError.response?.status;

        if (status === 404) {
          setError("This invitation link is invalid or has already been used.");
        } else if (status === 410) {
          setError("This invitation has expired. Please request a new one.");
        } else {
          setError(
            axiosError.response?.data?.error ||
              "Failed to load invitation details."
          );
        }
      } finally {
        setIsLoading(false);
      }
    }

    fetchInvite();
  }, [token]);

  // Handle countdown and redirect after successful acceptance
  useEffect(() => {
    if (success && countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else if (success && countdown === 0) {
      navigate("/dashboard");
    }
  }, [success, countdown, navigate]);

  async function handleAccept() {
    if (!token) return;

    if (!tosAccepted) {
      setError("You must accept the Terms of Service and Privacy Policy");
      return;
    }

    setIsAccepting(true);
    setError(null);

    try {
      await apiClient.post(`/invites/${token}/accept`, { tosAccepted });

      // Clear the pending invite token from sessionStorage - invite is now accepted
      sessionStorage.removeItem("pendingInviteToken");

      // Refresh auth state so dashboard has correct user/org data
      try {
        const me = await authAPI.getMe();
        setUser(me.user);
        setOrganization(me.organization);
        setNeedsSetup(me.needsSetup);
      } catch {
        // Non-fatal - dashboard will retry on mount
      }

      setSuccess(true);
    } catch (err) {
      const axiosError = err as AxiosError<{ error: string }>;
      const status = axiosError.response?.status;

      if (status === 404) {
        setError("This invitation is no longer valid.");
      } else if (status === 410) {
        setError("This invitation has expired.");
      } else if (status === 409) {
        setError("You are already a member of this organization.");
      } else if (status === 401) {
        setError("Please log in to accept this invitation.");
      } else {
        setError(
          axiosError.response?.data?.error || "Failed to accept invitation."
        );
      }
    } finally {
      setIsAccepting(false);
    }
  }

  function formatRole(role: string): string {
    return role.charAt(0).toUpperCase() + role.slice(1);
  }

  function isExpired(expiresAt: string): boolean {
    return new Date(expiresAt) < new Date();
  }

  // Loading state
  if (!isInitialized || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
        <div className="fixed inset-0 bg-grid-pattern pointer-events-none" />
        <div className="fixed inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/10 pointer-events-none" />
        <div className="orb orb-primary w-[400px] h-[400px] top-20 left-[10%]" />
        <div
          className="orb orb-accent w-[300px] h-[300px] bottom-20 right-[10%]"
          style={{ animationDelay: "-3s" }}
        />
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading invitation...</p>
        </div>
      </div>
    );
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
            <h2 className="text-2xl font-bold text-foreground mb-2">
              Welcome to {invite?.organizationName}!
            </h2>
            <p className="text-muted-foreground mb-4">
              You have successfully joined the organization as a{" "}
              {invite && formatRole(invite.role)}.
            </p>
            <p className="text-sm text-muted-foreground">
              Redirecting to dashboard in{" "}
              <span className="font-semibold text-primary">{countdown}</span>{" "}
              seconds...
            </p>
            <Link
              to="/dashboard"
              className="mt-4 inline-block text-sm text-primary hover:underline"
            >
              Go to dashboard now
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Error state (no invite loaded)
  if (error && !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
        <div className="fixed inset-0 bg-grid-pattern pointer-events-none" />
        <div className="fixed inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/10 pointer-events-none" />
        <div className="orb orb-primary w-[400px] h-[400px] top-20 left-[10%]" />
        <div
          className="orb orb-accent w-[300px] h-[300px] bottom-20 right-[10%]"
          style={{ animationDelay: "-3s" }}
        />

        <Link
          to="/"
          className="absolute top-6 left-6 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>

        <div className="relative w-full max-w-md">
          <div className="absolute inset-0 bg-gradient-to-r from-red-500/20 to-orange-500/20 rounded-2xl blur-xl transform scale-105" />

          <div className="relative card-elevated rounded-2xl border border-border/50 overflow-hidden p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
              <XCircle className="w-8 h-8 text-red-500" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">
              Invalid Invitation
            </h2>
            <p className="text-muted-foreground mb-4">{error}</p>
            <p className="text-sm text-muted-foreground mb-6">
              Need a new invite? Contact your team admin or reach out to{" "}
              <a href="mailto:support@workermill.com" className="text-primary hover:underline">
                support@workermill.com
              </a>
            </p>
            <Link
              to="/"
              className="inline-block py-2 px-4 bg-muted hover:bg-muted/80 text-foreground font-medium rounded-xl transition-colors"
            >
              Return to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Main invite acceptance view
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

      {/* Invite card */}
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

          {/* Content */}
          <div className="p-8">
            <div className="text-center mb-6">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/20 flex items-center justify-center">
                <UserPlus className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-1">
                You've been invited!
              </h2>
              <p className="text-sm text-muted-foreground">
                Join the team and start working together
              </p>
            </div>

            {/* Invite details */}
            {invite && (
              <div className="space-y-4 mb-6">
                <div className="p-4 rounded-xl bg-muted/50 border border-border/50">
                  <div className="flex items-center gap-3 mb-3">
                    <Building2 className="w-5 h-5 text-primary" />
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Organization
                      </p>
                      <p className="font-semibold text-foreground">
                        {invite.organizationName}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 mb-3">
                    <Shield className="w-5 h-5 text-primary" />
                    <div>
                      <p className="text-xs text-muted-foreground">Role</p>
                      <p className="font-semibold text-foreground">
                        {formatRole(invite.role)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 mb-3">
                    <UserPlus className="w-5 h-5 text-primary" />
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Invited by
                      </p>
                      <p className="font-semibold text-foreground">
                        {invite.inviterName}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Clock className="w-5 h-5 text-primary" />
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Expires
                      </p>
                      <p
                        className={`font-semibold ${
                          isExpired(invite.expiresAt)
                            ? "text-red-400"
                            : "text-foreground"
                        }`}
                      >
                        {isExpired(invite.expiresAt)
                          ? "Expired"
                          : new Date(invite.expiresAt).toLocaleDateString(
                              undefined,
                              {
                                year: "numeric",
                                month: "long",
                                day: "numeric",
                              }
                            )}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Error message */}
            {error && (
              <div className="p-4 text-sm text-red-400 bg-red-500/10 rounded-xl border border-red-500/20 flex items-start gap-3 mb-6">
                <div className="w-2 h-2 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />
                {error}
              </div>
            )}

            {/* Not authenticated - show login/signup prompt */}
            {!isAuthenticated && invite && (
              <div className="space-y-4">
                <div className="p-4 text-sm text-amber-400 bg-amber-500/10 rounded-xl border border-amber-500/20 flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-amber-500 mt-1.5 flex-shrink-0" />
                  Please log in or create an account to accept this invitation.
                </div>

                <div className="flex gap-3">
                  <Link
                    to={`/login?email=${encodeURIComponent(invite.email)}&invite=${token}`}
                    className="flex-1 py-3 px-4 bg-muted hover:bg-muted/80 text-foreground font-semibold rounded-xl transition-all text-center"
                  >
                    Log in
                  </Link>
                  <Link
                    to={`/signup?email=${encodeURIComponent(invite.email)}&invite=${token}&org=${encodeURIComponent(invite.organizationName)}`}
                    className="flex-1 py-3 px-4 bg-gradient-to-r from-primary to-cyan-400 text-primary-foreground font-semibold rounded-xl hover:shadow-lg hover:shadow-primary/30 transition-all duration-300 hover:-translate-y-0.5 text-center"
                  >
                    Sign up
                  </Link>
                </div>
              </div>
            )}

            {/* Authenticated - show ToS checkbox and accept button */}
            {isAuthenticated && invite && !isExpired(invite.expiresAt) && (
              <div className="space-y-4">
                {/* Warning if logged-in user email doesn't match invite email */}
                {user?.email && user.email.toLowerCase() !== invite.email.toLowerCase() && (
                  <div className="p-4 text-sm text-amber-400 bg-amber-500/10 rounded-xl border border-amber-500/20 flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full bg-amber-500 mt-1.5 flex-shrink-0" />
                    <div>
                      <strong>Note:</strong> You're logged in as <span className="font-semibold">{user.email}</span> but this invite was sent to <span className="font-semibold">{invite.email}</span>.
                      Accepting will add your current account to this organization.
                    </div>
                  </div>
                )}

                {/* Terms of Service Checkbox */}
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={tosAccepted}
                    onChange={(e) => setTosAccepted(e.target.checked)}
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

                <button
                  onClick={handleAccept}
                  disabled={isAccepting || !tosAccepted}
                  className="w-full py-3 px-4 bg-gradient-to-r from-primary to-cyan-400 text-primary-foreground font-semibold rounded-xl hover:shadow-lg hover:shadow-primary/30 transition-all duration-300 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none flex items-center justify-center gap-2"
                >
                  {isAccepting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Accepting...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-5 h-5" />
                      Accept Invitation
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Expired invite */}
            {invite && isExpired(invite.expiresAt) && (
              <div className="p-4 text-sm text-red-400 bg-red-500/10 rounded-xl border border-red-500/20 text-center">
                This invitation has expired. Please request a new one from{" "}
                {invite.inviterName}.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

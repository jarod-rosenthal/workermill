import { useEffect, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Loader2, AlertCircle, ArrowLeft } from "lucide-react";
import apiClient, { authAPI } from "../lib/api-client";
import { useAuthStore } from "../store/auth-store";

export function GitHubCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setTokens = useAuthStore((state) => state.setTokens);
  const setUser = useAuthStore((state) => state.setUser);
  const setOrganization = useAuthStore((state) => state.setOrganization);
  const setNeedsSetup = useAuthStore((state) => state.setNeedsSetup);

  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(true);

  useEffect(() => {
    const code = searchParams.get("code");
    const errorParam = searchParams.get("error");
    const errorDescription = searchParams.get("error_description");
    const state = searchParams.get("state");

    if (errorParam) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- setting error from URL params on mount
      setError(errorDescription || errorParam || "GitHub authentication failed");
      setIsProcessing(false);
      return;
    }

    if (!code) {
      setError("No authorization code received from GitHub");
      setIsProcessing(false);
      return;
    }

    const handleCallback = async () => {
      try {
        // Check if this callback was initiated from the mobile app
        if (state && state.startsWith("mobile_")) {
          const mobileRedirect = `workermill://auth/callback?code=${encodeURIComponent(code)}`;
          window.location.href = mobileRedirect;
          return;
        }

        const redirectUri = `${window.location.origin}/auth/github/callback`;

        const response = await authAPI.githubCallback({
          code,
          redirectUri,
          state: state || undefined,
        });

        setTokens(response.tokens);

        if (response.user) {
          setUser(response.user);
        }
        if (response.organization) {
          setOrganization(response.organization);
          setNeedsSetup(false);
        } else {
          setNeedsSetup(true);
        }

        // Check for pending invite token
        const pendingInviteToken =
          sessionStorage.getItem("pendingInviteToken") || response.inviteToken;
        if (pendingInviteToken) {
          sessionStorage.removeItem("pendingInviteToken");
          try {
            await apiClient.post(`/invites/${pendingInviteToken}/accept`, {
              tosAccepted: true,
            });
            const me = await authAPI.getMe();
            setUser(me.user);
            setOrganization(me.organization);
            setNeedsSetup(me.needsSetup);
            navigate("/dashboard");
            return;
          } catch (err: unknown) {
            console.error("GitHub invite acceptance error:", err);
            if (!((err as { response?: { data?: { error?: string } } })?.response?.data?.error)?.includes("already")) {
              navigate(`/invites/${pendingInviteToken}`);
              return;
            }
          }
        }

        if (!response.organization || response.pendingInvite) {
          navigate("/onboarding");
        } else if (response.isNewOrg) {
          navigate("/onboarding?sso=github");
        } else {
          navigate("/dashboard");
        }
      } catch (err: unknown) {
        console.error("GitHub callback error:", err);
        const errorMessage =
          ((err as { response?: { data?: { error?: string } } })?.response?.data?.error) || "Failed to complete GitHub sign-in. Please try again.";
        setError(errorMessage);
        setIsProcessing(false);
      }
    };

    handleCallback();
  }, [searchParams, navigate, setTokens, setUser, setOrganization, setNeedsSetup]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
        <div className="fixed inset-0 bg-grid-pattern pointer-events-none" />
        <div className="fixed inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/10 pointer-events-none" />

        <div className="relative w-full max-w-md">
          <div className="absolute inset-0 bg-gradient-to-r from-red-500/20 to-orange-500/20 rounded-2xl blur-xl transform scale-105" />

          <div className="relative card-elevated rounded-2xl border border-border/50 overflow-hidden p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">Sign-in Failed</h2>
            <p className="text-muted-foreground mb-6">{error}</p>

            <div className="space-y-3">
              <Link
                to="/login"
                className="w-full py-3 px-4 bg-gradient-to-r from-primary to-cyan-400 text-primary-foreground font-semibold rounded-xl hover:shadow-lg hover:shadow-primary/30 transition-all duration-300 hover:-translate-y-0.5 flex items-center justify-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Login
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="fixed inset-0 bg-grid-pattern pointer-events-none" />
      <div className="fixed inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/10 pointer-events-none" />

      <div className="relative w-full max-w-md">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-accent/20 rounded-2xl blur-xl transform scale-105" />

        <div className="relative card-elevated rounded-2xl border border-border/50 overflow-hidden p-8 text-center">
          <Loader2 className="w-12 h-12 mx-auto mb-4 text-primary animate-spin" />
          <h2 className="text-xl font-bold text-foreground mb-2">
            Signing in with GitHub
          </h2>
          <p className="text-muted-foreground">
            {isProcessing
              ? "Completing authentication..."
              : "Redirecting to dashboard..."}
          </p>
        </div>
      </div>
    </div>
  );
}

export default GitHubCallback;

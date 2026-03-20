import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, AlertCircle } from "lucide-react";
import apiClient, { authAPI } from "../lib/api-client";
import { useAuthStore } from "../store/auth-store";

export function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setTokens = useAuthStore((state) => state.setTokens);
  const setUser = useAuthStore((state) => state.setUser);
  const setOrganization = useAuthStore((state) => state.setOrganization);
  const setNeedsSetup = useAuthStore((state) => state.setNeedsSetup);

  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Completing Sign In");

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get("code");
      const stateParam = searchParams.get("state");
      const errorParam = searchParams.get("error");
      const errorDescription = searchParams.get("error_description");

      // If this callback was initiated from the mobile app, redirect to the
      // mobile deep link instead of processing it here.
      if (stateParam && stateParam.startsWith("mobile_")) {
        const mobileRedirect = `workermill://auth/callback?code=${encodeURIComponent(code || "")}`;
        window.location.href = mobileRedirect;
        return;
      }

      if (errorParam) {
        setError(errorDescription || errorParam);
        return;
      }

      if (!code) {
        setError("No authorization code received");
        return;
      }

      // Extract invite token from state parameter if present
      let inviteToken: string | null = null;
      if (stateParam) {
        try {
          const decoded = JSON.parse(atob(stateParam));
          inviteToken = decoded.invite || null;
        } catch {
          // State wasn't valid JSON, ignore
        }
      }

      // Fallback: check sessionStorage for invite token (more reliable than OAuth state)
      if (!inviteToken) {
        const storedToken = sessionStorage.getItem("pendingInviteToken");
        if (storedToken) {
          inviteToken = storedToken;
          sessionStorage.removeItem("pendingInviteToken"); // Clean up
        }
      }

      try {
        // Exchange code for tokens
        setStatus("Verifying credentials...");
        const redirectUri = `${window.location.origin}/auth/callback`;
        const response = await authAPI.ssoCallback({ code, redirectUri });

        setTokens(response.tokens);

        // Check for invite token - from sessionStorage, URL state, OR SSO response (backend detected pending invite)
        const effectiveInviteToken = inviteToken || (response as Record<string, unknown>).inviteToken as string | undefined;

        // If there's an invite token, accept the invite first
        if (effectiveInviteToken) {
          setStatus("Joining organization...");
          try {
            await apiClient.post(`/invites/${effectiveInviteToken}/accept`, {
              tosAccepted: true, // Auto-accept ToS for SSO flow
            });
            sessionStorage.removeItem("pendingInviteToken"); // Clean up
          } catch (inviteErr: unknown) {
            // If already a member, that's fine - continue
            if (!((inviteErr as { response?: { data?: { error?: string } } })?.response?.data?.error)?.includes("already")) {
              // Don't fail the whole flow, user is authenticated
            }
          }
        }

        // Fetch user info (will have updated org if invite was accepted)
        setStatus("Loading your workspace...");
        const me = await authAPI.getMe();
        setUser(me.user);
        setOrganization(me.organization);
        setNeedsSetup(me.needsSetup);

        if (me.needsSetup) {
          navigate("/onboarding");
        } else {
          navigate("/dashboard");
        }
      } catch (err: unknown) {
        setError(((err as { response?: { data?: { error?: string } } })?.response?.data?.error) || "Authentication failed. Please try again.");
      }
    };

    handleCallback();
  }, [searchParams, navigate, setTokens, setUser, setOrganization, setNeedsSetup]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="p-6 bg-red-500/10 rounded-2xl border border-red-500/20">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-foreground mb-2">Authentication Failed</h2>
            <p className="text-muted-foreground mb-4">{error}</p>
            <button
              onClick={() => navigate("/login")}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              Back to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center">
        <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-foreground mb-2">{status}</h2>
        <p className="text-muted-foreground">Please wait...</p>
      </div>
    </div>
  );
}

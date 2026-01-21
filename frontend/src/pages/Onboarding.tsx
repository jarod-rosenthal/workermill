import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Building2,
  Users,
  ArrowRight,
  Loader2,
  Sparkles,
  ArrowLeft,
} from "lucide-react";
import { authAPI } from "../lib/api-client";
import { useAuthStore } from "../store/auth-store";

type OnboardingStep = "choose" | "create" | "join";

export default function Onboarding() {
  const navigate = useNavigate();
  const setOrganization = useAuthStore((state) => state.setOrganization);
  const setNeedsSetup = useAuthStore((state) => state.setNeedsSetup);
  const user = useAuthStore((state) => state.user);

  const [step, setStep] = useState<OnboardingStep>("choose");
  const [organizationName, setOrganizationName] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const result = await authAPI.completeSetup({
        action: "create",
        organizationName,
      });
      setOrganization(result.organization);
      setNeedsSetup(false);
      navigate("/dashboard");
    } catch (err: any) {
      setError(
        err.response?.data?.error || "Failed to create organization. Please try again."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const result = await authAPI.completeSetup({
        action: "join",
        inviteToken,
      });
      setOrganization(result.organization);
      setNeedsSetup(false);
      navigate("/dashboard");
    } catch (err: any) {
      setError(
        err.response?.data?.error || "Failed to join organization. Please check your invite token."
      );
    } finally {
      setIsLoading(false);
    }
  };

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

      {/* Main card */}
      <div className="relative w-full max-w-lg">
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
              <span>Complete Your Setup</span>
            </div>
          </div>

          {/* Content */}
          <div className="p-8">
            {step === "choose" && (
              <>
                <div className="text-center mb-8">
                  <h2 className="text-xl font-semibold text-foreground mb-2">
                    Welcome, {user?.fullName || user?.email}!
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Get started by creating a new organization or joining an existing one.
                  </p>
                </div>

                <div className="space-y-4">
                  {/* Create Organization Option */}
                  <button
                    onClick={() => setStep("create")}
                    className="w-full p-6 rounded-xl bg-background/50 border border-border hover:border-primary/50 hover:bg-primary/5 transition-all group text-left"
                  >
                    <div className="flex items-start gap-4">
                      <div className="p-3 rounded-xl bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                        <Building2 className="w-6 h-6" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-foreground mb-1 flex items-center gap-2">
                          Create New Organization
                          <ArrowRight className="w-4 h-4 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          Start fresh with your own organization. You'll be the admin and can invite team members later.
                        </p>
                      </div>
                    </div>
                  </button>

                  {/* Join Organization Option */}
                  <button
                    onClick={() => setStep("join")}
                    className="w-full p-6 rounded-xl bg-background/50 border border-border hover:border-accent/50 hover:bg-accent/5 transition-all group text-left"
                  >
                    <div className="flex items-start gap-4">
                      <div className="p-3 rounded-xl bg-accent/10 text-accent group-hover:bg-accent/20 transition-colors">
                        <Users className="w-6 h-6" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-foreground mb-1 flex items-center gap-2">
                          Join Existing Organization
                          <ArrowRight className="w-4 h-4 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          Have an invite code? Join your team's existing organization.
                        </p>
                      </div>
                    </div>
                  </button>
                </div>
              </>
            )}

            {step === "create" && (
              <>
                <button
                  onClick={() => {
                    setStep("choose");
                    setError(null);
                  }}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </button>

                <div className="text-center mb-6">
                  <div className="inline-flex p-3 rounded-xl bg-primary/10 text-primary mb-4">
                    <Building2 className="w-8 h-8" />
                  </div>
                  <h2 className="text-xl font-semibold text-foreground mb-2">
                    Create Your Organization
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Choose a name for your organization. You can change this later.
                  </p>
                </div>

                <form onSubmit={handleCreateOrg} className="space-y-5">
                  {error && (
                    <div className="p-4 text-sm text-red-400 bg-red-500/10 rounded-xl border border-red-500/20 flex items-start gap-3">
                      <div className="w-2 h-2 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />
                      {error}
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground">
                      Organization Name
                    </label>
                    <input
                      type="text"
                      placeholder="My Company"
                      value={organizationName}
                      onChange={(e) => setOrganizationName(e.target.value)}
                      required
                      maxLength={255}
                      className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all placeholder:text-muted-foreground/50"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading || !organizationName.trim()}
                    className="w-full py-3 px-4 bg-gradient-to-r from-primary to-cyan-400 text-primary-foreground font-semibold rounded-xl hover:shadow-lg hover:shadow-primary/30 transition-all duration-300 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none flex items-center justify-center gap-2"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        Create Organization
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>
              </>
            )}

            {step === "join" && (
              <>
                <button
                  onClick={() => {
                    setStep("choose");
                    setError(null);
                  }}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </button>

                <div className="text-center mb-6">
                  <div className="inline-flex p-3 rounded-xl bg-accent/10 text-accent mb-4">
                    <Users className="w-8 h-8" />
                  </div>
                  <h2 className="text-xl font-semibold text-foreground mb-2">
                    Join Organization
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Enter the invite code you received from your team admin.
                  </p>
                </div>

                <form onSubmit={handleJoinOrg} className="space-y-5">
                  {error && (
                    <div className="p-4 text-sm text-red-400 bg-red-500/10 rounded-xl border border-red-500/20 flex items-start gap-3">
                      <div className="w-2 h-2 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />
                      {error}
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground">
                      Invite Code
                    </label>
                    <input
                      type="text"
                      placeholder="Enter your invite code"
                      value={inviteToken}
                      onChange={(e) => setInviteToken(e.target.value)}
                      required
                      className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-accent/50 focus:ring-2 focus:ring-accent/20 focus:outline-none transition-all placeholder:text-muted-foreground/50 font-mono"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading || !inviteToken.trim()}
                    className="w-full py-3 px-4 bg-gradient-to-r from-accent to-purple-400 text-accent-foreground font-semibold rounded-xl hover:shadow-lg hover:shadow-accent/30 transition-all duration-300 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none flex items-center justify-center gap-2"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Joining...
                      </>
                    ) : (
                      <>
                        Join Organization
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

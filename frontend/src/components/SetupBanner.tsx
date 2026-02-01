import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle, X, Ticket, GitBranch, Bot, ArrowRight, Loader2 } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface SetupStatus {
  issueTracker: {
    configured: boolean;
    provider: string | null;
  };
  scm: {
    configured: boolean;
    provider: string | null;
  };
  aiProvider: {
    configured: boolean;
    providers: string[];
  };
  complete: boolean;
  completedSteps: number;
  totalSteps: number;
}

export function SetupBanner() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetchSetupStatus();
  }, []);

  const fetchSetupStatus = async () => {
    try {
      const token = localStorage.getItem("accessToken");

      // Fetch integrations status from existing endpoint
      const integrationsResponse = await fetch(`${API_BASE}/api/settings/integrations`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      // Fetch providers status from existing endpoint
      const providersResponse = await fetch(`${API_BASE}/api/settings/providers`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!integrationsResponse.ok || !providersResponse.ok) {
        throw new Error("Failed to fetch status");
      }

      const integrations = await integrationsResponse.json();
      const providersData = await providersResponse.json();

      // Determine issue tracker status
      const jiraConfigured = integrations.jira?.configured || false;
      const linearConfigured = integrations.linear?.configured || false;
      const issueTrackerConfigured = jiraConfigured || linearConfigured;
      let issueTrackerProvider: string | null = null;
      if (jiraConfigured) issueTrackerProvider = "Jira";
      else if (linearConfigured) issueTrackerProvider = "Linear";

      // Determine SCM status
      const githubConfigured = integrations.github?.configured || false;
      const bitbucketConfigured = integrations.bitbucket?.configured || false;
      const gitlabConfigured = integrations.gitlab?.configured || false;
      const scmConfigured = githubConfigured || bitbucketConfigured || gitlabConfigured;
      let scmProvider: string | null = null;
      if (githubConfigured) scmProvider = "GitHub";
      else if (bitbucketConfigured) scmProvider = "Bitbucket";
      else if (gitlabConfigured) scmProvider = "GitLab";

      // Determine AI provider status
      const configuredProviders: string[] = [];
      const providers = providersData.providers || [];
      for (const p of providers) {
        if (p.configured && ["anthropic", "openai", "google"].includes(p.id)) {
          const name = p.id === "anthropic" ? "Anthropic" : p.id === "openai" ? "OpenAI" : "Google";
          configuredProviders.push(name);
        }
      }
      const aiProviderConfigured = configuredProviders.length > 0;

      // Calculate completion
      let completedSteps = 0;
      if (issueTrackerConfigured) completedSteps++;
      if (scmConfigured) completedSteps++;
      if (aiProviderConfigured) completedSteps++;

      const totalSteps = 3;
      const complete = completedSteps === totalSteps;

      setStatus({
        issueTracker: { configured: issueTrackerConfigured, provider: issueTrackerProvider },
        scm: { configured: scmConfigured, provider: scmProvider },
        aiProvider: { configured: aiProviderConfigured, providers: configuredProviders },
        complete,
        completedSteps,
        totalSteps,
      });
    } catch {
      // Silently fail - banner just won't show
    } finally {
      setLoading(false);
    }
  };

  // Don't show if loading, dismissed, or setup is complete
  if (loading || dismissed || !status || status.complete) {
    return null;
  }

  const progressPercent = (status.completedSteps / status.totalSteps) * 100;

  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1">
          <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <h3 className="font-medium text-foreground mb-1">
              Complete your setup to start using AI workers
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {status.completedSteps} of {status.totalSteps} integrations configured.
              Complete the remaining steps to run your first workload.
            </p>

            {/* Progress Bar */}
            <div className="mb-4">
              <div className="h-2 bg-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            {/* Checklist */}
            <div className="space-y-2 mb-4">
              <SetupCheckItem
                label="Issue Tracker"
                description={status.issueTracker.configured ? `Connected to ${status.issueTracker.provider}` : "Connect Jira or Linear"}
                configured={status.issueTracker.configured}
                icon={Ticket}
              />
              <SetupCheckItem
                label="Source Control"
                description={status.scm.configured ? `Connected to ${status.scm.provider}` : "Connect GitHub or Bitbucket"}
                configured={status.scm.configured}
                icon={GitBranch}
              />
              <SetupCheckItem
                label="AI Provider"
                description={status.aiProvider.configured ? `Configured: ${status.aiProvider.providers.join(", ")}` : "Configure Anthropic, OpenAI, or Google"}
                configured={status.aiProvider.configured}
                icon={Bot}
              />
            </div>

            <Link
              to="/setup"
              className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 text-black font-medium rounded-lg hover:bg-amber-400 transition-colors"
            >
              Continue Setup
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Dismiss"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

interface SetupCheckItemProps {
  label: string;
  description: string;
  configured: boolean;
  icon: React.ComponentType<{ className?: string }>;
}

function SetupCheckItem({ label, description, configured, icon: Icon }: SetupCheckItemProps) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center ${
          configured ? "bg-green-500/20" : "bg-border"
        }`}
      >
        {configured ? (
          <CheckCircle className="w-4 h-4 text-green-500" />
        ) : (
          <Icon className="w-3 h-3 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1">
        <span className={`text-sm ${configured ? "text-muted-foreground line-through" : "text-foreground"}`}>
          {label}
        </span>
        <span className="text-xs text-muted-foreground ml-2">{description}</span>
      </div>
    </div>
  );
}

// Compact version for sidebar or smaller areas
export function SetupProgress() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSetupStatus();
  }, []);

  const fetchSetupStatus = async () => {
    try {
      const token = localStorage.getItem("accessToken");

      // Fetch integrations status from existing endpoint
      const integrationsResponse = await fetch(`${API_BASE}/api/settings/integrations`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      // Fetch providers status from existing endpoint
      const providersResponse = await fetch(`${API_BASE}/api/settings/providers`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!integrationsResponse.ok || !providersResponse.ok) {
        throw new Error("Failed to fetch status");
      }

      const integrations = await integrationsResponse.json();
      const providersData = await providersResponse.json();

      // Determine issue tracker status
      const jiraConfigured = integrations.jira?.configured || false;
      const linearConfigured = integrations.linear?.configured || false;
      const issueTrackerConfigured = jiraConfigured || linearConfigured;

      // Determine SCM status
      const githubConfigured = integrations.github?.configured || false;
      const bitbucketConfigured = integrations.bitbucket?.configured || false;
      const gitlabConfigured = integrations.gitlab?.configured || false;
      const scmConfigured = githubConfigured || bitbucketConfigured || gitlabConfigured;

      // Determine AI provider status
      const providers = providersData.providers || [];
      const aiProviderConfigured = providers.some(
        (p: { id: string; configured: boolean }) =>
          p.configured && ["anthropic", "openai", "google"].includes(p.id)
      );

      // Calculate completion
      let completedSteps = 0;
      if (issueTrackerConfigured) completedSteps++;
      if (scmConfigured) completedSteps++;
      if (aiProviderConfigured) completedSteps++;

      const totalSteps = 3;
      const complete = completedSteps === totalSteps;

      setStatus({
        issueTracker: { configured: issueTrackerConfigured, provider: null },
        scm: { configured: scmConfigured, provider: null },
        aiProvider: { configured: aiProviderConfigured, providers: [] },
        complete,
        completedSteps,
        totalSteps,
      });
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" />
        Loading...
      </div>
    );
  }

  if (!status || status.complete) {
    return null;
  }

  const progressPercent = (status.completedSteps / status.totalSteps) * 100;

  return (
    <Link
      to="/setup"
      className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-colors"
    >
      <AlertTriangle className="w-4 h-4 text-amber-500" />
      <div className="flex-1">
        <div className="text-xs font-medium text-foreground mb-1">
          Setup Incomplete
        </div>
        <div className="h-1.5 bg-border rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-500 transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
      <ArrowRight className="w-4 h-4 text-muted-foreground" />
    </Link>
  );
}

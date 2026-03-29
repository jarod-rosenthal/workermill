import {
  CheckCircle,
  Github,
  Kanban,
  Loader2,
  Lock,
  Router,
  XCircle,
} from "lucide-react";
import type { Settings, IntegrationStatus, AIProviderState } from "./types";

interface IntegrationsSectionProps {
  settings: Settings;
  settingsSaving?: boolean;
  orgPlan?: string;
  handleSetDefaultIssueTracker?: (provider: "jira" | "linear" | "github-issues" | "internal") => Promise<void>;
  handleSetDefaultScm?: (provider: "github" | "gitlab" | "bitbucket") => Promise<void>;
  jiraStatus: IntegrationStatus;
  githubStatus: IntegrationStatus;
  gitlabStatus: IntegrationStatus;
  bitbucketStatus: IntegrationStatus;
  slackStatus: IntegrationStatus;
  linearStatus: IntegrationStatus;
  teamsStatus: IntegrationStatus;
  awsStatus: IntegrationStatus;
  gcpStatus: IntegrationStatus;
  azureStatus: IntegrationStatus;
  anthropicProvider: AIProviderState;
  openaiProvider: AIProviderState;
  googleProvider: AIProviderState;
  openrouterProvider: AIProviderState;
  groqProvider: AIProviderState;
  deepseekProvider: AIProviderState;
  mistralProvider: AIProviderState;
  xaiProvider: AIProviderState;
  azureProvider: AIProviderState;
  mcpApiKeys: { id: string }[];
  setJiraSlideOpen: (open: boolean) => void;
  setGithubSlideOpen: (open: boolean) => void;
  setGitlabSlideOpen: (open: boolean) => void;
  setBitbucketSlideOpen: (open: boolean) => void;
  setSlackSlideOpen: (open: boolean) => void;
  setLinearSlideOpen: (open: boolean) => void;
  setTeamsSlideOpen: (open: boolean) => void;
  setAwsSlideOpen: (open: boolean) => void;
  handleAwsSlideOpen: () => void;
  setGcpSlideOpen: (open: boolean) => void;
  setAzureSlideOpen: (open: boolean) => void;
  setAnthropicSlideOpen: (open: boolean) => void;
  setOpenaiSlideOpen: (open: boolean) => void;
  setGoogleSlideOpen: (open: boolean) => void;
  setOpenrouterSlideOpen: (open: boolean) => void;
  setGroqSlideOpen: (open: boolean) => void;
  setDeepseekSlideOpen: (open: boolean) => void;
  setMistralSlideOpen: (open: boolean) => void;
  setXaiSlideOpen: (open: boolean) => void;
  setAzureOpenaiSlideOpen: (open: boolean) => void;
  setOllamaSlideOpen: (open: boolean) => void;
  setWorkermillSlideOpen: (open: boolean) => void;
  fetchMcpApiKeys: () => void;
}

function LockedOverlay() {
  return (
    <div
      className="absolute inset-0 bg-card/60 backdrop-blur-[1px] rounded-xl flex items-center justify-center z-10 group"
    >
      <div className="flex flex-col items-center gap-1.5">
        <Lock className="w-5 h-5 text-muted-foreground/60" />
        <span className="text-xs text-muted-foreground/80 font-medium">
          Coming soon
        </span>
      </div>
    </div>
  );
}

export function IntegrationsSection({
  settings,
  settingsSaving,
  orgPlan: _orgPlan,
  handleSetDefaultIssueTracker,
  handleSetDefaultScm,
  jiraStatus,
  githubStatus,
  gitlabStatus,
  bitbucketStatus,
  slackStatus,
  linearStatus,
  teamsStatus,
  awsStatus,
  gcpStatus,
  azureStatus,
  anthropicProvider,
  openaiProvider,
  googleProvider,
  openrouterProvider,
  groqProvider,
  deepseekProvider,
  mistralProvider,
  xaiProvider,
  azureProvider,
  mcpApiKeys,
  setJiraSlideOpen,
  setGithubSlideOpen,
  setGitlabSlideOpen,
  setBitbucketSlideOpen,
  setSlackSlideOpen,
  setLinearSlideOpen,
  setTeamsSlideOpen,
  setAwsSlideOpen,
  handleAwsSlideOpen,
  setGcpSlideOpen,
  setAzureSlideOpen,
  setAnthropicSlideOpen,
  setOpenaiSlideOpen,
  setGoogleSlideOpen,
  setOpenrouterSlideOpen,
  setGroqSlideOpen,
  setDeepseekSlideOpen,
  setMistralSlideOpen,
  setXaiSlideOpen,
  setAzureOpenaiSlideOpen,
  setOllamaSlideOpen,
  setWorkermillSlideOpen,
  fetchMcpApiKeys,
}: IntegrationsSectionProps) {
  const isProPlan = false; // Plan-gating removed — all features available

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-1">Integrations</h2>
        <p className="text-sm text-muted-foreground">Connect your development tools</p>
      </div>

      {/* Source Control — Required */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">Source Control</h3>
          <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-primary/10 text-primary rounded">Required</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* GitHub Card */}
        <div className={`border rounded-xl p-6 bg-card transition-colors ${settings.scmProvider === "github" ? "border-primary ring-1 ring-primary/30" : "border-border/50 hover:border-gray-500/50"}`}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-lg bg-gray-500/10 flex items-center justify-center">
              <Github className="w-7 h-7 text-foreground" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-foreground">GitHub</h3>
                {settings.scmProvider === "github" && (
                  <span className="px-2 py-0.5 text-xs font-medium bg-primary/20 text-primary rounded-full">Default</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Code & PRs</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            {githubStatus.connected ? (
              <span className="flex items-center gap-1 text-green-500 text-sm">
                <CheckCircle className="w-4 h-4" /> Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-muted-foreground text-sm">
                <XCircle className="w-4 h-4" /> Not connected
              </span>
            )}
            <div className="flex items-center gap-3">
              {settings.scmProvider === "github" ? (
                <span className="text-sm text-primary font-medium">Active</span>
              ) : githubStatus.connected ? (
                <button
                  onClick={() => handleSetDefaultScm?.("github")}
                  disabled={settingsSaving}
                  className="text-sm text-primary hover:underline disabled:opacity-50"
                >
                  {settingsSaving ? <Loader2 className="w-4 h-4 animate-spin inline" /> : null}
                  Set as Default
                </button>
              ) : null}
              <button
                onClick={() => setGithubSlideOpen(true)}
                className="text-sm text-primary hover:underline"
              >
                Configure
              </button>
            </div>
          </div>
        </div>

        {/* GitLab Card */}
        <div className={`relative border rounded-xl p-6 bg-card transition-colors ${isProPlan ? "opacity-60" : ""} ${settings.scmProvider === "gitlab" ? "border-primary ring-1 ring-primary/30" : "border-border/50 hover:border-orange-500/50"}`}>
          {isProPlan && <LockedOverlay />}
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-lg bg-orange-500/10 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-7 h-7 text-orange-500" fill="currentColor">
                <path d="m23.6 9.593-.033-.086L20.3.98a.851.851 0 0 0-.336-.405.87.87 0 0 0-.522-.153.87.87 0 0 0-.52.168.856.856 0 0 0-.314.418l-2.206 6.755H7.597L5.39.999a.855.855 0 0 0-.314-.41.862.862 0 0 0-.52-.168.87.87 0 0 0-.522.153.851.851 0 0 0-.336.405L.43 9.507l-.033.086a6.066 6.066 0 0 0 2.012 7.01l.012.009.03.022 4.98 3.727 2.462 1.863 1.5 1.134a1.01 1.01 0 0 0 1.22 0l1.5-1.134 2.462-1.863 5.01-3.749.013-.01a6.068 6.068 0 0 0 2.002-7.01z"/>
              </svg>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-foreground">GitLab</h3>
                {settings.scmProvider === "gitlab" && (
                  <span className="px-2 py-0.5 text-xs font-medium bg-primary/20 text-primary rounded-full">Default</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Code & MRs</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            {gitlabStatus.connected ? (
              <span className="flex items-center gap-1 text-green-500 text-sm">
                <CheckCircle className="w-4 h-4" /> Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-muted-foreground text-sm">
                <XCircle className="w-4 h-4" /> Not connected
              </span>
            )}
            <div className="flex items-center gap-3">
              {settings.scmProvider === "gitlab" ? (
                <span className="text-sm text-primary font-medium">Active</span>
              ) : gitlabStatus.connected ? (
                <button
                  onClick={() => handleSetDefaultScm?.("gitlab")}
                  disabled={settingsSaving}
                  className="text-sm text-primary hover:underline disabled:opacity-50"
                >
                  {settingsSaving ? <Loader2 className="w-4 h-4 animate-spin inline" /> : null}
                  Set as Default
                </button>
              ) : null}
              <button
                onClick={() => setGitlabSlideOpen(true)}
                className="text-sm text-primary hover:underline"
              >
                Configure
              </button>
            </div>
          </div>
        </div>

        {/* BitBucket Card */}
        <div className={`relative border rounded-xl p-6 bg-card transition-colors ${isProPlan ? "opacity-60" : ""} ${settings.scmProvider === "bitbucket" ? "border-primary ring-1 ring-primary/30" : "border-border/50 hover:border-blue-600/50"}`}>
          {isProPlan && <LockedOverlay />}
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-lg bg-blue-600/10 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-7 h-7 text-blue-600" fill="currentColor">
                <path d="M.778 1.211a.768.768 0 0 0-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 0 0 .77-.646l3.27-20.03a.768.768 0 0 0-.768-.891zM14.52 15.53H9.522L8.17 8.466h7.561z"/>
              </svg>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-foreground">BitBucket</h3>
                {settings.scmProvider === "bitbucket" && (
                  <span className="px-2 py-0.5 text-xs font-medium bg-primary/20 text-primary rounded-full">Default</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Code & PRs</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            {bitbucketStatus.connected ? (
              <span className="flex items-center gap-1 text-green-500 text-sm">
                <CheckCircle className="w-4 h-4" /> Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-muted-foreground text-sm">
                <XCircle className="w-4 h-4" /> Not connected
              </span>
            )}
            <div className="flex items-center gap-3">
              {settings.scmProvider === "bitbucket" ? (
                <span className="text-sm text-primary font-medium">Active</span>
              ) : bitbucketStatus.connected ? (
                <button
                  onClick={() => handleSetDefaultScm?.("bitbucket")}
                  disabled={settingsSaving}
                  className="text-sm text-primary hover:underline disabled:opacity-50"
                >
                  {settingsSaving ? <Loader2 className="w-4 h-4 animate-spin inline" /> : null}
                  Set as Default
                </button>
              ) : null}
              <button
                onClick={() => setBitbucketSlideOpen(true)}
                className="text-sm text-primary hover:underline"
              >
                Configure
              </button>
            </div>
          </div>
        </div>
        </div>
      </div>

      {/* Issue Tracking — Recommended */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">Issue Tracking</h3>
          <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-muted text-muted-foreground rounded">Optional</span>
          <span className="text-xs text-muted-foreground">Built-in board available as default</span>
        </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Jira Card */}
        <div className={`border rounded-xl p-6 bg-card transition-colors ${settings?.issueTrackerProvider === "jira" ? "border-blue-500 ring-1 ring-blue-500/30" : "border-border/50 hover:border-blue-500/50"}`}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-7 h-7 text-blue-500" fill="currentColor">
                <path d="M11.53 2c0 2.4 1.97 4.35 4.35 4.35h1.78v1.7c0 2.4 1.94 4.34 4.34 4.35V2.84a.84.84 0 0 0-.84-.84H11.53zM6.77 6.8a4.362 4.362 0 0 0 4.34 4.34h1.8v1.72a4.362 4.362 0 0 0 4.34 4.34V7.63a.84.84 0 0 0-.83-.83H6.77zM2 11.6c0 2.4 1.94 4.35 4.35 4.35h1.78v1.7c.01 2.39 1.95 4.34 4.34 4.35v-9.57a.84.84 0 0 0-.84-.83H2z" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-foreground">Jira</h3>
                {settings?.issueTrackerProvider === "jira" && (
                  <span className="px-2 py-0.5 text-xs font-medium bg-blue-500/10 text-blue-500 rounded-full">
                    Default
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Issue tracking</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            {jiraStatus.connected ? (
              <span className="flex items-center gap-1 text-green-500 text-sm">
                <CheckCircle className="w-4 h-4" /> Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-muted-foreground text-sm">
                <XCircle className="w-4 h-4" /> Not connected
              </span>
            )}
            <div className="flex items-center gap-3">
              {settings?.issueTrackerProvider === "jira" ? (
                <span className="text-sm text-blue-500 font-medium">Active</span>
              ) : jiraStatus.connected ? (
                <button
                  onClick={() => handleSetDefaultIssueTracker?.("jira")}
                  disabled={settingsSaving}
                  className="text-sm text-primary hover:underline disabled:opacity-50"
                >
                  {settingsSaving ? <Loader2 className="w-4 h-4 animate-spin inline" /> : null}
                  Set as Default
                </button>
              ) : null}
              <button
                onClick={() => setJiraSlideOpen(true)}
                className="text-sm text-primary hover:underline"
              >
                Configure
              </button>
            </div>
          </div>
        </div>

        {/* Linear Card */}
        <div className={`relative border rounded-xl p-6 bg-card transition-colors ${isProPlan ? "opacity-60" : ""} ${settings?.issueTrackerProvider === "linear" ? "border-indigo-500 ring-1 ring-indigo-500/30" : "border-border/50 hover:border-indigo-500/50"}`}>
          {isProPlan && <LockedOverlay />}
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-lg bg-indigo-500/10 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-7 h-7 text-indigo-500" fill="currentColor">
                <path d="M3 7.5V3h4.5L3 7.5zm0 0L12 16.5 21 7.5V3h-4.5L12 7.5 7.5 3H3v4.5zM21 7.5L12 16.5 3 7.5v9L12 21l9-4.5v-9z" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-foreground">Linear</h3>
                {settings?.issueTrackerProvider === "linear" && (
                  <span className="px-2 py-0.5 text-xs font-medium bg-indigo-500/10 text-indigo-500 rounded-full">
                    Default
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Issue tracking</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            {linearStatus.connected ? (
              <span className="flex items-center gap-1 text-green-500 text-sm">
                <CheckCircle className="w-4 h-4" /> Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-muted-foreground text-sm">
                <XCircle className="w-4 h-4" /> Not connected
              </span>
            )}
            <div className="flex items-center gap-3">
              {settings?.issueTrackerProvider === "linear" ? (
                <span className="text-sm text-indigo-500 font-medium">Active</span>
              ) : linearStatus.connected ? (
                <button
                  onClick={() => handleSetDefaultIssueTracker?.("linear")}
                  disabled={settingsSaving}
                  className="text-sm text-primary hover:underline disabled:opacity-50"
                >
                  {settingsSaving ? <Loader2 className="w-4 h-4 animate-spin inline" /> : null}
                  Set as Default
                </button>
              ) : null}
              <button
                onClick={() => setLinearSlideOpen(true)}
                className="text-sm text-primary hover:underline"
              >
                Configure
              </button>
            </div>
          </div>
        </div>

        {/* GitHub Issues Card */}
        <div className={`border rounded-xl p-6 bg-card transition-colors ${settings?.issueTrackerProvider === "github-issues" ? "border-gray-500 ring-1 ring-gray-500/30" : "border-border/50 hover:border-gray-500/50"}`}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-lg bg-gray-500/10 flex items-center justify-center">
              <Github className="w-7 h-7 text-gray-500" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-foreground">GitHub Issues</h3>
                {settings?.issueTrackerProvider === "github-issues" && (
                  <span className="px-2 py-0.5 text-xs font-medium bg-gray-500/10 text-gray-500 rounded-full">
                    Default
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Issue tracking via GitHub</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            {githubStatus.connected ? (
              <span className="flex items-center gap-1 text-green-500 text-sm">
                <CheckCircle className="w-4 h-4" /> Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-muted-foreground text-sm">
                <XCircle className="w-4 h-4" /> Not connected
              </span>
            )}
            {settings?.issueTrackerProvider === "github-issues" ? (
              <span className="text-sm text-gray-500 font-medium">Active</span>
            ) : githubStatus.connected ? (
              <button
                onClick={() => handleSetDefaultIssueTracker?.("github-issues")}
                disabled={settingsSaving}
                className="text-sm text-primary hover:underline disabled:opacity-50"
              >
                {settingsSaving ? <Loader2 className="w-4 h-4 animate-spin inline" /> : null}
                Set as Default
              </button>
            ) : null}
          </div>
        </div>

        {/* Internal Board Card */}
        <div className={`border rounded-xl p-6 bg-card transition-colors ${settings?.issueTrackerProvider === "internal" ? "border-emerald-500 ring-1 ring-emerald-500/30" : "border-border/50 hover:border-emerald-500/50"}`}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Kanban className="w-7 h-7 text-emerald-500" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-foreground">Internal Board</h3>
                {settings?.issueTrackerProvider === "internal" && (
                  <span className="px-2 py-0.5 text-xs font-medium bg-emerald-500/10 text-emerald-500 rounded-full">
                    Default
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Built-in issue tracking</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 text-green-500 text-sm">
              <CheckCircle className="w-4 h-4" /> Available
            </span>
            {settings?.issueTrackerProvider === "internal" ? (
              <span className="text-sm text-emerald-500 font-medium">Active</span>
            ) : (
              <button
                onClick={() => handleSetDefaultIssueTracker?.("internal")}
                disabled={settingsSaving}
                className="text-sm text-primary hover:underline disabled:opacity-50"
              >
                {settingsSaving ? <Loader2 className="w-4 h-4 animate-spin inline" /> : null}
                Set as Default
              </button>
            )}
          </div>
        </div>
      </div>
      </div>

      {/* Notifications — Optional */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">Notifications</h3>
          <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-muted text-muted-foreground rounded">Optional</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Slack Card */}
        <div className={`relative border border-border/50 rounded-xl p-6 bg-card transition-colors ${isProPlan ? "opacity-60" : "hover:border-purple-500/50"}`}>
          {isProPlan && <LockedOverlay />}
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-7 h-7 text-purple-500" fill="currentColor">
                <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground">Slack</h3>
              <p className="text-xs text-muted-foreground">Notifications</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            {slackStatus.connected ? (
              <span className="flex items-center gap-1 text-green-500 text-sm">
                <CheckCircle className="w-4 h-4" /> Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-muted-foreground text-sm">
                <XCircle className="w-4 h-4" /> Not connected
              </span>
            )}
            <button
              onClick={() => setSlackSlideOpen(true)}
              className="text-sm text-primary hover:underline"
            >
              Configure
            </button>
          </div>
        </div>

        {/* Microsoft Teams Card */}
        <div className={`relative border border-border/50 rounded-xl p-6 bg-card transition-colors ${isProPlan ? "opacity-60" : "hover:border-violet-500/50"}`}>
          {isProPlan && <LockedOverlay />}
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-lg bg-violet-500/10 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-7 h-7 text-violet-500" fill="currentColor">
                <path d="M19.2 7.8h-4.8V6c0-1.1.9-2 2-2s2 .9 2 2v1.8h.8c.9 0 1.6.7 1.6 1.6v5.2c0 .9-.7 1.6-1.6 1.6h-.8v1.8c0 1.1-.9 2-2 2s-2-.9-2-2v-1.8H9.6v1.8c0 1.1-.9 2-2 2s-2-.9-2-2v-1.8h-.8c-.9 0-1.6-.7-1.6-1.6V9.4c0-.9.7-1.6 1.6-1.6h.8V6c0-1.1.9-2 2-2s2 .9 2 2v1.8h4.8V6c0-1.1.9-2 2-2s2 .9 2 2v1.8zM9.6 14.6v-5.2H4.8v5.2h4.8zm9.6 0v-5.2h-4.8v5.2h4.8z"/>
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground">Microsoft Teams</h3>
              <p className="text-xs text-muted-foreground">Notifications</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            {teamsStatus.connected ? (
              <span className="flex items-center gap-1 text-green-500 text-sm">
                <CheckCircle className="w-4 h-4" /> Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-muted-foreground text-sm">
                <XCircle className="w-4 h-4" /> Not connected
              </span>
            )}
            <button
              onClick={() => setTeamsSlideOpen(true)}
              className="text-sm text-primary hover:underline"
            >
              Configure
            </button>
          </div>
        </div>
        </div>
      </div>

      {/* Cloud Providers Section */}
      <div className="mt-8">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-lg font-semibold text-foreground">Cloud Providers</h3>
          <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-muted text-muted-foreground rounded">Optional</span>
        </div>
        <p className="text-sm text-muted-foreground mb-4">Configure cloud credentials for worker deployment</p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* AWS Card */}
          <div className={`relative border border-border/50 rounded-xl p-6 bg-card transition-colors ${isProPlan ? "opacity-60" : "hover:border-orange-500/50"}`}>
            {isProPlan && <LockedOverlay />}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-orange-500/10 flex items-center justify-center">
                {/* AWS Cloud icon */}
                <svg viewBox="0 0 24 24" className="w-7 h-7 text-orange-500" fill="currentColor">
                  <path d="M18.75 11.35a4.32 4.32 0 0 1-.79-.08 3.9 3.9 0 0 0 .49-1.9 3.97 3.97 0 0 0-3.97-3.97 4.01 4.01 0 0 0-1.77.41 5.22 5.22 0 0 0-9.71 2.65c0 .2.02.4.04.59A3.97 3.97 0 0 0 3.97 13a3.97 3.97 0 0 0 3.97 3.97h10.81a3.97 3.97 0 0 0 0-7.94v2.32z"/>
                  <path d="M7.55 14.3a.43.43 0 0 1-.22-.4V9.17a.43.43 0 0 1 .65-.37l3.93 2.37a.43.43 0 0 1 0 .74l-3.93 2.37a.43.43 0 0 1-.43.02z"/>
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">AWS</h3>
                <p className="text-xs text-muted-foreground">Amazon Web Services</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              {awsStatus.connected ? (
                <span className="flex items-center gap-1 text-green-500 text-sm">
                  <CheckCircle className="w-4 h-4" /> Configured
                </span>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground text-sm">
                  <XCircle className="w-4 h-4" /> Not configured
                </span>
              )}
              <button
                onClick={handleAwsSlideOpen}
                className="text-sm text-primary hover:underline"
              >
                Configure
              </button>
            </div>
          </div>

          {/* GCP Card */}
          <div className={`relative border border-border/50 rounded-xl p-6 bg-card transition-colors ${isProPlan ? "opacity-60" : "hover:border-blue-500/50"}`}>
            {isProPlan && <LockedOverlay />}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <svg viewBox="0 0 24 24" className="w-7 h-7 text-blue-500" fill="currentColor">
                  <path d="M12.19 2.38a9.344 9.344 0 0 0-9.234 6.893c.053-.02-.055.013 0 0-3.875 2.551-3.922 8.11-.247 10.941l.006-.007-.007.03a6.717 6.717 0 0 0 4.077 1.356h5.173l.03.03h5.192c6.687.053 9.376-8.605 3.835-12.35a9.365 9.365 0 0 0-8.825-6.893zM8.073 19.439a4.609 4.609 0 0 1-2.187-3.712 4.609 4.609 0 0 1 2.187-3.712l2.56 1.506-2.56 5.918zm2.56-7.46L8.073 10.5a4.609 4.609 0 0 1 4.374 0l-2.56 1.506.746-.027zm4.327 7.46l-2.56-1.506 2.56-5.918a4.609 4.609 0 0 1 2.187 3.712 4.609 4.609 0 0 1-2.187 3.712z"/>
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">Google Cloud</h3>
                <p className="text-xs text-muted-foreground">GCP</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              {gcpStatus.connected ? (
                <span className="flex items-center gap-1 text-green-500 text-sm">
                  <CheckCircle className="w-4 h-4" /> Configured
                </span>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground text-sm">
                  <XCircle className="w-4 h-4" /> Not configured
                </span>
              )}
              <button
                onClick={() => setGcpSlideOpen(true)}
                className="text-sm text-primary hover:underline"
              >
                Configure
              </button>
            </div>
          </div>

          {/* Azure Card */}
          <div className={`relative border border-border/50 rounded-xl p-6 bg-card transition-colors ${isProPlan ? "opacity-60" : "hover:border-cyan-500/50"}`}>
            {isProPlan && <LockedOverlay />}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                <svg viewBox="0 0 24 24" className="w-7 h-7 text-cyan-500" fill="currentColor">
                  <path d="M13.05 4.24L6.56 18.05a.5.5 0 0 0 .46.7h11.96a.5.5 0 0 0 .46-.7l-6.49-13.81a.5.5 0 0 0-.9 0zM5.68 8.37L2.04 17.8a.5.5 0 0 0 .46.7h5.4a.5.5 0 0 0 .46-.3l2.64-5.61L8.03 8.37a.5.5 0 0 0-.9 0l-1.45 3.08-.46-1a.5.5 0 0 0-.54-.08z"/>
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">Azure</h3>
                <p className="text-xs text-muted-foreground">Microsoft Azure</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              {azureStatus.connected ? (
                <span className="flex items-center gap-1 text-green-500 text-sm">
                  <CheckCircle className="w-4 h-4" /> Configured
                </span>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground text-sm">
                  <XCircle className="w-4 h-4" /> Not configured
                </span>
              )}
              <button
                onClick={() => setAzureSlideOpen(true)}
                className="text-sm text-primary hover:underline"
              >
                Configure
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* AI Providers Section */}
      <div className="mt-8">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-lg font-semibold text-foreground">AI Providers</h3>
          <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-primary/10 text-primary rounded">Required</span>
          {isProPlan && <span className="text-xs text-muted-foreground">(Anthropic included on Pro)</span>}
        </div>
        <p className="text-sm text-muted-foreground mb-4">Configure at least one AI provider API key</p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Anthropic Card */}
          <div className="border border-border/50 rounded-xl p-6 bg-card hover:border-orange-500/50 transition-colors">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-orange-500/10 flex items-center justify-center">
                <span className="text-2xl">🤖</span>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">Anthropic</h3>
                <p className="text-xs text-muted-foreground">Claude models</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              {anthropicProvider.status.configured ? (
                <span className="flex items-center gap-1 text-green-500 text-sm">
                  <CheckCircle className="w-4 h-4" /> Configured
                </span>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground text-sm">
                  <XCircle className="w-4 h-4" /> Not configured
                </span>
              )}
              <button
                onClick={() => setAnthropicSlideOpen(true)}
                className="text-sm text-primary hover:underline"
              >
                Configure
              </button>
            </div>
          </div>

          {/* OpenAI Card */}
          <div className={`relative border border-border/50 rounded-xl p-6 bg-card transition-colors ${isProPlan ? "opacity-60" : "hover:border-emerald-500/50"}`}>
            {isProPlan && <LockedOverlay />}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <span className="text-2xl">🔷</span>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">OpenAI</h3>
                <p className="text-xs text-muted-foreground">GPT models</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              {openaiProvider.status.configured ? (
                <span className="flex items-center gap-1 text-green-500 text-sm">
                  <CheckCircle className="w-4 h-4" /> Configured
                </span>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground text-sm">
                  <XCircle className="w-4 h-4" /> Not configured
                </span>
              )}
              <button
                onClick={() => setOpenaiSlideOpen(true)}
                className="text-sm text-primary hover:underline"
              >
                Configure
              </button>
            </div>
          </div>

          {/* Google Card */}
          <div className={`relative border border-border/50 rounded-xl p-6 bg-card transition-colors ${isProPlan ? "opacity-60" : "hover:border-blue-500/50"}`}>
            {isProPlan && <LockedOverlay />}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <span className="text-2xl">🔵</span>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">Google</h3>
                <p className="text-xs text-muted-foreground">Gemini models</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              {googleProvider.status.configured ? (
                <span className="flex items-center gap-1 text-green-500 text-sm">
                  <CheckCircle className="w-4 h-4" /> Configured
                </span>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground text-sm">
                  <XCircle className="w-4 h-4" /> Not configured
                </span>
              )}
              <button
                onClick={() => setGoogleSlideOpen(true)}
                className="text-sm text-primary hover:underline"
              >
                Configure
              </button>
            </div>
          </div>

          {/* OpenRouter Card */}
          <div className={`relative border border-border/50 rounded-xl p-6 bg-card transition-colors ${isProPlan ? "opacity-60" : "hover:border-cyan-500/50"}`}>
            {isProPlan && <LockedOverlay />}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                <span className="text-2xl">🔀</span>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">OpenRouter</h3>
                <p className="text-xs text-muted-foreground">300+ models</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              {openrouterProvider.status.configured ? (
                <span className="flex items-center gap-1 text-green-500 text-sm">
                  <CheckCircle className="w-4 h-4" /> Configured
                </span>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground text-sm">
                  <XCircle className="w-4 h-4" /> Not configured
                </span>
              )}
              <button
                onClick={() => setOpenrouterSlideOpen(true)}
                className="text-sm text-primary hover:underline"
              >
                Configure
              </button>
            </div>
          </div>

          {/* Groq Card */}
          <div className={`relative border border-border/50 rounded-xl p-6 bg-card transition-colors ${isProPlan ? "opacity-60" : "hover:border-yellow-500/50"}`}>
            {isProPlan && <LockedOverlay />}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                <span className="text-2xl">⚡</span>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">Groq</h3>
                <p className="text-xs text-muted-foreground">Ultra-fast inference</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              {groqProvider.status.configured ? (
                <span className="flex items-center gap-1 text-green-500 text-sm">
                  <CheckCircle className="w-4 h-4" /> Configured
                </span>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground text-sm">
                  <XCircle className="w-4 h-4" /> Not configured
                </span>
              )}
              <button
                onClick={() => setGroqSlideOpen(true)}
                className="text-sm text-primary hover:underline"
              >
                Configure
              </button>
            </div>
          </div>

          {/* DeepSeek Card */}
          <div className={`relative border border-border/50 rounded-xl p-6 bg-card transition-colors ${isProPlan ? "opacity-60" : "hover:border-teal-500/50"}`}>
            {isProPlan && <LockedOverlay />}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-teal-500/10 flex items-center justify-center">
                <span className="text-2xl">🔍</span>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">DeepSeek</h3>
                <p className="text-xs text-muted-foreground">Reasoning models</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              {deepseekProvider.status.configured ? (
                <span className="flex items-center gap-1 text-green-500 text-sm">
                  <CheckCircle className="w-4 h-4" /> Configured
                </span>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground text-sm">
                  <XCircle className="w-4 h-4" /> Not configured
                </span>
              )}
              <button
                onClick={() => setDeepseekSlideOpen(true)}
                className="text-sm text-primary hover:underline"
              >
                Configure
              </button>
            </div>
          </div>

          {/* Mistral Card */}
          <div className={`relative border border-border/50 rounded-xl p-6 bg-card transition-colors ${isProPlan ? "opacity-60" : "hover:border-indigo-500/50"}`}>
            {isProPlan && <LockedOverlay />}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                <span className="text-2xl">🌀</span>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">Mistral AI</h3>
                <p className="text-xs text-muted-foreground">European AI leader</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              {mistralProvider.status.configured ? (
                <span className="flex items-center gap-1 text-green-500 text-sm">
                  <CheckCircle className="w-4 h-4" /> Configured
                </span>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground text-sm">
                  <XCircle className="w-4 h-4" /> Not configured
                </span>
              )}
              <button
                onClick={() => setMistralSlideOpen(true)}
                className="text-sm text-primary hover:underline"
              >
                Configure
              </button>
            </div>
          </div>

          {/* xAI Card */}
          <div className={`relative border border-border/50 rounded-xl p-6 bg-card transition-colors ${isProPlan ? "opacity-60" : "hover:border-gray-500/50"}`}>
            {isProPlan && <LockedOverlay />}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-gray-500/10 flex items-center justify-center">
                <span className="text-2xl font-bold">𝕏</span>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">xAI</h3>
                <p className="text-xs text-muted-foreground">Grok models</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              {xaiProvider.status.configured ? (
                <span className="flex items-center gap-1 text-green-500 text-sm">
                  <CheckCircle className="w-4 h-4" /> Configured
                </span>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground text-sm">
                  <XCircle className="w-4 h-4" /> Not configured
                </span>
              )}
              <button
                onClick={() => setXaiSlideOpen(true)}
                className="text-sm text-primary hover:underline"
              >
                Configure
              </button>
            </div>
          </div>

          {/* AWS Bedrock Card */}
          <div className={`relative border border-border/50 rounded-xl p-6 bg-card transition-colors ${isProPlan ? "opacity-60" : "hover:border-orange-400/50"}`}>
            {isProPlan && <LockedOverlay />}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-orange-400/10 flex items-center justify-center">
                <span className="text-2xl">☁️</span>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">AWS Bedrock</h3>
                <p className="text-xs text-muted-foreground">Claude, Llama, Mistral</p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                Uses AWS credentials from Cloud Providers
              </p>
              <div className="flex items-center justify-between">
                {awsStatus.connected ? (
                  <span className="flex items-center gap-1 text-green-500 text-sm">
                    <CheckCircle className="w-4 h-4" /> Ready
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-muted-foreground text-sm">
                    <XCircle className="w-4 h-4" /> AWS not configured
                  </span>
                )}
                <button
                  onClick={() => setAwsSlideOpen(true)}
                  className="text-sm text-primary hover:underline"
                >
                  {awsStatus.connected ? "View AWS" : "Configure AWS"}
                </button>
              </div>
            </div>
          </div>

          {/* Azure AI Foundry Card */}
          <div className={`relative border border-border/50 rounded-xl p-6 bg-card transition-colors ${isProPlan ? "opacity-60" : "hover:border-sky-500/50"}`}>
            {isProPlan && <LockedOverlay />}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-sky-500/10 flex items-center justify-center">
                <span className="text-2xl">🔶</span>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">Azure AI Foundry</h3>
                <p className="text-xs text-muted-foreground">GPT-4o, o1, multi-model</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              {azureProvider.status.configured ? (
                <span className="flex items-center gap-1 text-green-500 text-sm">
                  <CheckCircle className="w-4 h-4" /> Configured
                </span>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground text-sm">
                  <XCircle className="w-4 h-4" /> Not configured
                </span>
              )}
              <button
                onClick={() => setAzureOpenaiSlideOpen(true)}
                className="text-sm text-primary hover:underline"
              >
                Configure
              </button>
            </div>
          </div>

          {/* Ollama Card */}
          <div className={`relative border border-border/50 rounded-xl p-6 bg-card transition-colors ${isProPlan ? "opacity-60" : "hover:border-purple-500/50"}`}>
            {isProPlan && <LockedOverlay />}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <span className="text-2xl">🏠</span>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">Ollama</h3>
                <p className="text-xs text-muted-foreground">Local models</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              {settings.ollamaBaseUrl ? (
                <span className="flex items-center gap-1 text-green-500 text-sm">
                  <CheckCircle className="w-4 h-4" /> Configured
                </span>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground text-sm">
                  <XCircle className="w-4 h-4" /> Not configured
                </span>
              )}
              <button
                onClick={() => setOllamaSlideOpen(true)}
                className="text-sm text-primary hover:underline"
              >
                Configure
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* API Access Section */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold text-foreground mb-1">API Access</h3>
        <p className="text-sm text-muted-foreground mb-4">Generate API keys for programmatic access and MCP integrations</p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* WorkerMill MCP Card */}
          <div className="border border-border/50 rounded-xl p-6 bg-card hover:border-primary/50 transition-colors">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Router className="w-7 h-7 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">WorkerMill</h3>
                <p className="text-xs text-muted-foreground">MCP Server</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              {mcpApiKeys.length > 0 ? (
                <span className="flex items-center gap-1 text-green-500 text-sm">
                  <CheckCircle className="w-4 h-4" /> {mcpApiKeys.length} key{mcpApiKeys.length !== 1 ? "s" : ""}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground text-sm">
                  <XCircle className="w-4 h-4" /> No keys
                </span>
              )}
              <button
                onClick={() => {
                  setWorkermillSlideOpen(true);
                  fetchMcpApiKeys();
                }}
                className="text-sm text-primary hover:underline"
              >
                Configure
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

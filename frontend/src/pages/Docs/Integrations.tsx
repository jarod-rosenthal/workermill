import {
  GitBranch,
  Ticket,
  ArrowRight,
  Check,
  GitPullRequest,
  MessageSquare,
  RefreshCw,
  Brain,

  MessageCircle,
  Bell,
  Cloud,
  Monitor,
} from "lucide-react";

export default function Integrations() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">Integrations</h1>
        <p className="text-muted-foreground">
          WorkerMill connects your issue trackers, SCM providers, AI models,
          and notification systems into an automated development pipeline.
        </p>
      </div>

      {/* Integration Flow */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">How It Works</h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="text-center">
              <div className="w-16 h-16 rounded-xl bg-blue-500/10 flex items-center justify-center mx-auto mb-2">
                <Ticket className="w-8 h-8 text-blue-500" />
              </div>
              <div className="font-medium text-foreground">Issue Tracker</div>
              <div className="text-xs text-muted-foreground">Jira, Linear, GitHub</div>
            </div>
            <ArrowRight className="w-6 h-6 text-muted-foreground rotate-90 md:rotate-0" />
            <div className="text-center">
              <div className="w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-2">
                <RefreshCw className="w-8 h-8 text-primary" />
              </div>
              <div className="font-medium text-foreground">WorkerMill</div>
              <div className="text-xs text-muted-foreground">AI Worker Executes</div>
            </div>
            <ArrowRight className="w-6 h-6 text-muted-foreground rotate-90 md:rotate-0" />
            <div className="text-center">
              <div className="w-16 h-16 rounded-xl bg-gray-500/10 flex items-center justify-center mx-auto mb-2">
                <GitPullRequest className="w-8 h-8 text-gray-400" />
              </div>
              <div className="font-medium text-foreground">SCM Provider</div>
              <div className="text-xs text-muted-foreground">GitHub, GitLab, BitBucket</div>
            </div>
            <ArrowRight className="w-6 h-6 text-muted-foreground rotate-90 md:rotate-0" />
            <div className="text-center">
              <div className="w-16 h-16 rounded-xl bg-green-500/10 flex items-center justify-center mx-auto mb-2">
                <Bell className="w-8 h-8 text-green-500" />
              </div>
              <div className="font-medium text-foreground">Notifications</div>
              <div className="text-xs text-muted-foreground">Slack, Email</div>
            </div>
          </div>
        </div>
      </section>

      {/* AI Providers */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Brain className="w-5 h-5 text-purple-500" />
          AI Providers
        </h2>
        <div className="bg-card border border-purple-500/30 rounded-xl p-6 space-y-6">
          <p className="text-muted-foreground">
            WorkerMill works with <strong className="text-foreground">all major AI providers</strong>.
            Choose the provider and model that best fits your needs, or configure per-persona provider routing
            for maximum flexibility.
          </p>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { name: "Anthropic Claude", models: "Opus 4.6, Sonnet 4.6, Haiku 4.5", color: "text-orange-400", desc: "Best for complex coding tasks" },
              { name: "OpenAI", models: "GPT-4o, o3-mini, o1", color: "text-green-400", desc: "Strong general purpose" },
              { name: "Google Gemini", models: "Gemini 3 Pro, Gemini 2.0 Flash", color: "text-blue-400", desc: "Fast and efficient" },
              { name: "Ollama", models: "Llama, Qwen, DeepSeek", color: "text-purple-400", desc: "Self-hosted models" },
            ].map((provider) => (
              <div key={provider.name} className="bg-background rounded-lg p-4 border border-border">
                <div className={`font-medium ${provider.color} mb-1`}>{provider.name}</div>
                <div className="text-xs text-muted-foreground mb-2">{provider.models}</div>
                <div className="text-xs text-muted-foreground/70">{provider.desc}</div>
              </div>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-background rounded-lg p-4 border border-border">
              <h4 className="text-sm font-medium text-foreground mb-2">Bring Your Own API Key</h4>
              <p className="text-sm text-muted-foreground">
                Use your own API keys for any supported provider. Full control over costs and data.
              </p>
            </div>
            <div className="bg-background rounded-lg p-4 border border-border">
              <h4 className="text-sm font-medium text-foreground mb-2">Per-Persona Provider Routing</h4>
              <p className="text-sm text-muted-foreground">
                Route different worker personas to different providers. Use flagship models for security,
                efficient models for simple tasks.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Issue Trackers */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Issue Trackers</h2>

        {/* Jira */}
        <div className="bg-card border border-blue-500/30 rounded-xl p-6 space-y-6">
          <div className="flex items-center gap-3">
            <Ticket className="w-6 h-6 text-blue-500" />
            <h3 className="text-lg font-semibold text-foreground">Jira</h3>
          </div>
          <p className="text-muted-foreground">
            WorkerMill monitors your Jira projects for tasks with the configured label and
            automatically assigns them to AI workers.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm font-medium text-foreground mb-3">Required Configuration</h4>
              <ul className="space-y-2">
                {[
                  "Jira instance URL (e.g., your-org.atlassian.net)",
                  "API token with read/write access",
                  "Project key(s) to monitor",
                  'Task label (e.g., "workermill")',
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Check className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-sm font-medium text-foreground mb-3">What WorkerMill Does</h4>
              <ul className="space-y-2">
                {[
                  "Receives webhooks for labeled tickets",
                  "Reads ticket summary, description, and comments",
                  "Updates ticket status during execution",
                  "Posts PR links and results as comments",
                  "Transitions tickets on completion",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="bg-background rounded-lg p-4 border border-border">
            <h4 className="text-sm font-medium text-foreground mb-2">Webhook URL</h4>
            <code className="text-sm text-primary">/api/webhooks/jira</code>
          </div>
        </div>

        {/* Linear */}
        <div className="bg-card border border-purple-500/30 rounded-xl p-6 space-y-6">
          <div className="flex items-center gap-3">
            <Ticket className="w-6 h-6 text-purple-500" />
            <h3 className="text-lg font-semibold text-foreground">Linear</h3>
          </div>
          <p className="text-muted-foreground">
            WorkerMill integrates with Linear for status-change events.
            Note: Linear's webhook API does not fire events when labels are added or removed,
            so Linear tasks are typically created via the dashboard <strong className="text-foreground">Run Task</strong> button
            rather than label-based triggers.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm font-medium text-foreground mb-3">Setup</h4>
              <ul className="space-y-2">
                {[
                  "Configure Linear webhook in Settings",
                  "Point webhook to /api/webhooks/linear",
                  "Create 'workermill' label in your Linear workspace",
                  "Optionally add model labels (haiku, sonnet, opus)",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Check className="w-4 h-4 text-purple-500 mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-sm font-medium text-foreground mb-3">Supported Labels</h4>
              <ul className="space-y-2">
                {[
                  "workermill - Triggers task creation",
                  "haiku / sonnet / opus - Model selection",
                  "deploy - Auto-deploy without PR approval",
                  "review - Require Tech Lead Reviewer review",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="bg-background rounded-lg p-4 border border-border">
            <h4 className="text-sm font-medium text-foreground mb-2">Webhook URL</h4>
            <code className="text-sm text-primary">/api/webhooks/linear</code>
          </div>
        </div>
      </section>

      {/* SCM Providers */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">SCM Providers</h2>

        {/* GitHub */}
        <div className="bg-card border border-gray-500/30 rounded-xl p-6 space-y-6">
          <div className="flex items-center gap-3">
            <GitBranch className="w-6 h-6 text-gray-400" />
            <h3 className="text-lg font-semibold text-foreground">GitHub</h3>
          </div>
          <p className="text-muted-foreground">
            Workers create branches and pull requests automatically for completed work.
            You can also trigger workers directly from GitHub Issues.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm font-medium text-foreground mb-3">Required Configuration</h4>
              <ul className="space-y-2">
                {[
                  "GitHub personal access token or app token",
                  "Repository URL with push permissions",
                  "Default branch for PR targets (usually main)",
                  "Webhook for PR reviews and Issues (optional)",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Check className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-sm font-medium text-foreground mb-3">What WorkerMill Does</h4>
              <ul className="space-y-2">
                {[
                  "Creates branch from ticket key (e.g., feature/PROJ-123)",
                  "Commits code changes with descriptive messages",
                  "Opens pull request with summary and test results",
                  "Links PR back to issue tracker",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="bg-background rounded-lg p-4 border border-border">
            <h4 className="text-sm font-medium text-foreground mb-2">GitHub Issues Integration</h4>
            <p className="text-sm text-muted-foreground mb-2">
              Trigger workers directly from GitHub Issues by adding the <code className="text-primary">workermill</code> label.
            </p>
            <div className="text-sm text-muted-foreground">
              Webhook URL: <code className="text-primary">/api/webhooks/github-issues</code>
            </div>
          </div>
        </div>

        {/* GitLab */}
        <div className="bg-card border border-orange-500/30 rounded-xl p-6 space-y-6">
          <div className="flex items-center gap-3">
            <GitBranch className="w-6 h-6 text-orange-500" />
            <h3 className="text-lg font-semibold text-foreground">GitLab</h3>
          </div>
          <p className="text-muted-foreground">
            WorkerMill supports GitLab as both an SCM provider and issue tracker.
            Create merge requests and trigger workers from GitLab Issues.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm font-medium text-foreground mb-3">Setup</h4>
              <ul className="space-y-2">
                {[
                  "Configure GitLab in Settings → Integrations",
                  "Add personal access token with api scope",
                  "Set up webhook to /api/webhooks/gitlab",
                  "Create 'workermill' label in your project",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Check className="w-4 h-4 text-orange-500 mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-sm font-medium text-foreground mb-3">Features</h4>
              <ul className="space-y-2">
                {[
                  "Merge request creation with descriptions",
                  "MR approval webhook handling",
                  "Self-hosted GitLab support",
                  "Same label workflow as Jira/Linear",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* BitBucket */}
        <div className="bg-card border border-blue-600/30 rounded-xl p-6 space-y-6">
          <div className="flex items-center gap-3">
            <GitBranch className="w-6 h-6 text-blue-600" />
            <h3 className="text-lg font-semibold text-foreground">BitBucket</h3>
          </div>
          <p className="text-muted-foreground">
            WorkerMill integrates with Atlassian BitBucket for teams using the Atlassian ecosystem.
            Supports both BitBucket Cloud and self-hosted BitBucket Server.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm font-medium text-foreground mb-3">Setup</h4>
              <ul className="space-y-2">
                {[
                  "Configure BitBucket in Settings → Integrations",
                  "Add Repository Access Token with repository write access",
                  "Set up webhook to /api/webhooks/bitbucket",
                  "Works with Jira for end-to-end Atlassian workflow",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Check className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-sm font-medium text-foreground mb-3">Features</h4>
              <ul className="space-y-2">
                {[
                  "Pull request creation with reviewers",
                  "PR approval webhook handling",
                  "Self-hosted BitBucket Server support",
                  "Seamless Jira + BitBucket workflow",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Notification Integrations */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Bell className="w-5 h-5 text-green-500" />
          Notifications
        </h2>

        <div className="grid md:grid-cols-3 gap-4">
          {/* Slack */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-[#4A154B]/20 flex items-center justify-center">
                <MessageSquare className="w-5 h-5 text-[#4A154B]" />
              </div>
              <h3 className="font-semibold text-foreground">Slack</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Real-time notifications to Slack channels for task updates, PR creation, and completions.
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Check className="w-4 h-4 text-green-500" />
                Incoming webhook integration
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Check className="w-4 h-4 text-green-500" />
                Customizable notifications
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Check className="w-4 h-4 text-green-500" />
                Channel-based routing
              </div>
            </div>
          </div>

          {/* Email Notifications */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <MessageCircle className="w-5 h-5 text-blue-500" />
              </div>
              <h3 className="font-semibold text-foreground">Email</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Email notifications for task completions, failures, cost alerts, and team invites.
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Check className="w-4 h-4 text-green-500" />
                Task completion & failure alerts
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Check className="w-4 h-4 text-green-500" />
                Cost budget warnings
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Check className="w-4 h-4 text-green-500" />
                Per-user notification preferences
              </div>
            </div>
          </div>

        </div>

        <div className="bg-background rounded-lg p-4 border border-border">
          <h4 className="text-sm font-medium text-foreground mb-2">Notification Events</h4>
          <div className="grid md:grid-cols-4 gap-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Check className="w-3 h-3 text-green-500" />
              Task started
            </div>
            <div className="flex items-center gap-2">
              <Check className="w-3 h-3 text-green-500" />
              PR created
            </div>
            <div className="flex items-center gap-2">
              <Check className="w-3 h-3 text-green-500" />
              Task completed
            </div>
            <div className="flex items-center gap-2">
              <Check className="w-3 h-3 text-green-500" />
              Task failed
            </div>
          </div>
        </div>
      </section>

      {/* Cloud Execution */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Cloud className="w-5 h-5 text-cyan-500" />
          Cloud Execution
        </h2>
        <p className="text-muted-foreground">
          WorkerMill runs AI workers in isolated containers. The recommended approach is the
          <strong className="text-foreground"> Remote Agent</strong>, which runs on your machine and uses
          the cloud dashboard for monitoring.
        </p>

        <div className="grid md:grid-cols-2 gap-4">
          {/* Remote Agent (Recommended) */}
          <div className="bg-card border-2 border-primary/50 rounded-xl p-5 relative">
            <div className="absolute -top-3 left-4">
              <span className="px-3 py-1 bg-primary text-primary-foreground text-xs font-semibold rounded-full">
                Recommended
              </span>
            </div>
            <div className="flex items-center gap-3 mb-4 mt-1">
              <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                <Monitor className="w-5 h-5 text-green-500" />
              </div>
              <h3 className="font-semibold text-foreground">Remote Agent</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Workers run as native processes on your machine. Code never leaves your computer.
              BYOK — bring your own API key, pay your provider directly.
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Check className="w-4 h-4 text-green-500" />
                Docker workers with full isolation
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Check className="w-4 h-4 text-green-500" />
                Cloud dashboard for monitoring
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Check className="w-4 h-4 text-green-500" />
                VS Code extension support
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Check className="w-4 h-4 text-green-500" />
                Single binary (no Node.js needed)
              </div>
            </div>
          </div>

          {/* Cloud Mode */}
          <div className="bg-card border border-yellow-500/30 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-yellow-500/20 flex items-center justify-center">
                <Cloud className="w-5 h-5 text-yellow-500" />
              </div>
              <h3 className="font-semibold text-foreground">Cloud Mode</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Workers run as managed containers in the cloud. BYOK — bring your own API key, pay your provider directly.
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Check className="w-4 h-4 text-green-500" />
                Managed container execution
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Check className="w-4 h-4 text-green-500" />
                Automatic scaling
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Check className="w-4 h-4 text-green-500" />
                Worker checkpointing
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Check className="w-4 h-4 text-green-500" />
                Real-time log streaming
              </div>
            </div>
          </div>
        </div>
      </section>


      {/* Jira Comments */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-blue-500" />
          Issue Tracker Updates
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            WorkerMill posts status updates as comments on your issues at key milestones:
          </p>
          <div className="space-y-3">
            <div className="bg-background rounded-lg p-3 border border-border">
              <div className="text-xs text-muted-foreground mb-1">When task is claimed:</div>
              <div className="text-sm font-mono text-foreground">
                AI Worker (backend_developer) has started working on this ticket.
              </div>
            </div>
            <div className="bg-background rounded-lg p-3 border border-border">
              <div className="text-xs text-muted-foreground mb-1">When PR is created:</div>
              <div className="text-sm font-mono text-foreground">
                Pull request created: github.com/org/repo/pull/123
              </div>
            </div>
            <div className="bg-background rounded-lg p-3 border border-green-500/30">
              <div className="text-xs text-muted-foreground mb-1">When task completes:</div>
              <div className="text-sm font-mono text-green-400">
                Task completed successfully. Duration: 12m, Cost: $0.45
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

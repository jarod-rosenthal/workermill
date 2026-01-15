import {
  GitBranch,
  Ticket,
  Webhook,
  ArrowRight,
  Check,
  GitPullRequest,
  MessageSquare,
  RefreshCw,
  Brain,
  Clock,
  Mail,
  MessageCircle,
} from "lucide-react";

export default function Integrations() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">Integrations</h1>
        <p className="text-muted-foreground">
          WorkerMill connects Jira and GitHub to create an automated development pipeline.
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
              <div className="font-medium text-foreground">Jira</div>
              <div className="text-xs text-muted-foreground">Issue Created</div>
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
              <div className="font-medium text-foreground">GitHub</div>
              <div className="text-xs text-muted-foreground">PR Created</div>
            </div>
            <ArrowRight className="w-6 h-6 text-muted-foreground rotate-90 md:rotate-0" />
            <div className="text-center">
              <div className="w-16 h-16 rounded-xl bg-blue-500/10 flex items-center justify-center mx-auto mb-2">
                <Ticket className="w-8 h-8 text-blue-500" />
              </div>
              <div className="font-medium text-foreground">Jira</div>
              <div className="text-xs text-muted-foreground">Updated with PR</div>
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
            Choose the model that best fits your needs for cost, speed, and capability.
          </p>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { name: "Anthropic Claude", models: "Claude 4, Sonnet, Haiku", color: "text-orange-400" },
              { name: "OpenAI", models: "GPT-4o, GPT-4, o1", color: "text-green-400" },
              { name: "Google", models: "Gemini Pro, Gemini Ultra", color: "text-blue-400" },
              { name: "Others", models: "Mistral, Llama, Cohere", color: "text-gray-400" },
            ].map((provider) => (
              <div key={provider.name} className="bg-background rounded-lg p-4 border border-border text-center">
                <div className={`font-medium ${provider.color} mb-1`}>{provider.name}</div>
                <div className="text-xs text-muted-foreground">{provider.models}</div>
              </div>
            ))}
          </div>

          <div className="bg-background rounded-lg p-4 border border-border">
            <h4 className="text-sm font-medium text-foreground mb-2">Bring Your Own API Key</h4>
            <p className="text-sm text-muted-foreground">
              Use your own API keys for any supported provider. WorkerMill supports per-organization
              and per-task model selection, so you can optimize for cost or capability depending on task complexity.
            </p>
          </div>
        </div>
      </section>

      {/* Jira Integration */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Ticket className="w-5 h-5 text-blue-500" />
          Jira Integration
        </h2>
        <div className="bg-card border border-blue-500/30 rounded-xl p-6 space-y-6">
          <p className="text-muted-foreground">
            WorkerMill monitors your Jira projects for tasks with the configured label and
            automatically assigns them to AI workers.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-medium text-foreground mb-3">Required Configuration</h3>
              <ul className="space-y-2">
                {[
                  "Jira instance URL (e.g., your-org.atlassian.net)",
                  "API token with read/write access",
                  "Project key(s) to monitor",
                  'Task label (e.g., "ai-worker")',
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Check className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-medium text-foreground mb-3">What WorkerMill Does</h3>
              <ul className="space-y-2">
                {[
                  "Polls for new tasks every 30 seconds",
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
            <h4 className="text-sm font-medium text-foreground mb-2">Ticket Requirements</h4>
            <p className="text-sm text-muted-foreground">
              For a ticket to be picked up by WorkerMill, it must:
            </p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>- Have the configured label (e.g., <code className="text-primary">ai-worker</code>)</li>
              <li>- Be assigned to a user or unassigned</li>
              <li>- Not already have an active WorkerMill task</li>
            </ul>
          </div>
        </div>
      </section>

      {/* GitHub Integration */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-gray-400" />
          GitHub Integration
        </h2>
        <div className="bg-card border border-gray-500/30 rounded-xl p-6 space-y-6">
          <p className="text-muted-foreground">
            Workers create branches and pull requests automatically for completed work.
            You can also trigger workers directly from GitHub Issues.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-medium text-foreground mb-3">Required Configuration</h3>
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
              <h3 className="text-sm font-medium text-foreground mb-3">What WorkerMill Does</h3>
              <ul className="space-y-2">
                {[
                  "Creates branch from ticket key (e.g., feature/OCS-123)",
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
              Trigger workers directly from GitHub Issues by adding the <code className="text-primary">workermill</code> label:
            </p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>- Create or open a GitHub Issue</li>
              <li>- Add the <code className="text-primary">workermill</code> label</li>
              <li>- Worker picks up the task (issue key: <code className="text-primary">GH-123</code>)</li>
              <li>- Same workflow labels apply: <code className="text-primary">deploy</code>, <code className="text-primary">review</code>, etc.</li>
            </ul>
          </div>

          <div className="bg-background rounded-lg p-4 border border-border">
            <h4 className="text-sm font-medium text-foreground mb-2">Branch Naming Convention</h4>
            <p className="text-sm text-muted-foreground mb-2">
              Branches are named based on the ticket key and type:
            </p>
            <div className="space-y-1 font-mono text-xs text-muted-foreground">
              <div><code className="text-primary">feature/OCS-123-add-user-dashboard</code></div>
              <div><code className="text-green-400">fix/OCS-456-login-error</code></div>
              <div><code className="text-orange-400">refactor/GH-789-cleanup-api</code></div>
            </div>
          </div>
        </div>
      </section>

      {/* Linear Integration */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Ticket className="w-5 h-5 text-purple-500" />
          Linear Integration
        </h2>
        <div className="bg-card border border-purple-500/30 rounded-xl p-6 space-y-6">
          <p className="text-muted-foreground">
            WorkerMill integrates with Linear using the same label-based workflow as Jira.
            Add the <code className="text-primary">workermill</code> label to any Linear issue to trigger a worker.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-medium text-foreground mb-3">Setup</h3>
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
              <h3 className="text-sm font-medium text-foreground mb-3">Supported Labels</h3>
              <ul className="space-y-2">
                {[
                  "workermill - Triggers task creation",
                  "haiku / sonnet / opus - Model selection",
                  "deploy - Auto-deploy without PR approval",
                  "review - Require Virtual Manager review",
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
            <h4 className="text-sm font-medium text-foreground mb-2">Issue Key Format</h4>
            <p className="text-sm text-muted-foreground">
              Linear issues use their identifier (e.g., <code className="text-primary">LIN-123</code>) as the WorkerMill task key.
              Branches and PRs will be named accordingly.
            </p>
          </div>
        </div>
      </section>

      {/* Coming Soon Integrations */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Clock className="w-5 h-5 text-muted-foreground" />
          Coming Soon
        </h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Asana */}
          <div className="bg-card border border-border rounded-xl p-5 opacity-75">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
                <Ticket className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Asana</h3>
                <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">Coming Soon</span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-2">
              Enterprise project management integration with tag-based workflows.
            </p>
            <div className="text-xs text-muted-foreground">
              <code>/api/webhooks/asana</code>
            </div>
          </div>

          {/* ClickUp */}
          <div className="bg-card border border-border rounded-xl p-5 opacity-75">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-pink-500/10 flex items-center justify-center">
                <Ticket className="w-5 h-5 text-pink-500" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">ClickUp</h3>
                <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">Coming Soon</span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-2">
              All-in-one productivity platform with task automation.
            </p>
            <div className="text-xs text-muted-foreground">
              <code>/api/webhooks/clickup</code>
            </div>
          </div>

          {/* GitLab Issues */}
          <div className="bg-card border border-border rounded-xl p-5 opacity-75">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-orange-600/10 flex items-center justify-center">
                <GitBranch className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">GitLab</h3>
                <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">Coming Soon</span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-2">
              GitLab Issues and MR creation for GitLab-native teams.
            </p>
            <div className="text-xs text-muted-foreground">
              <code>/api/webhooks/gitlab</code>
            </div>
          </div>

          {/* Discord */}
          <div className="bg-card border border-border rounded-xl p-5 opacity-75">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                <MessageCircle className="w-5 h-5 text-indigo-500" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Discord</h3>
                <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">Coming Soon</span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-2">
              Real-time notifications to Discord channels.
            </p>
            <div className="text-xs text-muted-foreground">
              Webhook notifications
            </div>
          </div>

          {/* Email */}
          <div className="bg-card border border-border rounded-xl p-5 opacity-75">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                <Mail className="w-5 h-5 text-cyan-500" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Email</h3>
                <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">Coming Soon</span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-2">
              Digest and real-time email notifications for task updates.
            </p>
            <div className="text-xs text-muted-foreground">
              Daily digest + instant alerts
            </div>
          </div>
        </div>
      </section>

      {/* Webhook Events */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Webhook className="w-5 h-5 text-purple-500" />
          Webhook Events
        </h2>
        <div className="bg-card border border-purple-500/30 rounded-xl p-6 space-y-4">
          <p className="text-muted-foreground">
            Receive real-time notifications about task status changes via webhooks.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 text-foreground font-medium">Event</th>
                  <th className="text-left py-3 text-foreground font-medium">Description</th>
                  <th className="text-left py-3 text-foreground font-medium">Payload</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b border-border">
                  <td className="py-3"><code className="text-xs bg-muted px-2 py-0.5 rounded">task.created</code></td>
                  <td className="py-3">New task queued from Jira</td>
                  <td className="py-3">taskId, jiraKey, summary</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-3"><code className="text-xs bg-muted px-2 py-0.5 rounded">task.claimed</code></td>
                  <td className="py-3">Worker picked up the task</td>
                  <td className="py-3">taskId, workerId, persona</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-3"><code className="text-xs bg-muted px-2 py-0.5 rounded">task.pr_created</code></td>
                  <td className="py-3">Pull request was created</td>
                  <td className="py-3">taskId, prUrl, branch</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-3"><code className="text-xs bg-muted px-2 py-0.5 rounded">task.completed</code></td>
                  <td className="py-3">Task finished successfully</td>
                  <td className="py-3">taskId, duration, cost, prUrl</td>
                </tr>
                <tr>
                  <td className="py-3"><code className="text-xs bg-muted px-2 py-0.5 rounded">task.failed</code></td>
                  <td className="py-3">Task encountered an error</td>
                  <td className="py-3">taskId, error, retryCount</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Jira Comments */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-blue-500" />
          Jira Comment Updates
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            WorkerMill posts status updates as Jira comments at key milestones:
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

import {
  Rocket,
  Settings,
  GitBranch,
  AlertCircle,
  ArrowRight,
  Copy,
  ExternalLink,
  Monitor,
  Cloud,
  Terminal,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";

const labels = [
  {
    name: "workermill",
    description: "Required - Triggers planning and parallel story execution",
    required: true,
  },
  {
    name: "haiku",
    description: "Use efficient model (optimized for speed)",
  },
  {
    name: "sonnet",
    description: "Use balanced model (speed + capability)",
  },
  {
    name: "opus",
    description: "Use flagship model (most capable)",
  },
  {
    name: "openai",
    description: "Use OpenAI models (GPT-4o, o3-mini, o1)",
  },
  {
    name: "gemini",
    description: "Use Google Gemini models",
  },
  {
    name: "ollama",
    description: "Use self-hosted models via Ollama",
  },
  {
    name: "deploy",
    description: "Auto-merge and deploy (skip PR review)",
  },
  {
    name: "review",
    description: "Tech Lead Reviewer reviews PR first",
  },
  {
    name: "critic",
    description: "Planner-Critic validation before execution",
  },
  {
    name: "improve",
    description: "Self-improvement analysis after completion",
  },
];

export default function QuickStart() {
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-12">
      {/* Hero */}
      <div className="text-center space-y-4">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-500/10 text-green-500 text-sm font-medium mb-4">
          <Rocket className="w-4 h-4" />
          Quick Start Guide
        </div>
        <h1 className="text-4xl font-bold text-foreground">
          Get Started in 5 Minutes
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Two ways to build: run workers locally with your API key, or use the cloud.
        </p>
      </div>

      {/* Option Selector */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Option A: Local Mode */}
        <div className="bg-card border-2 border-primary/50 rounded-xl p-6 relative">
          <div className="absolute -top-3 left-4">
            <span className="px-3 py-1 bg-primary text-primary-foreground text-xs font-semibold rounded-full">
              Recommended
            </span>
          </div>
          <div className="flex items-center gap-3 mb-4 mt-1">
            <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
              <Monitor className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Option A: Local Mode</h2>
              <p className="text-sm text-green-500 font-medium">BYOK — bring your own key</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Workers run on your machine using your Anthropic API key. Code never leaves your computer.
          </p>
          <div className="text-sm text-muted-foreground">
            <strong className="text-foreground">Requires:</strong> Anthropic API key (or existing Claude CLI login)
          </div>
        </div>

        {/* Option B: Cloud Mode */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <Cloud className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Option B: Cloud Mode</h2>
              <p className="text-sm text-purple-500 font-medium">Pay per project</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            We handle execution. Bring your own API key (BYOK).
          </p>
          <div className="text-sm text-muted-foreground">
            <strong className="text-foreground">Requires:</strong> AI provider API key
          </div>
        </div>
      </div>

      {/* Option A Steps */}
      <section className="space-y-6">
        <div className="flex items-center gap-3">
          <Monitor className="w-5 h-5 text-green-500" />
          <h2 className="text-2xl font-semibold text-foreground">Option A: Local Mode</h2>
        </div>

        <div className="space-y-4">
          {/* Step 1 */}
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">
                1
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-foreground text-lg">Install the CLI</h3>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">1 min</span>
                </div>
                <p className="text-muted-foreground mb-4">Install the WorkerMill agent. Requires Docker for worker containers.</p>
                <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm flex items-center justify-between">
                  <code className="text-foreground">curl -fsSL https://workermill.com/install.sh | bash</code>
                  <button
                    onClick={() => copyToClipboard("curl -fsSL https://workermill.com/install.sh | bash", "install")}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Copy className="w-4 h-4" />
                    {copied === "install" && <span className="text-xs ml-1">Copied!</span>}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Step 2 */}
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">
                2
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-foreground text-lg">Run Setup</h3>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">2 min</span>
                </div>
                <p className="text-muted-foreground mb-4">Interactive wizard that checks prerequisites, installs Claude CLI if needed, and configures your API key and SCM tokens.</p>
                <div className="space-y-2">
                  <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm flex items-center justify-between">
                    <code className="text-foreground">workermill-agent setup</code>
                    <button
                      onClick={() => copyToClipboard("workermill-agent setup", "setup")}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Validates prerequisites, configures your API key and SCM tokens, and stores configuration in ~/.workermill/config.json.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Step 3 */}
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">
                3
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-foreground text-lg">Start the worker</h3>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">30 sec</span>
                </div>
                <p className="text-muted-foreground mb-4">Start the local worker process. It will wait for tasks from workermill.com.</p>
                <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm flex items-center justify-between">
                  <code className="text-foreground">workermill-agent start</code>
                  <button
                    onClick={() => copyToClipboard("workermill-agent start", "start")}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
                <div className="mt-3 bg-muted/30 rounded-lg p-3 font-mono text-xs text-muted-foreground space-y-1">
                  <div className="text-green-500">  All dependencies found</div>
                  <div className="text-green-500">  Already authenticated</div>
                  <div>Worker ready. Dashboard: https://workermill.com/dashboard</div>
                </div>
              </div>
            </div>
          </div>

          {/* Step 4 */}
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">
                4
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-foreground text-lg">Create a task</h3>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">30 sec</span>
                </div>
                <p className="text-muted-foreground mb-4">
                  Open <Link to="/dashboard" className="text-primary hover:underline">workermill.com/dashboard</Link> in your browser, or trigger a task from your issue tracker.
                </p>
                <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                  <li>Click <strong className="text-foreground">"Run Task"</strong> on the dashboard, or add the <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">workermill</code> label to a Jira/Linear/GitHub issue</li>
                  <li>The Planning Agent decomposes your task into stories</li>
                  <li>Workers execute stories in parallel</li>
                  <li>A pull request is created when done</li>
                </ol>
                <div className="flex items-center gap-2 text-sm text-muted-foreground mt-4">
                  <Terminal className="w-4 h-4" />
                  <span>Watch progress in your terminal and on the dashboard</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Option B Steps */}
      <section className="space-y-6">
        <div className="flex items-center gap-3">
          <Cloud className="w-5 h-5 text-purple-500" />
          <h2 className="text-2xl font-semibold text-foreground">Option B: Cloud Mode</h2>
        </div>

        <div className="space-y-4">
          {/* Step 1 */}
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">
                1
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-foreground text-lg">Sign up</h3>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">2 min</span>
                </div>
                <p className="text-muted-foreground">
                  Create an account at <Link to="/signup" className="text-primary hover:underline">workermill.com/signup</Link>.
                </p>
              </div>
            </div>
          </div>

          {/* Step 2 */}
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">
                2
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-foreground text-lg">Add your API key</h3>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">1 min</span>
                </div>
                <p className="text-muted-foreground mb-4">
                  Go to <strong className="text-foreground">Settings &gt; AI Providers</strong> and add your API key.
                </p>
                <div className="grid md:grid-cols-2 gap-3">
                  <a
                    href="https://console.anthropic.com/settings/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground bg-muted/30 px-3 py-2 rounded-lg"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Get Anthropic API Key
                  </a>
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground bg-muted/30 px-3 py-2 rounded-lg"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Get OpenAI API Key
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Step 3 */}
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">
                3
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-foreground text-lg">Create a task</h3>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">1 min</span>
                </div>
                <p className="text-muted-foreground">
                  Open <Link to="/dashboard" className="text-primary hover:underline">workermill.com/dashboard</Link> and click "Run Task", or add the <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">workermill</code> label to an issue in your tracker.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Webhook Integration (for advanced users) */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground">Advanced: Issue Tracker Integration</h2>
        <p className="text-muted-foreground">
          Optionally, trigger builds directly from your issue tracker by adding the <code className="bg-muted px-1.5 py-0.5 rounded">workermill</code> label.
        </p>
        <div className="space-y-4">
          <div className="bg-muted/50 rounded-lg p-4">
            <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Jira
            </h4>
            <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
              <li>Go to <strong>Project Settings &gt; Webhooks</strong></li>
              <li>Add webhook URL: <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">https://workermill.com/api/webhooks/jira</code></li>
              <li>Set JQL filter: <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">labels = workermill</code></li>
            </ol>
          </div>
          <div className="bg-muted/50 rounded-lg p-4">
            <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Linear
            </h4>
            <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
              <li>Go to <strong>Settings &gt; API &gt; Webhooks</strong></li>
              <li>Add webhook URL: <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">https://workermill.com/api/webhooks/linear</code></li>
              <li>Select events: Issue created, Issue updated</li>
            </ol>
          </div>
          <div className="bg-muted/50 rounded-lg p-4">
            <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
              <GitBranch className="w-4 h-4" />
              GitHub Issues
            </h4>
            <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
              <li>Go to <strong>Repository Settings &gt; Webhooks</strong></li>
              <li>Add webhook URL: <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">https://workermill.com/api/webhooks/github-issues</code></li>
              <li>Select events: Issues (opened, edited, labeled)</li>
            </ol>
          </div>
        </div>
      </section>

      {/* Labels Reference */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground">Label Reference</h2>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-foreground">Label</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-foreground">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {labels.map((label) => (
                <tr key={label.name}>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-mono ${
                        label.required
                          ? "bg-primary/10 text-primary font-medium"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {label.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {label.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Task States */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground">Understanding Task States</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-cyan-500 animate-pulse"></div>
              <span className="font-medium text-foreground">Planning</span>
            </div>
            <p className="text-sm text-muted-foreground">Planner agent decomposing the task into stories</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
              <span className="font-medium text-foreground">Queued</span>
            </div>
            <p className="text-sm text-muted-foreground">Plan approved, waiting for a worker to pick it up</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500 animate-pulse"></div>
              <span className="font-medium text-foreground">Executing</span>
            </div>
            <p className="text-sm text-muted-foreground">Worker is implementing changes</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-purple-500"></div>
              <span className="font-medium text-foreground">Review Requested</span>
            </div>
            <p className="text-sm text-muted-foreground">PR created, waiting for your approval</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
              <span className="font-medium text-foreground">Completed</span>
            </div>
            <p className="text-sm text-muted-foreground">Task finished with no code changes needed</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
              <span className="font-medium text-foreground">Deployed</span>
            </div>
            <p className="text-sm text-muted-foreground">Merged and deployed successfully</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-orange-500"></div>
              <span className="font-medium text-foreground">Escalated</span>
            </div>
            <p className="text-sm text-muted-foreground">Worker needs clarification — respond to unblock</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500"></div>
              <span className="font-medium text-foreground">Failed</span>
            </div>
            <p className="text-sm text-muted-foreground">Task encountered an error — check logs and retry</p>
          </div>
        </div>
      </section>

      {/* Handling Issues */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground">If Something Goes Wrong</h2>
        <div className="bg-card border border-amber-500/30 rounded-xl p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="space-y-3">
              <h3 className="font-medium text-foreground">Escalated Tasks</h3>
              <p className="text-sm text-muted-foreground">
                When a worker encounters a blocker it cannot auto-fix, the task is escalated with a summary explaining the issue.
                You can retry, skip the blocked story, or abort from the dashboard.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Next Steps */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground">Next Steps</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <Link
            to="/docs/agent"
            className="bg-primary/10 border border-primary/30 rounded-xl p-5 hover:bg-primary/20 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-primary">
                  Agent Setup
                </h3>
                <p className="text-sm text-primary/70">
                  Install and configure the local agent
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-primary" />
            </div>
          </Link>
          <Link
            to="/docs/task-lifecycle"
            className="bg-card border border-border rounded-xl p-5 hover:border-primary/50 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                  Task Lifecycle
                </h3>
                <p className="text-sm text-muted-foreground">
                  Deep dive into how tasks flow
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </Link>
          <Link
            to="/docs/integrations"
            className="bg-card border border-border rounded-xl p-5 hover:border-primary/50 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                  Integrations
                </h3>
                <p className="text-sm text-muted-foreground">
                  Connect more tools and platforms
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </Link>
          <Link
            to="/docs/mcp"
            className="bg-card border border-border rounded-xl p-5 hover:border-primary/50 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                  MCP Integration
                </h3>
                <p className="text-sm text-muted-foreground">
                  Manage from Claude Code or other MCP tools
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </Link>
        </div>
      </section>
    </div>
  );
}

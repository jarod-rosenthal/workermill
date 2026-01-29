import {
  Rocket,
  Settings,
  GitBranch,
  CheckCircle,
  AlertCircle,
  ArrowRight,
  Copy,
  ExternalLink,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";

const steps = [
  {
    number: "1",
    title: "Connect Issue Tracker",
    duration: "10 min",
    description: "Set up Jira, Linear, or GitHub Issues webhook to send tickets to WorkerMill",
  },
  {
    number: "2",
    title: "Connect GitHub",
    duration: "5 min",
    description: "Authorize WorkerMill to create branches and PRs",
  },
  {
    number: "3",
    title: "Run First Task",
    duration: "10 min",
    description: "Create a test ticket and watch the magic happen",
  },
];

const labels = [
  {
    name: "workermill",
    description: "Required - Triggers Epic Mode (parallel stories)",
    required: true,
  },
  {
    name: "haiku",
    description: "Use Claude Haiku (fastest, cheapest)",
  },
  {
    name: "sonnet",
    description: "Use Claude Sonnet (balanced)",
  },
  {
    name: "opus",
    description: "Use Claude Opus (most capable)",
  },
  {
    name: "deploy",
    description: "Auto-merge and deploy (skip PR review)",
  },
  {
    name: "review",
    description: "Virtual Manager reviews PR first",
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

const testTicket = {
  title: "Add current year to footer copyright",
  description: `Update the footer component to show the current year instead of a hardcoded year.

Files to modify:
- Look for footer component (likely in src/components/)

Acceptance criteria:
- Footer shows "© 2026" (or current year)
- Year updates automatically (use JavaScript Date)`,
};

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
          Get Started in 30 Minutes
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Connect your tools, run your first task, and see AI workers in action.
        </p>
      </div>

      {/* Prerequisites */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground">Before You Start</h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="grid md:grid-cols-3 gap-4">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-medium text-foreground">Issue Tracker</div>
                <div className="text-sm text-muted-foreground">Jira, Linear, or GitHub Issues</div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-medium text-foreground">SCM Repository</div>
                <div className="text-sm text-muted-foreground">GitHub, GitLab, or BitBucket</div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-medium text-foreground">30 Minutes</div>
                <div className="text-sm text-muted-foreground">For complete setup</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Setup Steps */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground">Setup Steps</h2>
        <div className="space-y-4">
          {steps.map((step) => (
            <div
              key={step.number}
              className="bg-card border border-border rounded-xl p-6"
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">
                  {step.number}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-foreground text-lg">{step.title}</h3>
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                      {step.duration}
                    </span>
                  </div>
                  <p className="text-muted-foreground mb-4">{step.description}</p>

                  {/* Step-specific content */}
                  {step.number === "1" && (
                    <div className="space-y-4">
                      <div className="bg-muted/50 rounded-lg p-4">
                        <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
                          <Settings className="w-4 h-4" />
                          Jira Setup
                        </h4>
                        <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                          <li>Go to <strong>Project Settings &gt; Webhooks</strong></li>
                          <li>Create new webhook with URL: <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">https://workermill.com/api/webhooks/jira</code></li>
                          <li>Set JQL filter: <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">labels = workermill</code></li>
                          <li>In WorkerMill Settings, add your Jira Webhook Secret</li>
                        </ol>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-4">
                        <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
                          <Settings className="w-4 h-4" />
                          Linear Setup
                        </h4>
                        <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                          <li>Go to <strong>Settings &gt; API &gt; Webhooks</strong></li>
                          <li>Add webhook URL: <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">https://workermill.com/api/webhooks/linear</code></li>
                          <li>Select events: Issue created, Issue updated</li>
                          <li>Create the <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">workermill</code> label in your workspace</li>
                        </ol>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-4">
                        <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
                          <GitBranch className="w-4 h-4" />
                          GitHub Issues Setup
                        </h4>
                        <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                          <li>Go to <strong>Repository Settings &gt; Webhooks</strong></li>
                          <li>Add webhook URL: <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">https://workermill.com/api/webhooks/github</code></li>
                          <li>Select events: Issues (opened, edited, labeled)</li>
                          <li>Create the <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">workermill</code> label in your repo</li>
                        </ol>
                      </div>
                    </div>
                  )}

                  {step.number === "2" && (
                    <div className="bg-muted/50 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <GitBranch className="w-4 h-4 text-foreground" />
                        <h4 className="font-medium text-foreground">GitHub Connection</h4>
                      </div>
                      <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                        <li>Go to WorkerMill <strong>Settings &gt; GitHub</strong></li>
                        <li>Click "Connect Repository"</li>
                        <li>Authorize the WorkerMill GitHub App</li>
                        <li>Select repositories workers can access</li>
                      </ol>
                      <p className="text-xs text-muted-foreground mt-3">
                        Workers need write access to create branches and PRs.
                      </p>
                    </div>
                  )}

                  {step.number === "3" && (
                    <div className="space-y-4">
                      <div className="bg-muted/50 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-medium text-foreground">Test Ticket Template</h4>
                          <button
                            onClick={() => copyToClipboard(testTicket.description, "description")}
                            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                          >
                            <Copy className="w-3 h-3" />
                            {copied === "description" ? "Copied!" : "Copy"}
                          </button>
                        </div>
                        <div className="space-y-2">
                          <div>
                            <span className="text-xs text-muted-foreground">Title:</span>
                            <div className="font-medium text-foreground">{testTicket.title}</div>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground">Description:</span>
                            <pre className="text-sm text-muted-foreground whitespace-pre-wrap bg-background p-3 rounded mt-1">
                              {testTicket.description}
                            </pre>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground">Labels:</span>
                            <div className="flex gap-2 mt-1">
                              <span className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded font-medium">
                                workermill
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <ArrowRight className="w-4 h-4" />
                        <span>Task appears in dashboard within 10 seconds</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
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
              <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
              <span className="font-medium text-foreground">Queued</span>
            </div>
            <p className="text-sm text-muted-foreground">Waiting for a worker to pick it up</p>
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
              <span className="font-medium text-foreground">Deployed</span>
            </div>
            <p className="text-sm text-muted-foreground">Merged and deployed successfully</p>
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
                When a worker can't complete a task, it escalates with a comment explaining why.
                Common reasons: unclear requirements, missing dependencies, or security concerns.
              </p>
              <div className="text-sm text-muted-foreground">
                <strong className="text-foreground">To resolve:</strong> Update your ticket with
                the missing information, then remove and re-add the <code className="bg-muted px-1.5 py-0.5 rounded">workermill</code> label.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Next Steps */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground">Next Steps</h2>
        <div className="grid md:grid-cols-2 gap-4">
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
                  Deep dive into how tasks flow through the system
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </Link>
          <Link
            to="/docs/personas"
            className="bg-card border border-border rounded-xl p-5 hover:border-primary/50 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                  Worker Personas
                </h3>
                <p className="text-sm text-muted-foreground">
                  Learn about specialized AI workers
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
          <a
            href="https://workermill.com/dashboard"
            className="bg-primary/10 border border-primary/30 rounded-xl p-5 hover:bg-primary/20 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-primary">
                  Open Dashboard
                </h3>
                <p className="text-sm text-primary/70">
                  Start monitoring your tasks
                </p>
              </div>
              <ExternalLink className="w-5 h-5 text-primary" />
            </div>
          </a>
        </div>
      </section>
    </div>
  );
}

import {
  Monitor,
  Cloud,
  Server,
  CheckCircle,
  ArrowRight,
  ArrowDown,
  Settings,
  Terminal,
  Shield,
  Cpu,
  HardDrive,
  Wifi,
  AlertCircle,
  Copy,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";

const architectureFlow = [
  {
    component: "WorkerMill Dashboard",
    icon: Cloud,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    description: "workermill.com — create tasks, view progress, manage settings",
    location: "Cloud",
  },
  {
    component: "Remote Agent",
    icon: Monitor,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/30",
    description:
      "Polls the cloud API for tasks, runs planning via Claude CLI, spawns native worker processes",
    location: "Your Machine",
  },
  {
    component: "Worker Processes",
    icon: Cpu,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
    description:
      "Native processes that clone repos, implement changes, and create PRs. Logs stream back to the dashboard.",
    location: "Your Machine",
  },
];

const comparisonRows = [
  {
    aspect: "Dashboard",
    cloud: "workermill.com",
    remote: "workermill.com",
  },
  {
    aspect: "Task Queue",
    cloud: "Cloud API",
    remote: "Cloud API (agent polls)",
  },
  {
    aspect: "Planning",
    cloud: "Cloud workers",
    remote: "Local Claude CLI",
  },
  {
    aspect: "Execution",
    cloud: "Managed containers",
    remote: "Local native processes",
  },
  {
    aspect: "AI Cost",
    cloud: "Your API key",
    remote: "Anthropic API key (BYOK)",
  },
  {
    aspect: "Log Streaming",
    cloud: "SSE via cloud API",
    remote: "SSE via cloud API (same)",
  },
];

export default function RemoteAgent() {
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">
          Remote Agent
        </h1>
        <p className="text-muted-foreground">
          Run AI workers on your own machine while using the WorkerMill cloud
          dashboard. Your code stays local, execution uses your Anthropic API
          key, and all progress streams to workermill.com in real time.
        </p>
      </div>

      {/* Key Benefits */}
      <section className="space-y-4">
        <div className="grid md:grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <Shield className="w-5 h-5 text-green-500" />
              </div>
              <h3 className="font-semibold text-foreground">Code Stays Local</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Repositories are cloned and processed entirely on your machine. Only
              logs and status updates go to the cloud.
            </p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <HardDrive className="w-5 h-5 text-blue-500" />
              </div>
              <h3 className="font-semibold text-foreground">BYOK</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Uses your Anthropic API key for execution. Bring your own key and
              pay your provider directly.
            </p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10">
                <Wifi className="w-5 h-5 text-purple-500" />
              </div>
              <h3 className="font-semibold text-foreground">
                Real-Time Dashboard
              </h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Full dashboard experience at workermill.com — task progress, live
              logs, story tracking, and PR status all stream in real time.
            </p>
          </div>
        </div>
      </section>

      {/* Architecture */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Server className="w-5 h-5 text-primary" />
          Architecture
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="space-y-0">
            {architectureFlow.map((item, idx) => (
              <div key={item.component}>
                <div
                  className={`border ${item.borderColor} rounded-lg p-4`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`p-2 rounded-lg ${item.bgColor} flex-shrink-0`}
                    >
                      <item.icon className={`w-5 h-5 ${item.color}`} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium text-foreground text-sm">
                          {item.component}
                        </h4>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-full ${item.bgColor} ${item.color}`}
                        >
                          {item.location}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {item.description}
                      </p>
                    </div>
                  </div>
                </div>
                {idx < architectureFlow.length - 1 && (
                  <div className="flex justify-center py-1">
                    <ArrowDown className="w-4 h-4 text-muted-foreground/50" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Quick Setup */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Settings className="w-5 h-5 text-primary" />
          Quick Setup
        </h2>
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">
                1
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">Install</h3>
                <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm flex items-center justify-between mt-2">
                  <code className="text-foreground">
                    curl -fsSL https://workermill.com/install.sh | bash
                  </code>
                  <button
                    onClick={() =>
                      copyToClipboard(
                        "curl -fsSL https://workermill.com/install.sh | bash",
                        "install",
                      )
                    }
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Copy className="w-4 h-4" />
                    {copied === "install" && (
                      <span className="text-xs ml-1">Copied!</span>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">
                2
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">
                  Run Setup
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Interactive wizard — checks prerequisites, validates credentials,
                  configures SCM tokens.
                </p>
                <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm flex items-center justify-between mt-2">
                  <code className="text-foreground">workermill-agent setup</code>
                  <button
                    onClick={() =>
                      copyToClipboard("workermill-agent setup", "setup")
                    }
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Copy className="w-4 h-4" />
                    {copied === "setup" && (
                      <span className="text-xs ml-1">Copied!</span>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">
                3
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">Start</h3>
                <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm flex items-center justify-between mt-2">
                  <code className="text-foreground">workermill-agent start</code>
                  <button
                    onClick={() =>
                      copyToClipboard("workermill-agent start", "start")
                    }
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Copy className="w-4 h-4" />
                    {copied === "start" && (
                      <span className="text-xs ml-1">Copied!</span>
                    )}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  The agent connects to workermill.com, registers your machine,
                  and begins polling for tasks. Create tasks from the dashboard
                  and watch them execute locally.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How Tasks Flow */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <RefreshCw className="w-5 h-5 text-primary" />
          How Tasks Flow
        </h2>
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            {[
              {
                step: "1",
                label: "Create Task",
                desc: "Dashboard or webhook",
              },
              {
                step: "2",
                label: "Agent Claims",
                desc: "Polls API, claims task",
              },
              {
                step: "3",
                label: "Planning",
                desc: "Claude CLI decomposes",
              },
              {
                step: "4",
                label: "Workers Execute",
                desc: "Native processes locally",
              },
              { step: "5", label: "PR Created", desc: "Logs stream to cloud" },
            ].map((item, idx, arr) => (
              <div key={item.step} className="flex items-center gap-4">
                <div className="text-center">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold mb-2">
                    {item.step}
                  </div>
                  <div className="font-medium text-foreground text-sm">
                    {item.label}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {item.desc}
                  </div>
                </div>
                {idx < arr.length - 1 && (
                  <ArrowRight className="w-5 h-5 text-muted-foreground hidden md:block" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison Table */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">
          Cloud vs Remote Agent
        </h2>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="p-3">Aspect</th>
                <th className="p-3">
                  <div className="flex items-center gap-2">
                    <Cloud className="w-4 h-4 text-blue-500" />
                    Cloud
                  </div>
                </th>
                <th className="p-3">
                  <div className="flex items-center gap-2">
                    <Monitor className="w-4 h-4 text-green-500" />
                    Remote Agent
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {comparisonRows.map((row) => (
                <tr key={row.aspect} className="hover:bg-muted/30">
                  <td className="p-3 font-medium text-foreground">
                    {row.aspect}
                  </td>
                  <td className="p-3 text-muted-foreground">{row.cloud}</td>
                  <td className="p-3 text-muted-foreground">{row.remote}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Planning */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Terminal className="w-5 h-5 text-primary" />
          Planning
        </h2>
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <p className="text-muted-foreground">
            The remote agent includes{" "}
            <strong className="text-foreground">planning with repo context</strong> — the planner clones your
            repository and analyzes it directly to create a thorough execution plan:
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-background rounded-lg p-4 border border-border">
              <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-blue-500" />
                Repo Clone
              </h4>
              <p className="text-xs text-muted-foreground">
                Shallow-clones the target repository to a temporary directory
                for direct codebase access.
              </p>
            </div>
            <div className="bg-background rounded-lg p-4 border border-border">
              <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                Single-Agent Planning
              </h4>
              <p className="text-xs text-muted-foreground">
                A single planner with Claude CLI explores the repo, identifies patterns,
                and decomposes the task into stories with expert assignments.
              </p>
            </div>
            <div className="bg-background rounded-lg p-4 border border-border">
              <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-amber-500" />
                Critic Validation
              </h4>
              <p className="text-xs text-muted-foreground">
                An optional critic reviews the plan for quality (threshold: 85/100).
                Up to 3 iterations before the plan is finalized.
              </p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            The planner has direct tool access to the cloned repo (Glob, Read, Grep)
            for context-aware planning. This runs automatically — no configuration needed.
          </p>
        </div>
      </section>

      {/* Prerequisites */}
      <section className="space-y-4">
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-5">
          <h4 className="font-semibold text-amber-500 mb-2 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            Prerequisites
          </h4>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-amber-500">•</span>
              <span>
                <strong className="text-foreground">
                  Anthropic API key
                </strong>{" "}
                — or existing Claude CLI authentication
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-500">•</span>
              <span>
                <strong className="text-foreground">WorkerMill account</strong>{" "}
                — for the dashboard and API key
              </span>
            </li>
          </ul>
          <p className="text-xs text-muted-foreground mt-3">
            The agent is a standalone binary — no Docker or Node.js required.
          </p>
        </div>
      </section>
    </div>
  );
}

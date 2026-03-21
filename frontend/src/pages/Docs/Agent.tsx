import {
  Monitor,
  Download,
  Terminal,
  Shield,
  CheckCircle,
  Copy,
  ArrowRight,
  Server,
  Cpu,
  HardDrive,
  Wifi,
  Settings,
  Activity,
  FileText,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";

const cliCommands = [
  {
    command: "workermill-agent setup",
    description:
      "Interactive wizard that checks prerequisites, installs Claude CLI if needed, validates your API key, and configures SCM tokens.",
  },
  {
    command: "workermill-agent start",
    description:
      "Start the agent in the foreground. Connects to the cloud API, registers your machine, and begins polling for tasks.",
  },
  {
    command: "workermill-agent start --detach",
    description:
      "Start the agent as a background daemon. Logs are written to ~/.workermill/agent.log.",
  },
  {
    command: "workermill-agent stop",
    description:
      "Stop the background agent process.",
  },
  {
    command: "workermill-agent status",
    description:
      "Show agent status, active worker containers, and API connectivity.",
  },
  {
    command: "workermill-agent logs",
    description:
      "Live-tail agent logs (like tail -f). Use -n to control how many lines to show initially.",
  },
  {
    command: "workermill-agent update",
    description:
      "Self-update the agent binary to the latest version from GitHub Releases.",
  },
];

const troubleshootingItems = [
  {
    problem: "Authentication failed (401)",
    solution:
      "Your API key may be incorrect or expired. Go to Settings > Integrations on the dashboard, copy a fresh key, and re-run workermill-agent setup.",
  },
  {
    problem: "Claude CLI not found after install",
    solution:
      "On Windows, winget updates PATH but the current terminal doesn't see it. Close your terminal, open a new one, and try again.",
  },
  {
    problem: "Worker process killed unexpectedly",
    solution:
      "The worker ran out of memory. Ensure your machine has at least 8 GB of RAM available for worker processes.",
  },
  {
    problem: "Agent shows online but no tasks are picked up",
    solution:
      "Check that the dashboard has queued tasks for your organization. The agent only picks up tasks matching your org's API key.",
  },
  {
    problem: "Worker can't clone repository",
    solution:
      "Verify your SCM token has the correct permissions. GitHub tokens need 'repo' scope. Bitbucket tokens need 'repository:write' and 'pullrequest:write'.",
  },
];

export default function AgentSetup() {
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
          <Monitor className="w-4 h-4" />
          WorkerMill Agent
        </div>
        <h1 className="text-4xl font-bold text-foreground">
          Run Workers on Your Machine
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          A standalone binary that executes AI coding tasks on your machine
          using your API key. Workers run in Docker containers for isolation.
        </p>
      </div>

      {/* Value Props */}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-5 space-y-2">
          <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
            <Shield className="w-5 h-5 text-green-500" />
          </div>
          <h3 className="font-semibold text-foreground">Your Infrastructure</h3>
          <p className="text-sm text-muted-foreground">
            Code stays on your machine. Workers run in isolated Docker
            containers with no external access to your filesystem.
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl p-5 space-y-2">
          <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <Monitor className="w-5 h-5 text-blue-500" />
          </div>
          <h3 className="font-semibold text-foreground">Cloud Dashboard</h3>
          <p className="text-sm text-muted-foreground">
            Real-time log streaming, task status, and coordination all visible
            at workermill.com. Also available in VS Code via the companion extension.
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl p-5 space-y-2">
          <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
            <Cpu className="w-5 h-5 text-purple-500" />
          </div>
          <h3 className="font-semibold text-foreground">Bring Your Own Key</h3>
          <p className="text-sm text-muted-foreground">
            Uses your own API keys (Anthropic, OpenAI, Google, or Ollama).
            Pay your provider directly — no markup.
          </p>
        </div>
      </div>

      {/* System Requirements */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <Server className="w-6 h-6 text-muted-foreground" />
          System Requirements
        </h2>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-5 py-3 text-sm font-medium text-foreground">
                  Requirement
                </th>
                <th className="text-left px-5 py-3 text-sm font-medium text-foreground">
                  Minimum
                </th>
                <th className="text-left px-5 py-3 text-sm font-medium text-foreground">
                  Recommended
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="px-5 py-3 text-sm text-foreground flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-muted-foreground" />
                  RAM
                </td>
                <td className="px-5 py-3 text-sm text-muted-foreground">
                  16 GB
                </td>
                <td className="px-5 py-3 text-sm text-muted-foreground">
                  32 GB+
                </td>
              </tr>
              <tr>
                <td className="px-5 py-3 text-sm text-foreground flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-muted-foreground" />
                  CPU
                </td>
                <td className="px-5 py-3 text-sm text-muted-foreground">
                  4 cores
                </td>
                <td className="px-5 py-3 text-sm text-muted-foreground">
                  8 cores+
                </td>
              </tr>
              <tr>
                <td className="px-5 py-3 text-sm text-foreground flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-muted-foreground" />
                  Disk
                </td>
                <td className="px-5 py-3 text-sm text-muted-foreground">
                  10 GB free
                </td>
                <td className="px-5 py-3 text-sm text-muted-foreground">
                  20 GB+ free
                </td>
              </tr>
              <tr>
                <td className="px-5 py-3 text-sm text-foreground flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-muted-foreground" />
                  OS
                </td>
                <td className="px-5 py-3 text-sm text-muted-foreground" colSpan={2}>
                  macOS (Intel & Apple Silicon), Linux (x64), Windows (x64, native or WSL)
                </td>
              </tr>
              <tr>
                <td className="px-5 py-3 text-sm text-foreground flex items-center gap-2">
                  <Wifi className="w-4 h-4 text-muted-foreground" />
                  Network
                </td>
                <td className="px-5 py-3 text-sm text-muted-foreground" colSpan={2}>
                  Stable internet connection (for API communication and repo cloning)
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-medium text-foreground mb-3">Software Prerequisites</h3>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
              <div>
                <span className="text-sm font-medium text-foreground">
                  AI provider API key
                </span>
                <p className="text-xs text-muted-foreground">
                  Anthropic, OpenAI, Google, or Ollama — powers the workers and planner
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
              <div>
                <span className="text-sm font-medium text-foreground">
                  Docker
                </span>
                <p className="text-xs text-muted-foreground">
                  Workers run in isolated Docker containers
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
              <div>
                <span className="text-sm font-medium text-foreground">
                  Git
                </span>
                <p className="text-xs text-muted-foreground">
                  Required for repository operations and Claude CLI
                </p>
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            The agent is a single binary — no Node.js required. Docker is needed
            for worker containers. The setup wizard checks all prerequisites and
            installs Claude CLI automatically if missing.
          </p>
        </div>
      </section>

      {/* Installation */}
      <section className="space-y-6">
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <Download className="w-6 h-6 text-muted-foreground" />
          Installation
        </h2>

        <div className="space-y-4">
          {/* Step 1 */}
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">
                1
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-foreground text-lg">
                    Install the agent
                  </h3>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                    30 sec
                  </span>
                </div>
                <p className="text-muted-foreground mb-4">
                  Install the WorkerMill agent. No Node.js required — it's a single binary.
                </p>
                <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm flex items-center justify-between">
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
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {copied === "install" ? (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
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
                  <h3 className="font-semibold text-foreground text-lg">
                    Run the setup wizard
                  </h3>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                    3 min
                  </span>
                </div>
                <p className="text-muted-foreground mb-4">
                  The interactive wizard validates your environment, installs
                  missing dependencies, and configures the agent.
                </p>
                <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm flex items-center justify-between">
                  <code className="text-foreground">workermill-agent setup</code>
                  <button
                    onClick={() =>
                      copyToClipboard("workermill-agent setup", "setup")
                    }
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {copied === "setup" ? (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  <p className="text-sm text-muted-foreground font-medium">
                    The wizard will:
                  </p>
                  <div className="bg-muted/30 rounded-lg p-4 font-mono text-xs space-y-1.5">
                    <div className="text-green-500">
                      ✓ Claude CLI
                    </div>
                    <div className="text-green-500">
                      ✓ Claude authenticated
                    </div>
                    <div className="text-green-500">
                      ✓ Git available
                    </div>
                    <div className="text-muted-foreground mt-2">
                      Configuration
                    </div>
                    <div className="text-muted-foreground">
                      ? WorkerMill API URL: https://workermill.com
                    </div>
                    <div className="text-muted-foreground">
                      ? API Key: ****
                    </div>
                    <div className="text-green-500">
                      ✓ Connected! SCM provider: github
                    </div>
                    <div className="text-muted-foreground">
                      ? GitHub personal access token: ****
                    </div>
                    <div className="text-muted-foreground">
                      ? Agent name: agent-workstation
                    </div>
                    <div className="text-green-500 mt-2 font-bold">
                      Setup complete!
                    </div>
                  </div>
                </div>

                <div className="mt-4 bg-blue-500/5 border border-blue-500/20 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                    <Settings className="w-4 h-4 text-blue-500" />
                    What you'll need ready
                  </h4>
                  <ul className="text-sm text-muted-foreground space-y-1.5">
                    <li>
                      <strong className="text-foreground">API Key</strong> — from{" "}
                      <Link
                        to="/settings"
                        className="text-primary hover:underline"
                      >
                        Settings &gt; Integrations
                      </Link>{" "}
                      on the dashboard
                    </li>
                    <li>
                      <strong className="text-foreground">SCM Token</strong> — a
                      personal access token for your source code host (GitHub,
                      GitLab, or Bitbucket) with repo read/write permissions
                    </li>
                  </ul>
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
                  <h3 className="font-semibold text-foreground text-lg">
                    Start the agent
                  </h3>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                    10 sec
                  </span>
                </div>
                <p className="text-muted-foreground mb-4">
                  Launch the agent to start polling for tasks. It connects to the
                  cloud API and waits for work.
                </p>
                <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm flex items-center justify-between">
                  <code className="text-foreground">
                    workermill-agent start
                  </code>
                  <button
                    onClick={() =>
                      copyToClipboard("workermill-agent start", "start")
                    }
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {copied === "start" ? (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <div className="mt-3 bg-muted/30 rounded-lg p-4 font-mono text-xs space-y-1.5">
                  <div className="text-cyan-400 font-bold">
                    &nbsp; WorkerMill Agent
                  </div>
                  <div className="text-muted-foreground">
                    &nbsp; ─────────────────────────────────────
                  </div>
                  <div>
                    &nbsp; <span className="text-green-500">●</span> Connected
                    to{" "}
                    <span className="text-cyan-400">
                      https://workermill.com
                    </span>
                  </div>
                  <div className="text-muted-foreground">
                    &nbsp; Agent:&nbsp;&nbsp;&nbsp;&nbsp; agent-workstation
                  </div>
                  <div className="text-muted-foreground">
                    &nbsp; Workers:&nbsp;&nbsp; <span className="text-yellow-500">10</span>{" "}
                    parallel
                  </div>
                  <div className="text-muted-foreground">
                    &nbsp; Model:&nbsp;&nbsp;&nbsp;&nbsp;{" "}
                    <span className="text-yellow-500">claude-sonnet-4-6</span>
                  </div>
                  <div className="text-muted-foreground">
                    &nbsp; ─────────────────────────────────────
                  </div>
                  <div>
                    &nbsp; <span className="text-green-500">●</span> Agent is
                    running. Press Ctrl+C to stop.
                  </div>
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
                  <h3 className="font-semibold text-foreground text-lg">
                    Create a task
                  </h3>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                    30 sec
                  </span>
                </div>
                <p className="text-muted-foreground mb-4">
                  Head to the WorkerMill dashboard and create a task. Your local
                  agent will pick it up automatically.
                </p>
                <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                  <li>
                    Open{" "}
                    <a
                      href="https://workermill.com/dashboard"
                      className="text-primary hover:underline"
                    >
                      workermill.com/dashboard
                    </a>
                  </li>
                  <li>
                    Click <strong className="text-foreground">New Task</strong>{" "}
                    or add the{" "}
                    <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
                      workermill
                    </code>{" "}
                    label to a Jira/Linear/GitHub issue
                  </li>
                  <li>
                    Watch the agent terminal — it will claim the task and spawn a
                    worker process
                  </li>
                  <li>
                    Monitor progress on the dashboard with real-time log
                    streaming
                  </li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <Activity className="w-6 h-6 text-muted-foreground" />
          How It Works
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                <RefreshCw className="w-4 h-4 text-blue-500" />
              </div>
              <div>
                <h4 className="font-medium text-foreground">
                  1. Agent polls for tasks
                </h4>
                <p className="text-sm text-muted-foreground">
                  The agent checks the cloud API every 5 seconds for new tasks
                  assigned to your organization. A heartbeat is sent every 30
                  seconds to maintain online status.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                <Terminal className="w-4 h-4 text-purple-500" />
              </div>
              <div>
                <h4 className="font-medium text-foreground">
                  2. Planning runs locally
                </h4>
                <p className="text-sm text-muted-foreground">
                  When a task is found, the agent runs the planning step using
                  your configured AI provider. The plan is decomposed into stories
                  assigned to expert personas (backend, frontend, DevOps, etc.).
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center flex-shrink-0">
                <Server className="w-4 h-4 text-green-500" />
              </div>
              <div>
                <h4 className="font-medium text-foreground">
                  3. Workers execute in Docker containers
                </h4>
                <p className="text-sm text-muted-foreground">
                  Each story spawns an isolated Docker container running your chosen AI provider.
                  Workers clone your repository, make changes, and create pull
                  requests — all on your machine.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                <Wifi className="w-4 h-4 text-orange-500" />
              </div>
              <div>
                <h4 className="font-medium text-foreground">
                  4. Logs stream to the cloud
                </h4>
                <p className="text-sm text-muted-foreground">
                  Worker processes post logs and status updates directly to the
                  WorkerMill API. You see everything in real-time on the
                  dashboard — identical to cloud-hosted workers.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Architecture Diagram */}
        <div className="bg-muted/30 border border-border rounded-xl p-6">
          <h3 className="text-sm font-medium text-foreground mb-4">
            Architecture
          </h3>
          <div className="font-mono text-xs text-muted-foreground leading-relaxed whitespace-pre">
{`  ┌─────────────────────────────────────────────────────┐
  │  Your Machine                                       │
  │                                                     │
  │  ┌──────────────┐    ┌──────────────────────────┐   │
  │  │  Agent CLI   │───▶│  AI Provider (planning)  │   │
  │  │  polls API   │    │  uses your API key        │   │
  │  └──────┬───────┘    └──────────────────────────┘   │
  │         │                                           │
  │         │ spawns                                    │
  │         ▼                                           │
  │  ┌──────────────┐  ┌──────────────┐                 │
  │  │  Worker 1    │  │  Worker 2    │  ...            │
  │  │  (container) │  │  (container) │                 │
  │  └──────┬───────┘  └──────┬───────┘                 │
  └─────────┼─────────────────┼─────────────────────────┘
            │                 │
            │  logs, status   │
            ▼                 ▼
  ┌─────────────────────────────────────────────────────┐
  │  workermill.com                                     │
  │  Dashboard  ·  API  ·  SSE Log Streaming            │
  └─────────────────────────────────────────────────────┘`}
          </div>
        </div>
      </section>

      {/* CLI Reference */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <Terminal className="w-6 h-6 text-muted-foreground" />
          CLI Reference
        </h2>
        <div className="bg-card border border-border rounded-xl overflow-hidden divide-y divide-border">
          {cliCommands.map((cmd) => (
            <div
              key={cmd.command}
              className="p-4 flex items-start gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <code className="font-mono text-sm text-foreground bg-muted px-2 py-0.5 rounded">
                    {cmd.command}
                  </code>
                  <button
                    onClick={() =>
                      copyToClipboard(cmd.command, cmd.command)
                    }
                    className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                  >
                    {copied === cmd.command ? (
                      <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {cmd.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Configuration */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <Settings className="w-6 h-6 text-muted-foreground" />
          Configuration
        </h2>
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            Configuration is stored at{" "}
            <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
              ~/.workermill/config.json
            </code>{" "}
            with restricted file permissions (owner-only read/write). You can
            edit it directly or re-run{" "}
            <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
              workermill-agent setup
            </code>{" "}
            to reconfigure.
          </p>
          <div className="bg-muted/50 rounded-lg p-4 font-mono text-xs">
            <pre className="text-muted-foreground">{`{
  "apiUrl": "https://workermill.com",
  "apiKey": "wm_xxxxxxxxxxxxxxxx",
  "agentId": "agent-workstation",
  "maxWorkers": 1,
  "pollIntervalMs": 5000,
  "heartbeatIntervalMs": 30000,
  "tokens": {
    "github": "ghp_xxxxxxxxxxxx",
    "bitbucket": "",
    "gitlab": ""
  }
}`}</pre>
          </div>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-foreground">
                    Field
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-foreground">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-sm">
                <tr>
                  <td className="px-4 py-2.5">
                    <code className="text-xs">apiUrl</code>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">
                    WorkerMill API endpoint
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5">
                    <code className="text-xs">apiKey</code>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">
                    Organization API key from Settings &gt; Integrations
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5">
                    <code className="text-xs">agentId</code>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">
                    Unique agent name shown on the dashboard
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5">
                    <code className="text-xs">maxWorkers</code>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">
                    Max parallel worker processes (can be overridden by cloud settings)
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5">
                    <code className="text-xs">tokens</code>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">
                    SCM personal access tokens — set the one matching your org's provider
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Platform-Specific Notes */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <FileText className="w-6 h-6 text-muted-foreground" />
          Platform Notes
        </h2>

        <div className="space-y-3">
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-medium text-foreground mb-2 flex items-center gap-2">
              <span className="text-lg">🪟</span> Windows
            </h3>
            <ul className="text-sm text-muted-foreground space-y-1.5 list-disc list-inside">
              <li>
                Git for Windows is required — Claude CLI needs Git Bash to
                function
              </li>
              <li>
                Install via PowerShell:{" "}
                <code className="bg-muted px-1 py-0.5 rounded text-xs">
                  irm https://workermill.com/install.ps1 | iex
                </code>
              </li>
              <li>
                Claude CLI is installed via{" "}
                <code className="bg-muted px-1 py-0.5 rounded text-xs">
                  winget
                </code>{" "}
                — you may need to open a new terminal after installation for
                PATH to update
              </li>
            </ul>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-medium text-foreground mb-2 flex items-center gap-2">
              <span className="text-lg">🍎</span> macOS
            </h3>
            <ul className="text-sm text-muted-foreground space-y-1.5 list-disc list-inside">
              <li>
                Install via:{" "}
                <code className="bg-muted px-1 py-0.5 rounded text-xs">
                  curl -fsSL https://workermill.com/install.sh | bash
                </code>
              </li>
              <li>
                Claude CLI installed via Homebrew (
                <code className="bg-muted px-1 py-0.5 rounded text-xs">
                  brew install --cask claude-code
                </code>
                ) or the curl installer
              </li>
            </ul>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-medium text-foreground mb-2 flex items-center gap-2">
              <span className="text-lg">🐧</span> Linux / WSL
            </h3>
            <ul className="text-sm text-muted-foreground space-y-1.5 list-disc list-inside">
              <li>
                Install via:{" "}
                <code className="bg-muted px-1 py-0.5 rounded text-xs">
                  curl -fsSL https://workermill.com/install.sh | bash
                </code>
              </li>
              <li>
                Claude CLI installed via{" "}
                <code className="bg-muted px-1 py-0.5 rounded text-xs">
                  curl -fsSL https://claude.ai/install.sh | bash
                </code>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Troubleshooting */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <AlertTriangle className="w-6 h-6 text-muted-foreground" />
          Troubleshooting
        </h2>
        <div className="space-y-3">
          {troubleshootingItems.map((item, i) => (
            <div
              key={i}
              className="bg-card border border-border rounded-xl p-5"
            >
              <h4 className="font-medium text-foreground mb-1">
                {item.problem}
              </h4>
              <p className="text-sm text-muted-foreground">{item.solution}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Updating */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <RefreshCw className="w-6 h-6 text-muted-foreground" />
          Keeping Up to Date
        </h2>
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <div>
            <h3 className="font-medium text-foreground mb-2">
              Update the agent
            </h3>
            <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm flex items-center justify-between">
              <code className="text-foreground">
                workermill-agent update
              </code>
              <button
                onClick={() =>
                  copyToClipboard(
                    "workermill-agent update",
                    "update-cli",
                  )
                }
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {copied === "update-cli" ? (
                  <CheckCircle className="w-4 h-4 text-green-500" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Self-updates the agent binary from GitHub Releases to the latest version.
            </p>
          </div>
        </div>
      </section>

      {/* Next Steps */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground">Next Steps</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <Link
            to="/docs/vscode-extension"
            className="bg-primary/10 border border-primary/30 rounded-xl p-5 hover:bg-primary/20 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-primary">
                  VS Code Extension
                </h3>
                <p className="text-sm text-primary/70">
                  Monitor tasks, view logs, and manage work from your IDE
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-primary" />
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
                  Connect Jira, Linear, GitHub, and more
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
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
                  Understand how tasks flow through the system
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </Link>
          <Link
            to="/docs/epics"
            className="bg-card border border-border rounded-xl p-5 hover:border-primary/50 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                  Epics & Stories
                </h3>
                <p className="text-sm text-muted-foreground">
                  How tasks decompose into parallel expert work
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

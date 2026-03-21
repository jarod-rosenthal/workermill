import {
  Monitor,
  Download,
  Terminal,
  CheckCircle,
  ArrowRight,
  ArrowDown,
  Copy,
  Bell,
  Eye,
  MessageSquare,
  LayoutList,
  Activity,
  Search,
  FileText,
  AlertTriangle,
  Play,
  Rocket,
  Settings,
  ExternalLink,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";

const features = [
  {
    icon: LayoutList,
    title: "Team Sidebar",
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    description:
      "Tree view with Active Tasks, Backlog (Jira issues), and Recent completions. Click any task to view details and open its log terminal.",
  },
  {
    icon: Activity,
    title: "Activity Feed",
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    description:
      "Real-time expert collaboration feed showing task messages, status updates, and PR links as workers make progress.",
  },
  {
    icon: Terminal,
    title: "Log Terminals",
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    description:
      "Pseudoterminal tabs in VS Code's terminal area. Each running task gets its own tab with live-streamed logs.",
  },
  {
    icon: Bell,
    title: "Notifications",
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
    description:
      "Toast notifications for task start, completion, and failures. Blocker alerts with Retry / Skip / Abort actions.",
  },
  {
    icon: Eye,
    title: "Live Diff",
    color: "text-cyan-500",
    bgColor: "bg-cyan-500/10",
    description:
      "Watch code changes as they happen. The eye icon on each task opens a real-time git diff of worker edits.",
  },
  {
    icon: FileText,
    title: "Full Build",
    color: "text-rose-500",
    bgColor: "bg-rose-500/10",
    description:
      "Right-click any .md file and select \"Full Build\" to decompose a spec into a board of tasks.",
  },
];

const commands = [
  {
    command: "WorkerMill: Run Issue",
    trigger: "Sidebar play button",
    description: "Run a Jira issue as an AI worker task",
  },
  {
    command: "WorkerMill: Search Issues",
    trigger: "Sidebar search button",
    description: "Search Jira/Linear issues and run them",
  },
  {
    command: "WorkerMill: Cancel Task",
    trigger: "Sidebar stop button",
    description: "Stop a running task",
  },
  {
    command: "WorkerMill: Approve Plan",
    trigger: "Notification action",
    description: "Approve an execution plan for a task",
  },
  {
    command: "WorkerMill: Full Build",
    trigger: ".md file context menu",
    description: "Decompose a spec into a board of tasks",
  },
  {
    command: "WorkerMill: Open Live Diff",
    trigger: "Sidebar eye button",
    description: "View real-time code changes from a worker",
  },
  {
    command: "WorkerMill: Install Agent",
    trigger: "Command palette",
    description: "Run the agent install script",
  },
  {
    command: "WorkerMill: Start Agent",
    trigger: "Command palette",
    description: "Start the agent as a background daemon",
  },
  {
    command: "WorkerMill: Stop Agent",
    trigger: "Command palette",
    description: "Stop the running agent",
  },
];

const connectionFlow = [
  {
    component: "WorkerMill Agent",
    description:
      "Starts a local HTTP + SSE server on a random port. Writes the port number to ~/.workermill/agent.port.",
    location: "Your Machine",
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/30",
    icon: Terminal,
  },
  {
    component: "VS Code Extension",
    description:
      "Reads ~/.workermill/agent.port, connects to the local API. Auto-reconnects every 5 seconds if the agent is restarted.",
    location: "Your Machine",
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    icon: Monitor,
  },
  {
    component: "Cloud API",
    description:
      "The extension proxies requests through the agent to workermill.com. No direct cloud connection from VS Code.",
    location: "Cloud",
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
    icon: ExternalLink,
  },
];

export default function VSCodeExtension() {
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
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/10 text-blue-500 text-sm font-medium mb-4">
          <Monitor className="w-4 h-4" />
          VS Code Extension
        </div>
        <h1 className="text-4xl font-bold text-foreground">
          WorkerMill for VS Code
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Monitor tasks, stream logs, manage blockers, and run issues — all
          without leaving your editor.
        </p>
      </div>

      {/* Value Props */}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-5 space-y-2">
          <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <LayoutList className="w-5 h-5 text-blue-500" />
          </div>
          <h3 className="font-semibold text-foreground">Full Task Visibility</h3>
          <p className="text-sm text-muted-foreground">
            See active tasks, backlog issues, and recent completions in the
            sidebar. Click to view details and open log terminals.
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl p-5 space-y-2">
          <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
            <Terminal className="w-5 h-5 text-green-500" />
          </div>
          <h3 className="font-semibold text-foreground">Live Log Streaming</h3>
          <p className="text-sm text-muted-foreground">
            Each task gets its own terminal tab with real-time log output.
            Watch workers plan, execute, and create PRs as it happens.
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl p-5 space-y-2">
          <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
            <Play className="w-5 h-5 text-purple-500" />
          </div>
          <h3 className="font-semibold text-foreground">Run from Your IDE</h3>
          <p className="text-sm text-muted-foreground">
            Search Jira issues, run tasks, respond to blockers, approve plans,
            and run Full Builds — all from VS Code.
          </p>
        </div>
      </div>

      {/* Prerequisites */}
      <section className="space-y-4">
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-5">
          <h4 className="font-semibold text-amber-500 mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Prerequisite: WorkerMill Agent
          </h4>
          <p className="text-sm text-muted-foreground">
            The VS Code extension connects to the{" "}
            <Link
              to="/docs/agent"
              className="text-primary hover:underline font-medium"
            >
              WorkerMill agent
            </Link>{" "}
            running on your machine. Install and start the agent first — the
            extension auto-discovers it via{" "}
            <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
              ~/.workermill/agent.port
            </code>
            .
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
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">
                1
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground text-lg">
                  Install the extension
                </h3>
                <p className="text-muted-foreground mb-4">
                  Install from the VS Code command palette or download the VSIX
                  file.
                </p>
                <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm flex items-center justify-between">
                  <code className="text-foreground">
                    ext install workermill.workermill
                  </code>
                  <button
                    onClick={() =>
                      copyToClipboard(
                        "ext install workermill.workermill",
                        "ext-install",
                      )
                    }
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {copied === "ext-install" ? (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
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
                <h3 className="font-semibold text-foreground text-lg">
                  Start the agent
                </h3>
                <p className="text-muted-foreground mb-4">
                  Make sure the WorkerMill agent is running. The extension
                  connects automatically.
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
                <p className="text-xs text-muted-foreground mt-2">
                  Or use the command palette:{" "}
                  <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
                    WorkerMill: Start Agent
                  </code>
                </p>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">
                3
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground text-lg">
                  Check the status bar
                </h3>
                <p className="text-muted-foreground">
                  The bottom status bar shows the connection state. A green dot
                  with "WorkerMill: Running" means you're connected.
                </p>
                <div className="mt-3 bg-muted/30 rounded-lg p-4 font-mono text-xs space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                    <span className="text-foreground">
                      WorkerMill: Running
                    </span>
                    <span className="text-muted-foreground">
                      — connected to agent
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                    <span className="text-muted-foreground">
                      Waiting for agent
                    </span>
                    <span className="text-muted-foreground">
                      — agent not running or not reachable
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Connects */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <Settings className="w-6 h-6 text-muted-foreground" />
          How It Connects
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="space-y-0">
            {connectionFlow.map((item, idx) => (
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
                {idx < connectionFlow.length - 1 && (
                  <div className="flex justify-center py-1">
                    <ArrowDown className="w-4 h-4 text-muted-foreground/50" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          The extension communicates only with the local agent on{" "}
          <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
            127.0.0.1
          </code>
          . No authentication is needed — the agent proxies requests to the
          cloud API using your configured API key.
        </p>
      </section>

      {/* Features */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <Activity className="w-6 h-6 text-muted-foreground" />
          Features
        </h2>
        <div className="grid md:grid-cols-2 gap-4">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="bg-card border border-border rounded-xl p-5 space-y-3"
            >
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${feature.bgColor}`}>
                  <feature.icon
                    className={`w-5 h-5 ${feature.color}`}
                  />
                </div>
                <h3 className="font-semibold text-foreground">
                  {feature.title}
                </h3>
              </div>
              <p className="text-sm text-muted-foreground">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Sidebar Detail */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <LayoutList className="w-6 h-6 text-muted-foreground" />
          Sidebar Sections
        </h2>
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                <Play className="w-4 h-4 text-blue-500" />
              </div>
              <div>
                <h4 className="font-medium text-foreground">Active Tasks</h4>
                <p className="text-sm text-muted-foreground">
                  Running and planning tasks, grouped by persona. Click to open
                  the log terminal and activity feed. Cancel button stops the
                  worker.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                <Search className="w-4 h-4 text-amber-500" />
              </div>
              <div>
                <h4 className="font-medium text-foreground">Backlog</h4>
                <p className="text-sm text-muted-foreground">
                  Open and in-progress Jira tickets. Use the search button to
                  find issues. Click the play button to run any issue as a task.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center flex-shrink-0">
                <CheckCircle className="w-4 h-4 text-green-500" />
              </div>
              <div>
                <h4 className="font-medium text-foreground">Recent</h4>
                <p className="text-sm text-muted-foreground">
                  Recently completed or failed tasks. Click to review logs and
                  output. Entries are automatically cleaned up after 10 minutes.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Blocker Workflow */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <MessageSquare className="w-6 h-6 text-muted-foreground" />
          Interacting with Workers
        </h2>
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                <CheckCircle className="w-4 h-4 text-purple-500" />
              </div>
              <div>
                <h4 className="font-medium text-foreground">
                  Plan Approval
                </h4>
                <p className="text-sm text-muted-foreground">
                  When a task finishes planning, a notification pops up with the
                  execution plan. Approve to proceed or reject with feedback.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
              </div>
              <div>
                <h4 className="font-medium text-foreground">
                  Blocker Alerts
                </h4>
                <p className="text-sm text-muted-foreground">
                  When a worker gets stuck, you see a notification with three
                  actions: <strong className="text-foreground">Retry</strong>{" "}
                  (try again),{" "}
                  <strong className="text-foreground">Skip</strong> (skip the
                  blocked story), or{" "}
                  <strong className="text-foreground">Abort</strong> (cancel the
                  task).
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                <MessageSquare className="w-4 h-4 text-blue-500" />
              </div>
              <div>
                <h4 className="font-medium text-foreground">
                  Talk to Worker
                </h4>
                <p className="text-sm text-muted-foreground">
                  Send a message to a running worker to provide additional
                  context or redirect its approach. The worker receives it in
                  real time.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Commands Reference */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <Terminal className="w-6 h-6 text-muted-foreground" />
          Commands
        </h2>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-foreground">
                  Command
                </th>
                <th className="text-left px-4 py-3 text-sm font-medium text-foreground">
                  Trigger
                </th>
                <th className="text-left px-4 py-3 text-sm font-medium text-foreground">
                  Description
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {commands.map((cmd) => (
                <tr key={cmd.command} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                      {cmd.command}
                    </code>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {cmd.trigger}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {cmd.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          All commands are available via{" "}
          <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
            Ctrl+Shift+P
          </code>{" "}
          (or{" "}
          <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
            Cmd+Shift+P
          </code>{" "}
          on macOS) by typing "WorkerMill".
        </p>
      </section>

      {/* PRD Feature */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <Rocket className="w-6 h-6 text-muted-foreground" />
          Full Build
        </h2>
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <p className="text-muted-foreground">
            Turn a product requirements document into a board of actionable
            tasks — directly from your editor.
          </p>
          <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
            <li>
              Open a{" "}
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
                .md
              </code>{" "}
              file in VS Code
            </li>
            <li>
              Right-click and select{" "}
              <strong className="text-foreground">
                Full Build
              </strong>{" "}
              (or click the rocket icon in the editor title bar)
            </li>
            <li>
              The agent decomposes the spec using your configured AI provider, streaming
              progress in real time
            </li>
            <li>
              A board is created on workermill.com with individual cards for
              each task
            </li>
          </ol>
          <p className="text-xs text-muted-foreground">
            Full Build runs entirely on your machine using your API key.
            The resulting board and cards are synced to the cloud dashboard.
          </p>
        </div>
      </section>

      {/* Troubleshooting */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <AlertTriangle className="w-6 h-6 text-muted-foreground" />
          Troubleshooting
        </h2>
        <div className="space-y-3">
          <div className="bg-card border border-border rounded-xl p-5">
            <h4 className="font-medium text-foreground mb-1">
              Status bar shows "Waiting for agent"
            </h4>
            <p className="text-sm text-muted-foreground">
              The agent is not running or has crashed. Run{" "}
              <code className="bg-muted px-1 py-0.5 rounded text-xs">
                workermill-agent start
              </code>{" "}
              in a terminal, or use the command palette:{" "}
              <code className="bg-muted px-1 py-0.5 rounded text-xs">
                WorkerMill: Start Agent
              </code>
              .
            </p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <h4 className="font-medium text-foreground mb-1">
              Extension connected but sidebar is empty
            </h4>
            <p className="text-sm text-muted-foreground">
              No tasks are active or queued. Create a task from the dashboard or
              run a Jira issue from the sidebar search.
            </p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <h4 className="font-medium text-foreground mb-1">
              Log terminal not opening for a task
            </h4>
            <p className="text-sm text-muted-foreground">
              Click on the task in the sidebar to manually open its log
              terminal. The terminal should auto-open when a new task starts.
            </p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <h4 className="font-medium text-foreground mb-1">
              Extension not showing after install
            </h4>
            <p className="text-sm text-muted-foreground">
              Reload VS Code (
              <code className="bg-muted px-1 py-0.5 rounded text-xs">
                Ctrl+Shift+P
              </code>{" "}
              &rarr; "Developer: Reload Window"). The extension activates on
              startup.
            </p>
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
                <h3 className="font-semibold text-primary">Agent Setup</h3>
                <p className="text-sm text-primary/70">
                  Install and configure the WorkerMill agent
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
        </div>
      </section>
    </div>
  );
}

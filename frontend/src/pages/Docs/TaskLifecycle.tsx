import {
  Circle,
  Play,
  Cpu,
  GitPullRequest,
  GitMerge,
  Rocket,
  CheckCircle,
  XCircle,
  AlertCircle,
  ArrowDown,
  RotateCcw,
  UserCheck,
  RefreshCw,
  Webhook,
  Tag,
  Wrench,
  Users,
  AlertTriangle,
  Save,
  Shield,
  Bot,
  Zap,
  HelpCircle,
  FileText,
  GitBranch,
  Search,
  Hammer,
  MessageSquare,
} from "lucide-react";

const autopilotStages = [
  {
    status: "created",
    icon: Circle,
    color: "text-gray-400",
    bgColor: "bg-gray-400/10",
    borderColor: "border-gray-400/30",
    title: "Task Created",
    description: "A ticket is assigned to WorkerMill and a task is created.",
    duration: "Instant",
    details: [
      "Ticket detected via webhook or polling",
      "Task record created with ticket metadata",
      "Worker persona selected based on task type",
    ],
  },
  {
    status: "executing",
    icon: Cpu,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
    title: "Worker Executes",
    description: "AI worker analyzes, implements, and iterates until the task is complete.",
    duration: "5-30 minutes",
    details: [
      "Worker clones repository and reads codebase",
      "Implements required changes based on ticket",
      "Runs tests and type checks to verify work",
      "Iterates automatically if tests fail",
      "Continues until all checks pass",
    ],
  },
  {
    status: "deploying",
    icon: Rocket,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    title: "Auto Deploy",
    description: "Worker deploys changes to verify they work in the target environment.",
    duration: "2-5 minutes",
    details: [
      "Changes are deployed to staging/production",
      "Worker verifies deployment succeeded",
      "If deployment fails, worker iterates and tries again",
    ],
  },
  {
    status: "pr_created",
    icon: GitPullRequest,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/30",
    title: "PR Created",
    description: "Once everything works, worker creates a pull request with all changes.",
    duration: "~1 minute",
    details: [
      "All changes committed to feature branch",
      "Pull request opened with summary",
      "Includes test results and deployment status",
    ],
  },
  {
    status: "deployed",
    icon: GitMerge,
    color: "text-accent",
    bgColor: "bg-accent/10",
    borderColor: "border-accent/30",
    title: "Deployed",
    description: "PR is automatically merged and deployed. Task complete.",
    duration: "Instant",
    details: [
      "PR merged to main branch",
      "Ticket status updated",
      "Metrics recorded (MTTA, MTTR, cost)",
    ],
  },
];

const reviewRequestedFlow = [
  {
    status: "created",
    icon: Circle,
    color: "text-gray-400",
    bgColor: "bg-gray-400/10",
    borderColor: "border-gray-400/30",
    title: "Task Created",
    description: "A ticket with the 'review' label triggers this workflow.",
    details: [
      "Ticket detected via webhook",
      "Task created with review flag enabled",
      "Worker persona selected based on task type",
    ],
  },
  {
    status: "executing",
    icon: Cpu,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
    title: "Worker Executes",
    description: "AI worker implements changes and iterates until tests pass.",
    details: [
      "Worker clones repository and reads codebase",
      "Implements required changes based on ticket",
      "Runs tests and type checks to verify work",
      "Iterates until all checks pass",
    ],
  },
  {
    status: "review_requested",
    icon: GitPullRequest,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/30",
    title: "PR Created (Review Requested)",
    description: "Worker creates a PR and pauses—does NOT deploy or merge.",
    details: [
      "All changes committed to feature branch",
      "PR opened with 'review requested' status",
      "Task enters waiting state until approved",
    ],
  },
  {
    status: "manager_review",
    icon: UserCheck,
    color: "text-indigo-500",
    bgColor: "bg-indigo-500/10",
    borderColor: "border-indigo-500/30",
    title: "Tech Lead Reviewer or Human Review",
    description: "The Tech Lead Reviewer AI or a human reviews the PR.",
    details: [
      "Tech Lead Reviewer: AI reviews code quality and standards",
      "Human: Developer examines changes manually",
      "Either can approve, request changes, or reject",
    ],
  },
  {
    status: "review_approved",
    icon: Webhook,
    color: "text-cyan-500",
    bgColor: "bg-cyan-500/10",
    borderColor: "border-cyan-500/30",
    title: "Review Approved",
    description: "PR approval fires a webhook that triggers continuation.",
    details: [
      "GitHub webhook detects PR approval",
      "WorkerMill receives approval event",
      "Task automatically resumes execution",
    ],
  },
  {
    status: "deployed",
    icon: Rocket,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    title: "Auto Deploy & Merge",
    description: "System deploys the approved changes and merges the PR.",
    details: [
      "Worker deploys to staging/production",
      "Verifies deployment succeeded",
      "Merges PR to main branch",
    ],
  },
];

const escalationFlow = [
  {
    status: "executing",
    icon: Cpu,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
    title: "Worker Executing",
    description: "Worker encounters a blocker it cannot resolve autonomously.",
    details: [
      "Unclear requirements in ticket description",
      "Missing attachments or referenced files",
      "Security concern requiring human decision",
      "Breaking change needing explicit authorization",
    ],
  },
  {
    status: "escalated",
    icon: AlertTriangle,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/30",
    title: "Escalated",
    description: "Worker outputs ::result::escalated and adds detailed comment explaining the blocker.",
    details: [
      "Detailed analysis of what was attempted",
      "Specific information needed to proceed",
      "Worker pauses and awaits human intervention",
    ],
  },
  {
    status: "human_review",
    icon: HelpCircle,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    title: "Human Reviews",
    description: "Human reviews the escalation comment and provides clarification.",
    details: [
      "Update ticket with missing information",
      "Clarify ambiguous requirements",
      "Approve breaking changes if needed",
    ],
  },
  {
    status: "requeued",
    icon: RefreshCw,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/30",
    title: "Re-queued",
    description: "Task is re-queued with updated context. Worker resumes with clarification.",
    details: [
      "Remove and re-add workermill label",
      "Or use dashboard re-queue button",
      "Worker picks up task with new context",
    ],
  },
];

const failureStates = [
  {
    status: "escalated",
    icon: AlertTriangle,
    color: "text-amber-500",
    title: "Escalated",
    description: "Worker understood the task but needs human input to proceed.",
  },
  {
    status: "failed",
    icon: XCircle,
    color: "text-red-500",
    title: "Failed",
    description: "Task could not be completed after maximum retries.",
  },
  {
    status: "cancelled",
    icon: AlertCircle,
    color: "text-gray-500",
    title: "Cancelled",
    description: "Task was manually cancelled by an operator.",
  },
];

// Workflow modes based on issue tracker labels
const workflowModes = [
  {
    id: "default",
    name: "Default",
    labels: ["workermill"],
    labelDescription: "Only the workermill label",
    icon: FileText,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/30",
    description: "WorkerMill plans your task, breaks it into sub-tasks, and executes them — creating a PR when done.",
    steps: ["Planning", "Parallel Execution", "PR Created", "Approval", "Deploy & Merge"],
    keyPoints: [
      "Automatically decomposes tasks into smaller sub-tasks",
      "Multiple AI workers execute in parallel",
      "Real-time progress tracking per sub-task",
    ],
  },
  {
    id: "auto_deploy",
    name: "Auto-Deploy",
    labels: ["workermill", "deploy"],
    labelDescription: "workermill + deploy labels",
    icon: Rocket,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/30",
    description: "Worker executes, creates PR, auto-merges, and deploys without waiting for human approval.",
    steps: ["Queued", "Executing", "PR Created", "Auto-Merge", "Deploy"],
    keyPoints: [
      "No human review required",
      "PR is created and merged automatically",
      "Deployment happens after merge",
      "Best for trusted, automated pipelines",
    ],
  },
  {
    id: "review",
    name: "Auto Review",
    labels: ["workermill", "review"],
    labelDescription: "workermill + review labels",
    icon: Users,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
    description: "Full agent autonomy. Tech Lead Reviewer (AI) reviews the PR before deployment. Can request up to 3 revisions.",
    steps: ["Queued", "Executing", "PR Created", "Tech Lead Review", "Approved", "Deploy & Merge"],
    keyPoints: [
      "Full autonomy - no human intervention required",
      "Tech Lead Reviewer AI reviews code quality and correctness",
      "Can approve or request revisions up to 3 times",
      "After approval, deploys and merges automatically",
    ],
  },
  {
    id: "manager",
    name: "Self-Healing",
    labels: ["workermill", "manager"],
    labelDescription: "workermill + manager labels",
    icon: Wrench,
    color: "text-indigo-500",
    bgColor: "bg-indigo-500/10",
    borderColor: "border-indigo-500/30",
    description: "Autonomous error detection and recovery. Monitors agent execution, analyzes logs for failures, and automatically fixes environment issues.",
    steps: ["Queued", "Executing", "Monitor & Detect", "Auto-Repair", "Resume Task"],
    keyPoints: [
      "Monitors agent logs for errors, missing tools, or environment issues",
      "Automatically analyzes failures and attempts remediation",
      "Ideal for new repositories or complex setups",
      "Reduces manual intervention for recoverable errors",
    ],
  },
];

// Label combinations reference
const labelReference = [
  { labels: ["workermill"], workflow: "Default", description: "Automatically plans and executes task" },
  { labels: ["workermill", "deploy"], workflow: "Auto-Deploy", description: "Auto-merge PR and deploy, no approval required" },
  { labels: ["workermill", "review"], workflow: "Auto Review", description: "Tech Lead Reviewer AI reviews PR before deploy" },
  { labels: ["workermill", "critic"], workflow: "Plan Validation", description: "Validates the execution plan before running" },
  { labels: ["workermill", "improve"], workflow: "Self-Improve", description: "Worker reflects and learns from the task" },
  { labels: ["workermill", "sdk"], workflow: "Single Worker", description: "Skip planning, single worker handles entire task" },
  { labels: ["workermill", "haiku"], workflow: "Model Override", description: "Use efficient model (optimized for speed)" },
  { labels: ["workermill", "sonnet"], workflow: "Model Override", description: "Use balanced model (speed + capability)" },
  { labels: ["workermill", "opus"], workflow: "Model Override", description: "Use flagship model (most capable)" },
  { labels: ["workermill", "openai"], workflow: "Provider Override", description: "Use OpenAI GPT models" },
  { labels: ["workermill", "gemini"], workflow: "Provider Override", description: "Use Google Gemini models" },
  { labels: ["workermill", "ollama"], workflow: "Provider Override", description: "Use self-hosted models via Ollama" },
];

// AI Provider labels
const providerLabels = [
  { label: "anthropic", provider: "Anthropic", description: "Claude models (default)", icon: "🤖" },
  { label: "openai", provider: "OpenAI", description: "GPT-4o, o3-mini, o1", icon: "🔷" },
  { label: "gemini", provider: "Google", description: "Gemini 3 Pro, Gemini 2.0 Flash", icon: "🔵" },
  { label: "ollama", provider: "Ollama", description: "Local models (Qwen, DeepSeek, Llama)", icon: "🏠" },
];

// Escalation reasons
const escalationReasons = [
  { reason: "Unclear requirements", example: "Ticket says 'fix the bug' without specifying which bug", action: "Clarify the specific issue" },
  { reason: "Missing attachments", example: "Screenshots or mockups failed to download", action: "Re-attach files to ticket" },
  { reason: "Security concern", example: "Found vulnerability requiring human decision", action: "Review and approve approach" },
  { reason: "Breaking change", example: "Required changes would break API contract", action: "Explicitly authorize breaking change" },
  { reason: "Cannot reproduce", example: "Reported bug doesn't occur in testing", action: "Provide more reproduction steps" },
  { reason: "Blocked > 15 min", example: "Environment or access issues", action: "Fix infrastructure/access" },
];

// Advanced features
const advancedFeatures = [
  {
    id: "checkpointing",
    title: "Worker Checkpointing",
    icon: Save,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    description: "Workers save execution state for seamless recovery from unexpected interruptions.",
    details: [
      "State checkpointed periodically during execution",
      "Automatic recovery from interruptions",
      "Task re-queued with checkpoint reference",
      "New worker resumes from saved state",
    ],
  },
  {
    id: "coordination",
    title: "Multi-Worker Coordination",
    icon: Users,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    description: "When multiple workers operate on the same repository, WorkerMill coordinates them to prevent conflicts.",
    details: [
      "Workers check-in when starting",
      "Heartbeats sent every 30 seconds",
      "File locks prevent conflicting edits",
      "Stale workers cleaned up automatically",
    ],
  },
  {
    id: "team-planning",
    title: "Task Planning",
    icon: FileText,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    description: "Automatically decomposes tasks into coordinated, parallel sub-tasks with dependency tracking.",
    details: [
      "Analyzes requirements and creates sub-tasks",
      "Determines dependency order between sub-tasks",
      "Executes sub-tasks in parallel with specialized workers",
      "Real-time progress per sub-task in dashboard",
    ],
  },
];

export default function TaskLifecycle() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">Task Lifecycle</h1>
        <p className="text-muted-foreground">
          WorkerMill runs on <strong className="text-foreground">autopilot</strong>. Workers iterate until they get it right,
          then deploy, create a PR, and merge—all automatically.
        </p>
      </div>

      {/* Key Concept */}
      <section className="bg-primary/5 border border-primary/20 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-primary mb-3">How It Works</h2>
        <p className="text-muted-foreground mb-4">
          Unlike traditional CI/CD where you push code and hope it works, WorkerMill workers
          <strong className="text-foreground"> iterate continuously</strong> until everything passes:
        </p>
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-background rounded-lg border border-border">
            <RefreshCw className="w-4 h-4 text-primary" />
            <span className="text-sm">Write code</span>
          </div>
          <span className="text-muted-foreground">→</span>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-background rounded-lg border border-border">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <span className="text-sm">Run tests</span>
          </div>
          <span className="text-muted-foreground">→</span>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-background rounded-lg border border-border">
            <XCircle className="w-4 h-4 text-red-500" />
            <span className="text-sm">Fail?</span>
          </div>
          <span className="text-muted-foreground">→</span>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-background rounded-lg border border-border">
            <RotateCcw className="w-4 h-4 text-amber-500" />
            <span className="text-sm">Fix & retry</span>
          </div>
          <span className="text-muted-foreground">→</span>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-background rounded-lg border border-border">
            <Rocket className="w-4 h-4 text-blue-500" />
            <span className="text-sm">Deploy</span>
          </div>
        </div>
      </section>

      {/* Workflow Modes Section */}
      <section className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <Tag className="w-6 h-6 text-primary" />
            Workflow Modes
          </h2>
          <p className="text-muted-foreground mt-2">
            Control how WorkerMill processes your tasks using <strong className="text-foreground">issue tracker labels</strong> (Jira, Linear, GitHub Issues).
            The <code className="px-1.5 py-0.5 bg-muted rounded text-sm">workermill</code> label is required.
            Add other labels to change the workflow.
          </p>
        </div>

        {/* Workflow Mode Cards */}
        <div className="grid md:grid-cols-2 gap-4">
          {workflowModes.map((mode) => (
            <div key={mode.id} className={`bg-card border ${mode.borderColor} rounded-xl p-5 space-y-4`}>
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg ${mode.bgColor} flex-shrink-0`}>
                  <mode.icon className={`w-5 h-5 ${mode.color}`} />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-foreground">{mode.name}</h3>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {mode.labels.map((label) => (
                      <span key={label} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">{mode.description}</p>

              {/* Steps flow */}
              <div className="flex flex-wrap items-center gap-1 text-xs">
                {mode.steps.map((step, idx) => (
                  <span key={idx} className="flex items-center gap-1">
                    <span className={`px-2 py-0.5 rounded ${mode.bgColor} ${mode.color}`}>{step}</span>
                    {idx < mode.steps.length - 1 && <span className="text-muted-foreground">→</span>}
                  </span>
                ))}
              </div>

              {/* Key points */}
              <ul className="space-y-1">
                {mode.keyPoints.map((point, idx) => (
                  <li key={idx} className="text-xs text-muted-foreground flex items-start gap-2">
                    <CheckCircle className="w-3 h-3 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Label Reference Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border bg-muted/30">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Tag className="w-4 h-4" />
              Label Reference
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="p-3">Labels</th>
                  <th className="p-3">Workflow</th>
                  <th className="p-3">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {labelReference.map((ref, idx) => (
                  <tr key={idx} className="hover:bg-muted/30">
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {ref.labels.map((label) => (
                          <span key={label} className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                            {label}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-3 font-medium text-foreground">{ref.workflow}</td>
                    <td className="p-3 text-muted-foreground">{ref.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Important Notes */}
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-5">
          <h4 className="font-semibold text-amber-500 mb-2 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            Important Notes
          </h4>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-amber-500">•</span>
              <span><strong className="text-foreground">Planning is automatic</strong> — just add the <code className="px-1 bg-muted rounded">workermill</code> label and WorkerMill will plan, decompose, and execute your task in parallel.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-500">•</span>
              <span>Labels are <strong className="text-foreground">additive</strong> — combine <code className="px-1 bg-muted rounded">deploy</code>, <code className="px-1 bg-muted rounded">review</code>, <code className="px-1 bg-muted rounded">critic</code>, or <code className="px-1 bg-muted rounded">improve</code> as needed.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-500">•</span>
              <span>The <code className="px-1 bg-muted rounded">critic</code> label validates the execution plan before running. The <code className="px-1 bg-muted rounded">improve</code> label enables self-learning.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-500">•</span>
              <span>Model labels (<code className="px-1 bg-muted rounded">haiku</code>, <code className="px-1 bg-muted rounded">sonnet</code>, <code className="px-1 bg-muted rounded">opus</code>) and provider labels (<code className="px-1 bg-muted rounded">openai</code>, <code className="px-1 bg-muted rounded">gemini</code>, <code className="px-1 bg-muted rounded">ollama</code>) can be added to any workflow.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-500">•</span>
              <span>Don't combine <code className="px-1 bg-muted rounded">deploy</code> + <code className="px-1 bg-muted rounded">review</code> — they conflict (deploy skips review, review requires it).</span>
            </li>
          </ul>
        </div>
      </section>

      {/* Side-by-Side Workflow Comparison */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Detailed Workflow Comparison</h2>
        <p className="text-muted-foreground">
          Compare Autopilot (fully automatic) vs Auto Review (AI reviews with full autonomy).
        </p>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Autopilot Column */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/30 rounded-xl">
              <Play className="w-5 h-5 text-green-500" />
              <div>
                <h3 className="font-semibold text-foreground">Autopilot Mode</h3>
                <p className="text-xs text-muted-foreground">Standard • Fully automatic</p>
              </div>
            </div>
            <div className="space-y-0">
              {autopilotStages.map((stage, idx) => (
                <div key={stage.status}>
                  <div className={`bg-card border ${stage.borderColor} rounded-lg p-4`}>
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg ${stage.bgColor} flex-shrink-0`}>
                        <stage.icon className={`w-5 h-5 ${stage.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h4 className="font-medium text-foreground text-sm">{stage.title}</h4>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${stage.bgColor} ${stage.color}`}>
                            {stage.status}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-2">
                          {stage.description}
                        </p>
                        <ul className="space-y-0.5">
                          {stage.details.slice(0, 2).map((detail, i) => (
                            <li key={i} className="text-[11px] text-muted-foreground/80 flex items-start gap-1.5">
                              <div className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
                              <span>{detail}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                  {idx < autopilotStages.length - 1 && (
                    <div className="flex justify-center py-1">
                      <ArrowDown className="w-4 h-4 text-muted-foreground/50" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Auto Review Column */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
              <UserCheck className="w-5 h-5 text-amber-500" />
              <div>
                <h3 className="font-semibold text-foreground">Auto Review</h3>
                <p className="text-xs text-muted-foreground">Full autonomy • AI reviews PR</p>
              </div>
            </div>
            <div className="space-y-0">
              {reviewRequestedFlow.map((stage, idx) => (
                <div key={stage.status}>
                  <div className={`bg-card border ${stage.borderColor} rounded-lg p-4`}>
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg ${stage.bgColor} flex-shrink-0`}>
                        <stage.icon className={`w-5 h-5 ${stage.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h4 className="font-medium text-foreground text-sm">{stage.title}</h4>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${stage.bgColor} ${stage.color}`}>
                            {stage.status}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-2">
                          {stage.description}
                        </p>
                        <ul className="space-y-0.5">
                          {stage.details.slice(0, 2).map((detail, i) => (
                            <li key={i} className="text-[11px] text-muted-foreground/80 flex items-start gap-1.5">
                              <div className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
                              <span>{detail}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                  {idx < reviewRequestedFlow.length - 1 && (
                    <div className="flex justify-center py-1">
                      <ArrowDown className="w-4 h-4 text-muted-foreground/50" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Key Differences Callout */}
        <div className="bg-card border border-border rounded-xl p-4 mt-4">
          <h4 className="font-medium text-foreground mb-2">Key Differences</h4>
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div className="flex items-start gap-2">
              <Play className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
              <div>
                <span className="font-medium text-foreground">Autopilot:</span>
                <span className="text-muted-foreground"> Deploys first, then creates PR and auto-merges. Zero human touch.</span>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <UserCheck className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
              <div>
                <span className="font-medium text-foreground">Auto Review:</span>
                <span className="text-muted-foreground"> Creates PR first, Tech Lead Reviewer AI reviews it, then deploys and merges.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Iteration Mechanism */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <RotateCcw className="w-5 h-5 text-primary" />
          Automatic Iteration
        </h2>
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <p className="text-muted-foreground">
            Workers don't just try once and give up. They iterate until the task is complete:
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-background rounded-lg p-4 border border-border">
              <h4 className="font-medium text-foreground mb-2">Test Failures</h4>
              <p className="text-sm text-muted-foreground">
                If tests fail, the worker analyzes the error, fixes the code, and runs tests again.
              </p>
            </div>
            <div className="bg-background rounded-lg p-4 border border-border">
              <h4 className="font-medium text-foreground mb-2">Type Errors</h4>
              <p className="text-sm text-muted-foreground">
                TypeScript errors are automatically fixed and rechecked until clean.
              </p>
            </div>
            <div className="bg-background rounded-lg p-4 border border-border">
              <h4 className="font-medium text-foreground mb-2">Deployment Failures</h4>
              <p className="text-sm text-muted-foreground">
                If deployment fails, the worker investigates logs, fixes the issue, and redeploys.
              </p>
            </div>
            <div className="bg-background rounded-lg p-4 border border-border">
              <h4 className="font-medium text-foreground mb-2">Build Errors</h4>
              <p className="text-sm text-muted-foreground">
                Build failures are analyzed and resolved before continuing.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 pt-2">
            <div className="bg-background rounded-lg p-4 border border-border text-center flex-1">
              <div className="text-2xl font-bold text-foreground">∞</div>
              <div className="text-sm text-muted-foreground">Iterations until success</div>
            </div>
            <div className="bg-background rounded-lg p-4 border border-border text-center flex-1">
              <div className="text-2xl font-bold text-foreground">3</div>
              <div className="text-sm text-muted-foreground">Max task-level retries</div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Workers iterate within a task until success. If the task itself fails (e.g., fundamentally impossible),
            it can retry up to 3 times with a fresh context.
          </p>
        </div>
      </section>

      {/* Worker Execution Flow */}
      <section className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <Cpu className="w-6 h-6 text-purple-500" />
            Inside Worker Execution
          </h2>
          <p className="text-muted-foreground mt-2">
            When a task enters the <strong className="text-foreground">executing</strong> state, here is what happens
            behind the scenes. WorkerMill breaks your task into sub-tasks (stories), assigns specialized AI workers,
            and runs them in parallel.
          </p>
        </div>

        {/* Step-by-step execution flow */}
        <div className="space-y-0">
          {/* Step 1: Persona Matching */}
          <div>
            <div className="bg-card border border-purple-500/30 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-purple-500/10 flex-shrink-0">
                  <Users className="w-5 h-5 text-purple-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h4 className="font-medium text-foreground text-sm">1. Expert Assignment</h4>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    Each sub-task is assigned to a <strong className="text-foreground">persona-matched expert</strong>.
                    WorkerMill maintains a registry of specialized personas (e.g., backend, frontend, devops, database)
                    and matches each sub-task to the best-fit expert based on the work required.
                  </p>
                  <ul className="space-y-0.5">
                    <li className="text-[11px] text-muted-foreground/80 flex items-start gap-1.5">
                      <div className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
                      <span>Sub-tasks specify which persona they need (e.g., "backend-engineer")</span>
                    </li>
                    <li className="text-[11px] text-muted-foreground/80 flex items-start gap-1.5">
                      <div className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
                      <span>The coordinator matches each sub-task to an available expert with the right skills</span>
                    </li>
                    <li className="text-[11px] text-muted-foreground/80 flex items-start gap-1.5">
                      <div className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
                      <span>Dependency order is respected -- sub-tasks wait for their prerequisites</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
            <div className="flex justify-center py-1">
              <ArrowDown className="w-4 h-4 text-muted-foreground/50" />
            </div>
          </div>

          {/* Step 2: Parallel Execution in Worktrees */}
          <div>
            <div className="bg-card border border-blue-500/30 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10 flex-shrink-0">
                  <GitBranch className="w-5 h-5 text-blue-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h4 className="font-medium text-foreground text-sm">2. Parallel Execution in Isolated Worktrees</h4>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    Each expert works in its own <strong className="text-foreground">isolated git worktree</strong> on a
                    dedicated branch. Multiple experts run <strong className="text-foreground">simultaneously</strong> without
                    interfering with each other.
                  </p>
                  <ul className="space-y-0.5">
                    <li className="text-[11px] text-muted-foreground/80 flex items-start gap-1.5">
                      <div className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
                      <span>Each sub-task gets its own branch and worktree (e.g., story/PROJ-123/0, story/PROJ-123/1)</span>
                    </li>
                    <li className="text-[11px] text-muted-foreground/80 flex items-start gap-1.5">
                      <div className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
                      <span>File-overlap detection prevents two experts from editing the same files at once</span>
                    </li>
                    <li className="text-[11px] text-muted-foreground/80 flex items-start gap-1.5">
                      <div className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
                      <span>Experts can ask each other questions across worktrees via a coordination channel</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
            <div className="flex justify-center py-1">
              <ArrowDown className="w-4 h-4 text-muted-foreground/50" />
            </div>
          </div>

          {/* Step 3: Inline Review */}
          <div>
            <div className="bg-card border border-amber-500/30 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10 flex-shrink-0">
                  <Search className="w-5 h-5 text-amber-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h4 className="font-medium text-foreground text-sm">3. Inline Review Cycle</h4>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    As each expert completes its sub-task, a <strong className="text-foreground">Tech Lead reviewer</strong> (AI)
                    inspects the changes on that branch. If the review finds issues, the expert revises its work
                    before moving on.
                  </p>
                  <ul className="space-y-0.5">
                    <li className="text-[11px] text-muted-foreground/80 flex items-start gap-1.5">
                      <div className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
                      <span>Tech Lead reviews each sub-task's diff and scores code quality</span>
                    </li>
                    <li className="text-[11px] text-muted-foreground/80 flex items-start gap-1.5">
                      <div className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
                      <span>If revisions are needed, the expert applies fixes in the same worktree</span>
                    </li>
                    <li className="text-[11px] text-muted-foreground/80 flex items-start gap-1.5">
                      <div className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
                      <span>Review-fix cycles repeat until approved (or max revisions reached)</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
            <div className="flex justify-center py-1">
              <ArrowDown className="w-4 h-4 text-muted-foreground/50" />
            </div>
          </div>

          {/* Step 4: Quality Gates */}
          <div>
            <div className="bg-card border border-green-500/30 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-green-500/10 flex-shrink-0">
                  <Shield className="w-5 h-5 text-green-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h4 className="font-medium text-foreground text-sm">4. Quality Gates</h4>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    Before code is finalized, it passes through <strong className="text-foreground">two quality gates</strong> to
                    catch issues early.
                  </p>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div className="bg-background rounded p-2 border border-border">
                      <h5 className="text-[11px] font-medium text-foreground mb-1">Gate 1: Pre-Commit</h5>
                      <p className="text-[10px] text-muted-foreground">
                        Runs your configured shell commands (type checks, linting, tests) before committing.
                        Configurable per board column.
                      </p>
                    </div>
                    <div className="bg-background rounded p-2 border border-border">
                      <h5 className="text-[11px] font-medium text-foreground mb-1">Gate 2: Post-Push CI</h5>
                      <p className="text-[10px] text-muted-foreground">
                        After pushing, polls your CI pipeline (GitHub Actions, GitLab CI, Bitbucket Pipelines)
                        and waits for it to pass.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-center py-1">
              <ArrowDown className="w-4 h-4 text-muted-foreground/50" />
            </div>
          </div>

          {/* Step 5: Auto-Fix */}
          <div>
            <div className="bg-card border border-orange-500/30 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-orange-500/10 flex-shrink-0">
                  <Hammer className="w-5 h-5 text-orange-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h4 className="font-medium text-foreground text-sm">5. Auto-Fix on Failures</h4>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    When a quality gate fails, WorkerMill does not give up. It automatically analyzes the failure
                    and attempts to fix it.
                  </p>
                  <ul className="space-y-0.5">
                    <li className="text-[11px] text-muted-foreground/80 flex items-start gap-1.5">
                      <div className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
                      <span>First attempts shell-based auto-fix (e.g., running lint --fix)</span>
                    </li>
                    <li className="text-[11px] text-muted-foreground/80 flex items-start gap-1.5">
                      <div className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
                      <span>If that fails, spawns a dedicated AI fix agent to resolve the issues</span>
                    </li>
                    <li className="text-[11px] text-muted-foreground/80 flex items-start gap-1.5">
                      <div className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
                      <span>Retries up to 3 iterations (configurable) before escalating</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
            <div className="flex justify-center py-1">
              <ArrowDown className="w-4 h-4 text-muted-foreground/50" />
            </div>
          </div>

          {/* Step 6: Consolidation */}
          <div>
            <div className="bg-card border border-indigo-500/30 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-indigo-500/10 flex-shrink-0">
                  <GitMerge className="w-5 h-5 text-indigo-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h4 className="font-medium text-foreground text-sm">6. Consolidation into a Single PR</h4>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    Once all sub-tasks are complete, their individual branches are merged into a
                    single <strong className="text-foreground">consolidated feature branch</strong> and a PR is created.
                  </p>
                  <ul className="space-y-0.5">
                    <li className="text-[11px] text-muted-foreground/80 flex items-start gap-1.5">
                      <div className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
                      <span>All story branches are merged into one feature branch</span>
                    </li>
                    <li className="text-[11px] text-muted-foreground/80 flex items-start gap-1.5">
                      <div className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
                      <span>Quality checks run again on the consolidated branch</span>
                    </li>
                    <li className="text-[11px] text-muted-foreground/80 flex items-start gap-1.5">
                      <div className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
                      <span>A single PR is opened with a summary of all changes across sub-tasks</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
            <div className="flex justify-center py-1">
              <ArrowDown className="w-4 h-4 text-muted-foreground/50" />
            </div>
          </div>

          {/* Step 7: Blockers */}
          <div>
            <div className="bg-card border border-red-500/30 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-red-500/10 flex-shrink-0">
                  <MessageSquare className="w-5 h-5 text-red-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h4 className="font-medium text-foreground text-sm">Blockers and Escalations</h4>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    If an expert encounters something it cannot resolve, the coordinator handles it automatically
                    before escalating to a human.
                  </p>
                  <ul className="space-y-0.5">
                    <li className="text-[11px] text-muted-foreground/80 flex items-start gap-1.5">
                      <div className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
                      <span>Auto-retry: the expert retries up to 3 times with a fresh approach</span>
                    </li>
                    <li className="text-[11px] text-muted-foreground/80 flex items-start gap-1.5">
                      <div className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
                      <span>If retries are exhausted, the sub-task is skipped and the rest continue</span>
                    </li>
                    <li className="text-[11px] text-muted-foreground/80 flex items-start gap-1.5">
                      <div className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
                      <span>The final PR includes all completed work, with failed sub-tasks noted</span>
                    </li>
                    <li className="text-[11px] text-muted-foreground/80 flex items-start gap-1.5">
                      <div className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
                      <span>Fundamental blockers (unclear requirements, security decisions) escalate to humans</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Failure States */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Terminal States</h2>
        <div className="grid md:grid-cols-4 gap-4">
          <div className="bg-card border border-green-500/30 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <h3 className="font-semibold text-foreground">Completed</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Task finished. Changes deployed and merged.
            </p>
          </div>
          {failureStates.map((state) => (
            <div
              key={state.status}
              className="bg-card border border-border rounded-xl p-5"
            >
              <div className="flex items-center gap-3 mb-2">
                <state.icon className={`w-5 h-5 ${state.color}`} />
                <h3 className="font-semibold text-foreground">{state.title}</h3>
              </div>
              <p className="text-sm text-muted-foreground">{state.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Escalation Workflow */}
      <section className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-amber-500" />
            Escalation Workflow
          </h2>
          <p className="text-muted-foreground mt-2">
            When workers encounter blockers they cannot resolve autonomously, they <strong className="text-foreground">escalate</strong> rather than fail.
            This ensures work is never lost and maintains quality.
          </p>
        </div>

        {/* Escalation Flow Diagram */}
        <div className="space-y-0">
          {escalationFlow.map((stage, idx) => (
            <div key={stage.status}>
              <div className={`bg-card border ${stage.borderColor} rounded-lg p-4`}>
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg ${stage.bgColor} flex-shrink-0`}>
                    <stage.icon className={`w-5 h-5 ${stage.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h4 className="font-medium text-foreground text-sm">{stage.title}</h4>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${stage.bgColor} ${stage.color}`}>
                        {stage.status}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      {stage.description}
                    </p>
                    <ul className="space-y-0.5">
                      {stage.details.map((detail, i) => (
                        <li key={i} className="text-[11px] text-muted-foreground/80 flex items-start gap-1.5">
                          <div className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
                          <span>{detail}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
              {idx < escalationFlow.length - 1 && (
                <div className="flex justify-center py-1">
                  <ArrowDown className="w-4 h-4 text-muted-foreground/50" />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Escalation vs Failure */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h4 className="font-semibold text-foreground mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />
            Escalation vs Failure
          </h4>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span className="font-medium text-foreground">Escalated</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Worker <strong className="text-foreground">understood</strong> the task but needs human input.
                Provide clarification and re-queue.
              </p>
            </div>
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <XCircle className="w-4 h-4 text-red-500" />
                <span className="font-medium text-foreground">Failed</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Worker encountered a <strong className="text-foreground">technical error</strong>.
                Check logs, fix infrastructure, retry.
              </p>
            </div>
          </div>
        </div>

        {/* Escalation Reasons Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border bg-muted/30">
            <h4 className="font-semibold text-foreground">Common Escalation Reasons</h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="p-3">Reason</th>
                  <th className="p-3">Example</th>
                  <th className="p-3">Resolution</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {escalationReasons.map((item, idx) => (
                  <tr key={idx} className="hover:bg-muted/30">
                    <td className="p-3 font-medium text-foreground">{item.reason}</td>
                    <td className="p-3 text-muted-foreground text-xs">{item.example}</td>
                    <td className="p-3 text-muted-foreground">{item.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* AI Provider Support */}
      <section className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <Bot className="w-6 h-6 text-primary" />
            AI Provider Support
          </h2>
          <p className="text-muted-foreground mt-2">
            WorkerMill supports multiple AI providers. Add a provider label to your ticket to select which AI runs your task.
          </p>
        </div>

        {/* Provider Cards */}
        <div className="grid md:grid-cols-4 gap-4">
          {providerLabels.map((provider) => (
            <div key={provider.label} className="bg-card border border-border rounded-xl p-4 hover:border-primary/50 transition-colors">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl">{provider.icon}</span>
                <div>
                  <h4 className="font-medium text-foreground">{provider.provider}</h4>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    {provider.label}
                  </span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{provider.description}</p>
            </div>
          ))}
        </div>

        {/* Provider Notes */}
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-5">
          <h4 className="font-semibold text-blue-500 mb-2 flex items-center gap-2">
            <Zap className="w-4 h-4" />
            Provider Selection
          </h4>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-blue-500">•</span>
              <span>If no provider label is specified, the organization's <strong className="text-foreground">default provider</strong> is used (configurable in Settings).</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-500">•</span>
              <span>Model labels (<code className="px-1 bg-muted rounded">haiku</code>, <code className="px-1 bg-muted rounded">sonnet</code>, <code className="px-1 bg-muted rounded">opus</code>) only apply to Anthropic. Other providers use their default models.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-500">•</span>
              <span>Each provider's usage is tracked separately in the analytics dashboard.</span>
            </li>
          </ul>
        </div>
      </section>

      {/* Advanced Features */}
      <section className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <Zap className="w-6 h-6 text-primary" />
            Advanced Features
          </h2>
          <p className="text-muted-foreground mt-2">
            WorkerMill includes advanced capabilities for resilience, coordination, and complex task execution.
          </p>
        </div>

        {/* Feature Cards */}
        <div className="grid md:grid-cols-3 gap-4">
          {advancedFeatures.map((feature) => (
            <div key={feature.id} className={`bg-card border border-border rounded-xl p-5 space-y-3`}>
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${feature.bgColor}`}>
                  <feature.icon className={`w-5 h-5 ${feature.color}`} />
                </div>
                <h4 className="font-semibold text-foreground">{feature.title}</h4>
              </div>
              <p className="text-sm text-muted-foreground">{feature.description}</p>
              <ul className="space-y-1">
                {feature.details.map((detail, idx) => (
                  <li key={idx} className="text-xs text-muted-foreground flex items-start gap-2">
                    <CheckCircle className="w-3 h-3 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>{detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Status Color Legend */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Status Colors</h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex flex-wrap gap-4">
            {[
              { color: "bg-gray-400", label: "Created" },
              { color: "bg-purple-500", label: "Executing" },
              { color: "bg-blue-500", label: "Deploying" },
              { color: "bg-green-500", label: "PR Created" },
              { color: "bg-accent", label: "Merged / Completed" },
              { color: "bg-amber-500", label: "Review Requested" },
              { color: "bg-indigo-500", label: "Human Review" },
              { color: "bg-red-500", label: "Failed" },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${item.color}`} />
                <span className="text-sm text-muted-foreground">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

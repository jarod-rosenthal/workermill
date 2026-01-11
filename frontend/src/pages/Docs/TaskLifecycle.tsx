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
} from "lucide-react";

const autopilotStages = [
  {
    status: "created",
    icon: Circle,
    color: "text-gray-400",
    bgColor: "bg-gray-400/10",
    borderColor: "border-gray-400/30",
    title: "Task Created",
    description: "A Jira ticket is assigned to WorkerMill and a task is created.",
    duration: "Instant",
    details: [
      "Jira ticket detected via webhook or polling",
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
    status: "merged",
    icon: GitMerge,
    color: "text-accent",
    bgColor: "bg-accent/10",
    borderColor: "border-accent/30",
    title: "Auto Merge",
    description: "PR is automatically merged. Task complete.",
    duration: "Instant",
    details: [
      "PR merged to main branch",
      "Jira ticket status updated",
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
    description: "A Jira ticket with 'review' label triggers this workflow.",
    details: [
      "Jira ticket detected via webhook",
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
    title: "Virtual Manager or Human Review",
    description: "The Virtual Manager AI or a human reviews the PR.",
    details: [
      "Virtual Manager: AI reviews code quality and standards",
      "Human: Developer examines changes manually",
      "Either can approve, request changes, or reject",
    ],
  },
  {
    status: "webhook_triggered",
    icon: Webhook,
    color: "text-cyan-500",
    bgColor: "bg-cyan-500/10",
    borderColor: "border-cyan-500/30",
    title: "Approval Webhook",
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

const failureStates = [
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

      {/* Side-by-Side Workflow Comparison */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Workflow Comparison</h2>
        <p className="text-muted-foreground">
          Compare Autopilot (fully automatic) vs Review Mode (pauses for approval before deploy).
        </p>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Autopilot Column */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/30 rounded-xl">
              <Play className="w-5 h-5 text-green-500" />
              <div>
                <h3 className="font-semibold text-foreground">Autopilot Mode</h3>
                <p className="text-xs text-muted-foreground">Default • Fully automatic</p>
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

          {/* Review Mode Column */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
              <UserCheck className="w-5 h-5 text-amber-500" />
              <div>
                <h3 className="font-semibold text-foreground">Review Mode</h3>
                <p className="text-xs text-muted-foreground">Optional • Pauses for approval</p>
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
                <span className="font-medium text-foreground">Review Mode:</span>
                <span className="text-muted-foreground"> Creates PR first, waits for approval, then deploys and merges.</span>
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

      {/* Failure States */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Terminal States</h2>
        <div className="grid md:grid-cols-3 gap-4">
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

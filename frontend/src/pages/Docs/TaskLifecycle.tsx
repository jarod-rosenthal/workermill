import {
  Circle,
  Clock,
  Play,
  Cpu,
  GitPullRequest,
  UserCheck,
  CheckCircle,
  XCircle,
  AlertCircle,
  ArrowDown,
  RotateCcw,
} from "lucide-react";

const lifecycleStages = [
  {
    status: "created",
    icon: Circle,
    color: "text-gray-400",
    bgColor: "bg-gray-400/10",
    borderColor: "border-gray-400/30",
    title: "Created",
    description: "Task is created from a Jira ticket when conditions are met (assigned, correct label, etc.)",
    duration: "Instant",
    details: [
      "Jira ticket is detected via webhook or polling",
      "Task record is created in WorkerMill database",
      "Ticket summary and metadata are captured",
    ],
  },
  {
    status: "queued",
    icon: Clock,
    color: "text-yellow-500",
    bgColor: "bg-yellow-500/10",
    borderColor: "border-yellow-500/30",
    title: "Queued",
    description: "Task is waiting for an available worker slot. Priority and severity determine order.",
    duration: "Variable",
    details: [
      "Task enters the execution queue",
      "Ordered by severity (P1 > P2 > P3...)",
      "Waits for worker capacity",
    ],
  },
  {
    status: "claimed",
    icon: Play,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    title: "Claimed",
    description: "A worker has claimed the task and is preparing to execute.",
    duration: "~30 seconds",
    details: [
      "Worker selects task from queue",
      "Persona and model are assigned",
      "Execution environment begins setup",
    ],
  },
  {
    status: "executing",
    icon: Cpu,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
    title: "Executing",
    description: "AI worker is actively working on the task. This is the main work phase.",
    duration: "5-30 minutes",
    details: [
      "Worker reads codebase and documentation",
      "Implements required changes",
      "Runs tests and validates work",
      "Iterates on feedback if needed",
    ],
  },
  {
    status: "pr_created",
    icon: GitPullRequest,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/30",
    title: "PR Created",
    description: "Worker has created a pull request. Awaiting virtual manager review.",
    duration: "~5 minutes",
    details: [
      "Code changes are committed",
      "Pull request is opened on GitHub",
      "PR includes summary and test results",
    ],
  },
  {
    status: "manager_review",
    icon: UserCheck,
    color: "text-indigo-500",
    bgColor: "bg-indigo-500/10",
    borderColor: "border-indigo-500/30",
    title: "Manager Review",
    description: "Virtual manager AI is reviewing the PR for quality and correctness.",
    duration: "1-3 minutes",
    details: [
      "Manager AI reviews code changes",
      "Checks for quality and best practices",
      "May approve, request revisions, or reject",
    ],
  },
  {
    status: "completed",
    icon: CheckCircle,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/30",
    title: "Completed",
    description: "Task successfully completed. PR is ready for human review and merge.",
    duration: "Terminal",
    details: [
      "Manager has approved the work",
      "Jira ticket is updated",
      "PR awaits human merge",
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
          Understanding how tasks flow through WorkerMill from creation to completion.
        </p>
      </div>

      {/* Visual Flow */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Lifecycle Stages</h2>
        <div className="space-y-0">
          {lifecycleStages.map((stage, idx) => (
            <div key={stage.status}>
              <div
                className={`bg-card border ${stage.borderColor} rounded-xl p-5 space-y-3`}
              >
                <div className="flex items-start gap-4">
                  <div className={`p-3 rounded-lg ${stage.bgColor}`}>
                    <stage.icon className={`w-6 h-6 ${stage.color}`} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="font-semibold text-foreground">{stage.title}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${stage.bgColor} ${stage.color}`}>
                        {stage.status}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {stage.duration}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">
                      {stage.description}
                    </p>
                    <ul className="space-y-1">
                      {stage.details.map((detail, i) => (
                        <li
                          key={i}
                          className="text-xs text-muted-foreground flex items-center gap-2"
                        >
                          <div className="w-1 h-1 rounded-full bg-muted-foreground" />
                          {detail}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
              {idx < lifecycleStages.length - 1 && (
                <div className="flex justify-center py-2">
                  <ArrowDown className="w-5 h-5 text-muted-foreground" />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Retry Mechanism */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <RotateCcw className="w-5 h-5 text-primary" />
          Retry Mechanism
        </h2>
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <p className="text-muted-foreground">
            If a task fails during execution, WorkerMill automatically retries based on configuration:
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-background rounded-lg p-4 border border-border">
              <div className="text-2xl font-bold text-foreground">3</div>
              <div className="text-sm text-muted-foreground">Default max retries</div>
            </div>
            <div className="bg-background rounded-lg p-4 border border-border">
              <div className="text-2xl font-bold text-foreground">30s</div>
              <div className="text-sm text-muted-foreground">Retry delay</div>
            </div>
            <div className="bg-background rounded-lg p-4 border border-border">
              <div className="text-2xl font-bold text-foreground">Exponential</div>
              <div className="text-sm text-muted-foreground">Backoff strategy</div>
            </div>
          </div>
          <div className="text-sm text-muted-foreground">
            After max retries are exhausted, the task moves to <code className="text-red-400">failed</code> state.
          </div>
        </div>
      </section>

      {/* Failure States */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Terminal States</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-card border border-green-500/30 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <h3 className="font-semibold text-foreground">Completed</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Task successfully finished. PR created and approved.
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
              { color: "bg-yellow-500", label: "Queued" },
              { color: "bg-blue-500", label: "Claimed" },
              { color: "bg-purple-500", label: "Executing" },
              { color: "bg-green-500", label: "PR Created / Completed" },
              { color: "bg-indigo-500", label: "Manager Review" },
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

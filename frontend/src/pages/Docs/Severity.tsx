import { AlertTriangle, Clock, Timer } from "lucide-react";

const severityLevels = [
  {
    level: "P1",
    name: "Critical",
    color: "text-red-500",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/30",
    description: "Production is down or severely impacted. Requires immediate attention.",
    responseTime: "< 15 minutes",
    resolutionTarget: "< 4 hours",
    examples: [
      "Complete service outage",
      "Data breach or security incident",
      "Revenue-impacting bug in production",
      "All users affected",
    ],
    workerBehavior: "Highest queue priority. May interrupt other tasks.",
  },
  {
    level: "P2",
    name: "High",
    color: "text-orange-500",
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/30",
    description: "Major functionality broken. Significant user impact but workarounds exist.",
    responseTime: "< 1 hour",
    resolutionTarget: "< 8 hours",
    examples: [
      "Key feature not working",
      "Performance severely degraded",
      "Many users affected",
      "Blocking release",
    ],
    workerBehavior: "High queue priority. Processed before P3-P5.",
  },
  {
    level: "P3",
    name: "Medium",
    color: "text-yellow-500",
    bgColor: "bg-yellow-500/10",
    borderColor: "border-yellow-500/30",
    description: "Standard priority for planned development work and non-urgent bugs.",
    responseTime: "< 4 hours",
    resolutionTarget: "< 24 hours",
    examples: [
      "New feature implementation",
      "Minor bugs with workarounds",
      "Enhancements to existing features",
      "Non-critical integrations",
    ],
    workerBehavior: "Normal queue priority. FIFO among same priority.",
  },
  {
    level: "P4",
    name: "Low",
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    description: "Nice-to-have improvements. Can be addressed when capacity allows.",
    responseTime: "< 24 hours",
    resolutionTarget: "< 1 week",
    examples: [
      "UI polish and improvements",
      "Documentation updates",
      "Minor optimizations",
      "Technical debt reduction",
    ],
    workerBehavior: "Lower queue priority. May wait for higher priority work.",
  },
  {
    level: "P5",
    name: "Trivial",
    color: "text-gray-400",
    bgColor: "bg-gray-400/10",
    borderColor: "border-gray-400/30",
    description: "Backlog items with no urgency. Addressed opportunistically.",
    responseTime: "Best effort",
    resolutionTarget: "When capacity allows",
    examples: [
      "Cosmetic issues",
      "Long-term refactoring",
      "Research and exploration",
      "Nice-to-have features",
    ],
    workerBehavior: "Lowest queue priority. Processed when queue is empty.",
  },
];

export default function Severity() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">Severity Levels</h1>
        <p className="text-muted-foreground">
          WorkerMill uses P1-P5 severity levels to prioritize tasks. Higher severity tasks
          are processed first.
        </p>
      </div>

      {/* Severity Overview */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-primary" />
          P1-P5 Reference
        </h2>
        <div className="space-y-4">
          {severityLevels.map((severity) => (
            <div
              key={severity.level}
              className={`bg-card border ${severity.borderColor} rounded-xl p-5`}
            >
              <div className="flex items-start gap-4">
                <div className={`w-14 h-14 rounded-xl ${severity.bgColor} flex items-center justify-center shrink-0`}>
                  <span className={`text-xl font-bold ${severity.color}`}>{severity.level}</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className={`text-lg font-semibold ${severity.color}`}>{severity.name}</h3>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Response: {severity.responseTime}
                      </span>
                      <span className="flex items-center gap-1">
                        <Timer className="w-3 h-3" />
                        Resolution: {severity.resolutionTarget}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">{severity.description}</p>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="text-xs font-medium text-foreground mb-2 uppercase tracking-wide">
                        Examples
                      </h4>
                      <ul className="space-y-1">
                        {severity.examples.map((example, i) => (
                          <li key={i} className="text-xs text-muted-foreground flex items-center gap-2">
                            <div className={`w-1 h-1 rounded-full ${severity.bgColor.replace("/10", "")}`} />
                            {example}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4 className="text-xs font-medium text-foreground mb-2 uppercase tracking-wide">
                        Worker Behavior
                      </h4>
                      <p className="text-xs text-muted-foreground">{severity.workerBehavior}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Priority Queue */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Queue Priority</h2>
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <p className="text-muted-foreground">
            When workers become available, tasks are assigned based on:
          </p>
          <ol className="space-y-3">
            <li className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">1</span>
              <div>
                <span className="font-medium text-foreground">Severity Level</span>
                <p className="text-sm text-muted-foreground">P1 tasks always processed before P2, P2 before P3, etc.</p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">2</span>
              <div>
                <span className="font-medium text-foreground">Queue Time (FIFO)</span>
                <p className="text-sm text-muted-foreground">Among same-severity tasks, older tasks are processed first.</p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">3</span>
              <div>
                <span className="font-medium text-foreground">Persona Availability</span>
                <p className="text-sm text-muted-foreground">Tasks are routed to workers with the appropriate persona.</p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      {/* Priority Mapping */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Priority Mapping</h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            WorkerMill automatically maps priority fields from all supported issue trackers (Jira, GitHub, GitLab, Bitbucket) to severity levels:
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 text-foreground font-medium">Issue Priority</th>
                  <th className="text-left py-3 text-foreground font-medium">WorkerMill Severity</th>
                  <th className="text-left py-3 text-foreground font-medium">Response Time</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b border-border">
                  <td className="py-3">Highest / Blocker</td>
                  <td className="py-3"><span className="text-red-500 font-medium">P1 Critical</span></td>
                  <td className="py-3">{"<"} 15 min</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-3">High</td>
                  <td className="py-3"><span className="text-orange-500 font-medium">P2 High</span></td>
                  <td className="py-3">{"<"} 1 hour</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-3">Medium</td>
                  <td className="py-3"><span className="text-yellow-500 font-medium">P3 Medium</span></td>
                  <td className="py-3">{"<"} 4 hours</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-3">Low</td>
                  <td className="py-3"><span className="text-blue-500 font-medium">P4 Low</span></td>
                  <td className="py-3">{"<"} 24 hours</td>
                </tr>
                <tr>
                  <td className="py-3">Lowest</td>
                  <td className="py-3"><span className="text-gray-400 font-medium">P5 Trivial</span></td>
                  <td className="py-3">Best effort</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Visual Priority Bar */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Priority Visualization</h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-8 rounded-l-lg bg-red-500/80 flex items-center justify-center text-xs font-bold text-white">
              P1
            </div>
            <div className="flex-1 h-8 bg-orange-500/80 flex items-center justify-center text-xs font-bold text-white">
              P2
            </div>
            <div className="flex-1 h-8 bg-yellow-500/80 flex items-center justify-center text-xs font-bold text-black">
              P3
            </div>
            <div className="flex-1 h-8 bg-blue-500/80 flex items-center justify-center text-xs font-bold text-white">
              P4
            </div>
            <div className="flex-1 h-8 rounded-r-lg bg-gray-500/80 flex items-center justify-center text-xs font-bold text-white">
              P5
            </div>
          </div>
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>Highest Priority</span>
            <span>Lowest Priority</span>
          </div>
        </div>
      </section>
    </div>
  );
}

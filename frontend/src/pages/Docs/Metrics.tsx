import {
  BarChart3,
  DollarSign,
  Clock,
  TrendingUp,
  Activity,
  Timer,
  Zap,
  ArrowRight,
} from "lucide-react";

export default function Metrics() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">Metrics</h1>
        <p className="text-muted-foreground">
          Track performance, costs, and throughput across your WorkerMill deployment.
          Key metrics include MTTA (Mean Time to Acknowledge) and MTTR (Mean Time to Resolution).
        </p>
      </div>

      {/* MTTA and MTTR */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Timer className="w-5 h-5 text-primary" />
          Key Time Metrics
        </h2>
        <div className="grid md:grid-cols-2 gap-6">
          {/* MTTA */}
          <div className="bg-card border border-blue-500/30 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 rounded-lg bg-blue-500/10">
                <Clock className="w-6 h-6 text-blue-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground">MTTA</h3>
                <p className="text-sm text-muted-foreground">Mean Time to Acknowledge</p>
              </div>
            </div>
            <p className="text-muted-foreground mb-4">
              The average time from when a task is <strong className="text-foreground">created</strong> (queued)
              to when it is <strong className="text-foreground">claimed</strong> by a worker.
            </p>
            <div className="bg-background rounded-lg p-4 border border-border mb-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Task Created</span>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">Worker Claims</span>
              </div>
              <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full w-1/3 bg-blue-500 rounded-full" />
              </div>
            </div>
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-foreground">Factors Affecting MTTA:</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>- Queue depth (more tasks = longer wait)</li>
                <li>- Worker availability and capacity</li>
                <li>- Task priority (P1 acknowledged faster)</li>
                <li>- Persona availability</li>
              </ul>
            </div>
            <div className="mt-4 p-3 bg-blue-500/10 rounded-lg">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-blue-500">Typical MTTA</span>
                <span className="text-lg font-bold text-blue-500">{"<"} 2 min*</span>
              </div>
              <p className="text-xs text-blue-400/80">*Varies based on queue depth and worker availability</p>
            </div>
          </div>

          {/* MTTR */}
          <div className="bg-card border border-green-500/30 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 rounded-lg bg-green-500/10">
                <Zap className="w-6 h-6 text-green-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground">MTTR</h3>
                <p className="text-sm text-muted-foreground">Mean Time to Resolution</p>
              </div>
            </div>
            <p className="text-muted-foreground mb-4">
              The average time from when a task is <strong className="text-foreground">created</strong>
              to when it is <strong className="text-foreground">completed</strong> (PR approved).
            </p>
            <div className="bg-background rounded-lg p-4 border border-border mb-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Task Created</span>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">Task Completed</span>
              </div>
              <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full w-full bg-green-500 rounded-full" />
              </div>
            </div>
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-foreground">Factors Affecting MTTR:</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>- Task complexity (story points)</li>
                <li>- Codebase size and complexity</li>
                <li>- Test suite execution time</li>
                <li>- Manager review speed</li>
              </ul>
            </div>
            <div className="mt-4 p-3 bg-green-500/10 rounded-lg">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-green-500">Typical MTTR</span>
                <span className="text-lg font-bold text-green-500">15-45 min*</span>
              </div>
              <p className="text-xs text-green-400/80">*Varies significantly by task complexity and codebase size</p>
            </div>
          </div>
        </div>
      </section>

      {/* MTTA vs MTTR Visual */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">MTTA vs MTTR Timeline</h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="relative">
            {/* Timeline */}
            <div className="flex items-center">
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <div className="flex-1 h-1 bg-blue-500" />
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <div className="flex-1 h-1 bg-purple-500" />
              <div className="w-3 h-3 rounded-full bg-purple-500" />
              <div className="flex-1 h-1 bg-green-500" />
              <div className="w-3 h-3 rounded-full bg-green-500" />
            </div>
            {/* Labels */}
            <div className="flex justify-between mt-2 text-xs text-muted-foreground">
              <span>Created</span>
              <span>Claimed</span>
              <span>PR Created</span>
              <span>Completed</span>
            </div>
            {/* Brackets */}
            <div className="mt-4 space-y-2">
              <div className="flex items-center">
                <div className="w-[12.5%]" />
                <div className="w-[25%] border-t-2 border-l-2 border-r-2 border-blue-500 rounded-t h-3" />
                <div className="flex-1" />
              </div>
              <div className="flex items-center text-xs">
                <div className="w-[12.5%]" />
                <div className="w-[25%] text-center text-blue-500 font-medium">MTTA</div>
                <div className="flex-1" />
              </div>
              <div className="flex items-center">
                <div className="w-[12.5%]" />
                <div className="w-[75%] border-t-2 border-l-2 border-r-2 border-green-500 rounded-t h-3" />
                <div className="flex-1" />
              </div>
              <div className="flex items-center text-xs">
                <div className="w-[12.5%]" />
                <div className="w-[75%] text-center text-green-500 font-medium">MTTR</div>
                <div className="flex-1" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Other Metrics */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Additional Metrics</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-accent/10">
                <DollarSign className="w-5 h-5 text-accent" />
              </div>
              <h3 className="font-semibold text-foreground">Cost Tracking</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Monitor AI API costs in real-time with detailed breakdowns.
            </p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>- Per-task cost tracking</li>
              <li>- Token usage (input/output)</li>
              <li>- Daily/weekly/monthly summaries</li>
              <li>- Cost per persona breakdown</li>
            </ul>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-purple-500/10">
                <TrendingUp className="w-5 h-5 text-purple-500" />
              </div>
              <h3 className="font-semibold text-foreground">Success Rate</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Monitor task completion and failure rates.
            </p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>- Overall success percentage</li>
              <li>- Failure reasons breakdown</li>
              <li>- Retry success rates</li>
              <li>- Per-persona success rates</li>
            </ul>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-orange-500/10">
                <Activity className="w-5 h-5 text-orange-500" />
              </div>
              <h3 className="font-semibold text-foreground">Throughput</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Track task volume and processing capacity.
            </p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>- Tasks completed per hour/day</li>
              <li>- Queue depth trends</li>
              <li>- Worker utilization</li>
              <li>- Peak hours analysis</li>
            </ul>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <BarChart3 className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground">Manager Stats</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Track virtual manager review performance.
            </p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>- Review count and duration</li>
              <li>- Approval rate</li>
              <li>- Revisions requested</li>
              <li>- Manager cost breakdown</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Dashboard Metrics */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Dashboard Overview</h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            The main dashboard displays real-time metrics at a glance:
          </p>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            {[
              { label: "Workers", sublabel: "Active/Total" },
              { label: "Queue", sublabel: "Depth" },
              { label: "Completed", sublabel: "This period" },
              { label: "Failed", sublabel: "This period" },
              { label: "Period Cost", sublabel: "USD" },
              { label: "Cumulative", sublabel: "All time" },
            ].map((metric) => (
              <div key={metric.label} className="p-3 bg-muted rounded-lg text-center">
                <div className="text-sm font-medium text-foreground">{metric.label}</div>
                <div className="text-xs text-muted-foreground">{metric.sublabel}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Counter Reset */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Counter Reset</h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            Period counters (cost, completed, failed) can be reset to track metrics over custom time periods:
          </p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="font-medium text-foreground">Manual Reset:</span>
              Click "Reset Counters" in the dashboard header
            </li>
            <li className="flex items-start gap-2">
              <span className="font-medium text-foreground">Reset Timestamp:</span>
              Shows when counters were last reset for reference
            </li>
            <li className="flex items-start gap-2">
              <span className="font-medium text-foreground">Historical Data:</span>
              Resetting counters does not delete historical task data
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}

import { Brain, Shield, Zap, GitBranch, Clock, BarChart3 } from "lucide-react"

const features = [
  {
    icon: Zap,
    title: "Autonomous Execution",
    description: "Not an assistant — a workforce. WorkerMill takes your tickets and delivers finished, reviewed code. No prompting, no hand-holding.",
  },
  {
    icon: GitBranch,
    title: "CI/CD as a First-Class Citizen",
    description: "Our workers build CI/CD pipelines and define them in code. From dev to staging to production, your code moves through environments the way it should.",
  },
  {
    icon: Shield,
    title: "Mandatory Tech Lead Review",
    description: "Every PR reviewed before you see it. Up to 3 revision cycles catch bugs, enforce patterns, and ensure production-grade quality.",
  },
  {
    icon: Brain,
    title: "Planning Agent",
    description: "Complex work is decomposed into stories with clear success criteria. Multiple experts coordinate on a single PR — not one model guessing.",
  },
  {
    icon: Clock,
    title: "Async by Design",
    description: "Label tickets at 5pm, review PRs at 9am. Point it at your backlog, tech debt, or a full rewrite and let it work overnight.",
  },
  {
    icon: BarChart3,
    title: "Full Observability",
    description: "Real-time dashboards, live terminal logs, cost tracking, and blocker escalation. You always know what your workers are doing.",
  },
]

export function FeaturesGrid() {
  return (
    <section className="py-24 bg-slate-900/50 border-t border-white/5">
      <div className="container mx-auto px-6 lg:px-8">
        <div className="max-w-2xl mx-auto text-center mb-16">
          <p className="text-sm font-medium text-teal-400 mb-3 tracking-wide">NOT ANOTHER COPILOT</p>
          <h2 className="text-3xl lg:text-4xl font-bold tracking-tight text-white mb-4 text-balance">
            An engineering team that executes, not an assistant that suggests
          </h2>
          <p className="text-lg text-slate-400 leading-relaxed">
            WorkerMill doesn't help you write code. It writes the code, sets up the infrastructure,
            reviews its own work, and delivers PRs ready for your approval.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <div
              key={index}
              className="group bg-slate-900/60 backdrop-blur-sm rounded-xl p-6 border border-white/5 hover:border-white/10 hover:bg-slate-800/60 transition-all duration-300"
            >
              <div className="w-10 h-10 rounded-lg bg-teal-500/10 flex items-center justify-center mb-4 group-hover:bg-teal-500/15 transition-colors">
                <feature.icon className="w-5 h-5 text-teal-400" />
              </div>
              <h3 className="text-base font-semibold text-white mb-2">
                {feature.title}
              </h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

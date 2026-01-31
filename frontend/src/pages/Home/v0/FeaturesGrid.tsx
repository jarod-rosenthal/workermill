import { Brain, Shield, Zap, GitBranch, Clock, BarChart3 } from "lucide-react"

const features = [
  {
    icon: Brain,
    title: "Planning Agent",
    description: "Validates every task before execution. Breaks complex work into manageable steps with clear success criteria.",
  },
  {
    icon: Shield,
    title: "Tech Lead Review",
    description: "Every PR reviewed by our AI Tech Lead. Catches bugs, enforces patterns, and ensures code quality.",
  },
  {
    icon: Zap,
    title: "Tight Feedback Loops",
    description: "Continuous validation at every step. Cheaper models perform like expensive ones through iterative refinement.",
  },
  {
    icon: GitBranch,
    title: "Git-Native Workflow",
    description: "Workers operate directly in your repo. Clean PRs, proper commits, and seamless integration with your process.",
  },
  {
    icon: Clock,
    title: "Async by Design",
    description: "Queue tasks and get results. Workers run 24/7, picking up work from your backlog automatically.",
  },
  {
    icon: BarChart3,
    title: "Full Observability",
    description: "Real-time dashboards, detailed logs, and cost tracking. Know exactly what your workers are doing.",
  },
]

export function FeaturesGrid() {
  return (
    <section className="py-24 bg-slate-900/50 border-t border-white/5">
      <div className="container mx-auto px-6 lg:px-8">
        <div className="max-w-2xl mx-auto text-center mb-16">
          <p className="text-sm font-medium text-teal-400 mb-3 tracking-wide">CAPABILITIES</p>
          <h2 className="text-3xl lg:text-4xl font-bold tracking-tight text-white mb-4 text-balance">
            Enterprise-grade AI coding infrastructure
          </h2>
          <p className="text-lg text-slate-400 leading-relaxed">
            Built for teams that need reliability, security, and control over their AI development workflows.
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

import { ShieldCheck, Eye, Sliders, CheckCircle, DollarSign } from "lucide-react";

const features = [
  {
    icon: DollarSign,
    title: "10x Cost Reduction",
    subtitle: "Smart iteration beats expensive models",
    description:
      "Our feedback loops make cheap models deliver expensive model results. Planning Agent validates before execution, Tech Lead reviews after, and revision loops fix mistakes. You get Opus-quality output at Haiku prices.",
    bullets: [
      "Use Haiku instead of Opus, save 90%",
      "BYOK: Zero markup on AI costs",
      "Multi-provider routing to cheapest option",
      "Per-task cost tracking and limits",
    ],
    visual: "cost",
    align: "left",
  },
  {
    icon: ShieldCheck,
    title: "Quality Through Iteration",
    subtitle: "Feedback loops that catch mistakes",
    description:
      "Every task goes through multiple validation stages. The Planning Agent validates feasibility. Experts execute with specialized knowledge. The Tech Lead reviews and requests revisions. Only quality code reaches your review queue.",
    bullets: [
      "Planning Agent + Critic validation",
      "Tech Lead reviews every PR",
      "Configurable revision cycles (1-10)",
      "Quality gates before human review",
    ],
    visual: "quality",
    align: "right",
  },
  {
    icon: Eye,
    title: "Full Visibility",
    subtitle: "Watch workers in real-time",
    description:
      "See exactly what your AI workers are doing at any moment. Live logs, progress indicators, cost tracking, and detailed execution history. No black boxes, no surprises.",
    bullets: [
      "Real-time execution logs",
      "Live progress tracking",
      "Per-task cost breakdown",
      "Detailed audit history",
    ],
    visual: "visibility",
    align: "left",
  },
  {
    icon: Sliders,
    title: "You're in Control",
    subtitle: "Multi-provider, multi-model",
    description:
      "Route each persona to different AI providers. Use Claude for complex backend work, Gemini for quick QA tasks, local Ollama for ops. Your codebase, your models, your rules.",
    bullets: [
      "Per-persona provider routing",
      "Claude, GPT, Gemini, Ollama support",
      "Set spending limits per task",
      "Cancel or take over anytime",
    ],
    visual: "control",
    align: "right",
  },
];

function CostVisual() {
  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <span className="font-medium text-sm">Cost Comparison</span>
        <span className="text-xs text-muted-foreground">Same task, different approach</span>
      </div>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">🐢</span>
            <span className="text-sm text-muted-foreground">Single-shot Opus</span>
          </div>
          <span className="text-lg font-bold text-red-500">$7.50</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">🚀</span>
            <span className="text-sm text-muted-foreground">WorkerMill + Haiku</span>
          </div>
          <span className="text-lg font-bold text-green-500">$0.75</span>
        </div>
      </div>
      <div className="pt-4 border-t border-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">Your savings</span>
          <span className="text-2xl font-bold text-primary">90%</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div className="h-full w-[90%] bg-gradient-to-r from-green-500 to-primary rounded-full" />
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Same quality through feedback loops, 10x cheaper
        </p>
      </div>
    </div>
  );
}

function QualityVisual() {
  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-4">
      <div className="flex items-center gap-3 pb-4 border-b border-border">
        <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center">
          <span className="text-xl">🎯</span>
        </div>
        <div>
          <div className="font-medium text-sm">Tech Lead</div>
          <div className="text-xs text-muted-foreground">Reviewing PR ***REMOVED***142</div>
        </div>
      </div>
      <div className="space-y-3">
        {[
          { label: "Plan validated by Critic", passed: true },
          { label: "All stories completed", passed: true },
          { label: "Tests passing", passed: true },
          { label: "Code review passed", passed: true },
        ].map((check) => (
          <div key={check.label} className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <span className="text-sm text-muted-foreground">{check.label}</span>
          </div>
        ))}
      </div>
      <div className="pt-4 border-t border-border">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/20 rounded-lg text-green-500 text-sm font-medium">
          <CheckCircle className="w-4 h-4" />
          Approved for merge
        </div>
      </div>
    </div>
  );
}

function VisibilityVisual() {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
        <span className="text-sm font-medium">Live Execution</span>
        <span className="flex items-center gap-1.5 text-xs text-green-500">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          Running
        </span>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">PROJ-142</span>
          <span className="text-primary">$0.47</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div className="h-full w-3/4 bg-gradient-to-r from-primary to-accent rounded-full animate-pulse" />
        </div>
        <div className="terminal-bg rounded-lg p-3 font-mono text-xs space-y-1">
          <div className="text-gray-400">[14:23:15] Analyzing ticket...</div>
          <div className="text-gray-400">[14:23:18] Creating branch...</div>
          <div className="text-primary">[14:23:22] Writing component...</div>
          <div className="text-accent animate-pulse">[14:23:25] Running tests...</div>
        </div>
      </div>
    </div>
  );
}

function ControlVisual() {
  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm">Task Controls</span>
        <span className="text-xs text-muted-foreground">PROJ-142</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: "Pause", color: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20" },
          { label: "Cancel", color: "bg-red-500/10 text-red-500 border-red-500/20" },
          { label: "Retry", color: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
          { label: "Take Over", color: "bg-primary/10 text-primary border-primary/20" },
        ].map((action) => (
          <div
            key={action.label}
            className={`px-3 py-2 rounded-lg border text-center text-sm font-medium ${action.color}`}
          >
            {action.label}
          </div>
        ))}
      </div>
      <div className="pt-4 border-t border-border">
        <label className="text-xs text-muted-foreground block mb-2">Model</label>
        <div className="bg-muted/50 rounded-lg px-3 py-2 text-sm flex items-center justify-between">
          <span>Claude Sonnet 4</span>
          <span className="text-xs text-muted-foreground">$0.003/1K</span>
        </div>
      </div>
    </div>
  );
}

export default function Features() {
  return (
    <section className="py-24 relative">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-card/30 to-transparent" />

      <div className="relative max-w-6xl mx-auto px-6">
        {/* Section header */}
        <div className="text-center mb-20">
          <h2 className="text-3xl lg:text-4xl font-bold mb-4">
            <span className="text-foreground">Smart iteration </span>
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              beats expensive models
            </span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Why pay premium prices when feedback loops deliver the same quality? WorkerMill validates, reviews, and revises automatically.
          </p>
        </div>

        {/* Feature blocks */}
        <div className="space-y-24">
          {features.map((feature) => (
            <div
              key={feature.title}
              className={`grid lg:grid-cols-2 gap-12 items-center ${
                feature.align === "right" ? "lg:flex-row-reverse" : ""
              }`}
            >
              {/* Content */}
              <div className={`space-y-6 ${feature.align === "right" ? "lg:order-2" : ""}`}>
                {/* Icon and subtitle */}
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                    <feature.icon className="w-6 h-6 text-primary" />
                  </div>
                  <span className="text-sm font-medium text-primary">{feature.subtitle}</span>
                </div>

                {/* Title */}
                <h3 className="text-2xl lg:text-3xl font-bold text-foreground">
                  {feature.title}
                </h3>

                {/* Description */}
                <p className="text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>

                {/* Bullets */}
                <ul className="space-y-3">
                  {feature.bullets.map((bullet) => (
                    <li key={bullet} className="flex items-center gap-3">
                      <div className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
                        <CheckCircle className="w-3 h-3 text-accent" />
                      </div>
                      <span className="text-muted-foreground">{bullet}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Visual */}
              <div className={feature.align === "right" ? "lg:order-1" : ""}>
                {feature.visual === "cost" && <CostVisual />}
                {feature.visual === "quality" && <QualityVisual />}
                {feature.visual === "visibility" && <VisibilityVisual />}
                {feature.visual === "control" && <ControlVisual />}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

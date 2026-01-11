import { ArrowRight, Play, Sparkles } from "lucide-react";

export default function Hero() {
  const handleRequestAccess = () => {
    console.log("Request Early Access clicked");
  };

  return (
    <section className="min-h-screen flex flex-col justify-center relative overflow-hidden">
      {/* Animated orbs */}
      <div className="orb orb-primary w-[500px] h-[500px] top-20 left-[10%] animate-float" />
      <div className="orb orb-accent w-[400px] h-[400px] bottom-32 right-[15%] animate-float" style={{ animationDelay: '-3s' }} />
      <div className="orb orb-primary w-[300px] h-[300px] top-1/2 right-[5%] animate-float" style={{ animationDelay: '-5s' }} />

      {/* Gradient overlays */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-transparent to-background pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-r from-background/50 via-transparent to-background/50 pointer-events-none" />

      <div className="relative max-w-6xl mx-auto px-6 py-24">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left side - Copy */}
          <div className="space-y-8">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full gradient-border-subtle text-sm font-medium">
              <Sparkles className="w-4 h-4 text-primary animate-pulse" />
              <span className="text-primary">Now in Private Beta</span>
            </div>

            {/* Headline */}
            <h1 className="text-5xl lg:text-6xl font-bold leading-tight">
              <span className="text-foreground">Your AI engineering team</span>
              <br />
              <span className="text-gradient-animated">
                that actually ships code.
              </span>
            </h1>

            {/* Subheadline */}
            <p className="text-xl text-muted-foreground leading-relaxed max-w-xl">
              Autonomous AI workers that turn Jira tickets into reviewed, tested, and merged pull requests.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-4">
              <button
                onClick={handleRequestAccess}
                className="group inline-flex items-center justify-center gap-2 px-8 py-4 bg-gradient-to-r from-primary to-cyan-400 text-primary-foreground font-semibold rounded-xl hover:shadow-lg hover:shadow-primary/30 transition-all duration-300 hover:-translate-y-0.5"
              >
                Request Early Access
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
              <button className="inline-flex items-center justify-center gap-2 px-8 py-4 text-foreground font-medium rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 transition-all duration-300">
                <Play className="w-5 h-5" />
                Watch Demo
              </button>
            </div>

          </div>

          {/* Right side - Dashboard Preview */}
          <div className="relative">
            {/* Glow effect */}
            <div className="absolute inset-0 bg-gradient-to-r from-primary/30 to-accent/30 rounded-2xl blur-2xl transform scale-105 animate-glow" />

            {/* Dashboard mockup */}
            <div className="relative card-elevated rounded-2xl overflow-hidden glow-mixed">
              {/* Window chrome */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-gradient-to-r from-muted/30 to-muted/10">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                </div>
                <div className="flex-1 text-center text-xs text-muted-foreground font-medium">
                  WorkerMill Control Center
                </div>
              </div>

              {/* Dashboard content placeholder */}
              <div className="p-6 space-y-4">
                {/* Stats row */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Active Workers", value: "4", color: "from-primary/20 to-primary/5", textColor: "text-primary" },
                    { label: "Tasks Today", value: "12", color: "from-accent/20 to-accent/5", textColor: "text-accent" },
                    { label: "PRs Merged", value: "8", color: "from-green-500/20 to-green-500/5", textColor: "text-green-500" },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className={`bg-gradient-to-br ${stat.color} rounded-xl p-3 text-center border border-white/5`}
                    >
                      <div className={`text-2xl font-bold ${stat.textColor}`}>
                        {stat.value}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {stat.label}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Active task cards */}
                <div className="space-y-2">
                  {[
                    { emoji: "🎨", key: "PROJ-142", status: "Executing", progress: 65, color: "from-purple-500" },
                    { emoji: "⚙️", key: "PROJ-138", status: "Testing", progress: 85, color: "from-blue-500" },
                    { emoji: "🔧", key: "PROJ-145", status: "PR Created", progress: 95, color: "from-green-500" },
                  ].map((task) => (
                    <div
                      key={task.key}
                      className="flex items-center gap-3 bg-gradient-to-r from-muted/30 to-transparent rounded-xl p-3 border border-white/5"
                    >
                      <span className="text-lg">{task.emoji}</span>
                      <div className="flex-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium text-foreground">{task.key}</span>
                          <span className="text-muted-foreground text-xs px-2 py-0.5 bg-muted/50 rounded-full">
                            {task.status}
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 bg-muted/50 rounded-full overflow-hidden">
                          <div
                            className={`h-full bg-gradient-to-r ${task.color} to-accent rounded-full transition-all`}
                            style={{ width: `${task.progress}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Terminal preview - black background, green text in dark mode, white text in light mode */}
                <div className="bg-black rounded-xl p-4 font-mono text-xs space-y-1.5 border border-white/20">
                  <div className="text-white dark:text-green-400 flex items-center gap-2">
                    <span className="text-gray-400">[14:23:15]</span>
                    Running test suite...
                  </div>
                  <div className="text-white dark:text-green-400 flex items-center gap-2">
                    <span className="text-gray-400">[14:23:18]</span>
                    42 tests passed
                  </div>
                  <div className="text-white dark:text-green-400 flex items-center gap-2">
                    <span className="text-gray-400">[14:23:19]</span>
                    Creating pull request...
                    <span className="inline-block w-2 h-4 bg-white dark:bg-green-400 animate-pulse" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

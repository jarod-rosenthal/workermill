import { Monitor, Wallet, ShieldCheck, Blocks, CheckCircle } from "lucide-react";

const valueProps = [
  {
    icon: Monitor,
    title: "Your code, your machine.",
    description:
      "Workers run locally — code never leaves your computer. Orchestration intelligence lives in the cloud. Your source code stays on your machine at all times.",
    bullets: [
      "Workers execute on your local machine",
      "Code never uploaded to any server",
      "Cloud handles orchestration only",
      "Full control over your workspace",
    ],
    visual: "local",
    align: "left",
  },
  {
    icon: Wallet,
    title: "Open source. Run it yourself.",
    description:
      "WorkerMill is open source and free to run locally. Bring your own API keys from any supported provider. Cloud-hosted services are coming soon.",
    bullets: [
      "Run the full platform locally with your own API keys",
      "Tech lead review and quality gates included",
      "Cloud services coming soon",
      "BYOK: Bring your own API key, zero markup",
    ],
    visual: "subscription",
    align: "right",
  },
  {
    icon: ShieldCheck,
    title: "Professional standards, not prototype quality.",
    description:
      "Quality gates, security scanning, test requirements, and tech lead review mean output is actually deployable. Every story validated before moving on.",
    bullets: [
      "Planning agent decomposes + validates",
      "Quality gates on every story",
      "Tech lead review before merge",
      "Up to 3 revision cycles per story",
    ],
    visual: "quality",
    align: "left",
  },
  {
    icon: Blocks,
    title: "Works with your stack.",
    description:
      "GitHub, GitLab, Bitbucket. Jira, Linear, GitHub Issues. Claude, GPT, Gemini, or self-hosted Ollama. WorkerMill adapts to your workflow, not the other way around.",
    bullets: [
      "GitHub, GitLab, Bitbucket integrations",
      "Jira, Linear, GitHub Issues triggers",
      "Claude, GPT, Gemini, Ollama providers",
      "Per-persona model routing",
    ],
    visual: "stack",
    align: "right",
  },
];

function LocalVisual() {
  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <span className="font-medium text-sm">Architecture</span>
        <span className="text-xs text-muted-foreground">Hybrid model</span>
      </div>
      <div className="space-y-3">
        <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
          <Monitor className="w-5 h-5 text-green-500 flex-shrink-0" />
          <div>
            <div className="text-sm font-medium text-green-500">Your Machine</div>
            <div className="text-xs text-muted-foreground">Code, git, tests, LLM calls</div>
          </div>
        </div>
        <div className="flex justify-center">
          <div className="text-xs text-muted-foreground px-2 py-1 rounded bg-muted">HTTPS</div>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <Blocks className="w-5 h-5 text-blue-500 flex-shrink-0" />
          <div>
            <div className="text-sm font-medium text-blue-500">WorkerMill Cloud</div>
            <div className="text-xs text-muted-foreground">Planning, coordination, quality gates</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SubscriptionVisual() {
  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <span className="font-medium text-sm">How to Run</span>
        <span className="text-xs text-muted-foreground">Open source</span>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between p-3 rounded-lg bg-green-500/10 border border-green-500/20">
          <div>
            <div className="text-sm font-medium">Self-Hosted</div>
            <div className="text-xs text-muted-foreground">Run locally with your own API keys</div>
          </div>
          <span className="text-sm font-medium text-green-500">Available</span>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <div>
            <div className="text-sm font-medium">Cloud</div>
            <div className="text-xs text-muted-foreground">Managed infrastructure, team features</div>
          </div>
          <span className="text-sm font-medium text-blue-500">Coming Soon</span>
        </div>
      </div>
    </div>
  );
}

function QualityVisual() {
  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-4">
      <div className="flex items-center gap-3 pb-4 border-b border-border">
        <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center">
          <ShieldCheck className="w-5 h-5 text-indigo-500" />
        </div>
        <div>
          <div className="font-medium text-sm">Quality Pipeline</div>
          <div className="text-xs text-muted-foreground">Every story validated</div>
        </div>
      </div>
      <div className="space-y-3">
        {[
          { label: "Plan validated by critic agent", passed: true },
          { label: "Type check passes", passed: true },
          { label: "Tests passing", passed: true },
          { label: "Tech lead review approved", passed: true },
        ].map((check) => (
          <div key={check.label} className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <span className="text-sm text-muted-foreground">{check.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StackVisual() {
  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <span className="font-medium text-sm">Integrations</span>
      </div>
      <div className="space-y-3">
        <div>
          <div className="text-xs text-muted-foreground mb-2">Source Control</div>
          <div className="flex gap-2">
            {["GitHub", "GitLab", "Bitbucket"].map((name) => (
              <span key={name} className="px-2.5 py-1 rounded-lg bg-muted text-xs font-medium">{name}</span>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-2">Task Tracking</div>
          <div className="flex gap-2">
            {["Jira", "Linear", "GitHub Issues"].map((name) => (
              <span key={name} className="px-2.5 py-1 rounded-lg bg-muted text-xs font-medium">{name}</span>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-2">AI Providers</div>
          <div className="flex gap-2 flex-wrap">
            {["Claude", "GPT", "Gemini", "Ollama"].map((name) => (
              <span key={name} className="px-2.5 py-1 rounded-lg bg-muted text-xs font-medium">{name}</span>
            ))}
          </div>
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
            <span className="text-foreground">Why </span>
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              WorkerMill?
            </span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Local-first execution, professional quality gates, and complete flexibility.
          </p>
        </div>

        {/* Feature blocks */}
        <div className="space-y-24">
          {valueProps.map((feature) => (
            <div
              key={feature.title}
              className={`grid lg:grid-cols-2 gap-12 items-center ${
                feature.align === "right" ? "lg:flex-row-reverse" : ""
              }`}
            >
              {/* Content */}
              <div className={`space-y-6 ${feature.align === "right" ? "lg:order-2" : ""}`}>
                {/* Icon and title */}
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                    <feature.icon className="w-6 h-6 text-primary" />
                  </div>
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
                {feature.visual === "local" && <LocalVisual />}
                {feature.visual === "subscription" && <SubscriptionVisual />}
                {feature.visual === "quality" && <QualityVisual />}
                {feature.visual === "stack" && <StackVisual />}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

import { Check, Sparkles, Crown, Zap } from "lucide-react";

interface PricingTier {
  name: string;
  price: string;
  period: string;
  description: string;
  highlight_line: string;
  features: string[];
  highlighted?: boolean;
  icon: React.ReactNode;
  cta: string;
  disabled?: boolean;
  badge?: string;
}

const tiers: PricingTier[] = [
  {
    name: "Free",
    price: "$0",
    period: "",
    description: "For solo developers exploring AI-powered development",
    highlight_line: "Full product, your hardware",
    icon: <Zap className="w-5 h-5" />,
    features: [
      "Unlimited tasks",
      "Automated PR reviews on every pull request",
      "1 concurrent worker",
      "Up to 3 experts per task",
      "GitHub Issues + internal board",
      "Anthropic Claude models",
      "Local + BYOK execution",
      "MCP servers",
      "Basic analytics",
      "7-day log retention",
      "Community support",
    ],
    cta: "Get Started Free",
    disabled: false,
  },
  {
    name: "Pro",
    price: "$14.50",
    period: "/mo",
    description: "For developers and small teams who want speed",
    highlight_line: "Up to 15 seats included",
    icon: <Sparkles className="w-5 h-5" />,
    highlighted: true,
    badge: "Coming Soon",
    features: [
      "Everything in Free, plus:",
      "Auto CI/CD deployments",
      "Auto-annealing agents",
      "All integrations (Jira, GitLab, Bitbucket, Linear)",
      "All AI providers (OpenAI, Google, Ollama)",
      "Codebase RAG",
      "5 concurrent tasks",
      "Unlimited experts per task",
      "Up to 15 users",
      "Local or cloud execution",
      "Advanced analytics",
      "Memory & skills persistence",
      "Role-based access",
      "90-day log retention",
      "Priority support (< 4hr)",
    ],
    cta: "Coming Soon",
    disabled: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    description: "For organizations with compliance and scale needs",
    highlight_line: "Custom configuration",
    icon: <Crown className="w-5 h-5" />,
    badge: "Coming Soon",
    features: [
      "Everything in Pro, plus:",
      "Unlimited users & workers",
      "Self-hosted option",
      "SSO / SAML",
      "Dedicated Worker Pool",
      "IP Allowlisting",
      "Data Residency Controls",
      "AWS Bedrock / Azure AI Foundry",
      "Compliance Center & SOC 2",
      "99.9% SLA",
      "Unlimited log retention",
      "Dedicated CSM",
    ],
    cta: "Coming Soon",
    disabled: true,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="py-20 px-6 bg-card/50">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-foreground mb-4">
            Start Free, Scale When Ready
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto mb-4">
            Full product on Free. Upgrade for parallel workers, cloud execution,
            and team features.
          </p>
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/20 rounded-full">
            <Zap className="w-4 h-4 text-green-500" />
            <span className="text-sm font-medium text-green-500">Free tier includes automated PR reviews, GitHub, internal board, and MCP servers</span>
          </div>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {tiers.map((tier, index) => (
            <div
              key={index}
              className={`relative bg-card border rounded-xl p-6 flex flex-col ${
                tier.highlighted
                  ? "border-primary shadow-lg shadow-primary/10"
                  : "border-border"
              }`}
            >
              {/* Badge */}
              {tier.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="px-3 py-1 text-xs font-medium rounded-full bg-primary text-primary-foreground">
                    {tier.badge}
                  </span>
                </div>
              )}

              <div className={tier.badge ? "pt-4" : ""}>
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className={`p-2 rounded-lg ${
                      tier.highlighted
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {tier.icon}
                  </div>
                  <h3 className="text-xl font-semibold text-foreground">
                    {tier.name}
                  </h3>
                </div>

                <div className="flex items-baseline gap-1 mb-1">
                  <span
                    className={`text-4xl font-bold ${
                      tier.highlighted ? "text-primary" : "text-foreground"
                    }`}
                  >
                    {tier.price}
                  </span>
                  <span className="text-muted-foreground">{tier.period}</span>
                </div>

                <p className="text-sm text-primary font-medium mb-3">
                  {tier.highlight_line}
                </p>

                <p className="text-sm text-muted-foreground mb-6">
                  {tier.description}
                </p>

                <ul className="space-y-3 mb-6 flex-grow">
                  {tier.features.map((feature, featureIndex) => (
                    <li key={featureIndex} className="flex items-start gap-2">
                      <Check
                        className={`w-4 h-4 mt-0.5 ${
                          tier.highlighted ? "text-primary" : "text-accent"
                        }`}
                      />
                      <span className="text-sm text-muted-foreground">
                        {feature}
                      </span>
                    </li>
                  ))}
                </ul>

                {tier.disabled ? (
                  <button
                    disabled
                    className="w-full py-2.5 rounded-lg font-medium text-sm text-center block bg-muted/50 text-muted-foreground border border-border cursor-not-allowed"
                  >
                    {tier.cta}
                  </button>
                ) : tier.name === "Enterprise" ? (
                  <a
                    href="mailto:sales@workermill.com"
                    className="w-full py-2.5 rounded-lg font-medium text-sm transition-colors text-center block bg-muted text-foreground border border-border hover:bg-muted/80"
                  >
                    {tier.cta}
                  </a>
                ) : (
                  <a
                    href="/signup"
                    className="w-full py-2.5 rounded-lg font-medium text-sm transition-colors text-center block bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {tier.cta}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* What You Get */}
        <div className="mt-12 p-6 rounded-xl bg-muted/30 border border-border">
          <h3 className="text-lg font-semibold text-foreground mb-4 text-center">
            How It Works
          </h3>
          <div className="grid md:grid-cols-3 gap-6 text-center">
            <div>
              <p className="font-medium text-foreground mb-1">Full Product, Free</p>
              <p className="text-sm text-muted-foreground">
                No trial limits. Automated PR reviews, GitHub Issues, internal board, and MCP servers — all included.
              </p>
            </div>
            <div>
              <p className="font-medium text-foreground mb-1">Runs on Your Machine</p>
              <p className="text-sm text-muted-foreground">
                Workers execute locally using your Claude Max subscription. Your code never leaves your hardware.
              </p>
            </div>
            <div>
              <p className="font-medium text-foreground mb-1">BYOK Always Included</p>
              <p className="text-sm text-muted-foreground">
                Bring your own API keys on any plan. Zero markup on AI provider costs.
              </p>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}

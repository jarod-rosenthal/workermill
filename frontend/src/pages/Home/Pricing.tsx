import { Check, Sparkles, Crown, Flame } from "lucide-react";

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
    name: "Pro",
    price: "$19",
    period: "/mo",
    description:
      "For developers and small teams getting started with autonomous AI coding",
    highlight_line: "90-day free trial — no credit card required",
    icon: <Sparkles className="w-5 h-5" />,
    badge: "Coming Soon",
    features: [
      "1 concurrent workload",
      "Up to 3 experts per task",
      "Up to 5 users",
      "Simplified planning (single-pass)",
      "Automated PR reviews",
      "GitHub Issues + WorkerMill Kanban",
      "Anthropic Claude models",
      "Local + BYOK execution",
      "MCP servers",
      "Basic analytics",
      "14-day log retention",
      "Email support",
    ],
    cta: "Join Waitlist",
    disabled: true,
  },
  {
    name: "Max",
    price: "$39",
    period: "/mo",
    description:
      "For professional teams who need full power, multi-provider support, and cloud execution",
    highlight_line: "Up to 25 seats included",
    icon: <Flame className="w-5 h-5" />,
    badge: "Coming Soon",
    features: [
      "3 concurrent workloads",
      "Up to 7 experts per task",
      "Up to 25 users",
      "Advanced planning (critic review loop)",
      "Automated PR reviews",
      "All integrations (Jira, Linear, GitHub, GitLab, Bitbucket)",
      "All AI providers (OpenAI, Google, Anthropic)",
      "Local or cloud execution",
      "CI/CD auto-deployments",
      "Codebase RAG",
      "Memory & skills persistence",
      "Role-based access",
      "90-day log retention",
      "Priority support (< 4hr)",
    ],
    cta: "Join Waitlist",
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
      "Custom workload & expert limits",
      "Custom user seats",
      "Everything in Max, plus:",
      "Self-hosted option",
      "SSO / SAML",
      "Dedicated worker pool",
      "IP allowlisting",
      "Data residency controls",
      "AWS Bedrock / Azure AI Foundry",
      "Compliance Center & SOC 2",
      "99.9% SLA",
      "Custom log retention",
      "Dedicated CSM",
    ],
    cta: "Join Waitlist",
    disabled: true,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="py-20 px-6 bg-card/50">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-foreground mb-4">
            Start Building, Scale When Ready
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto mb-4">
            90-day free trial on Pro. Upgrade to Max for parallel workloads,
            cloud execution, and team features.
          </p>
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/20 rounded-full">
            <Sparkles className="w-4 h-4 text-green-500" />
            <span className="text-sm font-medium text-green-500">Pro trial includes automated PR reviews, GitHub Issues, internal board, and MCP servers</span>
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
                  <a
                    href="mailto:waitlist@workermill.com"
                    className="w-full py-2.5 rounded-lg font-medium text-sm transition-colors text-center block bg-muted text-foreground border border-border hover:bg-muted/80"
                  >
                    {tier.cta}
                  </a>
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
              <p className="font-medium text-foreground mb-1">
                Full Product, Free Trial
              </p>
              <p className="text-sm text-muted-foreground">
                90-day Pro trial with automated PR reviews, GitHub Issues,
                internal board, and MCP servers — all included.
              </p>
            </div>
            <div>
              <p className="font-medium text-foreground mb-1">Runs on Your Machine</p>
              <p className="text-sm text-muted-foreground">
                Workers execute locally using your Anthropic account. Your code never leaves your hardware.
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

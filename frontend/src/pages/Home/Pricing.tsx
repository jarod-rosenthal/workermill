import { Check, Sparkles, Building2, Users, Gift, Crown, Zap } from "lucide-react";

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
    highlight_line: "Local execution with Claude Max",
    icon: <Zap className="w-5 h-5" />,
    features: [
      "20 tasks per month",
      "1 user",
      "Local execution only",
      "Up to 2 parallel workers",
      "Tech lead review on every PR",
      "7-day log retention",
      "Community support",
    ],
    cta: "Get Started Free",
    disabled: false,
  },
  {
    name: "Pro",
    price: "$49",
    period: "/seat/mo",
    description: "For developers who want speed and flexibility",
    highlight_line: "Unlimited tasks, parallel execution",
    icon: <Sparkles className="w-5 h-5" />,
    highlighted: true,
    badge: "Most Popular",
    features: [
      "Unlimited tasks",
      "Local + Cloud + BYOK execution",
      "Unlimited parallel workers",
      "All 14+ personas",
      "Memory & skills persistence",
      "Advanced analytics",
      "30-day log retention",
      "Priority support",
    ],
    cta: "Coming Soon",
    disabled: true,
  },
  {
    name: "Team",
    price: "$149",
    period: "/month",
    description: "For teams shipping faster together",
    highlight_line: "Up to 10 seats included",
    icon: <Users className="w-5 h-5" />,
    features: [
      "Everything in Pro, plus:",
      "Up to 25 users",
      "Role-based access",
      "Shared memory & skills",
      "90-day audit logs",
      "SSO / SAML",
      "API access (MCP servers)",
      "Dedicated support",
    ],
    cta: "Coming Soon",
    disabled: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    description: "For large organizations with advanced needs",
    highlight_line: "Custom configuration",
    icon: <Crown className="w-5 h-5" />,
    features: [
      "Everything in Team, plus:",
      "Unlimited users",
      "Self-hosted option",
      "Dedicated Worker Pool",
      "IP Allowlisting",
      "Data Residency Controls",
      "AWS Bedrock / Azure AI Foundry",
      "99.9% SLA",
      "Dedicated CSM",
      "SOC 2 Report available",
    ],
    cta: "Contact Sales",
    disabled: false,
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
            Run locally with your Claude Max subscription at no cost.
            Upgrade for parallel execution, team features, and cloud compute.
          </p>
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/20 rounded-full">
            <Zap className="w-4 h-4 text-green-500" />
            <span className="text-sm font-medium text-green-500">Free tier includes tech lead review on every PR</span>
          </div>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
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
            How Pricing Works
          </h3>
          <div className="grid md:grid-cols-3 gap-6 text-center">
            <div>
              <p className="font-medium text-foreground mb-1">Free = Local Execution</p>
              <p className="text-sm text-muted-foreground">
                You bring Claude Max or Pro. Workers run on your machine. WorkerMill handles orchestration.
              </p>
            </div>
            <div>
              <p className="font-medium text-foreground mb-1">Paid = Speed + Scale</p>
              <p className="text-sm text-muted-foreground">
                Parallel experts, cloud execution, team features, and persistent memory that learns your codebase.
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

        {/* Referral Program */}
        <div className="mt-8 p-6 rounded-xl bg-primary/5 border border-primary/20">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Gift className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-semibold text-foreground">
              Referral Program
            </h3>
          </div>
          <p className="text-center text-muted-foreground mb-4">
            Share WorkerMill with your network and earn rewards.
          </p>
          <div className="grid md:grid-cols-2 gap-4 max-w-lg mx-auto">
            <div className="text-center p-3 bg-card rounded-lg border border-border">
              <p className="font-semibold text-foreground">You get</p>
              <p className="text-primary font-bold text-lg">1 month free</p>
              <p className="text-xs text-muted-foreground">per referred customer</p>
            </div>
            <div className="text-center p-3 bg-card rounded-lg border border-border">
              <p className="font-semibold text-foreground">They get</p>
              <p className="text-primary font-bold text-lg">1 month free</p>
              <p className="text-xs text-muted-foreground">on any paid plan</p>
            </div>
          </div>
          <p className="text-center text-xs text-muted-foreground mt-4">
            Credit unlocks after referral completes first paid month.
          </p>
        </div>

      </div>
    </section>
  );
}

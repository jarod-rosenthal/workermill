import { Check, Sparkles, Building2, Users, Gift, Crown, Clock } from "lucide-react";

interface PricingTier {
  name: string;
  price: string;
  period: string;
  description: string;
  included: string;
  features: string[];
  overage: string;
  highlighted?: boolean;
  icon: React.ReactNode;
  cta: string;
  disabled?: boolean;
  trial?: boolean;
}

const tiers: PricingTier[] = [
  {
    name: "Starter",
    price: "$29",
    period: "/month",
    description: "For solo developers and side projects",
    included: "5 compute hours included",
    icon: <Sparkles className="w-5 h-5" />,
    trial: true,
    features: [
      "Up to 5 users",
      "All integrations",
      "All execution modes",
      "14-day log retention",
      "Email support",
    ],
    overage: "$8/hr",
    cta: "Coming Soon",
    disabled: true,
  },
  {
    name: "Team",
    price: "$79",
    period: "/month",
    description: "For teams shipping faster together",
    included: "20 compute hours included",
    icon: <Users className="w-5 h-5" />,
    highlighted: true,
    trial: true,
    features: [
      "Up to 20 users",
      "Warm Container Pool",
      "30-day audit logs",
      "Advanced analytics",
      "Priority support (< 4hr)",
    ],
    overage: "$6/hr",
    cta: "Coming Soon",
    disabled: true,
  },
  {
    name: "Business",
    price: "$199",
    period: "/month",
    description: "For organizations at scale",
    included: "60 compute hours included",
    icon: <Building2 className="w-5 h-5" />,
    trial: true,
    features: [
      "Unlimited users",
      "Self-hosted SCM support",
      "SSO / SAML",
      "90-day audit logs",
      "Compliance Center",
      "Dedicated support",
    ],
    overage: "$4/hr",
    cta: "Coming Soon",
    disabled: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    description: "For large organizations with advanced needs",
    included: "Custom compute allocation",
    icon: <Crown className="w-5 h-5" />,
    features: [
      "Everything in Business, plus:",
      "Dedicated Worker Pool",
      "Priority Task Queue",
      "1 year+ audit retention",
      "IP Allowlisting",
      "Data Residency Controls",
      "AWS Bedrock / Azure AI Foundry",
      "99.9% SLA",
      "Dedicated CSM",
      "SOC 2 Report available",
    ],
    overage: "Custom",
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
            Simple, Transparent Pricing
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto mb-4">
            Monthly plans with included compute hours. Bring your own API keys with zero markup.
            Use any AI provider you choose.
          </p>
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/20 rounded-full">
            <Clock className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-primary">14-day free trial on all paid plans</span>
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
              {/* Popular Badge */}
              {tier.highlighted && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="px-3 py-1 text-xs font-medium rounded-full bg-primary text-primary-foreground">
                    Most Popular
                  </span>
                </div>
              )}

              <div className={tier.highlighted ? "pt-4" : ""}>
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
                  {tier.included}
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

                {/* Overage rate */}
                <div className="mb-6 p-3 rounded-lg bg-muted/50 border border-border">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Overage:</span>{" "}
                    {tier.overage} beyond included hours
                  </p>
                </div>

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
                ) : null}
              </div>
            </div>
          ))}
        </div>

        {/* How It Works */}
        <div className="mt-12 p-6 rounded-xl bg-muted/30 border border-border">
          <h3 className="text-lg font-semibold text-foreground mb-4 text-center">
            How Compute Hours Work
          </h3>
          <div className="grid md:grid-cols-3 gap-6 text-center">
            <div>
              <p className="font-medium text-foreground mb-1">Billed by the Second</p>
              <p className="text-sm text-muted-foreground">
                Pay for exact container runtime - no rounding, displayed in minutes
              </p>
            </div>
            <div>
              <p className="font-medium text-foreground mb-1">Included Hours Reset Monthly</p>
              <p className="text-sm text-muted-foreground">
                Unused hours don't roll over. Overage kicks in after.
              </p>
            </div>
            <div>
              <p className="font-medium text-foreground mb-1">Multi-Provider Included</p>
              <p className="text-sm text-muted-foreground">
                Use Anthropic, OpenAI, Google, or Ollama at no extra cost
              </p>
            </div>
          </div>
        </div>

        {/* BYOK Note */}
        <div className="text-center mt-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-muted/50 border border-border rounded-lg">
            <span className="text-sm text-muted-foreground">
              <strong className="text-foreground">BYOK:</strong> Bring your own
              API keys with zero markup. You pay AI providers directly, WorkerMill handles orchestration.
            </span>
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

import { Check, Sparkles, Building2 } from "lucide-react";

interface PricingTier {
  name: string;
  price: string;
  period?: string;
  description: string;
  features: string[];
  highlighted?: boolean;
  icon: React.ReactNode;
}

const tiers: PricingTier[] = [
  {
    name: "Starter",
    price: "?",
    description: "For small teams getting started with AI automation",
    icon: <Sparkles className="w-5 h-5" />,
    features: [
      "Limited tasks per month",
      "2 worker personas",
      "Jira + GitHub integration",
      "Email support",
      "7-day task history",
    ],
  },
  {
    name: "Pro",
    price: "?",
    description: "For growing teams that need more power",
    icon: <Sparkles className="w-5 h-5" />,
    highlighted: true,
    features: [
      "More tasks per month",
      "All worker personas",
      "Virtual Manager included",
      "Priority support",
      "30-day task history",
      "Custom CLAUDE.md configs",
      "Advanced analytics",
    ],
  },
  {
    name: "Enterprise",
    price: "?",
    description: "For organizations with advanced needs",
    icon: <Building2 className="w-5 h-5" />,
    features: [
      "Unlimited tasks",
      "Dedicated support",
      "SSO / SAML",
      "SLA guarantees",
      "Custom integrations",
      "On-premise deployment",
      "Audit logs",
    ],
  },
];

export function Pricing() {
  return (
    <section className="py-20 px-6 bg-card/50">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-foreground mb-4">
            Simple, Transparent Pricing
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Choose the plan that fits your team. All plans include core WorkerMill
            features.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-8">
          {tiers.map((tier, index) => (
            <div
              key={index}
              className={`relative bg-card border rounded-xl p-6 flex flex-col ${
                tier.highlighted
                  ? "border-primary shadow-lg shadow-primary/10"
                  : "border-border"
              }`}
            >
              {/* Coming Soon Badge */}
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="px-3 py-1 text-xs font-medium rounded-full bg-muted text-muted-foreground border border-border">
                  Coming Soon
                </span>
              </div>

              {/* Popular Badge */}
              {tier.highlighted && (
                <div className="absolute -top-3 right-4">
                  <span className="px-3 py-1 text-xs font-medium rounded-full bg-primary text-primary-foreground">
                    Popular
                  </span>
                </div>
              )}

              <div className="pt-4">
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

                <div className="flex items-baseline gap-1 mb-2">
                  <span
                    className={`text-4xl font-bold ${
                      tier.highlighted ? "text-primary" : "text-foreground"
                    }`}
                  >
                    {tier.price}
                  </span>
                  {tier.period && (
                    <span className="text-muted-foreground">{tier.period}</span>
                  )}
                </div>

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

                <button
                  disabled
                  className={`w-full py-2.5 rounded-lg font-medium text-sm transition-colors cursor-not-allowed opacity-50 ${
                    tier.highlighted
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground border border-border"
                  }`}
                >
                  {tier.name === "Enterprise" ? "Contact Sales" : "Get Started"}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* AI Cost Note */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-muted/50 border border-border rounded-lg">
            <span className="text-sm text-muted-foreground">
              <strong className="text-foreground">Note:</strong> AI model costs
              (Claude API) are billed separately based on usage.
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

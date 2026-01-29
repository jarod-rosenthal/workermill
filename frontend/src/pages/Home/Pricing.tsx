import { Check, Sparkles, Building2, Users, Gift, Crown } from "lucide-react";
import { Link } from "react-router-dom";

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
  ctaLink: string;
}

const tiers: PricingTier[] = [
  {
    name: "Starter",
    price: "$49",
    period: "/month",
    description: "For solo developers and small teams",
    included: "4 compute hours included",
    icon: <Sparkles className="w-5 h-5" />,
    features: [
      "Up to 3 users",
      "GitHub + Jira/Linear/GitHub Issues",
      "Epic execution mode (default)",
      "AI Support Agent",
      "Email support",
      "7-day log retention",
    ],
    overage: "$12/hr",
    cta: "Get Started",
    ctaLink: "/signup",
  },
  {
    name: "Team",
    price: "$199",
    period: "/month",
    description: "For growing teams that ship faster",
    included: "12 compute hours included",
    icon: <Users className="w-5 h-5" />,
    highlighted: true,
    features: [
      "Up to 15 users",
      "All integrations",
      "Warm Container Pool",
      "Priority support",
      "30-day audit logs",
      "Advanced analytics",
    ],
    overage: "$8/hr",
    cta: "Get Started",
    ctaLink: "/signup",
  },
  {
    name: "Business",
    price: "$499",
    period: "/month",
    description: "For organizations at scale",
    included: "40 compute hours included",
    icon: <Building2 className="w-5 h-5" />,
    features: [
      "Unlimited users",
      "All integrations + self-hosted SCM",
      "SSO / SAML",
      "90-day audit logs",
      "Dedicated support",
      "Unlimited log retention",
    ],
    overage: "$5/hr",
    cta: "Get Started",
    ctaLink: "/signup",
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
      "AWS Bedrock / Azure OpenAI",
      "99.9% SLA",
      "Dedicated CSM",
      "Custom onboarding",
      "Slack Connect channel",
      "SOC 2 Report available",
    ],
    overage: "Custom",
    cta: "Contact Sales",
    ctaLink: "mailto:sales@workermill.com",
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
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Monthly plans with included compute hours. Pay only for runtime beyond that.
            Bring your own API keys.
          </p>
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

                {tier.ctaLink.startsWith("mailto:") ? (
                  <a
                    href={tier.ctaLink}
                    className={`w-full py-2.5 rounded-lg font-medium text-sm transition-colors text-center block ${
                      tier.highlighted
                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                        : "bg-muted text-foreground border border-border hover:bg-muted/80"
                    }`}
                  >
                    {tier.cta}
                  </a>
                ) : (
                  <Link
                    to={tier.ctaLink}
                    className={`w-full py-2.5 rounded-lg font-medium text-sm transition-colors text-center block ${
                      tier.highlighted
                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                        : "bg-muted text-foreground border border-border hover:bg-muted/80"
                    }`}
                  >
                    {tier.cta}
                  </Link>
                )}
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
              API keys. You pay AI providers directly, WorkerMill handles orchestration.
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
              <p className="text-primary font-bold text-lg">$100 credit</p>
              <p className="text-xs text-muted-foreground">per referred customer</p>
            </div>
            <div className="text-center p-3 bg-card rounded-lg border border-border">
              <p className="font-semibold text-foreground">They get</p>
              <p className="text-primary font-bold text-lg">50% off</p>
              <p className="text-xs text-muted-foreground">first 3 months</p>
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

import { Check, Sparkles, Building2, Users } from "lucide-react";
import { Link } from "react-router-dom";

interface PricingTier {
  name: string;
  price: string;
  period: string;
  description: string;
  included: string;
  features: string[];
  overageRates: string[];
  highlighted?: boolean;
  icon: React.ReactNode;
  cta: string;
  ctaLink: string;
}

const tiers: PricingTier[] = [
  {
    name: "Starter",
    price: "$29",
    period: "/month",
    description: "For small teams getting started with AI automation",
    included: "50 tasks included",
    icon: <Sparkles className="w-5 h-5" />,
    features: [
      "1 user",
      "GitHub + Jira/Linear",
      "Standard + Epic modes",
      "Email support",
      "30-day log retention",
    ],
    overageRates: [
      "$0.15 per Standard task",
      "$0.25 per Epic task",
      "$0.35 per Multi-Provider task",
    ],
    cta: "Get Started",
    ctaLink: "/signup",
  },
  {
    name: "Team",
    price: "$99",
    period: "/month",
    description: "For growing teams that need more power",
    included: "250 tasks included",
    icon: <Users className="w-5 h-5" />,
    highlighted: true,
    features: [
      "5 users",
      "All integrations",
      "All execution modes",
      "Priority support",
      "90-day log retention",
      "Advanced analytics",
    ],
    overageRates: [
      "$0.10 per Standard task",
      "$0.20 per Epic task",
      "$0.30 per Multi-Provider task",
    ],
    cta: "Get Started",
    ctaLink: "/signup",
  },
  {
    name: "Business",
    price: "$299",
    period: "/month",
    description: "For organizations with advanced needs",
    included: "1,000 tasks included",
    icon: <Building2 className="w-5 h-5" />,
    features: [
      "20 users",
      "All integrations + self-hosted SCM",
      "All execution modes",
      "Dedicated support",
      "Unlimited log retention",
      "SSO / SAML",
      "Audit logs",
    ],
    overageRates: [
      "$0.08 per Standard task",
      "$0.15 per Epic task",
      "$0.25 per Multi-Provider task",
    ],
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
            Monthly plans with included tasks. Pay for what you use beyond that.
            Bring your own API keys.
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

                {/* Overage rates */}
                <div className="mb-6 p-3 rounded-lg bg-muted/50 border border-border">
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Overage rates:
                  </p>
                  {tier.overageRates.map((rate, rateIndex) => (
                    <p key={rateIndex} className="text-xs text-muted-foreground">
                      {rate}
                    </p>
                  ))}
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

        {/* Task Types Explanation */}
        <div className="mt-12 p-6 rounded-xl bg-muted/30 border border-border">
          <h3 className="text-lg font-semibold text-foreground mb-4 text-center">
            Task Types
          </h3>
          <div className="grid md:grid-cols-3 gap-6 text-center">
            <div>
              <p className="font-medium text-foreground mb-1">Standard</p>
              <p className="text-sm text-muted-foreground">
                1 expert, single task
              </p>
            </div>
            <div>
              <p className="font-medium text-foreground mb-1">Epic</p>
              <p className="text-sm text-muted-foreground">
                10+ experts in parallel
              </p>
            </div>
            <div>
              <p className="font-medium text-foreground mb-1">Multi-Provider</p>
              <p className="text-sm text-muted-foreground">
                10+ experts, any AI provider
              </p>
            </div>
          </div>
        </div>

        {/* BYOK Note */}
        <div className="text-center mt-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-muted/50 border border-border rounded-lg">
            <span className="text-sm text-muted-foreground">
              <strong className="text-foreground">BYOK:</strong> Bring your own
              API keys. Supports Anthropic, OpenAI, Google, and Ollama.
            </span>
          </div>
        </div>

        {/* Payment Methods */}
        <div className="text-center mt-4">
          <p className="text-sm text-muted-foreground">
            Pay with credit card or cryptocurrency
          </p>
        </div>
      </div>
    </section>
  );
}

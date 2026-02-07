import { PenLine, Layers, Monitor, ArrowRight, Activity } from "lucide-react";

const steps = [
  {
    number: "01",
    icon: PenLine,
    title: "Describe",
    description: "Describe what you want in plain English",
    details: [
      "Write a project spec or paste requirements",
      "Pick a starter template or start from scratch",
      "No setup needed to preview",
    ],
  },
  {
    number: "02",
    icon: Layers,
    title: "Review Plan",
    description: "See decomposed stories, cost estimate, edit it",
    details: [
      "AI breaks your spec into stories",
      "See estimated cost and duration",
      "Free preview powered by Haiku (~$0.03)",
    ],
  },
  {
    number: "03",
    icon: Monitor,
    title: "Choose How",
    description: "Local, BYOK, or cloud execution",
    details: [
      "Local: Your machine + Claude Max ($0)",
      "BYOK: Your API key, our compute",
      "Cloud: We handle everything",
    ],
  },
  {
    number: "04",
    icon: Activity,
    title: "Watch It Build",
    description: "AI experts work in real-time",
    details: [
      "Parallel experts on your dashboard",
      "Live logs streamed to your browser",
      "Quality gates validate every story",
    ],
  },
];

export default function HowItWorks() {
  return (
    <section className="py-24 relative">
      {/* Section background */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-card/50 to-transparent" />

      <div className="relative max-w-6xl mx-auto px-6">
        {/* Section header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl lg:text-4xl font-bold mb-4">
            <span className="text-foreground">From idea to </span>
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              production code
            </span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Describe → Review Plan → Choose How → Watch It Build. Four steps from spec to shipped software.
          </p>
        </div>

        {/* Steps */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map((step, index) => (
            <div key={step.number} className="relative group">
              {/* Connector line */}
              {index < steps.length - 1 && (
                <div className="hidden md:block absolute top-16 left-1/2 w-full h-px bg-gradient-to-r from-border via-primary/30 to-border" />
              )}

              {/* Card */}
              <div className="relative card-elevated border border-border/50 rounded-2xl p-8 card-hover">
                {/* Step number */}
                <div className="absolute -top-4 left-8">
                  <span className="inline-block px-3 py-1 bg-primary/10 border border-primary/20 rounded-full text-xs font-mono text-primary">
                    {step.number}
                  </span>
                </div>

                {/* Icon */}
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                  <step.icon className="w-7 h-7 text-primary" />
                </div>

                {/* Content */}
                <h3 className="text-xl font-semibold text-foreground mb-2">
                  {step.title}
                </h3>
                <p className="text-muted-foreground mb-4">{step.description}</p>

                {/* Details list */}
                <ul className="space-y-2">
                  {step.details.map((detail) => (
                    <li
                      key={detail}
                      className="flex items-center gap-2 text-sm text-muted-foreground"
                    >
                      <ArrowRight className="w-3 h-3 text-primary flex-shrink-0" />
                      {detail}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="text-center mt-16">
          <p className="text-muted-foreground mb-4">
            Production-grade output. <span className="text-primary font-semibold">From a single description.</span>
          </p>
        </div>
      </div>
    </section>
  );
}

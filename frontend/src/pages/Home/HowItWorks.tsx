import { PenLine, Layers, Monitor, Activity, Ticket, GitPullRequest } from "lucide-react";

const newProjectSteps = [
  {
    number: "01",
    icon: PenLine,
    title: "Describe It",
    description: "Write a spec or paste requirements",
    details: [
      "Plain English project description",
      "Pick a starter template or start blank",
      "Free preview before you build",
    ],
  },
  {
    number: "02",
    icon: Layers,
    title: "Review the Plan",
    description: "AI decomposes into stories you approve",
    details: [
      "Stories with clear success criteria",
      "Edit, reorder, or remove stories",
      "See estimated cost and duration",
    ],
  },
  {
    number: "03",
    icon: Monitor,
    title: "Choose How",
    description: "Local execution or managed cloud infrastructure",
    details: [
      "Local: Your machine + your own API keys",
      "Cloud: Managed infrastructure via the WorkerMill platform",
      "BYOK: bring your own API keys, zero markup",
    ],
  },
  {
    number: "04",
    icon: Activity,
    title: "Watch It Build",
    description: "Experts execute, review, and deliver",
    details: [
      "Parallel experts on your dashboard",
      "Tech lead reviews every PR",
      "Live logs streamed in real-time",
    ],
  },
];

const backlogSteps = [
  {
    number: "01",
    icon: Ticket,
    title: "Connect Your Tools",
    description: "Jira, Linear, or GitHub Issues",
    details: [
      "One-time webhook setup",
      "Works with your existing workflow",
      "GitHub, GitLab, or Bitbucket repos",
    ],
  },
  {
    number: "02",
    icon: Layers,
    title: "Label a Ticket",
    description: "Add 'workermill' to any ticket",
    details: [
      "Features, tech debt, bug fixes, rewrites",
      "AI decomposes into executable stories",
      "You approve the plan before execution",
    ],
  },
  {
    number: "03",
    icon: Activity,
    title: "Workers Execute",
    description: "Autonomous experts ship your ticket",
    details: [
      "Multiple experts collaborate on one PR",
      "Tests run and validated automatically",
      "Blockers escalated for your input",
    ],
  },
  {
    number: "04",
    icon: GitPullRequest,
    title: "Review the PR",
    description: "Tech lead already reviewed it for you",
    details: [
      "Production-ready code, not a prototype",
      "Tests and documentation included",
      "Merge when you're satisfied",
    ],
  },
];

function StepCards({ steps }: { steps: typeof newProjectSteps }) {
  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
      {steps.map((step, index) => (
        <div key={step.number} className="relative group">
          {index < steps.length - 1 && (
            <div className="hidden md:block absolute top-16 left-1/2 w-full h-px bg-gradient-to-r from-border via-primary/30 to-border" />
          )}
          <div className="relative card-elevated border border-border/50 rounded-2xl p-8 card-hover">
            <div className="absolute -top-4 left-8">
              <span className="inline-block px-3 py-1 bg-primary/10 border border-primary/20 rounded-full text-xs font-mono text-primary">
                {step.number}
              </span>
            </div>
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
              <step.icon className="w-7 h-7 text-primary" />
            </div>
            <h3 className="text-xl font-semibold text-foreground mb-2">
              {step.title}
            </h3>
            <p className="text-muted-foreground mb-4">{step.description}</p>
            <ul className="space-y-2">
              {step.details.map((detail) => (
                <li
                  key={detail}
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <div className="w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                  {detail}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function HowItWorks() {
  return (
    <section className="py-24 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-card/50 to-transparent" />

      <div className="relative max-w-6xl mx-auto px-6">
        {/* New Project Flow */}
        <div className="mb-24">
          <div className="text-center mb-16">
            <p className="text-sm font-medium text-primary mb-3 tracking-wide">NEW PROJECT</p>
            <h2 className="text-3xl lg:text-4xl font-bold mb-4">
              <span className="text-foreground">From spec to </span>
              <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                production code
              </span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Describe what you want. WorkerMill plans it, builds it, sets up CI/CD, and delivers a reviewed PR.
            </p>
          </div>
          <StepCards steps={newProjectSteps} />
        </div>

        {/* Backlog Flow */}
        <div>
          <div className="text-center mb-16">
            <p className="text-sm font-medium text-primary mb-3 tracking-wide">EXISTING BACKLOG</p>
            <h2 className="text-3xl lg:text-4xl font-bold mb-4">
              <span className="text-foreground">Your tickets, </span>
              <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                executed autonomously
              </span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Connect your issue tracker. Label tickets. Wake up to pull requests.
            </p>
          </div>
          <StepCards steps={backlogSteps} />
        </div>
      </div>
    </section>
  );
}

import {
  Cpu,
  Zap,
  GitPullRequest,
  CheckCircle,
  ArrowRight,
} from "lucide-react";
import { Link } from "react-router-dom";

const features = [
  {
    icon: Cpu,
    title: "AI Workers",
    description:
      "Specialized AI agents that understand your codebase and execute development tasks autonomously.",
  },
  {
    icon: Zap,
    title: "Epic Planning",
    description:
      "A Planning Agent analyzes your ticket and decomposes complex tasks into parallel stories executed by specialized experts.",
  },
  {
    icon: GitPullRequest,
    title: "PR Creation",
    description:
      "Workers automatically create pull requests with well-documented changes and test coverage.",
  },
  {
    icon: CheckCircle,
    title: "Quality Assurance",
    description:
      "Built-in Tech Lead Reviewer validates all work before completion, ensuring code quality standards.",
  },
];

const stats = [
  { label: "AI Experts", value: "12", icon: Cpu },
  { label: "AI Providers", value: "4+", icon: Zap },
  { label: "Issue Trackers", value: "3+", icon: CheckCircle },
];

export default function DocsOverview() {
  return (
    <div className="space-y-12">
      {/* Hero */}
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
          WorkerMill
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          AI-powered task automation that turns your Jira, Linear, or GitHub Issues
          into working code, pull requests, and deployed features.
        </p>
      </div>

      {/* What is WorkerMill */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground">What is WorkerMill?</h2>
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <p className="text-muted-foreground leading-relaxed">
            WorkerMill is an <strong className="text-foreground">AI-powered development automation platform</strong> that
            transforms how engineering teams handle routine development tasks. By connecting your issue tracker
            (Jira, Linear, or GitHub Issues) with your SCM (GitHub, GitLab, or BitBucket), WorkerMill deploys
            specialized AI workers to execute tickets autonomously using <strong className="text-foreground">Epic Planning</strong> by default.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Each task is handled by a <strong className="text-foreground">team of specialized AI experts</strong> running in isolated environments
            with access to your codebase, able to read documentation, understand context, write code, run tests,
            and create pull requests. WorkerMill works with <strong className="text-foreground">all major AI providers</strong> including
            Anthropic Claude, OpenAI GPT, Google Gemini, and self-hosted models via Ollama.
          </p>
        </div>
      </section>

      {/* Key Features */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground">Key Features</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="bg-card border border-border rounded-xl p-5 space-y-3"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <feature.icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground">{feature.title}</h3>
              </div>
              <p className="text-sm text-muted-foreground">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground">How It Works</h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            {[
              { step: "1", label: "Create Ticket", desc: "Jira, Linear, or GitHub" },
              { step: "2", label: "Planning", desc: "AI decomposes into stories" },
              { step: "3", label: "Parallel Execute", desc: "Experts work simultaneously" },
              { step: "4", label: "PR Created", desc: "Review and merge" },
            ].map((item, idx, arr) => (
              <div key={item.step} className="flex items-center gap-4">
                <div className="text-center">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold mb-2">
                    {item.step}
                  </div>
                  <div className="font-medium text-foreground">{item.label}</div>
                  <div className="text-xs text-muted-foreground">{item.desc}</div>
                </div>
                {idx < arr.length - 1 && (
                  <ArrowRight className="w-5 h-5 text-muted-foreground hidden md:block" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Quick Stats */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground">Platform Capabilities</h2>
        <div className="grid grid-cols-3 gap-4">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="bg-card border border-border rounded-xl p-5 text-center"
            >
              <stat.icon className="w-6 h-6 text-primary mx-auto mb-2" />
              <div className="text-2xl font-bold text-foreground">{stat.value}</div>
              <div className="text-sm text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Quick Links */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground">Learn More</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <Link
            to="/docs/task-lifecycle"
            className="bg-card border border-border rounded-xl p-5 hover:border-primary/50 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                  Task Lifecycle
                </h3>
                <p className="text-sm text-muted-foreground">
                  Understand how tasks flow through the system
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </Link>
          <Link
            to="/docs/personas"
            className="bg-card border border-border rounded-xl p-5 hover:border-primary/50 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                  Worker Personas
                </h3>
                <p className="text-sm text-muted-foreground">
                  Meet the specialized AI workers
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </Link>
        </div>
      </section>
    </div>
  );
}

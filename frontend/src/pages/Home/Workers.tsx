import { Plus, Sparkles } from "lucide-react";

const workerPersonas = [
  {
    id: "architect",
    emoji: "🏗️",
    title: "Architect",
    description: "System decomposition, task planning, and technical design",
  },
  {
    id: "backend_developer",
    emoji: "💻",
    title: "Backend Developer",
    description: "APIs, databases, GraphQL, OpenAPI, and query optimization",
  },
  {
    id: "frontend_developer",
    emoji: "🎨",
    title: "Frontend Developer",
    description: "React, TypeScript, Tailwind, accessibility, and design systems",
  },
  {
    id: "mobile_developer",
    emoji: "📱",
    title: "Mobile Developer",
    description: "iOS (Swift, SwiftUI), Android (Kotlin, Compose), and React Native",
  },
  {
    id: "devops_engineer",
    emoji: "🔧",
    title: "DevOps Engineer",
    description: "Terraform, Docker, CI/CD, GitOps, and cloud infrastructure",
  },
  {
    id: "security_engineer",
    emoji: "🛡️",
    title: "Security Engineer",
    description: "OWASP, threat modeling, supply chain security, and compliance",
  },
  {
    id: "qa_engineer",
    emoji: "🧪",
    title: "QA Engineer",
    description: "Test automation, contract testing, load testing, and accessibility",
  },
  {
    id: "data_ml_engineer",
    emoji: "📊",
    title: "Data & ML Engineer",
    description: "ETL pipelines, model training, MLOps, and LLM applications",
  },
  {
    id: "tech_writer",
    emoji: "📝",
    title: "Technical Writer",
    description: "API documentation, developer guides, and technical diagrams",
  },
  {
    id: "project_manager",
    emoji: "📋",
    title: "Project Manager",
    description: "Task breakdown, sprint planning, and release coordination",
  },
];

const virtualManager = {
  id: "tech_lead_reviewer",
  emoji: "🎯",
  title: "Tech Lead Reviewer",
  description:
    "Reviews all PRs from workers, provides feedback, requests revisions as needed, and approves production-ready code before merge",
  isHighlighted: true,
};

export default function Workers() {
  return (
    <section className="py-24 relative">
      <div className="max-w-6xl mx-auto px-6">
        {/* Section header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl lg:text-4xl font-bold mb-4">
            <span className="text-foreground">A full engineering team, </span>
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              built in
            </span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            12 expert personas out of the box — or create your own. Build a{" "}
            <code className="text-primary">unity_game_dev</code>,{" "}
            <code className="text-primary">shopify_expert</code>, or any specialist your stack needs with Persona Studio.
          </p>
        </div>

        {/* Worker grid */}
        <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
          {workerPersonas.map((worker) => (
            <div
              key={worker.id}
              className="group bg-card border border-border rounded-xl p-6 hover:border-primary/30 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5"
            >
              {/* Emoji */}
              <div className="text-3xl mb-4 group-hover:scale-110 transition-transform duration-300">
                {worker.emoji}
              </div>

              {/* Title */}
              <h3 className="font-semibold text-foreground mb-2">
                {worker.title}
              </h3>

              {/* Description */}
              <p className="text-sm text-muted-foreground leading-relaxed">
                {worker.description}
              </p>
            </div>
          ))}

          {/* Tech Lead - highlighted card */}
          <div className="relative group">
            {/* Glow effect */}
            <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-accent/20 rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

            <div className="relative bg-gradient-to-br from-card to-card/80 border-2 border-primary/30 rounded-xl p-6 hover:border-primary/50 transition-all duration-300">
              {/* Badge */}
              <div className="absolute -top-3 right-4">
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-primary text-primary-foreground text-xs font-semibold rounded-full">
                  <Sparkles className="w-3 h-3" />
                  Key Differentiator
                </span>
              </div>

              {/* Emoji */}
              <div className="text-3xl mb-4 group-hover:scale-110 transition-transform duration-300">
                {virtualManager.emoji}
              </div>

              {/* Title */}
              <h3 className="font-semibold text-foreground mb-2">
                {virtualManager.title}
              </h3>

              {/* Description */}
              <p className="text-sm text-muted-foreground leading-relaxed">
                {virtualManager.description}
              </p>

              {/* Stats */}
              <div className="mt-4 pt-4 border-t border-border/50 grid grid-cols-2 gap-2 text-center">
                <div>
                  <div className="text-lg font-bold text-primary">100%</div>
                  <div className="text-xs text-muted-foreground">PR Review</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-accent">∞</div>
                  <div className="text-xs text-muted-foreground">Configurable</div>
                </div>
              </div>
            </div>
          </div>

          {/* Create Your Own - CTA card */}
          <div className="relative group">
            <div className="absolute inset-0 bg-gradient-to-r from-accent/20 to-primary/20 rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

            <div className="relative bg-card border-2 border-dashed border-muted-foreground/30 rounded-xl p-6 hover:border-primary/50 transition-all duration-300 flex flex-col items-center justify-center text-center h-full">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                <Plus className="w-6 h-6 text-primary" />
              </div>

              <h3 className="font-semibold text-foreground mb-2">
                Create Your Own
              </h3>

              <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                Build custom personas for your domain with Persona Studio
              </p>

              <div className="flex flex-wrap gap-1.5 justify-center">
                <span className="px-2 py-0.5 bg-muted rounded text-xs text-muted-foreground">unity_game_dev</span>
                <span className="px-2 py-0.5 bg-muted rounded text-xs text-muted-foreground">shopify_expert</span>
                <span className="px-2 py-0.5 bg-muted rounded text-xs text-muted-foreground">rails_engineer</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom note */}
        <div className="text-center space-y-2">
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">Any provider, every expert:</span>{" "}
            Route each persona to different AI providers — Anthropic, OpenAI, Google, or Ollama.
          </p>
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">Custom personas:</span>{" "}
            Define your own directives, execution scripts, and domain knowledge. Your personas work alongside the built-in experts.
          </p>
        </div>
      </div>
    </section>
  );
}

import { Sparkles } from "lucide-react";

const workerPersonas = [
  {
    id: "frontend_developer",
    emoji: "🎨",
    title: "Frontend Developer",
    description: "React components, UI/UX, styling, and accessibility",
  },
  {
    id: "backend_developer",
    emoji: "⚙️",
    title: "Backend Developer",
    description: "APIs, database design, server logic, and integrations",
  },
  {
    id: "devops_engineer",
    emoji: "🔧",
    title: "DevOps Engineer",
    description: "Infrastructure, CI/CD, Docker, and cloud deployments",
  },
  {
    id: "security_engineer",
    emoji: "🔒",
    title: "Security Engineer",
    description: "Security audits, vulnerability fixes, and compliance",
  },
  {
    id: "qa_engineer",
    emoji: "🧪",
    title: "QA Engineer",
    description: "Test writing, quality assurance, and bug verification",
  },
  {
    id: "tech_writer",
    emoji: "📝",
    title: "Technical Writer",
    description: "Documentation, API docs, and developer guides",
  },
  {
    id: "project_manager",
    emoji: "📋",
    title: "Project Manager",
    description: "Task breakdown, ticket creation, and status updates",
  },
];

const virtualManager = {
  id: "manager",
  emoji: "👔",
  title: "Virtual Manager",
  description:
    "Reviews all PRs from workers, provides feedback, requests revisions, and approves quality code before merge",
  isHighlighted: true,
};

export default function Workers() {
  return (
    <section className="py-24 relative">
      <div className="max-w-6xl mx-auto px-6">
        {/* Section header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl lg:text-4xl font-bold mb-4">
            <span className="text-foreground">Meet your </span>
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              AI team
            </span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Specialized AI workers for every role in your engineering organization. Each trained on best practices for their domain.
          </p>
        </div>

        {/* Worker grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
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

          {/* Virtual Manager - highlighted card */}
          <div className="relative group sm:col-span-2 lg:col-span-1">
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
                  <div className="text-lg font-bold text-accent">Quality</div>
                  <div className="text-xs text-muted-foreground">Guaranteed</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom note */}
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            Workers are powered by{" "}
            <span className="text-foreground font-medium">Claude</span> with
            specialized prompting for each role
          </p>
        </div>
      </div>
    </section>
  );
}

import { ExternalLink, Clock, DollarSign, Layers } from "lucide-react";

interface ShowcaseProject {
  name: string;
  description: string;
  stack: string;
  stories: number;
  cost: string;
  duration: string;
  repoUrl: string;
  taskUrl: string;
}

const showcaseProjects: ShowcaseProject[] = [
  {
    name: "SaaS Dashboard",
    description:
      "Full-stack admin dashboard with authentication, role-based access, data tables, charts, and dark mode. Deployed to Vercel.",
    stack: "Next.js + Prisma + Tailwind",
    stories: 12,
    cost: "$18.20",
    duration: "52 min",
    repoUrl: "https://github.com/workermill-examples/saas-dashboard",
    taskUrl: "/showcase/saas-dashboard",
  },
  {
    name: "REST API Starter",
    description:
      "Production-ready REST API with CRUD endpoints, JWT auth, rate limiting, OpenAPI docs, and comprehensive test suite.",
    stack: "FastAPI + SQLAlchemy + Alembic",
    stories: 8,
    cost: "$9.40",
    duration: "31 min",
    repoUrl: "https://github.com/workermill-examples/rest-api",
    taskUrl: "/showcase/rest-api",
  },
  {
    name: "E-commerce Store",
    description:
      "Full e-commerce with product catalog, shopping cart, Stripe checkout, order management, and admin panel.",
    stack: "Rails + React + Stripe",
    stories: 15,
    cost: "$24.60",
    duration: "68 min",
    repoUrl: "https://github.com/workermill-examples/ecommerce",
    taskUrl: "/showcase/ecommerce",
  },
  {
    name: "Blog Platform",
    description:
      "Server-rendered blog with Markdown support, tagging, search, RSS feed, and SEO optimization.",
    stack: "Django + HTMX + Tailwind",
    stories: 10,
    cost: "$12.80",
    duration: "42 min",
    repoUrl: "https://github.com/workermill-examples/blog-platform",
    taskUrl: "/showcase/blog-platform",
  },
  {
    name: "CLI Tool",
    description:
      "Developer CLI with subcommands, config file support, interactive prompts, and shell completions.",
    stack: "Go + Cobra",
    stories: 6,
    cost: "$5.90",
    duration: "22 min",
    repoUrl: "https://github.com/workermill-examples/cli-tool",
    taskUrl: "/showcase/cli-tool",
  },
];

export default function ShowcaseGallery() {
  return (
    <section id="showcase" className="py-24 relative">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-card/50 to-transparent" />

      <div className="relative max-w-6xl mx-auto px-6">
        {/* Section header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl lg:text-4xl font-bold mb-4">
            <span className="text-foreground">Built with </span>
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              WorkerMill
            </span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Real projects built from a description. Each includes the repo, coordination log, cost breakdown, and quality metrics.
          </p>
        </div>

        {/* Project cards */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {showcaseProjects.slice(0, 5).map((project) => (
            <div
              key={project.name}
              className="card-elevated border border-border/50 rounded-2xl overflow-hidden card-hover group"
            >
              {/* Card header */}
              <div className="px-6 pt-6 pb-4">
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {project.name}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  {project.description}
                </p>
                <div className="inline-block px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 text-xs font-medium text-primary">
                  {project.stack}
                </div>
              </div>

              {/* Stats */}
              <div className="px-6 py-4 border-t border-border/30">
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1 text-sm font-semibold text-foreground">
                      <Layers className="w-3.5 h-3.5 text-muted-foreground" />
                      {project.stories}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">stories</div>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1 text-sm font-semibold text-green-500">
                      <DollarSign className="w-3.5 h-3.5" />
                      {project.cost.replace("$", "")}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">cost</div>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1 text-sm font-semibold text-foreground">
                      <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                      {project.duration}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">time</div>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="px-6 py-4 border-t border-border/30 flex gap-3">
                <a
                  href={project.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 transition-colors text-foreground"
                >
                  <ExternalLink className="w-3 h-3" />
                  View repo
                </a>
                <a
                  href={project.taskUrl}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-primary/10 hover:bg-primary/20 transition-colors text-primary border border-primary/20"
                >
                  View how
                </a>
              </div>
            </div>
          ))}
        </div>

        {/* Bottom note */}
        <div className="text-center mt-12">
          <p className="text-sm text-muted-foreground">
            Costs shown are BYOK mode (your API key). Local mode with Claude Max costs{" "}
            <span className="text-green-500 font-semibold">$0</span>.
          </p>
        </div>
      </div>
    </section>
  );
}

import { Link } from "react-router-dom";
import {
  ExternalLink,
  Clock,
  Layers,
  ArrowRight,
  Zap,
  Globe,
  Shield,
  Terminal,
  BarChart3,
  FileText,
  Workflow,
} from "lucide-react";
import BuiltByBadge from "./BuiltByBadge";

interface ShowcaseProject {
  id: string;
  name: string;
  tagline: string;
  description: string;
  stack: string;
  storyCount: number;
  cost: string;
  duration: string;
  repoUrl: string;
  liveUrl?: string;
  category: string;
  icon: React.ReactNode;
}

const featuredProject: ShowcaseProject = {
  id: "oncallshift",
  name: "OnCallShift",
  tagline:
    "Production incident management platform — built entirely by WorkerMill.",
  description:
    "Production incident management platform: on-call scheduling, alert routing, escalation policies, real-time dashboards, mobile app, and Terraform infrastructure. 78 database models, 46 API routes, 60 frontend pages, 31 mobile screens.",
  stack: "Express + TypeScript + React + React Native + Terraform",
  storyCount: 105,
  cost: "Claude Max",
  duration: "~18 hrs",
  repoUrl: "https://github.com/workermill-examples/oncallshift",
  liveUrl: "https://oncallshift.com",
  category: "incident-management",
  icon: <Zap className="w-5 h-5" />,
};

const showcaseProjects: ShowcaseProject[] = [
  {
    id: "teamboard",
    name: "TeamBoard",
    tagline: "Multi-tenant SaaS project management with Kanban boards.",
    description:
      "Full-stack SaaS with RBAC, drag-and-drop Kanban boards, real-time updates, workspace dashboards, and activity feeds. Deployed to Vercel.",
    stack: "Next.js 15 + Prisma + TailwindCSS + Neon PostgreSQL",
    storyCount: 44,
    cost: "Claude Max",
    duration: "~354 min",
    repoUrl: "https://github.com/workermill-examples/teamboard",
    liveUrl: "https://teamboard.workermill.com",
    category: "saas",
    icon: <Globe className="w-4 h-4" />,
  },
  {
    id: "taskpulse",
    name: "TaskPulse",
    tagline: "Background task monitoring dashboard with scheduling.",
    description:
      "Full-stack task monitoring platform with cron scheduling, API key management, real-time run tracking, keyboard shortcuts, and global search. Deployed to Vercel.",
    stack: "Next.js 16 + Prisma 7 + TailwindCSS v4 + Neon PostgreSQL",
    storyCount: 36,
    cost: "Claude Max",
    duration: "~310 min",
    repoUrl: "https://github.com/workermill-examples/taskpulse",
    liveUrl: "https://taskpulse.workermill.com",
    category: "monitoring",
    icon: <BarChart3 className="w-4 h-4" />,
  },
  {
    id: "shipapi",
    name: "ShipAPI",
    tagline: "Production REST API deployed to AWS via Terraform.",
    description:
      "Inventory management API with JWT auth, rate limiting, full-text search, audit logging, and auto-generated OpenAPI docs. Full AWS deployment.",
    stack: "FastAPI + SQLAlchemy + Terraform",
    storyCount: 8,
    cost: "Claude Max",
    duration: "35 min",
    repoUrl: "https://github.com/workermill-examples/shipapi",
    category: "api",
    icon: <Terminal className="w-4 h-4" />,
  },
  {
    id: "pulseview",
    name: "PulseView",
    tagline: "Real-time event analytics with always-alive demo data.",
    description:
      "Event ingestion API with real-time WebSocket dashboard: charts, heatmap, and searchable event table. Demo data generator keeps charts active.",
    stack: "Express + React + Socket.io + GCP",
    storyCount: 12,
    cost: "Claude Max",
    duration: "62 min",
    repoUrl: "https://github.com/workermill-examples/pulseview",
    category: "analytics",
    icon: <BarChart3 className="w-4 h-4" />,
  },
  {
    id: "docforge",
    name: "DocForge",
    tagline: "Developer docs with CMS, search, and version history.",
    description:
      "Documentation platform with Stripe-like design, Meilisearch-powered search, Django admin CMS, and 15+ pages of generated API docs.",
    stack: "Django + HTMX + Meilisearch",
    storyCount: 10,
    cost: "Claude Max",
    duration: "42 min",
    repoUrl: "https://github.com/workermill-examples/docforge",
    category: "documentation",
    icon: <FileText className="w-4 h-4" />,
  },
  {
    id: "envguard",
    name: "EnvGuard",
    tagline: "Secret scanning CLI (Go) with tracking dashboard.",
    description:
      "Go CLI scanning codebases for leaked secrets using regex and entropy analysis. Web dashboard tracks results. Cross-platform binaries via goreleaser.",
    stack: "Go + Cobra + Next.js",
    storyCount: 12,
    cost: "Claude Max",
    duration: "75 min",
    repoUrl: "https://github.com/workermill-examples/envguard",
    category: "security",
    icon: <Shield className="w-4 h-4" />,
  },
  {
    id: "orderflow",
    name: "OrderFlow",
    tagline: "Event-driven microservices with monitoring dashboard.",
    description:
      "Three-service order processing (Order, Payment, Notification) via AWS SQS. Real-time monitoring dashboard shows animated message flow.",
    stack: "Express + SQS + React + Terraform",
    storyCount: 14,
    cost: "Claude Max",
    duration: "95 min",
    repoUrl: "https://github.com/workermill-examples/orderflow",
    category: "microservices",
    icon: <Workflow className="w-4 h-4" />,
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
            Real projects built from a description. Each includes the repo,
            build log, and quality metrics.
          </p>
        </div>

        {/* Featured project — OnCallShift */}
        <div className="mb-10">
          <div className="card-elevated border border-primary/30 rounded-2xl overflow-hidden bg-gradient-to-br from-primary/5 to-accent/5">
            <div className="p-8 lg:p-10">
              <div className="flex flex-col lg:flex-row gap-8">
                {/* Left: info */}
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-4">
                    <BuiltByBadge />
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Flagship showcase
                    </span>
                  </div>
                  <h3 className="text-2xl lg:text-3xl font-bold text-foreground mb-3">
                    {featuredProject.name}
                  </h3>
                  <p className="text-base text-muted-foreground leading-relaxed mb-6">
                    {featuredProject.description}
                  </p>
                  <div className="inline-block px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-sm font-medium text-primary mb-6">
                    {featuredProject.stack}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {featuredProject.liveUrl && (
                      <a
                        href={featuredProject.liveUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                      >
                        <Globe className="w-4 h-4" />
                        Visit oncallshift.com
                      </a>
                    )}
                    <a
                      href={featuredProject.repoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-muted hover:bg-muted/80 transition-colors text-foreground"
                    >
                      <ExternalLink className="w-4 h-4" />
                      View repo
                    </a>
                    <Link
                      to={`/showcase/${featuredProject.id}`}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-primary/10 hover:bg-primary/20 transition-colors text-primary border border-primary/20"
                    >
                      See the build log
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                  </div>
                </div>

                {/* Right: stats */}
                <div className="lg:w-64 flex-shrink-0">
                  <div className="grid grid-cols-3 lg:grid-cols-1 gap-4">
                    <div className="card-elevated border border-border/50 rounded-xl p-4 text-center lg:text-left">
                      <div className="flex items-center justify-center lg:justify-start gap-2 text-2xl font-bold text-foreground">
                        <Layers className="w-5 h-5 text-muted-foreground" />
                        {featuredProject.storyCount}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        stories executed
                      </div>
                    </div>
                    <div className="card-elevated border border-border/50 rounded-xl p-4 text-center lg:text-left">
                      <div className="flex items-center justify-center lg:justify-start gap-2 text-lg font-bold text-amber-400">
                        <Zap className="w-5 h-5" />
                        Claude Max
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        subscription model
                      </div>
                    </div>
                    <div className="card-elevated border border-border/50 rounded-xl p-4 text-center lg:text-left">
                      <div className="flex items-center justify-center lg:justify-start gap-2 text-2xl font-bold text-foreground">
                        <Clock className="w-5 h-5 text-muted-foreground" />
                        {featuredProject.duration}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        total time
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Project cards grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {showcaseProjects.map((project) => (
            <div
              key={project.id}
              className="card-elevated border border-border/50 rounded-2xl overflow-hidden card-hover group"
            >
              {/* Card header */}
              <div className="px-6 pt-6 pb-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary/10 text-primary">
                      {project.icon}
                    </div>
                    <h3 className="text-lg font-semibold text-foreground">
                      {project.name}
                    </h3>
                  </div>
                  {project.liveUrl && <BuiltByBadge />}
                </div>
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
                      {project.storyCount}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      stories
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1 text-sm font-semibold text-amber-400">
                      <Zap className="w-3.5 h-3.5" />
                      Max
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Claude Max
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1 text-sm font-semibold text-foreground">
                      <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                      {project.duration}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      time
                    </div>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="px-6 py-4 border-t border-border/30 flex gap-3">
                {project.liveUrl && (
                  <a
                    href={project.liveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    <Globe className="w-3 h-3" />
                    Live Demo
                  </a>
                )}
                <a
                  href={project.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 transition-colors text-foreground"
                >
                  <ExternalLink className="w-3 h-3" />
                  View repo
                </a>
                <Link
                  to={`/showcase/${project.id}`}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-primary/10 hover:bg-primary/20 transition-colors text-primary border border-primary/20"
                >
                  View build log
                </Link>
              </div>
            </div>
          ))}
        </div>

        {/* Bottom note */}
        <div className="text-center mt-12">
          <p className="text-sm text-muted-foreground">
            All projects built using{" "}
            <span className="text-amber-400 font-semibold">Claude Max</span>{" "}
            subscription. No per-token API costs.
          </p>
        </div>
      </div>
    </section>
  );
}

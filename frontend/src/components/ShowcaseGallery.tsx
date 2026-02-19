import { Link } from "react-router-dom";
import {
  ExternalLink,
  Clock,
  Layers,
  Zap,
  Globe,
  Shield,
  Terminal,
  BarChart3,
  FileText,
  Workflow,
  Calendar,
  CheckCircle,
  AlertTriangle,
  TrendingUp,
  GitPullRequest,
} from "lucide-react";
import BuiltByBadge from "./BuiltByBadge";

interface ShowcaseProject {
  id: string;
  name: string;
  tagline: string;
  description?: string;
  stack: string;
  storyCount?: number;
  cost?: string;
  duration?: string;
  repoUrl?: string;
  liveUrl?: string;
  category: string;
  icon: React.ReactNode;
  comingSoon?: boolean;
}

const showcaseProjects: ShowcaseProject[] = [
  {
    id: "calmill",
    name: "CalMill",
    tagline: "Open scheduling platform with Google Calendar sync.",
    description:
      "Full-stack scheduling platform with event types, timezone-aware booking, team round-robin scheduling, Google Calendar integration, email notifications, and public booking pages. 7 stories, 100% success rate. Deployed to Vercel.",
    stack: "Next.js 16 + Prisma 7 + TailwindCSS 4 + Neon PostgreSQL",
    storyCount: 7,
    cost: "$301",
    duration: "~7 hrs",
    repoUrl: "https://github.com/workermill-examples/calmill",
    liveUrl: "https://calmill.workermill.com",
    category: "scheduling",
    icon: <Calendar className="w-4 h-4" />,
  },
  {
    id: "taskpulse",
    name: "TaskPulse",
    tagline: "Background task monitoring dashboard with scheduling.",
    description:
      "Full-stack task monitoring platform with cron scheduling, API key management, real-time run tracking, keyboard shortcuts, and global search. 5 stories, 100% success rate. Deployed to Vercel.",
    stack: "Next.js 16 + Prisma 7 + TailwindCSS v4 + Neon PostgreSQL",
    storyCount: 5,
    cost: "$139",
    duration: "~2 hrs",
    repoUrl: "https://github.com/workermill-examples/taskpulse",
    liveUrl: "https://taskpulse.workermill.com",
    category: "monitoring",
    icon: <BarChart3 className="w-4 h-4" />,
  },
  {
    id: "teamboard",
    name: "TeamBoard",
    tagline: "Multi-tenant SaaS project management with Kanban boards.",
    description:
      "Full-stack SaaS with RBAC, drag-and-drop Kanban boards, real-time updates, workspace dashboards, and activity feeds. 5 stories, all approved. Deployed to Vercel.",
    stack: "Next.js 15 + Prisma + TailwindCSS + Neon PostgreSQL",
    storyCount: 5,
    cost: "Claude Max",
    duration: "~6 hrs",
    repoUrl: "https://github.com/workermill-examples/teamboard",
    liveUrl: "https://teamboard.workermill.com",
    category: "saas",
    icon: <Globe className="w-4 h-4" />,
  },
  {
    id: "oncallshift",
    name: "OnCallShift",
    tagline: "Production incident management platform — built entirely by WorkerMill.",
    description:
      "On-call scheduling, alert routing, escalation policies, real-time dashboards, mobile app, and Terraform infrastructure. 78 database models, 46 API routes, 60 frontend pages, 31 mobile screens.",
    stack: "Express + TypeScript + React + React Native + Terraform",
    storyCount: 153,
    cost: "Claude Max",
    duration: "~18 hrs",
    liveUrl: "https://oncallshift.com",
    category: "incident-management",
    icon: <Zap className="w-4 h-4" />,
  },
  {
    id: "shipapi",
    name: "ShipAPI",
    tagline: "Production REST API deployed to AWS via Terraform.",
    stack: "FastAPI + SQLAlchemy + Terraform",
    category: "api",
    icon: <Terminal className="w-4 h-4" />,
    comingSoon: true,
  },
  {
    id: "pulseview",
    name: "PulseView",
    tagline: "Real-time event analytics with always-alive demo data.",
    stack: "Express + React + Socket.io + GCP",
    category: "analytics",
    icon: <BarChart3 className="w-4 h-4" />,
    comingSoon: true,
  },
  {
    id: "docforge",
    name: "DocForge",
    tagline: "Developer docs with CMS, search, and version history.",
    stack: "Django + HTMX + Meilisearch",
    category: "documentation",
    icon: <FileText className="w-4 h-4" />,
    comingSoon: true,
  },
  {
    id: "envguard",
    name: "EnvGuard",
    tagline: "Secret scanning CLI (Go) with tracking dashboard.",
    stack: "Go + Cobra + Next.js",
    category: "security",
    icon: <Shield className="w-4 h-4" />,
    comingSoon: true,
  },
  {
    id: "orderflow",
    name: "OrderFlow",
    tagline: "Event-driven microservices with monitoring dashboard.",
    stack: "Express + SQS + React + Terraform",
    category: "microservices",
    icon: <Workflow className="w-4 h-4" />,
    comingSoon: true,
  },
];

export default function ShowcaseGallery() {
  return (
    <section id="showcase" className="py-24 relative">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-card/50 to-transparent" />

      <div className="relative max-w-6xl mx-auto px-6">
        {/* Section header */}
        <div className="text-center mb-12">
          <h2 className="text-3xl lg:text-4xl font-bold mb-4">
            <span className="text-foreground">Built with </span>
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              WorkerMill
            </span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Full-stack applications built from a description. Every story
            produced a mergeable PR — 100% success rate across all showcase
            builds.
          </p>
        </div>

        {/* Metrics banner */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
          <div className="bg-slate-900/60 border border-white/5 rounded-xl p-4 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <span className="text-2xl font-bold text-white">90%</span>
            </div>
            <p className="text-xs text-slate-400">
              Task success rate (30 days)
            </p>
          </div>
          <div className="bg-slate-900/60 border border-white/5 rounded-xl p-4 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              <span className="text-2xl font-bold text-white">93%</span>
            </div>
            <p className="text-xs text-slate-400">First-attempt success</p>
          </div>
          <div className="bg-slate-900/60 border border-white/5 rounded-xl p-4 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <GitPullRequest className="w-4 h-4 text-teal-400" />
              <span className="text-2xl font-bold text-white">75</span>
            </div>
            <p className="text-xs text-slate-400">PRs shipped (30 days)</p>
          </div>
          <div className="bg-slate-900/60 border border-white/5 rounded-xl p-4 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Zap className="w-4 h-4 text-amber-400" />
              <span className="text-2xl font-bold text-white">~55 min</span>
            </div>
            <p className="text-xs text-slate-400">Avg story completion</p>
          </div>
        </div>

        {/* Project cards grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {showcaseProjects.map((project) =>
            project.comingSoon ? (
              <div
                key={project.id}
                className="card-elevated border border-border/50 rounded-2xl overflow-hidden opacity-60"
              >
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
                    <span className="text-xs font-medium text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
                      Coming Soon
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                    {project.tagline}
                  </p>
                  <div className="inline-block px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 text-xs font-medium text-primary">
                    {project.stack}
                  </div>
                </div>
              </div>
            ) : (
              <div
                key={project.id}
                className="card-elevated border border-border/50 rounded-2xl overflow-hidden card-hover group"
              >
                {/* Clickable card body → build log */}
                <Link
                  to={`/showcase/${project.id}`}
                  className="block px-6 pt-6 pb-4"
                >
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

                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-border/30">
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
                        {project.cost}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        cost
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
                </Link>

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
                  {project.repoUrl && (
                    <a
                      href={project.repoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 transition-colors text-foreground"
                    >
                      <ExternalLink className="w-3 h-3" />
                      View repo
                    </a>
                  )}
                  <Link
                    to={`/showcase/${project.id}`}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 transition-colors text-foreground"
                  >
                    <Layers className="w-3 h-3" />
                    Build log
                  </Link>
                </div>
              </div>
            ),
          )}
        </div>

        {/* Bottom note */}
        <div className="text-center mt-12 mb-12">
          <p className="text-sm text-muted-foreground">
            Costs shown are API usage at standard rates. Use{" "}
            <span className="text-amber-400 font-semibold">Claude Max</span>{" "}
            ($100/mo) for unlimited tasks at zero per-token cost.
          </p>
        </div>

        {/* Transparency callout */}
        <div className="max-w-3xl mx-auto bg-slate-900/40 border border-white/5 rounded-2xl p-6 lg:p-8">
          <div className="flex items-start gap-3 mb-4">
            <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-white mb-1">
                Real metrics, not cherry-picked
              </h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Autonomous coding is hard. Across 273 total tasks, 8 failed — a
                planning agent that returned malformed JSON, a deployment
                pipeline with a pre-existing infrastructure bug, a plan that sat
                unapproved for 7 days, and a manager review that caught
                inaccuracies the worker couldn&apos;t fix in its allowed
                retries.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 pt-4 border-t border-white/5">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Auto-retry on transient errors</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Escalation to dashboard on blockers</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Full logs and cost tracking on every task</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

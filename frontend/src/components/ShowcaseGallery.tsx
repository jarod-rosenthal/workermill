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
  FileCode,
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
  linesOfCode?: string;
  repoUrl?: string;
  liveUrl?: string;
  category: string;
  icon: React.ReactNode;
  comingSoon?: boolean;
}

const showcaseProjects: ShowcaseProject[] = [
  {
    id: "flagdeck",
    name: "FlagDeck",
    tagline:
      "Feature flag platform with targeting rules, percentage rollouts, and A/B testing — Go/Fiber API + SvelteKit dashboard.",
    description:
      "Full-stack feature flag platform with Go/Fiber API, SvelteKit 2 dashboard (Svelte 5 runes), MongoDB, Redis caching, JWT + API key auth, flag evaluation engine with targeting and rollouts, audit logging, and Docker deployment. Claude Sonnet built the code across 7 expert personas; Claude Opus planned each epic and reviewed all work as tech lead. 3 epics, 21 stories, 67 commits. Deployed to Railway.",
    stack: "Go + SvelteKit 2 + MongoDB + Redis",
    storyCount: 21,
    cost: "$64",
    duration: "~4.5 hrs",
    linesOfCode: "20,800",
    repoUrl: "https://github.com/workermill-examples/flagdeck",
    liveUrl: "https://flagdeck-app.workermill.com",
    category: "developer-tools",
    icon: <Zap className="w-4 h-4" />,
  },
  {
    id: "calmill",
    name: "CalMill",
    tagline: "Open scheduling platform with timezone-aware booking and team round-robin.",
    description:
      "Full-stack scheduling platform with Next.js 16, Prisma 7, and Neon PostgreSQL. Event types, timezone-aware booking, team round-robin scheduling, availability management, webhook integrations, and public booking pages. 3 epics, 48 stories. Deployed to Vercel.",
    stack: "Next.js 16 + Prisma 7 + TailwindCSS 4 + Neon PostgreSQL",
    storyCount: 48,
    cost: "$247",
    duration: "~12 hrs",
    linesOfCode: "41,000",
    repoUrl: "https://github.com/workermill-examples/calmill",
    liveUrl: "https://calmill.workermill.com",
    category: "scheduling",
    icon: <Calendar className="w-4 h-4" />,
  },
  {
    id: "teamboard",
    name: "TeamBoard",
    tagline: "Multi-tenant SaaS project management with Kanban boards.",
    description:
      "Full-stack SaaS with RBAC, drag-and-drop Kanban boards, real-time updates, workspace dashboards, activity feeds, and PWA support. Claude Sonnet built the code across 8 expert personas; Claude Opus planned each epic and reviewed all work as tech lead. 3 epics, 33 stories, 3 revision rounds on frontend integration, seed pipeline gap caught post-deploy. The real story of an AI build — warts and all.",
    stack: "Next.js 15 + Prisma 6 + TailwindCSS 4 + Neon PostgreSQL",
    storyCount: 33,
    cost: "$485",
    duration: "~14 hrs",
    linesOfCode: "23,000",
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
      "Full-stack task monitoring platform with cron scheduling, API key management, real-time run tracking, keyboard shortcuts, and global search. 5 stories, 100% success rate. Deployed to Vercel.",
    stack: "Next.js 16 + Prisma 7 + TailwindCSS v4 + Neon PostgreSQL",
    storyCount: 5,
    cost: "$139",
    duration: "~5 hrs",
    linesOfCode: "17,000",
    repoUrl: "https://github.com/workermill-examples/taskpulse",
    liveUrl: "https://taskpulse.workermill.com",
    category: "monitoring",
    icon: <BarChart3 className="w-4 h-4" />,
  },
  {
    id: "shipapi",
    name: "ShipAPI",
    tagline: "Full-stack inventory management with React dashboard, JWT auth, and Swagger UI.",
    description:
      "Full-stack inventory system with React 19 dashboard and FastAPI backend. JWT + API key auth, full-text search, atomic stock transfers, audit logging, rate limiting, 174 tests, CI pipeline, and Swagger/ReDoc docs. 5 epics, all deployed. Live on Railway.",
    stack: "FastAPI + SQLAlchemy 2 + React 19 + Neon PostgreSQL",
    storyCount: 38,
    cost: "$123",
    duration: "~5.0 hrs",
    linesOfCode: "20,200",
    repoUrl: "https://github.com/workermill-examples/shipapi",
    liveUrl: "https://shipapi.workermill.com",
    category: "api",
    icon: <Terminal className="w-4 h-4" />,
  },
  {
    id: "oncallshift",
    name: "OnCallShift",
    tagline:
      "Production incident management across 3 repos — API, web, and mobile — built entirely by WorkerMill.",
    description:
      "177K lines across 3 repositories. 78 database models, 46 API routes, 60 frontend pages, 31 mobile screens, Terraform infrastructure. 24 epics executed sequentially across oncallshift-api, oncallshift-web, and oncallshift-mobile. Deployed to AWS at oncallshift.com.",
    stack: "Express + TypeScript + React + React Native + Terraform",
    storyCount: 24,
    cost: "$1,206",
    duration: "~18 hrs",
    linesOfCode: "177,000",
    liveUrl: "https://oncallshift.com",
    repoUrl: "https://github.com/jarod-rosenthal/oncallshift",
    category: "incident-management",
    icon: <Zap className="w-4 h-4" />,
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
            317K lines of production code across 6 projects, deployed to
            Vercel and Railway. Every project built from tickets — planned,
            coded, tested, reviewed, and deployed autonomously.
          </p>
        </div>

        {/* Metrics banner — showcase builds only */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
          <div className="bg-slate-900/60 border border-white/5 rounded-xl p-4 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <FileCode className="w-4 h-4 text-amber-400" />
              <span className="text-2xl font-bold text-white">317K</span>
            </div>
            <p className="text-xs text-slate-400">
              Lines of production code
            </p>
          </div>
          <div className="bg-slate-900/60 border border-white/5 rounded-xl p-4 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              <span className="text-2xl font-bold text-white">169</span>
            </div>
            <p className="text-xs text-slate-400">Stories completed</p>
          </div>
          <div className="bg-slate-900/60 border border-white/5 rounded-xl p-4 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <GitPullRequest className="w-4 h-4 text-teal-400" />
              <span className="text-2xl font-bold text-white">19</span>
            </div>
            <p className="text-xs text-slate-400">PRs shipped across builds</p>
          </div>
          <div className="bg-slate-900/60 border border-white/5 rounded-xl p-4 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <span className="text-2xl font-bold text-white">6</span>
            </div>
            <p className="text-xs text-slate-400">Projects shipped</p>
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
                <div className="px-5 pt-5 pb-3">
                  <div className="flex items-center justify-between mb-2">
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
                  <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                    {project.tagline}
                  </p>
                  <div className="inline-block px-2 py-0.5 rounded-md bg-primary/10 border border-primary/20 text-[11px] font-medium text-primary">
                    {project.stack}
                  </div>
                </div>
              </div>
            ) : (
              <div
                key={project.id}
                className="card-elevated border border-border/50 rounded-2xl overflow-hidden card-hover group"
              >
                {/* Card body — links to build log for non-oncallshift projects */}
                {(() => {
                  const cardBody = (
                    <>
                      <div className="flex items-center justify-between mb-2">
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
                      <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                        {project.tagline}
                      </p>
                      <div className="inline-block px-2 py-0.5 rounded-md bg-primary/10 border border-primary/20 text-[11px] font-medium text-primary">
                        {project.stack}
                      </div>

                      {/* Stats — compact inline row */}
                      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/30 text-xs">
                        <span className="flex items-center gap-1 text-foreground font-medium">
                          <Layers className="w-3 h-3 text-muted-foreground" />
                          {project.storyCount} stories
                        </span>
                        {project.linesOfCode && (
                          <span className="flex items-center gap-1 text-emerald-400 font-medium">
                            <FileCode className="w-3 h-3" />
                            {project.linesOfCode}
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-foreground font-medium">
                          <Clock className="w-3 h-3 text-muted-foreground" />
                          {project.duration}
                        </span>
                      </div>
                      {project.cost && (
                        <p className="text-[11px] text-muted-foreground/60 mt-2 italic">
                          {project.cost} at API token rates
                        </p>
                      )}
                    </>
                  );
                  return (
                    <Link to={`/showcase/${project.id}`} className="block px-5 pt-5 pb-3">
                      {cardBody}
                    </Link>
                  );
                })()}

                {/* Actions */}
                <div className="px-5 py-3 border-t border-border/30 flex gap-2">
                  {project.liveUrl && (
                    <a
                      href={project.liveUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
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
                      className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 transition-colors text-foreground"
                    >
                      <ExternalLink className="w-3 h-3" />
                      View repo
                    </a>
                  )}
                  <Link
                      to={`/showcase/${project.id}`}
                      className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 transition-colors text-foreground"
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
            These showcase builds used Anthropic models.
            WorkerMill supports multiple AI providers — bring your own API keys.
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
                Autonomous coding is hard. These builds required revision
                cycles, escalations, and manual spec corrections along the
                way. The numbers above reflect what shipped — not a
                cherry-picked highlight reel. Every build log, cost, and
                review comment is visible in the project detail pages.
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

import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import BuiltByBadge from "../components/BuiltByBadge";
import {
  ArrowLeft,
  ExternalLink,
  Globe,
  Clock,
  DollarSign,
  Layers,
  CheckCircle,
  Zap,
  Shield,
  Terminal,
  BarChart3,
  FileText,
  Workflow,
  Users,
  ChevronDown,
  GitPullRequest,
  AlertTriangle,
  MessageSquare,
  FileCode,
} from "lucide-react";
import { teamBoardEpics } from "../data/teamboard-showcase-data";

interface QualityScores {
  lint: string;
  types: string;
  tests: string;
  security: string;
}

interface ShowcaseStory {
  title: string;
  persona: string;
  status: "completed" | "in_progress" | "planned";
  cost?: string;
  duration?: string;
}

interface ShowcaseDetail {
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
  personasUsed: string[];
  qualityScores: QualityScores;
  stories: ShowcaseStory[];
  icon: React.ReactNode;
}

const showcaseData: Record<string, ShowcaseDetail> = {
  oncallshift: {
    id: "oncallshift",
    name: "OnCallShift",
    tagline:
      "Production incident management platform — built entirely by WorkerMill.",
    description:
      "Complete rebuild of a production incident management platform: on-call scheduling, alert routing, escalation policies, real-time dashboards, mobile app, and Terraform infrastructure. 78 database models, 46 API routes, 60 frontend pages, 31 mobile screens.",
    stack: "Express + TypeScript + React + React Native + Terraform",
    storyCount: 105,
    cost: "$142.00",
    duration: "~18 hrs",
    repoUrl: "https://github.com/jarod-rosenthal/oncallshift",
    liveUrl: "https://oncallshift.com",
    category: "incident-management",
    personasUsed: [
      "backend_developer",
      "frontend_developer",
      "devops_engineer",
      "security_engineer",
      "qa_engineer",
      "tech_writer",
    ],
    qualityScores: {
      lint: "0 errors",
      types: "0 errors",
      tests: ">80% coverage",
      security: "0 critical",
    },
    stories: [
      {
        title: "Project scaffolding and database schema",
        persona: "backend_developer",
        status: "completed",
        cost: "$1.80",
        duration: "12 min",
      },
      {
        title: "Authentication and user management",
        persona: "backend_developer",
        status: "completed",
        cost: "$2.40",
        duration: "18 min",
      },
      {
        title: "Organization and team management",
        persona: "backend_developer",
        status: "completed",
        cost: "$1.60",
        duration: "10 min",
      },
      {
        title: "Service catalog and dependencies",
        persona: "backend_developer",
        status: "completed",
        cost: "$1.20",
        duration: "8 min",
      },
      {
        title: "Incident lifecycle and events",
        persona: "backend_developer",
        status: "completed",
        cost: "$3.20",
        duration: "22 min",
      },
      {
        title: "On-call schedule management",
        persona: "backend_developer",
        status: "completed",
        cost: "$2.80",
        duration: "20 min",
      },
      {
        title: "Alert routing and escalation policies",
        persona: "backend_developer",
        status: "completed",
        cost: "$2.60",
        duration: "16 min",
      },
      {
        title: "Terraform infrastructure (ECS, RDS, ALB)",
        persona: "devops_engineer",
        status: "completed",
        cost: "$3.40",
        duration: "24 min",
      },
      {
        title: "Frontend dashboard and incident views",
        persona: "frontend_developer",
        status: "completed",
        cost: "$4.20",
        duration: "30 min",
      },
      {
        title: "Mobile app screens and push notifications",
        persona: "frontend_developer",
        status: "completed",
        cost: "$3.80",
        duration: "26 min",
      },
      {
        title: "Security audit and hardening",
        persona: "security_engineer",
        status: "completed",
        cost: "$1.40",
        duration: "10 min",
      },
      {
        title: "Test suite and quality gates",
        persona: "qa_engineer",
        status: "completed",
        cost: "$2.20",
        duration: "14 min",
      },
    ],
    icon: <Zap className="w-5 h-5" />,
  },
  teamboard: {
    id: "teamboard",
    name: "TeamBoard",
    tagline:
      "Multi-tenant SaaS project management — built across 5 sequential epics by AI workers.",
    description:
      "Full-stack SaaS with RBAC, drag-and-drop Kanban boards, real-time SSE updates, PWA offline support, workspace dashboards, activity feeds, and E2E tests. 5 epics executed sequentially, each building on the last. Deployed to Vercel at teamboard.workermill.com.",
    stack: "Next.js 15 + Prisma + TailwindCSS + Neon PostgreSQL",
    storyCount: 44,
    cost: "Claude Max",
    duration: "~354 min",
    repoUrl: "https://github.com/workermill-examples/teamboard",
    liveUrl: "https://teamboard.workermill.com",
    category: "saas",
    personasUsed: [
      "backend_developer",
      "frontend_developer",
      "qa_engineer",
      "devops_engineer",
      "database_administrator",
    ],
    qualityScores: {
      lint: "0 errors",
      types: "0 errors (3342 → 0)",
      tests: "279 unit + 56 E2E",
      security: "0 critical",
    },
    stories: [],
    icon: <Globe className="w-5 h-5" />,
  },
  shipapi: {
    id: "shipapi",
    name: "ShipAPI",
    tagline: "Production REST API deployed to AWS via Terraform.",
    description:
      "Inventory management API with JWT auth, rate limiting, full-text search, audit logging, and auto-generated OpenAPI docs. Full AWS deployment.",
    stack: "FastAPI + SQLAlchemy + Terraform",
    storyCount: 8,
    cost: "$9.80",
    duration: "35 min",
    repoUrl: "https://github.com/workermill-examples/shipapi",
    category: "api",
    personasUsed: ["backend_developer", "devops_engineer", "qa_engineer"],
    qualityScores: {
      lint: "0 errors",
      types: "0 errors (mypy strict)",
      tests: ">80% coverage",
      security: "0 critical",
    },
    stories: [
      {
        title: "FastAPI project setup and models",
        persona: "backend_developer",
        status: "completed",
        cost: "$1.20",
        duration: "4 min",
      },
      {
        title: "JWT and API key authentication",
        persona: "backend_developer",
        status: "completed",
        cost: "$1.40",
        duration: "5 min",
      },
      {
        title: "CRUD endpoints with pagination and search",
        persona: "backend_developer",
        status: "completed",
        cost: "$1.60",
        duration: "6 min",
      },
      {
        title: "Stock transfer and alert system",
        persona: "backend_developer",
        status: "completed",
        cost: "$1.20",
        duration: "4 min",
      },
      {
        title: "Audit logging middleware",
        persona: "backend_developer",
        status: "completed",
        cost: "$0.80",
        duration: "3 min",
      },
      {
        title: "Terraform infrastructure (ECS + RDS + ALB)",
        persona: "devops_engineer",
        status: "completed",
        cost: "$1.60",
        duration: "6 min",
      },
      {
        title: "Seed data and OpenAPI docs",
        persona: "backend_developer",
        status: "completed",
        cost: "$0.80",
        duration: "3 min",
      },
      {
        title: "Test suite and CI/CD pipeline",
        persona: "qa_engineer",
        status: "completed",
        cost: "$1.20",
        duration: "4 min",
      },
    ],
    icon: <Terminal className="w-5 h-5" />,
  },
  pulseview: {
    id: "pulseview",
    name: "PulseView",
    tagline: "Real-time event analytics with always-alive demo data.",
    description:
      "Event ingestion API with real-time WebSocket dashboard: charts, heatmap, and searchable event table. Demo data generator keeps charts active.",
    stack: "Express + React + Socket.io + GCP",
    storyCount: 12,
    cost: "$18.40",
    duration: "62 min",
    repoUrl: "https://github.com/workermill-examples/pulseview",
    category: "analytics",
    personasUsed: [
      "backend_developer",
      "frontend_developer",
      "devops_engineer",
    ],
    qualityScores: {
      lint: "0 errors",
      types: "0 errors",
      tests: ">60% coverage",
      security: "0 critical",
    },
    stories: [
      {
        title: "Event ingestion API",
        persona: "backend_developer",
        status: "completed",
        cost: "$1.40",
        duration: "5 min",
      },
      {
        title: "PostgreSQL schema and BRIN indexes",
        persona: "backend_developer",
        status: "completed",
        cost: "$1.00",
        duration: "4 min",
      },
      {
        title: "WebSocket real-time layer",
        persona: "backend_developer",
        status: "completed",
        cost: "$1.60",
        duration: "6 min",
      },
      {
        title: "Counter cards and line chart",
        persona: "frontend_developer",
        status: "completed",
        cost: "$1.40",
        duration: "5 min",
      },
      {
        title: "Bar chart and pie chart",
        persona: "frontend_developer",
        status: "completed",
        cost: "$1.20",
        duration: "4 min",
      },
      {
        title: "Heatmap visualization",
        persona: "frontend_developer",
        status: "completed",
        cost: "$1.60",
        duration: "6 min",
      },
      {
        title: "Event table with search and sort",
        persona: "frontend_developer",
        status: "completed",
        cost: "$1.40",
        duration: "5 min",
      },
      {
        title: "Time range and filter controls",
        persona: "frontend_developer",
        status: "completed",
        cost: "$1.20",
        duration: "4 min",
      },
      {
        title: "Demo data generator",
        persona: "backend_developer",
        status: "completed",
        cost: "$1.80",
        duration: "6 min",
      },
      {
        title: "Materialized views and aggregation",
        persona: "backend_developer",
        status: "completed",
        cost: "$1.40",
        duration: "5 min",
      },
      {
        title: "Terraform GCP deployment",
        persona: "devops_engineer",
        status: "completed",
        cost: "$1.60",
        duration: "6 min",
      },
      {
        title: "CI/CD and smoke tests",
        persona: "qa_engineer",
        status: "completed",
        cost: "$1.80",
        duration: "6 min",
      },
    ],
    icon: <BarChart3 className="w-5 h-5" />,
  },
  docforge: {
    id: "docforge",
    name: "DocForge",
    tagline: "Developer docs with CMS, search, and version history.",
    description:
      "Documentation platform with Stripe-like design, Meilisearch-powered search, Django admin CMS, and 15+ pages of generated API docs.",
    stack: "Django + HTMX + Meilisearch",
    storyCount: 10,
    cost: "$12.60",
    duration: "42 min",
    repoUrl: "https://github.com/workermill-examples/docforge",
    category: "documentation",
    personasUsed: ["backend_developer", "frontend_developer", "tech_writer"],
    qualityScores: {
      lint: "0 errors",
      types: "0 errors (mypy)",
      tests: ">60% coverage",
      security: "0 critical",
    },
    stories: [
      {
        title: "Django project and page model",
        persona: "backend_developer",
        status: "completed",
        cost: "$1.00",
        duration: "4 min",
      },
      {
        title: "Page hierarchy and ordering",
        persona: "backend_developer",
        status: "completed",
        cost: "$1.20",
        duration: "4 min",
      },
      {
        title: "Markdown rendering and syntax highlighting",
        persona: "backend_developer",
        status: "completed",
        cost: "$1.00",
        duration: "3 min",
      },
      {
        title: "Meilisearch integration",
        persona: "backend_developer",
        status: "completed",
        cost: "$1.40",
        duration: "5 min",
      },
      {
        title: "Django admin CMS with Markdown editor",
        persona: "backend_developer",
        status: "completed",
        cost: "$1.20",
        duration: "4 min",
      },
      {
        title: "Version history and diff view",
        persona: "backend_developer",
        status: "completed",
        cost: "$1.40",
        duration: "5 min",
      },
      {
        title: "Public docs frontend with sidebar",
        persona: "frontend_developer",
        status: "completed",
        cost: "$1.60",
        duration: "5 min",
      },
      {
        title: "Dark mode and reading time",
        persona: "frontend_developer",
        status: "completed",
        cost: "$0.80",
        duration: "3 min",
      },
      {
        title: "Generate LaunchPad API documentation",
        persona: "tech_writer",
        status: "completed",
        cost: "$1.60",
        duration: "5 min",
      },
      {
        title: "Terraform AWS deployment",
        persona: "devops_engineer",
        status: "completed",
        cost: "$1.40",
        duration: "4 min",
      },
    ],
    icon: <FileText className="w-5 h-5" />,
  },
  envguard: {
    id: "envguard",
    name: "EnvGuard",
    tagline: "Secret scanning CLI (Go) with tracking dashboard.",
    description:
      "Go CLI scanning codebases for leaked secrets using regex and entropy analysis. Web dashboard tracks results. Cross-platform binaries via goreleaser.",
    stack: "Go + Cobra + Next.js",
    storyCount: 12,
    cost: "$22.30",
    duration: "75 min",
    repoUrl: "https://github.com/workermill-examples/envguard",
    category: "security",
    personasUsed: [
      "backend_developer",
      "frontend_developer",
      "security_engineer",
      "devops_engineer",
    ],
    qualityScores: {
      lint: "0 errors (golangci-lint + eslint)",
      types: "0 errors (go vet + tsc)",
      tests: ">70% coverage",
      security: "0 critical",
    },
    stories: [
      {
        title: "Go CLI scaffolding with Cobra",
        persona: "backend_developer",
        status: "completed",
        cost: "$1.40",
        duration: "5 min",
      },
      {
        title: "Regex pattern detection rules (30+)",
        persona: "security_engineer",
        status: "completed",
        cost: "$2.40",
        duration: "8 min",
      },
      {
        title: "Shannon entropy analysis",
        persona: "backend_developer",
        status: "completed",
        cost: "$1.80",
        duration: "6 min",
      },
      {
        title: "Git history scanning",
        persona: "backend_developer",
        status: "completed",
        cost: "$2.00",
        duration: "7 min",
      },
      {
        title: "Output formats (table, JSON, SARIF)",
        persona: "backend_developer",
        status: "completed",
        cost: "$1.40",
        duration: "5 min",
      },
      {
        title: "Configuration file support",
        persona: "backend_developer",
        status: "completed",
        cost: "$1.20",
        duration: "4 min",
      },
      {
        title: "Dashboard API and data model",
        persona: "backend_developer",
        status: "completed",
        cost: "$1.60",
        duration: "6 min",
      },
      {
        title: "Dashboard frontend (projects, trends)",
        persona: "frontend_developer",
        status: "completed",
        cost: "$2.20",
        duration: "8 min",
      },
      {
        title: "Finding management UI",
        persona: "frontend_developer",
        status: "completed",
        cost: "$1.80",
        duration: "6 min",
      },
      {
        title: "CLI push command integration",
        persona: "backend_developer",
        status: "completed",
        cost: "$1.20",
        duration: "5 min",
      },
      {
        title: "Goreleaser cross-platform builds",
        persona: "devops_engineer",
        status: "completed",
        cost: "$1.60",
        duration: "6 min",
      },
      {
        title: "Test suite and CI pipeline",
        persona: "qa_engineer",
        status: "completed",
        cost: "$3.70",
        duration: "9 min",
      },
    ],
    icon: <Shield className="w-5 h-5" />,
  },
  orderflow: {
    id: "orderflow",
    name: "OrderFlow",
    tagline: "Event-driven microservices with monitoring dashboard.",
    description:
      "Three-service order processing (Order, Payment, Notification) via AWS SQS. Real-time monitoring dashboard shows animated message flow.",
    stack: "Express + SQS + React + Terraform",
    storyCount: 14,
    cost: "$28.50",
    duration: "95 min",
    repoUrl: "https://github.com/workermill-examples/orderflow",
    category: "microservices",
    personasUsed: [
      "backend_developer",
      "frontend_developer",
      "devops_engineer",
      "qa_engineer",
    ],
    qualityScores: {
      lint: "0 errors",
      types: "0 errors",
      tests: ">60% coverage",
      security: "0 critical",
    },
    stories: [
      {
        title: "Order service with REST API",
        persona: "backend_developer",
        status: "completed",
        cost: "$1.80",
        duration: "6 min",
      },
      {
        title: "Payment service with SQS consumer",
        persona: "backend_developer",
        status: "completed",
        cost: "$2.20",
        duration: "8 min",
      },
      {
        title: "Notification service with webhook delivery",
        persona: "backend_developer",
        status: "completed",
        cost: "$1.60",
        duration: "6 min",
      },
      {
        title: "SQS queue setup and message schemas",
        persona: "backend_developer",
        status: "completed",
        cost: "$1.40",
        duration: "5 min",
      },
      {
        title: "Retry logic with exponential backoff",
        persona: "backend_developer",
        status: "completed",
        cost: "$1.20",
        duration: "4 min",
      },
      {
        title: "Monitoring service with WebSocket",
        persona: "backend_developer",
        status: "completed",
        cost: "$2.00",
        duration: "7 min",
      },
      {
        title: "Dashboard service health cards",
        persona: "frontend_developer",
        status: "completed",
        cost: "$1.40",
        duration: "5 min",
      },
      {
        title: "Animated message flow diagram",
        persona: "frontend_developer",
        status: "completed",
        cost: "$2.40",
        duration: "8 min",
      },
      {
        title: "Live event log and order tracker",
        persona: "frontend_developer",
        status: "completed",
        cost: "$1.80",
        duration: "6 min",
      },
      {
        title: "Metrics dashboard and demo mode",
        persona: "frontend_developer",
        status: "completed",
        cost: "$1.60",
        duration: "6 min",
      },
      {
        title: "Terraform multi-service deployment",
        persona: "devops_engineer",
        status: "completed",
        cost: "$2.80",
        duration: "10 min",
      },
      {
        title: "SQS queues and IAM policies",
        persona: "devops_engineer",
        status: "completed",
        cost: "$1.60",
        duration: "5 min",
      },
      {
        title: "ALB path-based routing",
        persona: "devops_engineer",
        status: "completed",
        cost: "$1.20",
        duration: "4 min",
      },
      {
        title: "Integration tests and CI/CD",
        persona: "qa_engineer",
        status: "completed",
        cost: "$5.50",
        duration: "15 min",
      },
    ],
    icon: <Workflow className="w-5 h-5" />,
  },
};

const personaLabels: Record<string, { label: string; color: string }> = {
  backend_developer: { label: "Backend", color: "text-blue-400" },
  frontend_developer: { label: "Frontend", color: "text-purple-400" },
  devops_engineer: { label: "DevOps", color: "text-orange-400" },
  security_engineer: { label: "Security", color: "text-red-400" },
  qa_engineer: { label: "QA", color: "text-green-400" },
  tech_writer: { label: "Docs", color: "text-cyan-400" },
  database_administrator: { label: "DBA", color: "text-yellow-400" },
};

function PersonaBadge({ persona }: { persona: string }) {
  const info = personaLabels[persona] || {
    label: persona,
    color: "text-muted-foreground",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${info.color} relative`}>
      <span
        className="absolute inset-0 rounded"
        style={{ backgroundColor: "currentColor", opacity: 0.12 }}
      />
      <span className="relative">{info.label}</span>
    </span>
  );
}

export default function ShowcaseViewer() {
  const { projectId } = useParams<{ projectId: string }>();
  const project = projectId ? showcaseData[projectId] : undefined;
  const isTeamBoard = projectId === "teamboard";
  const [expandedEpic, setExpandedEpic] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Record<string, "spec" | "log">>(
    {},
  );

  if (!project) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-4">
            Project not found
          </h1>
          <Link
            to="/***REMOVED***showcase"
            className="text-primary hover:underline flex items-center gap-2 justify-center"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to showcase
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link
            to="/***REMOVED***showcase"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to showcase
          </Link>
          <div className="flex items-center gap-3">
            {project.liveUrl && (
              <a
                href={project.liveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Globe className="w-3.5 h-3.5" />
                Live site
              </a>
            )}
            <a
              href={project.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 transition-colors text-foreground"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              View repo
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        {/* Project header */}
        <div className="mb-12">
          <div className="mb-4">
            <BuiltByBadge size="md" />
          </div>
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 text-primary">
              {project.icon}
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">
                {project.name}
              </h1>
              <p className="text-muted-foreground">{project.tagline}</p>
            </div>
          </div>
          <div className="inline-block px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-sm font-medium text-primary">
            {project.stack}
          </div>
        </div>

        {/* Stats row */}
        <div
          className={`grid grid-cols-2 gap-4 mb-12 ${isTeamBoard ? "md:grid-cols-5" : "md:grid-cols-4"}`}
        >
          {isTeamBoard && (
            <div className="card-elevated border border-border/50 rounded-xl p-5">
              <div className="flex items-center gap-2 text-2xl font-bold text-foreground">
                <FileCode className="w-5 h-5 text-muted-foreground" />
                29K
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                lines of code
              </div>
            </div>
          )}
          <div className="card-elevated border border-border/50 rounded-xl p-5">
            <div className="flex items-center gap-2 text-2xl font-bold text-foreground">
              <Layers className="w-5 h-5 text-muted-foreground" />
              {project.storyCount}
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              stories executed
            </div>
          </div>
          <div className="card-elevated border border-border/50 rounded-xl p-5">
            {project.cost.startsWith("$") ? (
              <>
                <div className="flex items-center gap-2 text-2xl font-bold text-green-500">
                  <DollarSign className="w-5 h-5" />
                  {project.cost.replace("$", "")}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  total cost (BYOK)
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 text-2xl font-bold text-primary">
                  <Zap className="w-5 h-5" />
                  {project.cost}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  subscription model
                </div>
              </>
            )}
          </div>
          <div className="card-elevated border border-border/50 rounded-xl p-5">
            <div className="flex items-center gap-2 text-2xl font-bold text-foreground">
              <Clock className="w-5 h-5 text-muted-foreground" />
              {project.duration}
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              total time
            </div>
          </div>
          <div className="card-elevated border border-border/50 rounded-xl p-5">
            <div className="flex items-center gap-2 text-2xl font-bold text-foreground">
              <Users className="w-5 h-5 text-muted-foreground" />
              {project.personasUsed.length}
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              AI experts used
            </div>
          </div>
        </div>

        <div className={isTeamBoard ? "" : "grid lg:grid-cols-3 gap-8"}>
          {/* Epic board view for TeamBoard, story timeline for others */}
          {isTeamBoard ? (
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-6">
                <h2 className="text-xl font-semibold text-foreground">
                  Build Log
                </h2>
                <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full">
                  {teamBoardEpics.length} epics &middot; 100 comments
                </span>
              </div>

              <div className="space-y-3">
                {teamBoardEpics.map((epic) => {
                  const isExpanded = expandedEpic === epic.id;
                  const tab = activeTab[epic.id] || "log";
                  return (
                    <div
                      key={epic.id}
                      className="card-elevated border border-border/50 rounded-xl overflow-hidden"
                    >
                      {/* Epic header — always visible */}
                      <button
                        onClick={() =>
                          setExpandedEpic(isExpanded ? null : epic.id)
                        }
                        className="w-full text-left p-4 hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <ChevronDown
                            className={`w-4 h-4 text-muted-foreground transition-transform flex-shrink-0 ${
                              isExpanded ? "rotate-0" : "-rotate-90"
                            }`}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-foreground">
                                {epic.title}
                              </span>
                              {epic.status === "completed" ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-500/10 text-green-500">
                                  <CheckCircle className="w-3 h-3" />
                                  Approved
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-500">
                                  <AlertTriangle className="w-3 h-3" />
                                  Escalated
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Layers className="w-3 h-3" />
                                {epic.storyCount} stories
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {epic.duration}
                              </span>
                              <span className="flex items-center gap-1">
                                <MessageSquare className="w-3 h-3" />
                                {epic.commentCount} notes
                              </span>
                              {epic.techLeadScore && (
                                <span className="flex items-center gap-1 text-green-500">
                                  <CheckCircle className="w-3 h-3" />
                                  {epic.techLeadScore}
                                </span>
                              )}
                              <a
                                href={epic.prUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-primary hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <GitPullRequest className="w-3 h-3" />
                                PR ***REMOVED***{epic.prNumber}
                              </a>
                            </div>
                            <div className="flex items-center gap-1.5 mt-2">
                              <span className="text-[10px] text-muted-foreground uppercase tracking-wider mr-1">
                                Built by
                              </span>
                              {epic.personas.map((p) => (
                                <PersonaBadge key={p} persona={p} />
                              ))}
                            </div>
                          </div>
                        </div>
                      </button>

                      {/* Expanded content */}
                      {isExpanded && (
                        <div className="border-t border-border/30">
                          {/* Tab bar */}
                          <div className="flex border-b border-border/30 bg-muted/20">
                            <button
                              onClick={() =>
                                setActiveTab((prev) => ({
                                  ...prev,
                                  [epic.id]: "log",
                                }))
                              }
                              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                                tab === "log"
                                  ? "border-primary text-primary"
                                  : "border-transparent text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              <MessageSquare className="w-3.5 h-3.5" />
                              Build Log ({epic.commentCount})
                            </button>
                            <button
                              onClick={() =>
                                setActiveTab((prev) => ({
                                  ...prev,
                                  [epic.id]: "spec",
                                }))
                              }
                              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                                tab === "spec"
                                  ? "border-primary text-primary"
                                  : "border-transparent text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              <FileCode className="w-3.5 h-3.5" />
                              Ticket Specification
                            </button>
                          </div>

                          {/* Content */}
                          <div className="p-4 max-h-[600px] overflow-y-auto">
                            <div className="prose prose-sm prose-invert max-w-none prose-headings:text-foreground prose-p:text-muted-foreground prose-strong:text-foreground prose-code:text-primary prose-code:bg-muted/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-muted/30 prose-pre:border prose-pre:border-border/30 prose-a:text-primary prose-li:text-muted-foreground prose-table:text-muted-foreground prose-th:text-foreground prose-td:text-muted-foreground prose-hr:border-border/30 prose-blockquote:text-muted-foreground prose-blockquote:border-border/50">
                              <ReactMarkdown>
                                {tab === "log"
                                  ? epic.buildLog
                                  : epic.description}
                              </ReactMarkdown>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Quality and sidebar below the board on TeamBoard */}
              <div className="grid md:grid-cols-3 gap-6 mt-8">
                {/* Quality scores */}
                <div>
                  <h2 className="text-lg font-semibold text-foreground mb-4">
                    Quality Gates
                  </h2>
                  <div className="card-elevated border border-border/50 rounded-xl overflow-hidden">
                    {Object.entries(project.qualityScores).map(
                      ([gate, result], i) => (
                        <div
                          key={gate}
                          className={`flex items-center justify-between px-4 py-3 ${
                            i <
                            Object.keys(project.qualityScores).length - 1
                              ? "border-b border-border/30"
                              : ""
                          }`}
                        >
                          <span className="text-sm text-foreground capitalize">
                            {gate}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                            <span className="text-xs text-green-500 font-medium">
                              {result}
                            </span>
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                </div>

                {/* Personas used */}
                <div>
                  <h2 className="text-lg font-semibold text-foreground mb-4">
                    AI Experts
                  </h2>
                  <div className="card-elevated border border-border/50 rounded-xl p-4">
                    <div className="flex flex-wrap gap-2">
                      {project.personasUsed.map((persona) => (
                        <PersonaBadge key={persona} persona={persona} />
                      ))}
                    </div>
                  </div>
                </div>

                {/* About */}
                <div>
                  <h2 className="text-lg font-semibold text-foreground mb-4">
                    About
                  </h2>
                  <div className="card-elevated border border-border/50 rounded-xl p-4">
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {project.description}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
          <div className="lg:col-span-2">
            <h2 className="text-xl font-semibold text-foreground mb-6">
              Story Timeline
            </h2>
            <div className="space-y-3">
              {project.stories.map((story, i) => (
                <div
                  key={i}
                  className="card-elevated border border-border/50 rounded-xl p-4 flex items-center gap-4"
                >
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground">
                      {story.title}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <PersonaBadge persona={story.persona} />
                      {story.duration && (
                        <span className="text-xs text-muted-foreground">
                          {story.duration}
                        </span>
                      )}
                    </div>
                  </div>
                  {story.cost && (
                    <div className="flex-shrink-0 text-sm font-medium text-green-500">
                      {story.cost}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Sidebar — 1/3 width */}
          <div className="space-y-6">
            {/* Quality scores */}
            <div>
              <h2 className="text-xl font-semibold text-foreground mb-4">
                Quality Gates
              </h2>
              <div className="card-elevated border border-border/50 rounded-xl overflow-hidden">
                {Object.entries(project.qualityScores).map(
                  ([gate, result], i) => (
                    <div
                      key={gate}
                      className={`flex items-center justify-between px-4 py-3 ${
                        i < Object.keys(project.qualityScores).length - 1
                          ? "border-b border-border/30"
                          : ""
                      }`}
                    >
                      <span className="text-sm text-foreground capitalize">
                        {gate}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                        <span className="text-xs text-green-500 font-medium">
                          {result}
                        </span>
                      </div>
                    </div>
                  ),
                )}
              </div>
            </div>

            {/* Personas used */}
            <div>
              <h2 className="text-xl font-semibold text-foreground mb-4">
                AI Experts
              </h2>
              <div className="card-elevated border border-border/50 rounded-xl p-4">
                <div className="flex flex-wrap gap-2">
                  {project.personasUsed.map((persona) => (
                    <PersonaBadge key={persona} persona={persona} />
                  ))}
                </div>
              </div>
            </div>

            {/* Description */}
            <div>
              <h2 className="text-xl font-semibold text-foreground mb-4">
                About
              </h2>
              <div className="card-elevated border border-border/50 rounded-xl p-4">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {project.description}
                </p>
              </div>
            </div>
          </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

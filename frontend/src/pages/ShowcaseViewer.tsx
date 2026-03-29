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
  BarChart3,
  Users,
  ChevronDown,
  GitPullRequest,
  AlertTriangle,
  MessageSquare,
  FileCode,
  Rocket,
  Calendar,
  Terminal,
  BookOpen,
} from "lucide-react";
import { teamBoardEpics, teamBoardPrd } from "../data/teamboard-showcase-data";
import { taskPulseEpics, taskPulsePrd } from "../data/taskpulse-showcase-data";
import { calMillEpics, calMillPrd } from "../data/calmill-showcase-data";
import { shipApiEpics, shipApiPrd } from "../data/shipapi-showcase-data";
import { flagDeckEpics, flagDeckPrd } from "../data/flagdeck-showcase-data";
import { onCallShiftEpics } from "../data/oncallshift-showcase-data";

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
  linesOfCode?: string;
  repoUrl?: string;
  liveUrl?: string;
  category: string;
  personasUsed: string[];
  qualityScores: QualityScores;
  stories: ShowcaseStory[];
  icon: React.ReactNode;
}

const showcaseData: Record<string, ShowcaseDetail> = {
  flagdeck: {
    id: "flagdeck",
    name: "FlagDeck",
    tagline:
      "Feature flag platform — built across 3 sequential epics by AI workers.",
    description:
      "Full-stack feature flag and experimentation platform with Go/Fiber API, SvelteKit 2 dashboard (Svelte 5 runes), MongoDB document models, Redis caching, JWT + API key authentication, targeting rules, percentage rollouts, A/B experiments, and Docker deployment. Claude Sonnet built the code across 7 expert personas; Claude Opus planned each epic and reviewed all work as tech lead. 3 epics executed sequentially — backend, frontend, deployment — each building on the last. 67 commits, 20.8K lines across 110 files. Deployed to Railway at flagdeck-app.workermill.com.",
    stack: "Go + SvelteKit 2 + MongoDB + Redis",
    storyCount: 21,
    cost: "$64",
    duration: "~285 min",
    linesOfCode: "20,800",
    repoUrl: "https://github.com/workermill-examples/flagdeck",
    liveUrl: "https://flagdeck-app.workermill.com",
    category: "developer-tools",
    personasUsed: [
      "backend_developer",
      "frontend_developer",
      "devops_engineer",
      "security_engineer",
      "qa_engineer",
      "integration_specialist",
      "tech_writer",
    ],
    qualityScores: {
      lint: "0 errors",
      types: "0 errors (go vet + svelte-check)",
      tests: "Go unit tests (race detector)",
      security: "0 critical",
    },
    stories: [],
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
    cost: "$241",
    duration: "~461 min",
    linesOfCode: "28,000",
    repoUrl: "https://github.com/workermill-examples/teamboard",
    liveUrl: "https://teamboard.workermill.com",
    category: "saas",
    personasUsed: [
      "backend_developer",
      "frontend_developer",
      "qa_engineer",
      "devops_engineer",
      "backend_developer",
    ],
    qualityScores: {
      lint: "0 errors",
      types: "0 errors (3342 → 0)",
      tests: "280 unit + 120 E2E",
      security: "0 critical",
    },
    stories: [],
    icon: <Globe className="w-5 h-5" />,
  },
  taskpulse: {
    id: "taskpulse",
    name: "TaskPulse",
    tagline:
      "Background task monitoring dashboard — built across 5 sequential epics by AI workers.",
    description:
      "Full-stack task monitoring platform with cron scheduling, API key management, real-time run tracking, keyboard shortcuts, and global search. 5 epics executed sequentially, each building on the last. Deployed to Vercel at taskpulse.workermill.com.",
    stack: "Next.js 16 + Prisma 7 + TailwindCSS v4 + Neon PostgreSQL",
    storyCount: 36,
    cost: "$139",
    duration: "~310 min",
    linesOfCode: "17,000",
    repoUrl: "https://github.com/workermill-examples/taskpulse",
    liveUrl: "https://taskpulse.workermill.com",
    category: "monitoring",
    personasUsed: [
      "backend_developer",
      "frontend_developer",
      "qa_engineer",
      "devops_engineer",
      "security_engineer",
    ],
    qualityScores: {
      lint: "0 errors",
      types: "0 errors",
      tests: "74 unit + 66 E2E",
      security: "0 critical",
    },
    stories: [],
    icon: <BarChart3 className="w-5 h-5" />,
  },
  calmill: {
    id: "calmill",
    name: "CalMill",
    tagline:
      "Open scheduling platform — built across 3 epics by AI workers.",
    description:
      "Full-stack scheduling platform with Next.js 16, Prisma 7, and Neon PostgreSQL. Event types, timezone-aware booking, team round-robin scheduling, availability management, webhook integrations, and public booking pages. 3 epics, 48 stories. Deployed to Vercel at calmill.workermill.com.",
    stack: "Next.js 16 + Prisma 7 + TailwindCSS 4 + Neon PostgreSQL",
    storyCount: 48,
    cost: "$247",
    duration: "~717 min",
    linesOfCode: "41,000",
    repoUrl: "https://github.com/workermill-examples/calmill",
    liveUrl: "https://calmill.workermill.com",
    category: "scheduling",
    personasUsed: [
      "backend_developer",
      "frontend_developer",
      "qa_engineer",
      "devops_engineer",
      "security_engineer",
    ],
    qualityScores: {
      lint: "0 errors",
      types: "0 errors",
      tests: "248 unit + E2E",
      security: "0 critical",
    },
    stories: [],
    icon: <Calendar className="w-5 h-5" />,
  },
  shipapi: {
    id: "shipapi",
    name: "ShipAPI",
    tagline:
      "Full-stack inventory management system — built across 5 epics by AI workers.",
    description:
      "Production-grade inventory management system with React 19 dashboard and FastAPI backend. JWT + API key authentication, full-text search, atomic stock transfers, audit logging, rate limiting, 174 tests, CI pipeline, and Swagger/ReDoc documentation. React dashboard with charts, data tables, and CRUD dialogs. 5 epics, all deployed. Live on Railway.",
    stack: "FastAPI + SQLAlchemy 2 + React 19 + Neon PostgreSQL",
    storyCount: 38,
    cost: "$123",
    duration: "~297 min",
    linesOfCode: "20,200",
    repoUrl: "https://github.com/workermill-examples/shipapi",
    liveUrl: "https://shipapi.workermill.com",
    category: "api",
    personasUsed: [
      "backend_developer",
      "frontend_developer",
      "qa_engineer",
      "devops_engineer",
    ],
    qualityScores: {
      lint: "0 errors",
      types: "0 errors (mypy strict)",
      tests: "174 tests",
      security: "0 critical",
    },
    stories: [],
    icon: <Terminal className="w-5 h-5" />,
  },
  oncallshift: {
    id: "oncallshift",
    name: "OnCallShift",
    tagline:
      "Production incident management platform — 195K lines, built entirely by WorkerMill.",
    description:
      "Production incident management platform: on-call scheduling, alert routing, escalation policies, real-time dashboards, mobile app, and Terraform infrastructure. 60+ database models, 35+ API routes, 60 frontend pages, 32 mobile screens, MCP server, and Terraform provider. 195K lines of TypeScript and Go across 573 files. Deployed to AWS at oncallshift.com.",
    stack: "Express + TypeScript + React + React Native + Terraform",
    storyCount: 24,
    cost: "$1,206",
    duration: "~18 hrs",
    linesOfCode: "195,000",
    liveUrl: "https://oncallshift.com",
    repoUrl: "https://github.com/jarod-rosenthal/oncallshift",
    category: "incident-management",
    personasUsed: [
      "backend_developer",
      "frontend_developer",
      "devops_engineer",
      "security_engineer",
      "qa_engineer",
    ],
    qualityScores: {
      lint: "0 errors",
      types: "0 errors",
      tests: "22 unit + 13 E2E",
      security: "0 critical",
    },
    stories: [],
    icon: <Zap className="w-5 h-5" />,
  },
};

const personaLabels: Record<string, { label: string; color: string }> = {
  backend_developer: { label: "Backend", color: "text-blue-400" },
  frontend_developer: { label: "Frontend", color: "text-purple-400" },
  devops_engineer: { label: "DevOps", color: "text-orange-400" },
  security_engineer: { label: "Security", color: "text-red-400" },
  qa_engineer: { label: "QA", color: "text-green-400" },
  tech_writer: { label: "Docs", color: "text-cyan-400" },
  integration_specialist: { label: "Integration", color: "text-indigo-400" },
  architect: { label: "Architect", color: "text-violet-400" },
  data_ml_engineer: { label: "Data/ML", color: "text-teal-400" },
  mobile_developer: { label: "Mobile", color: "text-green-400" },
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
  const isOnCallShift = projectId === "oncallshift";
  const isTeamBoard = projectId === "teamboard";
  const isTaskPulse = projectId === "taskpulse";
  const isCalMill = projectId === "calmill";
  const isShipApi = projectId === "shipapi";
  const isFlagDeck = projectId === "flagdeck";
  const isEpicBoard =
    isTeamBoard || isTaskPulse || isCalMill || isShipApi || isFlagDeck || isOnCallShift;
  const epicBoardData = isTeamBoard
    ? teamBoardEpics
    : isCalMill
      ? calMillEpics
      : isShipApi
        ? shipApiEpics
        : isFlagDeck
          ? flagDeckEpics
          : isOnCallShift
            ? onCallShiftEpics
            : taskPulseEpics;
  const [expandedEpic, setExpandedEpic] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Record<string, "spec" | "log">>(
    {},
  );
  const [prdExpanded, setPrdExpanded] = useState(false);

  if (!project) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-4">
            Project not found
          </h1>
          <Link
            to="/#showcase"
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
            to="/#showcase"
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
            {project.repoUrl && (
              <a
                href={project.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 transition-colors text-foreground"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View repo
              </a>
            )}
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

          {/* AI Model Attribution */}
          <div className="mt-6 flex flex-wrap gap-4">
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-violet-500/10 border border-violet-500/20">
              <div className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center">
                <Zap className="w-4 h-4 text-violet-400" />
              </div>
              <div>
                <div className="text-sm font-semibold text-violet-300">Claude Sonnet</div>
                <div className="text-xs text-muted-foreground">Code generation across {project.personasUsed.length} expert personas</div>
              </div>
            </div>
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <BookOpen className="w-4 h-4 text-amber-400" />
              </div>
              <div>
                <div className="text-sm font-semibold text-amber-300">Claude Opus</div>
                <div className="text-xs text-muted-foreground">Epic planning & tech lead review</div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div
          className={`grid grid-cols-2 gap-4 mb-12 ${isEpicBoard ? "md:grid-cols-5" : "md:grid-cols-4"}`}
        >
          {(isEpicBoard || project.linesOfCode) && (
            <div className="card-elevated border border-border/50 rounded-xl p-5">
              <div className="flex items-center gap-2 text-2xl font-bold text-foreground">
                <FileCode className="w-5 h-5 text-muted-foreground" />
                {project.linesOfCode
                  ? project.linesOfCode
                  : isOnCallShift
                    ? "177K"
                    : "N/A"}
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
                  est. API token cost
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

        <div className={isEpicBoard ? "" : "grid lg:grid-cols-3 gap-8"}>
          {/* Epic board view for TeamBoard/TaskPulse, story timeline for others */}
          {isEpicBoard ? (
            <div className="mb-8">
              {/* Product Specification — projects with PRDs */}
              {(isFlagDeck || isTeamBoard || isCalMill || isTaskPulse || isShipApi) && (
                <div className="mb-6">
                  <div
                    className="card-elevated border border-border/50 rounded-xl overflow-hidden"
                  >
                    <button
                      onClick={() => setPrdExpanded(!prdExpanded)}
                      className="w-full text-left p-4 hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <ChevronDown
                          className={`w-4 h-4 text-muted-foreground transition-transform flex-shrink-0 ${
                            prdExpanded ? "rotate-0" : "-rotate-90"
                          }`}
                        />
                        <BookOpen className="w-4 h-4 text-primary" />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-semibold text-foreground">
                            Product Specification
                          </span>
                          <span className="ml-2 text-xs text-muted-foreground">
                            — the original PRD that defined this build
                          </span>
                        </div>
                      </div>
                    </button>
                    {prdExpanded && (
                      <div className="border-t border-border/30 p-4 max-h-[700px] overflow-y-auto">
                        <div className="prose prose-sm prose-invert max-w-none prose-headings:text-foreground prose-p:text-muted-foreground prose-strong:text-foreground prose-code:text-primary prose-code:bg-muted/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-muted/30 prose-pre:border prose-pre:border-border/30 prose-a:text-primary prose-li:text-muted-foreground prose-table:text-muted-foreground prose-th:text-foreground prose-td:text-muted-foreground prose-hr:border-border/30 prose-blockquote:text-muted-foreground prose-blockquote:border-border/50">
                          <ReactMarkdown>{isTeamBoard ? teamBoardPrd : isCalMill ? calMillPrd : isTaskPulse ? taskPulsePrd : isShipApi ? shipApiPrd : isOnCallShift ? "" : flagDeckPrd}</ReactMarkdown>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 mb-6">
                <h2 className="text-xl font-semibold text-foreground">
                  Build Log
                </h2>
                <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full">
                  {epicBoardData.length} epics &middot;{" "}
                  {epicBoardData.reduce((sum, e) => sum + e.commentCount, 0)}{" "}
                  comments
                </span>
              </div>

              <div className="space-y-3">
                {epicBoardData.map((epic) => {
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
                              {epic.status === "deployed" ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/10 text-blue-500">
                                  <Rocket className="w-3 h-3" />
                                  Deployed
                                </span>
                              ) : epic.status === "completed" ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-500/10 text-green-500">
                                  <CheckCircle className="w-3 h-3" />
                                  PR Approved
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
                                PR #{epic.prNumber}
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

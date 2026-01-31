import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  RefreshCw,
  ExternalLink,
  CheckCircle,
  XCircle,
  Clock,
  DollarSign,
  AlertCircle,
  Activity,
  Terminal,
  GitBranch,
  LogOut,
  Play,
  Power,
  Trash2,
  Ban,
  Zap,
  Book,
  Layers,
  GitFork,
  Settings,
  Cog,
  GitPullRequest,
  Users,
  User,
  Eye,
  X,
  Rocket,
  GitMerge,
  Pause,
  Search,
  ChevronDown,
  Wrench,
  Sliders,
  Star,
  RotateCcw,
  LayoutDashboard,
  Send,
  FolderKanban,
  BarChart3,
  PauseCircle,
  Network,
  MessageSquare,
  Wifi,
  WifiOff,
  Sparkles,
  Brain,
  BookOpen,
  TrendingUp,
  AlertTriangle,
  Target,
} from "lucide-react";
import { RalphProgress, RalphProgressCompact } from "../components/RalphProgress";
import { ProfileDropdown } from "../components/ProfileDropdown";
import { TerminalLogViewer } from "../components/TerminalLogViewer";
import { CheckpointStatus, CheckpointStatusBadge } from "../components/CheckpointStatus";
import { LogSearch } from "../components/LogSearch";
import { OrgSwitcher } from "../components/OrgSwitcher";
import { useAuthStore } from "../store/auth-store";
import { OnboardingWizard, useOnboardingState } from "../components/OnboardingWizard";
import { DashboardSkeleton } from "../components/ui/skeleton";
import {
  ErrorBoundaryWithRetry,
  DashboardErrorFallback,
} from "../components/ErrorBoundary";
import { EmbeddedDependencyGraph } from "../components/DependencyGraph";
import { useCoordinationStore, type ContextMessage, type ContextMessageType } from "../store/coordination-store";
import { TokenBreakdown } from "../components/TokenBreakdown";
import {
  PlanningIcon,
  ApprovedIcon,
  ExpertsIcon,
  PRCreatedIcon,
  ReviewIcon,
  DeployedIcon,
} from "../components/icons";

// Terminal statuses - tasks in these states are considered "finished" and their terminals are collapsed by default
const TERMINAL_STATUSES = [
  "completed",
  "deployed",
  "failed",
  "cancelled",
  "pr_approved",
  "review_approved",
  "blocked",
  "escalated",
];

interface ControlCenterStats {
  totalWorkers: number;
  activeWorkers: number;
  queueDepth: number;
  periodCost: number;
  periodCompleted: number;
  periodFailed: number;
  cumulativeCost: number;
  countersResetAt: string | null;
}

interface WorkerTask {
  id: string;
  jiraKey: string;
  summary: string;
  status: string;
  retryCount: number;
  maxRetries: number;
}

interface Worker {
  id: string;
  displayName: string;
  persona: string;
  status: string;
  tasksCompleted: number;
  tasksFailed: number;
  totalCostUsd: number;
  currentTask: WorkerTask | null;
}

interface TaskStep {
  name: string;
  status: "done" | "active" | "pending" | "waiting";
  icon: "queued" | "executing" | "pr_created" | "review" | "complete" | "deployed" | "manager_review" | "waiting" | "approved" | "deploying" | "experts" | "coordinating" | "epic" | "planning";
  isParallelStage?: boolean;
}

type WorkflowMode = "default" | "review" | "auto_deploy" | "manager" | "review_manager" | "deploy_manager";

interface TaskLog {
  timestamp: string;
  message: string;
  type: string;
  severity: string;
}

interface RalphProgressData {
  currentStory: number;
  totalStories: number;
  currentStoryDescription: string;
  completedStories?: number;
  status?: "planning" | "executing" | "completed" | "failed" | "unknown";
}

interface ActiveTask {
  id: string;
  jiraIssueKey: string;
  summary: string;
  status: string;
  workerName: string;
  workerPersona: string;
  workerModel?: string;
  workerProvider?: string;
  providersUsed?: string[] | null;
  retryCount: number;
  maxRetries: number;
  estimatedCostUsd: number;
  startedAt: string | null;
  completedAt?: string | null;
  createdAt: string;
  hasPr?: boolean;
  githubPrUrl?: string | null;
  githubRepo?: string;
  recentLogs: TaskLog[];
  steps: TaskStep[];
  // Workflow mode fields
  workflowMode?: WorkflowMode;
  workflowModeName?: string;
  managerEnabled?: boolean;
  revisionCount?: number;
  reviewFeedback?: string;
  // Manager task info
  managerEcsTaskId?: string | null;
  // Manager provider tracking (which AI provider performed the review)
  managerProvider?: string | null;
  managerModel?: string | null;
  // Ralph execution info
  isRalphTask?: boolean;
  ralphProgress?: RalphProgressData | null;
  // Checkpoint info (Phase 5)
  hasCheckpoint?: boolean;
  checkpointStage?: string | null;
  resumeCount?: number;
  checkpointSavedAt?: string | null;
  // Plan approval (PRD orchestration)
  planJson?: {
    // V1 Plan fields
    strategy?: "single" | "multi";
    reasoning?: string;
    primaryPersona?: string;
    stories?: Array<{
      index: number;
      title: string;
      persona: string;
      scope: string;
      acceptanceCriteria: string[];
      dependencies: number[];
      estimatedComplexity: "small" | "medium" | "large";
    }>;
    qualityGates?: string[];
    // V2 Plan fields (multi-persona steps)
    steps?: Array<{
      index: number;
      title: string;
      description: string;
      persona: string;
      verificationType: string;
      verificationInstructions: string;
      targetFiles: string[];
      referenceFiles?: string[];
      estimatedComplexity?: number;
    }>;
    architecturalSummary?: string;
    techStack?: {
      language: string;
      framework: string;
    };
    // Planning metadata (from Planner-Critic agent)
    metadata?: {
      plannerModel?: string;
      criticModel?: string;
      llmCalls?: number;
      planningDurationMs?: number;
      iterationCount?: number;
      approvalMethod?: "auto" | "human";
      generatedAt?: string;
    };
  } | null;
  planStatus?: string | null;
  planFeedback?: string | null;
  // Parent task info
  childTaskIds?: string[];
  parentTaskId?: string | null;
  // Pipeline version (v2 = Epic/multi-expert mode)
  pipelineVersion?: "v1" | "v2" | null;
  // Epic workflow info (from API)
  isEpicWorkflow?: boolean;
  executionMode?: "single" | "parallel" | "multi-expert";
  // Epic progress (calculated from child tasks)
  epicProgress?: number;
  storiesCompleted?: number;
  storiesTotal?: number;
  storiesFailed?: number;
  // Task-level error details (for failed tasks)
  errorMessage?: string | null;
  // Real-time cost tracking
  costTrend?: "up" | undefined;
  costCeilingPercent?: number;
}

interface CompletedTask {
  id: string;
  jiraIssueKey: string;
  summary: string;
  status: string;
  workerModel?: string;
  workerPersona?: string;
  workerProvider?: string;
  providersUsed?: string[] | null;
  costUsd: number;
  durationMinutes: number | null;
  startedAt: string | null;
  createdAt: string;
  completedAt: string | null;
  githubPrUrl: string | null;
  ecsTaskId: string | null;
  retryCount?: number;
  revisionCount?: number;
  errorMessage?: string;
  // Quality metrics
  qualityScore?: number | null;
  qualityGrade?: string | null;
  // Workflow mode fields
  workflowMode?: WorkflowMode;
  workflowModeName?: string;
  managerEnabled?: boolean;
  // Manager provider tracking (which AI provider performed the review)
  managerProvider?: string | null;
  managerModel?: string | null;
  // Heartbeat tracking
  lastHeartbeatAt?: string | null;
  // Planning metadata (for provider derivation)
  planJson?: {
    metadata?: {
      plannerModel?: string;
      criticModel?: string;
    };
  } | null;
}

interface ManagerStatus {
  enabled: boolean;
  modelId: string;
  reviewCount: number;
  approvalRate: number;
  queue: {
    awaitingReview: number;
    underReview: number;
    revisionNeeded: number;
  };
  stats?: {
    totalReviews: number;
    approved: number;
    rejected: number;
    revisionsRequested: number;
    avgDurationSeconds: number;
    totalCost: number;
  };
}

interface WatcherStatus {
  enabled: boolean;
  lastRunAt: string | null;
  stuckTasks: number;
  pendingRetries: number;
}

interface SystemStatus {
  systemEnabled: boolean;
  orchestrator: { running: boolean; desiredCount: number };
  executors: { running: number };
}

interface ControlCenterData {
  stats: ControlCenterStats;
  workers: Worker[];
  activeTasks: ActiveTask[];
  queuedTasks: ActiveTask[];
  recentCompleted: CompletedTask[];
  managerStatus?: ManagerStatus;
  systemStatus?: SystemStatus;
  watcherStatus?: WatcherStatus;
}

const API_BASE = import.meta.env.VITE_API_URL || "";

// Full Claude model options with exact version names (Anthropic official models only)
const MODEL_OPTIONS = [
  { value: "claude-opus-4-5-20251101", label: "Claude Opus 4.5", shortLabel: "Opus 4.5" },
  { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5", shortLabel: "Sonnet 4.5" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", shortLabel: "Haiku 4.5" },
];

// Persona definitions with full details
const PERSONA_CONFIG: Record<
  string,
  { emoji: string; title: string; description: string; skills: string[] }
> = {
  frontend_developer: {
    emoji: "🎨",
    title: "Frontend Developer",
    description: "UI/UX implementation, React components, styling",
    skills: ["React", "TypeScript", "Tailwind CSS", "Accessibility"],
  },
  backend_developer: {
    emoji: "⚙️",
    title: "Backend Developer",
    description: "API development, database design, server logic",
    skills: ["Node.js", "Express", "PostgreSQL", "REST APIs"],
  },
  api_developer: {
    emoji: "🔌",
    title: "API Developer",
    description: "REST/GraphQL APIs, OpenAPI specs, SDK generation",
    skills: ["OpenAPI", "GraphQL", "REST", "Postman"],
  },
  devops_engineer: {
    emoji: "🔧",
    title: "DevOps Engineer",
    description: "Infrastructure, CI/CD, deployment automation",
    skills: ["Terraform", "AWS", "Docker", "GitHub Actions"],
  },
  security_engineer: {
    emoji: "🔒",
    title: "Security Engineer",
    description: "Security audits, vulnerability fixes, compliance",
    skills: ["OWASP", "Penetration Testing", "IAM", "Encryption"],
  },
  qa_engineer: {
    emoji: "🧪",
    title: "QA Engineer",
    description: "Test writing, quality assurance, bug verification",
    skills: ["Jest", "Playwright", "Test Design", "Bug Triage"],
  },
  database_administrator: {
    emoji: "🗄️",
    title: "Database Administrator",
    description: "Database optimization, migrations, data modeling",
    skills: ["PostgreSQL", "MySQL", "Query Optimization", "Indexing"],
  },
  data_engineer: {
    emoji: "📊",
    title: "Data Engineer",
    description: "Data pipelines, ETL processes, analytics infrastructure",
    skills: ["dbt", "Airflow", "Snowflake", "BigQuery"],
  },
  ml_engineer: {
    emoji: "🤖",
    title: "ML Engineer",
    description: "Machine learning models, training pipelines, AI integration",
    skills: ["PyTorch", "MLflow", "SageMaker", "scikit-learn"],
  },
  mobile_developer_ios: {
    emoji: "🍎",
    title: "iOS Developer",
    description: "Swift/SwiftUI apps, iOS frameworks, App Store deployment",
    skills: ["Swift", "SwiftUI", "Xcode", "Core Data"],
  },
  mobile_developer_android: {
    emoji: "📱",
    title: "Android Developer",
    description: "Kotlin/Jetpack apps, Android SDK, Play Store deployment",
    skills: ["Kotlin", "Jetpack Compose", "Room", "Material Design"],
  },
  tech_lead: {
    emoji: "🎯",
    title: "Tech Lead",
    description: "Architecture decisions, code reviews, technical strategy",
    skills: ["System Design", "Code Review", "Technical Strategy", "Mentorship"],
  },
  tech_writer: {
    emoji: "📝",
    title: "Technical Writer",
    description: "Documentation, API docs, user guides",
    skills: ["Markdown", "API Documentation", "User Guides"],
  },
  project_manager: {
    emoji: "📋",
    title: "Project Manager",
    description: "Task planning, coordination, status updates",
    skills: ["Jira", "Project Planning", "Stakeholder Management"],
  },
  manager: {
    emoji: "👔",
    title: "Virtual Manager",
    description: "Reviews PRs from workers, provides feedback, approves or requests revisions",
    skills: ["Code Review", "Quality Assurance", "Feedback", "Approval Workflow"],
  },
};

// Persona config for embedded communications (short labels)
const COMMS_PERSONA_CONFIGS: Record<string, { emoji: string; shortLabel: string }> = {
  frontend_developer: { emoji: "🎨", shortLabel: "Frontend" },
  backend_developer: { emoji: "⚙️", shortLabel: "Backend" },
  api_developer: { emoji: "🔌", shortLabel: "API" },
  devops_engineer: { emoji: "🔧", shortLabel: "DevOps" },
  security_engineer: { emoji: "🔒", shortLabel: "Security" },
  qa_engineer: { emoji: "🧪", shortLabel: "QA" },
  database_administrator: { emoji: "🗄️", shortLabel: "DBA" },
  data_engineer: { emoji: "📊", shortLabel: "Data" },
  ml_engineer: { emoji: "🤖", shortLabel: "ML" },
  mobile_developer_ios: { emoji: "🍎", shortLabel: "iOS" },
  mobile_developer_android: { emoji: "📱", shortLabel: "Android" },
  tech_lead: { emoji: "🎯", shortLabel: "Tech Lead" },
  tech_writer: { emoji: "📝", shortLabel: "Docs" },
  project_manager: { emoji: "📋", shortLabel: "PM" },
  manager: { emoji: "👔", shortLabel: "Manager" },
};

// Message type config for embedded communications
const COMMS_MESSAGE_TYPE_CONFIG: Record<ContextMessageType, { emoji: string; color: string }> = {
  file_created: { emoji: "📁", color: "text-green-500" },
  file_modified: { emoji: "📝", color: "text-blue-500" },
  decision: { emoji: "🔀", color: "text-cyan-500" },
  dependency: { emoji: "📋", color: "text-yellow-500" },
  question: { emoji: "❓", color: "text-yellow-500" },
  answer: { emoji: "💬", color: "text-blue-500" },
  completion: { emoji: "✅", color: "text-green-500" },
  blocker: { emoji: "🚫", color: "text-red-500" },
  warning: { emoji: "⚠️", color: "text-yellow-500" },
  progress: { emoji: "📊", color: "text-muted-foreground" },
  story_ready: { emoji: "📖", color: "text-purple-500" },
  story_claimed: { emoji: "👤", color: "text-cyan-500" },
  consultation: { emoji: "🤝", color: "text-purple-500" },
  constraints: { emoji: "📋", color: "text-blue-500" },
  revision_requested: { emoji: "🔄", color: "text-yellow-500" },
};

// Embedded Communications Feed - compact version for the side panel
function EmbeddedCommunicationsFeed({
  taskId,
  onNewMessage,
  onAnswerQuestion,
}: {
  taskId: string;
  onNewMessage?: () => void;
  onAnswerQuestion?: (messageId: string, answer: string) => void;
}) {
  const feedRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const fetchedRef = useRef(false);
  const [isConnected, setIsConnected] = useState(false);
  const prevMessageCountRef = useRef(0);
  // State for answering questions
  const [answeringMessageId, setAnsweringMessageId] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState("");

  // Get store methods
  const messages = useCoordinationStore((s) => s.messages);
  const addMessage = useCoordinationStore((s) => s.addMessage);
  const getMessagesForParentTask = useCoordinationStore((s) => s.getMessagesForParentTask);

  // Filter messages for this specific task
  const taskMessages = messages.filter((m) => m.parentTaskId === taskId);

  // Detect new messages and trigger callback
  useEffect(() => {
    if (taskMessages.length > prevMessageCountRef.current && prevMessageCountRef.current > 0) {
      // New message arrived (and not initial load)
      onNewMessage?.();
    }
    prevMessageCountRef.current = taskMessages.length;
  }, [taskMessages.length, onNewMessage]);

  // Important types to highlight
  const importantTypes: ContextMessageType[] = ["decision", "question", "answer", "blocker", "completion", "consultation"];

  // Build set of answered question IDs (check if any answer references this question)
  const answeredQuestionIds = new Set<string>();
  for (const msg of taskMessages) {
    if (msg.messageType === "answer" && msg.metadata?.questionId) {
      answeredQuestionIds.add(msg.metadata.questionId as string);
    }
  }

  // Handle submitting an answer
  const handleSubmitAnswer = (messageId: string) => {
    if (answerText.trim() && onAnswerQuestion) {
      onAnswerQuestion(messageId, answerText.trim());
      setAnswerText("");
      setAnsweringMessageId(null);
    }
  };

  // Fetch existing messages
  useEffect(() => {
    if (fetchedRef.current) return;

    const existingMessages = getMessagesForParentTask(taskId);
    if (existingMessages.length > 0) {
      fetchedRef.current = true;
      return;
    }

    const fetchMessages = async () => {
      const token = localStorage.getItem("accessToken");
      if (!token) return;

      fetchedRef.current = true;
      try {
        const response = await fetch(
          `${API_BASE}/api/coordination/context/${taskId}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (response.ok) {
          const data = await response.json();
          const contexts = data.contexts || (Array.isArray(data) ? data : []);
          contexts.forEach((msg: ContextMessage) => {
            addMessage(msg, taskId);
          });
        }
      } catch (err) {
        console.error("Failed to fetch coordination messages:", err);
        fetchedRef.current = false;
      }
    };
    fetchMessages();
  }, [taskId, addMessage, getMessagesForParentTask]);

  // Connect to SSE stream
  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    if (!token) return;

    const url = `${API_BASE}/api/coordination/context/${taskId}/stream?token=${encodeURIComponent(token)}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => setIsConnected(true);
    eventSource.addEventListener("context", (event) => {
      try {
        const msg = JSON.parse(event.data) as ContextMessage;
        addMessage(msg, taskId);
      } catch (err) {
        console.error("Failed to parse context message:", err);
      }
    });
    eventSource.onerror = () => setIsConnected(false);

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [taskId, addMessage]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [taskMessages.length]);

  // Clean message content (remove JSON artifacts)
  const cleanContent = (content: string): string => {
    if (!content) return content;
    let cleaned = content;
    cleaned = cleaned.replace(/\{[^{}]*"(?:type|input_tokens|output_tokens)"[^{}]*\}/g, "");
    cleaned = cleaned.replace(/\s*\{[^{}]*\}\s*$/g, "");
    cleaned = cleaned.trim();
    return cleaned || content;
  };

  const formatTime = (timestamp: string): string => {
    return new Date(timestamp).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  return (
    <div className="h-96 flex flex-col">
      {/* Header with connection status */}
      <div className="px-3 py-2 border-b border-border/30 flex items-center justify-between bg-muted/30">
        <span className="text-xs text-muted-foreground">
          {taskMessages.length} message{taskMessages.length !== 1 ? "s" : ""}
        </span>
        {isConnected ? (
          <span className="flex items-center gap-1 text-xs text-green-500">
            <Wifi className="w-3 h-3" /> Live
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-yellow-500">
            <WifiOff className="w-3 h-3" /> Connecting...
          </span>
        )}
      </div>

      {/* Messages */}
      <div ref={feedRef} className="flex-1 overflow-y-auto">
        {taskMessages.length === 0 ? (
          <div className="p-4 text-center">
            <MessageSquare className="w-6 h-6 mx-auto mb-2 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">No communications yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Expert collaboration messages will appear here
            </p>
          </div>
        ) : (
          taskMessages.map((msg) => {
            const typeConfig = COMMS_MESSAGE_TYPE_CONFIG[msg.messageType];
            const personaConfig = COMMS_PERSONA_CONFIGS[msg.persona];
            const isImportant = importantTypes.includes(msg.messageType);
            const cleanedContent = cleanContent(msg.content);
            const isQuestion = msg.messageType === "question" || msg.messageType === "consultation";
            // Check if this question has been answered - answers reference the question's msg.id in metadata.questionId
            const hasAnswer = isQuestion && answeredQuestionIds.has(msg.id);
            const suggestedAnswers = (msg.metadata?.suggestedAnswers as string[]) || [];
            // Human-readable question ID for display (e.g., "Q-BACKEND-001")
            const displayQuestionId = msg.metadata?.questionId as string | undefined;

            // Render question messages with answer UI
            if (isQuestion) {
              return (
                <div
                  key={msg.id}
                  className="px-3 py-2 border-b border-border/30 bg-yellow-500/5"
                >
                  {/* Header */}
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {formatTime(msg.createdAt)}
                    </span>
                    <span className="text-xs text-yellow-500 font-medium">
                      ⚠️ {personaConfig?.shortLabel || msg.persona}
                    </span>
                    {hasAnswer && (
                      <span className="text-xs text-green-500 font-medium">✓ Answered</span>
                    )}
                  </div>
                  {/* Question Card */}
                  <div className="bg-muted/50 border border-border/50 rounded-md p-2">
                    <div className="flex items-start gap-2">
                      <span className={hasAnswer ? "text-green-500" : "text-yellow-500"}>
                        {hasAnswer ? "✅" : "❓"}
                      </span>
                      <div className="flex-1">
                        <span className="text-xs text-foreground font-medium">
                          {displayQuestionId ? `${displayQuestionId}:` : "QUESTION:"}
                        </span>
                        <p className="text-xs text-muted-foreground mt-1">
                          {cleanedContent}
                        </p>
                      </div>
                    </div>

                    {/* Answer Buttons - only show if not answered and handler provided */}
                    {!hasAnswer && onAnswerQuestion && answeringMessageId !== msg.id && (
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {suggestedAnswers.map((answer, idx) => (
                          <button
                            key={idx}
                            onClick={() => onAnswerQuestion(msg.id, answer)}
                            className="px-2 py-0.5 text-[10px] font-medium bg-muted border border-border rounded hover:bg-muted/80 hover:border-primary/50 transition-colors"
                          >
                            {answer}
                          </button>
                        ))}
                        <button
                          onClick={() => setAnsweringMessageId(msg.id)}
                          className="px-2 py-0.5 text-[10px] font-medium text-primary bg-transparent border border-primary rounded hover:bg-primary hover:text-primary-foreground transition-colors"
                        >
                          Answer...
                        </button>
                      </div>
                    )}

                    {/* Custom Answer Input */}
                    {!hasAnswer && answeringMessageId === msg.id && (
                      <div className="mt-2">
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={answerText}
                            onChange={(e) => setAnswerText(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSubmitAnswer(msg.id)}
                            placeholder="Type your answer..."
                            className="flex-1 px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:border-primary"
                            autoFocus
                          />
                          <button
                            onClick={() => handleSubmitAnswer(msg.id)}
                            disabled={!answerText.trim()}
                            className="p-1 text-primary hover:bg-muted rounded disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Send className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => {
                              setAnsweringMessageId(null);
                              setAnswerText("");
                            }}
                            className="px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            // Render normal messages
            return (
              <div
                key={msg.id}
                className={`px-3 py-2 border-b border-border/30 hover:bg-muted/30 ${
                  isImportant ? "bg-primary/5" : ""
                }`}
              >
                {/* Header */}
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {formatTime(msg.createdAt)}
                  </span>
                  <span className={`text-xs ${typeConfig?.color || "text-muted-foreground"}`}>
                    {personaConfig?.emoji || "🤖"} {personaConfig?.shortLabel || msg.persona}
                  </span>
                </div>
                {/* Content */}
                <div className="flex items-start gap-2">
                  <span className={typeConfig?.color || "text-muted-foreground"}>
                    {typeConfig?.emoji || "💬"}
                  </span>
                  <p className="text-xs text-muted-foreground flex-1 line-clamp-3">
                    {cleanedContent}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function formatCost(cost: number | string | undefined | null): string {
  if (cost === undefined || cost === null) return "0.00";
  const num = Number(cost);
  if (isNaN(num)) return "0.00";
  return num.toFixed(2);
}

function formatModelName(modelId: string | undefined | null): string {
  if (!modelId) return "Sonnet 4";
  const option = MODEL_OPTIONS.find((m) => m.value === modelId);
  if (option) return option.shortLabel;
  // Fallback parsing for any model ID format
  const lower = modelId.toLowerCase();
  // Anthropic models
  if (lower.includes("opus") && lower.includes("4-5")) return "Opus 4.5";
  if (lower.includes("opus")) return "Opus 4";
  if (lower.includes("haiku")) return "Haiku 4.5";
  if (lower.includes("sonnet") && lower.includes("3-5")) return "Sonnet 3.5";
  if (lower.includes("sonnet")) return "Sonnet 4";
  // Google/Gemini models
  if (lower.includes("gemini-2.5-pro")) return "Gemini 2.5 Pro";
  if (lower.includes("gemini-2.0-flash")) return "Gemini 2.0 Flash";
  if (lower.includes("gemini-3-pro")) return "Gemini 3 Pro";
  if (lower.includes("gemini")) return "Gemini";
  // OpenAI models
  if (lower.includes("gpt-4o")) return "GPT-4o";
  if (lower.includes("gpt-5")) return "GPT-5";
  if (lower.includes("o1-mini")) return "o1-mini";
  if (lower.includes("o1")) return "o1";
  if (lower.includes("o3")) return "o3";
  // Ollama/local models
  if (lower.includes("qwen")) return "Qwen";
  if (lower.includes("deepseek")) return "DeepSeek";
  if (lower.includes("llama")) return "Llama";
  if (lower.includes("mistral")) return "Mistral";
  return modelId;
}

function formatProviderName(provider: string | undefined | null): { name: string; icon: string } {
  switch (provider) {
    case "anthropic":
      return { name: "Anthropic", icon: "🤖" };
    case "openai":
      return { name: "OpenAI", icon: "🔷" };
    case "google":
      return { name: "Gemini", icon: "🔵" };
    case "ollama":
      return { name: "Ollama", icon: "🏠" };
    default:
      // Default to Anthropic for backwards compatibility (null/undefined providers)
      return { name: "Anthropic", icon: "🤖" };
  }
}

// Persona config for display in legend
const PERSONA_CONFIGS: Record<string, { emoji: string; shortLabel: string }> = {
  frontend_developer: { emoji: "🎨", shortLabel: "Frontend" },
  backend_developer: { emoji: "⚙️", shortLabel: "Backend" },
  devops_engineer: { emoji: "🔧", shortLabel: "DevOps" },
  security_engineer: { emoji: "🔒", shortLabel: "Security" },
  qa_engineer: { emoji: "🧪", shortLabel: "QA" },
  tech_writer: { emoji: "📝", shortLabel: "Docs" },
  project_manager: { emoji: "📋", shortLabel: "PM" },
  api_developer: { emoji: "🔌", shortLabel: "API" },
  database_administrator: { emoji: "🗄️", shortLabel: "DBA" },
  ml_engineer: { emoji: "🤖", shortLabel: "ML" },
  mobile_developer_ios: { emoji: "📱", shortLabel: "iOS" },
  mobile_developer_android: { emoji: "🤖", shortLabel: "Android" },
  manager: { emoji: "👔", shortLabel: "Manager" },
};

/**
 * Derive provider from a model name string.
 * E.g., "gemini-2.5-pro" → "google", "claude-sonnet-4" → "anthropic"
 */
function getProviderFromModel(modelName: string | undefined | null): string | null {
  if (!modelName) return null;
  const lower = modelName.toLowerCase();
  if (lower.includes("gemini") || lower.includes("palm")) return "google";
  if (lower.includes("gpt") || lower.includes("o1") || lower.includes("o3") || lower.includes("codex")) return "openai";
  if (lower.includes("claude") || lower.includes("haiku") || lower.includes("sonnet") || lower.includes("opus")) return "anthropic";
  if (lower.includes("llama") || lower.includes("qwen") || lower.includes("deepseek") || lower.includes("mistral")) return "ollama";
  return null;
}

/**
 * Get all unique providers used by a task (planning, execution, review)
 * Returns deduplicated list in order of usage (planner first, then executor, then manager/reviewer)
 */
function getDerivedProviders(task: ActiveTask | CompletedTask): string[] {
  const providers: string[] = [];
  const seen = new Set<string>();

  const addProvider = (p: string | null | undefined) => {
    if (p && !seen.has(p)) {
      seen.add(p);
      providers.push(p);
    }
  };

  // 1. Check planJson.metadata for planner model
  const plannerModel = task.planJson?.metadata?.plannerModel;
  if (plannerModel) {
    addProvider(getProviderFromModel(plannerModel));
  }

  // 2. Add explicit workerProvider or derive from workerModel
  if (task.workerProvider) {
    addProvider(task.workerProvider);
  } else if (task.workerModel) {
    addProvider(getProviderFromModel(task.workerModel));
  }

  // 3. Add manager/review provider if the task has been reviewed
  if (task.managerProvider) {
    addProvider(task.managerProvider);
  } else if (task.managerModel) {
    addProvider(getProviderFromModel(task.managerModel));
  }

  // If we still have nothing, default to anthropic
  if (providers.length === 0) {
    providers.push("anthropic");
  }

  return providers;
}

/**
 * Get all models used by a task in execution order (planner first, then worker)
 * Returns list of formatted model names
 */
function getDerivedModels(task: ActiveTask | CompletedTask): string[] {
  const models: string[] = [];

  // 1. Planner model (from planJson.metadata)
  const plannerModel = task.planJson?.metadata?.plannerModel;
  if (plannerModel) {
    models.push(formatModelName(plannerModel));
  }

  // 2. Worker/execution model
  if (task.workerModel) {
    const workerModelName = formatModelName(task.workerModel);
    // Only add if different from planner model (avoid duplicates like "Sonnet 4 + Sonnet 4")
    if (models.length === 0 || models[models.length - 1] !== workerModelName) {
      models.push(workerModelName);
    }
  }

  return models;
}

// Parse a log for errors/warnings using structured severity field + pattern matching
function parseLogForError(
  message: string,
  severity?: string,
  logType?: string
): { type: "error" | "warning"; category: string; message: string; file?: string; line?: number } | null {
  const msg = message.trim();

  // Filter out false positives - messages that look like success/info even if marked as error
  // Agent SDK sometimes marks success output as "error" severity due to stderr usage
  const successIndicators = [
    /^Perfect!/i,
    /^Great!/i,
    /^Excellent!/i,
    /^Done!/i,
    /^Success/i,
    /^Completed/i,
    /^\[.*?\]\s*(Perfect|Great|Excellent|Done|Success|Completed)/i,
    /Result:\s*(Perfect|Great|Excellent|Done|Success)/i,
    /successfully\s+(created|completed|implemented|added|updated|fixed)/i,
    /✓/,  // Checkmark indicates success
    /✅/,  // Green checkmark
  ];

  const isFalsePositive = successIndicators.some(pattern => pattern.test(msg));
  if (isFalsePositive) {
    return null; // Not an error - it's a success message
  }

  // First, check structured severity field (most reliable)
  if (severity === "error" || logType === "error") {
    // Additional filter: require actual error indicators for severity-based errors
    // This prevents agent output (which may use stderr) from being flagged
    const hasErrorIndicator =
      msg.includes("Error") ||
      msg.includes("error") ||
      msg.includes("FAIL") ||
      msg.includes("fail") ||
      msg.includes("ECONNREFUSED") ||
      msg.includes("ETIMEDOUT") ||
      msg.includes("EACCES") ||
      msg.includes("Permission denied") ||
      msg.includes("fatal:") ||
      msg.includes("CONFLICT") ||
      /TS\d+/.test(msg) ||  // TypeScript error codes
      /npm ERR/i.test(msg);

    if (!hasErrorIndicator) {
      return null; // Severity says error but content doesn't look like an error
    }

    // Try to categorize based on message content
    // These are shown as warnings during execution - only "Task Failed" (added for exit code != 0) is a true error
    if (msg.includes("TS") && msg.match(/TS\d+/)) {
      return { type: "warning", category: "TypeScript", message: msg };
    }
    if (msg.includes("npm") || msg.includes("NPM")) {
      return { type: "warning", category: "npm", message: msg };
    }
    if (msg.includes("git") || msg.includes("Git") || msg.includes("CONFLICT")) {
      return { type: "warning", category: "Git", message: msg };
    }
    if (msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT") || msg.includes("fetch failed")) {
      return { type: "warning", category: "Network", message: msg };
    }
    if (msg.includes("Permission denied") || msg.includes("EACCES")) {
      return { type: "warning", category: "Permission", message: msg };
    }
    // Generic warning from structured field
    return { type: "warning", category: "Warning", message: msg };
  }

  if (severity === "warning" || logType === "warning") {
    return { type: "warning", category: "Warning", message: msg };
  }

  // TypeScript issues: "error TS2307: Cannot find module" or "src/file.ts(42,5): error TS..."
  // These are warnings during execution - only "Task Failed" (from exit code != 0) is a true error
  const tsMatch = msg.match(/(?:(.+?)\((\d+),\d+\):\s*)?error\s+TS(\d+):\s*(.+)/i);
  if (tsMatch) {
    return {
      type: "warning",
      category: "TypeScript",
      message: tsMatch[4],
      file: tsMatch[1],
      line: tsMatch[2] ? parseInt(tsMatch[2]) : undefined,
    };
  }

  // ESLint issues: "src/file.ts:42:5 - error: ..."
  const eslintMatch = msg.match(/(.+?):(\d+):\d+\s*-?\s*error[:\s]+(.+)/i);
  if (eslintMatch && !msg.includes("TS")) {
    return {
      type: "warning",
      category: "ESLint",
      message: eslintMatch[3],
      file: eslintMatch[1],
      line: parseInt(eslintMatch[2]),
    };
  }

  // Git issues
  if (msg.includes("CONFLICT") || msg.includes("Merge conflict")) {
    const fileMatch = msg.match(/CONFLICT.*?:\s*(?:Merge conflict in\s+)?(.+)/);
    return {
      type: "warning",
      category: "Git",
      message: msg,
      file: fileMatch?.[1]?.trim(),
    };
  }
  if (msg.includes("fatal:") && msg.toLowerCase().includes("git")) {
    return {
      type: "warning",
      category: "Git",
      message: msg.replace(/fatal:\s*/i, ""),
    };
  }

  // npm/node issues
  if (msg.includes("npm ERR!") || msg.includes("npm error")) {
    return {
      type: "warning",
      category: "npm",
      message: msg.replace(/npm ERR!\s*/i, ""),
    };
  }

  // Test failures (Jest, Vitest, pytest)
  if (msg.includes("FAIL") && (msg.includes(".test.") || msg.includes(".spec.") || msg.includes("test_"))) {
    const fileMatch = msg.match(/FAIL\s+(.+?\.(test|spec)\.[jt]sx?)/i);
    return {
      type: "warning",
      category: "Test",
      message: "Test failed",
      file: fileMatch?.[1],
    };
  }
  if (msg.includes("AssertionError") || msg.includes("Expected") && msg.includes("Received")) {
    return {
      type: "warning",
      category: "Test",
      message: msg,
    };
  }

  // Generic [ERROR] markers - still warnings during execution
  if (msg.includes("[ERROR]")) {
    return {
      type: "warning",
      category: "Warning",
      message: msg.replace(/\[ERROR\]\s*/i, ""),
    };
  }

  // Python/general messages with "Error:" or "error:"
  if ((msg.includes("Error:") || msg.includes("error:")) && !msg.includes("[worker]")) {
    // Try to extract file:line pattern
    const pyMatch = msg.match(/File "(.+?)", line (\d+)/);
    if (pyMatch) {
      return {
        type: "warning",
        category: "Python",
        message: msg.split("\n")[0],
        file: pyMatch[1],
        line: parseInt(pyMatch[2]),
      };
    }
    return {
      type: "warning",
      category: "Warning",
      message: msg,
    };
  }

  // Warnings
  if (msg.includes("[WARN]") || msg.includes("Warning:") || msg.includes("warning:")) {
    return {
      type: "warning",
      category: "Warning",
      message: msg.replace(/\[(WARN|Warning)\]:?\s*/i, ""),
    };
  }

  // Network/connection issues - warnings during execution
  if (msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT") || msg.includes("fetch failed")) {
    return {
      type: "warning",
      category: "Network",
      message: msg,
    };
  }

  // Permission issues - warnings during execution
  if (msg.includes("EACCES") || msg.includes("Permission denied")) {
    return {
      type: "warning",
      category: "Permission",
      message: msg,
    };
  }

  // Broad fallback: catch any line containing "Error" or "error" that terminal would color red
  // These are warnings during execution - only "Task Failed" (from exit code != 0) is a true error
  // Skip common false positives like "[worker]" prefixes and informational messages
  if (
    (msg.includes("Error") || msg.includes("ERROR")) &&
    !msg.includes("[worker]") &&
    !msg.includes("No errors") &&
    !msg.includes("0 errors") &&
    !msg.includes("error free") &&
    !msg.toLowerCase().includes("without error")
  ) {
    return {
      type: "warning",
      category: "Warning",
      message: msg,
    };
  }

  return null;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const logout = useAuthStore((state) => state.logout);
  const user = useAuthStore((state) => state.user);

  // Always start fresh - no cached data to avoid showing stale data on refresh
  // Fresh data loads in <1 second, so showing loading state is better than stale data
  const [data, setData] = useState<ControlCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Streaming logs state - includes full log details
  interface StreamingLog {
    timestamp: number;
    message: string;
    logType?: string;
    severity?: string;
    command?: string;
    exitCode?: number;
    metadata?: {
      errorType?: "fatal" | "recoverable";
      [key: string]: unknown;
    };
  }

  interface ParsedError {
    timestamp: number;
    type: "error" | "warning";
    category: string; // TypeScript, Git, npm, Test, Network, etc.
    message: string;
    file?: string;
    line?: number;
    logIndex: number; // Index in streamingLogs array for jumping
  }

  const [streamingLogs, setStreamingLogs] = useState<Record<string, StreamingLog[]>>({});
  const [parsedErrors, setParsedErrors] = useState<Record<string, ParsedError[]>>({});
  // Persisted errors from database (survives client re-init)
  const [persistedErrors, setPersistedErrors] = useState<Record<string, ParsedError[]>>({});
  // Track which error panels are expanded (auto-expands when errors detected)
  const [errorPanelExpanded, setErrorPanelExpanded] = useState<Record<string, boolean>>({});
  // Track active tab in the side panel per task: "errors" or "comms"
  const [panelActiveTab, setPanelActiveTab] = useState<Record<string, "errors" | "comms">>({});
  // Track unread comms message count per task (shown as badge on Comms tab)
  const [unreadCommsCount, setUnreadCommsCount] = useState<Record<string, number>>({});
  // Track previous error counts to detect new errors
  const prevErrorCountsRef = useRef<Record<string, number>>({});
  const logEventSources = useRef<Record<string, EventSource>>({});
  const terminalRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Cursor tracking for SSE resume (using refs to avoid re-renders)
  const terminalCursorsRef = useRef<Record<string, string | null>>({});
  const terminalSeenEventIdsRef = useRef<Record<string, Set<string>>>({});
  // Polling fallback timers
  const pollIntervalsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  // Track which terminals are actively streaming (state updates used, value reserved for future UI indicators)
  const [_streamingTerminals, setStreamingTerminals] = useState<Set<string>>(new Set());

  // Real-time cost tracking for trend indicator and ceiling warnings
  const prevCostsRef = useRef<Record<string, number>>({});
  const costCeilingInfoRef = useRef<Record<string, { percent: number; ceiling: number }>>({});

  // Track hidden terminals (for active tasks that user manually collapsed)
  const [hiddenTerminals, setHiddenTerminals] = useState<Set<string>>(new Set());
  // Track shown terminals (for completed tasks that user manually expanded)
  const [shownTerminals, setShownTerminals] = useState<Set<string>>(new Set());
  // Auto-scroll toggle for terminal output
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);

  // Task detail modal
  const [selectedTask, setSelectedTask] = useState<CompletedTask | null>(null);
  const [taskModalTab, setTaskModalTab] = useState<"details" | "logs">("details");

  // System status
  const [systemEnabled, setSystemEnabled] = useState(true);
  const [systemToggleLoading, setSystemToggleLoading] = useState(false);

  // Auto-workflow toggles (from org settings)
  const [autoReviewEnabled, setAutoReviewEnabled] = useState(false);
  const [autoDeployEnabled, setAutoDeployEnabled] = useState(false);
  const [autoImproveEnabled, setAutoImproveEnabled] = useState(false);
  const [autoToggleLoading, setAutoToggleLoading] = useState<"review" | "deploy" | "improve" | null>(null);

  // Action states
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resetCountersLoading, setResetCountersLoading] = useState(false);

  // Action buttons state
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  const [taskSource, setTaskSource] = useState<"external" | "internal">("external");
  const [createTaskForm, setCreateTaskForm] = useState({
    jiraIssueKey: "",
    workerPersona: "", // Empty = auto/dynamic routing (Epic/Multi-Provider modes)
  });
  const [createLoading, setCreateLoading] = useState(false);
  const [costEstimate, setCostEstimate] = useState<{
    tier: string;
    costRange: { min: number; max: number };
    tokenRange: { min: number; max: number };
    confidence: string;
    tierDescription: string;
    historicalBasis: number;
  } | null>(null);
  const [costEstimateLoading, setCostEstimateLoading] = useState(false);

  // Internal project state for Run Task modal
  const [internalProjects, setInternalProjects] = useState<Array<{ id: string; key: string; name: string }>>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [internalTasks, setInternalTasks] = useState<Array<{ taskKey: string; title: string; persona: string | null; columnType: string }>>([]);
  const [selectedTaskKey, setSelectedTaskKey] = useState<string>("");
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(false);

  // SSE connection state
  const [_sseConnected, setSseConnected] = useState(false);

  // Log search state
  const [isLogSearchOpen, setIsLogSearchOpen] = useState(false);
  const [isDocsDropdownOpen, setIsDocsDropdownOpen] = useState(false);

  // Talk to Worker state
  const [isTalkOpen, setIsTalkOpen] = useState(false);
  const [talkMessage, setTalkMessage] = useState("");
  const [talkLoading, setTalkLoading] = useState(false);
  const docsDropdownRef = useRef<HTMLDivElement>(null);
  const [isEfficiencyDropdownOpen, setIsEfficiencyDropdownOpen] = useState(false);
  const efficiencyDropdownRef = useRef<HTMLDivElement>(null);

  // Actions dropdown state for All Tasks table
  const [openActionMenu, setOpenActionMenu] = useState<string | null>(null);

  // Keyboard shortcut for search (Cmd/Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsLogSearchOpen(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Close docs dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (docsDropdownRef.current && !docsDropdownRef.current.contains(event.target as Node)) {
        setIsDocsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Close efficiency dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (efficiencyDropdownRef.current && !efficiencyDropdownRef.current.contains(event.target as Node)) {
        setIsEfficiencyDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Parse errors from streaming logs, task-level errors, and persisted errors
  useEffect(() => {
    const newParsedErrors: Record<string, ParsedError[]> = {};
    const tasksWithNewErrors: string[] = [];

    // Helper to create a dedup key for errors
    const errorKey = (e: ParsedError) => `${e.timestamp}|${e.message}`;

    // First, add task-level errors (from task.errorMessage) as the primary error
    // These are the most important - they explain why the task failed
    if (data?.activeTasks) {
      for (const task of data.activeTasks) {
        if (task.status === "failed") {
          // Show the task-level error if available, otherwise show generic failure message
          const errorMsg = task.errorMessage || "Task failed - check logs for details";
          const errors: ParsedError[] = [{
            timestamp: task.completedAt ? new Date(task.completedAt).getTime() : Date.now(),
            type: "error",
            category: "Task Failed",
            message: errorMsg,
            logIndex: -1, // -1 indicates task-level error (not from logs)
          }];
          newParsedErrors[task.id] = errors;
        }
      }
    }

    // Then, add errors parsed from streaming logs
    for (const [taskId, logs] of Object.entries(streamingLogs)) {
      const errors: ParsedError[] = newParsedErrors[taskId] || [];

      logs.forEach((log, idx) => {
        const parsed = parseLogForError(log.message, log.severity, log.logType);
        if (parsed) {
          errors.push({
            timestamp: log.timestamp,
            type: parsed.type,
            category: parsed.category,
            message: parsed.message,
            file: parsed.file,
            line: parsed.line,
            logIndex: idx,
          });
        }
      });
      if (errors.length > 0) {
        newParsedErrors[taskId] = errors;
      }
    }

    // Finally, merge in persisted errors (from database) - survives client re-init
    // Deduplicate by timestamp+message to avoid showing same error twice
    for (const [taskId, persisted] of Object.entries(persistedErrors)) {
      const existing = newParsedErrors[taskId] || [];
      const existingKeys = new Set(existing.map(errorKey));

      // Add persisted errors that aren't already in the list
      const newFromPersisted = persisted.filter(e => !existingKeys.has(errorKey(e)));
      if (newFromPersisted.length > 0) {
        const merged = [...existing, ...newFromPersisted];
        // Sort by timestamp
        merged.sort((a, b) => a.timestamp - b.timestamp);
        newParsedErrors[taskId] = merged;
      }
    }

    // Check for new errors and track counts
    for (const [taskId, errors] of Object.entries(newParsedErrors)) {
      const prevCount = prevErrorCountsRef.current[taskId] || 0;
      if (errors.length > prevCount) {
        tasksWithNewErrors.push(taskId);
      }
      prevErrorCountsRef.current[taskId] = errors.length;
    }

    setParsedErrors(newParsedErrors);

    // Auto-expand error panels for tasks with new errors
    if (tasksWithNewErrors.length > 0) {
      setErrorPanelExpanded(prev => {
        const updated = { ...prev };
        tasksWithNewErrors.forEach(taskId => {
          updated[taskId] = true;
        });
        return updated;
      });
    }
  }, [streamingLogs, data?.activeTasks, persistedErrors]);

  // Onboarding state
  const { shouldShowOnboarding, dismissOnboarding, resetOnboarding } = useOnboardingState();

  const fetchData = useCallback(async () => {
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/control-center`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
        },
        cache: 'no-store',
      });
      if (!response.ok) {
        if (response.status === 401) {
          logout();
          navigate("/login");
          return;
        }
        throw new Error("Failed to fetch data");
      }
      const result = await response.json();
      setData(result);
      setError(null);

      // Update local state from API response
      if (result.systemStatus) {
        setSystemEnabled(result.systemStatus.systemEnabled);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to load data";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [logout, navigate]);

  // Fetch org settings for auto-workflow toggles
  const fetchOrgSettings = useCallback(async () => {
    try {
      const token = localStorage.getItem("accessToken");
      if (!token) return;

      const response = await fetch(`${API_BASE}/api/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const settings = await response.json();
        setAutoReviewEnabled(settings.autoReviewEnabled ?? false);
        setAutoDeployEnabled(settings.autoDeployEnabled ?? false);
        setAutoImproveEnabled(settings.autoImproveEnabled ?? false);
      }
    } catch (err) {
      console.error("Failed to fetch org settings:", err);
    }
  }, []);

  // Toggle auto-review setting
  const toggleAutoReview = async () => {
    setAutoToggleLoading("review");
    try {
      const token = localStorage.getItem("accessToken");
      const newValue = !autoReviewEnabled;
      const response = await fetch(`${API_BASE}/api/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ autoReviewEnabled: newValue }),
      });

      if (response.ok) {
        setAutoReviewEnabled(newValue);
        setActionSuccess(`Auto-review ${newValue ? "enabled" : "disabled"}`);
        setTimeout(() => setActionSuccess(null), 3000);
      } else {
        const err = await response.json();
        setActionError(err.error || "Failed to update auto-review setting");
        setTimeout(() => setActionError(null), 5000);
      }
    } catch (err) {
      setActionError("Failed to update auto-review setting");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setAutoToggleLoading(null);
    }
  };

  // Toggle auto-deploy setting
  const toggleAutoDeploy = async () => {
    setAutoToggleLoading("deploy");
    try {
      const token = localStorage.getItem("accessToken");
      const newValue = !autoDeployEnabled;
      const response = await fetch(`${API_BASE}/api/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ autoDeployEnabled: newValue }),
      });

      if (response.ok) {
        setAutoDeployEnabled(newValue);
        setActionSuccess(`Auto-deploy ${newValue ? "enabled" : "disabled"}`);
        setTimeout(() => setActionSuccess(null), 3000);
      } else {
        const err = await response.json();
        setActionError(err.error || "Failed to update auto-deploy setting");
        setTimeout(() => setActionError(null), 5000);
      }
    } catch (err) {
      setActionError("Failed to update auto-deploy setting");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setAutoToggleLoading(null);
    }
  };

  // Toggle auto-improve setting
  const toggleAutoImprove = async () => {
    setAutoToggleLoading("improve");
    try {
      const token = localStorage.getItem("accessToken");
      const newValue = !autoImproveEnabled;
      const response = await fetch(`${API_BASE}/api/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ autoImproveEnabled: newValue }),
      });

      if (response.ok) {
        setAutoImproveEnabled(newValue);
        setActionSuccess(`Auto-improve ${newValue ? "enabled" : "disabled"}`);
        setTimeout(() => setActionSuccess(null), 3000);
      } else {
        const err = await response.json();
        setActionError(err.error || "Failed to update auto-improve setting");
        setTimeout(() => setActionError(null), 5000);
      }
    } catch (err) {
      setActionError("Failed to update auto-improve setting");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setAutoToggleLoading(null);
    }
  };

  // Handle bfcache restoration - reset state when page is restored from cache
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        // Page was restored from bfcache - reset to loading state and refetch
        setData(null);
        setLoading(true);
        fetchData();
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, [fetchData]);

  // SSE streaming for real-time updates
  useEffect(() => {
    // First fetch full data and org settings
    fetchData();
    fetchOrgSettings();

    const token = localStorage.getItem("accessToken");
    if (!token) return;

    // Create EventSource for SSE stream
    // Note: EventSource doesn't support custom headers, so we use query param for auth
    const eventSource = new EventSource(
      `${API_BASE}/api/control-center/stream?token=${encodeURIComponent(token)}`
    );

    eventSource.onopen = () => {
      setSseConnected(true);
      setError(null);
    };

    eventSource.onmessage = (event) => {
      try {
        const update = JSON.parse(event.data);

        if (update.type === "connected") {
          setSseConnected(true);
          return;
        }

        if (update.type === "update") {
          // Update systemEnabled from SSE for real-time maintenance mode sync
          if (update.systemStatus) {
            setSystemEnabled(update.systemStatus.systemEnabled);
          }

          // Update stats
          setData((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              stats: {
                ...prev.stats,
                ...update.stats,
              },
              // Use task data directly from API - it includes steps based on workflow type
              activeTasks: update.activeTasks.map((task: any) => ({
                ...task,
                workerName: task.workerPersona,
                createdAt: task.startedAt || task.createdAt || new Date().toISOString(),
                recentLogs: [],
              })),
              queuedTasks: update.queuedTasks.map((task: any) => ({
                ...task,
                workerName: task.workerPersona,
                recentLogs: [],
              })),
              recentCompleted: update.recentCompleted,
              systemStatus: update.systemStatus,
            };
          });
        }

        // Handle real-time cost updates for immediate cost tracking
        if (update.type === "cost") {
          const { taskId, estimatedCostUsd, costCeilingPercent, perTaskCostCeilingUsd } = update;

          // Track cost trend (is it increasing?)
          const prevCost = prevCostsRef.current[taskId] || 0;
          const costIncreased = estimatedCostUsd > prevCost;
          prevCostsRef.current[taskId] = estimatedCostUsd;

          // Store ceiling info for display
          if (costCeilingPercent !== undefined && perTaskCostCeilingUsd) {
            costCeilingInfoRef.current[taskId] = {
              percent: costCeilingPercent,
              ceiling: perTaskCostCeilingUsd,
            };
          }

          // Update task with new cost and trend indicator
          setData((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              activeTasks: prev.activeTasks.map((task) =>
                task.id === taskId
                  ? {
                      ...task,
                      estimatedCostUsd,
                      costTrend: costIncreased ? "up" : undefined,
                      costCeilingPercent,
                    }
                  : task
              ),
            };
          });

          // Clear cost trend after 2 seconds
          if (costIncreased) {
            setTimeout(() => {
              setData((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  activeTasks: prev.activeTasks.map((task) =>
                    task.id === taskId ? { ...task, costTrend: undefined } : task
                  ),
                };
              });
            }, 2000);
          }
        }
      } catch (err) {
        console.error("Failed to parse SSE message:", err);
      }
    };

    eventSource.onerror = () => {
      setSseConnected(false);
      // EventSource will automatically reconnect
    };

    return () => {
      eventSource.close();
    };
  }, [fetchData, fetchOrgSettings]);

  // Fetch persisted errors from API (survives client re-init)
  const fetchPersistedErrors = useCallback(async (taskId: string) => {
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/control-center/errors/${taskId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const result = await response.json();
        const errors: ParsedError[] = (result.errors || []).map((e: {
          timestamp: number;
          type: string;
          category: string;
          message: string;
          file?: string;
          line?: number;
        }) => ({
          timestamp: e.timestamp,
          type: e.type as "error" | "warning",
          category: e.category,
          message: e.message,
          file: e.file,
          line: e.line,
          logIndex: -2, // -2 indicates persisted error (from database)
        }));

        if (errors.length > 0) {
          setPersistedErrors(prev => ({
            ...prev,
            [taskId]: errors,
          }));
        }
      }
    } catch (err) {
      console.error("Failed to fetch persisted errors:", err);
    }
  }, []);

  // Fetch terminal logs from REST API (same as OnCallShift)
  // Used for initial load and as polling fallback when SSE disconnects
  const fetchTerminalLogs = useCallback(async (taskId: string) => {
    try {
      const token = localStorage.getItem("accessToken");
      const cursor = terminalCursorsRef.current[taskId];
      const url = cursor
        ? `${API_BASE}/api/control-center/logs/${taskId}?limit=100&since=${encodeURIComponent(cursor)}`
        : `${API_BASE}/api/control-center/logs/${taskId}?limit=100`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const result = await response.json();
        const logs = result.logs || [];
        if (logs.length > 0) {
          // Initialize seen IDs set if needed
          if (!terminalSeenEventIdsRef.current[taskId]) {
            terminalSeenEventIdsRef.current[taskId] = new Set();
          }
          const seen = terminalSeenEventIdsRef.current[taskId];

          const logLines: StreamingLog[] = logs
            .filter((log: { id?: string; timestamp: string; cursor?: string }) => {
              // Build event ID for deduplication (same format as OnCallShift)
              const eventId = log.cursor ||
                (log.timestamp && log.id
                  ? `${new Date(log.timestamp).toISOString()}|${log.id}`
                  : null);
              if (eventId && seen.has(eventId)) {
                return false; // Skip duplicate
              }
              if (eventId) {
                seen.add(eventId);
              }
              return true;
            })
            .map((log: { timestamp: string; message: string; cursor?: string; logType?: string; severity?: string; command?: string; exitCode?: number; metadata?: { errorType?: "fatal" | "recoverable"; [key: string]: unknown } }) => ({
              timestamp: new Date(log.timestamp).getTime(),
              message: log.message,
              logType: log.logType,
              severity: log.severity,
              command: log.command,
              exitCode: log.exitCode,
              metadata: log.metadata,
            }));

          if (logLines.length > 0) {
            setStreamingLogs((prev) => {
              // If no cursor (initial fetch), REPLACE logs (same as OnCallShift)
              // If cursor exists (polling), APPEND new logs
              const prevLines = cursor ? (prev[taskId] || []) : [];
              const nextLines = [...prevLines, ...logLines];
              // Keep last 1000 lines for memory bounding
              return {
                ...prev,
                [taskId]: nextLines.length > 1000 ? nextLines.slice(-1000) : nextLines,
              };
            });
          }

          // Update cursor from last log
          const lastLog = logs[logs.length - 1];
          if (lastLog?.cursor) {
            terminalCursorsRef.current[taskId] = lastLog.cursor;
          } else if (lastLog?.timestamp && lastLog?.id) {
            terminalCursorsRef.current[taskId] = `${new Date(lastLog.timestamp).toISOString()}|${lastLog.id}`;
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch terminal logs:", err);
    }
  }, []);

  const startPolling = useCallback((taskId: string, intervalMs = 5000) => {
    if (pollIntervalsRef.current[taskId]) return;
    const interval = setInterval(() => fetchTerminalLogs(taskId), intervalMs);
    pollIntervalsRef.current[taskId] = interval;
  }, [fetchTerminalLogs]);

  const stopPolling = useCallback((taskId: string) => {
    const interval = pollIntervalsRef.current[taskId];
    if (interval) {
      clearInterval(interval);
      delete pollIntervalsRef.current[taskId];
    }
  }, []);

  // Start SSE log streaming for a task - uses database stream (same as OnCallShift)
  const startLogStream = useCallback((taskId: string) => {
    // Don't start if already streaming
    if (logEventSources.current[taskId]) return;

    const token = localStorage.getItem("accessToken");
    if (!token) return;

    // Build URL with cursor for resume support (same as OnCallShift)
    const tokenParam = `token=${encodeURIComponent(token)}`;
    const sinceCursor = terminalCursorsRef.current[taskId];
    const sinceParam = sinceCursor ? `since=${encodeURIComponent(sinceCursor)}` : "";
    const query = [tokenParam, sinceParam].filter(Boolean).join("&");
    const url = `${API_BASE}/api/control-center/logs/${taskId}/stream?${query}`;

    // CRITICAL: Fetch initial logs FIRST, then connect to SSE for new logs (same as OnCallShift)
    fetchTerminalLogs(taskId);
    // Also fetch persisted errors (survives client re-init)
    fetchPersistedErrors(taskId);

    const eventSource = new EventSource(url);

    // Handle ping events (keep-alive)
    eventSource.addEventListener("ping", () => {
      // Connection is alive, nothing to do
    });

    // Handle log events - works for both CloudWatch and database streams
    const onLogEvent = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        // Event ID for deduplication and cursor tracking (same as OnCallShift)
        const eventId =
          event.lastEventId ||
          data.cursor ||
          (data.timestamp && data.id
            ? `${new Date(data.timestamp).toISOString()}|${data.id}`
            : null);

        // Deduplication: track seen event IDs
        if (eventId) {
          if (!terminalSeenEventIdsRef.current[taskId]) {
            terminalSeenEventIdsRef.current[taskId] = new Set();
          }
          const seen = terminalSeenEventIdsRef.current[taskId];
          if (seen.has(eventId)) {
            return; // Skip duplicates
          }
          seen.add(eventId);
          // Keep memory bounded - remove old entries if too many
          if (seen.size > 1000) {
            terminalSeenEventIdsRef.current[taskId] = new Set(Array.from(seen).slice(-500));
          }
        }

        const logLine: StreamingLog = {
          timestamp: new Date(data.timestamp).getTime(),
          message: data.message,
          // CloudWatch logs don't have these fields, but database logs do
          logType: data.logType,
          severity: data.severity,
          command: data.command,
          exitCode: data.exitCode,
          metadata: data.metadata,
        };

        setStreamingLogs((prev) => {
          const prevLines = prev[taskId] || [];
          const nextLines = [...prevLines, logLine];
          // Keep last 1000 lines for memory bounding
          return {
            ...prev,
            [taskId]: nextLines.length > 1000 ? nextLines.slice(-1000) : nextLines,
          };
        });

        if (eventId) {
          terminalCursorsRef.current[taskId] = eventId;
        }
      } catch (err) {
        console.error("Error parsing log SSE data:", err);
      }
    };

    eventSource.addEventListener("log", onLogEvent);

    // Handle Ralph progress events
    eventSource.addEventListener("ralph_progress", (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        // Update the task's Ralph progress in the data state
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            activeTasks: prev.activeTasks.map((task) =>
              task.id === taskId
                ? {
                    ...task,
                    isRalphTask: true,
                    ralphProgress: {
                      currentStory: data.currentStory,
                      totalStories: data.totalStories,
                      currentStoryDescription: data.currentStoryDescription,
                      status: "executing" as const,
                    },
                  }
                : task
            ),
          };
        });
      } catch (err) {
        console.error("Error parsing Ralph progress SSE data:", err);
      }
    });

    eventSource.onopen = () => {
      stopPolling(taskId); // Stop fallback polling once SSE opens
      setStreamingTerminals((prev) => new Set([...prev, taskId]));
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "status") {
          // Task status changed - refresh main data
          fetchData();
        } else if (data.type === "complete") {
          // Task completed - close stream
          eventSource.close();
          delete logEventSources.current[taskId];
          setStreamingTerminals((prev) => {
            const newSet = new Set(prev);
            newSet.delete(taskId);
            return newSet;
          });
          stopPolling(taskId);
        }
      } catch (err) {
        console.error("Error parsing SSE data:", err);
      }
    };

    eventSource.onerror = () => {
      // Let EventSource auto-reconnect; use polling while disconnected
      setStreamingTerminals((prev) => {
        const newSet = new Set(prev);
        newSet.delete(taskId);
        return newSet;
      });
      startPolling(taskId); // Fall back to polling
    };

    logEventSources.current[taskId] = eventSource;
  }, [fetchTerminalLogs, fetchPersistedErrors, fetchData, startPolling, stopPolling]);

  // Stop SSE log streaming for a task
  const stopLogStream = useCallback((taskId: string) => {
    const eventSource = logEventSources.current[taskId];
    if (eventSource) {
      eventSource.close();
      delete logEventSources.current[taskId];
    }
    stopPolling(taskId);
    setStreamingTerminals((prev) => {
      const newSet = new Set(prev);
      newSet.delete(taskId);
      return newSet;
    });
  }, [stopPolling]);

  // Log streaming for active tasks (auto-connect unless hidden)
  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    if (!token || !data?.activeTasks) return;

    // Get all active task IDs that should have streaming enabled
    const activeTaskIds = data.activeTasks
      .filter((task) => !hiddenTerminals.has(task.id))
      .map((task) => task.id);

    // Start streaming for active tasks
    activeTaskIds.forEach((taskId) => {
      startLogStream(taskId);
    });

    // Close connections for hidden terminals
    Object.keys(logEventSources.current).forEach((taskId) => {
      if (hiddenTerminals.has(taskId) || !activeTaskIds.includes(taskId)) {
        stopLogStream(taskId);
      }
    });
  }, [data?.activeTasks, hiddenTerminals, startLogStream, stopLogStream]);

  // Cleanup SSE connections on unmount
  useEffect(() => {
    return () => {
      Object.keys(logEventSources.current).forEach((taskId) => {
        logEventSources.current[taskId].close();
      });
      logEventSources.current = {};
      Object.values(pollIntervalsRef.current).forEach((interval) => clearInterval(interval));
      pollIntervalsRef.current = {};
      terminalSeenEventIdsRef.current = {};
    };
  }, []);

  // Note: We intentionally don't cache data to sessionStorage
  // Fresh data loads quickly and showing stale data on refresh causes confusion

  // Auto-scroll terminal to bottom when new logs arrive (if enabled)
  useEffect(() => {
    if (!autoScrollEnabled) return;
    Object.keys(streamingLogs).forEach((taskId) => {
      const terminalEl = terminalRefs.current[taskId];
      if (terminalEl) {
        terminalEl.scrollTop = terminalEl.scrollHeight;
      }
    });
  }, [streamingLogs, autoScrollEnabled]);

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  const toggleSystem = async () => {
    // Confirmation dialog before entering maintenance mode
    if (systemEnabled) {
      const confirmed = window.confirm(
        "Enter maintenance mode?\n\n" +
          "- The orchestrator will stop processing tasks\n" +
          "- New tasks will continue to queue\n" +
          "- Queued tasks will resume when you exit maintenance mode"
      );
      if (!confirmed) return;
    }

    setSystemToggleLoading(true);
    try {
      const token = localStorage.getItem("accessToken");
      const endpoint = systemEnabled ? "disable" : "enable";

      // Toggle main system - the API now handles orchestrator start/stop automatically
      const response = await fetch(`${API_BASE}/api/system/${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const newState = !systemEnabled;
        setSystemEnabled(newState);

        // Also toggle watcher to match system state
        const watcherEndpoint = newState ? "start" : "stop";
        await fetch(`${API_BASE}/api/orchestrator/watcher/${watcherEndpoint}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
    } catch (err) {
      console.error("Failed to toggle system:", err);
    } finally {
      setSystemToggleLoading(false);
    }
  };

  const handleResetCounters = async () => {
    if (!confirm("Reset all counters? This will start tracking from now. Historical data will not be deleted.")) {
      return;
    }
    setResetCountersLoading(true);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/control-center/reset-counters`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        setActionSuccess("All counters have been reset");
        setTimeout(() => setActionSuccess(null), 3000);
        fetchData();
      } else {
        const err = await response.json();
        setActionError(err.error || "Failed to reset counters");
        setTimeout(() => setActionError(null), 5000);
      }
    } catch (err) {
      setActionError("Failed to reset counters");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setResetCountersLoading(false);
    }
  };

  const handleCancelTask = async (taskId: string) => {
    setActionLoading(taskId);

    // Optimistically update task status to cancelled to prevent UI flash
    setData((prevData) => {
      if (!prevData) return prevData;
      return {
        ...prevData,
        activeTasks: prevData.activeTasks.map((t) =>
          t.id === taskId ? { ...t, status: "cancelled" } : t
        ),
        queuedTasks: prevData.queuedTasks.filter((t) => t.id !== taskId),
      };
    });

    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/tasks/${taskId}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        setActionSuccess("Task cancelled successfully");
        setTimeout(() => setActionSuccess(null), 3000);
        // Fetch fresh data to get accurate state
        fetchData();
      } else {
        const err = await response.json();
        setActionError(err.error || "Failed to cancel task");
        setTimeout(() => setActionError(null), 5000);
        // Revert optimistic update on error
        fetchData();
      }
    } catch (err) {
      setActionError("Failed to cancel task");
      setTimeout(() => setActionError(null), 5000);
      // Revert optimistic update on error
      fetchData();
    } finally {
      setActionLoading(null);
    }
  };

  const handleRetryTask = async (taskId: string) => {
    setActionLoading(taskId);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/tasks/${taskId}/retry`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        setActionSuccess("Task requeued for retry");
        setTimeout(() => setActionSuccess(null), 3000);
        fetchData();
      } else {
        const err = await response.json();
        setActionError(err.error || "Failed to retry task");
        setTimeout(() => setActionError(null), 5000);
      }
    } catch (err) {
      setActionError("Failed to retry task");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setActionLoading(null);
    }
  };

  // Handle answering a worker's question from the communications feed
  const handleAnswerQuestion = async (messageId: string, answer: string) => {
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/coordination/answer`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messageId,
          answer,
          persona: "dashboard", // Human operator from dashboard
        }),
      });

      if (response.status === 401) {
        logout();
        navigate("/login");
        return;
      }

      if (!response.ok) {
        const err = await response.json();
        console.error("Failed to send answer:", err);
        setActionError(err.error || "Failed to send answer");
        setTimeout(() => setActionError(null), 5000);
      } else {
        setActionSuccess("Answer sent to worker");
        setTimeout(() => setActionSuccess(null), 3000);
      }
    } catch (err) {
      console.error("Failed to send answer:", err);
      setActionError("Failed to send answer");
      setTimeout(() => setActionError(null), 5000);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm("Delete this task from history? This cannot be undone.")) {
      return;
    }
    setActionLoading(taskId);

    // Optimistically remove task from local state to prevent UI flash
    setData((prevData) => {
      if (!prevData) return prevData;
      return {
        ...prevData,
        activeTasks: prevData.activeTasks.filter((t) => t.id !== taskId),
        queuedTasks: prevData.queuedTasks.filter((t) => t.id !== taskId),
        recentCompleted: prevData.recentCompleted.filter((t) => t.id !== taskId),
      };
    });

    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/tasks/${taskId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        setActionSuccess("Task deleted successfully");
        setTimeout(() => setActionSuccess(null), 3000);
        // Sync with server in background (task already removed from UI)
        fetchData();
      } else {
        const err = await response.json();
        setActionError(err.error || "Failed to delete task");
        setTimeout(() => setActionError(null), 5000);
        // Restore data on error by refetching
        fetchData();
      }
    } catch (err) {
      setActionError("Failed to delete task");
      setTimeout(() => setActionError(null), 5000);
      // Restore data on error by refetching
      fetchData();
    } finally {
      setActionLoading(null);
    }
  };

  // Pause all child tasks for a parent workflow
  const handlePauseAllChildren = async (parentTaskId: string) => {
    setActionLoading(parentTaskId);
    try {
      const token = localStorage.getItem("accessToken");
      // Get all child task IDs first
      const response = await fetch(`${API_BASE}/api/tasks/${parentTaskId}/children`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const { children } = await response.json();
        // Send pause command to each running child
        const pausePromises = children
          .filter((child: { status: string }) => ["executing", "environment_setup"].includes(child.status))
          .map((child: { id: string }) =>
            fetch(`${API_BASE}/api/coordination/commands`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                taskId: child.id,
                command: "pause",
              }),
            })
          );
        await Promise.all(pausePromises);
        setActionSuccess(`Paused ${pausePromises.length} child tasks`);
        setTimeout(() => setActionSuccess(null), 3000);
        fetchData();
      }
    } catch (err) {
      setActionError("Failed to pause child tasks");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setActionLoading(null);
    }
  };

  // Talk to Worker - send message to running tasks and log for audit
  const handleTalkToWorkers = async () => {
    if (!talkMessage.trim()) return;

    setTalkLoading(true);
    try {
      const token = localStorage.getItem("accessToken");

      // Get all running tasks
      const runningTasks = data?.activeTasks?.filter(
        (task) => ["executing", "environment_setup", "dispatching"].includes(task.status)
      ) || [];

      if (runningTasks.length === 0) {
        setActionError("No running workers to talk to");
        setTimeout(() => setActionError(null), 3000);
        setTalkLoading(false);
        return;
      }

      const message = talkMessage.trim();

      // For each running task:
      // 1. Send the command to the coordination endpoint
      // 2. Log the message to the task terminal for audit purposes
      const promises = runningTasks.flatMap((task) => [
        // Send command to worker
        fetch(`${API_BASE}/api/coordination/commands`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            taskId: task.id,
            type: "message",
            content: message,
          }),
        }),
        // Log to terminal for audit trail
        fetch(`${API_BASE}/api/tasks/${task.id}/logs`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "user_message",
            message: `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📨 USER MESSAGE FROM DASHBOARD\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${message}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`,
            severity: "info",
          }),
        }),
      ]);

      await Promise.all(promises);

      setActionSuccess(`Message sent to ${runningTasks.length} worker${runningTasks.length > 1 ? "s" : ""}`);
      setTimeout(() => setActionSuccess(null), 3000);

      // Clear and close
      setTalkMessage("");
      setIsTalkOpen(false);
    } catch (err) {
      setActionError("Failed to send message to workers");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setTalkLoading(false);
    }
  };

  // Plan approval handlers for PRD orchestration
  const handleApprovePlan = async (taskId: string) => {
    setActionLoading(taskId);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/tasks/${taskId}/plan/approve`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ executionMode: "autonomous" }),
      });
      if (response.ok) {
        setActionSuccess("Plan approved! Task queued for execution.");
        setTimeout(() => setActionSuccess(null), 3000);
        fetchData();
      } else {
        const err = await response.json();
        setActionError(err.error || "Failed to approve plan");
        setTimeout(() => setActionError(null), 5000);
      }
    } catch (err) {
      setActionError("Failed to approve plan");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setActionLoading(null);
    }
  };

  const [planFeedbackInput, setPlanFeedbackInput] = useState<{ [taskId: string]: string }>({});
  const [showFeedbackInput, setShowFeedbackInput] = useState<string | null>(null);

  const handleRequestPlanChanges = async (taskId: string) => {
    const feedback = planFeedbackInput[taskId];
    if (!feedback?.trim()) {
      setActionError("Please provide feedback for the planner");
      setTimeout(() => setActionError(null), 3000);
      return;
    }
    setActionLoading(taskId);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/tasks/${taskId}/plan/request-changes`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ feedback }),
      });
      if (response.ok) {
        setActionSuccess("Feedback sent! Planner will revise the plan.");
        setTimeout(() => setActionSuccess(null), 3000);
        setShowFeedbackInput(null);
        setPlanFeedbackInput((prev) => ({ ...prev, [taskId]: "" }));
        fetchData();
      } else {
        const err = await response.json();
        setActionError(err.error || "Failed to request changes");
        setTimeout(() => setActionError(null), 5000);
      }
    } catch (err) {
      setActionError("Failed to request changes");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setActionLoading(null);
    }
  };

  // Fetch projects for internal task creation
  const fetchInternalProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/projects`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setInternalProjects(data.projects.filter((p: { isArchived: boolean }) => !p.isArchived));
      }
    } catch (err) {
      console.error("Failed to fetch projects:", err);
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  // Fetch tasks for a specific project (only Ready/Backlog tasks that aren't assigned)
  const fetchProjectTasks = useCallback(async (projectId: string) => {
    if (!projectId) {
      setInternalTasks([]);
      return;
    }
    setTasksLoading(true);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/projects/${projectId}/board`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        // Flatten tasks from columns, filter to ready/backlog tasks without workerTaskId
        const availableTasks: Array<{ taskKey: string; title: string; persona: string | null; columnType: string }> = [];
        for (const column of data.columns) {
          if (column.columnType === "ready" || column.columnType === "backlog") {
            for (const task of column.tasks) {
              if (!task.workerTaskId) {
                availableTasks.push({
                  taskKey: task.taskKey,
                  title: task.title,
                  persona: task.persona,
                  columnType: column.columnType,
                });
              }
            }
          }
        }
        setInternalTasks(availableTasks);
      }
    } catch (err) {
      console.error("Failed to fetch project tasks:", err);
    } finally {
      setTasksLoading(false);
    }
  }, []);

  // Load projects when switching to internal source
  useEffect(() => {
    if (taskSource === "internal" && internalProjects.length === 0) {
      fetchInternalProjects();
    }
  }, [taskSource, internalProjects.length, fetchInternalProjects]);

  // Load tasks when project is selected
  useEffect(() => {
    if (selectedProjectId) {
      fetchProjectTasks(selectedProjectId);
      setSelectedTaskKey("");
    }
  }, [selectedProjectId, fetchProjectTasks]);

  const handleCreateTask = async () => {
    setCreateLoading(true);
    try {
      const token = localStorage.getItem("accessToken");

      if (taskSource === "internal") {
        // Assign internal task to worker
        const response = await fetch(`${API_BASE}/api/projects/${selectedProjectId}/tasks/${selectedTaskKey}/assign`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
        if (response.ok) {
          setActionSuccess("Task assigned to worker successfully");
          setTimeout(() => setActionSuccess(null), 3000);
          setShowCreateTaskModal(false);
          setTaskSource("external");
          setSelectedProjectId("");
          setSelectedTaskKey("");
          setInternalTasks([]);
          fetchData();
        } else {
          const err = await response.json();
          setActionError(err.error || "Failed to assign task");
          setTimeout(() => setActionError(null), 5000);
        }
      } else {
        // Create task from Jira/Linear issue
        const response = await fetch(`${API_BASE}/api/tasks`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(createTaskForm),
        });
        if (response.ok) {
          setActionSuccess("Task created successfully");
          setTimeout(() => setActionSuccess(null), 3000);
          setShowCreateTaskModal(false);
          setCreateTaskForm({ jiraIssueKey: "", workerPersona: "" });
          setCostEstimate(null);
          fetchData();
        } else {
          const err = await response.json();
          setActionError(err.error || "Failed to create task");
          setTimeout(() => setActionError(null), 5000);
        }
      }
    } catch (err) {
      setActionError("Failed to create task");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setCreateLoading(false);
    }
  };

  const fetchCostEstimate = async (jiraKey: string) => {
    if (!jiraKey || jiraKey.length < 3) {
      setCostEstimate(null);
      return;
    }

    setCostEstimateLoading(true);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/analytics/estimate-cost/${jiraKey}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setCostEstimate({
          tier: data.assessment.tier,
          costRange: data.assessment.estimatedCostRange,
          tokenRange: data.assessment.estimatedTokenRange,
          confidence: data.assessment.confidence,
          tierDescription: data.assessment.tierDescription,
          historicalBasis: data.historicalBasis || 0,
        });
      } else {
        setCostEstimate(null);
      }
    } catch {
      setCostEstimate(null);
    } finally {
      setCostEstimateLoading(false);
    }
  };

  const toggleTerminal = (taskId: string, taskStatus: string) => {
    const isCompletedTask = TERMINAL_STATUSES.includes(taskStatus);

    if (isCompletedTask) {
      // For completed tasks: toggle shownTerminals (default is hidden)
      setShownTerminals((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(taskId)) {
          newSet.delete(taskId);
        } else {
          newSet.add(taskId);
        }
        return newSet;
      });
    } else {
      // For active tasks: toggle hiddenTerminals (default is shown)
      setHiddenTerminals((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(taskId)) {
          newSet.delete(taskId);
        } else {
          newSet.add(taskId);
        }
        return newSet;
      });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
      case "deployed":
        return "text-green-500";
      case "executing":
        return "text-blue-500";
      case "planning":
        return "text-cyan-500";
      case "pending_plan_approval":
        return "text-amber-500";
      case "queued":
      case "claimed":
      case "environment_setup":
        return "text-yellow-500";
      case "failed":
        return "text-red-500";
      case "blocked":
      case "revision_needed":
      case "escalated":
        return "text-orange-500";
      case "cancelled":
        return "text-gray-500";
      case "pr_created":
      case "review_pending":
      case "review_requested":
        return "text-purple-500";
      case "manager_review":
        return "text-indigo-500";
      case "review_approved":
      case "pr_approved":
        return "text-blue-500";
      case "review_rejected":
        return "text-red-400";
      case "deployment_pending":
      case "deploying":
        return "text-blue-400";
      default:
        return "text-muted-foreground";
    }
  };

  const getPersonaInfo = (persona: string) => {
    return (
      PERSONA_CONFIG[persona] || {
        emoji: "🤖",
        title: persona,
        description: "AI Worker",
        skills: [],
      }
    );
  };

  // Helper to detect Epic tasks
  function isEpicTask(task: ActiveTask): boolean {
    return task.pipelineVersion === "v2" ||
      task.isRalphTask === true ||
      task.isEpicWorkflow === true ||
      task.executionMode === "parallel" ||
      task.executionMode === "multi-expert" ||
      (task.childTaskIds !== undefined && task.childTaskIds.length > 0);
  }

  // Helper for Epic progress calculation
  function getEpicProgress(task: ActiveTask): number {
    // Use Epic progress from API (calculated from child task statuses)
    if (task.epicProgress !== undefined && task.storiesTotal && task.storiesTotal > 0) {
      return task.epicProgress;
    }

    // Legacy: Use Ralph progress if available
    if (task.ralphProgress) {
      const { completedStories = 0, totalStories } = task.ralphProgress;
      return totalStories > 0 ? Math.round((completedStories / totalStories) * 100) : 0;
    }

    // Fallback: show 0% if we have stories in the plan
    if (task.planJson?.stories && task.planJson.stories.length > 0) {
      return 0;
    }

    return 0;
  }

  // Workflow mode badge styling
  const getWorkflowModeBadge = (mode?: WorkflowMode) => {
    switch (mode) {
      case "default":
        return { label: "Standard", color: "bg-gray-500/20 text-gray-400 border-gray-500/30", icon: GitPullRequest };
      case "review":
        return { label: "Auto Review", color: "bg-purple-500/20 text-purple-400 border-purple-500/30", icon: Users };
      case "auto_deploy":
        return { label: "Auto-Deploy", color: "bg-green-500/20 text-green-400 border-green-500/30", icon: Rocket };
      case "manager":
        return { label: "Manager", color: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30", icon: Wrench };
      case "review_manager":
        return { label: "Auto Review + Manager", color: "bg-purple-500/20 text-purple-400 border-purple-500/30", icon: Users };
      case "deploy_manager":
        return { label: "Deploy + Manager", color: "bg-green-500/20 text-green-400 border-green-500/30", icon: Rocket };
      default:
        return { label: "Standard", color: "bg-gray-500/20 text-gray-400 border-gray-500/30", icon: GitPullRequest };
    }
  };

  // Only show full-page loading on very first mount (no data at all)
  // This prevents flickering when data already exists from SSE updates
  if (loading && !data) {
    return <DashboardSkeleton />;
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <AlertCircle className="w-12 h-12 text-red-500" />
        <p className="text-lg text-red-500">{error}</p>
        <button
          onClick={fetchData}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Background effects */}
      <div className="fixed inset-0 bg-grid-pattern pointer-events-none opacity-50" />
      <div className="fixed inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5 pointer-events-none" />

      {/* Floating orbs */}
      <div className="orb orb-primary w-[600px] h-[600px] -top-40 -left-40 opacity-30" />
      <div className="orb orb-accent w-[500px] h-[500px] top-1/3 -right-40 opacity-30" style={{ animationDelay: '-4s' }} />
      <div className="orb orb-primary w-[400px] h-[400px] bottom-20 left-1/4 opacity-20" style={{ animationDelay: '-2s' }} />

      {/* Header */}
      <header className="border-b border-border/30 glass-strong sticky top-0 z-10">
        <div className="max-w-full mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-shrink-0">
            <Link to="/" className="group">
              <h1 className="text-xl font-bold text-gradient-animated group-hover:opacity-80 transition-opacity">
                WorkerMill
              </h1>
            </Link>

            {/* Org Switcher - appears when user has multiple orgs */}
            <OrgSwitcher />

            {/* Divider */}
            <div className="w-px h-6 bg-border/50" />

            {/* System On/Off Toggle - Maintenance Mode */}
            <button
              onClick={toggleSystem}
              disabled={systemToggleLoading}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                systemEnabled
                  ? "bg-green-500/10 text-green-500 border border-green-500/30 hover:bg-green-500/20"
                  : "bg-yellow-500/10 text-yellow-600 border border-yellow-500/30 hover:bg-yellow-500/20"
              } ${systemToggleLoading ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {systemToggleLoading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : systemEnabled ? (
                <Power className="w-4 h-4" />
              ) : (
                <Wrench className="w-4 h-4" />
              )}
              {systemEnabled ? "System ON" : "Maintenance Mode"}
            </button>

            {/* Run Task Button */}
            <button
              onClick={() => setShowCreateTaskModal(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-blue-500/10 text-blue-500 border border-blue-500/30 hover:bg-blue-500/20 transition-all"
            >
              <Play className="w-4 h-4" />
              Run Task
            </button>
          </div>

          {/* Stats Bar - Compact horizontal stats */}
          <div className="flex items-center gap-2 flex-1 justify-center">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
              <Activity className="w-4 h-4 text-yellow-500" />
              <span className="text-sm font-semibold text-yellow-500">{data?.stats.queueDepth || 0}</span>
              <span className="text-xs text-muted-foreground">Queued</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
              <Zap className="w-4 h-4 text-cyan-500" />
              <span className="text-sm font-semibold text-cyan-500">{data?.activeTasks?.length || 0}</span>
              <span className="text-xs text-muted-foreground">Active</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span className="text-sm font-semibold text-green-500">{data?.stats.periodCompleted || 0}</span>
              <span className="text-xs text-muted-foreground">Done</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20">
              <XCircle className="w-4 h-4 text-red-500" />
              <span className="text-sm font-semibold text-red-500">{data?.stats.periodFailed || 0}</span>
              <span className="text-xs text-muted-foreground">Failed</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20">
              <DollarSign className="w-4 h-4 text-accent" />
              <span className="text-sm font-semibold text-accent">${formatCost(data?.stats.cumulativeCost)}</span>
              <span className="text-xs text-muted-foreground">Cost</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Insights Dropdown */}
            <div ref={efficiencyDropdownRef} className="relative">
              <button
                onClick={() => setIsEfficiencyDropdownOpen(!isEfficiencyDropdownOpen)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors ${isEfficiencyDropdownOpen ? 'bg-muted text-foreground' : ''}`}
              >
                <Zap className="w-4 h-4" />
                <span className="text-sm font-medium">Insights</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${isEfficiencyDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              {isEfficiencyDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-48 rounded-xl bg-card border border-border shadow-xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="py-1">
                    <Link
                      to="/analytics"
                      onClick={() => setIsEfficiencyDropdownOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <BarChart3 className="w-4 h-4 text-muted-foreground" />
                      Analytics
                    </Link>
                    <Link
                      to="/cost-intelligence"
                      onClick={() => setIsEfficiencyDropdownOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <DollarSign className="w-4 h-4 text-muted-foreground" />
                      Cost Intelligence
                    </Link>
                    <Link
                      to="/memory"
                      onClick={() => setIsEfficiencyDropdownOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <Brain className="w-4 h-4 text-muted-foreground" />
                      Memory Management
                    </Link>
                    <Link
                      to="/skills"
                      onClick={() => setIsEfficiencyDropdownOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <BookOpen className="w-4 h-4 text-muted-foreground" />
                      Skill Library
                    </Link>
                    <Link
                      to="/directive-effectiveness"
                      onClick={() => setIsEfficiencyDropdownOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <Target className="w-4 h-4 text-muted-foreground" />
                      Directive Analytics
                    </Link>
                  </div>
                </div>
              )}
            </div>

            {/* Documentation Dropdown */}
            <div ref={docsDropdownRef} className="relative">
              <button
                onClick={() => setIsDocsDropdownOpen(!isDocsDropdownOpen)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors ${isDocsDropdownOpen ? 'bg-muted text-foreground' : ''}`}
              >
                <Book className="w-4 h-4" />
                <span className="text-sm font-medium">Docs</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${isDocsDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              {isDocsDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-56 rounded-xl bg-card border border-border shadow-xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="py-1">
                    <Link
                      to="/docs"
                      onClick={() => setIsDocsDropdownOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <Book className="w-4 h-4 text-muted-foreground" />
                      Overview
                    </Link>
                    <Link
                      to="/docs/quick-start"
                      onClick={() => setIsDocsDropdownOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <Rocket className="w-4 h-4 text-muted-foreground" />
                      Quick Start
                    </Link>
                    <Link
                      to="/docs/task-lifecycle"
                      onClick={() => setIsDocsDropdownOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <Activity className="w-4 h-4 text-muted-foreground" />
                      Task Lifecycle
                    </Link>
                    <Link
                      to="/docs/advanced-features"
                      onClick={() => setIsDocsDropdownOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <Layers className="w-4 h-4 text-muted-foreground" />
                      Advanced Features
                    </Link>
                    <Link
                      to="/docs/personas"
                      onClick={() => setIsDocsDropdownOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <Users className="w-4 h-4 text-muted-foreground" />
                      Personas
                    </Link>
                    <Link
                      to="/docs/integrations"
                      onClick={() => setIsDocsDropdownOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <Network className="w-4 h-4 text-muted-foreground" />
                      Integrations
                    </Link>
                    <Link
                      to="/docs/severity"
                      onClick={() => setIsDocsDropdownOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <AlertCircle className="w-4 h-4 text-muted-foreground" />
                      Severity Levels
                    </Link>
                    <Link
                      to="/docs/metrics"
                      onClick={() => setIsDocsDropdownOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <LayoutDashboard className="w-4 h-4 text-muted-foreground" />
                      Metrics & Analytics
                    </Link>
                  </div>
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="w-px h-6 bg-border/50" />

            {/* Profile Dropdown */}
            <ProfileDropdown onShowQuickStart={resetOnboarding} />
          </div>
        </div>
      </header>

      {/* Maintenance Mode Banner */}
      {!systemEnabled && (
        <div className="bg-yellow-500/10 border-b border-yellow-500/30 px-4 py-3">
          <div className="max-w-full mx-auto flex items-center gap-3 px-2">
            <div className="flex-shrink-0">
              <Wrench className="w-5 h-5 text-yellow-500" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
                System Maintenance in Progress
              </p>
              <p className="text-xs text-yellow-600/80 dark:text-yellow-400/80 mt-0.5">
                New tasks will be queued and will automatically resume when maintenance completes.
              </p>
            </div>
            <div className="flex-shrink-0 flex items-center gap-3">
              {(data?.stats?.queueDepth ?? 0) > 0 && (
                <span className="text-xs text-yellow-600/80 dark:text-yellow-400/80">
                  {data?.stats?.queueDepth} task{(data?.stats?.queueDepth ?? 0) !== 1 ? "s" : ""} queued
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 text-xs font-medium">
                <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
                Maintenance Mode
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Success/Error Alerts */}
      {actionSuccess && (
        <div className="max-w-7xl mx-auto px-6 pt-4">
          <div className="bg-green-500/10 border border-green-500/30 text-green-500 px-4 py-3 rounded-lg flex items-center justify-between">
            {actionSuccess}
            <button onClick={() => setActionSuccess(null)} className="font-bold">&times;</button>
          </div>
        </div>
      )}
      {actionError && (
        <div className="max-w-7xl mx-auto px-6 pt-4">
          <div className="bg-red-500/10 border border-red-500/30 text-red-500 px-4 py-3 rounded-lg flex items-center justify-between">
            {actionError}
            <button onClick={() => setActionError(null)} className="font-bold">&times;</button>
          </div>
        </div>
      )}

      {/* Main Layout - Flex container for main content + sidebar */}
      <div className="flex min-h-[calc(100vh-80px)]">
        {/* Main Content */}
        <main className="flex-1 overflow-auto p-6 space-y-6">
          <ErrorBoundaryWithRetry fallback={<DashboardErrorFallback />}>
          {/* Active Workflows */}
          <div className="card-elevated border border-border/50 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-border/50 bg-gradient-to-r from-primary/10 to-transparent flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Zap className="w-5 h-5 text-primary" />
                Active Workflows
                {data?.activeTasks && data.activeTasks.length > 0 && (
                  <span className="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-primary/20 text-primary animate-pulse">
                    {data.activeTasks.length} running
                  </span>
                )}
              </h2>
              <div className="flex items-center gap-2">
                {/* Auto-Review Toggle */}
                <button
                  onClick={toggleAutoReview}
                  disabled={autoToggleLoading === "review"}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors ${
                    autoReviewEnabled
                      ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/50"
                      : "bg-muted/50 text-muted-foreground border border-border hover:border-indigo-500/30"
                  } ${autoToggleLoading === "review" ? "opacity-50 cursor-not-allowed" : ""}`}
                  title={autoReviewEnabled ? "Auto-review enabled for all tasks" : "Click to enable auto-review"}
                >
                  {autoToggleLoading === "review" ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                  Review {autoReviewEnabled ? "ON" : "OFF"}
                </button>

                {/* Auto-Deploy Toggle */}
                <button
                  onClick={toggleAutoDeploy}
                  disabled={autoToggleLoading === "deploy"}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors ${
                    autoDeployEnabled
                      ? "bg-green-500/20 text-green-400 border border-green-500/50"
                      : "bg-muted/50 text-muted-foreground border border-border hover:border-green-500/30"
                  } ${autoToggleLoading === "deploy" ? "opacity-50 cursor-not-allowed" : ""}`}
                  title={autoDeployEnabled ? "Auto-deploy enabled for all tasks" : "Click to enable auto-deploy"}
                >
                  {autoToggleLoading === "deploy" ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Rocket className="w-3.5 h-3.5" />
                  )}
                  Deploy {autoDeployEnabled ? "ON" : "OFF"}
                </button>

                {/* Auto-Improve Toggle */}
                <button
                  onClick={toggleAutoImprove}
                  disabled={autoToggleLoading === "improve"}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors ${
                    autoImproveEnabled
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/50"
                      : "bg-muted/50 text-muted-foreground border border-border hover:border-amber-500/30"
                  } ${autoToggleLoading === "improve" ? "opacity-50 cursor-not-allowed" : ""}`}
                  title={autoImproveEnabled ? "Auto-improve enabled - will analyze tasks and improve WorkerMill" : "Click to enable auto-improve"}
                >
                  {autoToggleLoading === "improve" ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  Improve {autoImproveEnabled ? "ON" : "OFF"}
                </button>

                {/* Talk to Worker Button */}
                <button
                  onClick={() => setIsTalkOpen(true)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-background hover:bg-cyan-500/10 border border-border/50 hover:border-cyan-500/50 rounded-lg text-muted-foreground hover:text-cyan-400 transition-colors text-sm"
                  title="Send a message to running workers"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>Talk</span>
                </button>

                {/* Search Button */}
                <button
                  onClick={() => setIsLogSearchOpen(true)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-background hover:bg-muted/50 border border-border/50 rounded-lg text-muted-foreground hover:text-foreground transition-colors text-sm"
                  title="Search all task logs"
                >
                  <Search className="w-4 h-4" />
                  <span>Search tasks and logs...</span>
                </button>
              </div>
            </div>
            <div className="divide-y divide-border">
              {data?.activeTasks && data.activeTasks.length > 0 ? (
                data.activeTasks.map((task, index, filteredTasks) => {
                  // Find the first actively running (non-terminal) task
                  const firstActiveIndex = filteredTasks.findIndex(t => !TERMINAL_STATUSES.includes(t.status));
                  const isFirstActiveTask = index === firstActiveIndex;
                  const isCompletedTask = TERMINAL_STATUSES.includes(task.status);

                  // Terminal visibility logic:
                  // - First active task: expanded by default (unless manually hidden)
                  // - Completed tasks: collapsed by default (unless manually shown)
                  // - Other active tasks: expanded by default (unless manually hidden)
                  const isTerminalVisible = isCompletedTask
                    ? shownTerminals.has(task.id)  // Completed: collapsed unless manually shown
                    : isFirstActiveTask
                      ? !hiddenTerminals.has(task.id)  // First active: visible unless manually hidden
                      : !hiddenTerminals.has(task.id);  // Other active: visible unless manually hidden
                  const workerId = task.id.slice(0, 8);
                  return (
                    <div key={task.id} className="p-4">
                      {/* Task Header */}
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          {/* Persona Icon + Name */}
                          <div className="flex items-center gap-3">
                            {/* Show Planner during planning phases */}
                            {(task.status === "planning" || task.status === "pending_plan_approval") ? (
                              <>
                                <span className="text-4xl">📋</span>
                                <span className="text-xl font-medium text-foreground">
                                  Project Manager
                                </span>
                                {task.status === "pending_plan_approval" && (
                                  <span className="text-primary text-sm">
                                    (awaiting your approval)
                                  </span>
                                )}
                              </>
                            ) : task.status === "manager_review" && task.managerEcsTaskId ? (
                              /* Show Virtual Manager when manager_review is active */
                              <>
                                <span className="text-4xl">👔</span>
                                <span className="text-xl font-medium text-foreground">
                                  Virtual Manager
                                </span>
                                <span className="text-muted-foreground text-sm">
                                  (reviewing {getPersonaInfo(task.workerPersona).title}'s PR)
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="text-4xl">
                                  {getPersonaInfo(task.workerPersona).emoji}
                                </span>
                                <span className="text-xl font-medium text-foreground">
                                  {getPersonaInfo(task.workerPersona).title}
                                </span>
                              </>
                            )}
                          </div>
                          <span className="text-muted-foreground">•</span>
                          <a
                            href={`https://oncallshift.atlassian.net/browse/${task.jiraIssueKey}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline font-medium flex items-center gap-1"
                          >
                            {task.jiraIssueKey}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                          <span className="text-muted-foreground">{task.summary}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Workflow Mode Badge - Shows compound labels for modifiers (review, deploy, improve) */}
                          {(() => {
                            const isReview = task.workflowMode === "review" || task.workflowMode === "review_manager";
                            const isDeploy = task.workflowMode === "auto_deploy" || task.workflowMode === "deploy_manager";
                            const hasManager = task.managerEnabled;

                            // Build compound label parts (no longer includes Epic/Multi-Provider)
                            const parts: string[] = [];

                            if (isReview) parts.push("Review");
                            if (isDeploy) parts.push("Deploy");
                            if (hasManager) parts.push("Improve");

                            // Show compound badge if any modifiers are present
                            if (parts.length > 0) {
                              const label = parts.join(" + ");
                              return (
                                <span className="text-xs px-2 py-0.5 rounded-full border flex items-center gap-1 bg-purple-500/20 text-purple-400 border-purple-500/30">
                                  <Zap className="w-3 h-3" />
                                  {label}
                                </span>
                              );
                            }

                            // No modifiers - don't show a badge
                            return null;
                          })()}
                          {/* PRD Progress indicator */}
                          {(task.isRalphTask || task.status === "planning" || task.status === "pending_plan_approval" || task.status === "dispatching" || (task.childTaskIds && task.childTaskIds.length > 0) || (task.planJson?.steps && task.planJson.steps.length > 1)) && (
                            <>
                              {task.ralphProgress && (
                                <RalphProgressCompact progress={task.ralphProgress} />
                              )}
                              {task.status === "dispatching" && (
                                <button
                                  onClick={() => handlePauseAllChildren(task.id)}
                                  disabled={actionLoading === task.id}
                                  className="text-xs px-2 py-0.5 rounded-full border border-yellow-500/50 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20 flex items-center gap-1 transition-colors"
                                  title="Pause All Child Tasks"
                                >
                                  <PauseCircle className="w-3 h-3" />
                                  Pause All
                                </button>
                              )}
                            </>
                          )}
                          {/* Checkpoint Badge - Only show for in-progress tasks */}
                          {task.hasCheckpoint && task.status !== 'completed' && task.status !== 'failed' && (
                            <CheckpointStatusBadge checkpoint={{
                              hasCheckpoint: task.hasCheckpoint,
                              checkpointStage: task.checkpointStage || null,
                              resumeCount: task.resumeCount || 0,
                              checkpointSavedAt: task.checkpointSavedAt || null,
                            }} />
                          )}
                          {/* Show all models used (planning + execution) with "+" separator */}
                          {(() => {
                            const models = getDerivedModels(task);
                            if (models.length === 0) return null;
                            return (
                              <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground flex items-center gap-1">
                                {models.map((m, i) => (
                                  <span key={`${m}-${i}`} className="flex items-center">
                                    {i > 0 && <span className="mx-0.5 text-muted-foreground/50">+</span>}
                                    <span>{m}</span>
                                  </span>
                                ))}
                              </span>
                            );
                          })()}
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${getStatusColor(task.status)} bg-current/10`}>
                            {task.status}
                          </span>
                          {/* Real-time Cost Badge with trend and ceiling warning */}
                          {task.estimatedCostUsd > 0 && (
                            <span
                              className={`text-xs px-2 py-1 rounded flex items-center gap-1 transition-all ${
                                task.costCeilingPercent && task.costCeilingPercent >= 95
                                  ? "bg-red-500/20 text-red-500 border border-red-500/50 animate-pulse"
                                  : task.costCeilingPercent && task.costCeilingPercent >= 80
                                    ? "bg-amber-500/20 text-amber-500 border border-amber-500/50"
                                    : "bg-green-500/10 text-green-500 border border-green-500/30"
                              }`}
                              title={
                                task.costCeilingPercent
                                  ? `${task.costCeilingPercent.toFixed(0)}% of cost ceiling`
                                  : "Estimated cost"
                              }
                            >
                              {task.costCeilingPercent && task.costCeilingPercent >= 80 ? (
                                <AlertTriangle className="w-3 h-3" />
                              ) : (
                                <DollarSign className="w-3 h-3" />
                              )}
                              {formatCost(task.estimatedCostUsd)}
                              {task.costTrend === "up" && (
                                <TrendingUp className="w-3 h-3 animate-bounce" />
                              )}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Workflow Stage Progress - Horizontal with icons */}
                      <div className="flex items-center mb-4">
                        {task.steps.map((step, idx) => {
                          const StepIcon = step.icon === "queued" ? Clock :
                                          step.icon === "executing" ? Cog :
                                          step.icon === "pr_created" ? PRCreatedIcon :
                                          step.icon === "review" ? ReviewIcon :
                                          step.icon === "manager_review" ? ReviewIcon :
                                          step.icon === "approved" ? ApprovedIcon :
                                          step.icon === "deploying" ? DeployedIcon :
                                          step.icon === "deployed" ? DeployedIcon :
                                          step.icon === "complete" ? GitMerge :
                                          step.icon === "waiting" ? Pause :
                                          step.icon === "experts" ? ExpertsIcon :
                                          step.icon === "coordinating" ? ExpertsIcon :
                                          step.icon === "epic" ? Zap :
                                          step.icon === "planning" ? PlanningIcon :
                                          CheckCircle;
                          const isActive = step.status === "active";
                          const isDone = step.status === "done";
                          const isWaiting = step.status === "waiting";

                          return (
                            <div key={idx} className="flex items-center flex-1">
                              {/* Stage circle with icon */}
                              <div className="flex flex-col items-center">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                                  isDone ? "bg-primary border-primary text-primary-foreground" :
                                  isActive ? "bg-primary/20 border-primary text-primary animate-pulse" :
                                  isWaiting ? "bg-yellow-500/20 border-yellow-500 text-yellow-500" :
                                  "bg-muted border-border text-muted-foreground"
                                }`}>
                                  {isWaiting ? (
                                    <Pause className="w-5 h-5" />
                                  ) : (
                                    <StepIcon className={`w-5 h-5 ${isActive && step.icon === "executing" ? "animate-spin" : ""}`} style={{ animationDuration: "2s" }} />
                                  )}
                                </div>
                                <span className={`text-xs mt-1 whitespace-nowrap ${
                                  isDone || isActive ? "text-foreground" :
                                  isWaiting ? "text-yellow-500" :
                                  "text-muted-foreground"
                                }`}>
                                  {step.name}
                                </span>
                                {/* Show progress under Experts stage */}
                                {step.isParallelStage && (task.storiesTotal || task.ralphProgress) && (
                                  <span className="text-xs text-primary font-medium">
                                    {task.storiesTotal
                                      ? `${task.storiesCompleted || 0}/${task.storiesTotal}`
                                      : task.ralphProgress
                                        ? `${task.ralphProgress.completedStories || 0}/${task.ralphProgress.totalStories}`
                                        : ''
                                    }
                                  </span>
                                )}
                              </div>
                              {/* Connector line (not after last item) */}
                              {idx < task.steps.length - 1 && (
                                <div className={`flex-1 h-0.5 mx-2 ${
                                  isDone ? "bg-primary" :
                                  isWaiting ? "bg-yellow-500/50" :
                                  "bg-border"
                                }`} />
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Ralph Progress - Full display for Ralph tasks */}
                      {task.isRalphTask && task.ralphProgress && (
                        <RalphProgress progress={task.ralphProgress} className="mb-4" />
                      )}

                      {/* Checkpoint Status - Only show for in-progress tasks, not completed/failed */}
                      {task.hasCheckpoint && task.status !== 'completed' && task.status !== 'failed' && (
                        <CheckpointStatus checkpoint={{
                          hasCheckpoint: task.hasCheckpoint,
                          checkpointStage: task.checkpointStage || null,
                          resumeCount: task.resumeCount || 0,
                          checkpointSavedAt: task.checkpointSavedAt || null,
                        }} className="mb-4" />
                      )}

                      {/* Planning Status - Show when planner is analyzing */}
                      {task.status === "planning" && (
                        <div className="mb-4 p-4 border border-primary/30 rounded-lg bg-primary/5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                                <RefreshCw className="w-4 h-4 text-primary animate-spin" />
                              </div>
                              <div>
                                <h3 className="text-base font-semibold text-foreground">Analyzing Task...</h3>
                                <p className="text-sm text-muted-foreground">
                                  Planning Agent is creating an execution plan
                                </p>
                              </div>
                            </div>
                            <button
                              onClick={() => handleCancelTask(task.id)}
                              disabled={actionLoading === task.id}
                              className="flex items-center gap-2 px-4 py-2 text-red-500 hover:bg-red-500/10 rounded-lg"
                            >
                              {actionLoading === task.id ? (
                                <RefreshCw className="w-4 h-4 animate-spin" />
                              ) : (
                                <Ban className="w-4 h-4" />
                              )}
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Pending Plan Approval (no plan yet) - Show cancel option */}
                      {task.status === "pending_plan_approval" && !task.planJson && (
                        <div className="mb-4 p-4 border border-yellow-500/30 rounded-lg bg-yellow-500/5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center">
                                <AlertCircle className="w-4 h-4 text-yellow-500" />
                              </div>
                              <div>
                                <h3 className="text-base font-semibold text-foreground">Plan Not Available</h3>
                                <p className="text-sm text-muted-foreground">
                                  The execution plan is not loaded. Try refreshing the page.
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => window.location.reload()}
                                className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                              >
                                <RefreshCw className="w-4 h-4" />
                                Refresh
                              </button>
                              <button
                                onClick={() => handleCancelTask(task.id)}
                                disabled={actionLoading === task.id}
                                className="flex items-center gap-2 px-4 py-2 text-red-500 hover:bg-red-500/10 rounded-lg"
                              >
                                {actionLoading === task.id ? (
                                  <RefreshCw className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Ban className="w-4 h-4" />
                                )}
                                Cancel
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Plan Display - Only shows for pending approval */}
                      {task.planJson && task.status === "pending_plan_approval" && (
                        <div className="mb-4 border rounded-lg border-primary/30 bg-primary/5">
                          {/* Header */}
                          <div className="flex items-center gap-2 p-4">
                            {isEpicTask(task) ? (
                              <Layers className="w-5 h-5 text-primary" />
                            ) : (
                              <Book className="w-5 h-5 text-primary" />
                            )}
                            <h3 className="text-lg font-semibold text-foreground">
                              Execution Plan Ready
                            </h3>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                              Awaiting Approval
                            </span>
                          </div>

                          {/* Plan content */}
                          <div className="px-4 pb-4">
                          {/* Execution Flow Diagram - Top, Full Width */}
                          {task.planJson.stories && task.planJson.stories.length > 1 && (
                            <div className="mb-4 p-4 bg-muted/30 rounded-lg border border-border/50">
                              <div className="flex items-center gap-2 mb-3">
                                <Network className="w-4 h-4 text-primary" />
                                <span className="text-sm font-medium text-foreground">Execution Flow</span>
                              </div>
                              <div className="flex justify-center">
                                <EmbeddedDependencyGraph stories={task.planJson.stories} parentTaskStatus={task.status} />
                              </div>
                            </div>
                          )}

                          {/* Plan Details - Below Diagram */}
                          <div className="space-y-3 mb-4">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-muted-foreground text-sm">Strategy:</span>
                              <span className={`text-sm font-medium px-2 py-0.5 rounded ${
                                task.planJson.strategy === "multi" || (task.planJson.steps && task.planJson.steps.length > 1)
                                  ? "bg-purple-500/20 text-purple-500"
                                  : "bg-blue-500/20 text-blue-500"
                              }`}>
                                {task.planJson.strategy === "multi" ? "Multi-Story" :
                                 task.planJson.steps && task.planJson.steps.length > 1 ? `Multi-Persona (${task.planJson.steps.length} steps)` :
                                 "Single Task"}
                              </span>
                              {task.planJson.primaryPersona && (
                                <span className="text-sm text-muted-foreground">
                                  → {getPersonaInfo(task.planJson.primaryPersona).emoji}{" "}
                                  {getPersonaInfo(task.planJson.primaryPersona).title}
                                </span>
                              )}
                            </div>

                            <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded border border-border/50">
                              <span className="font-medium text-foreground">Reasoning:</span>{" "}
                              {task.planJson.reasoning}
                            </div>

                            {task.planJson.stories && task.planJson.stories.length > 0 && (
                              <div className="space-y-2">
                                <span className="text-sm font-medium text-foreground">
                                  Stories ({task.planJson.stories.length}):
                                </span>
                                <div className="space-y-1">
                                  {task.planJson.stories.map((story, idx) => (
                                    <div
                                      key={idx}
                                      className="flex items-center gap-2 text-sm text-muted-foreground pl-2 border-l-2 border-border flex-wrap"
                                    >
                                      <span className="font-mono text-xs text-muted-foreground">
                                        {story.index}.
                                      </span>
                                      <span>{getPersonaInfo(story.persona).emoji}</span>
                                      <span className="text-foreground">{story.title}</span>
                                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                                        story.estimatedComplexity === "large"
                                          ? "bg-red-500/20 text-red-500"
                                          : story.estimatedComplexity === "medium"
                                            ? "bg-yellow-500/20 text-yellow-500"
                                            : "bg-green-500/20 text-green-500"
                                      }`}>
                                        {story.estimatedComplexity}
                                      </span>
                                      {story.dependencies.length > 0 && (
                                        <span className="text-xs text-muted-foreground">
                                          (needs: {story.dependencies.join(", ")})
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {task.planJson.qualityGates && task.planJson.qualityGates.length > 0 && (
                              <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded border border-border/50">
                                <span className="font-medium text-foreground">Quality Gates:</span>{" "}
                                {task.planJson.qualityGates.join(", ")}
                              </div>
                            )}
                          </div>

                          {/* Action Buttons - Only show when pending approval */}
                          {task.status === "pending_plan_approval" && (
                            <>
                              {/* Feedback Input (when requesting changes) */}
                              {showFeedbackInput === task.id && (
                                <div className="mb-4">
                                  <textarea
                                    value={planFeedbackInput[task.id] || ""}
                                    onChange={(e) =>
                                      setPlanFeedbackInput((prev) => ({
                                        ...prev,
                                        [task.id]: e.target.value,
                                      }))
                                    }
                                    placeholder="Describe what changes you'd like to the plan..."
                                    className="w-full p-3 text-sm border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary focus:border-transparent"
                                    rows={3}
                                  />
                                </div>
                              )}

                              <div className="flex items-center gap-3">
                                <button
                                  onClick={() => handleApprovePlan(task.id)}
                                  disabled={actionLoading === task.id}
                                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-medium"
                                >
                                  {actionLoading === task.id ? (
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <CheckCircle className="w-4 h-4" />
                                  )}
                                  Approve & Execute
                                </button>

                                {showFeedbackInput === task.id ? (
                                  <>
                                    <button
                                      onClick={() => handleRequestPlanChanges(task.id)}
                                      disabled={actionLoading === task.id || !planFeedbackInput[task.id]?.trim()}
                                      className="flex items-center gap-2 px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 disabled:opacity-50 font-medium"
                                    >
                                      <Send className="w-4 h-4" />
                                      Send Feedback
                                    </button>
                                    <button
                                      onClick={() => setShowFeedbackInput(null)}
                                      className="px-4 py-2 text-muted-foreground hover:text-foreground"
                                    >
                                      Cancel
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    onClick={() => setShowFeedbackInput(task.id)}
                                    className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                                  >
                                    <Sliders className="w-4 h-4" />
                                    Request Changes
                                  </button>
                                )}

                                <button
                                  onClick={() => handleCancelTask(task.id)}
                                  disabled={actionLoading === task.id}
                                  className="ml-auto flex items-center gap-2 px-4 py-2 text-red-500 hover:bg-red-500/10 rounded-lg"
                                >
                                  <Ban className="w-4 h-4" />
                                  Cancel
                                </button>
                              </div>
                            </>
                          )}
                            </div>
                        </div>
                      )}

                      {/* Terminal Toggle Button */}
                      <div className="flex items-center justify-between mb-2">
                        <button
                          onClick={() => toggleTerminal(task.id, task.status)}
                          className="flex items-center gap-2 px-2 py-1 text-xs rounded border border-border hover:bg-muted transition-colors"
                        >
                          <Terminal className="w-3 h-3" />
                          {isTerminalVisible ? "Hide" : "Show"} Terminal Output
                          {isTerminalVisible && (
                            <span className="flex items-center gap-1 text-green-500">
                              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                              LIVE
                            </span>
                          )}
                        </button>
                        <button
                          onClick={() => handleCancelTask(task.id)}
                          disabled={actionLoading === task.id}
                          className="p-1.5 hover:bg-red-500/10 rounded text-red-500"
                          title="Cancel Task"
                        >
                          {actionLoading === task.id ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <Ban className="w-4 h-4" />
                          )}
                        </button>
                      </div>

                      {/* Color Legend */}
                      {isTerminalVisible && (
                        <div className="flex flex-wrap items-center gap-3 mb-2 text-xs text-muted-foreground">
                          <span className="font-medium">Legend:</span>
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-red-400" />
                            <span>Fatal Errors</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-yellow-400" />
                            <span>Warnings</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-cyan-400" />
                            <span>Worker/System</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-green-400" />
                            <span>Success</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-purple-400" />
                            <span>Commands</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-gray-300" />
                            <span>Default</span>
                          </span>
                        </div>
                      )}

                      {/* Providers Legend - below color legend */}
                      {isTerminalVisible && (() => {
                        const providers =
                          task.providersUsed && task.providersUsed.length > 0
                            ? task.providersUsed
                            : getDerivedProviders(task);
                        if (providers.length === 0) return null;
                        return (
                          <div className="flex flex-wrap items-center gap-3 mb-2 text-xs text-muted-foreground">
                            <span className="font-medium">Providers:</span>
                            {providers.map((p) => {
                              const { name, icon } = formatProviderName(p);
                              return (
                                <span key={p} className="flex items-center gap-1">
                                  <span>{icon}</span>
                                  <span>{name}</span>
                                </span>
                              );
                            })}
                          </div>
                        );
                      })()}

                      {/* Terminal Output with Error Panel - side by side */}
                      {isTerminalVisible && (
                        <div className="mt-2 flex gap-2">
                          {/* Terminal - takes remaining space after error panel */}
                          <div className="terminal-bg border rounded-lg overflow-hidden flex-1 min-w-0">
                            {/* Terminal header */}
                            <div className="flex items-center justify-between px-3 py-1.5 terminal-header border-b">
                              <div className="flex items-center gap-2">
                                <div className="flex gap-1.5">
                                  <div className="w-3 h-3 rounded-full bg-red-500" />
                                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                                  <div className="w-3 h-3 rounded-full bg-green-500" />
                                </div>
                                <span className="text-xs text-gray-400 font-mono">
                                  worker-{workerId}
                                </span>
                                <span className="text-xs text-green-400 font-mono">
                                  [streaming]
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => setAutoScrollEnabled(!autoScrollEnabled)}
                                  className={`text-xs px-2 py-0.5 rounded ${autoScrollEnabled ? "bg-green-600 text-white" : "bg-gray-600 text-gray-300"}`}
                                  title={autoScrollEnabled ? "Auto-scroll ON - click to disable" : "Auto-scroll OFF - click to enable"}
                                >
                                  {autoScrollEnabled ? "Auto-scroll ON" : "Auto-scroll OFF"}
                                </button>
                                <button
                                  onClick={() => {
                                    const terminalEl = terminalRefs.current[task.id];
                                    if (terminalEl) terminalEl.scrollTop = terminalEl.scrollHeight;
                                  }}
                                  className="text-gray-400 hover:text-white p-1"
                                  title="Scroll to bottom"
                                >
                                  <RefreshCw className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                            {/* Terminal content */}
                            <div
                              ref={(el) => { terminalRefs.current[task.id] = el; }}
                              className="p-3 h-96 overflow-y-auto font-mono text-xs terminal-text leading-relaxed terminal-bg"
                            >
                              {streamingLogs[task.id] && streamingLogs[task.id].length > 0 ? (
                                streamingLogs[task.id]
                                .map((log) => ({
                                  ...log,
                                  // Strip whitespace and collapse multiple newlines to single newlines
                                  message: log.message.trim().replace(/\n{2,}/g, '\n')
                                }))
                                .filter((log) => log.message.length > 0) // Skip empty messages
                                .map((log, idx) => {
                                  // Color based on structured severity field first, then message content
                                  // IMPORTANT: Only show red for explicitly "fatal" errors
                                  // Unclassified errors (during execution) show as muted orange
                                  // Recoverable errors show as muted orange
                                  const msg = log.message;
                                  const isFatalError = log.metadata?.errorType === "fatal";
                                  const isError = log.severity === "error" || log.logType === "error" || msg.includes("[ERROR]") || msg.includes("Error") || msg.includes("error:");
                                  const colorClass =
                                    isError && isFatalError
                                      ? "text-red-400" // Only fatal errors are bright red
                                      : isError
                                        ? "text-orange-300/70" // Unclassified and recoverable errors are muted
                                        : log.severity === "warning" || log.logType === "warning" || msg.includes("[WARN]") || msg.includes("Warning")
                                          ? "text-yellow-400"
                                          : msg.includes("[worker]") || msg.includes("Claude") || msg.includes("Starting")
                                            ? "text-cyan-400"
                                            : msg.includes("[SUCCESS]") || msg.includes("Completed") || msg.includes("success")
                                              ? "text-green-400"
                                              : msg.startsWith("$") || msg.includes("npm ") || msg.includes("git ")
                                                ? "text-purple-400"
                                                : "text-gray-300";

                                  return (
                                    <div
                                      key={idx}
                                      data-log-index={idx}
                                      className={`whitespace-pre-wrap break-all ${colorClass}`}
                                    >
                                      {msg}
                                    </div>
                                  );
                                })
                              ) : (
                                <div className="text-gray-500 flex items-center gap-2">
                                  <RefreshCw className="w-3 h-3 animate-spin" />
                                  Loading logs...
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Side Panel - Tabbed: Errors & Communications */}
                          <div className={`border rounded-lg overflow-hidden bg-card transition-all ${errorPanelExpanded[task.id] ? "w-[30%]" : "w-12"}`}>
                            {/* Panel header - clickable to toggle when collapsed */}
                            {!errorPanelExpanded[task.id] ? (
                              <div
                                className={`flex flex-col items-center gap-1 w-full py-2 cursor-pointer hover:bg-muted/70 transition-colors ${
                                  parsedErrors[task.id]?.some(e => e.category === "Task Failed") ? "bg-red-500/10" :
                                  parsedErrors[task.id]?.length > 0 ? "bg-yellow-500/10" : "bg-muted/50"
                                }`}
                                onClick={() => setErrorPanelExpanded(prev => ({ ...prev, [task.id]: true }))}
                              >
                                <AlertCircle className={`w-4 h-4 ${
                                  parsedErrors[task.id]?.some(e => e.category === "Task Failed") ? "text-red-400" :
                                  parsedErrors[task.id]?.length > 0 ? "text-yellow-400" : "text-muted-foreground"
                                }`} />
                                {parsedErrors[task.id]?.length > 0 && (
                                  <span className={`text-xs font-bold ${
                                    parsedErrors[task.id]?.some(e => e.category === "Task Failed") ? "text-red-400" : "text-yellow-400"
                                  }`}>{parsedErrors[task.id].length}</span>
                                )}
                                <MessageSquare className="w-4 h-4 text-primary mt-1" />
                                <ChevronDown className="w-3 h-3 text-muted-foreground -rotate-90" />
                              </div>
                            ) : (
                              <>
                                {/* Tabs Header */}
                                <div className="flex items-center border-b bg-muted/30">
                                  <button
                                    onClick={() => setPanelActiveTab(prev => ({ ...prev, [task.id]: "errors" }))}
                                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                                      (panelActiveTab[task.id] || "errors") === "errors"
                                        ? "bg-background border-b-2 border-primary text-foreground"
                                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                    }`}
                                  >
                                    <AlertCircle className={`w-3.5 h-3.5 ${
                                      parsedErrors[task.id]?.some(e => e.category === "Task Failed") ? "text-red-400" :
                                      parsedErrors[task.id]?.length > 0 ? "text-yellow-400" : ""
                                    }`} />
                                    Warnings
                                    {parsedErrors[task.id]?.length > 0 && (
                                      <span className={`px-1.5 py-0.5 text-[10px] rounded-full ${
                                        parsedErrors[task.id]?.some(e => e.category === "Task Failed")
                                          ? "bg-red-500/20 text-red-400"
                                          : "bg-yellow-500/20 text-yellow-400"
                                      }`}>
                                        {parsedErrors[task.id].length}
                                      </span>
                                    )}
                                  </button>
                                  <button
                                    onClick={() => {
                                      setPanelActiveTab(prev => ({ ...prev, [task.id]: "comms" }));
                                      // Clear unread count when viewing comms
                                      setUnreadCommsCount(prev => ({ ...prev, [task.id]: 0 }));
                                    }}
                                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                                      panelActiveTab[task.id] === "comms"
                                        ? "bg-background border-b-2 border-primary text-foreground"
                                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                    }`}
                                  >
                                    <MessageSquare className={`w-3.5 h-3.5 ${unreadCommsCount[task.id] > 0 ? "text-cyan-400 animate-pulse" : ""}`} />
                                    Comms
                                    {unreadCommsCount[task.id] > 0 && (
                                      <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-cyan-500/20 text-cyan-400 animate-pulse">
                                        {unreadCommsCount[task.id]}
                                      </span>
                                    )}
                                  </button>
                                  <button
                                    onClick={() => setErrorPanelExpanded(prev => ({ ...prev, [task.id]: false }))}
                                    className="px-2 py-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                                    title="Collapse panel"
                                  >
                                    <ChevronDown className="w-4 h-4 rotate-90" />
                                  </button>
                                </div>

                                {/* Tab Content - Both tabs always mounted to keep SSE alive */}
                                {/* Errors Tab Content */}
                                <div className={`h-96 overflow-y-auto ${(panelActiveTab[task.id] || "errors") === "errors" ? "" : "hidden"}`}>
                                  {parsedErrors[task.id]?.length > 0 ? (
                                    parsedErrors[task.id].map((err, idx) => (
                                      <div
                                        key={idx}
                                        className={`px-3 py-2 border-b border-border/50 hover:bg-muted/30 group ${
                                          err.logIndex >= 0 ? "cursor-pointer" : ""
                                        } ${err.category === "Task Failed" ? "bg-red-500/10" : ""}`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (err.logIndex >= 0) {
                                            const terminalEl = terminalRefs.current[task.id];
                                            if (terminalEl) {
                                              const logLine = terminalEl.querySelector(`[data-log-index="${err.logIndex}"]`);
                                              if (logLine) {
                                                logLine.scrollIntoView({ behavior: "smooth", block: "center" });
                                                logLine.classList.add("bg-yellow-500/20");
                                                setTimeout(() => logLine.classList.remove("bg-yellow-500/20"), 2000);
                                              }
                                            }
                                          }
                                        }}
                                      >
                                        <div className="flex items-start gap-2">
                                          <span className={`mt-0.5 ${err.type === "error" ? "text-red-400" : "text-yellow-400"}`}>
                                            {err.category === "Task Failed" ? "🚨" : err.type === "error" ? "⛔" : "⚠️"}
                                          </span>
                                          <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 text-xs">
                                              <span className="text-muted-foreground">
                                                {new Date(err.timestamp).toLocaleTimeString()}
                                              </span>
                                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                                err.category === "Task Failed" ? "bg-red-600/30 text-red-300 font-bold" :
                                                err.category === "TypeScript" ? "bg-blue-500/20 text-blue-400" :
                                                err.category === "Git" ? "bg-orange-500/20 text-orange-400" :
                                                err.category === "npm" ? "bg-amber-500/20 text-amber-400" :
                                                err.category === "Test" ? "bg-purple-500/20 text-purple-400" :
                                                err.category === "ESLint" ? "bg-indigo-500/20 text-indigo-400" :
                                                err.category === "Network" ? "bg-cyan-500/20 text-cyan-400" :
                                                "bg-yellow-500/20 text-yellow-400"
                                              }`}>
                                                {err.category}
                                              </span>
                                            </div>
                                            <p className={`mt-1 text-foreground break-words whitespace-pre-wrap ${
                                              err.category === "Task Failed" ? "text-sm font-medium" : "text-xs"
                                            }`}>
                                              {err.message}
                                            </p>
                                            {err.file && (
                                              <p className="text-[10px] text-muted-foreground mt-1 font-mono truncate">
                                                {err.file}{err.line ? `:${err.line}` : ""}
                                              </p>
                                            )}
                                          </div>
                                          {err.logIndex >= 0 && (
                                            <span className="text-muted-foreground group-hover:text-foreground transition-colors">
                                              →
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    ))
                                  ) : (
                                    <div className="p-4 text-center text-muted-foreground text-xs">
                                      <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-500/50" />
                                      <p>No warnings detected</p>
                                    </div>
                                  )}
                                </div>
                                {/* Communications Tab Content - Always mounted to keep SSE alive */}
                                <div className={`${(panelActiveTab[task.id] || "errors") === "comms" ? "" : "hidden"}`}>
                                  <EmbeddedCommunicationsFeed
                                    taskId={task.id}
                                    onNewMessage={() => {
                                      // Auto-expand the panel when new message arrives
                                      setErrorPanelExpanded(prev => ({
                                        ...prev,
                                        [task.id]: true
                                      }));
                                      // Auto-switch to comms tab when new message arrives
                                      setPanelActiveTab(prev => ({
                                        ...prev,
                                        [task.id]: "comms"
                                      }));
                                      // Clear unread count since we're switching to comms tab
                                      setUnreadCommsCount(prev => ({
                                        ...prev,
                                        [task.id]: 0
                                      }));
                                    }}
                                    onAnswerQuestion={handleAnswerQuestion}
                                  />
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="p-12 text-center">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                    <Clock className="w-8 h-8 text-primary/50" />
                  </div>
                  <p className="text-muted-foreground font-medium">No active workflows</p>
                  <p className="text-sm text-muted-foreground/60 mt-1">Workflows will appear here when workers are executing</p>
                </div>
              )}
            </div>
          </div>

        {/* All Tasks */}
        <div className="card-elevated border border-border/50 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border/50 bg-gradient-to-r from-muted/30 to-transparent flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Clock className="w-5 h-5 text-muted-foreground" />
              All Tasks
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="text-left p-3">Task</th>
                  <th className="text-left p-3">Summary</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">Model</th>
                  <th className="text-left p-3">Links</th>
                  <th className="text-left p-3">Retries</th>
                  <th className="text-left p-3">Cost</th>
                  <th className="text-left p-3">Quality</th>
                  <th className="text-left p-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data?.recentCompleted && data.recentCompleted.length > 0 ? (
                  data.recentCompleted.map((task) => {
                    const prNumber = task.githubPrUrl?.match(/\/pull\/(\d+)/)?.[1];
                    return (
                      <tr
                        key={task.id}
                        className="hover:bg-muted/30 cursor-pointer transition-colors"
                        onClick={() => setSelectedTask(task)}
                      >
                        {/* Task - Clickable Jira key */}
                        <td className="p-3">
                          <a
                            href={`https://oncallshift.atlassian.net/browse/${task.jiraIssueKey}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-primary hover:underline flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {task.jiraIssueKey}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </td>
                        {/* Summary */}
                        <td className="p-3">
                          <div className="text-sm text-foreground truncate max-w-md">
                            {task.summary}
                          </div>
                        </td>
                        {/* Status */}
                        <td className="p-3">
                          <div className="flex flex-col gap-0.5">
                            <span
                              className={`flex items-center gap-1 ${getStatusColor(task.status)}`}
                            >
                              {task.status === "completed" || task.status === "deployed" ? (
                                <CheckCircle className="w-4 h-4" />
                              ) : task.status === "failed" || task.status === "review_rejected" ? (
                                <XCircle className="w-4 h-4" />
                              ) : task.status === "cancelled" ? (
                                <XCircle className="w-4 h-4" />
                              ) : task.status === "review_requested" || task.status === "pr_created" ? (
                                <GitBranch className="w-4 h-4" />
                              ) : task.status === "manager_review" ? (
                                <Users className="w-4 h-4" />
                              ) : task.status === "review_approved" || task.status === "pr_approved" ? (
                                <Star className="w-4 h-4" />
                              ) : task.status === "deploying" || task.status === "deployment_pending" ? (
                                <Rocket className="w-4 h-4 animate-pulse" />
                              ) : task.status === "executing" ? (
                                <Activity className="w-4 h-4 animate-pulse" />
                              ) : task.status === "revision_needed" ? (
                                <RefreshCw className="w-4 h-4" />
                              ) : task.status === "planning" ? (
                                <Cog className="w-4 h-4 animate-spin" />
                              ) : task.status === "pending_plan_approval" ? (
                                <Eye className="w-4 h-4" />
                              ) : task.status === "escalated" ? (
                                <AlertCircle className="w-4 h-4" />
                              ) : ["queued", "claimed", "environment_setup"].includes(task.status) ? (
                                <Clock className="w-4 h-4 animate-pulse" />
                              ) : (
                                <Clock className="w-4 h-4" />
                              )}
                              {task.status === "planning" ? "Planning" :
                               task.status === "pending_plan_approval" ? "Awaiting Approval" :
                               task.status === "environment_setup" ? "Setting Up" :
                               task.status === "review_requested" ? "Review Requested" :
                               task.status === "pr_created" ? "PR Created" :
                               task.status === "manager_review" ? "Manager Review" :
                               task.status === "review_approved" ? "Approved" :
                               task.status === "pr_approved" ? "PR Approved" :
                               task.status === "review_rejected" ? "Rejected" :
                               task.status === "revision_needed" ? "Revision Needed" :
                               task.status === "deployment_pending" ? "Deployment Pending" :
                               task.status === "escalated" ? "Escalated" :
                               task.status.replace(/_/g, " ").charAt(0).toUpperCase() + task.status.replace(/_/g, " ").slice(1)}
                            </span>
                            {/* Show revision badge when in review workflow */}
                            {task.revisionCount !== undefined && task.revisionCount > 0 && (
                              <span className="text-xs text-amber-500">
                                Rev {task.revisionCount}/3
                              </span>
                            )}
                          </div>
                        </td>
                        {/* Model */}
                        <td className="p-3">
                          <span className={`text-sm ${
                            task.workerModel?.includes("opus") ? "text-purple-400" :
                            task.workerModel?.includes("sonnet") ? "text-cyan-400" :
                            "text-green-400"
                          }`}>
                            {formatModelName(task.workerModel)}
                          </span>
                        </td>
                        {/* Links (PR + Logs) */}
                        <td className="p-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-2 text-sm">
                            {task.githubPrUrl && prNumber && (
                              <a
                                href={task.githubPrUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-purple-400 hover:underline"
                              >
                                <GitBranch className="w-3 h-3" />
                                PR***REMOVED***{prNumber}
                              </a>
                            )}
                            {!task.githubPrUrl && (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </div>
                        </td>
                        {/* Retries */}
                        <td className="p-3 text-sm text-muted-foreground">
                          {task.retryCount ?? 0}/3
                        </td>
                        {/* Cost */}
                        <td className="p-3 text-sm font-medium">
                          ${formatCost(task.costUsd)}
                        </td>
                        {/* Quality */}
                        <td className="p-3 text-sm">
                          {task.qualityScore != null ? (
                            <span className={`font-medium ${
                              task.qualityScore >= 90 ? 'text-emerald-500' :
                              task.qualityScore >= 70 ? 'text-yellow-500' :
                              task.qualityScore >= 50 ? 'text-orange-500' :
                              'text-red-500'
                            }`}>
                              {task.qualityScore}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        {/* Actions */}
                        <td className="p-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            {/* Actions dropdown */}
                            <div className="relative">
                              <button
                                onClick={() => setOpenActionMenu(openActionMenu === task.id ? null : task.id)}
                                className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
                                title="Actions"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              {/* Dropdown Menu */}
                              {openActionMenu === task.id && (
                                <div className="absolute right-0 top-full mt-1 z-50 bg-background border border-border rounded-lg shadow-lg py-1 min-w-[140px]">
                                  <button
                                    onClick={() => {
                                      setSelectedTask(task);
                                      setOpenActionMenu(null);
                                    }}
                                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2"
                                  >
                                    <Eye className="w-4 h-4" />
                                    Details
                                  </button>
                                  {["failed", "completed", "no_changes", "review_requested", "escalated", "cancelled", "deployed", "pr_approved", "pr_created"].includes(task.status) && (
                                    <button
                                      onClick={() => {
                                        handleRetryTask(task.id);
                                        setOpenActionMenu(null);
                                      }}
                                      disabled={actionLoading === task.id}
                                      className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2 text-blue-400"
                                    >
                                      {actionLoading === task.id ? (
                                        <RefreshCw className="w-4 h-4 animate-spin" />
                                      ) : (
                                        <RotateCcw className="w-4 h-4" />
                                      )}
                                      Retry
                                    </button>
                                  )}
                                  <div className="border-t border-border my-1" />
                                  {["queued", "claimed", "executing", "environment_setup", "planning", "pending_plan_approval", "dispatching"].includes(task.status) ? (
                                    <button
                                      onClick={() => {
                                        handleCancelTask(task.id);
                                        setOpenActionMenu(null);
                                      }}
                                      disabled={actionLoading === task.id}
                                      className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2 text-red-500"
                                    >
                                      {actionLoading === task.id ? (
                                        <RefreshCw className="w-4 h-4 animate-spin" />
                                      ) : (
                                        <Ban className="w-4 h-4" />
                                      )}
                                      Cancel
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => {
                                        handleDeleteTask(task.id);
                                        setOpenActionMenu(null);
                                      }}
                                      disabled={actionLoading === task.id}
                                      className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2 text-red-500"
                                    >
                                      {actionLoading === task.id ? (
                                        <RefreshCw className="w-4 h-4 animate-spin" />
                                      ) : (
                                        <Trash2 className="w-4 h-4" />
                                      )}
                                      Delete
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={11} className="p-8 text-center text-muted-foreground">
                      No tasks yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
          </ErrorBoundaryWithRetry>
        </main>
      </div>

      {/* Create Task Modal */}
      {showCreateTaskModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card-elevated border border-border/50 rounded-xl w-full max-w-md glow-mixed">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <Play className="w-4 h-4" />
                Run AI Task
              </h3>
              <button
                onClick={() => {
                  setShowCreateTaskModal(false);
                  setTaskSource("external");
                  setSelectedProjectId("");
                  setSelectedTaskKey("");
                  setCostEstimate(null);
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </div>
            <div className="p-4 space-y-4">
              {/* Task Source Selector */}
              <div>
                <label className="block text-sm font-medium mb-2">Task Source</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTaskSource("external")}
                    className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border transition-all ${
                      taskSource === "external"
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <Layers className="w-4 h-4" />
                    <span className="text-sm font-medium">Jira / Linear</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTaskSource("internal")}
                    className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border transition-all ${
                      taskSource === "internal"
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <FolderKanban className="w-4 h-4" />
                    <span className="text-sm font-medium">Internal Project</span>
                  </button>
                </div>
              </div>

              {taskSource === "external" ? (
                <>
                  {/* External: Jira/Linear Issue Key */}
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Issue Key
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="e.g., PROJ-123"
                        value={createTaskForm.jiraIssueKey}
                        onChange={(e) => {
                          setCreateTaskForm((prev) => ({
                            ...prev,
                            jiraIssueKey: e.target.value,
                          }));
                          setCostEstimate(null);
                        }}
                        className="flex-1 px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      <button
                        type="button"
                        onClick={() => fetchCostEstimate(createTaskForm.jiraIssueKey)}
                        disabled={!createTaskForm.jiraIssueKey || costEstimateLoading}
                        className="px-3 py-2 bg-purple-500/10 text-purple-500 border border-purple-500/30 rounded-lg hover:bg-purple-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                      >
                        {costEstimateLoading ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <DollarSign className="w-4 h-4" />
                        )}
                        <span className="text-sm">Estimate</span>
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Jira or Linear issue key (e.g., OCS-123 or PROJECT-456)
                    </p>
                    {/* Cost Estimate Display */}
                    {costEstimate && (
                      <div className="mt-3 p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-purple-400">
                            Complexity: <span className="capitalize">{costEstimate.tier}</span>
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {costEstimate.historicalBasis >= 5
                              ? `Based on ${costEstimate.historicalBasis} past tasks`
                              : `${costEstimate.confidence} confidence`}
                          </span>
                        </div>
                        <div className="text-center py-2">
                          <span className="text-muted-foreground text-sm">Estimated Cost:</span>
                          <div className="font-bold text-xl text-green-400">
                            ${costEstimate.costRange.min.toFixed(2)} - ${costEstimate.costRange.max.toFixed(2)}
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 text-center">
                          {costEstimate.tierDescription}
                        </p>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Worker Persona
                    </label>
                    <select
                      value={createTaskForm.workerPersona}
                      onChange={(e) =>
                        setCreateTaskForm((prev) => ({
                          ...prev,
                          workerPersona: e.target.value,
                        }))
                      }
                      className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">🤖 Auto (Dynamic Routing)</option>
                      {Object.entries(PERSONA_CONFIG)
                        .filter(([key]) => key !== "manager")
                        .map(([key, config]) => (
                          <option key={key} value={key}>
                            {config.emoji} {config.title}
                          </option>
                        ))}
                    </select>
                  </div>
                </>
              ) : (
                <>
                  {/* Internal: Project and Task Selection */}
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Project
                    </label>
                    <select
                      value={selectedProjectId}
                      onChange={(e) => setSelectedProjectId(e.target.value)}
                      disabled={projectsLoading}
                      className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                    >
                      <option value="">
                        {projectsLoading ? "Loading projects..." : "Select a project"}
                      </option>
                      {internalProjects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.key} - {project.name}
                        </option>
                      ))}
                    </select>
                    {internalProjects.length === 0 && !projectsLoading && (
                      <p className="text-xs text-muted-foreground mt-1">
                        No projects found.{" "}
                        <Link to="/projects" className="text-primary hover:underline">
                          Create one
                        </Link>
                      </p>
                    )}
                  </div>
                  {selectedProjectId && (
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Task
                      </label>
                      <select
                        value={selectedTaskKey}
                        onChange={(e) => setSelectedTaskKey(e.target.value)}
                        disabled={tasksLoading}
                        className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                      >
                        <option value="">
                          {tasksLoading ? "Loading tasks..." : "Select a task"}
                        </option>
                        {internalTasks.map((task) => (
                          <option key={task.taskKey} value={task.taskKey}>
                            {task.taskKey} - {task.title}
                            {task.persona && ` (${PERSONA_CONFIG[task.persona]?.emoji || ""} ${task.persona})`}
                          </option>
                        ))}
                      </select>
                      {internalTasks.length === 0 && !tasksLoading && (
                        <p className="text-xs text-muted-foreground mt-1">
                          No available tasks in Ready or Backlog columns.{" "}
                          <Link to={`/projects/${selectedProjectId}`} className="text-primary hover:underline">
                            Create tasks on the board
                          </Link>
                        </p>
                      )}
                      {selectedTaskKey && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Task will use configured persona, model, and GitHub repo settings.
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowCreateTaskModal(false);
                  setTaskSource("external");
                  setSelectedProjectId("");
                  setSelectedTaskKey("");
                }}
                className="px-4 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateTask}
                disabled={
                  createLoading ||
                  (taskSource === "external" && !createTaskForm.jiraIssueKey) ||
                  (taskSource === "internal" && (!selectedProjectId || !selectedTaskKey))
                }
                className="px-3 py-2 bg-blue-500/10 text-blue-500 border border-blue-500/30 rounded-lg hover:bg-blue-500/20 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {createLoading && (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                )}
                Run Task
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Task Details Modal */}
      {selectedTask && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-xl w-full max-w-5xl mx-4 shadow-2xl max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
              <div className="flex items-center gap-3">
                <a
                  href={`https://oncallshift.atlassian.net/browse/${selectedTask.jiraIssueKey}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline font-semibold flex items-center gap-1"
                >
                  {selectedTask.jiraIssueKey}
                  <ExternalLink className="w-3 h-3" />
                </a>
                <span className={`text-sm ${getStatusColor(selectedTask.status)}`}>
                  {selectedTask.status}
                </span>
              </div>
              <button
                onClick={() => {
                  setSelectedTask(null);
                  setTaskModalTab("details");
                }}
                className="p-1 hover:bg-muted rounded transition-colors"
              >
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border shrink-0">
              <button
                onClick={() => setTaskModalTab("details")}
                className={`px-4 py-2.5 text-sm font-medium transition-colors ${
                  taskModalTab === "details"
                    ? "text-primary border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Details
              </button>
              <button
                onClick={() => setTaskModalTab("logs")}
                className={`px-4 py-2.5 text-sm font-medium transition-colors flex items-center gap-2 ${
                  taskModalTab === "logs"
                    ? "text-primary border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Terminal className="w-4 h-4" />
                Logs
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-auto">
              {taskModalTab === "details" ? (
                <div className="p-4 space-y-4">
                  {/* Summary */}
                  <p className="text-foreground">{selectedTask.summary}</p>

                  {/* Stats Grid */}
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <div className="text-muted-foreground">Retries</div>
                      <div className="font-semibold">{selectedTask.retryCount ?? 0}/3</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Cost</div>
                      <div className="font-semibold">${formatCost(selectedTask.costUsd)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Duration</div>
                      <div className="font-semibold">
                        {(() => {
                          if (selectedTask.durationMinutes) return `${selectedTask.durationMinutes}m`;
                          if (selectedTask.startedAt && selectedTask.completedAt) {
                            const mins = Math.round((new Date(selectedTask.completedAt).getTime() - new Date(selectedTask.startedAt).getTime()) / 60000);
                            if (mins < 60) return `${mins}m`;
                            return `${Math.floor(mins / 60)}h ${mins % 60}m`;
                          }
                          if (selectedTask.startedAt && !selectedTask.completedAt) {
                            const mins = Math.round((Date.now() - new Date(selectedTask.startedAt).getTime()) / 60000);
                            return `${mins}m (running)`;
                          }
                          return "N/A";
                        })()}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Created</div>
                      <div className="font-semibold text-xs">{new Date(selectedTask.createdAt).toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Completed</div>
                      <div className="font-semibold text-xs">{selectedTask.completedAt ? new Date(selectedTask.completedAt).toLocaleString() : "Running"}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Last Heartbeat</div>
                      <div className="font-semibold text-xs">{selectedTask.lastHeartbeatAt ? new Date(selectedTask.lastHeartbeatAt).toLocaleString() : "Never"}</div>
                    </div>
                  </div>

                  {/* Token Usage Breakdown */}
                  <div className="border-t border-border pt-4">
                    <TokenBreakdown taskId={selectedTask.id} />
                  </div>

                  {/* Error Message */}
                  {selectedTask.status === "failed" && selectedTask.errorMessage && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                      <div className="flex items-center gap-2 text-red-500 mb-1">
                        <AlertCircle className="w-4 h-4" />
                        <span className="font-semibold">Error</span>
                      </div>
                      <p className="text-red-400 text-sm font-mono">
                        {selectedTask.errorMessage || "Essential container in task exited"}
                      </p>
                    </div>
                  )}

                  {/* Links */}
                  {selectedTask.githubPrUrl && (
                    <div className="flex items-center gap-4">
                      <a
                        href={selectedTask.githubPrUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-sm text-purple-400 hover:underline"
                      >
                        <GitBranch className="w-4 h-4" />
                        View PR
                      </a>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4">
                  <TerminalLogViewer taskId={selectedTask.id} height="500px" />
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end gap-2 p-4 border-t border-border shrink-0">
              {selectedTask.status === "failed" && (
                <button
                  onClick={() => {
                    handleRetryTask(selectedTask.id);
                    setSelectedTask(null);
                    setTaskModalTab("details");
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Retry
                </button>
              )}
              <button
                onClick={() => {
                  setSelectedTask(null);
                  setTaskModalTab("details");
                }}
                className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Onboarding Wizard */}
      {shouldShowOnboarding && (
        <OnboardingWizard
          onClose={dismissOnboarding}
          onComplete={dismissOnboarding}
        />
      )}

      {/* Log Search Modal */}
      <LogSearch
        isOpen={isLogSearchOpen}
        onClose={() => setIsLogSearchOpen(false)}
      />

      {/* Talk to Worker Modal */}
      {isTalkOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => {
              setIsTalkOpen(false);
              setTalkMessage("");
            }}
          />

          {/* Modal */}
          <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-cyan-500/10 rounded-lg">
                  <MessageSquare className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Talk to Workers</h2>
                  <p className="text-sm text-muted-foreground">
                    Send a message to {data?.activeTasks?.filter(t => ["executing", "environment_setup", "dispatching"].includes(t.status)).length || 0} running worker(s)
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsTalkOpen(false);
                  setTalkMessage("");
                }}
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-4">
              <label className="block text-sm font-medium text-muted-foreground mb-2">
                Your message will be injected into the worker's next prompt.
              </label>
              <textarea
                value={talkMessage}
                onChange={(e) => setTalkMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && talkMessage.trim()) {
                    e.preventDefault();
                    handleTalkToWorkers();
                  }
                }}
                placeholder="Type your message to the workers..."
                className="w-full h-32 px-4 py-3 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 resize-none"
                autoFocus
                disabled={talkLoading}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Press Ctrl+Enter to send, or use the button below.
              </p>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 p-4 border-t border-border bg-muted/30 rounded-b-xl">
              <button
                onClick={() => {
                  setIsTalkOpen(false);
                  setTalkMessage("");
                }}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleTalkToWorkers}
                disabled={!talkMessage.trim() || talkLoading}
                className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {talkLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Send Message
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

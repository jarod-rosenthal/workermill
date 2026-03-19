// Terminal statuses - tasks in these states are considered "finished" and their terminals are collapsed by default
export const TERMINAL_STATUSES = [
  "completed",
  "deployed",
  "failed",
  "cancelled",
  "pr_approved",
  "review_approved",
  "blocked",
  "escalated",
];

export interface ControlCenterStats {
  totalWorkers: number;
  activeWorkers: number;
  queueDepth: number;
  periodCost: number;
  periodCompleted: number;
  periodFailed: number;
  cumulativeCost: number;
  countersResetAt: string | null;
}

export interface WorkerTask {
  id: string;
  jiraKey: string;
  summary: string;
  status: string;
  retryCount: number;
  maxRetries: number;
}

export interface Worker {
  id: string;
  displayName: string;
  persona: string;
  status: string;
  tasksCompleted: number;
  tasksFailed: number;
  totalCostUsd: number;
  currentTask: WorkerTask | null;
}

export interface TaskStep {
  name: string;
  status: "done" | "active" | "pending" | "waiting";
  icon:
    | "queued"
    | "executing"
    | "pr_created"
    | "review"
    | "complete"
    | "deployed"
    | "manager_review"
    | "waiting"
    | "approved"
    | "deploying"
    | "experts"
    | "coordinating"
    | "epic"
    | "planning"
    | "steps"
    | "integration_check"
    | "tech_lead_review";
  isParallelStage?: boolean;
  isReviewStage?: boolean;
}

export type WorkflowMode =
  | "default"
  | "review"
  | "auto_deploy"
  | "manager"
  | "review_manager"
  | "deploy_manager";

export interface TaskLog {
  timestamp: string;
  message: string;
  type: string;
  severity: string;
}

export interface RalphProgressData {
  currentStory: number;
  totalStories: number;
  currentStoryDescription: string;
  completedStories?: number;
  status?: "planning" | "executing" | "completed" | "failed" | "unknown";
}

export interface ActiveTask {
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
  updatedAt?: string;
  hasPr?: boolean;
  githubPrUrl?: string | null;
  githubRepo?: string;
  githubBranch?: string | null;
  recentLogs: TaskLog[];
  steps: TaskStep[];
  // Workflow mode fields
  workflowMode?: WorkflowMode;
  workflowModeName?: string;
  deploymentEnabled?: boolean;
  skipManagerReview?: boolean;
  managerEnabled?: boolean;
  revisionCount?: number;
  maxReviewRevisions?: number;
  reviewFeedback?: string;
  // Manager task info
  managerEcsTaskId?: string | null;
  // Manager provider tracking (which AI provider performed the review)
  managerProvider?: string | null;
  managerModel?: string | null;
  // Ralph execution info
  isRalphTask?: boolean;
  ralphProgress?: RalphProgressData | null;
  // (planningProgress stored in separate state to survive polling)
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
  // Remote agent
  claimedByAgent?: string | null;
  // Board context for internal issue links
  cardBoardId?: string | null;
  cardId?: string | null;
}

export interface CompletedTask {
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
  githubBranch?: string | null;
  ecsTaskId: string | null;
  retryCount?: number;
  revisionCount?: number;
  maxReviewRevisions?: number;
  errorMessage?: string;
  // Quality metrics
  qualityScore?: number | null;
  qualityGrade?: string | null;
  // Workflow mode fields
  workflowMode?: WorkflowMode;
  workflowModeName?: string;
  deploymentEnabled?: boolean;
  skipManagerReview?: boolean;
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
  // Remote agent
  claimedByAgent?: string | null;
  // Board context for internal issue links
  cardBoardId?: string | null;
  cardId?: string | null;
}

export interface ManagerStatus {
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

export interface WatcherStatus {
  enabled: boolean;
  lastRunAt: string | null;
  stuckTasks: number;
  pendingRetries: number;
}

export interface SystemStatus {
  systemEnabled: boolean;
  orchestrator: { running: boolean; desiredCount: number };
  executors: { running: number };
}

export interface ControlCenterData {
  stats: ControlCenterStats;
  workers: Worker[];
  activeTasks: ActiveTask[];
  queuedTasks: ActiveTask[];
  recentCompleted: CompletedTask[];
  managerStatus?: ManagerStatus;
  systemStatus?: SystemStatus;
  watcherStatus?: WatcherStatus;
}

export const API_BASE = import.meta.env.VITE_API_URL || "";

// Full Claude model options with exact version names (Anthropic official models only)
export const MODEL_OPTIONS = [
  {
    value: "claude-opus-4-6",
    label: "Claude Opus 4.6",
    shortLabel: "Opus 4.6",
  },
  {
    value: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    shortLabel: "Sonnet 4.6",
  },
  {
    value: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    shortLabel: "Haiku 4.5",
  },
];

// Persona definitions with full details
export const PERSONA_CONFIG: Record<
  string,
  { emoji: string; title: string; description: string; skills: string[] }
> = {
  frontend_developer: {
    emoji: "\u{1F3A8}",
    title: "Frontend Developer",
    description: "UI/UX implementation, React components, styling",
    skills: ["React", "TypeScript", "Tailwind CSS", "Accessibility"],
  },
  backend_developer: {
    emoji: "\u2699\uFE0F",
    title: "Backend Developer",
    description: "API development, database design, server logic",
    skills: ["Node.js", "Express", "PostgreSQL", "REST APIs"],
  },
  architect: {
    emoji: "\u{1F3D7}\uFE0F",
    title: "Architect",
    description: "System decomposition, task planning, architecture design",
    skills: ["System Design", "Decomposition", "Planning"],
  },
  devops_engineer: {
    emoji: "\u{1F527}",
    title: "DevOps Engineer",
    description: "Infrastructure, CI/CD, deployment automation",
    skills: ["Terraform", "AWS", "Docker", "GitHub Actions"],
  },
  security_engineer: {
    emoji: "\u{1F512}",
    title: "Security Engineer",
    description: "Security audits, vulnerability fixes, compliance",
    skills: ["OWASP", "Penetration Testing", "IAM", "Encryption"],
  },
  qa_engineer: {
    emoji: "\u{1F9EA}",
    title: "QA Engineer",
    description: "Test writing, quality assurance, bug verification",
    skills: ["Jest", "Playwright", "Test Design", "Bug Triage"],
  },
  data_ml_engineer: {
    emoji: "\u{1F4CA}",
    title: "Data & ML Engineer",
    description: "Data pipelines, ETL, machine learning, MLOps",
    skills: ["ETL", "dbt", "PyTorch", "MLOps"],
  },
  mobile_developer: {
    emoji: "\u{1F4F1}",
    title: "Mobile Developer",
    description: "iOS (Swift, SwiftUI) and Android (Kotlin, Jetpack Compose)",
    skills: ["Swift", "Kotlin", "React Native"],
  },
  tech_lead: {
    emoji: "\u{1F3AF}",
    title: "Tech Lead",
    description: "Architecture decisions, code reviews, technical strategy",
    skills: [
      "System Design",
      "Code Review",
      "Technical Strategy",
      "Mentorship",
    ],
  },
  tech_writer: {
    emoji: "\u{1F4DD}",
    title: "Technical Writer",
    description: "Documentation, API docs, user guides",
    skills: ["Markdown", "API Documentation", "User Guides"],
  },
  project_manager: {
    emoji: "\u{1F4CB}",
    title: "Project Manager",
    description: "Task planning, coordination, status updates",
    skills: ["Jira", "Project Planning", "Stakeholder Management"],
  },
  manager: {
    emoji: "\u{1F454}",
    title: "Tech Lead",
    description:
      "Reviews PRs from workers, provides feedback, approves or requests revisions",
    skills: [
      "Code Review",
      "Quality Assurance",
      "Feedback",
      "Approval Workflow",
    ],
  },
};

// Mission Control Types - High-Density Command Center Dashboard

// Worker Personas
export type WorkerPersona =
  | 'architect'
  | 'frontend_developer'
  | 'backend_developer'
  | 'devops_engineer'
  | 'security_engineer'
  | 'qa_engineer'
  | 'tech_writer'
  | 'project_manager'
  | 'data_ml_engineer'
  | 'mobile_developer'
  | 'manager';

export interface PersonaConfig {
  id: WorkerPersona;
  emoji: string;
  label: string;
  shortLabel: string;
  skills: string[];
  riskLevel: 'low' | 'medium' | 'high';
}

export const PERSONA_CONFIGS: Record<WorkerPersona, PersonaConfig> = {
  architect: {
    id: 'architect',
    emoji: '🏗️',
    label: 'Architect',
    shortLabel: 'Architect',
    skills: ['System Design', 'Decomposition', 'Planning', 'Architecture'],
    riskLevel: 'medium',
  },
  frontend_developer: {
    id: 'frontend_developer',
    emoji: '🎨',
    label: 'Frontend Developer',
    shortLabel: 'Frontend',
    skills: ['React', 'TypeScript', 'Tailwind CSS', 'Accessibility'],
    riskLevel: 'low',
  },
  backend_developer: {
    id: 'backend_developer',
    emoji: '💻',
    label: 'Backend Developer',
    shortLabel: 'Backend',
    skills: ['Node.js', 'Express', 'PostgreSQL', 'REST APIs'],
    riskLevel: 'medium',
  },
  devops_engineer: {
    id: 'devops_engineer',
    emoji: '🔧',
    label: 'DevOps Engineer',
    shortLabel: 'DevOps',
    skills: ['Terraform', 'AWS', 'Docker', 'GitHub Actions'],
    riskLevel: 'high',
  },
  security_engineer: {
    id: 'security_engineer',
    emoji: '🛡️',
    label: 'Security Engineer',
    shortLabel: 'Security',
    skills: ['OWASP', 'Penetration Testing', 'IAM', 'Encryption'],
    riskLevel: 'high',
  },
  qa_engineer: {
    id: 'qa_engineer',
    emoji: '🧪',
    label: 'QA Engineer',
    shortLabel: 'QA',
    skills: ['Jest', 'Playwright', 'Test Design', 'Bug Triage'],
    riskLevel: 'low',
  },
  tech_writer: {
    id: 'tech_writer',
    emoji: '📝',
    label: 'Tech Writer',
    shortLabel: 'Docs',
    skills: ['Markdown', 'API Documentation', 'User Guides'],
    riskLevel: 'low',
  },
  project_manager: {
    id: 'project_manager',
    emoji: '📋',
    label: 'Project Manager',
    shortLabel: 'PM',
    skills: ['Jira', 'Project Planning', 'Stakeholder Management'],
    riskLevel: 'low',
  },
  data_ml_engineer: {
    id: 'data_ml_engineer',
    emoji: '📊',
    label: 'Data & ML Engineer',
    shortLabel: 'Data/ML',
    skills: ['ETL', 'dbt', 'PyTorch', 'MLOps', 'SQL'],
    riskLevel: 'medium',
  },
  mobile_developer: {
    id: 'mobile_developer',
    emoji: '📱',
    label: 'Mobile Developer',
    shortLabel: 'Mobile',
    skills: ['Swift', 'Kotlin', 'SwiftUI', 'Jetpack Compose', 'React Native'],
    riskLevel: 'medium',
  },
  manager: {
    id: 'manager',
    emoji: '👔',
    label: 'Engineering Manager',
    shortLabel: 'Manager',
    skills: ['Code Review', 'Team Leadership', 'Architecture Review'],
    riskLevel: 'low',
  },
};

// Task Status Types
export type MissionControlTaskStatus =
  | 'queued'
  | 'claimed'
  | 'environment_setup'
  | 'executing'
  | 'pr_created'
  | 'review_requested'
  | 'review_pending'
  | 'manager_review'
  | 'approved'
  | 'pr_approved'
  | 'review_approved'
  | 'deployment_pending'
  | 'deploying'
  | 'integration_check'
  | 'deployed'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked'
  | 'escalated';

// Safety Status
export type SafetyStatus = 'safe' | 'blocked' | 'escalated';

// Terminal Log Entry
export interface TerminalLogEntry {
  id: string;
  timestamp: string;
  content: string;
  type: 'stdout' | 'stderr' | 'system' | 'checkpoint';
}

// Task Step
export interface TaskStep {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
  timestamp?: string;
}

// Active Task (Worker Tile)
export interface MissionControlTask {
  id: string;
  jiraIssueKey: string;
  summary: string;
  status: MissionControlTaskStatus;
  workerPersona: WorkerPersona;
  workerModel: string;

  // Timing
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  elapsedSeconds: number;

  // Cost
  estimatedCostUsd: number;
  inputTokens?: number;
  outputTokens?: number;

  // Terminal
  terminalLines: string[];
  recentLogs?: TerminalLogEntry[];

  // Progress
  steps?: TaskStep[];
  progressPercent?: number;

  // Git/PR
  hasPr: boolean;
  githubPrUrl?: string;
  githubPrNumber?: number;
  githubRepo?: string;
  branchName?: string;

  // Checkpoints
  hasCheckpoint: boolean;
  checkpointStage?: string;
  checkpointSavedAt?: string;
  resumeCount: number;

  // File Locks
  fileLocks?: string[];

  // Safety
  safetyStatus: SafetyStatus;
  blockedCommand?: string;
  blockedGuardrail?: string;

  // Retry
  retryCount: number;
  maxRetries: number;

  // Workflow
  workflowMode?: string;
  managerEnabled?: boolean;

  // Remote agent
  claimedByAgent?: string | null;

  // Ralph (epic breakdown)
  isRalphTask?: boolean;
  ralphProgress?: {
    currentStory: number;
    totalStories: number;
    storyDescription?: string;
  };
}

// Triage Item Types
export type TriageType =
  | 'blocked_command'
  | 'approval_request'
  | 'manager_escalation'
  | 'security_alert'
  | 'cost_alert';

export type TriagePriority = 'critical' | 'high' | 'normal';

export interface TriageAction {
  id: string;
  label: string;
  variant: 'primary' | 'secondary' | 'danger';
  action: string;
}

export interface TriageItem {
  id: string;
  type: TriageType;
  priority: TriagePriority;
  taskId: string;
  jiraKey: string;
  persona: WorkerPersona;
  title: string;
  description: string;
  detail?: string;
  command?: string;
  guardrailName?: string;
  timestamp: string;
  actions: TriageAction[];
  prUrl?: string;
  prNumber?: number;
  diffStats?: {
    additions: number;
    deletions: number;
    filesChanged: number;
  };
  managerAnalysis?: string;
}

// Manager Analysis
export interface ManagerAnalysis {
  taskId: string;
  jiraKey: string;
  summary: string;
  status: 'reviewing' | 'approved' | 'changes_requested' | 'escalated';
  analysisPoints: string[];
  recommendation: 'approve' | 'request_changes' | 'escalate';
  diffPreview?: {
    additions: number;
    deletions: number;
    filesChanged: number;
    files: string[];
  };
  confidence?: number;
}

// System Status
export interface SystemStatus {
  systemEnabled: boolean;
  orchestratorRunning: boolean;
  watcherEnabled: boolean;
  lastHeartbeat?: string;
}

// Control Center Stats
export interface ControlCenterStats {
  activeWorkers: number;
  maxWorkers: number;
  queueDepth: number;
  todaySpend: number;
  yesterdaySpend: number;
  completedToday: number;
  failedToday: number;
  avgCycleTimeMinutes: number;
  successRate24h: number;
}

// View Mode
export type ViewMode = 'compact' | 'expanded';

// Command Palette Command
export interface CommandPaletteCommand {
  id: string;
  category: 'quick_actions' | 'jump_to' | 'view' | 'system';
  label: string;
  description: string;
  shortcut?: string;
  action: () => void;
}

// Cost Sparkline Data Point
export interface CostDataPoint {
  timestamp: number;
  cost: number;
  velocity: number; // cost per second at this point
}

// File Lock
export interface FileLock {
  path: string;
  taskId: string;
  lockedBy: 'self' | 'other';
  lockedAt: string;
}

// Mission Control Full State
export interface MissionControlData {
  stats: ControlCenterStats;
  systemStatus: SystemStatus;
  activeTasks: MissionControlTask[];
  queuedTasks: MissionControlTask[];
  recentCompleted: MissionControlTask[];
  triageItems: TriageItem[];
  managerAnalysis: ManagerAnalysis | null;
  managerModel: string;
  managerQueueCount: number;
}

// SSE Event Types
export type SSEEventType =
  | 'connected'
  | 'update'
  | 'log'
  | 'ralph_progress'
  | 'planning_progress'
  | 'status'
  | 'complete'
  | 'ping';

export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
  lastEventId?: string;
}

// Keyboard Shortcut
export interface KeyboardShortcut {
  key: string;
  modifiers: ('ctrl' | 'alt' | 'shift' | 'meta')[];
  description: string;
  action: () => void;
}

// Props for components
export interface WorkerTileProps {
  task: MissionControlTask;
  isExpanded: boolean;
  viewMode: ViewMode;
  costHistory: number[];
  onExpand: () => void;
  onCollapse: () => void;
  onPause: () => void;
  onCancel: () => void;
}

export interface TriageCardProps {
  item: TriageItem;
  onAction: (actionId: string) => void;
}

export interface PulseProps {
  stats: ControlCenterStats;
  systemStatus: SystemStatus;
  onPauseAll: () => void;
  onKillAll: () => void;
  onToggleSystem: () => void;
}

export interface PersonaLensProps {
  activeFilters: WorkerPersona[];
  taskCountByPersona: Record<WorkerPersona, number>;
  onToggleFilter: (persona: WorkerPersona) => void;
  onClearFilters: () => void;
}

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  commands: CommandPaletteCommand[];
  onExecute: (commandId: string) => void;
}

export interface ManagerPanelProps {
  analysis: ManagerAnalysis | null;
  model: string;
  queueCount: number;
  onApprove: () => void;
  onRequestChanges: () => void;
  onChangeModel: (model: string) => void;
}

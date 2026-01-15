// Dashboard Types for Role-Based Views

// User roles for dashboard switching
export type UserRole =
  | 'engineer'
  | 'manager'
  | 'devops'
  | 'security'
  | 'qa'
  | 'tech_lead'
  | 'product_manager'
  | 'hr'
  // Executive roles (Phase 1)
  | 'cto'
  | 'finance'
  // Business roles (Phase 2)
  | 'sales'
  | 'marketing';

export interface RoleConfig {
  id: UserRole;
  label: string;
  description: string;
  icon: string;
}

// Metric Tile Types
export interface MetricTileProps {
  label: string;
  value: string | number;
  change?: {
    value: number;
    type: 'increase' | 'decrease' | 'neutral';
    period: string;
  };
  icon?: React.ReactNode;
  color?: 'default' | 'success' | 'warning' | 'error' | 'info';
  size?: 'sm' | 'md' | 'lg';
}

// Task Card Types
export type TaskStatus =
  | 'queued'
  | 'executing'
  | 'pr_created'
  | 'review_requested'
  | 'approved'
  | 'deploying'
  | 'deployed'
  | 'completed'
  | 'failed'
  | 'escalated';

export interface TaskStep {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
}

export interface TaskCardData {
  id: string;
  jiraKey: string;
  summary: string;
  status: TaskStatus;
  persona: string;
  model: string;
  provider: string;
  steps: TaskStep[];
  prUrl?: string;
  prNumber?: number;
  estimatedCost?: number;
  duration?: number;
  filesChanged?: number;
  linesAdded?: number;
  linesRemoved?: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

// Activity Feed Types
export type ActivityType =
  | 'task_created'
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'pr_created'
  | 'pr_approved'
  | 'pr_merged'
  | 'deployment_started'
  | 'deployment_completed'
  | 'deployment_failed'
  | 'security_alert'
  | 'cost_alert'
  | 'escalation';

export interface ActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  description?: string;
  timestamp: string;
  actor?: string;
  taskId?: string;
  jiraKey?: string;
  prUrl?: string;
  severity?: 'info' | 'warning' | 'error' | 'success';
  metadata?: Record<string, unknown>;
}

// Approval Queue Types
export type ApprovalType = 'pr_review' | 'deployment' | 'security' | 'cost' | 'architecture';

export interface ApprovalItem {
  id: string;
  type: ApprovalType;
  title: string;
  description: string;
  requestedBy: string;
  requestedAt: string;
  jiraKey?: string;
  prUrl?: string;
  prNumber?: number;
  reason?: string;
  metadata?: Record<string, unknown>;
}

// Cost Meter Types
export interface CostBreakdown {
  provider: string;
  amount: number;
  percentage: number;
  color: string;
}

export interface CostMeterData {
  currentPeriodCost: number;
  cumulativeCost: number;
  budget?: number;
  breakdown: CostBreakdown[];
  period: {
    start: string;
    end: string;
  };
}

// Health Monitor Types
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface ServiceHealth {
  name: string;
  status: HealthStatus;
  latency?: number;
  uptime?: number;
  lastCheck: string;
  details?: string;
}

export interface HealthMonitorData {
  services: ServiceHealth[];
  overallStatus: HealthStatus;
  lastUpdated: string;
}

// Deployment Pipeline Types
export type PipelineStage = 'build' | 'test' | 'review' | 'staging' | 'production';
export type StageStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export interface PipelineStageData {
  stage: PipelineStage;
  status: StageStatus;
  startedAt?: string;
  completedAt?: string;
  duration?: number;
  logs?: string;
}

export interface DeploymentRecord {
  id: string;
  service: string;
  version: string;
  jiraKey?: string;
  prNumber?: number;
  status: 'live' | 'rolling_back' | 'rolled_back' | 'failed';
  deployedAt: string;
  deployedBy: string;
  environment: 'staging' | 'production';
}

export interface DeploymentPipelineData {
  stages: PipelineStageData[];
  currentDeployments: DeploymentRecord[];
  environment: 'staging' | 'production';
}

// Security Dashboard Types
export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type FindingStatus = 'open' | 'in_progress' | 'resolved' | 'accepted' | 'blocked';

export interface SecurityFinding {
  id: string;
  severity: SecuritySeverity;
  title: string;
  description: string;
  prNumber?: number;
  prUrl?: string;
  status: FindingStatus;
  detectedAt: string;
  resolvedAt?: string;
  cweId?: string;
  owaspCategory?: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: string;
  ipAddress?: string;
  result: 'success' | 'failure' | 'blocked';
}

export interface ComplianceItem {
  framework: string;
  status: 'compliant' | 'non_compliant' | 'partial' | 'not_applicable';
  progress: number;
  totalControls: number;
  passedControls: number;
  pendingItems: number;
  lastAudit?: string;
}

export interface SecurityDashboardData {
  findings: SecurityFinding[];
  auditLog: AuditLogEntry[];
  compliance: ComplianceItem[];
  metrics: {
    totalScanned: number;
    issuesFound: number;
    blocked: number;
    resolved: number;
  };
}

// Team Activity Types (for charts)
export interface DailyActivity {
  date: string;
  tasks: number;
  cost: number;
  byPersona: Record<string, number>;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string;
  tasksCompleted: number;
  lastActive?: string;
}

export interface TeamActivityData {
  dailyActivity: DailyActivity[];
  members: TeamMember[];
  summary: {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    aiVsHumanSplit: {
      ai: number;
      human: number;
    };
    costSavings: number;
  };
}

// Dashboard View Props
export interface DashboardViewProps {
  onRoleChange?: (role: UserRole) => void;
}

// Engineer View specific types
export interface EngineerDashboardData {
  myTasks: {
    inProgress: TaskCardData[];
    needsReview: TaskCardData[];
    readyToDeploy: TaskCardData[];
  };
  recentPRs: {
    id: string;
    number: number;
    title: string;
    url: string;
    status: 'open' | 'approved' | 'merged' | 'closed';
    createdAt: string;
  }[];
  activity: ActivityItem[];
}

// Manager View specific types
export interface ManagerDashboardData {
  teamPerformance: TeamActivityData;
  pendingApprovals: ApprovalItem[];
  costs: CostMeterData;
  activity: ActivityItem[];
}

// DevOps View specific types
export interface DevOpsDashboardData {
  pipeline: DeploymentPipelineData;
  health: HealthMonitorData;
  alerts: ActivityItem[];
  deployments: DeploymentRecord[];
}

// QA View specific types
export interface QADashboardData {
  testMetrics: {
    totalTests: number;
    passed: number;
    failed: number;
    skipped: number;
    coverage: number;
  };
  recentTestRuns: {
    id: string;
    name: string;
    status: 'passed' | 'failed' | 'running';
    duration: number;
    timestamp: string;
  }[];
  activity: ActivityItem[];
}

// Tech Lead View specific types
export interface TechLeadDashboardData {
  codeReviews: ApprovalItem[];
  architectureDecisions: {
    id: string;
    title: string;
    status: 'pending' | 'approved' | 'rejected';
    requestedAt: string;
    impact: 'low' | 'medium' | 'high';
  }[];
  technicalDebt: {
    total: number;
    byCategory: Record<string, number>;
  };
  activity: ActivityItem[];
}

// Product Manager View specific types
export interface ProductManagerDashboardData {
  sprintProgress: {
    totalTickets: number;
    completed: number;
    inProgress: number;
    blocked: number;
  };
  ticketsByStatus: Record<string, number>;
  velocity: {
    current: number;
    average: number;
    trend: 'up' | 'down' | 'stable';
  };
  activity: ActivityItem[];
}

// HR View specific types
export interface HRDashboardData {
  teamUtilization: {
    totalMembers: number;
    activeWithAI: number;
    adoptionRate: number;
  };
  aiImpact: {
    tasksAutomated: number;
    timeSaved: number;
    costSavings: number;
  };
  trainingNeeds: {
    topic: string;
    priority: 'high' | 'medium' | 'low';
    affectedMembers: number;
  }[];
  activity: ActivityItem[];
}

// ================================
// Executive Dashboard Types (Phase 1)
// ================================

// ROI Calculator Types
export interface ROIMetrics {
  manualDevCost: number;
  aiWorkerCost: number;
  netSavings: number;
  roiPercentage: number;
  developerHoursSaved: number;
  avgDeveloperHourlyCost: number;
}

// Team Adoption Types
export interface TeamAdoptionData {
  teamName: string;
  adoptionRate: number;
  tasksCompleted: number;
  activeSince?: string;
}

// Risk Scorecard Types
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface RiskIndicator {
  category: string;
  level: RiskLevel;
  count: number;
  description: string;
  trend?: 'up' | 'down' | 'stable';
}

export interface RiskScorecardData {
  overallRisk: RiskLevel;
  indicators: RiskIndicator[];
  lastAssessment: string;
}

// CTO Dashboard Types
export interface CTODashboardData {
  roi: ROIMetrics;
  teamAdoption: TeamAdoptionData[];
  riskScorecard: RiskScorecardData;
  velocityTrend: {
    week: string;
    tasksCompleted: number;
  }[];
  qualityMetrics: {
    passRate: number;
    bugRate: number;
    rollbackRate: number;
  };
  executiveSummary: {
    totalTasksAI: number;
    totalTasksHuman: number;
    costSavingsThisMonth: number;
    adoptionRate: number;
  };
}

// Budget Tracker Types
export interface BudgetAllocation {
  category: string;
  allocated: number;
  spent: number;
  remaining: number;
  color: string;
}

export interface BudgetTrackerData {
  totalBudget: number;
  totalSpent: number;
  budgetRemaining: number;
  budgetPercentUsed: number;
  allocations: BudgetAllocation[];
  alerts: {
    type: 'warning' | 'critical';
    message: string;
  }[];
}

// Cost Forecast Types
export interface CostForecastPoint {
  date: string;
  actual?: number;
  forecast?: number;
  budgetLine: number;
}

export interface CostForecastData {
  points: CostForecastPoint[];
  projectedMonthEnd: number;
  projectedOverUnder: number;
  confidence: number;
}

// Savings Breakdown Types
export interface SavingsCategory {
  category: string;
  manualCost: number;
  aiCost: number;
  savings: number;
  tasks: number;
  color: string;
}

export interface SavingsBreakdownData {
  categories: SavingsCategory[];
  totalManualCost: number;
  totalAICost: number;
  totalSavings: number;
  savingsPercentage: number;
}

// Finance Dashboard Types
export interface FinanceDashboardData {
  budget: BudgetTrackerData;
  forecast: CostForecastData;
  savings: SavingsBreakdownData;
  costPerUnit: {
    perTask: number;
    perPR: number;
    perDeploy: number;
    vsManualPerTask: number;
  };
  monthlyTrend: {
    month: string;
    spend: number;
    budget: number;
  }[];
  providerBreakdown: CostBreakdown[];
}

// ================================
// Business Dashboard Types (Phase 2)
// ================================

// Sales Dashboard Types
export interface VelocityBenchmark {
  metric: string;
  before: number;
  after: number;
  improvement: number;
  unit: string;
}

export interface CustomerSuccessStory {
  id: string;
  company: string;
  industry: string;
  tasksCompleted: number;
  timeSaved: number;
  costSavings: number;
  testimonial?: string;
  logoUrl?: string;
}

export interface FeatureRequest {
  id: string;
  title: string;
  requestedBy: string;
  company: string;
  priority: 'high' | 'medium' | 'low';
  status: 'requested' | 'planned' | 'in_progress' | 'shipped';
  votesCount: number;
  createdAt: string;
}

export interface SalesDashboardData {
  demoMode: boolean;
  velocityBenchmarks: VelocityBenchmark[];
  successStories: CustomerSuccessStory[];
  featureRequests: FeatureRequest[];
  platformStats: {
    totalTasksCompleted: number;
    totalCostSavings: number;
    totalTimeSaved: number;
    activeCustomers: number;
    avgROI: number;
  };
  recentWins: {
    id: string;
    title: string;
    value: number;
    closedAt: string;
  }[];
}

// Marketing Dashboard Types
export interface ReleaseItem {
  id: string;
  version: string;
  title: string;
  description: string;
  type: 'feature' | 'improvement' | 'fix';
  status: 'shipped' | 'in_progress' | 'planned';
  releaseDate?: string;
  plannedDate?: string;
  jiraKeys?: string[];
  prNumbers?: number[];
}

export interface FeatureAnnouncement {
  id: string;
  title: string;
  description: string;
  releaseId: string;
  status: 'draft' | 'scheduled' | 'published';
  scheduledFor?: string;
  publishedAt?: string;
  channels: ('blog' | 'email' | 'twitter' | 'linkedin')[];
}

export interface MarketingDashboardData {
  releaseTimeline: ReleaseItem[];
  announcements: FeatureAnnouncement[];
  changelog: {
    week: string;
    features: number;
    improvements: number;
    fixes: number;
  }[];
  velocityMetrics: {
    featuresShippedThisMonth: number;
    avgTimeToShip: number;
    upcomingFeatures: number;
  };
  contentQueue: {
    id: string;
    title: string;
    type: 'blog' | 'case_study' | 'video' | 'webinar';
    status: 'idea' | 'writing' | 'review' | 'scheduled' | 'published';
    dueDate?: string;
  }[];
}

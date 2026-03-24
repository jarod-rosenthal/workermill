export interface UsageStats {
  plan: string;
  tasks: {
    used: number;
    quota: number;
    percent: number;
    isUnlimited: boolean;
  };
  billingPeriod: {
    start: string | null;
    daysUntilReset: number;
  };
}

export interface TaskStats {
  total: number;
  completed: number;
  failed: number;
  deployed: number;
  inProgress: number;
}

export interface DailyUsage {
  date: string;
  tasks: number;
  cost: number;
}

export interface PrdMetrics {
  period: {
    days: number;
    startDate: string;
    endDate: string;
  };
  summary: {
    totalPrdWorkflows: number;
    completed: number;
    failed: number;
    inProgress: number;
    successRate: number;
  };
  costVariance: {
    totalPlannedCost: number;
    totalActualCost: number;
    avgVariancePercent: number;
    dataPoints: number;
  };
  planAccuracy: {
    totalPlannedStories: number;
    totalExecutedStories: number;
    accuracyPercent: number;
  };
  timeToCompletion: {
    byComplexity: Record<string, number>;
    byComplexityReadable: Record<string, string>;
  };
}

export interface FailureCategory {
  category: string;
  label: string;
  count: number;
  percentage: number;
  examples: string[];
}

export interface FailureMetrics {
  period: {
    days: number;
    startDate: string;
    endDate: string;
  };
  summary: {
    totalFailures: number;
    totalTasks: number;
    failureRate: number;
    retriedTasks: number;
    maxRetriesExhausted: number;
  };
  byCategory: FailureCategory[];
  byPersona: Array<{ persona: string; count: number }>;
  byModel: Array<{ model: string; count: number }>;
  weeklyTrend: Array<{ week: string; count: number }>;
}

export interface EffectivenessMetrics {
  period: {
    days: number;
    startDate: string;
    endDate: string;
  };
  summary: {
    total: number;
    successful: number;
    deployed: number;
    failed: number;
    cancelled: number;
    escalated: number;
    reviewRejected: number;
    successRate: number;
    deploymentRate: number;
    firstAttemptRate: number;
    prAcceptanceRate: number;
    escalationRate: number;
  };
  prStats: {
    total: number;
    accepted: number;
    rejected: number;
    acceptanceRate: number;
  };
  byModel: Array<{
    model: string;
    total: number;
    successRate: number;
    deploymentRate: number;
    firstAttemptRate: number;
  }>;
  byPersona: Array<{
    persona: string;
    total: number;
    successRate: number;
    deploymentRate: number;
    firstAttemptRate: number;
  }>;
  trend: Array<{
    date: string;
    success: number;
    failed: number;
    deployed: number;
    total: number;
    successRate: number;
  }>;
}

export interface ReviewMetrics {
  period: {
    days: number;
    startDate: string;
    endDate: string;
  };
  summary: {
    totalTasks: number;
    reviewedTasks: number;
    adoptionRate: number;
    firstPassApprovalRate: number;
    avgRevisionsPerTask: number;
  };
  revisionDistribution: {
    zero: number;
    one: number;
    two: number;
    threeOrMore: number;
  };
  decisions: {
    approved: number;
    revisionNeeded: number;
    rejected: number;
    escalated: number;
  };
  qualityImpact: {
    reviewedAvgAccuracy: number | null;
    nonReviewedAvgAccuracy: number | null;
    reviewedOutcomes: { accepted: number; rejected: number; partial: number };
    nonReviewedOutcomes: { accepted: number; rejected: number; partial: number };
  };
  efficiency: {
    reviewedAvgDurationMinutes: number | null;
    nonReviewedAvgDurationMinutes: number | null;
    reviewedAvgCost: number | null;
    nonReviewedAvgCost: number | null;
  };
  trend: Array<{
    date: string;
    reviewedCount: number;
    approvedFirstPass: number;
    totalRevisions: number;
  }>;
  byPersona: Array<{
    persona: string;
    reviewedCount: number;
    approvalRate: number;
    avgRevisions: number;
  }>;
  byModel: Array<{
    model: string;
    reviewedCount: number;
    approvalRate: number;
    avgRevisions: number;
  }>;
}

export interface CodeQualityMetrics {
  period: {
    days: number;
    startDate: string;
    endDate: string;
  };
  summary: {
    totalTasks: number;
    tasksWithMetrics: number;
    metricsRate: number;
    averageQualityScore: number;
    averageLintScore: number;
    averageTypecheckScore: number;
    averageTestScore: number;
    averageCoverageScore: number;
    averageSecurityScore: number;
  };
  scoreDistribution: {
    excellent: number;
    good: number;
    fair: number;
    poor: number;
  };
  byPersona: Array<{
    persona: string;
    taskCount: number;
    avgScore: number;
  }>;
  byModel: Array<{
    model: string;
    taskCount: number;
    avgScore: number;
  }>;
  trend: Array<{
    date: string;
    taskCount: number;
    avgScore: number;
  }>;
  lowQualityTasks: Array<{
    id: string;
    jiraKey: string | null;
    summary: string | null;
    qualityScore: number | null;
    lintScore: number | null;
    typecheckScore: number | null;
    testScore: number | null;
    coverageScore: number | null;
    securityScore: number | null;
    persona: string | null;
    model: string | null;
    completedAt: string | null;
  }>;
}

export interface TokenUsageMetrics {
  period: {
    days: number;
    startDate: string;
    endDate: string;
  };
  summary: {
    taskCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheCreation: number;
    totalCacheRead: number;
    totalTokens: number;
    totalCost: number;
    cacheEfficiency: number;
    avgTokensPerTask: number;
    avgCostPerTask: number;
  };
  byPhase: Array<{
    phase: string;
    records: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cost: number;
  }>;
  byPersona: Array<{
    persona: string;
    records: number;
    totalTokens: number;
    cost: number;
  }>;
  byModel: Array<{
    model: string;
    records: number;
    totalTokens: number;
    cost: number;
  }>;
  byOperationType: Array<{
    operationType: string;
    records: number;
    totalTokens: number;
    cost: number;
  }>;
  trends: Array<{
    date: string;
    tasks: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cost: number;
  }>;
}

export interface BusinessOutcomes {
  period: {
    days: number;
    range: string;
    startDate: string;
    endDate: string;
  };
  summary: {
    prsMerged: number;
    issuesClosed: number;
    totalLinesChanged: number;
    totalFilesModified: number;
    successfulTasks: number;
    totalTasks: number;
    successRate: number;
    avgLinesPerTask: number;
    avgFilesPerTask: number;
    costPerLineChanged: number;
    totalCost: number;
    executionHours: number;
  };
  byComplexity: Array<{
    complexity: string;
    count: number;
    linesChanged: number;
    cost: number;
  }>;
  trend: Array<{
    date: string;
    tasksCompleted: number;
    prsMerged: number;
    linesChanged: number;
  }>;
  topRepositories: Array<{
    repo: string;
    tasksCompleted: number;
    prsMerged: number;
    linesChanged: number;
  }>;
}

export interface TimeSaved {
  period: {
    days: number;
    range: string;
    startDate: string;
    endDate: string;
  };
  summary: {
    totalTasksAnalyzed: number;
    tasksWithComplexityData: number;
    tasksWithoutComplexityData: number;
    estimatedHoursSaved: number;
    estimatedHoursSavedMin: number;
    estimatedHoursSavedMax: number;
    avgHoursSavedPerTask: number;
    totalLinesChanged: number;
    totalCost: number;
    costPerHourSaved: number;
  };
  byComplexity: Array<{
    complexity: string;
    taskCount: number;
    hoursSaved: number;
    linesChanged: number;
    avgHoursPerTask: number;
  }>;
  byPersona: Array<{
    persona: string;
    taskCount: number;
    hoursSaved: number;
  }>;
  methodology: {
    description: string;
    complexityBenchmarks: Record<string, string>;
    codeVolumeBenchmark: string;
    calculation: string;
    limitations: string[];
  };
}

export interface RoiMetrics {
  range: string;
  startDate: string;
  metrics: {
    totalTasks: number;
    successfulTasks: number;
    failedTasks: number;
    prsCreated: number;
    successRate: number;
    totalCost: number;
    avgCostPerTask: number;
    costPerPr: number;
    costPerSuccess: number;
    avgExecutionMinutes: number;
    estimatedDevHoursSaved: number;
    estimatedDevCostSaved: number;
    roi: number;
    netSavings: number;
    breakEvenRate: number;
    costPerDevHourEquivalent: number;
    roiPositive: boolean;
    roiCategory: "excellent" | "good" | "positive" | "negative";
    assumptions: {
      developerHourlyRate: number;
      estimatedHoursPerTask: number;
      isCustomRate: boolean;
    };
  };
}

export interface PlannerCriticMetrics {
  summary: {
    totalPlans: number;
    avgCriticScore: number;
    avgIterations: number;
    firstAttemptApprovalRate: number;
    fileCapHitRate: number;
  };
  scoreDistribution: Array<{
    range: string;
    count: number;
    percentage: number;
  }>;
  iterationBreakdown: Array<{
    iterations: number;
    count: number;
    percentage: number;
  }>;
  recentPlans: Array<{
    taskId: string;
    summary: string;
    criticScore: number;
    iterations: number;
    storyCount: number;
    fileCapTruncations: number;
    planningDurationMs: number | null;
    createdAt: string;
  }>;
  commonRisks: Array<{
    risk: string;
    count: number;
  }>;
  trend: Array<{
    week: string;
    planCount: number;
    avgScore: number;
    avgIterations: number;
  }>;
}

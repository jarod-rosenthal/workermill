// Dashboard Components Index
// Re-export all dashboard components for cleaner imports

// Shared Components
export { MetricTile, MetricTileCompact, MetricGrid } from './MetricTile';
export { TaskCard, TaskCardSkeleton } from './TaskCard';
export { ActivityFeed, ActivityAlert } from './ActivityFeed';
export { RoleSwitcher, RoleSwitcherTabs, useRoleState } from './RoleSwitcher';

// Manager/Cost Components
export { CostMeter, CostSparkline } from './CostMeter';
export { ApprovalQueue, ApprovalBadge } from './ApprovalQueue';
export { TeamActivity, TeamActivityCompact } from './TeamActivity';

// DevOps Components
export { DeploymentPipeline, PipelineIndicator } from './DeploymentPipeline';
export { HealthMonitor, HealthIndicator, HealthSummaryBar, UptimeChart } from './HealthMonitor';

// Security Components
export { SecurityFindings, SecurityBadge } from './SecurityFindings';
export { ComplianceStatus, ComplianceBadge } from './ComplianceStatus';
export { AuditTrail, AuditListCompact } from './AuditTrail';

// Executive Dashboard Components (Phase 1)
export { ROICalculator } from './ROICalculator';
export { AdoptionHeatmap, AdoptionTrend } from './AdoptionHeatmap';
export { RiskScorecard, RiskBadge } from './RiskScorecard';
export { BudgetTracker, BudgetSummaryCard } from './BudgetTracker';
export { CostForecast } from './CostForecast';
export { SavingsBreakdown, SavingsSummary } from './SavingsBreakdown';

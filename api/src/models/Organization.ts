import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from "typeorm";
import { User } from "./User.js";
import { WorkerTask } from "./WorkerTask.js";

export type OrganizationPlan = "free" | "starter" | "team" | "business" | "pro" | "enterprise";

/**
 * Feature flags for gradual rollout of new features.
 * All flags should default to false for backward compatibility.
 */
export interface OrganizationFeatureFlags {
  /** Use unified AIClient interface (Phase 2-3 migration) */
  unifiedAiClient?: boolean;
  /** Enable shadow mode - run both old and new paths, compare results */
  shadowModeEnabled?: boolean;
}

// Plan quotas (included compute hours per month)
export const PLAN_HOURS: Record<OrganizationPlan, number> = {
  free: 1,         // Legacy - new signups go to starter
  starter: 5,      // $29/mo - 5 compute hours included
  team: 20,        // $79/mo - 20 compute hours included
  business: 60,    // $199/mo - 60 compute hours included
  pro: 20,         // Legacy - maps to team
  enterprise: -1,  // Unlimited
};

// Legacy: Plan quotas (approximate tasks per month, assuming 20 min avg)
export const PLAN_QUOTAS: Record<OrganizationPlan, number> = {
  free: 3,         // ~1 hour / 20 min
  starter: 15,     // ~5 hours / 20 min
  team: 60,        // ~20 hours / 20 min
  business: 180,   // ~60 hours / 20 min
  pro: 60,         // Legacy - maps to team
  enterprise: -1,  // Unlimited
};

// Plan user limits
export const PLAN_USER_LIMITS: Record<OrganizationPlan, number> = {
  free: 1,         // Legacy
  starter: 5,      // $29/mo - up to 5 users
  team: 20,        // $79/mo - up to 20 users
  business: -1,    // $199/mo - unlimited users
  pro: 20,         // Legacy - maps to team
  enterprise: -1,  // Unlimited
};

// Plan monthly prices (in dollars)
export const PLAN_PRICES: Record<OrganizationPlan, number> = {
  free: 0,
  starter: 29,
  team: 79,
  business: 199,
  pro: 79,         // Legacy - maps to team
  enterprise: 0,   // Custom pricing
};

// Overage rates per hour (in dollars)
export const PLAN_OVERAGE_RATES: Record<OrganizationPlan, number> = {
  free: 8,         // Same as starter
  starter: 8,      // $8/hr overage
  team: 6,         // $6/hr overage
  business: 4,     // $4/hr overage
  pro: 6,          // Legacy - maps to team
  enterprise: 4,   // Custom - same as business default
};

@Entity("organizations")
export class Organization {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 255 })
  name: string;

  @Column({ type: "varchar", length: 100, nullable: true, unique: true })
  slug: string | null;

  @Column({ type: "varchar", length: 50, default: "free" })
  plan: OrganizationPlan;

  // Stripe Billing
  @Column({ name: "stripe_customer_id", type: "varchar", length: 255, nullable: true })
  stripeCustomerId: string | null;

  @Column({ name: "stripe_subscription_id", type: "varchar", length: 255, nullable: true })
  stripeSubscriptionId: string | null;

  @Column({ name: "stripe_subscription_status", type: "varchar", length: 50, nullable: true })
  stripeSubscriptionStatus: string | null;

  // Task Quotas
  @Column({ name: "task_quota", type: "int", default: 10 })
  taskQuota: number;

  @Column({ name: "task_usage_this_month", type: "int", default: 0 })
  taskUsageThisMonth: number;

  @Column({ name: "billing_cycle_start", type: "timestamp", nullable: true })
  billingCycleStart: Date | null;

  // Notifications
  @Column({ name: "slack_webhook_url", type: "varchar", length: 500, nullable: true })
  slackWebhookUrl: string | null;

  @Column({ name: "api_key", type: "varchar", length: 255, nullable: true })
  apiKey: string | null;

  @Column({ name: "jira_webhook_secret", type: "varchar", length: 255, nullable: true })
  jiraWebhookSecret: string | null;

  @Column({ name: "github_webhook_secret", type: "varchar", length: 255, nullable: true })
  githubWebhookSecret: string | null;

  @Column({ name: "gitlab_webhook_secret", type: "varchar", length: 255, nullable: true })
  gitlabWebhookSecret: string | null;

  @Column({ name: "bitbucket_webhook_secret", type: "varchar", length: 255, nullable: true })
  bitbucketWebhookSecret: string | null;

  @Column({ name: "default_github_repo", type: "varchar", length: 255, nullable: true })
  defaultGithubRepo: string | null;

  @Column({ name: "default_bitbucket_repo", type: "varchar", length: 255, nullable: true })
  defaultBitbucketRepo: string | null;

  @Column({ name: "default_gitlab_repo", type: "varchar", length: 255, nullable: true })
  defaultGitlabRepo: string | null;

  // SCM Provider Configuration
  @Column({ name: "scm_provider", type: "varchar", length: 20, default: "github" })
  scmProvider: "github" | "gitlab" | "bitbucket";

  @Column({ name: "scm_base_url", type: "varchar", length: 500, nullable: true })
  scmBaseUrl: string | null;

  // Issue Tracker Provider Configuration
  @Column({ name: "issue_tracker_provider", type: "varchar", length: 20, default: "jira" })
  issueTrackerProvider: "jira" | "linear" | "github-issues";

  @Column({ name: "system_enabled", type: "boolean", default: true })
  systemEnabled: boolean;

  @Column({ name: "watcher_enabled", type: "boolean", default: false })
  watcherEnabled: boolean;

  @Column({ name: "orchestrator_running", type: "boolean", default: false })
  orchestratorRunning: boolean;

  @Column({ name: "manager_enabled", type: "boolean", default: true })
  managerEnabled: boolean;

  @Column({ name: "manager_model_id", type: "varchar", length: 100, default: "gpt-5.1-codex" })
  managerModelId: string;

  @Column({ name: "manager_provider", type: "varchar", length: 50, default: "openai" })
  managerProvider: string;

  @Column({ name: "max_review_revisions", type: "int", default: 3 })
  maxReviewRevisions: number;

  @Column({ name: "counters_reset_at", type: "timestamp", nullable: true })
  countersResetAt: Date | null;

  // Cumulative cost tracking
  @Column({ name: "cumulative_cost_usd", type: "decimal", precision: 12, scale: 4, default: 0 })
  cumulativeCostUsd: number;

  @Column({ name: "cost_reset_at", type: "timestamp", nullable: true })
  costResetAt: Date | null;

  // Data Management Settings
  @Column({ name: "log_retention_days", type: "int", default: 30 })
  logRetentionDays: number;

  @Column({ name: "task_retention_days", type: "int", default: 90 })
  taskRetentionDays: number;

  // Worker Settings
  @Column({ name: "max_concurrent_workers", type: "int", default: 3 })
  maxConcurrentWorkers: number;

  @Column({ name: "default_max_retries", type: "int", default: 3 })
  defaultMaxRetries: number;

  @Column({ name: "task_cooldown_seconds", type: "int", default: 30 })
  taskCooldownSeconds: number;

  @Column({ name: "default_worker_model", type: "varchar", length: 100, default: "claude-opus-4-6" })
  defaultWorkerModel: string;

  @Column({ name: "default_worker_persona", type: "varchar", length: 50, default: "backend_developer" })
  defaultWorkerPersona: string;

  // Cost Settings
  @Column({ name: "cost_alert_threshold_usd", type: "decimal", precision: 10, scale: 2, nullable: true })
  costAlertThresholdUsd: number | null;

  // Budget Limits (AI FinOps)
  @Column({ name: "daily_budget_limit_usd", type: "decimal", precision: 10, scale: 2, nullable: true })
  dailyBudgetLimitUsd: number | null;

  @Column({ name: "weekly_budget_limit_usd", type: "decimal", precision: 10, scale: 2, nullable: true })
  weeklyBudgetLimitUsd: number | null;

  @Column({ name: "monthly_budget_limit_usd", type: "decimal", precision: 10, scale: 2, nullable: true })
  monthlyBudgetLimitUsd: number | null;

  // Per-task cost ceiling - terminates task when exceeded
  @Column({ name: "per_task_cost_ceiling_usd", type: "decimal", precision: 10, scale: 2, nullable: true })
  perTaskCostCeilingUsd: number | null;

  // Budget override - temporarily bypass budget limits
  @Column({ name: "budget_override_until", type: "timestamp", nullable: true })
  budgetOverrideUntil: Date | null;

  @Column({ name: "budget_override_reason", type: "text", nullable: true })
  budgetOverrideReason: string | null;

  // Display Settings
  @Column({ name: "completed_task_display_minutes", type: "int", default: 10 })
  completedTaskDisplayMinutes: number;

  @Column({ name: "intermediate_task_display_minutes", type: "int", default: 15 })
  intermediateTaskDisplayMinutes: number;

  @Column({ name: "dry_run_visibility_minutes", type: "int", default: 1 })
  dryRunVisibilityMinutes: number;

  // Ralph Execution Settings
  @Column({ name: "use_ralph_execution", type: "boolean", default: false })
  useRalphExecution: boolean;

  @Column({ name: "ralph_max_stories", type: "int", default: 10 })
  ralphMaxStories: number;

  // Multi-Provider Settings
  @Column({ name: "primary_provider", type: "varchar", length: 50, default: "anthropic" })
  primaryProvider: string;

  @Column({ name: "provider_settings", type: "jsonb", default: {} })
  providerSettings: Record<string, unknown>;

  // Provider Routing - Auto-route personas to specific providers
  // Format: { "qa_engineer": { "provider": "ollama", "model": "qwen2.5-coder:32b" } }
  @Column({ name: "provider_routing", type: "jsonb", default: {} })
  providerRouting: Record<string, { provider: string; model?: string }>;

  // Ollama Self-Hosted Settings
  @Column({ name: "ollama_base_url", type: "varchar", length: 500, nullable: true })
  ollamaBaseUrl: string | null;

  @Column({ name: "ollama_context_window", type: "int", default: 65536 })
  ollamaContextWindow: number;

  // vLLM/GPU Inference Settings
  @Column({ name: "vllm_base_url", type: "varchar", length: 500, nullable: true })
  vllmBaseUrl: string | null;

  // Persona Studio Settings
  @Column({ name: "use_db_personas", type: "boolean", default: false })
  useDbPersonas: boolean; // Feature flag: load personas from DB instead of files

  // Org-Specific Persona Inference Rules
  // Format: {
  //   labelMappings: { "myteam": "custom_persona_slug" },
  //   keywordPatterns: { "custom_persona_slug": "keyword1|keyword2|keyword3" },
  //   defaultPersona: "custom_persona_slug" // optional override of backend_developer
  // }
  @Column({ name: "persona_inference_rules", type: "jsonb", default: {} })
  personaInferenceRules: {
    labelMappings?: Record<string, string>;
    keywordPatterns?: Record<string, string>;
    defaultPersona?: string;
  };

  // Cost-First Model Control
  @Column({ name: "allow_sonnet", type: "boolean", default: true })
  allowSonnet: boolean; // Can users opt-in to Sonnet via label?

  @Column({ name: "allow_opus", type: "boolean", default: false })
  allowOpus: boolean; // Can users opt-in to Opus via label? (disabled by default)

  @Column({ name: "max_story_points", type: "int", default: 3 })
  maxStoryPoints: number; // Max points per story (forces decomposition)

  // V2 Multi-Phase Planning
  @Column({ name: "use_multi_phase_planning", type: "boolean", default: true })
  useMultiPhasePlanning: boolean; // Use V2 theme-based planning for PRD/epic tickets

  @Column({ name: "min_plan_quality_score", type: "decimal", precision: 3, scale: 1, default: 3.5 })
  minPlanQualityScore: number; // Minimum quality score required for plan approval

  // Planning Agent Settings
  @Column({ name: "planning_agent_provider", type: "varchar", length: 50, default: "anthropic" })
  planningAgentProvider: string; // Provider for planning/decomposition (anthropic, openai, google)

  @Column({ name: "planning_agent_model", type: "varchar", length: 100, default: "claude-sonnet-4-5-20250929" })
  planningAgentModel: string; // Model used for planning/decomposition (Project Manager)

  @Column({ name: "story_calibration_multiplier", type: "decimal", precision: 3, scale: 2, default: 0.4 })
  storyCalibrationMultiplier: number; // Temperature dial: 0.3-1.0, lower = fewer stories

  @Column({ name: "enable_dependency_auditor", type: "boolean", default: false })
  enableDependencyAuditor: boolean; // Enable semantic dependency auditing in planning

  // Multi-Persona Single Container Execution
  @Column({ name: "multi_persona_enabled", type: "boolean", default: false })
  multiPersonaEnabled: boolean; // Enable multi-persona execution in single container

  // Email Settings
  @Column({ name: "email_from_address", type: "varchar", length: 255, nullable: true })
  emailFromAddress: string | null; // Custom verified SES address

  @Column({ name: "email_notifications_enabled", type: "boolean", default: true })
  emailNotificationsEnabled: boolean; // Master toggle for email notifications

  @Column({ name: "email_log_retention_days", type: "int", default: 90 })
  emailLogRetentionDays: number; // Cleanup policy for email logs

  // Auto-workflow settings (apply when Jira labels not explicitly set)
  @Column({ name: "auto_review_enabled", type: "boolean", default: false })
  autoReviewEnabled: boolean; // Require review by default (like 'review' label)

  @Column({ name: "auto_deploy_enabled", type: "boolean", default: false })
  autoDeployEnabled: boolean; // Auto-deploy by default (like 'deploy' label)

  @Column({ name: "auto_improve_enabled", type: "boolean", default: false })
  autoImproveEnabled: boolean; // Auto-improve WorkerMill after tasks complete (like 'improve' label)

  @Column({ name: "auto_skill_extraction", type: "boolean", default: true })
  autoSkillExtraction: boolean; // Auto-extract skills and create memories after task completion

  @Column({
    name: "default_email_preferences",
    type: "jsonb",
    default: { taskCompleted: true, taskFailed: true, costAlerts: true, prCreated: false, frequency: "immediate" },
  })
  defaultEmailPreferences: {
    taskCompleted?: boolean;
    taskFailed?: boolean;
    costAlerts?: boolean;
    prCreated?: boolean;
    frequency?: string;
  };

  // Credit-Based Billing
  @Column({ name: "credit_balance_cents", type: "int", default: 0 })
  creditBalanceCents: number;

  @Column({ name: "auto_recharge_enabled", type: "boolean", default: false })
  autoRechargeEnabled: boolean;

  @Column({ name: "auto_recharge_threshold_cents", type: "int", default: 1000 })
  autoRechargeThresholdCents: number;

  @Column({ name: "auto_recharge_amount_cents", type: "int", default: 5000 })
  autoRechargeAmountCents: number;

  @Column({ name: "billing_paused", type: "boolean", default: false })
  billingPaused: boolean;

  @Column({ name: "billing_paused_reason", type: "text", nullable: true })
  billingPausedReason: string | null;

  @Column({ name: "free_credits_remaining_cents", type: "int", default: 0 })
  freeCreditsRemainingCents: number;

  @Column({ name: "signup_deposit_completed", type: "boolean", default: false })
  signupDepositCompleted: boolean;

  // Warm Container Pool Settings
  @Column({ name: "warm_pool_size", type: "int", default: 0 })
  warmPoolSize: number;

  @Column({ name: "warm_pool_hours_start", type: "int", default: 9 })
  warmPoolHoursStart: number; // Start hour (0-23) for warm pool to be active

  @Column({ name: "warm_pool_hours_end", type: "int", default: 18 })
  warmPoolHoursEnd: number; // End hour (0-23) for warm pool to be active

  @Column({ name: "warm_pool_timezone", type: "varchar", length: 50, default: "America/New_York" })
  warmPoolTimezone: string;

  // Microsoft SSO - Azure AD Tenant ID for auto-org creation/joining
  @Column({ name: "azure_tenant_id", type: "varchar", length: 36, nullable: true, unique: true })
  azureTenantId: string | null;

  // Quality Gate Settings
  @Column({ name: "quality_gate_enabled", type: "boolean", default: false })
  qualityGateEnabled: boolean;

  @Column({ name: "min_quality_score", type: "int", nullable: true })
  minQualityScore: number | null;

  @Column({ name: "min_test_coverage_percent", type: "int", nullable: true })
  minTestCoveragePercent: number | null;

  @Column({ name: "max_security_high_vulns", type: "int", nullable: true })
  maxSecurityHighVulns: number | null;

  @Column({ name: "block_on_type_errors", type: "boolean", default: false })
  blockOnTypeErrors: boolean;

  @Column({ name: "block_on_test_failures", type: "boolean", default: false })
  blockOnTestFailures: boolean;

  // External Quality Tool Integrations
  @Column({ name: "sonarqube_url", type: "varchar", length: 500, nullable: true })
  sonarqubeUrl: string | null;

  @Column({ name: "sonarqube_token", type: "varchar", length: 255, nullable: true })
  sonarqubeToken: string | null;

  @Column({ name: "coderabbit_enabled", type: "boolean", default: false })
  coderabbitEnabled: boolean;

  @Column({ name: "coderabbit_api_key", type: "varchar", length: 255, nullable: true })
  coderabbitApiKey: string | null;

  @Column({ name: "deepsource_enabled", type: "boolean", default: false })
  deepsourceEnabled: boolean;

  @Column({ name: "deepsource_token", type: "varchar", length: 255, nullable: true })
  deepsourceToken: string | null;

  // Custom Quality Webhook (for custom quality tools)
  @Column({ name: "quality_webhook_url", type: "varchar", length: 500, nullable: true })
  qualityWebhookUrl: string | null;

  @Column({ name: "quality_webhook_secret", type: "varchar", length: 255, nullable: true })
  qualityWebhookSecret: string | null;

  // Auto-Fix Settings (triggered on quality gate failure)
  @Column({ name: "auto_fix_enabled", type: "boolean", default: false })
  autoFixEnabled: boolean;

  @Column({ name: "auto_fix_max_iterations", type: "int", default: 3 })
  autoFixMaxIterations: number;

  @Column({ name: "auto_fix_stats", type: "jsonb", default: {} })
  autoFixStats: {
    totalAttempts?: number;
    successfulFixes?: number;
    failedFixes?: number;
    fixesByType?: Record<string, { attempts: number; successes: number }>;
    lastUpdated?: string;
  };

  // SIEM Integration Settings
  @Column({ name: "siem_enabled", type: "boolean", default: false })
  siemEnabled: boolean;

  @Column({ name: "siem_provider", type: "varchar", length: 50, nullable: true })
  siemProvider: "splunk" | "datadog" | "sumo_logic" | "generic" | null;

  @Column({ name: "siem_webhook_url", type: "varchar", length: 500, nullable: true })
  siemWebhookUrl: string | null;

  @Column({ name: "siem_webhook_secret", type: "varchar", length: 255, nullable: true })
  siemWebhookSecret: string | null;

  @Column({ name: "siem_event_filters", type: "jsonb", default: {} })
  siemEventFilters: {
    includeActions?: string[];
    excludeActions?: string[];
    minSeverity?: "info" | "low" | "medium" | "high" | "critical";
  };

  // Feature Flags for gradual rollout
  @Column({ name: "feature_flags", type: "jsonb", default: {} })
  featureFlags: OrganizationFeatureFlags;

  // Data Residency Settings
  @Column({ name: "data_region", type: "varchar", length: 20, default: "us-east-1" })
  dataRegion: string;

  @Column({ name: "data_residency_mode", type: "varchar", length: 20, default: "standard" })
  dataResidencyMode: "standard" | "eu_only" | "us_only" | "regional";

  // Customer-Managed Encryption Keys (CMEK)
  @Column({ name: "cmek_enabled", type: "boolean", default: false })
  cmekEnabled: boolean;

  @Column({ name: "cmek_key_arn", type: "varchar", length: 500, nullable: true })
  cmekKeyArn: string | null;

  @Column({ name: "cmek_key_alias", type: "varchar", length: 255, nullable: true })
  cmekKeyAlias: string | null;

  @Column({ name: "cmek_key_region", type: "varchar", length: 20, nullable: true })
  cmekKeyRegion: string | null;

  @Column({ name: "cmek_last_rotation", type: "timestamp", nullable: true })
  cmekLastRotation: Date | null;

  @Column({ name: "cmek_rotation_schedule_days", type: "int", nullable: true })
  cmekRotationScheduleDays: number | null;

  // Codebase RAG Settings
  @Column({ name: "codebase_indexing_enabled", type: "boolean", default: false })
  codebaseIndexingEnabled: boolean;

  @Column({ name: "codebase_max_files_per_repo", type: "int", default: 500 })
  codebaseMaxFilesPerRepo: number;

  @Column({ name: "codebase_max_file_size_kb", type: "int", default: 100 })
  codebaseMaxFileSizeKb: number;

  @Column({
    name: "codebase_exclude_patterns",
    type: "jsonb",
    default: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "*.min.js",
      "*.min.css",
      "*.lock",
      "package-lock.json",
      "yarn.lock",
      "pnpm-lock.yaml",
      ".git/**",
      "coverage/**",
      "__pycache__/**",
      "*.pyc",
      "vendor/**",
      "*.bundle.js",
      "*.chunk.js",
    ],
  })
  codebaseExcludePatterns: string[];

  @Column({
    name: "codebase_include_languages",
    type: "jsonb",
    default: [
      "typescript",
      "javascript",
      "python",
      "go",
      "rust",
      "java",
      "ruby",
      "php",
      "c",
      "cpp",
      "csharp",
    ],
  })
  codebaseIncludeLanguages: string[];

  @Column({ name: "codebase_auto_index_on_task", type: "boolean", default: true })
  codebaseAutoIndexOnTask: boolean;

  @Column({ name: "codebase_max_retrieval_chunks", type: "int", default: 10 })
  codebaseMaxRetrievalChunks: number;

  // Platform Management Tenant
  @Column({ name: "is_platform_org", type: "boolean", default: false })
  isPlatformOrg: boolean;

  // Resilience Settings
  @Column({ name: "blocker_max_auto_retries", type: "int", default: 3 })
  blockerMaxAutoRetries: number;

  @Column({ name: "blocker_auto_retry_enabled", type: "boolean", default: true })
  blockerAutoRetryEnabled: boolean;

  @Column({ name: "push_after_commit", type: "boolean", default: true })
  pushAfterCommit: boolean;

  @Column({ name: "graceful_shutdown_enabled", type: "boolean", default: true })
  gracefulShutdownEnabled: boolean;

  @Column({ name: "self_review_enabled", type: "boolean", default: true })
  selfReviewEnabled: boolean;

  // Repository list for multi-repo workflows (array of "owner/repo" strings)
  @Column({ name: "repositories", type: "jsonb", default: [] })
  repositories: string[];

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @OneToMany(() => User, (user) => user.organization)
  users: User[];

  @OneToMany(() => WorkerTask, (task) => task.organization)
  tasks: WorkerTask[];

  // =========================================================================
  // Platform Org Static Helpers
  // =========================================================================

  /**
   * Fixed platform org ID used across all environments
   */
  static readonly PLATFORM_ORG_ID = "a0000000-0000-4000-8000-000000000001";

  /**
   * Get the platform organization (management tenant).
   * Returns null if platform org is not yet created.
   *
   * Note: This requires AppDataSource to be initialized.
   * Import AppDataSource lazily to avoid circular dependencies.
   */
  static async getPlatformOrg(): Promise<Organization | null> {
    // Lazy import to avoid circular dependency with AppDataSource
    const { AppDataSource } = await import("../db/connection.js");
    const repo = AppDataSource.getRepository(Organization);
    return repo.findOne({ where: { isPlatformOrg: true } });
  }

  /**
   * Check if this organization is the platform management tenant
   */
  isPlatform(): boolean {
    return this.isPlatformOrg === true;
  }

  /**
   * Get the default repository for this organization based on its SCM provider.
   * Each SCM provider has its own default repo field.
   */
  getDefaultRepo(): string | null {
    switch (this.scmProvider) {
      case "bitbucket":
        return this.defaultBitbucketRepo;
      case "gitlab":
        return this.defaultGitlabRepo;
      case "github":
      default:
        return this.defaultGithubRepo;
    }
  }

  /**
   * Set the default repository for the specified SCM provider.
   */
  setDefaultRepo(provider: "github" | "gitlab" | "bitbucket", repo: string | null): void {
    switch (provider) {
      case "bitbucket":
        this.defaultBitbucketRepo = repo;
        break;
      case "gitlab":
        this.defaultGitlabRepo = repo;
        break;
      case "github":
      default:
        this.defaultGithubRepo = repo;
        break;
    }
  }

  /**
   * Get the list of repositories for this organization.
   * Returns the explicit repositories list if non-empty,
   * otherwise falls back to the single default repo.
   */
  getRepositories(): string[] {
    if (this.repositories && this.repositories.length > 0) {
      return this.repositories;
    }
    const defaultRepo = this.getDefaultRepo();
    return defaultRepo ? [defaultRepo] : [];
  }
}

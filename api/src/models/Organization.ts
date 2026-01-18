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

export type OrganizationPlan = "free" | "starter" | "pro" | "enterprise";

// Plan quotas (tasks per month)
export const PLAN_QUOTAS: Record<OrganizationPlan, number> = {
  free: 10,
  starter: 100,
  pro: -1, // Unlimited
  enterprise: -1, // Unlimited
};

// Plan user limits
export const PLAN_USER_LIMITS: Record<OrganizationPlan, number> = {
  free: 1,
  starter: 5,
  pro: 20,
  enterprise: -1, // Unlimited
};

@Entity("organizations")
export class Organization {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 255 })
  name: string;

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

  @Column({ name: "default_github_repo", type: "varchar", length: 255, nullable: true })
  defaultGithubRepo: string | null;

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

  @Column({ name: "default_worker_model", type: "varchar", length: 100, default: "claude-haiku-4-5-20251001" })
  defaultWorkerModel: string;

  @Column({ name: "default_worker_persona", type: "varchar", length: 50, default: "backend_developer" })
  defaultWorkerPersona: string;

  // Cost Settings
  @Column({ name: "cost_alert_threshold_usd", type: "decimal", precision: 10, scale: 2, nullable: true })
  costAlertThresholdUsd: number | null;

  // Display Settings
  @Column({ name: "completed_task_display_minutes", type: "int", default: 10 })
  completedTaskDisplayMinutes: number;

  @Column({ name: "intermediate_task_display_minutes", type: "int", default: 15 })
  intermediateTaskDisplayMinutes: number;

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

  // Cost-First Model Control
  @Column({ name: "allow_sonnet", type: "boolean", default: true })
  allowSonnet: boolean; // Can users opt-in to Sonnet via label?

  @Column({ name: "allow_opus", type: "boolean", default: false })
  allowOpus: boolean; // Can users opt-in to Opus via label? (disabled by default)

  @Column({ name: "max_story_points", type: "int", default: 3 })
  maxStoryPoints: number; // Max points per story (forces decomposition)

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @OneToMany(() => User, (user) => user.organization)
  users: User[];

  @OneToMany(() => WorkerTask, (task) => task.organization)
  tasks: WorkerTask[];
}

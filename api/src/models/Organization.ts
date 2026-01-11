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

@Entity("organizations")
export class Organization {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 255 })
  name: string;

  @Column({ type: "varchar", length: 50, default: "free" })
  plan: string;

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

  @Column({ name: "manager_model_id", type: "varchar", length: 100, default: "claude-sonnet-4-20250514" })
  managerModelId: string;

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

  @Column({ name: "default_worker_model", type: "varchar", length: 100, default: "claude-3-5-haiku-20241022" })
  defaultWorkerModel: string;

  @Column({ name: "default_worker_persona", type: "varchar", length: 50, default: "backend_developer" })
  defaultWorkerPersona: string;

  // Cost Settings
  @Column({ name: "cost_alert_threshold_usd", type: "decimal", precision: 10, scale: 2, nullable: true })
  costAlertThresholdUsd: number | null;

  // Display Settings
  @Column({ name: "completed_task_display_minutes", type: "int", default: 10 })
  completedTaskDisplayMinutes: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @OneToMany(() => User, (user) => user.organization)
  users: User[];

  @OneToMany(() => WorkerTask, (task) => task.organization)
  tasks: WorkerTask[];
}

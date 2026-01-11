import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Organization } from "./Organization.js";

export type WorkerPersona =
  | "frontend_developer"
  | "backend_developer"
  | "devops_engineer"
  | "security_engineer"
  | "qa_engineer"
  | "tech_writer"
  | "project_manager";

export type WorkerTaskStatus =
  | "queued"
  | "dispatching"
  | "claimed"
  | "environment_setup"
  | "executing"
  | "review_requested"
  | "pr_merged"
  | "completed"
  | "failed"
  | "cancelled";

@Entity("worker_tasks")
export class WorkerTask {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  // Jira reference
  @Column({ name: "jira_issue_key", type: "varchar", length: 50 })
  jiraIssueKey: string;

  @Column({ name: "jira_issue_id", type: "varchar", length: 50 })
  jiraIssueId: string;

  // Task content
  @Column({ type: "varchar", length: 500 })
  summary: string;

  @Column({ type: "text", nullable: true })
  description: string | null;

  @Column({ name: "jira_fields", type: "jsonb", default: {} })
  jiraFields: Record<string, unknown>;

  // Worker assignment
  @Column({ name: "worker_persona", type: "varchar", length: 50 })
  workerPersona: WorkerPersona;

  @Column({ name: "worker_model", type: "varchar", length: 50, default: "claude-3-5-haiku-20241022" })
  workerModel: string;

  // Execution state
  @Column({ type: "varchar", length: 30, default: "queued" })
  status: WorkerTaskStatus;

  @Column({ type: "int", default: 3 })
  priority: number;

  // GitHub integration
  @Column({ name: "github_repo", type: "varchar", length: 255 })
  githubRepo: string;

  @Column({ name: "github_branch", type: "varchar", length: 255, nullable: true })
  githubBranch: string | null;

  @Column({ name: "github_pr_number", type: "int", nullable: true })
  githubPrNumber: number | null;

  @Column({ name: "github_pr_url", type: "varchar", length: 500, nullable: true })
  githubPrUrl: string | null;

  // ECS tracking
  @Column({ name: "ecs_task_arn", type: "varchar", length: 500, nullable: true })
  ecsTaskArn: string | null;

  @Column({ name: "ecs_task_id", type: "varchar", length: 100, nullable: true })
  ecsTaskId: string | null;

  // Cost tracking
  @Column({ name: "input_tokens", type: "int", default: 0 })
  inputTokens: number;

  @Column({ name: "output_tokens", type: "int", default: 0 })
  outputTokens: number;

  @Column({ name: "ecs_task_seconds", type: "int", default: 0 })
  ecsTaskSeconds: number;

  @Column({ name: "estimated_cost_usd", type: "decimal", precision: 10, scale: 4, default: 0 })
  estimatedCostUsd: number;

  // Execution metadata
  @Column({ name: "started_at", type: "timestamp", nullable: true })
  startedAt: Date | null;

  @Column({ name: "completed_at", type: "timestamp", nullable: true })
  completedAt: Date | null;

  @Column({ name: "error_message", type: "text", nullable: true })
  errorMessage: string | null;

  @Column({ name: "retry_count", type: "int", default: 0 })
  retryCount: number;

  @Column({ name: "max_retries", type: "int", default: 3 })
  maxRetries: number;

  // Heartbeat for stuck task detection
  @Column({ name: "last_heartbeat_at", type: "timestamp", nullable: true })
  lastHeartbeatAt: Date | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @ManyToOne(() => Organization, (org) => org.tasks, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;

  // Helper methods
  isTerminal(): boolean {
    return ["completed", "review_requested", "pr_merged", "failed", "cancelled"].includes(this.status);
  }

  isActive(): boolean {
    return ["claimed", "environment_setup", "executing"].includes(this.status);
  }

  canRetry(): boolean {
    return this.status === "failed" && this.retryCount < this.maxRetries;
  }

  getDurationSeconds(): number | null {
    if (!this.startedAt) return null;
    const endTime = this.completedAt || new Date();
    return Math.floor((endTime.getTime() - this.startedAt.getTime()) / 1000);
  }
}

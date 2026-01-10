import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from "typeorm";
import { Tenant } from "./Tenant";
import { AIWorkerInstance } from "./AIWorkerInstance";
import { AIWorkerTaskLog } from "./AIWorkerTaskLog";
import { AIWorkerConversation } from "./AIWorkerConversation";
import { AIWorkerApproval } from "./AIWorkerApproval";
import { AIWorkerTaskRun } from "./AIWorkerTaskRun";
import { calculateTotalCost, type TokenUsage } from "../config/pricing";

export type AIWorkerPersona =
  | "frontend_developer"
  | "backend_developer"
  | "devops_engineer"
  | "security_engineer"
  | "qa_engineer"
  | "tech_writer"
  | "project_manager"
  | "manager";

export type AIWorkerTaskStatus =
  | "queued" // Waiting in queue
  | "dispatching" // Watcher spawning ECS task (transient, prevents duplicate spawns)
  | "claimed" // Worker picked up task
  | "environment_setup" // Container starting
  | "executing" // Claude agent running
  | "pr_created" // DEPRECATED - Use review_requested or pr_merged
  | "manager_review" // Virtual Manager reviewing PR
  | "revision_needed" // Manager requested changes, worker picks back up
  | "review_pending" // Waiting for human approval (fallback)
  | "review_requested" // Risky PR created, waiting for human review (TERMINAL)
  | "review_approved" // DEPRECATED - Use pr_approved
  | "pr_approved" // Human approved risky PR, ready to requeue for deployment
  | "pr_merged" // PR deployed and merged successfully (TERMINAL)
  | "review_rejected" // Rejected, needs changes
  | "deployment_pending" // Approved, queued for deployment
  | "deploying" // Deployment in progress
  | "deployed_validating" // Deployed, running validation checks
  | "validation_failed" // Validation checks failed, needs retry
  | "deployment_failed" // Deployment failed, needs retry
  | "awaiting_destructive_approval" // Destructive action detected, needs human approval
  | "completed" // No code changes needed (TERMINAL)
  | "failed" // Error occurred
  | "blocked" // Cannot proceed (missing info, etc.)
  | "cancelled"; // Manually cancelled

@Entity("ai_worker_tasks")
export class AIWorkerTask {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "tenant_id", type: "uuid" })
  tenantId: string;

  // External task reference (Jira, Linear, GitHub Issue, etc.)
  @Column({ name: "external_id", type: "varchar", length: 100 })
  externalId: string;

  @Column({ name: "external_key", type: "varchar", length: 50 })
  externalKey: string; // e.g., "OCS-123" or "PROJ-456"

  @Column({ name: "external_source", type: "varchar", length: 50 })
  externalSource: string; // 'jira', 'linear', 'github', 'api'

  @Column({ name: "external_project_key", type: "varchar", length: 20, nullable: true })
  externalProjectKey: string | null;

  @Column({ name: "external_issue_type", type: "varchar", length: 50, nullable: true })
  externalIssueType: string | null;

  // Task content
  @Column({ type: "varchar", length: 500 })
  summary: string;

  @Column({ type: "text", nullable: true })
  description: string | null;

  @Column({ name: "external_fields", type: "jsonb", default: "{}" })
  externalFields: Record<string, any>; // Full external issue fields

  // Worker assignment
  @Column({ name: "worker_persona", type: "varchar", length: 50 })
  workerPersona: AIWorkerPersona;

  @Column({ name: "assigned_worker_id", type: "uuid", nullable: true })
  assignedWorkerId: string | null;

  // Execution state
  @Column({ type: "varchar", length: 30, default: "queued" })
  status: AIWorkerTaskStatus;

  @Column({ type: "int", default: 3 })
  priority: number; // 1=highest, 5=lowest

  // Git integration
  @Column({ name: "git_repo", type: "varchar", length: 255 })
  gitRepo: string; // e.g., "owner/repo"

  @Column({ name: "git_branch", type: "varchar", length: 255, nullable: true })
  gitBranch: string | null;

  @Column({ name: "git_pr_number", type: "int", nullable: true })
  gitPrNumber: number | null;

  @Column({ name: "git_pr_url", type: "varchar", length: 500, nullable: true })
  gitPrUrl: string | null;

  // Container task tracking
  @Column({ name: "container_task_arn", type: "varchar", length: 500, nullable: true })
  containerTaskArn: string | null;

  @Column({ name: "container_task_id", type: "varchar", length: 100, nullable: true })
  containerTaskId: string | null;

  // Cost tracking
  @Column({ name: "ai_input_tokens", type: "int", default: 0 })
  aiInputTokens: number;

  @Column({ name: "ai_output_tokens", type: "int", default: 0 })
  aiOutputTokens: number;

  @Column({ name: "ai_cache_creation_tokens", type: "int", default: 0 })
  aiCacheCreationTokens: number;

  @Column({ name: "ai_cache_read_tokens", type: "int", default: 0 })
  aiCacheReadTokens: number;

  @Column({ name: "compute_seconds", type: "int", default: 0 })
  computeSeconds: number;

  @Column({
    name: "estimated_cost_usd",
    type: "decimal",
    precision: 10,
    scale: 4,
    default: 0,
  })
  estimatedCostUsd: number;

  @Column({ name: "usage_reported_at", type: "timestamptz", nullable: true })
  usageReportedAt: Date | null;

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

  // Self-recovery fields
  @Column({ name: "last_heartbeat_at", type: "timestamp", nullable: true })
  lastHeartbeatAt: Date | null;

  @Column({ name: "previous_run_context", type: "text", nullable: true })
  previousRunContext: string | null;

  @Column({ name: "global_timeout_at", type: "timestamp", nullable: true })
  globalTimeoutAt: Date | null;

  @Column({ name: "next_retry_at", type: "timestamp", nullable: true })
  nextRetryAt: Date | null;

  @Column({ name: "retry_backoff_seconds", type: "int", default: 60 })
  retryBackoffSeconds: number;

  @Column({ name: "failure_category", type: "varchar", length: 50, nullable: true })
  failureCategory: string | null;

  @Column({ name: "watcher_notes", type: "text", nullable: true })
  watcherNotes: string | null;

  // Review fields
  @Column({ name: "review_requested_at", type: "timestamp", nullable: true })
  reviewRequestedAt: Date | null;

  @Column({ name: "reviewer_manager_id", type: "uuid", nullable: true })
  reviewerManagerId: string | null;

  @Column({ name: "review_feedback", type: "text", nullable: true })
  reviewFeedback: string | null;

  @Column({ name: "review_decision", type: "varchar", length: 50, nullable: true })
  reviewDecision: string | null;

  @Column({ name: "approved_by", type: "varchar", length: 100, nullable: true })
  approvedBy: string | null;

  @Column({ name: "code_quality_score", type: "int", nullable: true })
  codeQualityScore: number | null;

  @Column({ name: "revision_count", type: "int", default: 0 })
  revisionCount: number;

  @Column({ name: "worker_model", type: "varchar", length: 50, default: "claude-3-5-haiku-20241022" })
  workerModel: string;

  @Column({ name: "manager_review_model", type: "varchar", length: 50, nullable: true })
  managerReviewModel: string | null;

  @Column({ name: "manager_container_task_arn", type: "varchar", length: 500, nullable: true })
  managerContainerTaskArn: string | null;

  @Column({ name: "manager_container_task_id", type: "varchar", length: 100, nullable: true })
  managerContainerTaskId: string | null;

  @Column({ name: "skip_manager_review", type: "boolean", default: true })
  skipManagerReview: boolean;

  @Column({ name: "self_anneal_count", type: "int", default: 0 })
  selfAnnealCount: number;

  @Column({ name: "persona_wait_count", type: "int", default: 0 })
  personaWaitCount: number;

  // Deployment fields
  @Column({ name: "deployment_enabled", type: "boolean", default: false })
  deploymentEnabled: boolean;

  @Column({ name: "deploy_retry_count", type: "int", default: 0 })
  deployRetryCount: number;

  @Column({ name: "max_deploy_retries", type: "int", default: 5 })
  maxDeployRetries: number;

  @Column({ name: "validation_attempt_count", type: "int", default: 0 })
  validationAttemptCount: number;

  @Column({ name: "last_validation_error", type: "text", nullable: true })
  lastValidationError: string | null;

  @Column({ name: "last_deployment_at", type: "timestamp", nullable: true })
  lastDeploymentAt: Date | null;

  @Column({ name: "requires_approval", type: "boolean", default: false })
  requiresApproval: boolean;

  @Column({ name: "approval_reason", type: "text", nullable: true })
  approvalReason: string | null;

  // Learning system fields
  @Column({ name: "tool_error_count", type: "int", default: 0 })
  toolErrorCount: number;

  @Column({ name: "tool_retry_count", type: "int", default: 0 })
  toolRetryCount: number;

  @Column({ name: "learning_analyzed", type: "boolean", default: false })
  learningAnalyzed: boolean;

  @Column({ name: "patterns_applied", type: "jsonb", default: [] })
  patternsApplied: string[];

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => Tenant, { onDelete: "CASCADE" })
  @JoinColumn({ name: "tenant_id" })
  tenant: Tenant;

  @ManyToOne(() => AIWorkerInstance, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "assigned_worker_id" })
  assignedWorker: AIWorkerInstance | null;

  @OneToMany(() => AIWorkerTaskLog, (log) => log.task)
  logs: AIWorkerTaskLog[];

  @OneToMany(() => AIWorkerConversation, (conv) => conv.task)
  conversations: AIWorkerConversation[];

  @OneToMany(() => AIWorkerApproval, (approval) => approval.task)
  approvals: AIWorkerApproval[];

  @OneToMany(() => AIWorkerTaskRun, (run) => run.task)
  runs: AIWorkerTaskRun[];

  // Helper methods
  isTerminal(): boolean {
    return [
      "completed",
      "review_requested",
      "pr_merged",
      "failed",
      "cancelled",
      "review_rejected",
      "deployment_failed",
      "validation_failed",
    ].includes(this.status);
  }

  isActive(): boolean {
    return [
      "claimed",
      "environment_setup",
      "executing",
      "revision_needed",
      "deployment_pending",
      "deploying",
      "deployed_validating",
    ].includes(this.status);
  }

  isWaiting(): boolean {
    return [
      "pr_created",
      "review_requested",
      "pr_approved",
      "manager_review",
      "review_pending",
      "review_approved",
      "awaiting_destructive_approval",
    ].includes(this.status);
  }

  freesPersonaSlot(): boolean {
    return this.isTerminal() || this.isWaiting();
  }

  canRetry(): boolean {
    return (this.status === "failed" || this.status === "cancelled") && this.retryCount < this.maxRetries;
  }

  canCancel(): boolean {
    return !this.isTerminal();
  }

  getDurationSeconds(): number | null {
    if (!this.startedAt) return null;
    const endTime = this.completedAt || new Date();
    return Math.floor((endTime.getTime() - this.startedAt.getTime()) / 1000);
  }

  calculateCost(): number {
    const tokens: TokenUsage = {
      inputTokens: this.aiInputTokens,
      outputTokens: this.aiOutputTokens,
      cacheCreationTokens: this.aiCacheCreationTokens,
      cacheReadTokens: this.aiCacheReadTokens,
    };
    return calculateTotalCost(tokens, this.workerModel || "sonnet", this.computeSeconds);
  }

  getTokenUsage(): TokenUsage {
    return {
      inputTokens: this.aiInputTokens,
      outputTokens: this.aiOutputTokens,
      cacheCreationTokens: this.aiCacheCreationTokens,
      cacheReadTokens: this.aiCacheReadTokens,
    };
  }

  isStuck(): boolean {
    if (!this.isActive() || !this.lastHeartbeatAt) return false;
    const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);
    return this.lastHeartbeatAt < threeMinutesAgo;
  }

  isGloballyTimedOut(): boolean {
    if (!this.globalTimeoutAt) return false;
    return new Date() > this.globalTimeoutAt;
  }

  isReadyForRetry(): boolean {
    if (!this.nextRetryAt) return false;
    return new Date() >= this.nextRetryAt && this.canRetry();
  }

  getNextBackoffSeconds(): number {
    const nextBackoff = this.retryBackoffSeconds * 2;
    return Math.min(nextBackoff, 3600);
  }

  scheduleRetry(): { nextRetryAt: Date; backoffSeconds: number } {
    const backoffSeconds = this.getNextBackoffSeconds();
    const nextRetryAt = new Date(Date.now() + backoffSeconds * 1000);
    return { nextRetryAt, backoffSeconds };
  }
}

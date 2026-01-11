import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from "typeorm";
import { Organization } from "./Organization.js";
import type { WorkerTaskLog } from "./WorkerTaskLog.js";
import {
  calculateTotalCost,
  type TokenUsage,
} from "../config/pricing.js";

export type WorkerPersona =
  | "frontend_developer"
  | "backend_developer"
  | "devops_engineer"
  | "security_engineer"
  | "qa_engineer"
  | "tech_writer"
  | "project_manager";

export type WorkerTaskStatus =
  // Active execution states (agent is running)
  | "queued"           // Waiting to be picked up
  | "dispatching"      // Orchestrator spawning ECS task
  | "claimed"          // Worker claimed task from queue
  | "environment_setup" // Fargate container starting
  | "executing"        // Claude agent actively running
  | "deploying"        // Agent is deploying changes

  // Waiting states (agent stopped, waiting for external action)
  | "pr_created"       // PR created, waiting for next step based on workflow
  | "review_requested" // Default workflow: PR created, waiting for human approval
  | "manager_review"   // Review workflow: Virtual Manager is reviewing the PR
  | "revision_needed"  // Review workflow: Manager requested changes, agent will restart
  | "pr_approved"      // Default workflow: PR approved by human, will be re-queued for deployment
  | "review_approved"  // Review workflow: Manager approved, will be re-queued for deployment

  // Terminal states (nothing more will happen)
  | "completed"        // No code changes needed, task done
  | "deployed"         // Deploy workflow finished: deployed + PR merged
  | "failed"           // Error occurred
  | "cancelled"        // Manually cancelled
  | "review_rejected"; // Review workflow: Max revisions reached, manager rejected

// Workflow modes based on Jira labels
export type WorkflowMode = "default" | "review" | "auto_deploy" | "manager" | "review_manager" | "deploy_manager";

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

  @Column({ name: "github_approved_by", type: "varchar", length: 100, nullable: true })
  githubApprovedBy: string | null;

  // Workflow flags (set from Jira labels)
  @Column({ name: "deployment_enabled", type: "boolean", default: false })
  deploymentEnabled: boolean;  // True if ticket has 'deploy' label

  @Column({ name: "skip_manager_review", type: "boolean", default: true })
  skipManagerReview: boolean;  // True if ticket does NOT have 'review' label

  @Column({ name: "manager_enabled", type: "boolean", default: false })
  managerEnabled: boolean;  // True if ticket has 'manager' label (environment fixes)

  // Review workflow tracking
  @Column({ name: "revision_count", type: "int", default: 0 })
  revisionCount: number;  // Number of revision attempts (max 3)

  @Column({ name: "review_feedback", type: "text", nullable: true })
  reviewFeedback: string | null;  // Manager's feedback for revisions

  // Task notes for deployment runs
  @Column({ name: "task_notes", type: "text", nullable: true })
  taskNotes: string | null;  // Passed to agent, e.g., "DEPLOYMENT_RUN: PR #123 approved"

  // ECS tracking
  @Column({ name: "ecs_task_arn", type: "varchar", length: 500, nullable: true })
  ecsTaskArn: string | null;

  @Column({ name: "ecs_task_id", type: "varchar", length: 100, nullable: true })
  ecsTaskId: string | null;

  // Manager ECS tracking (for review workflow)
  @Column({ name: "manager_ecs_task_arn", type: "varchar", length: 500, nullable: true })
  managerEcsTaskArn: string | null;

  @Column({ name: "manager_ecs_task_id", type: "varchar", length: 100, nullable: true })
  managerEcsTaskId: string | null;

  // Manager log analysis tracking (for manager workflow "training wheels")
  @Column({ name: "manager_analysis_done", type: "boolean", default: false })
  managerAnalysisDone: boolean;

  // Cost tracking
  @Column({ name: "input_tokens", type: "int", default: 0 })
  inputTokens: number;

  @Column({ name: "output_tokens", type: "int", default: 0 })
  outputTokens: number;

  @Column({ name: "cache_creation_tokens", type: "int", default: 0 })
  cacheCreationTokens: number;

  @Column({ name: "cache_read_tokens", type: "int", default: 0 })
  cacheReadTokens: number;

  @Column({ name: "ecs_task_seconds", type: "int", default: 0 })
  ecsTaskSeconds: number;

  @Column({ name: "estimated_cost_usd", type: "decimal", precision: 10, scale: 4, default: 0 })
  estimatedCostUsd: number;

  @Column({ name: "usage_reported_at", type: "timestamp", nullable: true })
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

  // Logs relation - lazy import to avoid circular dependency
  @OneToMany("WorkerTaskLog", "task")
  logs: WorkerTaskLog[];

  // Helper methods
  isTerminal(): boolean {
    // True terminal states - nothing more will happen
    return ["completed", "deployed", "failed", "cancelled"].includes(this.status);
  }

  isActive(): boolean {
    // Agent is currently running
    return ["claimed", "environment_setup", "executing", "deploying"].includes(this.status);
  }

  isWaiting(): boolean {
    // Agent stopped, waiting for external action (human/Manager approval)
    return ["review_requested", "manager_review", "pr_approved"].includes(this.status);
  }

  freesPersonaSlot(): boolean {
    // Persona slot is freed when task is terminal OR waiting for external action
    return this.isTerminal() || this.isWaiting();
  }

  canRetry(): boolean {
    return this.status === "failed" && this.retryCount < this.maxRetries;
  }

  needsDeploymentRun(): boolean {
    // Task is approved and has a PR - ready to be re-queued for deployment
    return this.status === "pr_approved" && this.githubPrUrl !== null;
  }

  hasDeployLabel(): boolean {
    return this.deploymentEnabled === true;
  }

  hasReviewLabel(): boolean {
    return this.skipManagerReview === false;
  }

  hasManagerLabel(): boolean {
    return this.managerEnabled === true;
  }

  /**
   * Get the workflow mode based on Jira labels
   * Priority: deploy > review > manager > default
   */
  getWorkflowMode(): WorkflowMode {
    const hasReview = this.hasReviewLabel();
    const hasDeploy = this.hasDeployLabel();
    const hasManager = this.hasManagerLabel();

    if (hasDeploy && hasManager) return "deploy_manager";
    if (hasReview && hasManager) return "review_manager";
    if (hasDeploy) return "auto_deploy";
    if (hasReview) return "review";
    if (hasManager) return "manager";
    return "default";
  }

  /**
   * Get human-readable workflow mode name
   */
  getWorkflowModeName(): string {
    const mode = this.getWorkflowMode();
    const names: Record<WorkflowMode, string> = {
      default: "Default",
      review: "Review",
      auto_deploy: "Auto-Deploy",
      manager: "Manager",
      review_manager: "Review + Manager",
      deploy_manager: "Auto-Deploy + Manager",
    };
    return names[mode];
  }

  /**
   * Check if task can accept more revisions (max 3)
   */
  canRevise(): boolean {
    return this.revisionCount < 3;
  }

  getDurationSeconds(): number | null {
    if (!this.startedAt) return null;
    const endTime = this.completedAt || new Date();
    return Math.floor((endTime.getTime() - this.startedAt.getTime()) / 1000);
  }

  /**
   * Calculate the cost of this task using Claude API pricing + ECS compute
   */
  calculateCost(): number {
    const tokens: TokenUsage = {
      inputTokens: this.inputTokens || 0,
      outputTokens: this.outputTokens || 0,
      cacheCreationTokens: this.cacheCreationTokens || 0,
      cacheReadTokens: this.cacheReadTokens || 0,
    };
    const durationSeconds = this.ecsTaskSeconds || this.getDurationSeconds() || 0;
    return calculateTotalCost(tokens, this.workerModel || "sonnet", durationSeconds);
  }
}

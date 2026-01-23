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
  getPricingEngine,
  type TokenUsage,
} from "../providers/index.js";
import type {
  ExecutionPlanV2,
  StepCommit,
} from "../services/pipeline-v2-types.js";

export type WorkerPersona =
  | "frontend_developer"
  | "backend_developer"
  | "devops_engineer"
  | "security_engineer"
  | "qa_engineer"
  | "tech_writer"
  | "project_manager";

export type WorkerTaskStatus =
  // Planning states (PRD analysis)
  | "planning"              // Planning agent analyzing PRD
  | "pending_plan_approval" // Plan created, waiting for human approval

  // Active execution states (agent is running)
  | "queued"           // Waiting to be picked up
  | "dispatching"      // Orchestrator spawning ECS task
  | "claimed"          // Worker claimed task from queue
  | "environment_setup" // Fargate container starting
  | "executing"        // Claude agent actively running
  | "deploying"        // Agent is deploying changes

  // Waiting states (agent stopped, waiting for external action)
  | "blocked"          // Story waiting for dependencies to complete
  | "pr_created"       // PR created, waiting for next step based on workflow
  | "review_requested" // Default workflow: PR created, waiting for human approval
  | "manager_review"   // Review workflow: Virtual Manager is reviewing the PR
  | "revision_needed"  // Review workflow: Manager requested changes, agent will restart
  | "pr_approved"      // Default workflow: PR approved by human, will be re-queued for deployment
  | "review_approved"  // Review workflow: Manager approved, will be re-queued for deployment
  | "escalated"        // Agent needs clarification - unclear requirements or blocked

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

  // Jira reference (nullable for internal tasks)
  @Column({ name: "jira_issue_key", type: "varchar", length: 50, nullable: true })
  jiraIssueKey: string | null;

  @Column({ name: "jira_issue_id", type: "varchar", length: 50, nullable: true })
  jiraIssueId: string | null;

  // Internal task reference (for tasks from Kanban board)
  @Column({ name: "internal_task_id", type: "uuid", nullable: true })
  internalTaskId: string | null;

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

  @Column({ name: "worker_provider", type: "varchar", length: 50, default: "anthropic" })
  workerProvider: string;

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
  taskNotes: string | null;  // Passed to agent, e.g., "DEPLOYMENT_RUN: PR ***REMOVED***123 approved"

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

  @Column({ name: "partial_tokens_updated_at", type: "timestamp", nullable: true })
  partialTokensUpdatedAt: Date | null;

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

  // PRD Orchestration - Parent-Child relationships
  @Column({ name: "parent_task_id", type: "uuid", nullable: true })
  parentTaskId: string | null;

  @Column({ name: "story_index", type: "int", nullable: true })
  storyIndex: number | null;

  @Column({ name: "story_title", type: "varchar", length: 500, nullable: true })
  storyTitle: string | null;

  @Column({ name: "child_task_ids", type: "uuid", array: true, nullable: true })
  childTaskIds: string[] | null;

  @Column({ name: "story_dependencies", type: "int", array: true, nullable: true })
  storyDependencies: number[] | null;

  // PRD Orchestration - Plan approval workflow
  @Column({ name: "plan_json", type: "jsonb", nullable: true })
  planJson: Record<string, unknown> | null;

  @Column({ name: "plan_status", type: "varchar", length: 30, nullable: true })
  planStatus: "pending_approval" | "approved" | "changes_requested" | null;

  @Column({ name: "plan_feedback", type: "text", nullable: true })
  planFeedback: string | null;

  @Column({ name: "plan_approved_at", type: "timestamp", nullable: true })
  planApprovedAt: Date | null;

  @Column({ name: "plan_approved_by", type: "uuid", nullable: true })
  planApprovedBy: string | null;

  @Column({ name: "planning_notes", type: "text", nullable: true })
  planningNotes: string | null;

  // =========================================================================
  // Pipeline V2 - Vertical Slice Sequential Execution
  // =========================================================================

  /**
   * Pipeline version: v1 (theme-based parallel) or v2 (vertical slice sequential)
   * Set via `prd-v2` Jira label for opt-in
   */
  @Column({ name: "pipeline_version", type: "varchar", length: 10, nullable: true })
  pipelineVersion: "v1" | "v2" | null;

  /**
   * V2 execution plan with ordered atomic steps
   */
  @Column({ name: "execution_plan_v2", type: "jsonb", nullable: true })
  executionPlanV2: ExecutionPlanV2 | null;

  /**
   * Current step index being executed (0-based)
   */
  @Column({ name: "current_step_index", type: "int", default: 0 })
  currentStepIndex: number;

  /**
   * Context sidecar - learned constraints outside of git
   * Persists across rewinds, accumulated from failures
   */
  @Column({ name: "context_sidecar", type: "jsonb", default: [] })
  contextSidecar: string[];

  /**
   * Commit history - records successful step commits for rewind support
   */
  @Column({ name: "commit_history", type: "jsonb", default: [] })
  commitHistory: StepCommit[];

  /**
   * Retry count for current step (resets when moving to next step)
   */
  @Column({ name: "current_step_retry_count", type: "int", default: 0 })
  currentStepRetryCount: number;

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

  // InternalTask relation - lazy import to avoid circular dependency
  @ManyToOne("InternalTask", { onDelete: "SET NULL" })
  @JoinColumn({ name: "internal_task_id" })
  internalTask: unknown; // Using unknown to avoid circular import

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
    // Agent stopped, waiting for external action (human/Manager approval, or clarification)
    return ["review_requested", "manager_review", "pr_approved", "escalated"].includes(this.status);
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

  // PRD Orchestration helpers

  /**
   * True if this task has child tasks (is a parent PRD task)
   */
  isParentTask(): boolean {
    return this.childTaskIds !== null && this.childTaskIds.length > 0;
  }

  /**
   * True if this task is a child story of a parent PRD
   */
  isChildTask(): boolean {
    return this.parentTaskId !== null;
  }

  /**
   * True if this task has an approved execution plan
   */
  hasApprovedPlan(): boolean {
    return this.planStatus === "approved" && this.planJson !== null;
  }

  /**
   * True if this task is waiting for plan approval
   */
  needsPlanApproval(): boolean {
    return this.planStatus === "pending_approval";
  }

  /**
   * True if this task is blocked waiting for dependencies
   */
  isBlocked(): boolean {
    return this.status === "blocked";
  }

  /**
   * Check if all dependencies for this story are satisfied
   * (requires loading sibling tasks)
   */
  getDependencyStoryIndices(): number[] {
    return this.storyDependencies || [];
  }

  /**
   * Calculate the cost of this task using provider-specific pricing + ECS compute
   */
  calculateCost(): number {
    const engine = getPricingEngine(this.workerProvider || "anthropic");
    const tokens: TokenUsage = {
      inputTokens: this.inputTokens || 0,
      outputTokens: this.outputTokens || 0,
      cacheCreationTokens: this.cacheCreationTokens || 0,
      cacheReadTokens: this.cacheReadTokens || 0,
    };
    const durationSeconds = this.ecsTaskSeconds || this.getDurationSeconds() || 0;
    return engine.calculateTotalCost(tokens, this.workerModel || "sonnet", durationSeconds);
  }

  /**
   * True if this task was created from an internal Kanban board task
   */
  isInternalTask(): boolean {
    return this.internalTaskId !== null;
  }

  /**
   * True if this task was created from an external source (Jira, Linear, etc.)
   */
  isExternalTask(): boolean {
    return this.jiraIssueKey !== null || this.jiraIssueId !== null;
  }

  /**
   * Get display identifier for the task (task key or internal ID)
   */
  getDisplayKey(): string {
    return this.jiraIssueKey || this.internalTaskId?.slice(0, 8) || this.id.slice(0, 8);
  }

  // =========================================================================
  // Pipeline V2 Helper Methods
  // =========================================================================

  /**
   * True if this task uses V2 vertical slice pipeline
   */
  isV2Pipeline(): boolean {
    return this.pipelineVersion === "v2";
  }

  /**
   * True if this task uses V1 theme-based pipeline
   */
  isV1Pipeline(): boolean {
    return this.pipelineVersion === "v1" || this.pipelineVersion === null;
  }

  /**
   * Get total number of steps in V2 execution plan
   */
  getV2TotalSteps(): number {
    return this.executionPlanV2?.steps?.length ?? 0;
  }

  /**
   * Get current step from V2 execution plan
   */
  getV2CurrentStep() {
    return this.executionPlanV2?.steps?.[this.currentStepIndex] ?? null;
  }

  /**
   * Calculate V2 pipeline progress percentage (0-100)
   */
  getV2Progress(): number {
    const total = this.getV2TotalSteps();
    if (total === 0) return 0;
    return Math.round((this.currentStepIndex / total) * 100);
  }

  /**
   * True if V2 pipeline has completed all steps
   */
  isV2Complete(): boolean {
    if (!this.isV2Pipeline()) return false;
    const total = this.getV2TotalSteps();
    return total > 0 && this.currentStepIndex >= total;
  }

  /**
   * True if current step has exceeded max retries
   */
  hasExceededStepRetries(): boolean {
    return this.currentStepRetryCount >= 3;
  }

  /**
   * Get commit hash for a specific step index from history
   */
  getCommitForStep(stepIndex: number): string | undefined {
    return this.commitHistory?.find(c => c.stepIndex === stepIndex)?.commitHash;
  }

  /**
   * Add a learned constraint to the context sidecar
   */
  addConstraint(constraint: string): void {
    if (!this.contextSidecar) {
      this.contextSidecar = [];
    }
    if (!this.contextSidecar.includes(constraint)) {
      this.contextSidecar.push(constraint);
    }
  }
}

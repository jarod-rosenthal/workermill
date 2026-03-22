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
import type { DirectiveUsage } from "./PersonaDirective.js";

// Multi-Persona Single Container Types
export interface SubtaskDefinition {
  index: number;
  title: string;
  description: string;
  persona: WorkerPersona;
  targetFiles?: string[];
  referenceFiles?: string[];
  timeoutMinutes?: number;
}

export interface SubtaskResult {
  index: number;
  status: "completed" | "failed" | "skipped";
  commitHash?: string;
  error?: string;
  startedAt: string;
  completedAt: string;
  persona: WorkerPersona;
}

// System personas (built-in). Custom org personas can also be used.
export type SystemPersona =
  | "architect"
  | "frontend_developer"
  | "backend_developer"
  | "devops_engineer"
  | "security_engineer"
  | "qa_engineer"
  | "tech_writer"
  | "project_manager"
  | "tech_lead"
  | "data_ml_engineer"
  | "mobile_developer";

// WorkerPersona is now a string to support custom org-specific personas
// Use SystemPersona type when you need to reference built-in personas specifically
export type WorkerPersona = string;

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
  | "consolidating"       // Stories done, creating PR
  | "integration_check"  // Running quality gates on consolidated branch
  | "deploying"          // Agent is deploying changes

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

  // Billing org ID - for platform tasks, credentials and costs are billed here
  // while orgId remains the customer org for ticket context/association
  @Column({ name: "billing_org_id", type: "uuid", nullable: true })
  billingOrgId: string | null;

  // Flag indicating this is a platform-initiated task (e.g., support agent)
  @Column({ name: "is_platform_task", type: "boolean", default: false })
  isPlatformTask: boolean;

  // Jira reference (nullable for internal tasks)
  @Column({ name: "jira_issue_key", type: "varchar", length: 50, nullable: true })
  jiraIssueKey: string | null;

  @Column({ name: "jira_issue_id", type: "varchar", length: 50, nullable: true })
  jiraIssueId: string | null;

  // Which ticket system created this task (jira, linear, github, internal, or null)
  @Column({ name: "ticket_system", type: "varchar", length: 20, nullable: true })
  ticketSystem: "jira" | "linear" | "github" | "internal" | null;

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

  @Column({ name: "worker_model", type: "varchar", length: 50, default: "claude-opus-4-6" })
  workerModel: string;

  @Column({ name: "worker_provider", type: "varchar", length: 50, default: "anthropic" })
  workerProvider: string;

  // For multi-provider mode: list of all providers used across stories
  @Column({ name: "providers_used", type: "simple-json", nullable: true })
  providersUsed: string[] | null;

  // Execution state
  @Column({ type: "varchar", length: 30, default: "queued" })
  status: WorkerTaskStatus;

  @Column({ type: "int", default: 3 })
  priority: number;

  // SCM integration
  @Column({ name: "scm_provider", type: "varchar", length: 20, default: "github" })
  scmProvider: "github" | "gitlab" | "bitbucket";

  // GitHub integration (kept for backwards compatibility, used regardless of scmProvider)
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

  @Column({ name: "improvement_enabled", type: "boolean", default: false })
  improvementEnabled: boolean;  // True if 'improve' label present or org setting enabled

  @Column({ name: "quality_gate_bypass", type: "boolean", default: false })
  qualityGateBypass: boolean;  // True if 'bypass-quality-gate' label present

  @Column({ name: "standard_sdk_mode", type: "boolean", default: false })
  standardSdkMode: boolean;  // True if 'sdk' label present - uses SDK-based executor instead of CLI

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

  // Manager provider tracking (which AI provider performed the review)
  @Column({ name: "manager_provider", type: "varchar", length: 50, nullable: true })
  managerProvider: string | null;

  @Column({ name: "manager_model", type: "varchar", length: 100, nullable: true })
  managerModel: string | null;

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

  // Planning phase tokens (uses Sonnet, billed separately from worker tokens)
  @Column({ name: "planning_input_tokens", type: "int", default: 0 })
  planningInputTokens: number;

  @Column({ name: "planning_output_tokens", type: "int", default: 0 })
  planningOutputTokens: number;

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

  @Column({ name: "board_execution_id", type: "varchar", length: 36, nullable: true })
  boardExecutionId: string | null;

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
   * Execution mode: how the task's pipeline runs
   * - single: Default single-task execution
   * - sequential: V2 pipeline (one persona at a time)
   * - parallel: Epic mode (all experts simultaneously, Anthropic only)
   * - multi-expert: Multi-expert mode with AI SDK (multi-provider support)
   */
  @Column({ name: "execution_mode", type: "varchar", length: 20, default: "single" })
  executionMode: "single" | "sequential" | "parallel" | "multi-expert";

  /**
   * Whether Planner-Critic validation is enabled.
   * Set via "critic" Jira label. When false, skips the critic validation loop.
   */
  @Column({ name: "critic_enabled", type: "boolean", default: false })
  criticEnabled: boolean;

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

  // =========================================================================
  // Effectiveness Tracking
  // =========================================================================

  /**
   * Human review outcome for this task
   * - accepted: Work was fully accepted as-is
   * - rejected: Work was rejected/not usable
   * - partial: Some parts accepted, others needed changes
   */
  @Column({ name: "review_outcome", type: "varchar", length: 20, nullable: true })
  reviewOutcome: "accepted" | "rejected" | "partial" | null;

  /**
   * Accuracy score from 0-100 assigned by human reviewer
   * Higher = more accurate to requirements
   */
  @Column({ name: "accuracy_score", type: "int", nullable: true })
  accuracyScore: number | null;

  /**
   * Free-text notes from the reviewer
   */
  @Column({ name: "review_notes", type: "text", nullable: true })
  reviewNotes: string | null;

  /**
   * When the review was submitted
   */
  @Column({ name: "reviewed_at", type: "timestamp", nullable: true })
  reviewedAt: Date | null;

  /**
   * Who reviewed the task (email or user identifier)
   */
  @Column({ name: "reviewed_by", type: "varchar", length: 255, nullable: true })
  reviewedBy: string | null;

  /**
   * Number of lines changed by this task (insertions + deletions)
   */
  @Column({ name: "lines_changed", type: "int", nullable: true })
  linesChanged: number | null;

  /**
   * Number of files modified by this task
   */
  @Column({ name: "files_modified", type: "int", nullable: true })
  filesModified: number | null;

  // =========================================================================
  // Code Quality Metrics
  // =========================================================================

  /**
   * Composite quality score (0-100 scale, weighted average)
   * Weights: typecheck 25%, lint 20%, tests 30%, coverage 15%, security 10%
   */
  @Column({ name: "quality_score", type: "int", nullable: true })
  qualityScore: number | null;

  /**
   * Lint score (0-100, based on error rate relative to lines of code)
   * Formula: 100 - (errors / lines * 100)
   */
  @Column({ name: "lint_score", type: "int", nullable: true })
  lintScore: number | null;

  /**
   * Typecheck score (100 if pass, 0 if fail)
   */
  @Column({ name: "typecheck_score", type: "int", nullable: true })
  typecheckScore: number | null;

  /**
   * Test score (0-100, based on pass rate)
   * Formula: (passed / total) * 100
   */
  @Column({ name: "test_score", type: "int", nullable: true })
  testScore: number | null;

  /**
   * Coverage score (0-100, line coverage percentage)
   */
  @Column({ name: "coverage_score", type: "int", nullable: true })
  coverageScore: number | null;

  /**
   * Security score (0-100, based on vulnerability count and severity)
   * Formula: 100 - (high * 20 + medium * 5 + low)
   */
  @Column({ name: "security_score", type: "int", nullable: true })
  securityScore: number | null;

  // Raw lint counts
  @Column({ name: "lint_errors", type: "int", nullable: true })
  lintErrors: number | null;

  @Column({ name: "lint_warnings", type: "int", nullable: true })
  lintWarnings: number | null;

  // Raw typecheck count
  @Column({ name: "type_errors", type: "int", nullable: true })
  typeErrors: number | null;

  // Raw test counts
  @Column({ name: "tests_passed", type: "int", nullable: true })
  testsPassed: number | null;

  @Column({ name: "tests_failed", type: "int", nullable: true })
  testsFailed: number | null;

  @Column({ name: "tests_skipped", type: "int", nullable: true })
  testsSkipped: number | null;

  // Coverage percentages
  @Column({ name: "coverage_lines", type: "decimal", precision: 5, scale: 2, nullable: true })
  coverageLines: number | null;

  @Column({ name: "coverage_branches", type: "decimal", precision: 5, scale: 2, nullable: true })
  coverageBranches: number | null;

  // Security vulnerability counts by severity
  @Column({ name: "security_high", type: "int", nullable: true })
  securityHigh: number | null;

  @Column({ name: "security_medium", type: "int", nullable: true })
  securityMedium: number | null;

  @Column({ name: "security_low", type: "int", nullable: true })
  securityLow: number | null;

  /**
   * Full quality analysis output for drill-down
   * Contains raw tool outputs, file-level details, etc.
   */
  @Column({ name: "quality_analysis_json", type: "jsonb", nullable: true })
  qualityAnalysisJson: Record<string, unknown> | null;

  /**
   * External SonarQube dashboard URL for this task's analysis
   */
  @Column({ name: "sonarqube_url", type: "text", nullable: true })
  sonarqubeUrl: string | null;

  // =========================================================================
  // Multi-Persona Single Container Execution
  // =========================================================================

  /**
   * JSON array of subtask definitions for multi-persona execution.
   * Each subtask has its own persona and is executed sequentially in the same container.
   */
  @Column({ name: "subtasks_json", type: "jsonb", nullable: true })
  subtasksJson: SubtaskDefinition[] | null;

  /**
   * Current subtask index being executed (0-based).
   * Updated by the worker as it progresses through subtasks.
   */
  @Column({ name: "current_subtask_index", type: "int", default: 0 })
  currentSubtaskIndex: number;

  /**
   * Results from each completed subtask.
   * Includes status, commit hash, timing info.
   */
  @Column({ name: "subtask_results", type: "jsonb", nullable: true })
  subtaskResults: SubtaskResult[] | null;

  // =========================================================================
  // Directive Effectiveness Tracking
  // =========================================================================

  /**
   * Array of directives used for this task execution.
   * Tracks which specific directive versions were loaded by the worker.
   * Structure: [{directiveId, version, type, filename?, personaSlug}]
   */
  @Column({ name: "directives_used", type: "jsonb", default: [] })
  directivesUsed: DirectiveUsage[];

  // =========================================================================
  // Remote Agent Fields
  // =========================================================================

  /**
   * Remote agent ID that claimed this task (NULL = cloud orchestrator handles it)
   */
  @Column({ name: "claimed_by_agent", type: "varchar", length: 100, nullable: true })
  claimedByAgent: string | null;

  /**
   * Last heartbeat from the remote agent for stuck task detection
   */
  @Column({ name: "agent_heartbeat_at", type: "timestamp", nullable: true })
  agentHeartbeatAt: Date | null;

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

  // =========================================================================
  // Helper Methods
  // =========================================================================

  /**
   * Get the org ID to use for fetching credentials (API keys, tokens, etc.)
   * For platform tasks, use billingOrgId (platform org has the credentials).
   * For regular tasks, use orgId (customer org).
   */
  getCredentialsOrgId(): string {
    return this.billingOrgId || this.orgId;
  }

  /**
   * Get the org ID to use for billing/cost attribution.
   * For platform tasks, costs are billed to the platform org.
   * For regular tasks, costs are billed to the customer org.
   */
  getBillingOrgId(): string {
    return this.billingOrgId || this.orgId;
  }

  /**
   * Get the org ID for ticket context (which customer's ticket this is).
   * Always returns orgId, even for platform tasks.
   */
  getContextOrgId(): string {
    return this.orgId;
  }

  isTerminal(): boolean {
    // True terminal states - nothing more will happen
    return ["completed", "deployed", "failed", "cancelled", "review_rejected"].includes(this.status);
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
    // Check for Epic workflows first (based on executionMode)
    if (this.executionMode === "parallel") {
      return "Epic";
    }
    if (this.executionMode === "multi-expert") {
      return "Multi-Expert";
    }

    const mode = this.getWorkflowMode();
    const names: Record<WorkflowMode, string> = {
      default: "Standard",
      review: "Review",
      auto_deploy: "Auto-Deploy",
      manager: "Manager",
      review_manager: "Review + Manager",
      deploy_manager: "Auto-Deploy + Manager",
    };
    return names[mode];
  }

  /**
   * Check if task can accept more revisions.
   * @param maxRevisions - Maximum allowed revisions (from org settings, default 3)
   */
  canRevise(maxRevisions: number = 3): boolean {
    return this.revisionCount < maxRevisions;
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
   * Includes:
   * - Worker execution tokens (model depends on workerModel)
   * - Planning phase tokens (always Sonnet 4.5)
   * - ECS compute time
   */
  calculateCost(): number {
    const engine = getPricingEngine(this.workerProvider || "anthropic");

    // Worker execution tokens
    const workerTokens: TokenUsage = {
      inputTokens: this.inputTokens || 0,
      outputTokens: this.outputTokens || 0,
      cacheCreationTokens: this.cacheCreationTokens || 0,
      cacheReadTokens: this.cacheReadTokens || 0,
    };
    const durationSeconds = this.ecsTaskSeconds || this.getDurationSeconds() || 0;
    const workerCost = engine.calculateTotalCost(workerTokens, this.workerModel || "sonnet", durationSeconds);

    // Planning phase tokens (always uses Sonnet 4.5, always Anthropic)
    let planningCost = 0;
    if (this.planningInputTokens > 0 || this.planningOutputTokens > 0) {
      const anthropicEngine = getPricingEngine("anthropic");
      const planningTokens: TokenUsage = {
        inputTokens: this.planningInputTokens || 0,
        outputTokens: this.planningOutputTokens || 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      };
      // Planning uses Sonnet 4.5 - no ECS cost (runs in API container)
      planningCost = anthropicEngine.calculateTokenCost(planningTokens, "claude-sonnet-4-5-20250929");
    }

    return workerCost + planningCost;
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

  // =========================================================================
  // Multi-Persona Single Container Helper Methods
  // =========================================================================

  /**
   * True if this task uses multi-persona single container execution.
   * Detected by presence of subtasksJson array.
   */
  isMultiPersonaTask(): boolean {
    return this.subtasksJson !== null && this.subtasksJson.length > 0;
  }

  /**
   * Get total number of subtasks in multi-persona execution
   */
  getSubtaskCount(): number {
    return this.subtasksJson?.length ?? 0;
  }

  /**
   * Get current subtask from subtasksJson
   */
  getCurrentSubtask(): SubtaskDefinition | null {
    return this.subtasksJson?.[this.currentSubtaskIndex] ?? null;
  }

  /**
   * Calculate multi-persona progress percentage (0-100)
   */
  getMultiPersonaProgress(): number {
    const total = this.getSubtaskCount();
    if (total === 0) return 0;
    return Math.round((this.currentSubtaskIndex / total) * 100);
  }

  /**
   * True if all subtasks have been completed
   */
  isMultiPersonaComplete(): boolean {
    if (!this.isMultiPersonaTask()) return false;
    const total = this.getSubtaskCount();
    return total > 0 && this.currentSubtaskIndex >= total;
  }

  /**
   * Get the result for a specific subtask
   */
  getSubtaskResult(index: number): SubtaskResult | undefined {
    return this.subtaskResults?.find(r => r.index === index);
  }

  /**
   * Add a subtask result
   */
  addSubtaskResult(result: SubtaskResult): void {
    if (!this.subtaskResults) {
      this.subtaskResults = [];
    }
    // Update existing or add new
    const existingIndex = this.subtaskResults.findIndex(r => r.index === result.index);
    if (existingIndex >= 0) {
      this.subtaskResults[existingIndex] = result;
    } else {
      this.subtaskResults.push(result);
    }
  }

  // =========================================================================
  // Code Quality Metrics Helper Methods
  // =========================================================================

  /**
   * True if this task has quality metrics recorded
   */
  hasQualityMetrics(): boolean {
    return this.qualityScore !== null;
  }

  /**
   * Get quality grade based on score (A-F scale)
   */
  getQualityGrade(): string | null {
    if (this.qualityScore === null) return null;
    if (this.qualityScore >= 90) return "A";
    if (this.qualityScore >= 80) return "B";
    if (this.qualityScore >= 70) return "C";
    if (this.qualityScore >= 60) return "D";
    return "F";
  }

  /**
   * Get quality category for distribution analysis
   */
  getQualityCategory(): "excellent" | "good" | "fair" | "poor" | null {
    if (this.qualityScore === null) return null;
    if (this.qualityScore >= 90) return "excellent";
    if (this.qualityScore >= 70) return "good";
    if (this.qualityScore >= 50) return "fair";
    return "poor";
  }

  /**
   * Get total test count
   */
  getTotalTests(): number {
    return (this.testsPassed ?? 0) + (this.testsFailed ?? 0) + (this.testsSkipped ?? 0);
  }

  /**
   * Get total security vulnerabilities count
   */
  getTotalVulnerabilities(): number {
    return (this.securityHigh ?? 0) + (this.securityMedium ?? 0) + (this.securityLow ?? 0);
  }

  /**
   * Check if task has critical security issues (high severity vulnerabilities)
   */
  hasCriticalSecurityIssues(): boolean {
    return (this.securityHigh ?? 0) > 0;
  }
}

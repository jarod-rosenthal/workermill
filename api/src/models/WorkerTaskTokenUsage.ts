import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { WorkerTask } from "./WorkerTask.js";
import { getPricingEngine, type TokenUsage } from "../providers/index.js";

/**
 * Execution phases for token tracking.
 * - planning: PRD analysis and story decomposition (uses Sonnet)
 * - execution: Story implementation by experts
 * - review: Tech Lead code review
 * - deployment: DevOps merge and deploy
 * - improvement: Self-improvement analysis (optional)
 */
export type TokenUsagePhase =
  | "planning"
  | "execution"
  | "review"
  | "deployment"
  | "improvement";

/**
 * Operation types for granular token tracking within phases.
 * - code_generation: Writing new code
 * - analysis: Reviewing/analyzing existing code
 * - testing: Writing or running tests
 * - file_operations: File reads, writes, searches
 * - bash_commands: Running shell commands
 * - git_operations: Git commits, branches, PR operations
 * - api_calls: External API interactions (Jira, GitHub, etc.)
 * - other: Miscellaneous operations
 */
export type TokenUsageOperationType =
  | "code_generation"
  | "analysis"
  | "testing"
  | "file_operations"
  | "bash_commands"
  | "git_operations"
  | "api_calls"
  | "other";

/**
 * Tracks token usage per phase of task execution.
 * Enables FinOps analytics by phase, persona, model, and provider.
 */
@Entity("worker_task_token_usage")
@Index(["taskId", "phase"])
export class WorkerTaskTokenUsage {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "task_id", type: "uuid" })
  taskId: string;

  /**
   * Execution phase: planning, execution, review, deployment, improvement
   */
  @Column({ type: "varchar", length: 50 })
  phase: TokenUsagePhase;

  /**
   * Input tokens for this phase
   */
  @Column({ name: "input_tokens", type: "int", default: 0 })
  inputTokens: number;

  /**
   * Output tokens for this phase
   */
  @Column({ name: "output_tokens", type: "int", default: 0 })
  outputTokens: number;

  /**
   * Cache creation tokens for this phase
   */
  @Column({ name: "cache_creation_tokens", type: "int", default: 0 })
  cacheCreationTokens: number;

  /**
   * Cache read tokens for this phase
   */
  @Column({ name: "cache_read_tokens", type: "int", default: 0 })
  cacheReadTokens: number;

  /**
   * Model used for this phase (e.g., claude-sonnet-4-5-20250929)
   */
  @Column({ type: "varchar", length: 100, nullable: true })
  model: string | null;

  /**
   * Provider used for this phase (anthropic, openai, google, ollama)
   */
  @Column({ type: "varchar", length: 50, nullable: true })
  provider: string | null;

  /**
   * Estimated cost in USD for this phase
   */
  @Column({ name: "estimated_cost_usd", type: "decimal", precision: 10, scale: 4, default: 0 })
  estimatedCostUsd: number;

  /**
   * Story index for execution phase (which story was being executed)
   */
  @Column({ name: "story_index", type: "int", nullable: true })
  storyIndex: number | null;

  /**
   * Persona used for this phase (backend_developer, frontend_developer, etc.)
   */
  @Column({ type: "varchar", length: 50, nullable: true })
  persona: string | null;

  /**
   * Operation type for granular tracking (code_generation, analysis, testing, etc.)
   */
  @Column({ name: "operation_type", type: "varchar", length: 50, nullable: true })
  operationType: TokenUsageOperationType | null;

  /**
   * Duration of this phase in seconds
   */
  @Column({ name: "duration_seconds", type: "int", nullable: true })
  durationSeconds: number | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @ManyToOne(() => WorkerTask, { onDelete: "CASCADE" })
  @JoinColumn({ name: "task_id" })
  task: WorkerTask;

  /**
   * Calculate the cost for this phase based on model and provider
   */
  calculateCost(): number {
    if (!this.model || !this.provider) {
      return 0;
    }

    const engine = getPricingEngine(this.provider);
    const tokens: TokenUsage = {
      inputTokens: this.inputTokens || 0,
      outputTokens: this.outputTokens || 0,
      cacheCreationTokens: this.cacheCreationTokens || 0,
      cacheReadTokens: this.cacheReadTokens || 0,
    };

    // Token cost only (no ECS compute for individual phases)
    return engine.calculateTokenCost(tokens, this.model);
  }

  /**
   * Get total tokens (input + output)
   */
  getTotalTokens(): number {
    return (
      (this.inputTokens || 0) +
      (this.outputTokens || 0) +
      (this.cacheCreationTokens || 0) +
      (this.cacheReadTokens || 0)
    );
  }
}

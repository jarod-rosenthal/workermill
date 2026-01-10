import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { AIWorkerTask } from "./AIWorkerTask";
import { calculateTotalCost, type TokenUsage } from "../config/pricing";

export type AIWorkerTaskRunOutcome = "success" | "failed" | "timeout" | "killed" | "cancelled";

@Entity("ai_worker_task_runs")
export class AIWorkerTaskRun {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "task_id", type: "uuid" })
  taskId: string;

  @Column({ name: "run_number", type: "int" })
  runNumber: number;

  @Column({ type: "varchar", length: 30 })
  outcome: AIWorkerTaskRunOutcome;

  @Column({ name: "started_at", type: "timestamp", default: () => "NOW()" })
  startedAt: Date;

  @Column({ name: "ended_at", type: "timestamp", nullable: true })
  endedAt: Date | null;

  @Column({ name: "duration_seconds", type: "int", nullable: true })
  durationSeconds: number | null;

  @Column({ name: "error_message", type: "text", nullable: true })
  errorMessage: string | null;

  @Column({ name: "error_category", type: "varchar", length: 50, nullable: true })
  errorCategory: string | null;

  @Column({ name: "captured_context", type: "text", nullable: true })
  capturedContext: string | null;

  @Column({ name: "container_task_arn", type: "varchar", length: 500, nullable: true })
  containerTaskArn: string | null;

  @Column({ name: "container_task_id", type: "varchar", length: 100, nullable: true })
  containerTaskId: string | null;

  @Column({ name: "ai_input_tokens", type: "int", default: 0 })
  aiInputTokens: number;

  @Column({ name: "ai_output_tokens", type: "int", default: 0 })
  aiOutputTokens: number;

  @Column({ name: "compute_seconds", type: "int", default: 0 })
  computeSeconds: number;

  @Column({ name: "ai_cache_creation_tokens", type: "int", default: 0 })
  aiCacheCreationTokens: number;

  @Column({ name: "ai_cache_read_tokens", type: "int", default: 0 })
  aiCacheReadTokens: number;

  @Column({ name: "worker_model", type: "varchar", length: 50, default: "haiku" })
  workerModel: string;

  @Column({ name: "estimated_cost_usd", type: "decimal", precision: 10, scale: 4, default: 0 })
  estimatedCostUsd: number;

  @Column({ name: "files_modified", type: "jsonb", default: "[]" })
  filesModified: string[];

  @Column({ name: "git_branch", type: "varchar", length: 255, nullable: true })
  gitBranch: string | null;

  @Column({ name: "git_commit_sha", type: "varchar", length: 40, nullable: true })
  gitCommitSha: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @ManyToOne(() => AIWorkerTask, (task) => task.runs, { onDelete: "CASCADE" })
  @JoinColumn({ name: "task_id" })
  task: AIWorkerTask;

  isSuccess(): boolean {
    return this.outcome === "success";
  }

  isFailed(): boolean {
    return ["failed", "timeout", "killed"].includes(this.outcome);
  }

  calculateCost(): number {
    const tokens: TokenUsage = {
      inputTokens: this.aiInputTokens || 0,
      outputTokens: this.aiOutputTokens || 0,
      cacheCreationTokens: this.aiCacheCreationTokens || 0,
      cacheReadTokens: this.aiCacheReadTokens || 0,
    };
    return calculateTotalCost(tokens, this.workerModel || "sonnet", this.computeSeconds || 0);
  }

  getTokenUsage(): TokenUsage {
    return {
      inputTokens: this.aiInputTokens || 0,
      outputTokens: this.aiOutputTokens || 0,
      cacheCreationTokens: this.aiCacheCreationTokens || 0,
      cacheReadTokens: this.aiCacheReadTokens || 0,
    };
  }

  getDurationFormatted(): string {
    if (!this.durationSeconds) return "N/A";
    const minutes = Math.floor(this.durationSeconds / 60);
    const seconds = this.durationSeconds % 60;
    if (minutes === 0) return `${seconds}s`;
    return `${minutes}m ${seconds}s`;
  }
}

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
import { AIWorkerTask, AIWorkerPersona } from "./AIWorkerTask";

export type AIWorkerStatus = "idle" | "working" | "paused" | "disabled";

export type AIWorkerRole = "worker" | "manager";

export interface AIWorkerConfig {
  maxConcurrentTasks?: number;
  allowedProjectKeys?: string[];
  allowedIssueTypes?: string[];
  requireApprovalFor?: string[];
  workingHours?: {
    start: number;
    end: number;
    timezone: string;
  };
  model?: string;
  maxTurns?: number;
}

@Entity("ai_worker_instances")
export class AIWorkerInstance {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "tenant_id", type: "uuid" })
  tenantId: string;

  @Column({ type: "varchar", length: 50 })
  persona: AIWorkerPersona;

  @Column({ name: "display_name", type: "varchar", length: 100 })
  displayName: string;

  @Column({ type: "text", nullable: true })
  description: string | null;

  @Column({ type: "varchar", length: 30, default: "idle" })
  status: AIWorkerStatus;

  @Column({ type: "varchar", length: 20, default: "worker" })
  role: AIWorkerRole;

  @Column({ name: "model_id", type: "varchar", length: 100, default: "claude-3-5-haiku-20241022" })
  modelId: string;

  @Column({ name: "current_task_id", type: "uuid", nullable: true })
  currentTaskId: string | null;

  @Column({ type: "jsonb", default: "{}" })
  config: AIWorkerConfig;

  // Performance metrics
  @Column({ name: "tasks_completed", type: "int", default: 0 })
  tasksCompleted: number;

  @Column({ name: "tasks_failed", type: "int", default: 0 })
  tasksFailed: number;

  @Column({ name: "tasks_cancelled", type: "int", default: 0 })
  tasksCancelled: number;

  @Column({ name: "avg_completion_time_seconds", type: "int", nullable: true })
  avgCompletionTimeSeconds: number | null;

  @Column({ name: "total_tokens_used", type: "bigint", default: 0 })
  totalTokensUsed: number;

  @Column({ name: "total_cost_usd", type: "decimal", precision: 10, scale: 4, default: 0 })
  totalCostUsd: number;

  @Column({ name: "last_task_at", type: "timestamp", nullable: true })
  lastTaskAt: Date | null;

  // Manager-specific metrics
  @Column({ name: "review_count", type: "int", default: 0 })
  reviewCount: number;

  @Column({ name: "approvals_count", type: "int", default: 0 })
  approvalsCount: number;

  @Column({ name: "rejections_count", type: "int", default: 0 })
  rejectionsCount: number;

  @Column({ name: "revisions_requested_count", type: "int", default: 0 })
  revisionsRequestedCount: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => Tenant, { onDelete: "CASCADE" })
  @JoinColumn({ name: "tenant_id" })
  tenant: Tenant;

  @ManyToOne(() => AIWorkerTask, { nullable: true })
  @JoinColumn({ name: "current_task_id" })
  currentTask: AIWorkerTask | null;

  @OneToMany(() => AIWorkerTask, (task) => task.assignedWorker)
  tasks: AIWorkerTask[];

  // Helper methods
  isAvailable(): boolean {
    return this.status === "idle" && !this.currentTaskId;
  }

  canTakeTask(): boolean {
    if (this.status === "paused" || this.status === "disabled") {
      return false;
    }
    if (this.currentTaskId) {
      return false;
    }
    if (this.config.workingHours) {
      const now = new Date();
      const hour = now.getHours();
      if (hour < this.config.workingHours.start || hour >= this.config.workingHours.end) {
        return false;
      }
    }
    return true;
  }

  getSuccessRate(): number {
    const total = this.tasksCompleted + this.tasksFailed;
    if (total === 0) return 0;
    return (this.tasksCompleted / total) * 100;
  }

  getPersonaDisplayName(): string {
    const names: Record<AIWorkerPersona, string> = {
      frontend_developer: "Frontend Developer",
      backend_developer: "Backend Developer",
      devops_engineer: "DevOps Engineer",
      security_engineer: "Security Engineer",
      qa_engineer: "QA Engineer",
      tech_writer: "Technical Writer",
      project_manager: "Project Manager",
      manager: "Virtual Manager",
    };
    return names[this.persona] || this.persona;
  }

  isManager(): boolean {
    return this.role === "manager";
  }

  isWorker(): boolean {
    return this.role === "worker";
  }

  getApprovalRate(): number {
    if (this.reviewCount === 0) return 0;
    return (this.approvalsCount / this.reviewCount) * 100;
  }

  getRevisionRate(): number {
    if (this.reviewCount === 0) return 0;
    return (this.revisionsRequestedCount / this.reviewCount) * 100;
  }
}

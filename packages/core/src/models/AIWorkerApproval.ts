import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { AIWorkerTask } from "./AIWorkerTask";

export type ApprovalType =
  | "pr_review"
  | "dangerous_operation"
  | "production_deploy"
  | "security_change"
  | "infrastructure"
  | "database_migration"
  | "external_api";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "auto_approved" | "expired";

export interface ApprovalPayload {
  prUrl?: string;
  prNumber?: number;
  changedFiles?: string[];
  additions?: number;
  deletions?: number;
  command?: string;
  dangerReason?: string;
  affectedResources?: string[];
  terraformPlan?: string;
  migrationName?: string;
  sqlStatements?: string[];
  description?: string;
  riskLevel?: "low" | "medium" | "high" | "critical";
}

@Entity("ai_worker_approvals")
export class AIWorkerApproval {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "task_id", type: "uuid" })
  taskId: string;

  @Column({ name: "approval_type", type: "varchar", length: 50 })
  approvalType: ApprovalType;

  @Column({ type: "varchar", length: 30, default: "pending" })
  status: ApprovalStatus;

  @Column({ type: "text" })
  description: string;

  @Column({ type: "jsonb", default: "{}" })
  payload: ApprovalPayload;

  @Column({ name: "requested_at", type: "timestamp", default: () => "CURRENT_TIMESTAMP" })
  requestedAt: Date;

  @Column({ name: "expires_at", type: "timestamp", nullable: true })
  expiresAt: Date | null;

  @Column({ name: "responded_at", type: "timestamp", nullable: true })
  respondedAt: Date | null;

  @Column({ name: "responded_by", type: "varchar", length: 100, nullable: true })
  respondedById: string | null;

  @Column({ name: "response_notes", type: "text", nullable: true })
  responseNotes: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @ManyToOne(() => AIWorkerTask, (task) => task.approvals, { onDelete: "CASCADE" })
  @JoinColumn({ name: "task_id" })
  task: AIWorkerTask;

  isPending(): boolean {
    return this.status === "pending";
  }

  isExpired(): boolean {
    if (!this.expiresAt) return false;
    return new Date() > new Date(this.expiresAt);
  }

  approve(userId: string, notes?: string): void {
    this.status = "approved";
    this.respondedById = userId;
    this.respondedAt = new Date();
    this.responseNotes = notes || null;
  }

  reject(userId: string, notes: string): void {
    this.status = "rejected";
    this.respondedById = userId;
    this.respondedAt = new Date();
    this.responseNotes = notes;
  }

  autoApprove(reason: string): void {
    this.status = "auto_approved";
    this.respondedAt = new Date();
    this.responseNotes = reason;
  }

  getRiskLevel(): string {
    return this.payload.riskLevel || "medium";
  }

  static create(
    taskId: string,
    approvalType: ApprovalType,
    description: string,
    payload: ApprovalPayload,
    expiresInMinutes?: number
  ): Partial<AIWorkerApproval> {
    const approval: Partial<AIWorkerApproval> = {
      taskId,
      approvalType,
      description,
      payload,
      status: "pending",
      requestedAt: new Date(),
    };

    if (expiresInMinutes) {
      approval.expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);
    }

    return approval;
  }
}

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
import { Organization } from "./Organization.js";

export type WorkerCommandType =
  | "message"      // Send info to worker (one-way, no response needed)
  | "question"     // Ask worker something (expects response)
  | "pause"        // Stop execution, wait for resume
  | "resume";      // Continue execution (with optional context)

export type WorkerCommandStatus =
  | "pending"       // Sent, not yet seen by worker
  | "acknowledged"  // Worker received the command
  | "responded"     // Worker sent a response (for questions)
  | "completed";    // Command fully processed

@Entity("worker_commands")
@Index(["taskId", "status"])
@Index(["taskId", "createdAt"])
export class WorkerCommand {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "task_id", type: "uuid" })
  taskId: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ type: "varchar", length: 20 })
  type: WorkerCommandType;

  @Column({ type: "text" })
  content: string;

  @Column({ type: "varchar", length: 20, default: "pending" })
  status: WorkerCommandStatus;

  @Column({ type: "text", nullable: true })
  response: string | null;

  // User who created the command (for audit trail)
  @Column({ name: "created_by", type: "uuid", nullable: true })
  createdBy: string | null;

  @Column({ name: "acknowledged_at", type: "timestamp", nullable: true })
  acknowledgedAt: Date | null;

  @Column({ name: "responded_at", type: "timestamp", nullable: true })
  respondedAt: Date | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => WorkerTask, { onDelete: "CASCADE" })
  @JoinColumn({ name: "task_id" })
  task: WorkerTask;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;

  // Helper methods
  isPending(): boolean {
    return this.status === "pending";
  }

  isAcknowledged(): boolean {
    return this.status === "acknowledged";
  }

  isCompleted(): boolean {
    return this.status === "completed";
  }

  needsResponse(): boolean {
    return this.type === "question" && this.status !== "responded" && this.status !== "completed";
  }

  // Factory method for creating commands
  static create(
    taskId: string,
    orgId: string,
    type: WorkerCommandType,
    content: string,
    createdBy?: string
  ): Partial<WorkerCommand> {
    return {
      taskId,
      orgId,
      type,
      content,
      createdBy: createdBy || null,
      status: "pending",
      response: null,
      acknowledgedAt: null,
      respondedAt: null,
    };
  }
}

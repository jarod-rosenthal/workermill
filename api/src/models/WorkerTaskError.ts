import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { WorkerTask } from "./WorkerTask.js";
import { Organization } from "./Organization.js";

export type ErrorType = "error" | "warning";

export type ErrorCategory =
  | "TypeScript"
  | "ESLint"
  | "npm"
  | "Git"
  | "Network"
  | "Permission"
  | "Test"
  | "Build"
  | "Runtime"
  | "Task Failed"
  | "Error"
  | "Warning";

/**
 * WorkerTaskError - Persisted errors/warnings for a worker task.
 *
 * These survive worker restarts and client re-initialization.
 * Cascade deletes with the parent task.
 */
@Entity("worker_task_errors")
@Index(["taskId", "timestamp"])
@Index(["orgId"])
@Index(["orgId", "createdAt"])
export class WorkerTaskError {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "task_id", type: "uuid" })
  taskId: string;

  @Column({ name: "org_id", type: "uuid", nullable: true })
  orgId: string | null;

  @Column({ type: "bigint" })
  timestamp: number;

  @Column({ type: "varchar", length: 20 })
  type: ErrorType;

  @Column({ type: "varchar", length: 50 })
  category: ErrorCategory;

  @Column({ type: "text" })
  message: string;

  @Column({ type: "varchar", length: 500, nullable: true })
  file: string | null;

  @Column({ type: "int", nullable: true })
  line: number | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  // Relations - CASCADE delete when task is deleted
  @ManyToOne(() => WorkerTask, { onDelete: "CASCADE" })
  @JoinColumn({ name: "task_id" })
  task: WorkerTask;

  @ManyToOne(() => Organization, { onDelete: "CASCADE", nullable: true })
  @JoinColumn({ name: "org_id" })
  organization: Organization | null;

  // Helper for creating errors
  static create(
    taskId: string,
    type: ErrorType,
    category: ErrorCategory,
    message: string,
    options?: {
      timestamp?: number;
      file?: string;
      line?: number;
    }
  ): Partial<WorkerTaskError> {
    return {
      taskId,
      timestamp: options?.timestamp || Date.now(),
      type,
      category,
      message,
      file: options?.file || null,
      line: options?.line ?? null,
    };
  }
}

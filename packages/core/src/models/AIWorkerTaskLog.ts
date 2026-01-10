import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { AIWorkerTask } from "./AIWorkerTask";

export type AIWorkerLogType =
  | "status_change"
  | "command_executed"
  | "file_read"
  | "file_changed"
  | "file_deleted"
  | "git_operation"
  | "pr_created"
  | "pr_updated"
  | "test_run"
  | "build_run"
  | "error"
  | "warning"
  | "approval_requested"
  | "approval_response"
  | "external_updated"
  | "blocked"
  | "retry"
  | "info"
  | "manager"
  | "manager_output"
  | "system"
  | "ai_output"
  | "tool_use"
  | "file_edit"
  | "bash_command";

export type AIWorkerLogSeverity = "debug" | "info" | "warning" | "error";

@Entity("ai_worker_task_logs")
export class AIWorkerTaskLog {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "task_id", type: "uuid" })
  taskId: string;

  @Column({ type: "varchar", length: 50 })
  type: AIWorkerLogType;

  @Column({ type: "text" })
  message: string;

  @Column({ type: "jsonb", nullable: true })
  metadata: Record<string, any> | null;

  @Column({ type: "varchar", length: 20, default: "info" })
  severity: AIWorkerLogSeverity;

  @Column({ type: "text", nullable: true })
  command: string | null;

  @Column({ name: "exit_code", type: "int", nullable: true })
  exitCode: number | null;

  @Column({ type: "text", nullable: true })
  stdout: string | null;

  @Column({ type: "text", nullable: true })
  stderr: string | null;

  @Column({ name: "file_path", type: "varchar", length: 500, nullable: true })
  filePath: string | null;

  @Column({ name: "duration_ms", type: "int", nullable: true })
  durationMs: number | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @ManyToOne(() => AIWorkerTask, (task) => task.logs, { onDelete: "CASCADE" })
  @JoinColumn({ name: "task_id" })
  task: AIWorkerTask;

  static create(
    taskId: string,
    type: AIWorkerLogType,
    message: string,
    options?: {
      severity?: AIWorkerLogSeverity;
      metadata?: Record<string, any>;
      command?: string;
      exitCode?: number;
      stdout?: string;
      stderr?: string;
      filePath?: string;
      durationMs?: number;
    }
  ): Partial<AIWorkerTaskLog> {
    return {
      taskId,
      type,
      message,
      severity: options?.severity || "info",
      metadata: options?.metadata || null,
      command: options?.command || null,
      exitCode: options?.exitCode ?? null,
      stdout: options?.stdout || null,
      stderr: options?.stderr || null,
      filePath: options?.filePath || null,
      durationMs: options?.durationMs ?? null,
    };
  }
}

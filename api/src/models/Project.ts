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
import { User } from "./User.js";
import type { BoardColumn } from "./BoardColumn.js";
import type { InternalTask } from "./InternalTask.js";
import type { WorkerTask } from "./WorkerTask.js";

// Epic execution status
export type EpicExecutionStatus = "idle" | "running" | "completed" | "failed";

@Entity("projects")
export class Project {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ type: "varchar", length: 10 })
  key: string;

  @Column({ type: "varchar", length: 200 })
  name: string;

  @Column({ type: "text", nullable: true })
  description: string | null;

  @Column({ name: "github_repo", type: "varchar", length: 255, nullable: true })
  githubRepo: string | null;

  @Column({ name: "default_persona", type: "varchar", length: 50, default: "backend_developer" })
  defaultPersona: string;

  @Column({ name: "default_model", type: "varchar", length: 100, default: "claude-haiku-4-5-20251001" })
  defaultModel: string;

  @Column({ name: "default_provider", type: "varchar", length: 50, default: "anthropic" })
  defaultProvider: string;

  @Column({ name: "task_sequence", type: "int", default: 0 })
  taskSequence: number;

  @Column({ name: "is_archived", type: "boolean", default: false })
  isArchived: boolean;

  @Column({ name: "created_by", type: "uuid", nullable: true })
  createdBy: string | null;

  // Epic execution fields
  @Column({ name: "worker_task_id", type: "uuid", nullable: true })
  workerTaskId: string | null;

  @Column({ name: "execution_status", type: "varchar", length: 20, default: "idle" })
  executionStatus: EpicExecutionStatus;

  @Column({ name: "github_branch", type: "varchar", length: 255, nullable: true })
  githubBranch: string | null;

  @Column({ name: "github_pr_url", type: "varchar", length: 500, nullable: true })
  githubPrUrl: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "created_by" })
  creator: User;

  @OneToMany("BoardColumn", "project")
  columns: BoardColumn[];

  @OneToMany("InternalTask", "project")
  tasks: InternalTask[];

  @ManyToOne("WorkerTask", { onDelete: "SET NULL" })
  @JoinColumn({ name: "worker_task_id" })
  workerTask: WorkerTask | null;

  // Helper to generate next task key
  getNextTaskKey(): string {
    return `${this.key}-${this.taskSequence + 1}`;
  }

  // Epic execution helpers
  isRunning(): boolean {
    return this.executionStatus === "running";
  }

  isIdle(): boolean {
    return this.executionStatus === "idle";
  }

  canRun(): boolean {
    return this.executionStatus === "idle" && !this.isArchived;
  }
}

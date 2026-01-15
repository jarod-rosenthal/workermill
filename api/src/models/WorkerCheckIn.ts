import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { WorkerTask } from "./WorkerTask.js";
import { Organization } from "./Organization.js";

/**
 * Worker Check-In
 *
 * Real-time status tracking for active workers.
 * Workers check in when starting, heartbeat during execution,
 * and check out when done.
 */
@Entity("worker_check_ins")
@Index(["orgId", "repo"])
@Index(["heartbeatAt"])
export class WorkerCheckIn {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "task_id", type: "uuid" })
  taskId: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ name: "worker_id", type: "varchar", length: 100 })
  workerId: string;

  @Column({ type: "varchar", length: 255 })
  repo: string;

  @Column({ type: "varchar", length: 255 })
  branch: string;

  @Column({ type: "varchar", length: 50 })
  status: string;

  @Column({ name: "current_file", type: "varchar", length: 500, nullable: true })
  currentFile: string | null;

  @Column({ name: "files_modified", type: "jsonb", default: [] })
  filesModified: string[];

  @Column({ name: "heartbeat_at", type: "timestamp" })
  heartbeatAt: Date;

  @Column({ name: "started_at", type: "timestamp" })
  startedAt: Date;

  @Column({ type: "jsonb", default: {} })
  metadata: Record<string, unknown>;

  // Relations
  @ManyToOne(() => WorkerTask, { onDelete: "CASCADE" })
  @JoinColumn({ name: "task_id" })
  task: WorkerTask;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;

  /**
   * Check if this check-in is stale (no heartbeat for 5+ minutes)
   */
  isStale(staleThresholdMs: number = 5 * 60 * 1000): boolean {
    return Date.now() - this.heartbeatAt.getTime() > staleThresholdMs;
  }
}

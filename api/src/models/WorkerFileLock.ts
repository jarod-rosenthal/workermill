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

export type LockType = "exclusive" | "shared";

/**
 * Worker File Lock
 *
 * Pessimistic file-level locks to prevent concurrent edits.
 * - Exclusive locks: Only one worker can hold
 * - Shared locks: Multiple workers can read (future use)
 *
 * Locks auto-expire if workers don't renew them (via heartbeat).
 */
@Entity("worker_file_locks")
@Index(["expiresAt"])
@Index(["taskId"])
export class WorkerFileLock {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ type: "varchar", length: 255 })
  repo: string;

  @Column({ name: "file_path", type: "varchar", length: 500 })
  filePath: string;

  @Column({ name: "task_id", type: "uuid" })
  taskId: string;

  @Column({ name: "worker_id", type: "varchar", length: 100 })
  workerId: string;

  @Column({ name: "lock_type", type: "varchar", length: 20, default: "exclusive" })
  lockType: LockType;

  @Column({ name: "acquired_at", type: "timestamp" })
  acquiredAt: Date;

  @Column({ name: "expires_at", type: "timestamp" })
  expiresAt: Date;

  // Relations
  @ManyToOne(() => WorkerTask, { onDelete: "CASCADE" })
  @JoinColumn({ name: "task_id" })
  task: WorkerTask;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;

  /**
   * Check if this lock has expired
   */
  isExpired(): boolean {
    return Date.now() > this.expiresAt.getTime();
  }

  /**
   * Extend the lock expiration
   */
  extend(ttlSeconds: number = 300): void {
    this.expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  }
}

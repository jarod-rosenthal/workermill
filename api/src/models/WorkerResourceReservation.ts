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
 * Resource types that can be reserved
 * - test_db: Test database instance
 * - deploy_slot: Deployment slot (prevents concurrent deploys)
 * - ci_runner: CI runner slot
 * - preview_env: Preview environment
 */
export type ResourceType =
  | "test_db"
  | "deploy_slot"
  | "ci_runner"
  | "preview_env"
  | string; // Allow custom types

/**
 * Worker Resource Reservation
 *
 * Coordinates shared resources between workers.
 * Only one worker can hold a specific resource at a time.
 *
 * Examples:
 * - Reserving a test database for integration tests
 * - Reserving a deploy slot during deployment
 * - Reserving a CI runner for builds
 */
@Entity("worker_resource_reservations")
@Index(["expiresAt"])
@Index(["taskId"])
export class WorkerResourceReservation {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ name: "resource_type", type: "varchar", length: 50 })
  resourceType: ResourceType;

  @Column({ name: "resource_id", type: "varchar", length: 100 })
  resourceId: string;

  @Column({ name: "task_id", type: "uuid" })
  taskId: string;

  @Column({ name: "worker_id", type: "varchar", length: 100 })
  workerId: string;

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
   * Check if this reservation has expired
   */
  isExpired(): boolean {
    return Date.now() > this.expiresAt.getTime();
  }

  /**
   * Extend the reservation expiration
   */
  extend(ttlSeconds: number = 300): void {
    this.expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  }
}

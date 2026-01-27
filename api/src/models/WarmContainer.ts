import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { Organization } from "./Organization.js";
import { WorkerTask } from "./WorkerTask.js";

export type WarmContainerStatus = "warming" | "ready" | "assigned" | "terminated";

@Entity("warm_containers")
@Index("idx_warm_containers_org_status", ["orgId", "status"])
export class WarmContainer {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ name: "ecs_task_arn", type: "varchar", length: 500 })
  ecsTaskArn: string;

  @Column({ name: "ecs_task_id", type: "varchar", length: 100 })
  ecsTaskId: string;

  @Column({ type: "varchar", length: 30, default: "warming" })
  status: WarmContainerStatus;

  @Column({ name: "assigned_task_id", type: "uuid", nullable: true })
  assignedTaskId: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @Column({ name: "ready_at", type: "timestamp", nullable: true })
  readyAt: Date | null;

  @Column({ name: "assigned_at", type: "timestamp", nullable: true })
  assignedAt: Date | null;

  @Column({ name: "heartbeat_at", type: "timestamp", nullable: true })
  heartbeatAt: Date | null;

  // Store environment variables for the assigned task (JSON blob)
  // This is what the warm container polls for when assigned
  @Column({ name: "task_environment", type: "jsonb", nullable: true })
  taskEnvironment: Record<string, string> | null;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;

  @ManyToOne(() => WorkerTask, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "assigned_task_id" })
  assignedTask: WorkerTask | null;
}

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
import { User } from "./User.js";

export type AuditAction =
  | "settings_updated"
  | "member_invited"
  | "member_removed"
  | "member_role_changed"
  | "task_created"
  | "task_deleted"
  | "task_cancelled"
  | "task_retried"
  | "api_key_created"
  | "api_key_revoked"
  | "api_key_rotated"
  | "billing_plan_changed"
  | "billing_subscription_created"
  | "billing_subscription_cancelled"
  | "orchestrator_started"
  | "orchestrator_stopped"
  | "webhook_configured"
  | "integration_connected"
  | "integration_disconnected"
  | "login"
  | "logout"
  | "password_changed"
  | "mfa_enabled"
  | "mfa_disabled";

export type AuditResourceType =
  | "organization"
  | "user"
  | "task"
  | "api_key"
  | "billing"
  | "integration"
  | "settings";

export interface AuditChanges {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  fields?: string[];
  metadata?: Record<string, unknown>;
}

@Entity("audit_logs")
@Index(["organizationId", "createdAt"])
@Index(["userId", "createdAt"])
@Index(["action", "createdAt"])
export class AuditLog {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "organization_id", type: "uuid" })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "organization_id" })
  organization: Organization;

  @Column({ name: "user_id", type: "uuid", nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "user_id" })
  user: User | null;

  @Column({ type: "varchar", length: 50 })
  action: AuditAction;

  @Column({ name: "resource_type", type: "varchar", length: 50 })
  resourceType: AuditResourceType;

  @Column({ name: "resource_id", type: "varchar", length: 255, nullable: true })
  resourceId: string | null;

  @Column({ type: "jsonb", default: {} })
  changes: AuditChanges;

  @Column({ name: "ip_address", type: "varchar", length: 45, nullable: true })
  ipAddress: string | null;

  @Column({ name: "user_agent", type: "text", nullable: true })
  userAgent: string | null;

  @Column({ type: "text", nullable: true })
  description: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;
}

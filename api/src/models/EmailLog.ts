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

export type EmailStatus = "pending" | "sent" | "failed" | "bounced" | "complained";

export type EmailType =
  | "invite"
  | "task_completed"
  | "task_failed"
  | "cost_alert"
  | "pr_created"
  | "quota_warning"
  | "daily_digest"
  | "weekly_digest";

export interface EmailMetadata {
  taskId?: string;
  jiraIssueKey?: string;
  prUrl?: string;
  threshold?: number;
  currentCost?: number;
  unsubscribeToken?: string;
  [key: string]: unknown;
}

@Entity("email_logs")
@Index(["orgId"])
@Index(["userId"])
@Index(["recipientEmail"])
@Index(["createdAt"])
@Index(["emailType", "status"])
export class EmailLog {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ name: "user_id", type: "uuid", nullable: true })
  userId: string | null;

  @Column({ name: "recipient_email", type: "varchar", length: 255 })
  recipientEmail: string;

  @Column({ name: "email_type", type: "varchar", length: 50 })
  emailType: EmailType;

  @Column({ type: "varchar", length: 500 })
  subject: string;

  @Column({ name: "ses_message_id", type: "varchar", length: 255, nullable: true })
  sesMessageId: string | null;

  @Column({ type: "varchar", length: 20, default: "pending" })
  status: EmailStatus;

  @Column({ name: "error_message", type: "text", nullable: true })
  errorMessage: string | null;

  @Column({ type: "jsonb", default: {} })
  metadata: EmailMetadata;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @Column({ name: "sent_at", type: "timestamp with time zone", nullable: true })
  sentAt: Date | null;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "user_id" })
  user: User;
}

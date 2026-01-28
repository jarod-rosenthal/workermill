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
import type { SupportTicketMessage } from "./SupportTicketMessage.js";

export type SupportTicketStatus = "open" | "in_progress" | "waiting" | "resolved" | "closed";
export type SupportTicketPriority = "low" | "medium" | "high" | "urgent";
export type SupportTicketCategory = "general" | "billing" | "technical" | "feature_request" | "bug_report";

@Entity("support_tickets")
export class SupportTicket {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "ticket_key", type: "varchar", length: 20, unique: true })
  ticketKey: string; // SUP-001, SUP-002, etc.

  @Column({ type: "varchar", length: 500 })
  subject: string;

  @Column({ type: "text" })
  description: string;

  @Column({ type: "varchar", length: 20, default: "open" })
  status: SupportTicketStatus;

  @Column({ type: "varchar", length: 20, default: "medium" })
  priority: SupportTicketPriority;

  @Column({ type: "varchar", length: 30, default: "general" })
  category: SupportTicketCategory;

  @Column({ name: "assigned_to", type: "uuid", nullable: true })
  assignedTo: string | null; // Admin user ID

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ name: "created_by", type: "uuid" })
  createdBy: string; // User ID

  @Column({ name: "email_message_id", type: "varchar", length: 255, nullable: true })
  emailMessageId: string | null; // For email-created tickets

  @Column({ type: "jsonb", nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ name: "resolved_at", type: "timestamp", nullable: true })
  resolvedAt: Date | null;

  @Column({ name: "closed_at", type: "timestamp", nullable: true })
  closedAt: Date | null;

  // AI Support Agent fields
  @Column({ name: "auto_response_attempted", type: "boolean", default: false })
  autoResponseAttempted: boolean;

  @Column({ name: "ai_confidence_score", type: "numeric", precision: 5, scale: 2, nullable: true })
  aiConfidenceScore: number | null;

  @Column({ name: "ai_escalation_reason", type: "varchar", length: 255, nullable: true })
  aiEscalationReason: string | null;

  @Column({ name: "ai_model_used", type: "varchar", length: 50, nullable: true })
  aiModelUsed: string | null;

  @Column({ name: "ai_response_task_id", type: "uuid", nullable: true })
  aiResponseTaskId: string | null;

  @Column({ name: "ai_responded_at", type: "timestamp", nullable: true })
  aiRespondedAt: Date | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "created_by" })
  creator: User;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "assigned_to" })
  assignee: User | null;

  @OneToMany("SupportTicketMessage", "ticket")
  messages: SupportTicketMessage[];

  // Helper methods
  isOpen(): boolean {
    return this.status === "open" || this.status === "in_progress" || this.status === "waiting";
  }

  isClosed(): boolean {
    return this.status === "resolved" || this.status === "closed";
  }

  canTransitionTo(newStatus: SupportTicketStatus): boolean {
    const validTransitions: Record<SupportTicketStatus, SupportTicketStatus[]> = {
      open: ["in_progress", "resolved", "closed"],
      in_progress: ["waiting", "resolved", "closed"],
      waiting: ["in_progress", "resolved", "closed"],
      resolved: ["open", "closed"], // Can reopen or close
      closed: ["open"], // Can reopen
    };
    return validTransitions[this.status]?.includes(newStatus) ?? false;
  }

  getDisplayStatus(): string {
    const displayNames: Record<SupportTicketStatus, string> = {
      open: "Open",
      in_progress: "In Progress",
      waiting: "Waiting",
      resolved: "Resolved",
      closed: "Closed",
    };
    return displayNames[this.status];
  }

  getDurationSeconds(): number | null {
    if (!this.createdAt) return null;
    const endTime = this.closedAt || this.resolvedAt || new Date();
    return Math.floor((endTime.getTime() - this.createdAt.getTime()) / 1000);
  }
}

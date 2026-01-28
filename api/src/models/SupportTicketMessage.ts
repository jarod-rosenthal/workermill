import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { SupportTicket } from "./SupportTicket.js";
import { User } from "./User.js";

export interface SupportTicketAttachment {
  name: string;
  url: string;
  size: number;
  contentType?: string;
}

@Entity("support_ticket_messages")
export class SupportTicketMessage {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "ticket_id", type: "uuid" })
  ticketId: string;

  @Column({ type: "text" })
  content: string;

  @Column({ name: "is_internal", type: "boolean", default: false })
  isInternal: boolean; // Internal notes not visible to user

  @Column({ name: "is_from_support", type: "boolean", default: false })
  isFromSupport: boolean; // Response from support team

  @Column({ name: "author_id", type: "uuid", nullable: true })
  authorId: string | null; // User ID (null for system messages)

  @Column({ name: "author_email", type: "varchar", length: 255, nullable: true })
  authorEmail: string | null; // For email replies

  @Column({ name: "email_message_id", type: "varchar", length: 255, nullable: true })
  emailMessageId: string | null; // For deduplication

  @Column({ type: "jsonb", nullable: true })
  attachments: SupportTicketAttachment[] | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @ManyToOne(() => SupportTicket, (ticket) => ticket.messages, { onDelete: "CASCADE" })
  @JoinColumn({ name: "ticket_id" })
  ticket: SupportTicket;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "author_id" })
  author: User | null;

  // Helper methods
  isSystemMessage(): boolean {
    return this.authorId === null && this.authorEmail === null;
  }

  getDisplayAuthor(): string {
    if (this.author?.fullName) {
      return this.author.fullName;
    }
    if (this.authorEmail) {
      return this.authorEmail;
    }
    if (this.isFromSupport) {
      return "Support Team";
    }
    return "System";
  }
}

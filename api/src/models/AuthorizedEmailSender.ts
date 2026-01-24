import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { Organization } from "./Organization.js";
import { User } from "./User.js";

export type SenderType = "user" | "domain" | "service";

@Entity("authorized_email_senders")
@Index(["orgId"])
export class AuthorizedEmailSender {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ name: "email_pattern", type: "varchar", length: 255 })
  emailPattern: string;

  @Column({ name: "sender_type", type: "varchar", length: 50, default: "user" })
  senderType: SenderType;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive: boolean;

  @Column({ name: "created_by", type: "uuid", nullable: true })
  createdBy: string | null;

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

  /**
   * Check if an email address matches this sender pattern
   * Supports exact match, domain match (*@domain.com), and wildcard (*@*)
   */
  matches(email: string): boolean {
    const pattern = this.emailPattern.toLowerCase();
    const normalizedEmail = email.toLowerCase();

    // Exact match
    if (pattern === normalizedEmail) {
      return true;
    }

    // Domain wildcard match (e.g., *@example.com)
    if (pattern.startsWith("*@")) {
      const domain = pattern.substring(2);
      return normalizedEmail.endsWith(`@${domain}`);
    }

    // Full wildcard (accept any - use with caution)
    if (pattern === "*" || pattern === "*@*") {
      return true;
    }

    return false;
  }
}

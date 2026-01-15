/**
 * Organization Invite Model
 *
 * Tracks pending invitations to join an organization.
 */

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Organization } from "./Organization.js";

export type InviteRole = "admin" | "member" | "viewer";

@Entity("org_invites")
export class OrgInvite {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id" })
  orgId: string;

  @ManyToOne(() => Organization)
  @JoinColumn({ name: "org_id" })
  organization: Organization;

  @Column({ type: "varchar", length: 255 })
  email: string;

  @Column({ type: "varchar", length: 50, default: "member" })
  role: InviteRole;

  @Column({ type: "varchar", length: 255, unique: true })
  token: string;

  @Column({ name: "expires_at", type: "timestamp" })
  expiresAt: Date;

  @Column({ default: false })
  accepted: boolean;

  @Column({ name: "invited_by", type: "uuid", nullable: true })
  invitedBy: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  /**
   * Check if the invite has expired
   */
  isExpired(): boolean {
    return new Date() > this.expiresAt;
  }

  /**
   * Check if the invite is still valid (not expired and not accepted)
   */
  isValid(): boolean {
    return !this.accepted && !this.isExpired();
  }

  /**
   * Create a new invite with a secure token
   */
  static createInvite(
    orgId: string,
    email: string,
    role: InviteRole = "member",
    invitedBy?: string,
    expiresInDays: number = 7
  ): Partial<OrgInvite> {
    const token = crypto.randomUUID() + "-" + crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    return {
      orgId,
      email: email.toLowerCase(),
      role,
      token,
      expiresAt,
      invitedBy: invitedBy || null,
      accepted: false,
    };
  }
}

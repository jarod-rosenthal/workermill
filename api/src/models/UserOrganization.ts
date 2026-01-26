import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from "typeorm";
import { User } from "./User.js";
import { Organization } from "./Organization.js";

export type OrgMemberRole = "owner" | "admin" | "member";

/**
 * UserOrganization - Junction table for user-organization many-to-many relationship
 *
 * Enables users to belong to multiple organizations with different roles.
 * Each user has exactly one "default" organization that's used when no org context is specified.
 */
@Entity("user_organizations")
@Unique(["userId", "orgId"])
@Index(["userId"])
@Index(["orgId"])
export class UserOrganization {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ type: "varchar", length: 20, default: "member" })
  role: OrgMemberRole;

  @Column({ name: "is_default", type: "boolean", default: false })
  isDefault: boolean;

  @Column({ name: "joined_at", type: "timestamptz", default: () => "NOW()" })
  joinedAt: Date;

  @Column({ name: "invited_by", type: "uuid", nullable: true })
  invitedBy: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user: User;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "invited_by" })
  inviter: User | null;

  /**
   * Check if user has admin-level access (owner or admin)
   */
  hasAdminAccess(): boolean {
    return this.role === "owner" || this.role === "admin";
  }

  /**
   * Check if user is the org owner
   */
  isOwner(): boolean {
    return this.role === "owner";
  }
}

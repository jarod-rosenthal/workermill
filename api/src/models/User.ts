import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Organization } from "./Organization.js";

export type UserRole = "admin" | "member" | "viewer";

export type EmailFrequency = "immediate" | "daily" | "weekly" | "never";

export interface EmailPreferences {
  taskCompleted?: boolean;
  taskFailed?: boolean;
  costAlerts?: boolean;
  prCreated?: boolean;
  quotaWarning?: boolean;
  frequency?: EmailFrequency;
}

export interface UserPreferences {
  theme?: "system" | "dark" | "light";
  onboardingDismissed?: boolean;
  notifications?: {
    taskCompleted?: boolean;
    taskFailed?: boolean;
    costAlerts?: boolean;
  };
  dashboard?: {
    statsCollapsed?: boolean;
    managerCollapsed?: boolean;
  };
  email?: EmailPreferences;
}

export interface NotificationPreferences {
  push_completions: boolean;
  push_failures: boolean;
  push_blockers: boolean;
  push_plan_approvals: boolean;
}

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid", nullable: true })
  orgId: string | null;

  // Cognito user ID
  @Column({ name: "cognito_id", type: "varchar", length: 255, unique: true })
  cognitoId: string;

  @Column({ type: "varchar", length: 255 })
  email: string;

  @Column({ name: "full_name", type: "varchar", length: 255, nullable: true })
  fullName: string | null;

  @Column({ type: "varchar", length: 20, default: "member" })
  role: UserRole;

  @Column({ type: "varchar", length: 20, default: "active" })
  status: "active" | "inactive" | "pending";

  @Column({ type: "jsonb", default: () => "'{}'" })
  preferences: UserPreferences;

  // Referral program
  @Column({ name: "referral_code", type: "varchar", length: 50, nullable: true })
  referralCode: string | null;

  @Column({ name: "referred_by_code", type: "varchar", length: 50, nullable: true })
  referredByCode: string | null;

  // ToS acceptance
  @Column({ name: "tos_accepted_at", type: "timestamp", nullable: true })
  tosAcceptedAt: Date | null;

  @Column({ name: "tos_version", type: "varchar", length: 20, nullable: true })
  tosVersion: string | null;

  // MFA backup recovery codes (hashed with bcrypt)
  @Column({ name: "mfa_backup_codes", type: "jsonb", default: () => "'[]'" })
  mfaBackupCodes: string[];

  // Support admin flag - grants access to support admin dashboard
  @Column({ name: "support_admin", type: "boolean", default: false })
  supportAdmin: boolean;

  // Push notification preferences
  @Column({
    name: "notification_preferences",
    type: "jsonb",
    default: () => "'{ \"push_completions\": true, \"push_failures\": true, \"push_blockers\": true, \"push_plan_approvals\": true }'::jsonb"
  })
  notificationPreferences: NotificationPreferences;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @ManyToOne(() => Organization, (org) => org.users, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;
}

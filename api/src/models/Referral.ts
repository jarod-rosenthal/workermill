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
import { User } from "./User.js";
import { Organization } from "./Organization.js";

export type ReferralStatus =
  | "pending"      // Referral code shared, no signup yet
  | "signed_up"    // Referred user signed up, waiting for first paid month
  | "qualified"    // Referred user completed first paid month
  | "credited"     // Referrer received credit
  | "expired"      // Referral expired (12 months from creation)
  | "revoked";     // Revoked due to fraud/abuse

/**
 * Referral tracking for the referral program
 *
 * Flow:
 * 1. User gets a referral code (auto-generated from user ID or custom)
 * 2. New user signs up with referral code → status: signed_up
 * 3. New user completes first paid month → status: qualified
 * 4. System awards $100 credit to referrer → status: credited
 *
 * Guardrails:
 * - Max 10 referrals per year per user
 * - Credits expire in 12 months
 * - No self-referral (same payment method, email domain, IP)
 * - Credit only after first paid month
 */
@Entity("referrals")
@Index(["referrerUserId", "createdAt"]) // For counting yearly referrals
@Index(["referralCode"], { unique: true })
@Index(["referredEmail"])
export class Referral {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // Referrer info
  @Column({ name: "referrer_user_id", type: "uuid" })
  referrerUserId: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "referrer_user_id" })
  referrerUser: User;

  @Column({ name: "referrer_org_id", type: "uuid" })
  referrerOrgId: string;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "referrer_org_id" })
  referrerOrg: Organization;

  // Unique referral code (e.g., "JOHN123" or auto-generated)
  @Column({ name: "referral_code", type: "varchar", length: 50 })
  referralCode: string;

  // Referred user info (populated after signup)
  @Column({ name: "referred_email", type: "varchar", length: 255, nullable: true })
  referredEmail: string | null;

  @Column({ name: "referred_user_id", type: "uuid", nullable: true })
  referredUserId: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "referred_user_id" })
  referredUser: User | null;

  @Column({ name: "referred_org_id", type: "uuid", nullable: true })
  referredOrgId: string | null;

  @ManyToOne(() => Organization, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "referred_org_id" })
  referredOrg: Organization | null;

  // Status tracking
  @Column({ type: "varchar", length: 20, default: "pending" })
  status: ReferralStatus;

  // Credit info
  @Column({ name: "credit_amount_cents", type: "int", default: 10000 }) // $100 = 10000 cents
  creditAmountCents: number;

  @Column({ name: "credited_at", type: "timestamp", nullable: true })
  creditedAt: Date | null;

  // Discount for referred user (percentage off first N months)
  @Column({ name: "referred_discount_percent", type: "int", default: 50 })
  referredDiscountPercent: number;

  @Column({ name: "referred_discount_months", type: "int", default: 3 })
  referredDiscountMonths: number;

  @Column({ name: "referred_discount_used_months", type: "int", default: 0 })
  referredDiscountUsedMonths: number;

  // Anti-fraud tracking
  @Column({ name: "referred_ip", type: "varchar", length: 45, nullable: true })
  referredIp: string | null;

  @Column({ name: "referred_email_domain", type: "varchar", length: 255, nullable: true })
  referredEmailDomain: string | null;

  // Signup timestamp
  @Column({ name: "signed_up_at", type: "timestamp", nullable: true })
  signedUpAt: Date | null;

  // First paid month completion timestamp
  @Column({ name: "qualified_at", type: "timestamp", nullable: true })
  qualifiedAt: Date | null;

  // Expiration (12 months from creation for pending referrals)
  @Column({ name: "expires_at", type: "timestamp" })
  expiresAt: Date;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}

// Constants
export const REFERRAL_CREDIT_CENTS = 10000; // $100
export const REFERRAL_DISCOUNT_PERCENT = 50; // 50% off
export const REFERRAL_DISCOUNT_MONTHS = 3; // First 3 months
export const MAX_REFERRALS_PER_YEAR = 10;
export const REFERRAL_EXPIRY_MONTHS = 12;

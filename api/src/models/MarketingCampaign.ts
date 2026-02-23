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

export type CampaignPlatform =
  | "google_ads"
  | "reddit"
  | "x"
  | "github"
  | "devto"
  | "hackernews";

export type CampaignStatus =
  | "active"
  | "paused"
  | "pending_review"
  | "completed"
  | "rejected";

@Entity("marketing_campaigns")
@Index(["orgId"])
export class MarketingCampaign {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ type: "varchar", length: 50 })
  platform: CampaignPlatform;

  @Column({ type: "varchar", length: 255 })
  name: string;

  @Column({ type: "varchar", length: 50, default: "pending_review" })
  status: CampaignStatus;

  @Column({ name: "budget_cents", type: "int", default: 0 })
  budgetCents: number;

  @Column({ name: "spent_cents", type: "int", default: 0 })
  spentCents: number;

  @Column({ type: "int", default: 0 })
  impressions: number;

  @Column({ type: "int", default: 0 })
  clicks: number;

  @Column({ type: "int", default: 0 })
  conversions: number;

  @Column({ name: "targeting_config", type: "jsonb", default: {} })
  targetingConfig: Record<string, unknown>;

  @Column({ name: "external_id", type: "varchar", length: 255, nullable: true })
  externalId: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;
}

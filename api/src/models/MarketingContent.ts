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
import { MarketingCampaign } from "./MarketingCampaign.js";

export type ContentPlatform = "x" | "reddit" | "devto" | "blog" | "hackernews";

export type ContentType = "tweet" | "post" | "article" | "ad_copy";

export type ContentStatus =
  | "draft"
  | "pending_review"
  | "approved"
  | "published"
  | "rejected";

@Entity("marketing_content")
@Index(["orgId"])
export class MarketingContent {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ name: "campaign_id", type: "uuid", nullable: true })
  campaignId: string | null;

  @Column({ type: "varchar", length: 50 })
  platform: ContentPlatform;

  @Column({ name: "content_type", type: "varchar", length: 50 })
  contentType: ContentType;

  @Column({ type: "varchar", length: 500, nullable: true })
  title: string | null;

  @Column({ type: "text" })
  body: string;

  @Column({ type: "varchar", length: 50, default: "draft" })
  status: ContentStatus;

  @Column({ name: "published_at", type: "timestamptz", nullable: true })
  publishedAt: Date | null;

  @Column({ name: "engagement_metrics", type: "jsonb", default: {} })
  engagementMetrics: Record<string, unknown>;

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

  @ManyToOne(() => MarketingCampaign, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "campaign_id" })
  campaign: MarketingCampaign | null;
}

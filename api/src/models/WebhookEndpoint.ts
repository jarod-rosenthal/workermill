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
import { Organization } from "./Organization.js";

export type IntegrationType =
  | "jira"
  | "github"
  | "github-issues"
  | "gitlab"
  | "bitbucket"
  | "linear"
  | "email";

export interface WebhookEndpointConfig {
  // Optional per-integration settings
  autoApproveTests?: boolean;
  skipSignatureValidation?: boolean; // For testing only
  customHeaders?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * WebhookEndpoint - Per-organization webhook configuration
 *
 * Each organization can have multiple webhook endpoints, one per integration type.
 * This enables proper multi-tenant isolation where each org has its own webhook secrets.
 *
 * URL format: /api/webhooks/:orgSlug/:integrationType
 * Example: https://workermill.com/api/webhooks/acme-corp/jira
 */
@Entity("webhook_endpoints")
@Unique(["orgId", "integrationType"])
@Index(["orgId"])
@Index(["orgId", "integrationType", "isActive"])
export class WebhookEndpoint {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ name: "integration_type", type: "varchar", length: 50 })
  integrationType: IntegrationType;

  @Column({ name: "webhook_secret", type: "varchar", length: 255 })
  webhookSecret: string;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive: boolean;

  @Column({ type: "jsonb", default: {} })
  config: WebhookEndpointConfig;

  @Column({ name: "last_received_at", type: "timestamptz", nullable: true })
  lastReceivedAt: Date | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;

  /**
   * Generate the full webhook URL for this endpoint
   */
  getWebhookUrl(baseUrl: string, orgSlug: string): string {
    return `${baseUrl}/api/webhooks/${orgSlug}/${this.integrationType}`;
  }

  /**
   * Generate a display-friendly name for this integration
   */
  getDisplayName(): string {
    const names: Record<IntegrationType, string> = {
      jira: "Jira",
      github: "GitHub PR Reviews",
      "github-issues": "GitHub Issues",
      gitlab: "GitLab",
      bitbucket: "BitBucket",
      linear: "Linear",
      email: "Inbound Email",
    };
    return names[this.integrationType] || this.integrationType;
  }

  /**
   * Check if this endpoint should verify signatures
   * (can be disabled for testing, but NOT in production)
   */
  shouldVerifySignature(): boolean {
    return !this.config.skipSignatureValidation;
  }
}

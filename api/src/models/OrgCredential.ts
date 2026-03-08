import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

/**
 * Encrypted key-value store for per-org integration secrets.
 *
 * Replaces AWS Secrets Manager for customer credentials (API keys, tokens,
 * service accounts). Values are AES-256-GCM encrypted at rest via the
 * OrgCredentialEncryptionSubscriber.
 *
 * credential_key values match the old SM key names exactly:
 *   providers/anthropic, providers/openai, providers/google,
 *   github-token, github-reviewer-token, gitlab-token, bitbucket-token,
 *   jira-credentials, linear-credentials, teams-webhook, slack-webhook,
 *   aws-credentials, aws-role-config,
 *   gcp-credentials, azure-credentials
 */
@Entity("org_credentials")
@Index("IDX_org_credentials_org_key", ["orgId", "credentialKey"], {
  unique: true,
})
export class OrgCredential {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId!: string;

  @Column({ name: "credential_key", type: "varchar", length: 100 })
  credentialKey!: string;

  @Column({ name: "encrypted_value", type: "text" })
  encryptedValue!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}

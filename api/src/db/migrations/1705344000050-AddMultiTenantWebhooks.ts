import { MigrationInterface, QueryRunner } from "typeorm";
import crypto from "crypto";

/**
 * Migration: Add Multi-Tenant Webhook Support
 *
 * Adds URL-based tenant routing for webhooks:
 * - organizations.slug: Unique URL-safe identifier for the org (e.g., "acme-corp")
 * - webhook_endpoints: Per-org webhook secrets for each integration type
 *
 * New webhook URL format: /api/webhooks/:orgSlug/:integration
 * Example: https://workermill.com/api/webhooks/acme-corp/jira
 */
export class AddMultiTenantWebhooks1705344000050 implements MigrationInterface {
  name = "AddMultiTenantWebhooks1705344000050";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add slug column to organizations
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS slug VARCHAR(100) NULL
    `);

    // Create unique index on slug (allows null for migration period)
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_slug
      ON organizations(slug)
      WHERE slug IS NOT NULL
    `);

    // Create webhook_endpoints table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS webhook_endpoints (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        integration_type VARCHAR(50) NOT NULL,
        webhook_secret VARCHAR(255) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        config JSONB DEFAULT '{}',
        last_received_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(org_id, integration_type)
      )
    `);

    // Create indexes for webhook_endpoints
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_org_id
      ON webhook_endpoints(org_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_active
      ON webhook_endpoints(org_id, integration_type, is_active)
      WHERE is_active = true
    `);

    // Generate slugs for existing organizations
    const orgs = await queryRunner.query(`
      SELECT id, name FROM organizations WHERE slug IS NULL
    `);

    for (const org of orgs) {
      // Generate slug from org name: lowercase, replace spaces/special chars with hyphen
      let baseSlug = org.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .substring(0, 90);

      if (!baseSlug) {
        baseSlug = "org";
      }

      // Check for conflicts and add suffix if needed
      let slug = baseSlug;
      let suffix = 1;
      let exists = true;

      while (exists) {
        const conflict = await queryRunner.query(
          `SELECT id FROM organizations WHERE slug = $1`,
          [slug]
        );
        if (conflict.length === 0) {
          exists = false;
        } else {
          suffix++;
          slug = `${baseSlug}-${suffix}`;
        }
      }

      await queryRunner.query(
        `UPDATE organizations SET slug = $1 WHERE id = $2`,
        [slug, org.id]
      );
    }

    // Migrate existing webhook secrets to webhook_endpoints table
    // Get all orgs with webhook secrets
    const orgsWithSecrets = await queryRunner.query(`
      SELECT id, jira_webhook_secret, github_webhook_secret, gitlab_webhook_secret, bitbucket_webhook_secret
      FROM organizations
      WHERE jira_webhook_secret IS NOT NULL
         OR github_webhook_secret IS NOT NULL
         OR gitlab_webhook_secret IS NOT NULL
         OR bitbucket_webhook_secret IS NOT NULL
    `);

    for (const org of orgsWithSecrets) {
      // Migrate Jira webhook secret
      if (org.jira_webhook_secret) {
        await queryRunner.query(
          `INSERT INTO webhook_endpoints (org_id, integration_type, webhook_secret, is_active)
           VALUES ($1, 'jira', $2, true)
           ON CONFLICT (org_id, integration_type) DO NOTHING`,
          [org.id, org.jira_webhook_secret]
        );
      }

      // Migrate GitHub webhook secret
      if (org.github_webhook_secret) {
        await queryRunner.query(
          `INSERT INTO webhook_endpoints (org_id, integration_type, webhook_secret, is_active)
           VALUES ($1, 'github', $2, true)
           ON CONFLICT (org_id, integration_type) DO NOTHING`,
          [org.id, org.github_webhook_secret]
        );
        // Also create for github-issues (same secret)
        await queryRunner.query(
          `INSERT INTO webhook_endpoints (org_id, integration_type, webhook_secret, is_active)
           VALUES ($1, 'github-issues', $2, true)
           ON CONFLICT (org_id, integration_type) DO NOTHING`,
          [org.id, org.github_webhook_secret]
        );
      }

      // Migrate GitLab webhook secret
      if (org.gitlab_webhook_secret) {
        await queryRunner.query(
          `INSERT INTO webhook_endpoints (org_id, integration_type, webhook_secret, is_active)
           VALUES ($1, 'gitlab', $2, true)
           ON CONFLICT (org_id, integration_type) DO NOTHING`,
          [org.id, org.gitlab_webhook_secret]
        );
      }

      // Migrate BitBucket webhook secret
      if (org.bitbucket_webhook_secret) {
        await queryRunner.query(
          `INSERT INTO webhook_endpoints (org_id, integration_type, webhook_secret, is_active)
           VALUES ($1, 'bitbucket', $2, true)
           ON CONFLICT (org_id, integration_type) DO NOTHING`,
          [org.id, org.bitbucket_webhook_secret]
        );
      }
    }

    // Also migrate Linear webhook secrets from provider_settings
    const orgsWithLinear = await queryRunner.query(`
      SELECT id, provider_settings
      FROM organizations
      WHERE provider_settings->>'linearWebhookSecret' IS NOT NULL
    `);

    for (const org of orgsWithLinear) {
      const linearSecret = org.provider_settings?.linearWebhookSecret;
      if (linearSecret) {
        await queryRunner.query(
          `INSERT INTO webhook_endpoints (org_id, integration_type, webhook_secret, is_active)
           VALUES ($1, 'linear', $2, true)
           ON CONFLICT (org_id, integration_type) DO NOTHING`,
          [org.id, linearSecret]
        );
      }
    }

    // Add org_id to webhook_deliveries table for better multi-tenant isolation
    // This column already exists but may be nullable
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_org_id
      ON webhook_deliveries(org_id)
      WHERE org_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop webhook_endpoints indexes
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_webhook_endpoints_active
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_webhook_endpoints_org_id
    `);

    // Drop webhook_endpoints table
    await queryRunner.query(`
      DROP TABLE IF EXISTS webhook_endpoints
    `);

    // Drop organization slug index and column
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_organizations_slug
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS slug
    `);

    // Drop webhook_deliveries org_id index
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_webhook_deliveries_org_id
    `);
  }
}

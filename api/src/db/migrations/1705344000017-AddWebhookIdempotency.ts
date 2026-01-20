import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Security: Add webhook_deliveries table for idempotency
 * Prevents duplicate webhook processing (e.g., Jira retries, network issues)
 */
export class AddWebhookIdempotency1705344000017 implements MigrationInterface {
  name = "AddWebhookIdempotency1705344000017";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create webhook_deliveries table for tracking processed webhooks
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        delivery_id VARCHAR(255) NOT NULL,
        source VARCHAR(50) NOT NULL,
        event_type VARCHAR(100),
        org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        payload_hash VARCHAR(64),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(delivery_id, source)
      )
    `);

    // Index for fast lookups by delivery_id + source (most common query)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_lookup
      ON webhook_deliveries(delivery_id, source)
    `);

    // Index for cleanup queries (delete old deliveries)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created_at
      ON webhook_deliveries(created_at)
    `);

    // Partial index for org-specific lookups
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_org
      ON webhook_deliveries(org_id, created_at DESC)
      WHERE org_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_webhook_deliveries_org`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_webhook_deliveries_created_at`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_webhook_deliveries_lookup`);
    await queryRunner.query(`DROP TABLE IF EXISTS webhook_deliveries`);
  }
}

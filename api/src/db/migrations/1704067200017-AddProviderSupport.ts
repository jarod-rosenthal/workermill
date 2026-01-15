import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Migration: Add Multi-Provider Support
 *
 * Adds columns to support multiple AI providers:
 * - worker_tasks.worker_provider: Which provider executed the task
 * - organizations.primary_provider: Default provider for the org
 * - organizations.provider_settings: JSON settings per provider
 */
export class AddProviderSupport1704067200017 implements MigrationInterface {
  name = "AddProviderSupport1704067200017";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add worker_provider column to worker_tasks table
    // Default to 'anthropic' for backward compatibility
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS worker_provider VARCHAR(50) NOT NULL DEFAULT 'anthropic'
    `);

    // Add primary_provider column to organizations table
    // Default to 'anthropic' for backward compatibility
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS primary_provider VARCHAR(50) NOT NULL DEFAULT 'anthropic'
    `);

    // Add provider_settings column to organizations table
    // Stores per-provider configuration as JSON
    // Structure: { "openai": { "configured": true }, "google": { "configured": false } }
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS provider_settings JSONB NOT NULL DEFAULT '{}'
    `);

    // Create index on worker_provider for efficient filtering
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_tasks_provider
      ON worker_tasks(worker_provider)
    `);

    // Create index on primary_provider for organizations
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_organizations_primary_provider
      ON organizations(primary_provider)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes first
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_organizations_primary_provider
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_worker_tasks_provider
    `);

    // Drop columns from organizations
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS provider_settings
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS primary_provider
    `);

    // Drop column from worker_tasks
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      DROP COLUMN IF EXISTS worker_provider
    `);
  }
}

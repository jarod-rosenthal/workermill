import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Migration: Add SCM Provider Support
 *
 * Adds columns to support multiple SCM providers (GitHub, GitLab, BitBucket):
 * - organizations.scm_provider: Default SCM provider for the org
 * - organizations.scm_base_url: Base URL for self-hosted instances
 * - organizations.gitlab_webhook_secret: Webhook secret for GitLab
 * - organizations.bitbucket_webhook_secret: Webhook secret for BitBucket
 * - worker_tasks.scm_provider: SCM provider used for this task
 */
export class AddScmProviderSupport1705344000040 implements MigrationInterface {
  name = "AddScmProviderSupport1705344000040";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add scm_provider to organizations (default: github for backwards compatibility)
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS scm_provider VARCHAR(20) DEFAULT 'github'
    `);

    // Add scm_base_url for self-hosted GitLab/BitBucket instances
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS scm_base_url VARCHAR(500) NULL
    `);

    // Add GitLab webhook secret
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS gitlab_webhook_secret VARCHAR(255) NULL
    `);

    // Add BitBucket webhook secret
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS bitbucket_webhook_secret VARCHAR(255) NULL
    `);

    // Add scm_provider to worker_tasks (inherits from org, but stored for audit trail)
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS scm_provider VARCHAR(20) DEFAULT 'github'
    `);

    // Create index for filtering tasks by SCM provider
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_tasks_scm_provider
      ON worker_tasks(scm_provider)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop index
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_worker_tasks_scm_provider
    `);

    // Remove columns from worker_tasks
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      DROP COLUMN IF EXISTS scm_provider
    `);

    // Remove columns from organizations
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS bitbucket_webhook_secret
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS gitlab_webhook_secret
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS scm_base_url
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS scm_provider
    `);
  }
}

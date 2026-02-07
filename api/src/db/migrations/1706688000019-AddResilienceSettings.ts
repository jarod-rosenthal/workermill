import { MigrationInterface, QueryRunner } from "typeorm";

export class AddResilienceSettings1706688000019 implements MigrationInterface {
  name = "AddResilienceSettings1706688000019";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add resilience settings columns to organizations table
    // These control Epic mode checkpoint/recovery and blocker handling behavior
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS blocker_max_auto_retries INTEGER DEFAULT 3,
      ADD COLUMN IF NOT EXISTS blocker_auto_retry_enabled BOOLEAN DEFAULT true,
      ADD COLUMN IF NOT EXISTS push_after_commit BOOLEAN DEFAULT true,
      ADD COLUMN IF NOT EXISTS graceful_shutdown_enabled BOOLEAN DEFAULT true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS blocker_max_auto_retries,
      DROP COLUMN IF EXISTS blocker_auto_retry_enabled,
      DROP COLUMN IF EXISTS push_after_commit,
      DROP COLUMN IF EXISTS graceful_shutdown_enabled
    `);
  }
}

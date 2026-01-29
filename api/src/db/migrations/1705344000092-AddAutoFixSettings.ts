import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add auto-fix settings to organizations table.
 * Enables automatic fixing of quality gate failures (lint, type errors, etc.)
 */
export class AddAutoFixSettings1705344000092 implements MigrationInterface {
  name = "AddAutoFixSettings1705344000092";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable/disable auto-fix on quality gate failure
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS auto_fix_enabled BOOLEAN DEFAULT false
    `);

    // Maximum number of auto-fix iterations before giving up
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS auto_fix_max_iterations INT DEFAULT 3
    `);

    // Track fix success rates per organization (JSONB for flexibility)
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS auto_fix_stats JSONB DEFAULT '{}'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS auto_fix_enabled
    `);
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS auto_fix_max_iterations
    `);
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS auto_fix_stats
    `);
  }
}

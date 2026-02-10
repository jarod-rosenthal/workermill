import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add repositories JSONB array to organizations table.
 * Stores list of "owner/repo" strings for multi-repo workflows.
 */
export class AddRepositoriesList1706688000034 implements MigrationInterface {
  name = "AddRepositoriesList1706688000034";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS repositories JSONB DEFAULT '[]'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS repositories
    `);
  }
}

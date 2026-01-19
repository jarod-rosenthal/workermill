import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDryRunVisibilityMinutes1705344000016
  implements MigrationInterface
{
  name = "AddDryRunVisibilityMinutes1705344000016";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add dry_run_visibility_minutes column with default of 1 minute
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS dry_run_visibility_minutes INTEGER DEFAULT 1
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS dry_run_visibility_minutes
    `);
  }
}

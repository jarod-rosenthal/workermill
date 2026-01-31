import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPlatformOrgFlag1705344000200 implements MigrationInterface {
  name = "AddPlatformOrgFlag1705344000200";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add is_platform_org column to organizations
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS is_platform_org BOOLEAN NOT NULL DEFAULT false
    `);

    // Create unique partial index to ensure only one platform org exists
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_single_platform
      ON organizations (is_platform_org)
      WHERE is_platform_org = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_organizations_single_platform
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS is_platform_org
    `);
  }
}

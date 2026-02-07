import { MigrationInterface, QueryRunner } from "typeorm";

export class AddFeatureFlagsToOrganization1706688000018 implements MigrationInterface {
  name = "AddFeatureFlagsToOrganization1706688000018";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add feature_flags JSONB column to organizations table
    // Stores feature flag settings per organization for gradual feature rollout
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS feature_flags JSONB DEFAULT '{}'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS feature_flags
    `);
  }
}

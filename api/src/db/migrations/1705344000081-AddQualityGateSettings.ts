import { MigrationInterface, QueryRunner } from "typeorm";

export class AddQualityGateSettings1705344000081 implements MigrationInterface {
  name = "AddQualityGateSettings1705344000081";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add quality gate settings columns to organizations table
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS quality_gate_enabled BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS min_quality_score INTEGER,
      ADD COLUMN IF NOT EXISTS min_test_coverage_percent INTEGER,
      ADD COLUMN IF NOT EXISTS max_security_high_vulns INTEGER,
      ADD COLUMN IF NOT EXISTS block_on_type_errors BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS block_on_test_failures BOOLEAN DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS quality_gate_enabled,
      DROP COLUMN IF EXISTS min_quality_score,
      DROP COLUMN IF EXISTS min_test_coverage_percent,
      DROP COLUMN IF EXISTS max_security_high_vulns,
      DROP COLUMN IF EXISTS block_on_type_errors,
      DROP COLUMN IF EXISTS block_on_test_failures
    `);
  }
}

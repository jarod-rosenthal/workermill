import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDependencyAuditorSetting1705344000023 implements MigrationInterface {
  name = "AddDependencyAuditorSetting1705344000023";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add enable_dependency_auditor column to organizations table
    // Default is false (opt-in feature for safe rollout)
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS enable_dependency_auditor BOOLEAN DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS enable_dependency_auditor
    `);
  }
}

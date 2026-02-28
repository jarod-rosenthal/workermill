import { MigrationInterface, QueryRunner } from "typeorm";

export class RemoveOrgQualityGateColumns1741700000000 implements MigrationInterface {
  name = "RemoveOrgQualityGateColumns1741700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Remove org-level quality gate columns that were incorrectly added.
    // Quality gates belong on the board (epic), not the org.
    await queryRunner.query(`
      ALTER TABLE organizations
        DROP COLUMN IF EXISTS quality_gate_commands,
        DROP COLUMN IF EXISTS ci_workflow_path;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS quality_gate_commands jsonb DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS ci_workflow_path varchar(500) DEFAULT NULL;
    `);
  }
}

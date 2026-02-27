import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOrgQualityGateCommands1741600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS quality_gate_commands jsonb DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS ci_workflow_path varchar(500) DEFAULT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS quality_gate_commands,
      DROP COLUMN IF EXISTS ci_workflow_path
    `);
  }
}

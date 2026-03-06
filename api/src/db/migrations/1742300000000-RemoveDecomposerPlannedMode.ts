import { MigrationInterface, QueryRunner } from "typeorm";

export class RemoveDecomposerPlannedMode1742300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Convert all decomposer_planned values to simplified and update default
    await queryRunner.query(`
      UPDATE organizations
        SET prd_planning_mode = 'simplified'
        WHERE prd_planning_mode = 'decomposer_planned';

      ALTER TABLE organizations
        ALTER COLUMN prd_planning_mode SET DEFAULT 'simplified';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
        ALTER COLUMN prd_planning_mode SET DEFAULT 'decomposer_planned';
    `);
  }
}

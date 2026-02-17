import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPlanningMode1739750400001 implements MigrationInterface {
  name = "AddPlanningMode1739750400001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS planning_mode VARCHAR(20) DEFAULT 'strict';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations DROP COLUMN IF EXISTS planning_mode;
    `);
  }
}

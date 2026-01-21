import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPlanningAgentSettings1705344000022 implements MigrationInterface {
  name = "AddPlanningAgentSettings1705344000022";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add planning_agent_model column
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS planning_agent_model VARCHAR(100) DEFAULT 'claude-sonnet-4-5-20250514'
    `);

    // Add story_calibration_multiplier column (the "temperature dial")
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS story_calibration_multiplier DECIMAL(3, 2) DEFAULT 0.4
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS planning_agent_model
    `);
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS story_calibration_multiplier
    `);
  }
}

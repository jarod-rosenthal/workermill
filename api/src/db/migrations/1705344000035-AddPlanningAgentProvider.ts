import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPlanningAgentProvider1705344000035 implements MigrationInterface {
  name = "AddPlanningAgentProvider1705344000035";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add planning agent provider setting
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS planning_agent_provider VARCHAR(50) DEFAULT 'anthropic'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS planning_agent_provider
    `);
  }
}

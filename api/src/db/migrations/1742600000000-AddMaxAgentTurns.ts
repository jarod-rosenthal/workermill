import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMaxAgentTurns1742600000000 implements MigrationInterface {
  name = "AddMaxAgentTurns1742600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS max_agent_turns INT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS max_agent_turns
    `);
  }
}

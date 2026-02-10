import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAgentVersionColumn1706688000033 implements MigrationInterface {
  name = "AddAgentVersionColumn1706688000033";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE remote_agents ADD COLUMN IF NOT EXISTS agent_version VARCHAR(20);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE remote_agents DROP COLUMN IF EXISTS agent_version;
    `);
  }
}

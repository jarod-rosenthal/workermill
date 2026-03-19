import { MigrationInterface, QueryRunner } from "typeorm";

export class AddApiKeyPrefixToRemoteAgents1742900000000 implements MigrationInterface {
  name = "AddApiKeyPrefixToRemoteAgents1742900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE remote_agents
      ADD COLUMN IF NOT EXISTS api_key_prefix VARCHAR(12) DEFAULT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE remote_agents
      DROP COLUMN IF EXISTS api_key_prefix
    `);
  }
}

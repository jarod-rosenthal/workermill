import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRemoteAgentFields1706688000025 implements MigrationInterface {
  name = "AddRemoteAgentFields1706688000025";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Remote agent claim tracking
    await queryRunner.query(`
      ALTER TABLE worker_tasks ADD COLUMN IF NOT EXISTS claimed_by_agent VARCHAR(100) NULL;
    `);

    // Heartbeat for stuck remote-agent task detection
    await queryRunner.query(`
      ALTER TABLE worker_tasks ADD COLUMN IF NOT EXISTS agent_heartbeat_at TIMESTAMPTZ NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS agent_heartbeat_at;`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS claimed_by_agent;`);
  }
}

import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateRemoteAgentsTable1706688000030 implements MigrationInterface {
  name = "CreateRemoteAgentsTable1706688000030";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS remote_agents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id),
        agent_id VARCHAR(100) NOT NULL,
        hostname VARCHAR(255),
        platform VARCHAR(50),
        node_version VARCHAR(20),
        docker_version VARCHAR(50),
        claude_version VARCHAR(50),
        max_workers INT DEFAULT 2,
        active_tasks INT DEFAULT 0,
        status VARCHAR(20) DEFAULT 'online',
        last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(org_id, agent_id)
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS remote_agents;`);
  }
}

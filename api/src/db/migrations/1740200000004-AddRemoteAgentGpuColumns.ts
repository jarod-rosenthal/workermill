import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRemoteAgentGpuColumns1740200000004 implements MigrationInterface {
  name = "AddRemoteAgentGpuColumns1740200000004";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE remote_agents ADD COLUMN IF NOT EXISTS gpu_available BOOLEAN DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE remote_agents ADD COLUMN IF NOT EXISTS gpu_vendor VARCHAR(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE remote_agents ADD COLUMN IF NOT EXISTS local_rag_enabled BOOLEAN DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE remote_agents ADD COLUMN IF NOT EXISTS ollama_running BOOLEAN DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE remote_agents DROP COLUMN IF EXISTS ollama_running`,
    );
    await queryRunner.query(
      `ALTER TABLE remote_agents DROP COLUMN IF EXISTS local_rag_enabled`,
    );
    await queryRunner.query(
      `ALTER TABLE remote_agents DROP COLUMN IF EXISTS gpu_vendor`,
    );
    await queryRunner.query(
      `ALTER TABLE remote_agents DROP COLUMN IF EXISTS gpu_available`,
    );
  }
}

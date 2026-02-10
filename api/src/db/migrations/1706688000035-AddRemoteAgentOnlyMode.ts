import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Migration: Add Remote Agent Only Mode
 *
 * Adds organizations.remote_agent_only: When true, the cloud orchestrator
 * will NEVER pick up tasks for this org — only remote agents can execute them.
 * This prevents ECS fallback when a remote agent crashes (heartbeat goes stale).
 *
 * Default: false (preserves existing ECS fallback behavior).
 */
export class AddRemoteAgentOnlyMode1706688000035 implements MigrationInterface {
  name = "AddRemoteAgentOnlyMode1706688000035";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS remote_agent_only BOOLEAN NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS remote_agent_only
    `);
  }
}

import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWarmContainerPool1705344000062 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create warm_containers table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS warm_containers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        ecs_task_arn VARCHAR(500) NOT NULL,
        ecs_task_id VARCHAR(100) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'warming',
        assigned_task_id UUID REFERENCES worker_tasks(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        ready_at TIMESTAMP,
        assigned_at TIMESTAMP,
        heartbeat_at TIMESTAMP,
        task_environment JSONB
      )
    `);

    // Create index for efficient lookups by org and status
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_warm_containers_org_status
      ON warm_containers(org_id, status)
    `);

    // Add warm pool settings to organizations table
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS warm_pool_size INT DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS warm_pool_hours_start INT DEFAULT 9
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS warm_pool_hours_end INT DEFAULT 18
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS warm_pool_timezone VARCHAR(50) DEFAULT 'America/New_York'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop warm pool columns from organizations
    await queryRunner.query(`
      ALTER TABLE organizations DROP COLUMN IF EXISTS warm_pool_size
    `);
    await queryRunner.query(`
      ALTER TABLE organizations DROP COLUMN IF EXISTS warm_pool_hours_start
    `);
    await queryRunner.query(`
      ALTER TABLE organizations DROP COLUMN IF EXISTS warm_pool_hours_end
    `);
    await queryRunner.query(`
      ALTER TABLE organizations DROP COLUMN IF EXISTS warm_pool_timezone
    `);

    // Drop index and table
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_warm_containers_org_status
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS warm_containers
    `);
  }
}

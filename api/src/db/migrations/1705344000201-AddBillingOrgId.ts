import { MigrationInterface, QueryRunner } from "typeorm";

export class AddBillingOrgId1705344000201 implements MigrationInterface {
  name = "AddBillingOrgId1705344000201";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add billing_org_id column to worker_tasks
    // This allows tasks to bill to a different org (e.g., platform org for support tasks)
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS billing_org_id UUID REFERENCES organizations(id) ON DELETE SET NULL
    `);

    // Add is_platform_task flag for easy filtering
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS is_platform_task BOOLEAN NOT NULL DEFAULT false
    `);

    // Create indexes for efficient queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_tasks_billing_org
      ON worker_tasks (billing_org_id) WHERE billing_org_id IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_tasks_platform
      ON worker_tasks (is_platform_task) WHERE is_platform_task = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_worker_tasks_platform
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_worker_tasks_billing_org
    `);

    await queryRunner.query(`
      ALTER TABLE worker_tasks
      DROP COLUMN IF EXISTS is_platform_task
    `);

    await queryRunner.query(`
      ALTER TABLE worker_tasks
      DROP COLUMN IF EXISTS billing_org_id
    `);
  }
}

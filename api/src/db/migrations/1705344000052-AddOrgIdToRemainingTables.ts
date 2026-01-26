import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Migration: Add orgId to Remaining Tables
 *
 * Adds org_id column to tables that were missing it for proper multi-tenant isolation:
 * - worker_task_errors (only had task_id)
 * - board_columns (only had project_id)
 *
 * Backfills org_id from related parent tables.
 */
export class AddOrgIdToRemainingTables1705344000052 implements MigrationInterface {
  name = "AddOrgIdToRemainingTables1705344000052";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add org_id to worker_task_errors
    await queryRunner.query(`
      ALTER TABLE worker_task_errors
      ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE
    `);

    // Backfill org_id from parent task
    await queryRunner.query(`
      UPDATE worker_task_errors wte
      SET org_id = (
        SELECT wt.org_id
        FROM worker_tasks wt
        WHERE wt.id = wte.task_id
      )
      WHERE wte.org_id IS NULL
    `);

    // Create index for org isolation queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_task_errors_org_id
      ON worker_task_errors(org_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_task_errors_org_created
      ON worker_task_errors(org_id, created_at)
    `);

    // Add org_id to board_columns
    await queryRunner.query(`
      ALTER TABLE board_columns
      ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE
    `);

    // Backfill org_id from parent project
    await queryRunner.query(`
      UPDATE board_columns bc
      SET org_id = (
        SELECT p.org_id
        FROM projects p
        WHERE p.id = bc.project_id
      )
      WHERE bc.org_id IS NULL
    `);

    // Create index for org isolation queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_board_columns_org_id
      ON board_columns(org_id)
    `);

    // Add org_id index to webhook_deliveries if it exists
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'webhook_deliveries'
        ) THEN
          -- Add org_id column if it doesn't exist
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'webhook_deliveries' AND column_name = 'org_id'
          ) THEN
            ALTER TABLE webhook_deliveries ADD COLUMN org_id UUID;
          END IF;

          -- Create index
          CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_org_id
          ON webhook_deliveries(org_id);
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop webhook_deliveries index and column
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_webhook_deliveries_org_id
    `);

    // Drop board_columns index and column
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_board_columns_org_id
    `);

    await queryRunner.query(`
      ALTER TABLE board_columns
      DROP COLUMN IF EXISTS org_id
    `);

    // Drop worker_task_errors indexes and column
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_worker_task_errors_org_created
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_worker_task_errors_org_id
    `);

    await queryRunner.query(`
      ALTER TABLE worker_task_errors
      DROP COLUMN IF EXISTS org_id
    `);
  }
}

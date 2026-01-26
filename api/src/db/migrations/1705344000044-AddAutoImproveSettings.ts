import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Migration: Add Auto Improve Settings
 *
 * Adds auto-improve functionality:
 * - organizations.auto_improve_enabled: When true, run improvement analysis after tasks complete
 * - worker_tasks.improvement_enabled: Per-task flag (from 'improve' label or org setting)
 *
 * When enabled, the system analyzes completed tasks and auto-applies improvements
 * to the WorkerMill codebase (Dockerfile, directives, code patterns).
 */
export class AddAutoImproveSettings1705344000044 implements MigrationInterface {
  name = "AddAutoImproveSettings1705344000044";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add auto_improve_enabled to organizations (default: false for backwards compatibility)
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS auto_improve_enabled BOOLEAN NOT NULL DEFAULT false
    `);

    // Add improvement_enabled to worker_tasks (per-task flag from label or org setting)
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS improvement_enabled BOOLEAN NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      DROP COLUMN IF EXISTS improvement_enabled
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS auto_improve_enabled
    `);
  }
}

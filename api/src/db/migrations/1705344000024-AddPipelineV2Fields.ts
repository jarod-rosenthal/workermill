import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add Pipeline V2 fields for vertical slice sequential execution.
 *
 * These fields support the new V2 pipeline model:
 * - Sequential execution with persona hot-swap per step
 * - Git commit history as state machine
 * - Context sidecar for learned constraints
 * - Smart rewind on failure
 */
export class AddPipelineV2Fields1705344000024 implements MigrationInterface {
  name = "AddPipelineV2Fields1705344000024";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Pipeline version flag (v1 or v2)
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS pipeline_version VARCHAR(10) DEFAULT NULL
    `);

    // V2 execution plan with ordered atomic steps
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS execution_plan_v2 JSONB DEFAULT NULL
    `);

    // Current step index being executed (0-based)
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS current_step_index INT DEFAULT 0
    `);

    // Context sidecar - learned constraints outside of git
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS context_sidecar JSONB DEFAULT '[]'::jsonb
    `);

    // Commit history - records successful step commits for rewind support
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS commit_history JSONB DEFAULT '[]'::jsonb
    `);

    // Retry count for current step
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS current_step_retry_count INT DEFAULT 0
    `);

    // Add index for V2 pipeline queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_tasks_pipeline_v2
      ON worker_tasks (pipeline_version, status)
      WHERE pipeline_version = 'v2'
    `);

    // Add comment for documentation
    await queryRunner.query(`
      COMMENT ON COLUMN worker_tasks.pipeline_version IS 'Pipeline version: v1 (theme-based parallel) or v2 (vertical slice sequential)'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN worker_tasks.execution_plan_v2 IS 'V2 execution plan with ordered atomic steps'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN worker_tasks.context_sidecar IS 'Learned constraints outside of git, persists across rewinds'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN worker_tasks.commit_history IS 'History of successful step commits for rewind support'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_worker_tasks_pipeline_v2
    `);
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      DROP COLUMN IF EXISTS current_step_retry_count
    `);
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      DROP COLUMN IF EXISTS commit_history
    `);
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      DROP COLUMN IF EXISTS context_sidecar
    `);
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      DROP COLUMN IF EXISTS current_step_index
    `);
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      DROP COLUMN IF EXISTS execution_plan_v2
    `);
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      DROP COLUMN IF EXISTS pipeline_version
    `);
  }
}

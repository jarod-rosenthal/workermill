import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Create worker_task_errors table for persisting parsed errors/warnings.
 *
 * Errors survive worker restarts and client re-initialization.
 * Cascade deletes with the parent task.
 */
export class AddWorkerTaskErrors1705344000041 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS worker_task_errors (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id UUID NOT NULL REFERENCES worker_tasks(id) ON DELETE CASCADE,
        timestamp BIGINT NOT NULL,
        type VARCHAR(20) NOT NULL CHECK (type IN ('error', 'warning')),
        category VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        file VARCHAR(500),
        line INT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Index for efficient querying by task and timestamp
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_task_errors_task_timestamp
      ON worker_task_errors(task_id, timestamp);
    `);

    // Index for filtering by type (error vs warning)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_task_errors_task_type
      ON worker_task_errors(task_id, type);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_worker_task_errors_task_type;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_worker_task_errors_task_timestamp;`);
    await queryRunner.query(`DROP TABLE IF EXISTS worker_task_errors;`);
  }
}

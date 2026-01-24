import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Drop the problematic idx_worker_tasks_multi_persona index.
 *
 * The btree index on subtasks_json JSONB column fails when the JSON payload
 * exceeds ~2704 bytes (btree row size limit). This happens with V2 pipeline
 * plans that have multiple steps.
 *
 * The index wasn't useful anyway - btree can't efficiently search JSONB content.
 * If we need to query tasks with subtasks, we should use a boolean flag or
 * a functional index on (subtasks_json IS NOT NULL).
 */
export class DropSubtasksJsonIndex1705344000031 implements MigrationInterface {
  name = "DropSubtasksJsonIndex1705344000031";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the problematic btree index on JSONB column
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_worker_tasks_multi_persona
    `);

    // Add a more efficient partial index using a boolean expression
    // This just indexes the existence, not the content
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_tasks_has_subtasks
      ON worker_tasks ((subtasks_json IS NOT NULL))
      WHERE subtasks_json IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_worker_tasks_has_subtasks
    `);

    // Restore original index (may fail on large data)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_tasks_multi_persona
      ON worker_tasks (subtasks_json)
      WHERE subtasks_json IS NOT NULL
    `);
  }
}

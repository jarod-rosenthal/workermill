import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add Multi-Persona Single Container fields.
 *
 * These fields support executing multiple subtasks with different personas
 * in a SINGLE ECS container, reducing startup overhead from N containers (~30s each)
 * to 1 container (~30s total).
 *
 * Design:
 * - subtasks_json: JSON array of SubtaskDefinition passed via env var
 * - current_subtask_index: Tracks which subtask is currently executing
 * - subtask_results: Results from each completed subtask
 * - multi_persona_enabled: Org setting to enable the feature
 */
export class AddMultiPersonaFields1705344000025 implements MigrationInterface {
  name = "AddMultiPersonaFields1705344000025";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add subtasks JSON array to worker_tasks
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS subtasks_json JSONB DEFAULT NULL
    `);

    // Track current subtask being executed (0-based index)
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS current_subtask_index INT DEFAULT 0
    `);

    // Store results from each completed subtask
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS subtask_results JSONB DEFAULT NULL
    `);

    // Enable multi-persona mode per organization
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS multi_persona_enabled BOOLEAN DEFAULT FALSE
    `);

    // Add index for multi-persona task queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_tasks_multi_persona
      ON worker_tasks (subtasks_json)
      WHERE subtasks_json IS NOT NULL
    `);

    // Add documentation comments
    await queryRunner.query(`
      COMMENT ON COLUMN worker_tasks.subtasks_json IS 'JSON array of SubtaskDefinition for multi-persona execution'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN worker_tasks.current_subtask_index IS 'Current subtask index being executed (0-based)'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN worker_tasks.subtask_results IS 'Array of SubtaskResult from completed subtasks'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN organizations.multi_persona_enabled IS 'Enable multi-persona single container execution'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_worker_tasks_multi_persona
    `);
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS multi_persona_enabled
    `);
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      DROP COLUMN IF EXISTS subtask_results
    `);
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      DROP COLUMN IF EXISTS current_subtask_index
    `);
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      DROP COLUMN IF EXISTS subtasks_json
    `);
  }
}

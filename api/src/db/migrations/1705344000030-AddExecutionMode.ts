import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add execution_mode and critic_enabled fields for Epic mode multi-agent collaboration.
 *
 * Execution modes:
 * - single: Default single-task execution
 * - sequential: V2 pipeline (one persona at a time)
 * - parallel: Epic mode (all experts simultaneously)
 *
 * Critic enabled:
 * - false (default): Skip Planner-Critic validation
 * - true: Run Planner-Critic validation loop (set via "critic" Jira label)
 */
export class AddExecutionMode1705344000030 implements MigrationInterface {
  name = "AddExecutionMode1705344000030";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Execution mode: single, sequential, or parallel
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS execution_mode VARCHAR(20) DEFAULT 'single'
    `);

    // Critic enabled: controls Planner-Critic validation phase
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS critic_enabled BOOLEAN DEFAULT false
    `);

    // Add index for querying Epic mode tasks
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_tasks_execution_mode
      ON worker_tasks (execution_mode, status)
      WHERE execution_mode = 'parallel'
    `);

    // Add comments for documentation
    await queryRunner.query(`
      COMMENT ON COLUMN worker_tasks.execution_mode IS 'Execution mode: single (default), sequential (V2 pipeline), or parallel (Epic mode)'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN worker_tasks.critic_enabled IS 'Whether Planner-Critic validation is enabled (set via critic Jira label)'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_worker_tasks_execution_mode
    `);
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      DROP COLUMN IF EXISTS critic_enabled
    `);
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      DROP COLUMN IF EXISTS execution_mode
    `);
  }
}

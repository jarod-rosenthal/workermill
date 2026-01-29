import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Create worker_task_token_usage table for phase-level token tracking.
 * Supports FinOps analytics by tracking tokens per phase, persona, model, and provider.
 */
export class CreateWorkerTaskTokenUsage1705344000074 implements MigrationInterface {
  name = "CreateWorkerTaskTokenUsage1705344000074";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the token usage table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS worker_task_token_usage (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id UUID NOT NULL REFERENCES worker_tasks(id) ON DELETE CASCADE,
        phase VARCHAR(50) NOT NULL,
        input_tokens INT NOT NULL DEFAULT 0,
        output_tokens INT NOT NULL DEFAULT 0,
        cache_creation_tokens INT NOT NULL DEFAULT 0,
        cache_read_tokens INT NOT NULL DEFAULT 0,
        model VARCHAR(100),
        provider VARCHAR(50),
        estimated_cost_usd DECIMAL(10, 4) DEFAULT 0,
        story_index INT,
        persona VARCHAR(50),
        operation_type VARCHAR(50),
        duration_seconds INT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create indexes for efficient querying
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_token_usage_task_id
      ON worker_task_token_usage(task_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_token_usage_task_phase
      ON worker_task_token_usage(task_id, phase)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_token_usage_phase
      ON worker_task_token_usage(phase)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_token_usage_created_at
      ON worker_task_token_usage(created_at)
    `);

    // Index for aggregation queries by provider/model
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_token_usage_provider_model
      ON worker_task_token_usage(provider, model)
    `);

    // Index for persona-level analytics
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_token_usage_persona
      ON worker_task_token_usage(persona)
    `);

    // Index for operation type analytics
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_token_usage_operation_type
      ON worker_task_token_usage(operation_type)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_token_usage_operation_type`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_token_usage_persona`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_token_usage_provider_model`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_token_usage_created_at`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_token_usage_phase`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_token_usage_task_phase`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_token_usage_task_id`);
    await queryRunner.query(`DROP TABLE IF EXISTS worker_task_token_usage`);
  }
}

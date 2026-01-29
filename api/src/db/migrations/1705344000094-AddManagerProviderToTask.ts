import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add manager_provider and manager_model columns to worker_tasks table.
 * These track which AI provider/model performed the review phase,
 * enabling consistent provider badge display in the UI.
 */
export class AddManagerProviderToTask1705344000094 implements MigrationInterface {
  name = "AddManagerProviderToTask1705344000094";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add manager_provider column to track which provider did the review
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS manager_provider VARCHAR(50) DEFAULT NULL
    `);

    // Add manager_model column to track which model did the review
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS manager_model VARCHAR(100) DEFAULT NULL
    `);

    // Add comment for documentation
    await queryRunner.query(`
      COMMENT ON COLUMN worker_tasks.manager_provider IS 'AI provider used for manager/review phase (anthropic, openai, google, ollama)'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN worker_tasks.manager_model IS 'AI model used for manager/review phase (e.g., gpt-5.1-codex, claude-sonnet-4)'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      DROP COLUMN IF EXISTS manager_model
    `);
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      DROP COLUMN IF EXISTS manager_provider
    `);
  }
}

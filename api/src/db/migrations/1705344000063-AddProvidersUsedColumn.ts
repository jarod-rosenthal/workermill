import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProvidersUsedColumn1705344000063 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add providers_used column for multi-provider mode visibility
    // Stores array of AI provider names used in the task (e.g., ["anthropic", "openai", "google"])
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS providers_used JSONB DEFAULT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      DROP COLUMN IF EXISTS providers_used
    `);
  }
}

import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPlanningTokensColumns1705344000067 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add planning token columns for accurate cost tracking
    // Planning phase uses Sonnet 4.5 (different pricing from worker model)
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS planning_input_tokens INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS planning_output_tokens INTEGER DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      DROP COLUMN IF EXISTS planning_input_tokens,
      DROP COLUMN IF EXISTS planning_output_tokens
    `);
  }
}

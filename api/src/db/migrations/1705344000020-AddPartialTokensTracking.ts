import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPartialTokensTracking1705344000020 implements MigrationInterface {
  name = "AddPartialTokensTracking1705344000020";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add column to track partial/incremental token updates
    // This distinguishes between:
    // - No tokens recorded (both null)
    // - Partial tokens received during execution (partial_tokens_updated_at set)
    // - Final tokens reported (usage_reported_at set)
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS partial_tokens_updated_at TIMESTAMP DEFAULT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      DROP COLUMN IF EXISTS partial_tokens_updated_at
    `);
  }
}

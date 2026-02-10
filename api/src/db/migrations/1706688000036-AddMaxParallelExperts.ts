import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Migration: Add Max Parallel Experts
 *
 * Adds organizations.max_parallel_experts: Controls how many expert subagents
 * can run simultaneously within a single task's Epic coordinator.
 *
 * Default: 4 (matches existing behavior where only 2 personas were active).
 */
export class AddMaxParallelExperts1706688000036 implements MigrationInterface {
  name = "AddMaxParallelExperts1706688000036";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS max_parallel_experts INTEGER NOT NULL DEFAULT 4
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS max_parallel_experts
    `);
  }
}

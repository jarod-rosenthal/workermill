import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCostTracking1704067200004 implements MigrationInterface {
  name = "AddCostTracking1704067200004";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add cost tracking columns to worker_tasks
    await queryRunner.query(`
      ALTER TABLE "worker_tasks"
      ADD COLUMN IF NOT EXISTS "cache_creation_tokens" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "worker_tasks"
      ADD COLUMN IF NOT EXISTS "cache_read_tokens" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "worker_tasks"
      ADD COLUMN IF NOT EXISTS "usage_reported_at" timestamp NULL
    `);

    // Add cumulative cost tracking to organizations
    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "cumulative_cost_usd" decimal(12,4) NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "cost_reset_at" timestamp NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "worker_tasks" DROP COLUMN IF EXISTS "cache_creation_tokens"`);
    await queryRunner.query(`ALTER TABLE "worker_tasks" DROP COLUMN IF EXISTS "cache_read_tokens"`);
    await queryRunner.query(`ALTER TABLE "worker_tasks" DROP COLUMN IF EXISTS "usage_reported_at"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "cumulative_cost_usd"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "cost_reset_at"`);
  }
}

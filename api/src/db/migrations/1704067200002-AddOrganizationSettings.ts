import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOrganizationSettings1704067200002 implements MigrationInterface {
  name = "AddOrganizationSettings1704067200002";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add system settings columns to organizations table
    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "system_enabled" boolean NOT NULL DEFAULT true
    `);

    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "watcher_enabled" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "orchestrator_running" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "manager_enabled" boolean NOT NULL DEFAULT true
    `);

    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "manager_model_id" varchar(100) NOT NULL DEFAULT 'claude-sonnet-4-20250514'
    `);

    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "counters_reset_at" timestamp NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "system_enabled"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "watcher_enabled"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "orchestrator_running"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "manager_enabled"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "manager_model_id"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "counters_reset_at"`);
  }
}

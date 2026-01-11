import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWorkflowColumns1704067200005 implements MigrationInterface {
  name = "AddWorkflowColumns1704067200005";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add workflow columns to worker_tasks
    await queryRunner.query(`
      ALTER TABLE "worker_tasks"
      ADD COLUMN IF NOT EXISTS "github_approved_by" varchar(100) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "worker_tasks"
      ADD COLUMN IF NOT EXISTS "deployment_enabled" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "worker_tasks"
      ADD COLUMN IF NOT EXISTS "skip_manager_review" boolean NOT NULL DEFAULT true
    `);
    await queryRunner.query(`
      ALTER TABLE "worker_tasks"
      ADD COLUMN IF NOT EXISTS "task_notes" text NULL
    `);

    // Add GitHub webhook secret to organizations
    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "github_webhook_secret" varchar(255) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "worker_tasks" DROP COLUMN IF EXISTS "github_approved_by"`);
    await queryRunner.query(`ALTER TABLE "worker_tasks" DROP COLUMN IF EXISTS "deployment_enabled"`);
    await queryRunner.query(`ALTER TABLE "worker_tasks" DROP COLUMN IF EXISTS "skip_manager_review"`);
    await queryRunner.query(`ALTER TABLE "worker_tasks" DROP COLUMN IF EXISTS "task_notes"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "github_webhook_secret"`);
  }
}

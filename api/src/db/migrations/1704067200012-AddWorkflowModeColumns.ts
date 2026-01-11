import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWorkflowModeColumns1704067200012 implements MigrationInterface {
  name = "AddWorkflowModeColumns1704067200012";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add manager_enabled flag for 'manager' label workflow
    await queryRunner.query(`
      ALTER TABLE "worker_tasks"
      ADD COLUMN IF NOT EXISTS "manager_enabled" boolean NOT NULL DEFAULT false
    `);

    // Add revision tracking for review workflow
    await queryRunner.query(`
      ALTER TABLE "worker_tasks"
      ADD COLUMN IF NOT EXISTS "revision_count" integer NOT NULL DEFAULT 0
    `);

    // Add review feedback storage
    await queryRunner.query(`
      ALTER TABLE "worker_tasks"
      ADD COLUMN IF NOT EXISTS "review_feedback" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "worker_tasks" DROP COLUMN IF EXISTS "review_feedback"`);
    await queryRunner.query(`ALTER TABLE "worker_tasks" DROP COLUMN IF EXISTS "revision_count"`);
    await queryRunner.query(`ALTER TABLE "worker_tasks" DROP COLUMN IF EXISTS "manager_enabled"`);
  }
}

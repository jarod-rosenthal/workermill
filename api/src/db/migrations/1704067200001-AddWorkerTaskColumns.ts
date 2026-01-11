import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWorkerTaskColumns1704067200001 implements MigrationInterface {
  name = "AddWorkerTaskColumns1704067200001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add missing columns to worker_tasks
    await queryRunner.query(`
      ALTER TABLE "worker_tasks"
      ADD COLUMN IF NOT EXISTS "jira_issue_id" VARCHAR(50),
      ADD COLUMN IF NOT EXISTS "jira_fields" JSONB DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS "priority" INTEGER DEFAULT 3,
      ADD COLUMN IF NOT EXISTS "github_branch" VARCHAR(255),
      ADD COLUMN IF NOT EXISTS "github_pr_number" INTEGER,
      ADD COLUMN IF NOT EXISTS "github_pr_url" VARCHAR(500),
      ADD COLUMN IF NOT EXISTS "last_heartbeat_at" TIMESTAMP WITH TIME ZONE
    `);

    // Rename columns to match entity
    await queryRunner.query(`
      ALTER TABLE "worker_tasks"
      RENAME COLUMN "tokens_input" TO "input_tokens"
    `);

    await queryRunner.query(`
      ALTER TABLE "worker_tasks"
      RENAME COLUMN "tokens_output" TO "output_tokens"
    `);

    await queryRunner.query(`
      ALTER TABLE "worker_tasks"
      RENAME COLUMN "duration_seconds" TO "ecs_task_seconds"
    `);

    await queryRunner.query(`
      ALTER TABLE "worker_tasks"
      RENAME COLUMN "estimated_cost" TO "estimated_cost_usd"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert column renames
    await queryRunner.query(`
      ALTER TABLE "worker_tasks"
      RENAME COLUMN "input_tokens" TO "tokens_input"
    `);

    await queryRunner.query(`
      ALTER TABLE "worker_tasks"
      RENAME COLUMN "output_tokens" TO "tokens_output"
    `);

    await queryRunner.query(`
      ALTER TABLE "worker_tasks"
      RENAME COLUMN "ecs_task_seconds" TO "duration_seconds"
    `);

    await queryRunner.query(`
      ALTER TABLE "worker_tasks"
      RENAME COLUMN "estimated_cost_usd" TO "estimated_cost"
    `);

    // Drop added columns
    await queryRunner.query(`
      ALTER TABLE "worker_tasks"
      DROP COLUMN IF EXISTS "jira_issue_id",
      DROP COLUMN IF EXISTS "jira_fields",
      DROP COLUMN IF EXISTS "priority",
      DROP COLUMN IF EXISTS "github_branch",
      DROP COLUMN IF EXISTS "github_pr_number",
      DROP COLUMN IF EXISTS "github_pr_url",
      DROP COLUMN IF EXISTS "last_heartbeat_at"
    `);
  }
}

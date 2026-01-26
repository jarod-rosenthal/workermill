import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds Epic execution fields to Project and status field to InternalTask
 * for system-controlled Kanban boards.
 *
 * Project additions:
 * - worker_task_id: Reference to parent WorkerTask when epic is running
 * - execution_status: Track epic execution state (idle/running/completed/failed)
 * - github_branch: Feature branch for the epic
 * - github_pr_url: Consolidated PR URL
 *
 * InternalTask additions:
 * - status: System-controlled status that drives column assignment
 * - story_index: Index for ordering stories within epic
 */
export class AddEpicExecutionFields1705344000057 implements MigrationInterface {
  name = "AddEpicExecutionFields1705344000057";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add execution fields to projects table
    await queryRunner.query(`
      ALTER TABLE "projects"
      ADD COLUMN IF NOT EXISTS "worker_task_id" UUID NULL,
      ADD COLUMN IF NOT EXISTS "execution_status" VARCHAR(20) DEFAULT 'idle',
      ADD COLUMN IF NOT EXISTS "github_branch" VARCHAR(255) NULL,
      ADD COLUMN IF NOT EXISTS "github_pr_url" VARCHAR(500) NULL
    `);

    // Add foreign key for worker_task_id
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'FK_projects_worker_task'
          AND table_name = 'projects'
        ) THEN
          ALTER TABLE "projects"
          ADD CONSTRAINT "FK_projects_worker_task"
          FOREIGN KEY ("worker_task_id") REFERENCES "worker_tasks"("id")
          ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // Add status and story_index fields to internal_tasks table
    await queryRunner.query(`
      ALTER TABLE "internal_tasks"
      ADD COLUMN IF NOT EXISTS "status" VARCHAR(20) DEFAULT 'draft',
      ADD COLUMN IF NOT EXISTS "story_index" INT NULL
    `);

    // Create index on internal_tasks status for efficient queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_internal_tasks_status"
      ON "internal_tasks" ("status")
    `);

    // Create index on internal_tasks story_index for ordering
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_internal_tasks_story_index"
      ON "internal_tasks" ("project_id", "story_index")
      WHERE "story_index" IS NOT NULL
    `);

    // Create index on projects execution_status for queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_projects_execution_status"
      ON "projects" ("execution_status")
      WHERE "execution_status" != 'idle'
    `);

    // Update existing internal_tasks to set appropriate status based on column_type
    // Tasks in 'ready' columns get 'ready' status, others get 'draft'
    await queryRunner.query(`
      UPDATE "internal_tasks" it
      SET "status" = CASE
        WHEN bc."column_type" = 'done' THEN 'completed'
        WHEN bc."column_type" = 'review' THEN 'review'
        WHEN bc."column_type" = 'in_progress' THEN 'executing'
        WHEN bc."column_type" = 'ready' THEN 'ready'
        ELSE 'draft'
      END
      FROM "board_columns" bc
      WHERE it."column_id" = bc."id"
      AND it."status" = 'draft'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove indexes
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_projects_execution_status"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_internal_tasks_story_index"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_internal_tasks_status"
    `);

    // Remove foreign key
    await queryRunner.query(`
      ALTER TABLE "projects"
      DROP CONSTRAINT IF EXISTS "FK_projects_worker_task"
    `);

    // Remove columns from internal_tasks
    await queryRunner.query(`
      ALTER TABLE "internal_tasks"
      DROP COLUMN IF EXISTS "status",
      DROP COLUMN IF EXISTS "story_index"
    `);

    // Remove columns from projects
    await queryRunner.query(`
      ALTER TABLE "projects"
      DROP COLUMN IF EXISTS "worker_task_id",
      DROP COLUMN IF EXISTS "execution_status",
      DROP COLUMN IF EXISTS "github_branch",
      DROP COLUMN IF EXISTS "github_pr_url"
    `);
  }
}

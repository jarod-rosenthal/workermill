import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCostFirstSettings1705344000015 implements MigrationInterface {
  name = "AddCostFirstSettings1705344000015";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add cost-first model control settings to organizations
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS allow_sonnet BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS allow_opus BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS max_story_points INTEGER NOT NULL DEFAULT 3
    `);

    // Add story points and target files to worker_tasks
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS story_points INTEGER,
      ADD COLUMN IF NOT EXISTS target_files JSONB,
      ADD COLUMN IF NOT EXISTS reference_files JSONB
    `);

    // Index for filtering by story points
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_tasks_story_points
      ON worker_tasks(story_points)
      WHERE story_points IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_worker_tasks_story_points
    `);

    await queryRunner.query(`
      ALTER TABLE worker_tasks
      DROP COLUMN IF EXISTS story_points,
      DROP COLUMN IF EXISTS target_files,
      DROP COLUMN IF EXISTS reference_files
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS allow_sonnet,
      DROP COLUMN IF EXISTS allow_opus,
      DROP COLUMN IF EXISTS max_story_points
    `);
  }
}

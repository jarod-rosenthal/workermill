import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add archived column to worker_contexts table
 *
 * When a PRD workflow completes, we archive context messages instead of deleting them.
 * This preserves the coordination history for debugging and auditing while
 * ensuring future workflows aren't confused by stale messages.
 */
export class AddContextArchived1705344000014 implements MigrationInterface {
  name = "AddContextArchived1705344000014";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add archived column (default false)
    await queryRunner.query(`
      ALTER TABLE worker_contexts
      ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE
    `);

    // Add archived_at timestamp for when the workflow completed
    await queryRunner.query(`
      ALTER TABLE worker_contexts
      ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL
    `);

    // Create index for efficient filtering of active vs archived messages
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_contexts_archived
      ON worker_contexts (parent_task_id, archived)
      WHERE archived = FALSE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_worker_contexts_archived`);
    await queryRunner.query(`ALTER TABLE worker_contexts DROP COLUMN IF EXISTS archived_at`);
    await queryRunner.query(`ALTER TABLE worker_contexts DROP COLUMN IF EXISTS archived`);
  }
}

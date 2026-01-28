import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add effectiveness tracking fields to worker_tasks table.
 * Enables measurement of AI worker success rates, accuracy metrics, and human review outcomes.
 */
export class AddEffectivenessTracking1705344000064 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add review outcome column (accepted, rejected, partial)
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS review_outcome VARCHAR(20)
    `);

    // Add accuracy score (0-100 scale)
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS accuracy_score INT
    `);

    // Add review notes for free-text feedback
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS review_notes TEXT
    `);

    // Add reviewed_at timestamp
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP
    `);

    // Add reviewed_by (email or user identifier)
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(255)
    `);

    // Add lines_changed for tracking work volume
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS lines_changed INT
    `);

    // Add files_modified for tracking work scope
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS files_modified INT
    `);

    // Index for analytics queries on review_outcome
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_tasks_review_outcome
      ON worker_tasks(review_outcome)
    `);

    // Index for filtering reviewed tasks by date
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_tasks_reviewed_at
      ON worker_tasks(reviewed_at)
      WHERE reviewed_at IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_worker_tasks_reviewed_at`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_worker_tasks_review_outcome`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS files_modified`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS lines_changed`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS reviewed_by`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS reviewed_at`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS review_notes`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS accuracy_score`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS review_outcome`);
  }
}

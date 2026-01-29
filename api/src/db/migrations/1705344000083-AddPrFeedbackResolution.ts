import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add resolution tracking to pr_feedback table.
 * Part of the Agent Memory & Learning System (Phase 3) - REQ-6: Capture Accepted vs Rejected Suggestions.
 *
 * Tracks whether PR suggestions were:
 * - accepted (reviewer's suggestion was applied)
 * - rejected (suggestion was dismissed/not applied)
 * - partially_accepted (suggestion modified and partially applied)
 */
export class AddPrFeedbackResolution1705344000083 implements MigrationInterface {
  name = "AddPrFeedbackResolution1705344000083";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add resolution status column
    await queryRunner.query(`
      ALTER TABLE pr_feedback
      ADD COLUMN IF NOT EXISTS resolution_status VARCHAR(30) DEFAULT 'pending'
    `);

    // Add timestamp when feedback was resolved
    await queryRunner.query(`
      ALTER TABLE pr_feedback
      ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP WITH TIME ZONE
    `);

    // Add commit SHA where suggestion was applied (if accepted)
    await queryRunner.query(`
      ALTER TABLE pr_feedback
      ADD COLUMN IF NOT EXISTS applied_in_commit VARCHAR(40)
    `);

    // Add notes about resolution (e.g., why rejected)
    await queryRunner.query(`
      ALTER TABLE pr_feedback
      ADD COLUMN IF NOT EXISTS resolution_notes TEXT
    `);

    // Index for filtering by resolution status
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_pr_feedback_resolution
      ON pr_feedback(resolution_status)
    `);

    // Index for feedback learning queries (unresolved suggestions needing attention)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_pr_feedback_pending
      ON pr_feedback(org_id, feedback_type, resolution_status)
      WHERE resolution_status = 'pending'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_pr_feedback_pending`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_pr_feedback_resolution`);
    await queryRunner.query(`ALTER TABLE pr_feedback DROP COLUMN IF EXISTS resolution_notes`);
    await queryRunner.query(`ALTER TABLE pr_feedback DROP COLUMN IF EXISTS applied_in_commit`);
    await queryRunner.query(`ALTER TABLE pr_feedback DROP COLUMN IF EXISTS resolved_at`);
    await queryRunner.query(`ALTER TABLE pr_feedback DROP COLUMN IF EXISTS resolution_status`);
  }
}

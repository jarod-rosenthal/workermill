import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Create pr_feedback table for storing PR review comments on AI-generated code.
 * Part of the Agent Memory & Learning System (Phase 3) - Feedback Learning.
 */
export class CreatePrFeedback1705344000082 implements MigrationInterface {
  name = "CreatePrFeedback1705344000082";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS pr_feedback (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        task_id UUID REFERENCES worker_tasks(id) ON DELETE SET NULL,

        -- PR identification
        repository VARCHAR(255) NOT NULL,
        pr_number INT NOT NULL,
        pr_url VARCHAR(500),

        -- Feedback details
        feedback_type VARCHAR(50) NOT NULL,
        source VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,

        -- Location (for inline comments)
        file_path VARCHAR(500),
        line_number INT,
        code_snippet TEXT,

        -- Reviewer info
        reviewer_username VARCHAR(255) NOT NULL,

        -- Status
        is_resolved BOOLEAN DEFAULT FALSE,

        -- External reference
        external_id VARCHAR(100),

        -- Context
        persona VARCHAR(50),
        model VARCHAR(100),

        -- Timestamps
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        external_created_at TIMESTAMP WITH TIME ZONE
      )
    `);

    // Indexes for efficient querying
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_pr_feedback_org_task
      ON pr_feedback(org_id, task_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_pr_feedback_org_repo
      ON pr_feedback(org_id, repository)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_pr_feedback_type
      ON pr_feedback(feedback_type)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_pr_feedback_created
      ON pr_feedback(created_at DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_pr_feedback_external
      ON pr_feedback(source, external_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_pr_feedback_external`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_pr_feedback_created`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_pr_feedback_type`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_pr_feedback_org_repo`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_pr_feedback_org_task`);
    await queryRunner.query(`DROP TABLE IF EXISTS pr_feedback`);
  }
}

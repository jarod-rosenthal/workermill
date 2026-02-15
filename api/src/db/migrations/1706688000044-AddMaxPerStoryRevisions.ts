import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Migration: Add Max Per-Story Revisions
 *
 * Adds organizations.max_per_story_revisions: Controls the maximum number of
 * revision cycles for individual story reviews (per-story tech lead review).
 * Separate from max_review_revisions which controls the consolidated PR review.
 *
 * Default: 2 (reduced from sharing the consolidated review default of 3).
 */
export class AddMaxPerStoryRevisions1706688000044 implements MigrationInterface {
  name = "AddMaxPerStoryRevisions1706688000044";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS max_per_story_revisions INTEGER NOT NULL DEFAULT 2
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS max_per_story_revisions
    `);
  }
}

import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Ralph Execution Settings
 *
 * Adds columns to enable Ralph (structured PRD-to-code execution engine) as an optional
 * execution mode per organization:
 * - use_ralph_execution: boolean flag to enable Ralph execution mode for this org
 * - ralph_max_stories: maximum number of stories Ralph will plan per task
 */
export class AddRalphExecutionSettings1704067200018 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add Ralph execution settings to organizations table
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN use_ralph_execution BOOLEAN NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN ralph_max_stories INTEGER NOT NULL DEFAULT 10
    `);

    // Add index for Ralph-enabled organizations (common query)
    await queryRunner.query(`
      CREATE INDEX idx_orgs_ralph_enabled ON organizations(use_ralph_execution) WHERE use_ralph_execution = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_orgs_ralph_enabled
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN ralph_max_stories
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN use_ralph_execution
    `);
  }
}

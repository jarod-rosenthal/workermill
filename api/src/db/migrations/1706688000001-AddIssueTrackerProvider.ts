import { MigrationInterface, QueryRunner } from "typeorm";

export class AddIssueTrackerProvider1706688000001 implements MigrationInterface {
  name = "AddIssueTrackerProvider1706688000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add issue_tracker_provider column with default "jira" for backwards compatibility
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS issue_tracker_provider VARCHAR(20) NOT NULL DEFAULT 'jira'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS issue_tracker_provider
    `);
  }
}

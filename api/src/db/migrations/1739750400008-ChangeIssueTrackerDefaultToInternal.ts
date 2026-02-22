import { MigrationInterface, QueryRunner } from "typeorm";

export class ChangeIssueTrackerDefaultToInternal1739750400008 implements MigrationInterface {
  name = "ChangeIssueTrackerDefaultToInternal1739750400008";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Change the column default from 'jira' to 'internal'
    await queryRunner.query(
      `ALTER TABLE organizations ALTER COLUMN issue_tracker_provider SET DEFAULT 'internal'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE organizations ALTER COLUMN issue_tracker_provider SET DEFAULT 'jira'`,
    );
  }
}

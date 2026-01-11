import { MigrationInterface, QueryRunner, TableUnique } from "typeorm";

export class CleanupDuplicatesAndAddConstraint1704067200009 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // First, clean up any duplicate tasks - keep only the most recent one per org+jira_issue_key
    // Delete all but the newest task for each org_id + jira_issue_key combination
    await queryRunner.query(`
      DELETE FROM worker_tasks
      WHERE id NOT IN (
        SELECT DISTINCT ON (org_id, jira_issue_key) id
        FROM worker_tasks
        ORDER BY org_id, jira_issue_key, created_at DESC
      )
    `);

    // Check if the constraint already exists (in case previous migration partially succeeded)
    const constraintExists = await queryRunner.query(`
      SELECT 1 FROM pg_constraint WHERE conname = 'UQ_org_jira_issue'
    `);

    if (constraintExists.length === 0) {
      // Add unique constraint to prevent duplicate tasks for the same Jira issue in an org
      await queryRunner.createUniqueConstraint(
        "worker_tasks",
        new TableUnique({
          name: "UQ_org_jira_issue",
          columnNames: ["org_id", "jira_issue_key"],
        })
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only drop if exists
    const constraintExists = await queryRunner.query(`
      SELECT 1 FROM pg_constraint WHERE conname = 'UQ_org_jira_issue'
    `);
    if (constraintExists.length > 0) {
      await queryRunner.dropUniqueConstraint("worker_tasks", "UQ_org_jira_issue");
    }
  }
}

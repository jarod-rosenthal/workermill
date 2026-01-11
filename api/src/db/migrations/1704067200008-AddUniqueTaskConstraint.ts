import { MigrationInterface, QueryRunner, TableUnique } from "typeorm";

export class AddUniqueTaskConstraint1704067200008 implements MigrationInterface {
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

    // Add unique constraint to prevent duplicate tasks for the same Jira issue in an org
    // This handles the case where Jira webhook fires multiple times
    await queryRunner.createUniqueConstraint(
      "worker_tasks",
      new TableUnique({
        name: "UQ_org_jira_issue",
        columnNames: ["org_id", "jira_issue_key"],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropUniqueConstraint("worker_tasks", "UQ_org_jira_issue");
  }
}

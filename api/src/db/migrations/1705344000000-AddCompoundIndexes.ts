import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCompoundIndexes1705344000000 implements MigrationInterface {
  name = 'AddCompoundIndexes1705344000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Orchestrator findQueuedTasks - frequently queries by status + created_at
    await queryRunner.query(`
      CREATE INDEX  IF NOT EXISTS idx_worker_tasks_status_created
      ON worker_tasks(status, created_at)
    `);

    // Control center active tasks - queries by org + status + created_at
    await queryRunner.query(`
      CREATE INDEX  IF NOT EXISTS idx_worker_tasks_org_status_created
      ON worker_tasks(org_id, status, created_at DESC)
    `);

    // Analytics date range queries - org + created_at
    await queryRunner.query(`
      CREATE INDEX  IF NOT EXISTS idx_worker_tasks_org_created
      ON worker_tasks(org_id, created_at DESC)
    `);

    // Log streaming - task_id + created_at
    await queryRunner.query(`
      CREATE INDEX  IF NOT EXISTS idx_worker_task_logs_task_created
      ON worker_task_logs(task_id, created_at)
    `);

    // Jira issue key lookup (commonly used in webhooks)
    await queryRunner.query(`
      CREATE INDEX  IF NOT EXISTS idx_worker_tasks_jira_key
      ON worker_tasks(jira_issue_key) WHERE jira_issue_key IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_worker_tasks_status_created`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_worker_tasks_org_status_created`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_worker_tasks_org_created`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_worker_task_logs_task_created`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_worker_tasks_jira_key`);
  }
}

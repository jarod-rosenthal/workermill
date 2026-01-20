import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Security: Add missing database indexes for performance and security
 * These indexes improve query performance and prevent slow table scans
 * that could be exploited for DoS attacks
 */
export class AddSecurityIndexes1705344000018 implements MigrationInterface {
  name = "AddSecurityIndexes1705344000018";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Index for task status queries (orchestrator polling, dashboard filtering)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_task_status
      ON worker_tasks(status)
    `);

    // Composite index for org-scoped task queries sorted by creation time
    // Critical for dashboard performance and preventing cross-org data leaks
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_task_org_created
      ON worker_tasks(org_id, created_at DESC)
    `);

    // Index for log streaming queries (very frequent during task execution)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_task_log_task_created
      ON worker_task_logs(task_id, created_at DESC)
    `);

    // Index for GitHub PR lookups (webhook handlers)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_task_github_pr
      ON worker_tasks(github_pr_url)
      WHERE github_pr_url IS NOT NULL
    `);

    // Index for GitHub PR number lookups (used in PR approval webhooks)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_task_github_pr_number
      ON worker_tasks(github_pr_number)
      WHERE github_pr_number IS NOT NULL
    `);

    // Index for Jira issue key lookups (frequent during task creation/updates)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_task_jira_key
      ON worker_tasks(jira_issue_key)
    `);

    // Index for parent task lookups (PRD orchestration)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_task_parent
      ON worker_tasks(parent_task_id)
      WHERE parent_task_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_worker_task_parent`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_worker_task_jira_key`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_worker_task_github_pr_number`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_worker_task_github_pr`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_worker_task_log_task_created`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_worker_task_org_created`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_worker_task_status`);
  }
}

import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add indexes to speed up the remote agent poll endpoint.
 *
 * The /api/agent/poll endpoint runs three queries:
 *   1. Stale claim candidates (worker_tasks by org + status + claimed_by_agent)
 *   2. Available tasks (worker_tasks by org + status + plan_status)
 *   3. Manager tasks (worker_tasks by org + status + manager flags)
 *
 * It also batch-fetches remote agents by org + agent_id.
 *
 * Without these indexes, every 5-second poll from every agent does full table scans,
 * which under load exhausts the DB connection pool and causes request timeouts.
 */
export class AddPollPerformanceIndexes1740600000000
  implements MigrationInterface
{
  name = "AddPollPerformanceIndexes1740600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Index for stale claim + available task queries (covers queries 1 and 2)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_tasks_org_status_claim
      ON worker_tasks (org_id, status, claimed_by_agent)
    `);

    // Index for manager task query (query 3)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_tasks_org_status_manager
      ON worker_tasks (org_id, status, manager_enabled, manager_analysis_done)
    `);

    // Index for batch agent lookups in stale claim logic
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_remote_agents_org_agent
      ON remote_agents (org_id, agent_id)
    `);

    // Index for coordination context queries (SSE + polling)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_contexts_parent_org_created
      ON worker_contexts (parent_task_id, org_id, created_at DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_worker_tasks_org_status_claim`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_worker_tasks_org_status_manager`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_remote_agents_org_agent`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_worker_contexts_parent_org_created`,
    );
  }
}

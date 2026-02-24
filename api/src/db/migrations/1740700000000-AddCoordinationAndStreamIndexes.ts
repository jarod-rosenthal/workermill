import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add composite indexes for coordination queries and dashboard stream.
 *
 * Covers:
 * - Blocker queries: WHERE (parent_task_id, org_id, archived, message_type)
 * - Coordination context: WHERE (parent_task_id, org_id, archived) ORDER BY created_at
 * - Dashboard stream: WHERE (org_id, status) — replaces full table scan
 * - Card lookup by worker_task_id in stream batch-fetch
 */
export class AddCoordinationAndStreamIndexes1740700000000
  implements MigrationInterface
{
  name = "AddCoordinationAndStreamIndexes1740700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Composite index for blocker and coordination queries
    // Covers: WHERE parent_task_id = ? AND org_id = ? AND archived = false AND message_type IN (...)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_contexts_coord_lookup
      ON worker_contexts(parent_task_id, org_id, archived, message_type, created_at)
    `);

    // Dashboard stream: filter by org + status instead of full table scan
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_tasks_org_status
      ON worker_tasks(org_id, status, created_at DESC)
    `);

    // Card lookup by worker_task_id (batch-fetch in stream.ts)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kb_cards_worker_task
      ON kb_cards(worker_task_id) WHERE worker_task_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_kb_cards_worker_task`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_worker_tasks_org_status`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_worker_contexts_coord_lookup`,
    );
  }
}

import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Create worker_contexts table for multi-agent communication
 *
 * This enables sibling workers to share context in real-time:
 * - Workers post updates about files created, decisions made, blockers
 * - Siblings subscribe via SSE to receive updates
 * - Enables coordination without direct communication
 */
export class CreateWorkerContext1705344000007 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE worker_contexts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        parent_task_id UUID NOT NULL REFERENCES worker_tasks(id) ON DELETE CASCADE,
        task_id UUID NOT NULL REFERENCES worker_tasks(id) ON DELETE CASCADE,
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        persona VARCHAR(50) NOT NULL,
        message_type VARCHAR(50) NOT NULL CHECK (message_type IN (
          'file_created',
          'file_modified',
          'decision',
          'dependency',
          'question',
          'answer',
          'completion',
          'blocker',
          'warning',
          'progress'
        )),
        content TEXT NOT NULL,
        metadata JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Index for efficient sibling lookups (get all context for a parent task)
    await queryRunner.query(`
      CREATE INDEX idx_worker_contexts_parent_task ON worker_contexts(parent_task_id, created_at);
    `);

    // Index for filtering by message type
    await queryRunner.query(`
      CREATE INDEX idx_worker_contexts_type ON worker_contexts(parent_task_id, message_type);
    `);

    // Index for getting context from a specific task
    await queryRunner.query(`
      CREATE INDEX idx_worker_contexts_task ON worker_contexts(task_id, created_at);
    `);

    // Index for org-wide context queries (for cleanup, analytics)
    await queryRunner.query(`
      CREATE INDEX idx_worker_contexts_org ON worker_contexts(org_id, created_at);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_worker_contexts_org;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_worker_contexts_task;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_worker_contexts_type;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_worker_contexts_parent_task;`);
    await queryRunner.query(`DROP TABLE IF EXISTS worker_contexts;`);
  }
}

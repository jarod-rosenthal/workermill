import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add PRD orchestration support to worker_tasks
 *
 * This enables:
 * - Parent-child task relationships for multi-story PRDs
 * - Plan storage and approval workflow
 * - Story dependencies and tracking
 */
export class AddPrdOrchestration1705344000006 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add parent-child relationship columns
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN parent_task_id UUID REFERENCES worker_tasks(id) ON DELETE CASCADE,
      ADD COLUMN story_index INTEGER,
      ADD COLUMN story_title VARCHAR(500),
      ADD COLUMN child_task_ids UUID[],
      ADD COLUMN story_dependencies INTEGER[];
    `);

    // Add planning columns
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN plan_json JSONB,
      ADD COLUMN plan_status VARCHAR(30) CHECK (plan_status IN ('pending_approval', 'approved', 'changes_requested')),
      ADD COLUMN plan_feedback TEXT,
      ADD COLUMN plan_approved_at TIMESTAMP,
      ADD COLUMN plan_approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN planning_notes TEXT;
    `);

    // Add index for parent-child lookups
    await queryRunner.query(`
      CREATE INDEX idx_worker_tasks_parent_id ON worker_tasks(parent_task_id);
    `);

    // Add index for finding tasks by plan status
    await queryRunner.query(`
      CREATE INDEX idx_worker_tasks_plan_status ON worker_tasks(plan_status) WHERE plan_status IS NOT NULL;
    `);

    // Add blocked status to the status check constraint
    // First, we need to drop the existing constraint and recreate with new values
    await queryRunner.query(`
      ALTER TABLE worker_tasks DROP CONSTRAINT IF EXISTS worker_tasks_status_check;
    `);

    await queryRunner.query(`
      ALTER TABLE worker_tasks ADD CONSTRAINT worker_tasks_status_check
      CHECK (status IN (
        'queued', 'dispatching', 'claimed', 'environment_setup', 'executing', 'deploying',
        'pr_created', 'review_requested', 'manager_review', 'revision_needed', 'pr_approved', 'review_approved', 'escalated',
        'completed', 'deployed', 'failed', 'cancelled', 'review_rejected',
        'planning', 'pending_plan_approval', 'blocked'
      ));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove indexes
    await queryRunner.query(`DROP INDEX IF EXISTS idx_worker_tasks_plan_status;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_worker_tasks_parent_id;`);

    // Remove planning columns
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      DROP COLUMN IF EXISTS planning_notes,
      DROP COLUMN IF EXISTS plan_approved_by,
      DROP COLUMN IF EXISTS plan_approved_at,
      DROP COLUMN IF EXISTS plan_feedback,
      DROP COLUMN IF EXISTS plan_status,
      DROP COLUMN IF EXISTS plan_json;
    `);

    // Remove parent-child columns
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      DROP COLUMN IF EXISTS story_dependencies,
      DROP COLUMN IF EXISTS child_task_ids,
      DROP COLUMN IF EXISTS story_title,
      DROP COLUMN IF EXISTS story_index,
      DROP COLUMN IF EXISTS parent_task_id;
    `);

    // Revert status constraint (optional - just remove the new statuses from check)
    await queryRunner.query(`
      ALTER TABLE worker_tasks DROP CONSTRAINT IF EXISTS worker_tasks_status_check;
    `);
  }
}

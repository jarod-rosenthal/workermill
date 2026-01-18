import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Make Jira fields optional in worker_tasks and add internal_task_id
 *
 * This enables internal tasks (from the Kanban board) to create WorkerTasks
 * without requiring a Jira integration. The internal_task_id links back to
 * the source InternalTask for status updates.
 */
export class MakeJiraFieldsOptional1705344000013 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Make jira_issue_key nullable
    await queryRunner.query(`
      ALTER TABLE worker_tasks ALTER COLUMN jira_issue_key DROP NOT NULL;
    `);

    // Make jira_issue_id nullable
    await queryRunner.query(`
      ALTER TABLE worker_tasks ALTER COLUMN jira_issue_id DROP NOT NULL;
    `);

    // Add internal_task_id column
    await queryRunner.query(`
      ALTER TABLE worker_tasks ADD COLUMN internal_task_id UUID REFERENCES internal_tasks(id) ON DELETE SET NULL;
    `);

    // Index for internal task lookups
    await queryRunner.query(`
      CREATE INDEX idx_worker_tasks_internal_task_id ON worker_tasks(internal_task_id) WHERE internal_task_id IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_worker_tasks_internal_task_id;`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS internal_task_id;`);

    // Note: We don't restore NOT NULL constraints as that could fail if there's existing data
    // with NULL values. In production, this would need a data migration first.
  }
}

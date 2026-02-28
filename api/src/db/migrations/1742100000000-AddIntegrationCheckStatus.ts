import { MigrationInterface, QueryRunner } from "typeorm";

export class AddIntegrationCheckStatus1742100000000
  implements MigrationInterface
{
  name = "AddIntegrationCheckStatus1742100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE worker_tasks DROP CONSTRAINT IF EXISTS worker_tasks_status_check;
      ALTER TABLE worker_tasks ADD CONSTRAINT worker_tasks_status_check CHECK (
        status IN (
          'queued', 'dispatching', 'claimed', 'environment_setup', 'executing', 'deploying',
          'pr_created', 'review_requested', 'manager_review', 'revision_needed', 'pr_approved',
          'review_approved', 'escalated', 'completed', 'deployed', 'failed', 'cancelled',
          'review_rejected', 'planning', 'pending_plan_approval', 'blocked',
          'reviewing', 'consolidating', 'integration_check'
        )
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE worker_tasks DROP CONSTRAINT IF EXISTS worker_tasks_status_check;
      ALTER TABLE worker_tasks ADD CONSTRAINT worker_tasks_status_check CHECK (
        status IN (
          'queued', 'dispatching', 'claimed', 'environment_setup', 'executing', 'deploying',
          'pr_created', 'review_requested', 'manager_review', 'revision_needed', 'pr_approved',
          'review_approved', 'escalated', 'completed', 'deployed', 'failed', 'cancelled',
          'review_rejected', 'planning', 'pending_plan_approval', 'blocked',
          'reviewing', 'consolidating'
        )
      );
    `);
  }
}

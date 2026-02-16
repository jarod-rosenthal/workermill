import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add database-level safeguard to prevent mass deletion of worker_task_logs.
 *
 * Two protections:
 * 1. Block any single DELETE statement affecting >500 rows
 * 2. Block deletion of logs for tasks in terminal states (completed, deployed, pr_approved, etc.)
 *    that finished more than 10 minutes ago — these are historical records
 *
 * Both can be bypassed with: SET app.allow_log_delete = 'authorized'
 * (scoped to current session, resets on disconnect)
 *
 * Legitimate delete paths (dry-run cleanup, E2E test cleanup) are unaffected because
 * they operate on recently-completed or test tasks.
 */
export class AddLogDeletionSafeguard1706688000048 implements MigrationInterface {
  name = "AddLogDeletionSafeguard1706688000048";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the guard function using transition tables (PostgreSQL 10+)
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION guard_worker_task_log_deletion()
      RETURNS TRIGGER AS $$
      DECLARE
        del_count INTEGER;
        protected_count INTEGER;
        bypass TEXT;
      BEGIN
        -- Allow bypass for maintenance operations
        bypass := coalesce(current_setting('app.allow_log_delete', true), '');
        IF bypass = 'authorized' THEN
          RETURN NULL;
        END IF;

        SELECT count(*) INTO del_count FROM _deleted_logs;

        -- Block 1: Mass deletion (>500 rows in a single statement)
        IF del_count > 500 THEN
          RAISE EXCEPTION 'SAFEGUARD: Blocked mass deletion of % rows from worker_task_logs. '
            'Maximum 500 per statement. To override: SET app.allow_log_delete = ''authorized''',
            del_count;
        END IF;

        -- Block 2: Protect logs for completed tasks older than 10 minutes
        -- Allows: dry-run cleanup (runs within minutes), active task log trimming
        -- Blocks: accidental or malicious wipes of historical logs
        SELECT count(*) INTO protected_count
        FROM _deleted_logs d
        JOIN worker_tasks t ON t.id = d.task_id
        WHERE t.status IN ('completed', 'deployed', 'pr_approved', 'pr_created', 'review_requested', 'failed', 'cancelled')
          AND t.updated_at < NOW() - INTERVAL '10 minutes';

        IF protected_count > 0 THEN
          RAISE EXCEPTION 'SAFEGUARD: Blocked deletion of % log rows belonging to finished tasks. '
            'Logs for finished tasks are protected historical records. '
            'To override: SET app.allow_log_delete = ''authorized''',
            protected_count;
        END IF;

        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Create the AFTER DELETE trigger with transition table
    await queryRunner.query(`
      CREATE TRIGGER guard_log_deletion
        AFTER DELETE ON worker_task_logs
        REFERENCING OLD TABLE AS _deleted_logs
        FOR EACH STATEMENT
        EXECUTE FUNCTION guard_worker_task_log_deletion();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS guard_log_deletion ON worker_task_logs`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS guard_worker_task_log_deletion()`);
  }
}

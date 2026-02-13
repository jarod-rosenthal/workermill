import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTicketSystemBackfill1706688000043 implements MigrationInterface {
  name = "AddTicketSystemBackfill1706688000043";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add ticket_system column
    await queryRunner.query(`
      ALTER TABLE "worker_tasks"
      ADD COLUMN IF NOT EXISTS "ticket_system" VARCHAR(20)
    `);

    // 2. Backfill ticketSystem from org's issueTrackerProvider for external tasks
    await queryRunner.query(`
      UPDATE worker_tasks wt
      SET ticket_system = (
        SELECT CASE
          WHEN o.issue_tracker_provider = 'github-issues' THEN 'github'
          ELSE o.issue_tracker_provider
        END
        FROM organizations o WHERE o.id = wt.org_id
      )
      WHERE wt.ticket_system IS NULL
        AND wt.jira_issue_key IS NOT NULL
    `);

    // 3. Backfill null descriptions with summary as fallback for terminal tasks
    await queryRunner.query(`
      UPDATE worker_tasks
      SET description = summary
      WHERE description IS NULL
        AND jira_issue_key IS NOT NULL
        AND status IN ('completed', 'failed', 'cancelled')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "worker_tasks" DROP COLUMN IF EXISTS "ticket_system"
    `);
  }
}

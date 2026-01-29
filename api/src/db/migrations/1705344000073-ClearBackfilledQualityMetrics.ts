import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Clear the backfilled quality metrics from migration 1705344000071.
 *
 * Those metrics were from a one-time repo scan and don't represent
 * actual per-task quality measurements. Going forward, quality metrics
 * will be captured per-task during worker execution.
 */
export class ClearBackfilledQualityMetrics1705344000073 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Clear the backfilled metrics (identified by the quality_analysis_json marker)
    await queryRunner.query(`
      UPDATE worker_tasks
      SET
        quality_score = NULL,
        lint_score = NULL,
        lint_errors = NULL,
        lint_warnings = NULL,
        typecheck_score = NULL,
        type_errors = NULL,
        test_score = NULL,
        tests_passed = NULL,
        tests_failed = NULL,
        tests_skipped = NULL,
        security_score = NULL,
        security_high = NULL,
        security_medium = NULL,
        security_low = NULL,
        quality_analysis_json = NULL
      WHERE
        quality_analysis_json->>'source' = 'migration'
        AND quality_analysis_json->>'backfilled' = 'true'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-backfill the metrics (same as migration 1705344000071)
    await queryRunner.query(`
      UPDATE worker_tasks
      SET
        quality_score = 78,
        lint_score = 68,
        lint_errors = 322,
        lint_warnings = 21,
        typecheck_score = 100,
        type_errors = 0,
        test_score = 70,
        tests_passed = 352,
        tests_failed = 148,
        tests_skipped = 1,
        security_score = 67,
        security_high = 3,
        security_medium = 1,
        security_low = 1,
        quality_analysis_json = '{"backfilled": true, "source": "migration", "scannedAt": "2026-01-28", "note": "Metrics from repo-level scan, represents state at main branch"}'::jsonb
      WHERE
        quality_score IS NULL
        AND status IN ('completed', 'deployed')
        AND (
          github_pr_url LIKE '%pagerduty-lite%'
          OR jira_issue_key LIKE 'OCS-%'
        )
    `);
  }
}

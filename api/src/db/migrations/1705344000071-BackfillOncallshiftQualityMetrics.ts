import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Backfill quality metrics for oncallshift (pagerduty-lite) tasks.
 *
 * Metrics gathered from scanning the repo on 2026-01-28:
 * - Backend TypeCheck: 100 (passed)
 * - Backend Tests: 352 passed, 148 failed, 1 skipped = 70%
 * - Backend Security: 3 high, 1 moderate, 1 low
 * - Frontend TypeCheck: 100 (passed)
 * - Frontend Lint: 322 errors, 21 warnings
 * - Frontend Security: 0 vulnerabilities
 *
 * Combined scores (weighted for the repo):
 * - TypeCheck: 100
 * - Lint: 68
 * - Tests: 70
 * - Security: 67 (average of backend 34 + frontend 100)
 * - Quality Score: 78 (30% typecheck + 25% lint + 35% tests + 10% security)
 */
export class BackfillOncallshiftQualityMetrics1705344000071 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Update all completed/deployed tasks for pagerduty-lite that don't have quality metrics
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Clear the backfilled metrics
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
}

import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add code quality metrics fields to worker_tasks table.
 * Enables tracking of lint, typecheck, test, coverage, and security scores
 * for measuring AI worker code output quality.
 */
export class AddCodeQualityMetrics1705344000070 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Composite quality score (0-100 scale, weighted average)
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS quality_score INT
    `);

    // Lint score (0-100, based on error rate relative to lines of code)
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS lint_score INT
    `);

    // Typecheck score (100 if pass, 0 if fail)
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS typecheck_score INT
    `);

    // Test score (0-100, based on pass rate)
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS test_score INT
    `);

    // Coverage score (0-100, line coverage percentage)
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS coverage_score INT
    `);

    // Security score (0-100, based on vulnerability count and severity)
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS security_score INT
    `);

    // Raw lint counts
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS lint_errors INT
    `);

    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS lint_warnings INT
    `);

    // Raw typecheck count
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS type_errors INT
    `);

    // Raw test counts
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS tests_passed INT
    `);

    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS tests_failed INT
    `);

    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS tests_skipped INT
    `);

    // Coverage percentages (decimal for precision)
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS coverage_lines DECIMAL(5,2)
    `);

    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS coverage_branches DECIMAL(5,2)
    `);

    // Security vulnerability counts by severity
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS security_high INT
    `);

    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS security_medium INT
    `);

    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS security_low INT
    `);

    // Full analysis output for drill-down (JSONB for complex nested data)
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS quality_analysis_json JSONB
    `);

    // External tool links
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS sonarqube_url TEXT
    `);

    // Index for analytics queries on quality_score
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_tasks_quality_score
      ON worker_tasks(quality_score)
      WHERE quality_score IS NOT NULL
    `);

    // Composite index for quality analytics by org and date
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_tasks_quality_analytics
      ON worker_tasks(org_id, completed_at, quality_score)
      WHERE quality_score IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_worker_tasks_quality_analytics`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_worker_tasks_quality_score`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS sonarqube_url`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS quality_analysis_json`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS security_low`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS security_medium`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS security_high`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS coverage_branches`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS coverage_lines`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS tests_skipped`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS tests_failed`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS tests_passed`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS type_errors`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS lint_warnings`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS lint_errors`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS security_score`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS coverage_score`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS test_score`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS typecheck_score`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS lint_score`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN IF EXISTS quality_score`);
  }
}

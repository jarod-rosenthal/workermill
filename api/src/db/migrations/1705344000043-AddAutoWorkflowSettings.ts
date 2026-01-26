import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Migration: Add Auto Workflow Settings
 *
 * Adds org-level toggles for auto-review and auto-deploy functionality:
 * - organizations.auto_review_enabled: When true, tasks require review by default (like 'review' label)
 * - organizations.auto_deploy_enabled: When true, tasks auto-deploy by default (like 'deploy' label)
 *
 * These settings act as defaults when Jira labels are not explicitly set.
 */
export class AddAutoWorkflowSettings1705344000043 implements MigrationInterface {
  name = "AddAutoWorkflowSettings1705344000043";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add auto_review_enabled to organizations (default: false for backwards compatibility)
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS auto_review_enabled BOOLEAN NOT NULL DEFAULT false
    `);

    // Add auto_deploy_enabled to organizations (default: false for backwards compatibility)
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS auto_deploy_enabled BOOLEAN NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS auto_deploy_enabled
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS auto_review_enabled
    `);
  }
}

import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOrgEmailSettings1705344000027 implements MigrationInterface {
  name = "AddOrgEmailSettings1705344000027";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add email settings columns to organizations table
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS email_from_address VARCHAR(255),
      ADD COLUMN IF NOT EXISTS email_notifications_enabled BOOLEAN DEFAULT true,
      ADD COLUMN IF NOT EXISTS email_log_retention_days INT DEFAULT 90,
      ADD COLUMN IF NOT EXISTS default_email_preferences JSONB DEFAULT '{"taskCompleted": true, "taskFailed": true, "costAlerts": true, "prCreated": false, "frequency": "immediate"}'::jsonb
    `);

    // Add index for email settings lookup
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_organizations_email_enabled ON organizations(email_notifications_enabled) WHERE email_notifications_enabled = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_organizations_email_enabled`);
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS email_from_address,
      DROP COLUMN IF EXISTS email_notifications_enabled,
      DROP COLUMN IF EXISTS email_log_retention_days,
      DROP COLUMN IF EXISTS default_email_preferences
    `);
  }
}

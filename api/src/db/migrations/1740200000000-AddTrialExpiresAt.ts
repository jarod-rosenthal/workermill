import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTrialExpiresAt1740200000000 implements MigrationInterface {
  name = "AddTrialExpiresAt1740200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_expires_at TIMESTAMP;
      ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_reminders_sent JSONB DEFAULT '{}';
      UPDATE organizations SET trial_expires_at = created_at + INTERVAL '90 days' WHERE plan = 'pro' AND trial_expires_at IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations DROP COLUMN IF EXISTS trial_expires_at;
      ALTER TABLE organizations DROP COLUMN IF EXISTS trial_reminders_sent;
    `);
  }
}

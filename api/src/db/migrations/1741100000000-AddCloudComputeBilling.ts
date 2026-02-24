import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCloudComputeBilling1741100000000 implements MigrationInterface {
  name = "AddCloudComputeBilling1741100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add welcomeCreditApplied column (guards one-time $10 welcome credit for Max)
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS welcome_credit_applied BOOLEAN NOT NULL DEFAULT false
    `);

    // Add lastBalanceEmailSentAt column (prevents repeat balance emails within 7 days)
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS last_balance_email_sent_at TIMESTAMP
    `);

    // Update auto-recharge defaults for new compute billing model
    // Threshold: $10 → $5, Amount: $50 → $25
    await queryRunner.query(`
      ALTER TABLE organizations
      ALTER COLUMN auto_recharge_threshold_cents SET DEFAULT 500
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      ALTER COLUMN auto_recharge_amount_cents SET DEFAULT 2500
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      ALTER COLUMN auto_recharge_amount_cents SET DEFAULT 5000
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      ALTER COLUMN auto_recharge_threshold_cents SET DEFAULT 1000
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS last_balance_email_sent_at
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS welcome_credit_applied
    `);
  }
}

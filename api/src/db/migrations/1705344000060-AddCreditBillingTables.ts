import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCreditBillingTables1705344000060 implements MigrationInterface {
  name = "AddCreditBillingTables1705344000060";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add credit billing columns to organizations table
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS credit_balance_cents INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS auto_recharge_enabled BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS auto_recharge_threshold_cents INTEGER DEFAULT 1000,
      ADD COLUMN IF NOT EXISTS auto_recharge_amount_cents INTEGER DEFAULT 5000,
      ADD COLUMN IF NOT EXISTS billing_paused BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS billing_paused_reason TEXT,
      ADD COLUMN IF NOT EXISTS free_credits_remaining_cents INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS signup_deposit_completed BOOLEAN DEFAULT false
    `);

    // Create credit_transactions table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS credit_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        type VARCHAR(20) NOT NULL,
        amount_cents INTEGER NOT NULL,
        balance_after_cents INTEGER NOT NULL,
        description TEXT,
        task_id UUID REFERENCES worker_tasks(id) ON DELETE SET NULL,
        ai_cost_cents INTEGER,
        fee_cents INTEGER,
        stripe_payment_intent_id VARCHAR(255),
        stripe_charge_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create indexes for credit_transactions
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_credit_tx_org ON credit_transactions(org_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_credit_tx_created ON credit_transactions(created_at)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_credit_tx_type ON credit_transactions(type)
    `);

    // Create payment_methods table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS payment_methods (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        stripe_payment_method_id VARCHAR(255) NOT NULL,
        type VARCHAR(20) NOT NULL DEFAULT 'card',
        last_four VARCHAR(4),
        brand VARCHAR(20),
        exp_month INTEGER,
        exp_year INTEGER,
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create index for payment_methods
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_pm_org ON payment_methods(org_id)
    `);

    // Add check constraint for transaction type
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'chk_credit_tx_type'
        ) THEN
          ALTER TABLE credit_transactions
          ADD CONSTRAINT chk_credit_tx_type
          CHECK (type IN ('deposit', 'usage', 'refund', 'bonus', 'auto_recharge'));
        END IF;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop check constraint
    await queryRunner.query(`
      ALTER TABLE credit_transactions
      DROP CONSTRAINT IF EXISTS chk_credit_tx_type
    `);

    // Drop indexes
    await queryRunner.query(`DROP INDEX IF EXISTS idx_pm_org`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_credit_tx_type`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_credit_tx_created`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_credit_tx_org`);

    // Drop tables
    await queryRunner.query(`DROP TABLE IF EXISTS payment_methods`);
    await queryRunner.query(`DROP TABLE IF EXISTS credit_transactions`);

    // Remove columns from organizations
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS credit_balance_cents,
      DROP COLUMN IF EXISTS auto_recharge_enabled,
      DROP COLUMN IF EXISTS auto_recharge_threshold_cents,
      DROP COLUMN IF EXISTS auto_recharge_amount_cents,
      DROP COLUMN IF EXISTS billing_paused,
      DROP COLUMN IF EXISTS billing_paused_reason,
      DROP COLUMN IF EXISTS free_credits_remaining_cents,
      DROP COLUMN IF EXISTS signup_deposit_completed
    `);
  }
}

import { MigrationInterface, QueryRunner } from "typeorm";

export class AddBillingFields1704067200020 implements MigrationInterface {
  name = "AddBillingFields1704067200020";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add Stripe billing columns to organizations table
    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "stripe_customer_id" varchar(255) NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "stripe_subscription_id" varchar(255) NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "stripe_subscription_status" varchar(50) NULL
    `);

    // Add task quota columns
    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "task_quota" integer NOT NULL DEFAULT 10
    `);

    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "task_usage_this_month" integer NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "billing_cycle_start" timestamp NULL
    `);

    // Add Slack webhook for notifications
    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "slack_webhook_url" varchar(500) NULL
    `);

    // Create indexes for Stripe lookups
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_organizations_stripe_customer_id"
      ON "organizations" ("stripe_customer_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_organizations_stripe_subscription_id"
      ON "organizations" ("stripe_subscription_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_organizations_stripe_subscription_id"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_organizations_stripe_customer_id"`
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN IF EXISTS "slack_webhook_url"`
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN IF EXISTS "billing_cycle_start"`
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN IF EXISTS "task_usage_this_month"`
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN IF EXISTS "task_quota"`
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN IF EXISTS "stripe_subscription_status"`
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN IF EXISTS "stripe_subscription_id"`
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN IF EXISTS "stripe_customer_id"`
    );
  }
}

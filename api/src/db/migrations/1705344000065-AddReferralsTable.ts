import { MigrationInterface, QueryRunner } from "typeorm";

export class AddReferralsTable1705344000065 implements MigrationInterface {
  name = "AddReferralsTable1705344000065";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create referrals table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "referrals" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "referrer_user_id" uuid NOT NULL,
        "referrer_org_id" uuid NOT NULL,
        "referral_code" varchar(50) NOT NULL,
        "referred_email" varchar(255),
        "referred_user_id" uuid,
        "referred_org_id" uuid,
        "status" varchar(20) NOT NULL DEFAULT 'pending',
        "credit_amount_cents" int NOT NULL DEFAULT 10000,
        "credited_at" TIMESTAMP,
        "referred_discount_percent" int NOT NULL DEFAULT 50,
        "referred_discount_months" int NOT NULL DEFAULT 3,
        "referred_discount_used_months" int NOT NULL DEFAULT 0,
        "referred_ip" varchar(45),
        "referred_email_domain" varchar(255),
        "signed_up_at" TIMESTAMP,
        "qualified_at" TIMESTAMP,
        "expires_at" TIMESTAMP NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_referrals" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_referrals_code" UNIQUE ("referral_code"),
        CONSTRAINT "FK_referrals_referrer_user" FOREIGN KEY ("referrer_user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_referrals_referrer_org" FOREIGN KEY ("referrer_org_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_referrals_referred_user" FOREIGN KEY ("referred_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_referrals_referred_org" FOREIGN KEY ("referred_org_id") REFERENCES "organizations"("id") ON DELETE SET NULL
      )
    `);

    // Create indexes
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_referrals_referrer_created" ON "referrals" ("referrer_user_id", "created_at")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_referrals_referred_email" ON "referrals" ("referred_email")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_referrals_status" ON "referrals" ("status")
    `);

    // Add referral_code column to users table for easy lookup
    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referral_code" varchar(50)
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_users_referral_code" ON "users" ("referral_code") WHERE "referral_code" IS NOT NULL
    `);

    // Add referred_by column to track who referred this user
    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referred_by_code" varchar(50)
    `);

    // Add metadata column to credit_transactions for referral tracking
    await queryRunner.query(`
      ALTER TABLE "credit_transactions" ADD COLUMN IF NOT EXISTS "metadata" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "referred_by_code"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_referral_code"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "referral_code"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_referrals_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_referrals_referred_email"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_referrals_referrer_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "referrals"`);
  }
}

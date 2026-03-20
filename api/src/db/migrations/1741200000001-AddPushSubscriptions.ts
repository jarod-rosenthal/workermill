import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPushSubscriptions1741200000001 implements MigrationInterface {
  name = "AddPushSubscriptions1741200000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "push_subscriptions" (
        "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "expo_push_token" varchar(255) NOT NULL,
        "platform" varchar(10) NOT NULL CHECK ("platform" IN ('ios', 'android')),
        "device_name" varchar(255),
        "created_at" timestamptz DEFAULT now() NOT NULL,
        "updated_at" timestamptz DEFAULT now() NOT NULL,
        CONSTRAINT "uq_push_subscriptions_token" UNIQUE ("expo_push_token")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_push_subscriptions_user_org"
      ON "push_subscriptions" ("user_id", "org_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "notification_preferences" jsonb
      DEFAULT '{"push_completions": true, "push_failures": true, "push_blockers": true, "push_plan_approvals": true}'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "notification_preferences"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "push_subscriptions"`);
  }
}
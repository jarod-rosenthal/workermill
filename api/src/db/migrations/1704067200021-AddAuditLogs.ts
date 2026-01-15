import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAuditLogs1704067200021 implements MigrationInterface {
  name = "AddAuditLogs1704067200021";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create audit_logs table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "action" varchar(50) NOT NULL,
        "resource_type" varchar(50) NOT NULL,
        "resource_id" varchar(255),
        "changes" jsonb NOT NULL DEFAULT '{}',
        "ip_address" varchar(45),
        "user_agent" text,
        "description" text,
        "created_at" timestamp NOT NULL DEFAULT now()
      )
    `);

    // Create indexes for efficient querying
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_audit_logs_org_created"
      ON "audit_logs" ("organization_id", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_audit_logs_user_created"
      ON "audit_logs" ("user_id", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_audit_logs_action_created"
      ON "audit_logs" ("action", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_audit_logs_resource"
      ON "audit_logs" ("resource_type", "resource_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_resource"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_action_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_user_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_org_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs"`);
  }
}

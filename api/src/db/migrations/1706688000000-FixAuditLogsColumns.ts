import { MigrationInterface, QueryRunner } from "typeorm";

export class FixAuditLogsColumns1706688000000 implements MigrationInterface {
  name = "FixAuditLogsColumns1706688000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if audit_logs table exists
    const tableExists = await queryRunner.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'audit_logs'
      )
    `);

    if (!tableExists[0].exists) {
      // Table doesn't exist, create it with correct schema
      await queryRunner.query(`
        CREATE TABLE "audit_logs" (
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

      await queryRunner.query(`
        CREATE INDEX "IDX_audit_logs_org_created" ON "audit_logs" ("organization_id", "created_at" DESC)
      `);
      await queryRunner.query(`
        CREATE INDEX "IDX_audit_logs_user_created" ON "audit_logs" ("user_id", "created_at" DESC)
      `);
      await queryRunner.query(`
        CREATE INDEX "IDX_audit_logs_action_created" ON "audit_logs" ("action", "created_at" DESC)
      `);
      await queryRunner.query(`
        CREATE INDEX "IDX_audit_logs_resource" ON "audit_logs" ("resource_type", "resource_id")
      `);
    } else {
      // Table exists, check for missing columns and add them
      const columns = await queryRunner.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'audit_logs'
      `);
      const columnNames = columns.map((c: { column_name: string }) => c.column_name);

      // Add organization_id if missing
      if (!columnNames.includes("organization_id")) {
        // Check if organizationId exists (camelCase from TypeORM sync)
        if (columnNames.includes("organizationid")) {
          await queryRunner.query(`ALTER TABLE "audit_logs" RENAME COLUMN "organizationid" TO "organization_id"`);
        } else {
          await queryRunner.query(`
            ALTER TABLE "audit_logs"
            ADD COLUMN "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE
          `);
        }
      }

      // Add user_id if missing
      if (!columnNames.includes("user_id")) {
        if (columnNames.includes("userid")) {
          await queryRunner.query(`ALTER TABLE "audit_logs" RENAME COLUMN "userid" TO "user_id"`);
        } else {
          await queryRunner.query(`
            ALTER TABLE "audit_logs"
            ADD COLUMN "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL
          `);
        }
      }

      // Add resource_type if missing
      if (!columnNames.includes("resource_type")) {
        if (columnNames.includes("resourcetype")) {
          await queryRunner.query(`ALTER TABLE "audit_logs" RENAME COLUMN "resourcetype" TO "resource_type"`);
        } else {
          await queryRunner.query(`
            ALTER TABLE "audit_logs"
            ADD COLUMN "resource_type" varchar(50) DEFAULT 'organization'
          `);
        }
      }

      // Add resource_id if missing
      if (!columnNames.includes("resource_id")) {
        if (columnNames.includes("resourceid")) {
          await queryRunner.query(`ALTER TABLE "audit_logs" RENAME COLUMN "resourceid" TO "resource_id"`);
        } else {
          await queryRunner.query(`
            ALTER TABLE "audit_logs"
            ADD COLUMN "resource_id" varchar(255)
          `);
        }
      }

      // Add ip_address if missing
      if (!columnNames.includes("ip_address")) {
        if (columnNames.includes("ipaddress")) {
          await queryRunner.query(`ALTER TABLE "audit_logs" RENAME COLUMN "ipaddress" TO "ip_address"`);
        } else {
          await queryRunner.query(`
            ALTER TABLE "audit_logs"
            ADD COLUMN "ip_address" varchar(45)
          `);
        }
      }

      // Add user_agent if missing
      if (!columnNames.includes("user_agent")) {
        if (columnNames.includes("useragent")) {
          await queryRunner.query(`ALTER TABLE "audit_logs" RENAME COLUMN "useragent" TO "user_agent"`);
        } else {
          await queryRunner.query(`
            ALTER TABLE "audit_logs"
            ADD COLUMN "user_agent" text
          `);
        }
      }

      // Add created_at if missing
      if (!columnNames.includes("created_at")) {
        if (columnNames.includes("createdat")) {
          await queryRunner.query(`ALTER TABLE "audit_logs" RENAME COLUMN "createdat" TO "created_at"`);
        } else {
          await queryRunner.query(`
            ALTER TABLE "audit_logs"
            ADD COLUMN "created_at" timestamp NOT NULL DEFAULT now()
          `);
        }
      }

      // Create indexes if they don't exist
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op - we don't want to undo column fixes
  }
}

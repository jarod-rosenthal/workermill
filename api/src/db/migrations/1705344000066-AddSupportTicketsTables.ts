import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSupportTicketsTables1705344000066 implements MigrationInterface {
  name = "AddSupportTicketsTables1705344000066";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create support_tickets table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "support_tickets" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "ticket_key" varchar(20) NOT NULL,
        "subject" varchar(500) NOT NULL,
        "description" text NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'open',
        "priority" varchar(20) NOT NULL DEFAULT 'medium',
        "category" varchar(30) NOT NULL DEFAULT 'general',
        "assigned_to" uuid,
        "org_id" uuid NOT NULL,
        "created_by" uuid NOT NULL,
        "email_message_id" varchar(255),
        "metadata" jsonb,
        "resolved_at" TIMESTAMP,
        "closed_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_support_tickets" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_support_tickets_key" UNIQUE ("ticket_key"),
        CONSTRAINT "FK_support_tickets_org" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_support_tickets_creator" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_support_tickets_assignee" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    // Create support_ticket_messages table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "support_ticket_messages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "ticket_id" uuid NOT NULL,
        "content" text NOT NULL,
        "is_internal" boolean NOT NULL DEFAULT false,
        "is_from_support" boolean NOT NULL DEFAULT false,
        "author_id" uuid,
        "author_email" varchar(255),
        "email_message_id" varchar(255),
        "attachments" jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_support_ticket_messages" PRIMARY KEY ("id"),
        CONSTRAINT "FK_support_ticket_messages_ticket" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_support_ticket_messages_author" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    // Indexes for support_tickets
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_support_tickets_org_status" ON "support_tickets" ("org_id", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_support_tickets_created_by" ON "support_tickets" ("created_by")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_support_tickets_assigned_to" ON "support_tickets" ("assigned_to") WHERE "assigned_to" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_support_tickets_created_at" ON "support_tickets" ("created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_support_tickets_email_message_id" ON "support_tickets" ("email_message_id") WHERE "email_message_id" IS NOT NULL
    `);

    // Indexes for support_ticket_messages
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_support_ticket_messages_ticket" ON "support_ticket_messages" ("ticket_id", "created_at")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_support_ticket_messages_email_id" ON "support_ticket_messages" ("email_message_id") WHERE "email_message_id" IS NOT NULL
    `);

    // Create sequence for ticket key generation (SUP-001, SUP-002, etc.)
    await queryRunner.query(`
      CREATE SEQUENCE IF NOT EXISTS support_ticket_seq START WITH 1 INCREMENT BY 1
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP SEQUENCE IF EXISTS support_ticket_seq`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_support_ticket_messages_email_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_support_ticket_messages_ticket"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_support_tickets_email_message_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_support_tickets_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_support_tickets_assigned_to"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_support_tickets_created_by"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_support_tickets_org_status"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "support_ticket_messages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "support_tickets"`);
  }
}

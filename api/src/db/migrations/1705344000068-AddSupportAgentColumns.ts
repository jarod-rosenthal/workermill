import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSupportAgentColumns1705344000068 implements MigrationInterface {
  name = "AddSupportAgentColumns1705344000068";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add AI support agent tracking columns to support_tickets table
    await queryRunner.query(`
      ALTER TABLE "support_tickets"
      ADD COLUMN IF NOT EXISTS "auto_response_attempted" boolean DEFAULT false,
      ADD COLUMN IF NOT EXISTS "ai_confidence_score" numeric(5,2),
      ADD COLUMN IF NOT EXISTS "ai_escalation_reason" varchar(255),
      ADD COLUMN IF NOT EXISTS "ai_model_used" varchar(50),
      ADD COLUMN IF NOT EXISTS "ai_response_task_id" uuid,
      ADD COLUMN IF NOT EXISTS "ai_responded_at" TIMESTAMP
    `);

    // Add foreign key for ai_response_task_id to link to worker_tasks
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'FK_support_tickets_ai_task'
        ) THEN
          ALTER TABLE "support_tickets"
          ADD CONSTRAINT "FK_support_tickets_ai_task"
          FOREIGN KEY ("ai_response_task_id") REFERENCES "worker_tasks"("id") ON DELETE SET NULL;
        END IF;
      END $$
    `);

    // Index for filtering auto-attempted tickets
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_support_tickets_auto_response"
      ON "support_tickets" ("auto_response_attempted", "status")
      WHERE "auto_response_attempted" = true
    `);

    // Index for AI response task lookups
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_support_tickets_ai_task"
      ON "support_tickets" ("ai_response_task_id")
      WHERE "ai_response_task_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_support_tickets_ai_task"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_support_tickets_auto_response"`);
    await queryRunner.query(`ALTER TABLE "support_tickets" DROP CONSTRAINT IF EXISTS "FK_support_tickets_ai_task"`);
    await queryRunner.query(`
      ALTER TABLE "support_tickets"
      DROP COLUMN IF EXISTS "ai_responded_at",
      DROP COLUMN IF EXISTS "ai_response_task_id",
      DROP COLUMN IF EXISTS "ai_model_used",
      DROP COLUMN IF EXISTS "ai_escalation_reason",
      DROP COLUMN IF EXISTS "ai_confidence_score",
      DROP COLUMN IF EXISTS "auto_response_attempted"
    `);
  }
}

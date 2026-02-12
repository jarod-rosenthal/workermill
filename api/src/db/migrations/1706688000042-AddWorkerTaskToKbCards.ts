import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWorkerTaskToKbCards1706688000042 implements MigrationInterface {
  name = "AddWorkerTaskToKbCards1706688000042";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kb_cards"
      ADD COLUMN IF NOT EXISTS "worker_task_id" uuid
    `);

    await queryRunner.query(`
      ALTER TABLE "kb_cards"
      DROP CONSTRAINT IF EXISTS "FK_kb_cards_worker_task"
    `);
    await queryRunner.query(`
      ALTER TABLE "kb_cards"
      ADD CONSTRAINT "FK_kb_cards_worker_task"
      FOREIGN KEY ("worker_task_id") REFERENCES "worker_tasks"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_kb_cards_worker_task_id" ON "kb_cards" ("worker_task_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "kb_cards" DROP CONSTRAINT IF EXISTS "FK_kb_cards_worker_task"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_kb_cards_worker_task_id"`);
    await queryRunner.query(`ALTER TABLE "kb_cards" DROP COLUMN IF EXISTS "worker_task_id"`);
  }
}

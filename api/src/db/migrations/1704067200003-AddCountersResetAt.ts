import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCountersResetAt1704067200003 implements MigrationInterface {
  name = "AddCountersResetAt1704067200003";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "counters_reset_at" timestamp NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "counters_reset_at"`);
  }
}

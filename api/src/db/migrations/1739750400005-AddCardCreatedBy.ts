import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCardCreatedBy1739750400005 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kb_cards"
      ADD COLUMN IF NOT EXISTS "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kb_cards" DROP COLUMN IF EXISTS "created_by_id"
    `);
  }
}

import { MigrationInterface, QueryRunner } from "typeorm";

export class AddBoardMetadata1741500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE kb_boards
      ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS quality_gate_max_retries INTEGER DEFAULT 5
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE kb_boards DROP COLUMN IF EXISTS metadata
    `);
    await queryRunner.query(`
      ALTER TABLE organizations DROP COLUMN IF EXISTS quality_gate_max_retries
    `);
  }
}
